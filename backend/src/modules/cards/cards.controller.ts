import type { Request, Response } from "express";
import { isValidMonthParam } from "../../utils/month";
import { NoGroupError } from "../groups/groups.service";
import {
  ALLOWED_INSTALLMENT_COUNTS,
  CardNotFoundError,
  ForbiddenError,
  InvalidBuyerError,
  InvalidCategoryError,
  InvalidInstallmentsError,
  InvalidLimitError,
  PurchaseNotFoundError,
  StatementAlreadyPaidError,
  addPurchase,
  createCard,
  getStatement,
  listCards,
  removeCard,
  removePurchase,
  setStatementPaidForUser,
  updateCardForUser,
  type CardScope,
} from "./cards.service";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidDay(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 31;
}

// limit is opt-in on purpose -- undefined/null both mean "no limit set",
// only a positive number is accepted otherwise.
function isValidLimit(value: unknown): value is number | null {
  return value === null || value === undefined || (typeof value === "number" && value > 0);
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(value).getTime());
}

export async function createCardHandler(req: Request, res: Response) {
  const { name, closingDay, dueDay, scope, limit } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    !isValidDay(closingDay) ||
    !isValidDay(dueDay) ||
    (scope !== undefined && scope !== "personal" && scope !== "joint") ||
    !isValidLimit(limit)
  ) {
    res.status(400).json({
      error: "name, closingDay (1-31) and dueDay (1-31) are required; limit (if set) must be a positive number",
    });
    return;
  }

  try {
    const card = await createCard(req.user!.id, {
      name: name.trim(),
      closingDay,
      dueDay,
      scope: (scope as CardScope) ?? "joint",
      limit: limit ?? null,
    });
    res.status(201).json(card);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    if (err instanceof InvalidLimitError) {
      res.status(400).json({ error: "invalid limit" });
      return;
    }
    throw err;
  }
}

export async function listCardsHandler(req: Request, res: Response) {
  try {
    const cards = await listCards(req.user!.id);
    res.status(200).json(cards);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function updateCardHandler(req: Request, res: Response) {
  const { name, closingDay, dueDay, limit } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    !isValidDay(closingDay) ||
    !isValidDay(dueDay) ||
    (limit !== undefined && !isValidLimit(limit))
  ) {
    res.status(400).json({
      error: "name, closingDay (1-31) and dueDay (1-31) are required; limit (if set) must be a positive number",
    });
    return;
  }

  try {
    const card = await updateCardForUser(req.user!.id, req.params.id, {
      name: name.trim(),
      closingDay,
      dueDay,
      limit: limit !== undefined ? limit : undefined,
    });
    res.status(200).json(card);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
      res.status(404).json({ error: "card not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this card" });
      return;
    }
    if (err instanceof InvalidLimitError) {
      res.status(400).json({ error: "invalid limit" });
      return;
    }
    throw err;
  }
}

export async function deleteCardHandler(req: Request, res: Response) {
  try {
    await removeCard(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
      res.status(404).json({ error: "card not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this card" });
      return;
    }
    throw err;
  }
}

export async function getStatementHandler(req: Request, res: Response) {
  const month = typeof req.query.month === "string" ? req.query.month : undefined;
  if (month !== undefined && !isValidMonthParam(month)) {
    res.status(400).json({ error: "invalid month" });
    return;
  }

  try {
    const statement = await getStatement(req.user!.id, req.params.id, month);
    res.status(200).json(statement);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
      res.status(404).json({ error: "card not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to view this card" });
      return;
    }
    throw err;
  }
}

export async function addPurchaseHandler(req: Request, res: Response) {
  const { description, amount, categoryId, buyerId, purchaseDate, installments } = req.body ?? {};

  if (
    !isNonEmptyString(description) ||
    typeof amount !== "number" ||
    amount <= 0 ||
    !isNonEmptyString(buyerId) ||
    !isValidDate(purchaseDate) ||
    (installments !== undefined && !ALLOWED_INSTALLMENT_COUNTS.includes(installments))
  ) {
    res.status(400).json({
      error: `description, amount, buyerId and purchaseDate (YYYY-MM-DD) are required; installments (if set) must be one of ${ALLOWED_INSTALLMENT_COUNTS.join(", ")}`,
    });
    return;
  }

  try {
    const purchases = await addPurchase(req.user!.id, req.params.id, {
      description: description.trim(),
      amount,
      categoryId: isNonEmptyString(categoryId) ? categoryId : null,
      buyerId,
      purchaseDate,
      installments: installments ?? 1,
    });
    res.status(201).json(purchases);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
      res.status(404).json({ error: "card not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this card" });
      return;
    }
    if (err instanceof InvalidBuyerError || err instanceof InvalidCategoryError || err instanceof InvalidInstallmentsError) {
      res.status(400).json({ error: err.constructor.name });
      return;
    }
    if (err instanceof StatementAlreadyPaidError) {
      res.status(409).json({ error: "statement already paid" });
      return;
    }
    throw err;
  }
}

export async function deletePurchaseHandler(req: Request, res: Response) {
  try {
    await removePurchase(req.user!.id, req.params.id, req.params.purchaseId);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError || err instanceof PurchaseNotFoundError) {
      res.status(404).json({ error: "card or purchase not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this card" });
      return;
    }
    if (err instanceof StatementAlreadyPaidError) {
      res.status(409).json({ error: "statement already paid" });
      return;
    }
    throw err;
  }
}

export async function setStatementPaidHandler(req: Request, res: Response) {
  const { isPaid } = req.body ?? {};
  if (typeof isPaid !== "boolean") {
    res.status(400).json({ error: "isPaid (boolean) is required" });
    return;
  }
  if (!isValidMonthParam(req.params.month)) {
    res.status(400).json({ error: "invalid month" });
    return;
  }

  try {
    const statement = await setStatementPaidForUser(req.user!.id, req.params.id, req.params.month, isPaid);
    res.status(200).json(statement);
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
      res.status(404).json({ error: "card not found" });
      return;
    }
    if (err instanceof ForbiddenError) {
      res.status(403).json({ error: "not allowed to manage this card" });
      return;
    }
    if (err instanceof PurchaseNotFoundError) {
      res.status(400).json({ error: "no purchases in this statement yet" });
      return;
    }
    throw err;
  }
}
