// ============================================================================
// MÓDULO shopping -- endereços /api/shopping
// ============================================================================
// O que faz: Lista de compras do grupo. Marcar um item como comprado vira
//            gasto de verdade; desmarcar apaga.
// Quem chama: Tela Lista de compras (pages/ShoppingListPage.tsx).
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
import { addItemHandler, checkItemHandler, deleteItemHandler, listItemsHandler } from "./shopping.controller";

export const shoppingRouter = Router();

shoppingRouter.use(requireAuth);

shoppingRouter.post("/", asyncHandler(addItemHandler));
shoppingRouter.get("/", asyncHandler(listItemsHandler));
shoppingRouter.patch("/:id/check", asyncHandler(checkItemHandler));
shoppingRouter.delete("/:id", asyncHandler(deleteItemHandler));
