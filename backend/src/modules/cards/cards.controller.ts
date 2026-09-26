import type { Request, Response } from "express";
import { isValidMonthParam } from "../../utils/month";
import { NoGroupError } from "../groups/groups.service";
import {
  ALLOWED_INSTALLMENT_COUNTS,
  CardNotFoundError,
  ForbiddenError,
  InvalidBuyerError,
  InvalidCategoryError,
  InsufficientAvailableLimitError,
  InvalidSavingsPlanError,
  TransactionNotMovableError,
  InvalidInstallmentsError,
  InvalidLimitError,
  NotSecuredCardError,
  PurchaseNotFoundError,
  StatementAlreadyPaidError,
  addPurchase,
  adjustSecuredLimit,
  getCreditCardPreferenceForUser,
  moveTransactionToCard,
  setCreditCardPreferenceForUser,
  setSavingsPlanForUser,
  updatePurchase,
  createCard,
  getStatement,
  listCards,
  removeCard,
  removePurchase,
  setSecuredSourceForUser,
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
  const { name, closingDay, dueDay, scope, limit, limitType, securedFromAccount } = req.body ?? {};

  if (
    !isNonEmptyString(name) ||
    !isValidDay(closingDay) ||
    !isValidDay(dueDay) ||
    (scope !== undefined && scope !== "personal" && scope !== "joint") ||
    !isValidLimit(limit) ||
    (limitType !== undefined && limitType !== "normal" && limitType !== "secured") ||
    (securedFromAccount !== undefined && typeof securedFromAccount !== "boolean")
  ) {
    res.status(400).json({
      error:
        "name, closingDay (1-31) and dueDay (1-31) are required; limit (if set) must be a positive number; limitType must be normal or secured",
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
      limitType: limitType ?? "normal",
      securedFromAccount: securedFromAccount ?? true,
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
    if (err instanceof NotSecuredCardError) {
      res.status(400).json({ error: "a secured card's limit only changes by depositing or withdrawing" });
      return;
    }
    throw err;
  }
}

export async function setSecuredSourceHandler(req: Request, res: Response) {
  const { fromAccount } = req.body ?? {};
  if (typeof fromAccount !== "boolean") {
    res.status(400).json({ error: "fromAccount (boolean) is required" });
    return;
  }

  try {
    const card = await setSecuredSourceForUser(req.user!.id, req.params.id, fromAccount);
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
    if (err instanceof NotSecuredCardError) {
      res.status(400).json({ error: "this card doesn't have a secured limit" });
      return;
    }
    throw err;
  }
}

export async function adjustSecuredLimitHandler(req: Request, res: Response) {
  const { direction, amount } = req.body ?? {};
  if ((direction !== "deposit" && direction !== "withdraw") || typeof amount !== "number" || !(amount > 0)) {
    res.status(400).json({ error: "direction (deposit | withdraw) and a positive amount are required" });
    return;
  }

  try {
    const card = await adjustSecuredLimit(req.user!.id, req.params.id, { direction, amount });
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
    if (err instanceof NotSecuredCardError) {
      res.status(400).json({ error: "this card doesn't have a secured limit" });
      return;
    }
    if (err instanceof InvalidLimitError) {
      res.status(400).json({ error: "invalid amount" });
      return;
    }
    if (err instanceof InsufficientAvailableLimitError) {
      res.status(409).json({ error: "Não dá pra resgatar mais do que está disponível agora." });
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

function purchaseErrorResponse(err: unknown, res: Response): boolean {
  if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
    res.status(404).json({ error: "card not found" });
    return true;
  }
  if (err instanceof PurchaseNotFoundError) {
    res.status(404).json({ error: "purchase not found" });
    return true;
  }
  if (err instanceof ForbiddenError) {
    res.status(403).json({ error: "not allowed to manage this card" });
    return true;
  }
  if (err instanceof InvalidBuyerError || err instanceof InvalidCategoryError || err instanceof InvalidInstallmentsError) {
    res.status(400).json({ error: err.constructor.name });
    return true;
  }
  if (err instanceof StatementAlreadyPaidError) {
    res.status(409).json({ error: "Uma fatura dessa compra já foi paga. Dá pra mudar só nome, categoria e quem comprou." });
    return true;
  }
  return false;
}

export async function updatePurchaseHandler(req: Request, res: Response) {
  const { description, amount, categoryId, buyerId, purchaseDate, installments } = req.body ?? {};
  if (
    !isNonEmptyString(description) ||
    typeof amount !== "number" ||
    amount <= 0 ||
    !isNonEmptyString(buyerId) ||
    !isValidDate(purchaseDate) ||
    (installments !== undefined && !ALLOWED_INSTALLMENT_COUNTS.includes(installments))
  ) {
    res.status(400).json({ error: "description, amount, buyerId and purchaseDate (YYYY-MM-DD) are required" });
    return;
  }
  try {
    const purchases = await updatePurchase(req.user!.id, req.params.id, req.params.purchaseId, {
      description: description.trim(),
      amount,
      categoryId: isNonEmptyString(categoryId) ? categoryId : null,
      buyerId,
      purchaseDate,
      installments: installments ?? 1,
    });
    res.status(200).json(purchases);
  } catch (err) {
    if (purchaseErrorResponse(err, res)) return;
    throw err;
  }
}

export async function moveTransactionToCardHandler(req: Request, res: Response) {
  const { transactionId, installments } = req.body ?? {};
  if (!isNonEmptyString(transactionId) || (installments !== undefined && !ALLOWED_INSTALLMENT_COUNTS.includes(installments))) {
    res.status(400).json({ error: "transactionId is required; installments must be an allowed count" });
    return;
  }
  try {
    const purchases = await moveTransactionToCard(req.user!.id, req.params.id, { transactionId, installments: installments ?? 1 });
    res.status(201).json(purchases);
  } catch (err) {
    if (err instanceof TransactionNotMovableError) {
      const messages: Record<string, string> = {
        not_found: "Lançamento não encontrado.",
        not_expense: "Só despesas comuns podem ir pro cartão.",
        settled: "Essa despesa dividida já foi acertada. Reabra o acerto antes de mover.",
      };
      res.status(err.message === "not_found" ? 404 : 409).json({ error: messages[err.message] ?? "Não dá pra mover esse lançamento." });
      return;
    }
    if (purchaseErrorResponse(err, res)) return;
    throw err;
  }
}

export async function getCreditCardPreferenceHandler(req: Request, res: Response) {
  try {
    res.status(200).json({ value: await getCreditCardPreferenceForUser(req.user!.id) });
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(200).json({ value: null });
      return;
    }
    throw err;
  }
}

export async function setCreditCardPreferenceHandler(req: Request, res: Response) {
  const { value } = req.body ?? {};
  if (value !== null && !isNonEmptyString(value)) {
    res.status(400).json({ error: "value must be a card id, \"none\" or null" });
    return;
  }
  try {
    res.status(200).json({ value: await setCreditCardPreferenceForUser(req.user!.id, value) });
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof CardNotFoundError) {
      res.status(404).json({ error: "card not found" });
      return;
    }
    throw err;
  }
}

export async function setSavingsPlanHandler(req: Request, res: Response) {
  const { amount, day } = req.body ?? {};
  const clearing = amount === null;
  if (!clearing && (typeof amount !== "number" || !(amount > 0) || !isValidDay(day))) {
    res.status(400).json({ error: "amount (positive) and day (1-31) are required, or amount: null to remove" });
    return;
  }
  try {
    const card = await setSavingsPlanForUser(req.user!.id, req.params.id, clearing ? null : { amount, day });
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
    if (err instanceof NotSecuredCardError) {
      res.status(400).json({ error: "this card doesn't have a secured limit" });
      return;
    }
    if (err instanceof InvalidSavingsPlanError) {
      res.status(400).json({ error: "invalid savings plan" });
      return;
    }
    throw err;
  }
}
