import { requireGroupId } from "../groups/groups.service";
import { findRulesByGroup, normalizeStatementName, upsertRules } from "../statements/importRules.repository";
import { InvalidCategoryError, canManageTransaction, listTransactions, updateTransactionForUser } from "./transactions.service";

// "Sem categoria": gastos do mês sem categoria, agrupados pelo nome (como na
// importação), pra pessoa dizer o que é cada nome uma vez só. Só entra o que
// ela pode editar (conta conjunta ou lançado por ela) e não é transferência
// de cartão garantido/empréstimo.
export interface UncategorizedGroup {
  key: string;
  label: string;
  count: number;
  total: string;
  transactionIds: string[];
  // Resposta guardada de uma importação, se tiver.
  suggestedCategoryId: string | null;
}

export async function listUncategorized(userId: string, month: string): Promise<{ count: number; groups: UncategorizedGroup[] }> {
  const groupId = await requireGroupId(userId);
  const [rows, rules] = await Promise.all([listTransactions(userId, 1000, month), findRulesByGroup(groupId)]);
  const ruleByKey = new Map(rules.filter((r) => r.categoryId).map((r) => [r.key, r.categoryId]));
  const byKey = new Map<string, { label: string; cents: number; ids: string[] }>();
  for (const tx of rows) {
    if (tx.transactionType !== "expense" || tx.categoryId || tx.securedCardId || tx.loanId) continue;
    if (!canManageTransaction(userId, tx)) continue;
    const key = normalizeStatementName(tx.description) || tx.description.toLowerCase();
    const entry = byKey.get(key) ?? { label: tx.description, cents: 0, ids: [] };
    entry.cents += Math.round(Number(tx.amount) * 100);
    entry.ids.push(tx.id);
    byKey.set(key, entry);
  }
  const groups = [...byKey.entries()]
    .map(([key, e]) => ({
      key,
      label: e.label,
      count: e.ids.length,
      total: (e.cents / 100).toFixed(2),
      transactionIds: e.ids,
      suggestedCategoryId: ruleByKey.get(key) ?? null,
    }))
    .sort((a, b) => Number(b.total) - Number(a.total));
  return { count: groups.reduce((sum, g) => sum + g.count, 0), groups };
}

export class InvalidCategorizeError extends Error {}

// Põe a categoria em vários lançamentos (um nome) e, se pedir, lembra pra
// próxima importação. Lançamento que a pessoa não pode editar é pulado.
export async function categorizeTransactions(
  userId: string,
  input: { transactionIds?: unknown; categoryId?: unknown; remember?: unknown; label?: unknown }
): Promise<{ updated: number }> {
  const ids = Array.isArray(input.transactionIds) ? input.transactionIds.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
  if (ids.length === 0 || ids.length > 300 || typeof input.categoryId !== "string" || !input.categoryId) {
    throw new InvalidCategorizeError();
  }
  const groupId = await requireGroupId(userId);
  let updated = 0;
  for (const id of [...new Set(ids)]) {
    try {
      await updateTransactionForUser(userId, id, { categoryId: input.categoryId });
      updated++;
    } catch (err) {
      // Categoria que o grupo não vê: pára tudo (é erro de quem chamou).
      if (err instanceof InvalidCategoryError) throw new InvalidCategorizeError();
    }
  }
  const label = typeof input.label === "string" ? input.label.trim().slice(0, 120) : "";
  if (input.remember === true && label && updated > 0) {
    await upsertRules(groupId, userId, [{ key: normalizeStatementName(label), label, categoryId: input.categoryId, notExpense: false }]);
  }
  return { updated };
}
