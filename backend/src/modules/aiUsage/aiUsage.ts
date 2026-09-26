import { FieldValue } from "firebase-admin/firestore";
import { db } from "../../db/firestore";
import { currentMonthParam } from "../../utils/month";
import { estimateCostBrl, type GeminiTokens } from "../../utils/gemini";

// Quanto de IA cada pessoa usa por mês. Sem isso, um Premium podia mandar
// mil mensagens por dia e a conta do Google vinha no nosso bolso.
//   message: cada mensagem ao assistente (app, Telegram, WhatsApp);
//   import:  cada importação de extrato que usou IA (ler PDF de banco sem
//            leitor próprio e/ou sugerir as categorias dos nomes).
export type AiKind = "message" | "import";

export function aiLimits(): Record<AiKind, number> {
  return {
    message: Number(process.env.AI_MONTHLY_MESSAGES ?? 300),
    import: Number(process.env.AI_MONTHLY_IMPORTS ?? 10),
  };
}

const col = db.collection("aiUsage");
const docId = (userId: string, month: string) => `${userId}__${month}`;
const field = (kind: AiKind) => (kind === "message" ? "messages" : "imports");

export interface AiReservation {
  allowed: boolean;
  used: number; // já contando esta, quando allowed
  limit: number;
}

// Reserva uma unidade antes de chamar a IA. Quem passou do limite não chama.
export async function reserveAi(userId: string, kind: AiKind): Promise<AiReservation> {
  const month = currentMonthParam();
  const limit = aiLimits()[kind];
  const ref = col.doc(docId(userId, month));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = Number(snap.get(field(kind)) ?? 0);
    if (used >= limit) return { allowed: false, used, limit };
    tx.set(ref, { userId, month, [field(kind)]: used + 1, updatedAt: Date.now() }, { merge: true });
    return { allowed: true, used: used + 1, limit };
  });
}

// Ainda tem cota? Sem gastar uma unidade (a abertura do chat usa isto).
export async function hasAiLeft(userId: string, kind: AiKind): Promise<boolean> {
  const snap = await col.doc(docId(userId, currentMonthParam())).get();
  return Number(snap.get(field(kind)) ?? 0) < aiLimits()[kind];
}

// Soma os tokens gastos (pra estimativa de custo no Admin). Falha aqui não
// pode derrubar a resposta.
export async function recordAiTokens(userId: string, tokens: GeminiTokens): Promise<void> {
  if (!tokens.input && !tokens.output) return;
  try {
    await col.doc(docId(userId, currentMonthParam())).set(
      {
        inputTokens: FieldValue.increment(tokens.input),
        outputTokens: FieldValue.increment(tokens.output),
        updatedAt: Date.now(),
      },
      { merge: true }
    );
  } catch {
    // só estatística
  }
}

// Admin: uso de IA no mês (uma leitura por pessoa que usou IA no mês).
export async function getAiUsageSummary(month = currentMonthParam()) {
  const snap = await col.where("month", "==", month).get();
  let messages = 0;
  let imports = 0;
  let input = 0;
  let output = 0;
  let atLimit = 0;
  const limits = aiLimits();
  for (const doc of snap.docs) {
    const d = doc.data();
    messages += Number(d.messages ?? 0);
    imports += Number(d.imports ?? 0);
    input += Number(d.inputTokens ?? 0);
    output += Number(d.outputTokens ?? 0);
    if (Number(d.messages ?? 0) >= limits.message || Number(d.imports ?? 0) >= limits.import) atLimit++;
  }
  const people = snap.size;
  const costBrl = estimateCostBrl({ input, output });
  return {
    month,
    people,
    messages,
    imports,
    atLimit,
    limits,
    tokens: { input, output },
    costBrl: Math.round(costBrl * 100) / 100,
    costPerPersonBrl: people ? Math.round((costBrl / people) * 100) / 100 : 0,
  };
}
