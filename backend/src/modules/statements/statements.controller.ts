import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { InvalidAccountError, InvalidCategoryError } from "../transactions/transactions.service";
import {
  InvalidImportItemError,
  StatementParseError,
  commitStatement,
  previewStatement,
  type ImportItem,
} from "./statements.service";

export async function previewStatementHandler(req: Request, res: Response) {
  try {
    const result = await previewStatement(req.user!.id, req.body?.content);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof StatementParseError) {
      res.status(422).json({ error: err.message });
      return;
    }
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function commitStatementHandler(req: Request, res: Response) {
  const { accountId, items } = req.body ?? {};
  if (typeof accountId !== "string" || accountId === "" || !Array.isArray(items)) {
    res.status(400).json({ error: "accountId and items are required" });
    return;
  }

  try {
    const normalized: ImportItem[] = items.map((item: Record<string, unknown>) => ({
      description: item.description as string,
      amount: item.amount as number,
      transactionType: item.transactionType as "expense" | "income",
      occurredAt: item.occurredAt as string,
      categoryId: typeof item.categoryId === "string" && item.categoryId !== "" ? item.categoryId : null,
    }));
    const result = await commitStatement(req.user!.id, accountId, normalized);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    if (err instanceof InvalidImportItemError || err instanceof InvalidAccountError || err instanceof InvalidCategoryError) {
      res.status(400).json({ error: err.constructor.name });
      return;
    }
    throw err;
  }
}
