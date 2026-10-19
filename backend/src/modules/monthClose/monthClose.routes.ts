// ============================================================================
// MÓDULO monthClose -- endereços /api/month-close
// ============================================================================
// O que faz: Fechamento do mês: o resumo do mês anterior (entrou, saiu,
//            sobrou, maiores categorias).
// Quem chama: components/MonthCloseCard.tsx, no topo do Painel na primeira
//             semana do mês.
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
import { getMonthCloseHandler } from "./monthClose.controller";

export const monthCloseRouter = Router();

monthCloseRouter.use(requireAuth);

// GET /api/month-close?month=YYYY-MM (sem month = mês passado)
monthCloseRouter.get("/", asyncHandler(getMonthCloseHandler));
