// ============================================================================
// MÓDULO upcoming -- endereços /api/bills
// ============================================================================
// O que faz: A lista "o que tenho pra pagar": faturas, parcelas e contas fixas
//            juntas, pelo que vence primeiro, com o resumo dos próximos 30
//            dias. (O "Vence em 7 dias" do Painel usa a mesma lógica, vindo
//            por /api/dashboard.)
// Quem chama: Contas -> Todas (pages/BillsPage.tsx).
//
// Caminho de um pedido dentro do módulo:
//   *.routes.ts      endereço -> função (este arquivo)
//   *.controller.ts  lê e valida o pedido (req.body, req.params), responde
//   *.service.ts     regra de negócio (quem pode, o que calcula)
//   *.repository.ts  lê e grava no Firestore
// ============================================================================
import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { NoGroupError } from "../groups/groups.service";
import { getBillsOverview } from "./upcoming.service";

export const billsRouter = Router();

billsRouter.use(requireAuth);
billsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      res.json(await getBillsOverview(req.user!.id));
    } catch (err) {
      if (err instanceof NoGroupError) {
        res.status(404).json({ error: "no group" });
        return;
      }
      throw err;
    }
  })
);
