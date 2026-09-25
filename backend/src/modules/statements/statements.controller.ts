import type { Request, Response } from "express";
import { NoGroupError } from "../groups/groups.service";
import { InvalidAccountError, InvalidCategoryError } from "../transactions/transactions.service";
import { PdfPasswordError } from "../../utils/pdfStatement";
import {
  InvalidImportItemError,
  InvalidRuleError,
  listImportRules,
  removeImportRule,
  saveImportRule,
  type RuleInput,
  StatementParseError,
  commitStatement,
  previewStatement,
  type ImportItem,
} from "./statements.service";

export async function previewStatementHandler(req: Request, res: Response) {
  try {
    const result = await previewStatement(req.user!.id, req.body ?? {});
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof PdfPasswordError) {
      res.status(422).json({ error: err.message, code: err.reason === "needed" ? "pdf_password_needed" : "pdf_password_wrong" });
      return;
    }
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
  const { accountId, items, rules } = req.body ?? {};
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
    const normalizedRules: RuleInput[] = (Array.isArray(rules) ? rules : [])
      .filter((rule: unknown): rule is Record<string, unknown> => !!rule && typeof rule === "object")
      .map((rule: Record<string, unknown>) => ({
        key: typeof rule.key === "string" ? rule.key : "",
        label: typeof rule.label === "string" ? rule.label : "",
        categoryId: typeof rule.categoryId === "string" && rule.categoryId !== "" ? rule.categoryId : null,
        notExpense: rule.notExpense === true,
      }));
    const result = await commitStatement(req.user!.id, accountId, normalized, normalizedRules);
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

export async function listImportRulesHandler(req: Request, res: Response) {
  try {
    res.status(200).json({ rules: await listImportRules(req.user!.id) });
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function saveImportRuleHandler(req: Request, res: Response) {
  try {
    res.status(200).json({ rule: await saveImportRule(req.user!.id, req.body ?? {}) });
  } catch (err) {
    if (err instanceof InvalidRuleError) {
      res.status(400).json({ error: "Escolha uma categoria ou marque \"Não é gasto\"." });
      return;
    }
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}

export async function deleteImportRuleHandler(req: Request, res: Response) {
  try {
    await removeImportRule(req.user!.id, String(req.params.key ?? ""));
    res.status(204).end();
  } catch (err) {
    if (err instanceof NoGroupError) {
      res.status(404).json({ error: "no group yet" });
      return;
    }
    throw err;
  }
}
