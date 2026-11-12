// ============================================================================
// "Primeiros passos" do Painel
// ============================================================================
// Um cartão com 3 passos pra quem acabou de chegar entender o app fazendo:
// lançar um gasto, chamar o par, dividir uma conta (ou, pra quem usa
// sozinho: lançar, definir um orçamento, criar uma meta). Cada passo fica
// feito sozinho, olhando o que já existe no grupo -- ninguém marca à mão.
// Some quando a pessoa fecha, ou 3 dias depois de tudo pronto (dá tempo de
// ver o "parabéns", sem ficar ocupando o Painel pra sempre).
// ============================================================================
import { db } from "../../db/firestore";
import { parseMonthRange } from "../../utils/month";
import { findCategoryBudgets, findGroupBudget } from "../budgets/budgets.repository";
import { findVisibleCategories } from "../categories/categories.repository";
import { findMembersByGroupId } from "../groups/groups.repository";
import { findActiveGroupId } from "../groups/groups.service";
import { findUserById, saveChecklistCompletedAt } from "../users/users.repository";

export type StepId = "first_transaction" | "invite_partner" | "first_split" | "set_budget" | "first_goal";

export interface Checklist {
  steps: { id: StepId; done: boolean }[];
  completedAt: string | null;
}

// Depois de tudo feito, o cartão ainda fica esse tempo no Painel.
const SHOW_AFTER_DONE_MS = 3 * 24 * 60 * 60 * 1000;

const SOLO_STEPS: StepId[] = ["first_transaction", "set_budget", "first_goal"];
const SHARED_STEPS: StepId[] = ["first_transaction", "invite_partner", "first_split"];

const transactionsCol = db.collection("transactions");

// Só precisa saber se existe: limit(1) e select() sem campos -- uma leitura
// de documento no máximo, nunca a coleção inteira. Todas as consultas aqui
// são só de igualdade, que o Firestore atende sem índice composto.
async function exists(query: FirebaseFirestore.Query): Promise<boolean> {
  const snapshot = await query.select().limit(1).get();
  return !snapshot.empty;
}

// Mesma visibilidade do extrato: conta conjunta (sem os privados dos
// outros) e a conta pessoal da própria pessoa.
async function hasVisibleTransaction(groupId: string, userId: string): Promise<boolean> {
  const inGroup = transactionsCol.where("groupId", "==", groupId);
  const found = await Promise.all([
    exists(inGroup.where("accountOwnerId", "==", userId)),
    exists(inGroup.where("accountType", "==", "joint").where("isPrivate", "==", false)),
    exists(inGroup.where("accountType", "==", "joint").where("createdBy", "==", userId)),
  ]);
  return found.some(Boolean);
}

// Orçamento do mês de hoje: o teto geral (documento de id fixo) ou um teto
// de alguma categoria de gasto (também id fixo, um get por categoria -- o
// mesmo jeito do budgets.repository, sem índice composto).
async function hasBudget(groupId: string): Promise<boolean> {
  const { periodMonth } = parseMonthRange();
  if (await findGroupBudget(groupId, periodMonth)) return true;
  const categories = await findVisibleCategories(groupId);
  const expenseIds = categories.filter((category) => category.type === "expense").map((category) => category.id);
  const capped = await findCategoryBudgets(groupId, periodMonth, expenseIds);
  return capped.size > 0;
}

async function isStepDone(step: StepId, groupId: string, userId: string): Promise<boolean> {
  switch (step) {
    case "first_transaction":
      return hasVisibleTransaction(groupId, userId);
    case "invite_partner":
      return (await findMembersByGroupId(groupId)).length >= 2;
    case "first_split":
      return exists(transactionsCol.where("groupId", "==", groupId).where("splitType", "==", "equal"));
    case "set_budget":
      return hasBudget(groupId);
    case "first_goal":
      return exists(db.collection("goals").where("groupId", "==", groupId));
  }
}

// null = não mostrar o cartão (fechado, tudo pronto há mais de 3 dias, ou
// sem grupo ainda).
export async function getChecklistForUser(userId: string, now: Date = new Date()): Promise<Checklist | null> {
  const user = await findUserById(userId);
  if (!user || user.checklistDismissed) return null;
  if (user.checklistCompletedAt && now.getTime() - Date.parse(user.checklistCompletedAt) > SHOW_AFTER_DONE_MS) {
    return null;
  }
  const groupId = await findActiveGroupId(userId);
  if (!groupId) return null;

  const ids = user.preferences?.usage === "solo" ? SOLO_STEPS : SHARED_STEPS;
  const done = await Promise.all(ids.map((id) => isStepDone(id, groupId, userId)));
  const steps = ids.map((id, index) => ({ id, done: done[index] }));

  let completedAt = user.checklistCompletedAt;
  if (!completedAt && steps.every((step) => step.done)) {
    completedAt = await saveChecklistCompletedAt(userId, now.toISOString());
  }
  return { steps, completedAt };
}
