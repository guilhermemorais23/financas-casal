// ============================================================================
// MÓDULO sheet -- endereços /api/sheet (função opcional "Planilha")
// ============================================================================
// O que faz: a planilha do ano (meses lado a lado por categoria e
//            subcategoria), o que tem dentro de cada valor, e importar a
//            planilha antiga (com desfazer). A regra está no sheet.service.ts.
// Quem chama: a tela Planilha.
// ============================================================================
import { Router, type Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoGroupError } from "../groups/groups.service";
import {
  InvalidSheetInputError,
  SheetAccountError,
  getSheet,
  importSheet,
  listSheetEntries,
  parseImportBody,
  parseYear,
  undoSheetImport,
} from "./sheet.service";

export const sheetRouter = Router();
sheetRouter.use(requireAuth);

function sendError(res: Response, err: unknown): boolean {
  if (err instanceof InvalidSheetInputError) {
    res.status(400).json({ error: err.message });
    return true;
  }
  if (err instanceof SheetAccountError) {
    res.status(400).json({ error: "Conta não encontrada." });
    return true;
  }
  if (err instanceof NoGroupError) {
    res.status(404).json({ error: "Grupo não encontrado." });
    return true;
  }
  return false;
}

sheetRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    try {
      res.status(200).json(await getSheet(req.user!.id, parseYear(req.query.year)));
    } catch (err) {
      if (!sendError(res, err)) throw err;
    }
  })
);

// ?year=2026&month=11&categoryId=... (ou "none") ou ?year=2026&tag=remédio
sheetRouter.get(
  "/entries",
  asyncHandler(async (req, res) => {
    try {
      const year = parseYear(req.query.year);
      const month = req.query.month === undefined ? undefined : Number(req.query.month);
      if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
        throw new InvalidSheetInputError("Mês inválido.");
      }
      const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId ? req.query.categoryId : undefined;
      const tag = typeof req.query.tag === "string" && req.query.tag ? req.query.tag.toLowerCase() : undefined;
      res.status(200).json(await listSheetEntries(req.user!.id, { year, month, categoryId, tag }));
    } catch (err) {
      if (!sendError(res, err)) throw err;
    }
  })
);

sheetRouter.post(
  "/import",
  asyncHandler(async (req, res) => {
    try {
      res.status(201).json(await importSheet(req.user!.id, parseImportBody(req.body)));
    } catch (err) {
      if (!sendError(res, err)) throw err;
    }
  })
);

sheetRouter.delete(
  "/import/:importId",
  asyncHandler(async (req, res) => {
    try {
      const removed = await undoSheetImport(req.user!.id, req.params.importId);
      res.status(200).json({ removed });
    } catch (err) {
      if (!sendError(res, err)) throw err;
    }
  })
);
