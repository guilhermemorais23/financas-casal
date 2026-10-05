import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { db } from "../../db/firestore";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InviteRow {
  token: string;
  groupId: string;
  inviterId: string;
  status: InviteStatus;
  acceptedBy: string | null;
  expiresAt: Date;
}

// Doc ID = the token itself: a second create() with the same token throws
// instead of silently overwriting, which is what SQL's UNIQUE gave us.
const invitesCol = db.collection("invites");

function toInviteRow(token: string, data: FirebaseFirestore.DocumentData): InviteRow {
  return {
    token,
    groupId: data.groupId,
    inviterId: data.inviterId,
    status: data.status,
    acceptedBy: data.acceptedBy ?? null,
    expiresAt: data.expiresAt.toDate(),
  };
}

export async function createInvite(input: {
  groupId: string;
  inviterId: string;
  token: string;
  expiresAt: Date;
}): Promise<InviteRow> {
  await invitesCol.doc(input.token).create({
    groupId: input.groupId,
    inviterId: input.inviterId,
    status: "pending",
    acceptedBy: null,
    expiresAt: Timestamp.fromDate(input.expiresAt),
    createdAt: FieldValue.serverTimestamp(),
    acceptedAt: null,
  });
  return {
    token: input.token,
    groupId: input.groupId,
    inviterId: input.inviterId,
    status: "pending",
    acceptedBy: null,
    expiresAt: input.expiresAt,
  };
}

export async function findPendingInviteByGroupId(groupId: string): Promise<InviteRow | null> {
  const snapshot = await invitesCol
    .where("groupId", "==", groupId)
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return toInviteRow(snapshot.docs[0].id, snapshot.docs[0].data());
}

