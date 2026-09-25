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
