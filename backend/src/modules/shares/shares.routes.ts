import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { createShareHandler, getPublicShareHandler, revokeShareHandler } from "./shares.controller";

export const sharesRouter = Router();
sharesRouter.use(requireAuth);
sharesRouter.post("/", asyncHandler(createShareHandler));
sharesRouter.delete("/:id", asyncHandler(revokeShareHandler));

export const publicSharesRouter = Router();
publicSharesRouter.get("/:token", asyncHandler(getPublicShareHandler));
