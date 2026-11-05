import { auth, db } from "../../db/firestore";
import { findMembersByGroupId } from "../groups/groups.repository";
import { invalidateTransactionReads } from "../../utils/readCache";
import { pluggy, pluggyConfigured } from "../../utils/pluggy";
import { findItemsByUser } from "../openFinance/openFinance.repository";
import { findUserById } from "./users.repository";

// Coleções cujos documentos pertencem ao grupo inteiro (campo groupId).
// Quando o último membro exclui a conta, não sobra ninguém pra ver nada
// disso, então vai tudo -- a App Store e a LGPD exigem que "excluir conta"
// apague os dados de verdade, e não só esconda.
const GROUP_COLLECTIONS = [
  "transactions",
  "cards",
  "accounts",
  "budgets",
  "debts",
  "goals",
  "recurringBills",
  "shoppingItems",
  "invites",
  "categories",
  "loans",
  "importRules",
] as const;

async function deleteDocs(query: FirebaseFirestore.Query): Promise<void> {
  const snapshot = await query.get();
  // O recursiveDelete também leva as subcoleções (divisões, compras, faturas,
  // parcelas), que um delete simples deixaria órfãs.
  await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
}

async function deleteWholeGroup(groupId: string): Promise<void> {
  await Promise.all(
    GROUP_COLLECTIONS.map((name) => deleteDocs(db.collection(name).where("groupId", "==", groupId)))
  );
  // A assinatura usa o id do grupo como id do documento.
  await db.collection("subscriptions").doc(groupId).delete();
  await db.recursiveDelete(db.collection("groups").doc(groupId));
}

// Conexões com o banco: desfaz no Pluggy também, senão ele seguiria lendo o
// banco e mandando avisos de quem já saiu. Se o Pluggy falhar (ou já tiver
// apagado), segue -- o que não pode é a exclusão da conta travar.
async function disconnectBanks(userId: string): Promise<void> {
  const items = await findItemsByUser(userId);
  if (pluggyConfigured()) {
    await Promise.all(items.map((item) => pluggy.deleteItem(item.itemId).catch(() => undefined)));
  }
  await deleteDocs(db.collection("openFinanceItems").where("userId", "==", userId));
}

// Ainda tem alguém no grupo: os dados conjuntos (Nossa Conta, cartões do
// grupo, metas...) são dessa pessoa também e ficam. O que vai embora é tudo
// que só quem está saindo podia ver -- a conta pessoal e o que foi lançado
// nela, os cartões e as dívidas pessoais.
async function deletePersonalData(groupId: string, userId: string): Promise<void> {
  await Promise.all([
    deleteDocs(db.collection("transactions").where("groupId", "==", groupId).where("accountOwnerId", "==", userId)),
    deleteDocs(db.collection("recurringBills").where("groupId", "==", groupId).where("accountOwnerId", "==", userId)),
    deleteDocs(db.collection("accounts").where("groupId", "==", groupId).where("ownerUserId", "==", userId)),
    deleteDocs(db.collection("cards").where("groupId", "==", groupId).where("ownerUserId", "==", userId)),
    deleteDocs(db.collection("debts").where("groupId", "==", groupId).where("ownerUserId", "==", userId)),
    deleteDocs(db.collection("loans").where("groupId", "==", groupId).where("ownerUserId", "==", userId)),
  ]);
}

export async function deleteAccountForUser(userId: string): Promise<void> {
  const user = await findUserById(userId);

  // Cada grupo da pessoa (casal, família...) segue a mesma regra: sozinha
  // nele, apaga tudo; com mais gente, só o que era dela.
  for (const groupId of user?.groupIds ?? []) {
    const members = await findMembersByGroupId(groupId);
    if (members.every((member) => member.id === userId)) {
      await deleteWholeGroup(groupId);
    } else {
      await deletePersonalData(groupId, userId);
    }
  }
  if (user?.groupIds.length) invalidateTransactionReads();

  await Promise.all([
    disconnectBanks(userId),
    deleteDocs(db.collection("pushSubscriptions").where("userId", "==", userId)),
    deleteDocs(db.collection("shares").where("ownerId", "==", userId)),
    deleteDocs(db.collection("telegramLinks").where("userId", "==", userId)),
    deleteDocs(db.collection("whatsappLinks").where("userId", "==", userId)),
    deleteDocs(db.collection("telegramLinkCodes").where("userId", "==", userId)),
    deleteDocs(db.collection("accessLogs").where("userId", "==", userId)),
    deleteDocs(db.collection("feedbackThreads").where("userId", "==", userId)),
  ]);
  await db.recursiveDelete(db.collection("users").doc(userId));

  try {
    await auth.deleteUser(userId);
  } catch (err) {
    // Já não existe mais no Firebase Auth (nova tentativa depois de uma falha no
    // meio do caminho) -- o que importava eram os dados acima.
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
  }
}
