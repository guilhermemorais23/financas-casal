// ============================================================================
// MÓDULO reminders -- endereços /api/reminders
// ============================================================================
// O que faz: Trabalho diário, sem usuário: e-mails e avisos de vencimento
//            (fatura, parcela, conta fixa) e geração das contas fixas do dia.
//            Chamado por um cron externo com segredo (x-cron-secret) e também
//            pelo /api/health.
// Quem chama: Nenhuma tela -- quem chama é o cron (cron-job.org).
//
// Caminho de um pedido dentro do módulo:
//   *.routes.ts      endereço -> função (este arquivo)
//   *.controller.ts  lê e valida o pedido (req.body, req.params), responde
//   *.service.ts     regra de negócio (quem pode, o que calcula)
//   *.repository.ts  lê e grava no Firestore
// ============================================================================
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { runRemindersHandler } from "./reminders.controller";

export const remindersRouter = Router();

// Sem requireAuth aqui de propósito -- ver reminders.controller.ts: quem
// chama é um cron externo, não um usuário logado.
remindersRouter.post("/run", asyncHandler(runRemindersHandler));
