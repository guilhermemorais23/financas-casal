// ============================================================================
// MÓDULO recurringBills -- endereços /api/recurring-bills
// ============================================================================
// O que faz: Contas fixas: as de valor certo lançam sozinhas todo mês (job
//            diário); as "mais ou menos" e "não sei ainda" avisam antes de
//            vencer e perguntam quanto foi (pagar, lembrar mais tarde).
// Quem chama: A pagar -> Contas (RecurringBillsPage), avisos no Painel e
//             "Contas do mês" (components/BillReminders.tsx).
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
import {
  createRecurringBillHandler,
  deleteRecurringBillHandler,
  listBillRemindersHandler,
  listRecurringBillsHandler,
  payBillHandler,
  snoozeBillHandler,
  updateRecurringBillHandler,
} from "./recurringBills.controller";

export const recurringBillsRouter = Router();

recurringBillsRouter.use(requireAuth);

recurringBillsRouter.post("/", asyncHandler(createRecurringBillHandler));
recurringBillsRouter.get("/", asyncHandler(listRecurringBillsHandler));
recurringBillsRouter.get("/reminders", asyncHandler(listBillRemindersHandler));
recurringBillsRouter.post("/:id/pay", asyncHandler(payBillHandler));
recurringBillsRouter.post("/:id/snooze", asyncHandler(snoozeBillHandler));
recurringBillsRouter.patch("/:id", asyncHandler(updateRecurringBillHandler));
recurringBillsRouter.delete("/:id", asyncHandler(deleteRecurringBillHandler));
