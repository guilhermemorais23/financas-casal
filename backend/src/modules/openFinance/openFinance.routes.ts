// ============================================================================
// MÓDULO openFinance -- endereços /api/open-finance
// ============================================================================
// O que faz: Conectar conta do banco pelo Pluggy (Open Finance): situação,
//            token pra abrir a janela do Pluggy, contas conectadas, prévia dos
//            lançamentos novos. O webhook do Pluggy fica no app.ts, sem login.
// Quem chama: Importar extrato -> Conectar conta (ImportStatementModal), aviso
//             de lançamentos novos no Painel, Conta.
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
  connectTokenHandler,
  pendingHandler,
  previewHandler,
  registerItemHandler,
  removeHandler,
  statusHandler,
  syncedHandler,
} from "./openFinance.controller";

// Conectar conta (Open Finance pelo Pluggy). Como importar extrato, é Premium.
export const openFinanceRouter = Router();

openFinanceRouter.use(requireAuth);
openFinanceRouter.get("/status", asyncHandler(statusHandler));
openFinanceRouter.get("/pending", asyncHandler(pendingHandler));
openFinanceRouter.use(requirePremium);
openFinanceRouter.post("/connect-token", asyncHandler(connectTokenHandler));
openFinanceRouter.post("/items", asyncHandler(registerItemHandler));
openFinanceRouter.post("/items/:itemId/preview", asyncHandler(previewHandler));
openFinanceRouter.post("/items/:itemId/synced", asyncHandler(syncedHandler));
openFinanceRouter.delete("/items/:itemId", asyncHandler(removeHandler));
