import type { Request, Response } from "express";
import {
  AlreadyInGroupError,
  CannotRemoveSelfError,
  InviteExpiredError,
  InviteNotFoundError,
  InviteNotPendingError,
  MemberNotFoundError,
  MAX_GROUPS_PER_USER,
  NoGroupError,
  TooManyGroupsError,
  acceptInvite,
  createGroupForUser,
  createNewInvite,
  getGroupForUser,
  leaveGroup,
  listGroupsForUser,
  removeMemberForUser,
  updateFinancialProfile,
  updateGroupIdentityForUser,
} from "./groups.service";

const TOO_MANY_GROUPS = { error: `Dá pra participar de até ${MAX_GROUPS_PER_USER} grupos.`, code: "too_many_groups" };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function createGroupHandler(req: Request, res: Response) {
  try {
    const { name, emoji } = req.body ?? {};
    const result = await createGroupForUser(req.user!.id, { name, emoji });
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof TooManyGroupsError) {
      res.status(409).json(TOO_MANY_GROUPS);
      return;
    }
    throw err;
  }
}

export async function acceptInviteHandler(req: Request, res: Response) {
  const { token } = req.body ?? {};
  if (!isNonEmptyString(token)) {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    const result = await acceptInvite(req.user!.id, token.trim());
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InviteNotFoundError) {
      res.status(404).json({ error: "invite not found" });
      return;
    }
    if (err instanceof AlreadyInGroupError) {
      res.status(409).json({ error: "Você já está nesse grupo.", code: "already_in_group" });
      return;
    }
    if (err instanceof TooManyGroupsError) {
      res.status(409).json(TOO_MANY_GROUPS);
      return;
    }
    if (err instanceof InviteNotPendingError || err instanceof InviteExpiredError) {
      res.status(409).json({ error: "invite is no longer valid" });
      return;
    }
    throw err;
  }
}

export async function getMyGroupHandler(req: Request, res: Response) {
  const result = await getGroupForUser(req.user!.id);
  if (!result) {
    res.status(404).json({ error: "no group yet" });
    return;
  }
  res.status(200).json(result);
}

export async function listMyGroupsHandler(req: Request, res: Response) {
  res.status(200).json(await listGroupsForUser(req.user!.id));
}

export async function updateGroupIdentityHandler(req: Request, res: Response) {
  const { name, emoji } = req.body ?? {};
  if (name !== undefined && name !== null && typeof name !== "string") {
    res.status(400).json({ error: "O nome do grupo precisa ser um texto." });
    return;
  }
  if (emoji !== undefined && emoji !== null && typeof emoji !== "string") {
    res.status(400).json({ error: "O ícone do grupo precisa ser um texto." });
    return;
  }
  try {
    const group = await updateGroupIdentityForUser(req.user!.id, { name, emoji });
    res.status(200).json(group);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "Você ainda não está num grupo." });
      return;
    }
    throw err;
  }
}

export async function createInviteHandler(req: Request, res: Response) {
  try {
    const inviteToken = await createNewInvite(req.user!.id);
    res.status(201).json({ inviteToken });
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function updateFinancialProfileHandler(req: Request, res: Response) {
  const { financialGoal, savingsAmount } = req.body ?? {};

  const updates: { financialGoal?: string | null; savingsAmount?: number | null } = {};
  if (financialGoal !== undefined) {
    if (financialGoal !== null && typeof financialGoal !== "string") {
      res.status(400).json({ error: "financialGoal must be a string or null" });
      return;
    }
    updates.financialGoal = financialGoal === null || financialGoal.trim() === "" ? null : financialGoal.trim();
  }
  if (savingsAmount !== undefined) {
    if (savingsAmount !== null && (typeof savingsAmount !== "number" || !Number.isFinite(savingsAmount) || savingsAmount < 0)) {
      res.status(400).json({ error: "savingsAmount must be a non-negative number or null" });
      return;
    }
    updates.savingsAmount = savingsAmount;
  }

  try {
    const group = await updateFinancialProfile(req.user!.id, updates);
    res.status(200).json(group);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function leaveGroupHandler(req: Request, res: Response) {
  try {
    await leaveGroup(req.user!.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function removeMemberHandler(req: Request, res: Response) {
  try {
    await removeMemberForUser(req.user!.id, req.params.userId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof MemberNotFoundError) {
      res.status(404).json({ error: "member not found" });
      return;
    }
    if (err instanceof CannotRemoveSelfError) {
      res.status(400).json({ error: "use leave group to remove yourself" });
      return;
    }
    throw err;
  }
}
