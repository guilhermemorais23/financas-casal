import { db } from "../db/firestore";
import { escapeHtml, sendOwnerEmail } from "../email/mailer";
import { getAiUsageSummary } from "../modules/aiUsage/aiUsage";
import { logError, onErrorLogged, type ErrorLogEntry } from "./errorLog";

// Avisos por email pro dono quando algo quebra, sem ele precisar abrir o
// Admin: muitos erros seguidos, banco de dados sem cota, Telegram parado e
// IA perto do orçamento do mês. Cada aviso tem uma chave e sai no máximo uma
// vez por janela -- a marca fica no Firestore (vale entre reinícios do
// servidor) e na memória (vale mesmo com o Firestore fora do ar).
const col = db.collection("opsAlerts");
const sentInMemory = new Map<string, number>();

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export async function alertOwnerOnce(key: string, windowMs: number, subject: string, bodyHtml: string, now = Date.now()): Promise<boolean> {
  if ((sentInMemory.get(key) ?? 0) > now - windowMs) return false;
  sentInMemory.set(key, now);
  try {
    const ref = col.doc(key.replace(/\//g, "_"));
    const claimed = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (Number(snap.get("sentAt") ?? 0) > now - windowMs) return false;
      tx.set(ref, { sentAt: now, subject });
      return true;
    });
    if (!claimed) return false;
  } catch {
    // Firestore fora (ex.: cota do dia estourada): manda mesmo assim; a
    // marca na memória segura a repetição.
  }
  await sendOwnerEmail(`[PAR. alerta] ${subject}`, bodyHtml);
  return true;
}

// ---------------------------------------------------------------------------
// Muitos erros seguidos (chamado por logError).
// ---------------------------------------------------------------------------
export const ERROR_BURST = { count: 10, windowMs: 10 * MINUTE };
const recentErrors: ErrorLogEntry[] = [];
// Erros que não contam: o próprio envio de email (senão um email quebrado
// avisaria de si mesmo sem parar).
const IGNORED_SOURCES = new Set(["email", "ops-alert"]);

export function noteError(entry: ErrorLogEntry, isQuota: boolean): void {
  if (IGNORED_SOURCES.has(entry.source)) return;
  const now = entry.createdAt;
  if (isQuota) {
    void alertOwnerOnce(
      "firestore-quota",
      6 * HOUR,
      "Banco de dados sem cota hoje",
      `<p>O Firestore recusou uma operação por <strong>cota do dia estourada</strong> (plano grátis: 50 mil leituras / 20 mil gravações por dia).</p>
       <p>O app fica lento ou sem salvar até a cota zerar, por volta das 4h (Brasília). Veja Admin &gt; Visão geral &gt; Banco de dados hoje.</p>`,
      now
    );
  }
  recentErrors.push(entry);
  while (recentErrors.length && recentErrors[0].createdAt < now - ERROR_BURST.windowMs) recentErrors.shift();
  if (recentErrors.length < ERROR_BURST.count) return;
  const sample = recentErrors
    .slice(-5)
    .map((e) => `<li><code>${escapeHtml(e.source)}</code> ${e.method ? escapeHtml(`${e.method} ${e.path ?? ""}`) : ""}: ${escapeHtml(e.message.slice(0, 200))}</li>`)
    .join("");
  void alertOwnerOnce(
    "error-burst",
    3 * HOUR,
    `${recentErrors.length} erros em ${ERROR_BURST.windowMs / MINUTE} minutos`,
    `<p>O servidor registrou <strong>${recentErrors.length} erros</strong> nos últimos ${ERROR_BURST.windowMs / MINUTE} minutos. Os últimos:</p>
     <ul>${sample}</ul>
     <p>Detalhes em Admin &gt; Logs.</p>`,
    now
  );
}

// ---------------------------------------------------------------------------
// Checagens periódicas (a cada 30 min, no ping de /api/health).
// ---------------------------------------------------------------------------
interface TelegramWebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}

export async function checkTelegram(now = Date.now(), fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  let info: TelegramWebhookInfo;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const body = (await res.json()) as { ok: boolean; result?: TelegramWebhookInfo; description?: string };
    if (!body.ok || !body.result) return `O Telegram recusou a consulta: ${body.description ?? res.status}.`;
    info = body.result;
  } catch (err) {
    return `Não deu pra falar com o Telegram: ${err instanceof Error ? err.message : String(err)}.`;
  }
  if (!info.url) return "O webhook do bot não está configurado: as mensagens não chegam no servidor.";
  if (info.last_error_date && info.last_error_date * 1000 > now - 2 * HOUR) {
    return `O Telegram não está conseguindo entregar as mensagens: "${info.last_error_message ?? "erro"}" (${info.pending_update_count} esperando).`;
  }
  if (info.pending_update_count >= 20) return `${info.pending_update_count} mensagens paradas esperando o servidor.`;
  return null;
}

export async function checkAiBudget(): Promise<{ over: string | null; atLimit: number }> {
  const budget = Number(process.env.AI_MONTHLY_BUDGET_BRL ?? 50);
  const summary = await getAiUsageSummary();
  const over =
    budget > 0 && summary.costBrl >= budget * 0.8
      ? `A IA já custou cerca de R$ ${summary.costBrl.toFixed(2).replace(".", ",")} este mês (${Math.round((summary.costBrl / budget) * 100)}% do orçamento de R$ ${budget}).`
      : null;
  return { over, atLimit: summary.atLimit };
}

let lastOpsRun = 0;

export async function maybeRunOpsChecks(now = Date.now()): Promise<void> {
  if (now - lastOpsRun < 30 * MINUTE) return;
  lastOpsRun = now;
  const month = new Date(now).toISOString().slice(0, 7);
  try {
    const telegram = await checkTelegram(now);
    if (telegram) {
      await alertOwnerOnce("telegram", 6 * HOUR, "Assistente no Telegram parado", `<p>${escapeHtml(telegram)}</p><p>Confira em Admin &gt; Diagnóstico.</p>`, now);
    }
    const ai = await checkAiBudget();
    if (ai.over) {
      await alertOwnerOnce(`ai-budget-${month}`, 31 * 24 * HOUR, "IA perto do orçamento do mês", `<p>${escapeHtml(ai.over)}</p><p>O orçamento é a variável AI_MONTHLY_BUDGET_BRL. Veja Admin &gt; Visão geral &gt; IA este mês.</p>`, now);
    }
    if (ai.atLimit > 0) {
      await alertOwnerOnce(
        `ai-limit-${new Date(now).toISOString().slice(0, 10)}`,
        24 * HOUR,
        `${ai.atLimit} ${ai.atLimit === 1 ? "pessoa chegou" : "pessoas chegaram"} no limite de IA do mês`,
        `<p>Quem chega no limite fica sem assistente e sem sugestão de categoria na importação até o mês virar.</p>
         <p>Os limites são AI_MONTHLY_MESSAGES e AI_MONTHLY_IMPORTS.</p>`,
        now
      );
    }
  } catch (err) {
    logError("ops-alert", err);
  }
}

onErrorLogged(noteError);
