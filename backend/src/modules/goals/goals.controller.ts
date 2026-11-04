import type { Request, Response } from "express";
import {
  GoalItemNotFoundError,
  GoalNotFoundError,
  InvalidContributionError,
  NotEnoughInGoalError,
  TooManyGoalItemsError,
  addGoalItem,
  contributeToGoal,
  createGoal,
  listContributions,
  listGoals,
  moveGoalMoney,
  removeGoal,
  removeGoalItem,
  updateContribution,
  updateGoal,
  updateGoalItem,
} from "./goals.service";
import { InvalidAccountError } from "../transactions/transactions.service";
import { isNonEmptyString, isValidAmount } from "../../utils/validation";

// O mesmo limite da foto de perfil -- uma foto comprimida e redimensionada no
// navegador cabe com folga, seja qual for o arquivo original.
const MAX_PHOTO_DATA_URL_LENGTH = 300_000;

// Os erros das metas viram a mesma resposta em toda rota.
function goalError(err: unknown, res: Response): boolean {
  if (err instanceof GoalNotFoundError || err instanceof GoalItemNotFoundError) {
    res.status(404).json({ error: "Meta não encontrada." });
    return true;
  }
  if (err instanceof NotEnoughInGoalError) {
    res.status(400).json({ error: "Não tem tudo isso guardado aí.", code: "not_enough" });
    return true;
  }
  if (err instanceof TooManyGoalItemsError) {
    res.status(400).json({ error: "Uma meta pode ter até 12 submetas." });
    return true;
  }
  if (err instanceof InvalidAccountError) {
    res.status(400).json({ error: "Escolha uma conta sua ou a conjunta." });
    return true;
  }
  if (err instanceof InvalidContributionError) {
    res.status(400).json({ error: "Informe um nome e um valor válidos." });
    return true;
  }
  return false;
}

function parseItems(value: unknown): { name: string; targetAmount: number }[] | "invalid" {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 12) return "invalid";
  const items: { name: string; targetAmount: number }[] = [];
  for (const raw of value) {
    const item = raw as { name?: unknown; targetAmount?: unknown };
    if (!isNonEmptyString(item?.name) || !isValidAmount(item?.targetAmount)) return "invalid";
    items.push({ name: item.name.trim().slice(0, 60), targetAmount: item.targetAmount });
  }
  return items;
}

export async function createGoalHandler(req: Request, res: Response) {
  const { name, emoji, photoDataUrl, targetAmount, deadline, items: rawItems } = req.body ?? {};
  const items = parseItems(rawItems);

  // Com submetas, o alvo é a soma delas (targetAmount pode vir vazio).
  if (!isNonEmptyString(name) || items === "invalid" || (items.length === 0 && !isValidAmount(targetAmount))) {
    res.status(400).json({ error: "name and targetAmount (ou submetas) are required" });
    return;
  }

  if (photoDataUrl !== undefined && photoDataUrl !== null) {
    if (typeof photoDataUrl !== "string" || !photoDataUrl.startsWith("data:image/")) {
      res.status(400).json({ error: "photoDataUrl must be a data:image/... URL or null" });
      return;
    }
    if (photoDataUrl.length > MAX_PHOTO_DATA_URL_LENGTH) {
      res.status(400).json({ error: "photo is too large" });
      return;
    }
  }

  const goal = await createGoal(req.user!.id, {
    name: name.trim(),
    emoji: isNonEmptyString(emoji) ? emoji : null,
    photoDataUrl: photoDataUrl ?? null,
    targetAmount: items.length > 0 ? 0 : targetAmount,
    deadline: isNonEmptyString(deadline) ? deadline : null,
    items,
  });
  res.status(201).json(goal);
}

export async function listGoalsHandler(req: Request, res: Response) {
  const goals = await listGoals(req.user!.id);
  res.status(200).json(goals);
}

// "Guardar" antigo: só soma.
export async function contributeToGoalHandler(req: Request, res: Response) {
  const { amount } = req.body ?? {};
  if (!isValidAmount(amount)) {
    res.status(400).json({ error: "amount is required" });
    return;
  }
  try {
    res.status(200).json(await contributeToGoal(req.user!.id, req.params.id, amount));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

// Guardar ou retirar, opcionalmente tirando/devolvendo pra uma conta.
export async function moveGoalMoneyHandler(req: Request, res: Response) {
  const { direction, amount, itemId, accountId } = req.body ?? {};
  if (
    (direction !== "deposit" && direction !== "withdraw") ||
    !isValidAmount(amount) ||
    (itemId !== undefined && itemId !== null && !isNonEmptyString(itemId)) ||
    (accountId !== undefined && accountId !== null && !isNonEmptyString(accountId))
  ) {
    res.status(400).json({ error: "direction (deposit|withdraw) and amount are required" });
    return;
  }
  try {
    res.status(200).json(await moveGoalMoney(req.user!.id, req.params.id, { direction, amount, itemId, accountId }));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

export async function listContributionsHandler(req: Request, res: Response) {
  try {
    res.status(200).json(await listContributions(req.user!.id, req.params.id));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

export async function addGoalItemHandler(req: Request, res: Response) {
  try {
    res.status(201).json(await addGoalItem(req.user!.id, req.params.id, req.body ?? {}));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

export async function updateGoalItemHandler(req: Request, res: Response) {
  try {
    res.status(200).json(await updateGoalItem(req.user!.id, req.params.id, req.params.itemId, req.body ?? {}));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

export async function removeGoalItemHandler(req: Request, res: Response) {
  try {
    res.status(200).json(await removeGoalItem(req.user!.id, req.params.id, req.params.itemId));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

export async function deleteGoalHandler(req: Request, res: Response) {
  try {
    await removeGoal(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

// Editar a meta: nome, prazo e (sem submetas) alvo e quanto já tem guardado.
export async function updateGoalHandler(req: Request, res: Response) {
  const { name, deadline, targetAmount, currentAmount } = req.body ?? {};
  const isMoney = (value: unknown, allowZero: boolean) =>
    typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
  if (
    !isNonEmptyString(name) ||
    (deadline !== undefined && deadline !== null && !isNonEmptyString(deadline)) ||
    (targetAmount !== undefined && !isMoney(targetAmount, false)) ||
    (currentAmount !== undefined && !isMoney(currentAmount, true))
  ) {
    res.status(400).json({ error: "name is required; targetAmount (> 0) and currentAmount (>= 0) are optional" });
    return;
  }
  try {
    res.status(200).json(
      await updateGoal(req.user!.id, req.params.id, {
        name,
        deadline: isNonEmptyString(deadline) ? deadline : null,
        targetAmount,
        currentAmount,
      })
    );
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

// Corrigir o valor de um guardar/retirar do histórico.
export async function updateContributionHandler(req: Request, res: Response) {
  const { amount } = req.body ?? {};
  if (!isValidAmount(amount)) {
    res.status(400).json({ error: "amount is required" });
    return;
  }
  try {
    res.status(200).json(await updateContribution(req.user!.id, req.params.id, req.params.contributionId, amount));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}

// Apagar um guardar/retirar do histórico (a transferência no extrato some junto).
export async function deleteContributionHandler(req: Request, res: Response) {
  try {
    res.status(200).json(await updateContribution(req.user!.id, req.params.id, req.params.contributionId, null));
  } catch (err) {
    if (goalError(err, res)) return;
    throw err;
  }
}
