import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import {
  InvalidAccountError,
  InvalidCategoryError,
  ItemNotFoundError,
  addItem,
  checkItem,
  listItems,
  removeItem,
  uncheckItem,
} from "./shopping.service";

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function addItemHandler(req: Request, res: Response) {
  const { name } = req.body ?? {};
  if (!isNonEmptyString(name)) {
    res.status(400).json({ error: "name is required" });
    return;
  }

  try {
    const item = await addItem(req.user!.id, name.trim());
    res.status(201).json(item);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function listItemsHandler(req: Request, res: Response) {
  try {
    const items = await listItems(req.user!.id);
    res.status(200).json(items);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function checkItemHandler(req: Request, res: Response) {
  const { isChecked, accountId, categoryId, amount } = req.body ?? {};
  if (typeof isChecked !== "boolean") {
    res.status(400).json({ error: "isChecked is required" });
    return;
  }

  try {
    if (isChecked) {
      if (!isNonEmptyString(accountId) || typeof amount !== "number" || amount <= 0) {
        res.status(400).json({ error: "accountId and amount are required to check an item" });
        return;
      }
      const item = await checkItem(req.user!.id, req.params.id, {
        accountId,
        categoryId: isNonEmptyString(categoryId) ? categoryId : null,
        amount,
      });
      res.status(200).json(item);
    } else {
      const item = await uncheckItem(req.user!.id, req.params.id);
      res.status(200).json(item);
    }
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof ItemNotFoundError) {
      res.status(404).json({ error: "item not found" });
      return;
    }
    if (err instanceof InvalidAccountError || err instanceof InvalidCategoryError) {
      res.status(400).json({ error: err.constructor.name });
      return;
    }
    throw err;
  }
}

export async function deleteItemHandler(req: Request, res: Response) {
  try {
    await removeItem(req.user!.id, req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof NoGroupError || err instanceof ItemNotFoundError) {
      res.status(404).json({ error: "item not found" });
      return;
    }
    throw err;
  }
}
