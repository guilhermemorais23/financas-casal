import { db } from "../../db/firestore";
import { memoizeScoped } from "../../utils/readCache";

// "Nome do extrato -> categoria", aprendido nas importações. Uma regra por
// nome, compartilhada pelo grupo (o casal importa o mesmo mercado). Na próxima
// importação esses nomes já chegam respondidos e o PAR. só pergunta os novos.
export interface ImportRule {
  key: string; // nome normalizado (ver normalizeStatementName)
  label: string; // como apareceu no extrato, pra mostrar na lista
  categoryId: string | null;
  // Fatura de cartão, aplicação, transferência entre contas: não entra.
  notExpense: boolean;
  updatedAt: number;
}

const col = db.collection("importRules");

function docId(groupId: string, key: string): string {
  // Firestore não aceita "/" no id; o resto da chave já é só letra/número/espaço.
  return `${groupId}__${key.replace(/\//g, "_")}`.slice(0, 1400);
}

// "PAO DE ACUCAR 1204" e "Pão de Açúcar 0877" viram "pao de acucar": sem
// acento, sem maiúscula, sem pontuação e sem os números da loja/terminal.
export function normalizeStatementName(raw: string): string {
  const base = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const words = base.split(" ").filter((word) => word && !/\d/.test(word));
  return (words.join(" ") || base).slice(0, 120);
}

export function findRulesByGroup(groupId: string): Promise<ImportRule[]> {
  return memoizeScoped(`importRules:${groupId}`, [`group:${groupId}`, "import-rules", "statements"], async () => {
    const snap = await col.where("groupId", "==", groupId).get();
    return snap.docs
      .map((doc) => {
        const d = doc.data();
        return {
          key: d.key as string,
          label: (d.label as string) ?? d.key,
          categoryId: (d.categoryId as string | null) ?? null,
          notExpense: d.notExpense === true,
          updatedAt: (d.updatedAt as number) ?? 0,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  });
}

export async function upsertRules(
  groupId: string,
  userId: string,
  rules: { key: string; label: string; categoryId: string | null; notExpense: boolean }[]
): Promise<void> {
  if (rules.length === 0) return;
  const batch = db.batch();
  const now = Date.now();
  for (const rule of rules) {
    batch.set(col.doc(docId(groupId, rule.key)), { ...rule, groupId, updatedAt: now, updatedBy: userId });
  }
  await batch.commit();
}

export async function deleteRule(groupId: string, key: string): Promise<void> {
  await col.doc(docId(groupId, key)).delete();
}
