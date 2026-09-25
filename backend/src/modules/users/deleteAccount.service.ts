import { auth, db } from "../../db/firestore";
import { findMembersByGroupId } from "../groups/groups.repository";
import { invalidateTransactionReads } from "../../utils/readCache";
import { findUserById } from "./users.repository";

// Collections whose docs belong to a whole group (groupId field). When the
// last member deletes their account there's nobody left to see any of it,
// so all of it goes -- the App Store and the LGPD both require that
// "excluir conta" actually erases the data, not just hides it.
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
] as const;

async function deleteDocs(query: FirebaseFirestore.Query): Promise<void> {
  const snapshot = await query.get();
  // recursiveDelete also takes the subcollections (splits, purchases,
  // statements, installments) that a plain delete would leave orphaned.
  await Promise.all(snapshot.docs.map((doc) => db.recursiveDelete(doc.ref)));
}

async function deleteWholeGroup(groupId: string): Promise<void> {
  await Promise.all(
    GROUP_COLLECTIONS.map((name) => deleteDocs(db.collection(name).where("groupId", "==", groupId)))
  );
  await db.recursiveDelete(db.collection("groups").doc(groupId));
}

// Someone else is still in the group: joint data (Nossa Conta, cartões do
// grupo, metas...) is theirs too and stays. What goes is everything that
// only this person could see -- their personal account and whatever was
// booked on it, their personal cards and debts.
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
  const groupId = user?.groupId ?? null;

  if (groupId) {
    const members = await findMembersByGroupId(groupId);
    if (members.every((member) => member.id === userId)) {
      await deleteWholeGroup(groupId);
    } else {
      await deletePersonalData(groupId, userId);
    }
    invalidateTransactionReads();
  }

  await Promise.all([
    deleteDocs(db.collection("shares").where("ownerId", "==", userId)),
    deleteDocs(db.collection("telegramLinks").where("userId", "==", userId)),
    deleteDocs(db.collection("whatsappLinks").where("userId", "==", userId)),
    deleteDocs(db.collection("telegramLinkCodes").where("userId", "==", userId)),
    deleteDocs(db.collection("accessLogs").where("userId", "==", userId)),
  ]);
  await db.recursiveDelete(db.collection("users").doc(userId));

  try {
    await auth.deleteUser(userId);
  } catch (err) {
    // Already gone from Firebase Auth (a retry after a partial failure) --
    // the data above is what mattered.
    if ((err as { code?: string }).code !== "auth/user-not-found") throw err;
  }
}
