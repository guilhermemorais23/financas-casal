import { isAdminEmail } from "../admin/admin.service";
import { requireGroupId } from "../groups/groups.service";
import { previewBankRows } from "../statements/statements.service";
import type { ParsedStatementRow } from "../../utils/statementParser";
import { pluggy, pluggyConfigured, type PluggyAccount, type PluggyTransaction } from "../../utils/pluggy";
import { deleteItem, findItem, findItemsByUser, markSynced, saveItem } from "./openFinance.repository";

export class OpenFinanceUnavailableError extends Error {}
export class OpenFinanceItemNotFoundError extends Error {}
export class OpenFinanceNotYoursError extends Error {}

// Plano grátis do Pluggy é pra uso pessoal: por enquanto só quem está em
// PLUGGY_ALLOWED_EMAILS (ou, sem ela, os admins) vê o "Conectar conta".
export function canUseOpenFinance(email: string): boolean {
  if (!pluggyConfigured()) return false;
  const allowed = (process.env.PLUGGY_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.length > 0 ? allowed.includes(email.trim().toLowerCase()) : isAdminEmail(email);
}

function requireAccess(email: string) {
  if (!canUseOpenFinance(email)) throw new OpenFinanceUnavailableError();
}

async function requireOwnItem(userId: string, itemId: string) {
  const item = await findItem(itemId);
  if (!item || item.userId !== userId) throw new OpenFinanceItemNotFoundError();
  return item;
}

const accountLabel = (a: PluggyAccount) =>
  `${a.marketingName || a.name}${a.type === "CREDIT" ? " (cartão)" : ""}${a.number ? ` · ${a.number.slice(-4)}` : ""}`;

export async function getOpenFinanceStatus(userId: string, email: string) {
  const configured = pluggyConfigured();
  const allowed = canUseOpenFinance(email);
  if (!allowed) return { configured, allowed, items: [] };
  const items = await findItemsByUser(userId);
  const detailed = await Promise.all(
    items.map(async (item) => {
      try {
        const [live, accounts] = await Promise.all([pluggy.getItem(item.itemId), pluggy.listAccounts(item.itemId)]);
        return {
          itemId: item.itemId,
          connectorName: live.connector?.name ?? item.connectorName,
          status: live.status,
          accounts: accounts.map((a) => ({ id: a.id, label: accountLabel(a), type: a.type, syncedUntil: item.syncedUntil?.[a.id] ?? null })),
        };
      } catch {
        return { itemId: item.itemId, connectorName: item.connectorName, status: "UNAVAILABLE", accounts: [] };
      }
    })
  );
  return { configured, allowed, items: detailed };
}

export async function createConnectToken(userId: string, email: string, itemId?: string) {
  requireAccess(email);
  if (itemId) await requireOwnItem(userId, itemId);
  return { accessToken: await pluggy.createConnectToken(userId, itemId) };
}

// Depois da janela do Pluggy: guarda a conexão. Confere no Pluggy que ela foi
// criada com o token DESTA pessoa (clientUserId), senão alguém poderia
// registrar a conexão bancária de outra pessoa.
export async function registerItem(userId: string, email: string, itemId: string) {
  requireAccess(email);
  if (typeof itemId !== "string" || !itemId.trim() || itemId.includes("/")) throw new OpenFinanceItemNotFoundError();
  const live = await pluggy.getItem(itemId);
  if (live.clientUserId !== userId) throw new OpenFinanceNotYoursError();
  const existing = await findItem(itemId);
  if (existing && existing.userId !== userId) throw new OpenFinanceNotYoursError();
  await saveItem({
    itemId,
    userId,
    groupId: await requireGroupId(userId),
    connectorName: live.connector?.name ?? "Banco",
    createdAt: existing?.createdAt ?? Date.now(),
    syncedUntil: existing?.syncedUntil ?? {},
  });
  return { itemId, connectorName: live.connector?.name ?? "Banco" };
}

const DEFAULT_DAYS = 60;
const OVERLAP_DAYS = 3; // o banco às vezes lança com atraso; os repetidos o app já marca

function daysAgo(n: number, from = new Date()): string {
  return new Date(from.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

// Data no fuso do Brasil (a API manda em UTC, 03:00Z = meia-noite aqui).
function brazilDate(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Transação do Pluggy -> linha da importação. DEBIT = saiu, CREDIT = entrou.
// Nome: loja ou pessoa do Pix quando o banco manda; o texto do banco vira o
// tipo. No cartão de crédito, crédito é pagamento da fatura/estorno: fica de
// fora (o pagamento já aparece como saída na conta corrente).
export function toStatementRows(transactions: PluggyTransaction[], account: Pick<PluggyAccount, "type">): ParsedStatementRow[] {
  const rows: ParsedStatementRow[] = [];
  for (const tx of transactions) {
    if (tx.status === "PENDING") continue;
    if (account.type === "CREDIT" && tx.type === "CREDIT") continue;
    const cents = Math.round(Math.abs(tx.amount) * 100);
    if (!cents) continue;
    const counterpart = tx.type === "DEBIT" ? tx.paymentData?.receiver?.name : tx.paymentData?.payer?.name;
    const name = (tx.merchant?.name || counterpart || "").trim();
    const bankText = (tx.description || tx.descriptionRaw || "").trim();
    rows.push({
      date: brazilDate(tx.date),
      description: name || bankText || "Lançamento do banco",
      kind: name && bankText && name.toLowerCase() !== bankText.toLowerCase() ? bankText : null,
      amountCents: tx.type === "DEBIT" ? -cents : cents,
      externalId: tx.id,
    });
  }
  return rows;
}

export async function previewFromBank(userId: string, email: string, itemId: string, accountId: string) {
  requireAccess(email);
  const item = await requireOwnItem(userId, itemId);
  const accounts = await pluggy.listAccounts(itemId);
  const account = accounts.find((a) => a.id === accountId);
  if (!account) throw new OpenFinanceItemNotFoundError();
  const synced = item.syncedUntil?.[accountId];
  const dateFrom = synced ? daysAgo(OVERLAP_DAYS, new Date(`${synced}T12:00:00Z`)) : daysAgo(DEFAULT_DAYS);
  const transactions = await pluggy.listTransactions(accountId, dateFrom);
  const preview = await previewBankRows(userId, toStatementRows(transactions, account));
  return { ...preview, source: { itemId, accountId, label: accountLabel(account), from: dateFrom, until: daysAgo(0) } };
}

export async function markBankSynced(userId: string, email: string, itemId: string, accountId: string, until: string) {
  requireAccess(email);
  await requireOwnItem(userId, itemId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new OpenFinanceItemNotFoundError();
  await markSynced(itemId, accountId, until);
}

export async function removeBankConnection(userId: string, email: string, itemId: string) {
  requireAccess(email);
  await requireOwnItem(userId, itemId);
  try {
    await pluggy.deleteItem(itemId);
  } catch {
    // já apagado no Pluggy: segue e apaga aqui
  }
  await deleteItem(itemId);
}
