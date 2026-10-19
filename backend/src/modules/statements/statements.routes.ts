// ============================================================================
// MÓDULO statements -- endereços /api/statements
// ============================================================================
// O que faz: Importar extrato do banco (PDF, OFX, CSV): prévia pra revisar,
//            gravar os lançamentos escolhidos e as regras "este nome é tal
//            categoria". Premium.
// Quem chama: components/ImportStatementModal.tsx (botão Importar extrato) e
//             ImportRulesCard (regras salvas).
//
// Caminho de um pedido dentro do módulo:
//   *.routes.ts      endereço -> função (este arquivo)
//   *.controller.ts  lê e valida o pedido (req.body, req.params), responde
//   *.service.ts     regra de negócio (quem pode, o que calcula)
//   *.repository.ts  lê e grava no Firestore
// ============================================================================
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { requirePremium } from "../../middleware/requirePremium";
import {
  commitStatementHandler,
  deleteImportRuleHandler,
  listImportRulesHandler,
  previewStatementHandler,
  saveImportRuleHandler,
} from "./statements.controller";

export const statementsRouter = Router();

statementsRouter.use(requireAuth);
// As respostas guardadas continuam editáveis mesmo sem Premium.
statementsRouter.get("/rules", asyncHandler(listImportRulesHandler));
statementsRouter.put("/rules", asyncHandler(saveImportRuleHandler));
statementsRouter.delete("/rules/:key", asyncHandler(deleteImportRuleHandler));
// Importar extrato do banco é do Premium.
statementsRouter.use(requirePremium);
statementsRouter.post("/preview", asyncHandler(previewStatementHandler));
statementsRouter.post("/commit", asyncHandler(commitStatementHandler));
