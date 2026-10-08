import { requireGroupId } from "../groups/groups.service";
import { findRulesByGroup, normalizeStatementName, upsertRules } from "../statements/importRules.repository";
import { PAYMENT_METHODS, type PaymentMethod } from "./transactions.repository";
import { canManageTransaction, listTransactions, updateTransactionForUser } from "./transactions.service";

// "Sem forma de pagamento": lançamentos do mês sem Pix/Crédito/Débito/Dinheiro,
// agrupados pelo nome, pra marcar vários de uma vez (mesma ideia do "Sem
// categoria"). Só o que a pessoa pode editar e que não é transferência.
export interface NoPaymentGroup {
  key: string;
  label: string;
  transactionType: "expense" | "income";
  count: number;
  total: string;
  transactionIds: string[];
  // Resposta "Sempre assim" guardada na importação, se tiver.
  suggestedPaymentMethod: PaymentMethod | null;
}

export async function listWithoutPaymentMethod(userId: string, month: string): Promise<{ count: number; groups: NoPaymentGroup[] }> {
  const groupId = await requireGroupId(userId);
  const [rows, rules] = await Promise.all([listTransactions(userId, 1000, month), findRulesByGroup(groupId)]);
  const ruleByKey = new Map(rules.filter((r) => r.paymentMethod).map((r) => [r.key, r.paymentMethod]));
  const byKey = new Map<string, { label: string; type: "expense" | "income"; cents: number; ids: string[] }>();
  for (const tx of rows) {
    if (tx.paymentMethod || tx.securedCardId || tx.loanId || tx.transferKind) continue;
    if (!canManageTransaction(userId, tx)) continue;
    const name = normalizeStatementName(tx.description) || tx.description.toLowerCase();
    const id = `${tx.transactionType}:${name}`;
    const entry = byKey.get(id) ?? { label: tx.description, type: tx.transactionType, cents: 0, ids: [] };
    entry.cents += Math.round(Number(tx.amount) * 100);
    entry.ids.push(tx.id);
    byKey.set(id, entry);
  }
  const groups = [...byKey.entries()]
    .map(([id, e]) => {
      const key = id.slice(id.indexOf(":") + 1);
      return {
        key,
        label: e.label,
        transactionType: e.type,
        count: e.ids.length,
        total: (e.cents / 100).toFixed(2),
        transactionIds: e.ids,
        suggestedPaymentMethod: ruleByKey.get(key) ?? null,
      };
    })
    .sort((a, b) => Number(b.total) - Number(a.total));
  return { count: groups.reduce((sum, g) => sum + g.count, 0), groups };
}

export class InvalidPaymentUpdateError extends Error {}

// Marca a forma de pagamento em vários lançamentos (um nome) e, com
// "Sempre assim", lembra pra próxima importação. Lançamento que a pessoa não
// pode editar é pulado.
export async function setPaymentMethods(
  userId: string,
  input: { transactionIds?: unknown; paymentMethod?: unknown; remember?: unknown; label?: unknown }
): Promise<{ updated: number }> {
  const ids = Array.isArray(input.transactionIds)
    ? input.transactionIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  if (ids.length === 0 || ids.length > 300 || !PAYMENT_METHODS.includes(input.paymentMethod as PaymentMethod)) {
    throw new InvalidPaymentUpdateError();
  }
  const paymentMethod = input.paymentMethod as PaymentMethod;
  const groupId = await requireGroupId(userId);
  const unique = [...new Set(ids)];
  let updated = 0;
  for (let start = 0; start < unique.length; start += 20) {
    const results = await Promise.allSettled(
      unique.slice(start, start + 20).map((id) => updateTransactionForUser(userId, id, { paymentMethod }))
    );
    updated += results.filter((result) => result.status === "fulfilled").length;
  }
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 120) : "";
  if (input.remember === true && label && updated > 0) {
    const key = normalizeStatementName(label);
    // Mantém a categoria/"não é gasto" que a regra já tinha.
    const existing = (await findRulesByGroup(groupId)).find((rule) => rule.key === key);
    await upsertRules(groupId, userId, [
      { key, label: existing?.label ?? label, categoryId: existing?.categoryId ?? null, notExpense: existing?.notExpense ?? false, paymentMethod },
    ]);
  }
  return { updated };
}
