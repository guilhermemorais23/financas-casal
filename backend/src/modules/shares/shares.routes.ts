// ============================================================================
// MÓDULO shares -- endereços /api/shares e /api/public/shares
// ============================================================================
// O que faz: Link público de leitura do extrato: criar (Premium), revogar e
//            abrir pelo token, sem login. O link mostra uma cópia congelada do
//            mês.
// Quem chama: Relatórios -> Exportar -> Copiar link (ReportsPage) e a página
//             pública /r/:token (SharedReportPage).
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
import { createShareHandler, getPublicShareHandler, revokeShareHandler } from "./shares.controller";

export const sharesRouter = Router();
sharesRouter.use(requireAuth);
// Criar link de compartilhamento é do Premium (revogar e abrir continuam livres).
sharesRouter.post("/", requirePremium, asyncHandler(createShareHandler));
sharesRouter.delete("/:id", asyncHandler(revokeShareHandler));

export const publicSharesRouter = Router();
publicSharesRouter.get("/:token", asyncHandler(getPublicShareHandler));
