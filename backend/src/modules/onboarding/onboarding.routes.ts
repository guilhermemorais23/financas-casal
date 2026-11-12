// ============================================================================
// MÓDULO onboarding -- endereços /api/onboarding
// ============================================================================
// O que faz: os "Primeiros passos" do Painel. Os passos em si vêm junto do
//            GET /api/dashboard (campo checklist); aqui só fica o "fechar".
// Quem chama: o cartão de primeiros passos do Painel.
// ============================================================================
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { markChecklistDismissed } from "../users/users.repository";

export const onboardingRouter = Router();

onboardingRouter.use(requireAuth);

// Fechar é de vez: o cartão não volta, nem com passo novo por fazer.
onboardingRouter.post(
  "/checklist/dismiss",
  asyncHandler(async (req, res) => {
    await markChecklistDismissed(req.user!.id);
    res.status(204).send();
  })
);
