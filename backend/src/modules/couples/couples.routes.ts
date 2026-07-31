import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { acceptInviteHandler, createCoupleHandler, getMyCoupleHandler } from "./couples.controller";

export const couplesRouter = Router();

couplesRouter.use(requireAuth);

couplesRouter.post("/", asyncHandler(createCoupleHandler));
couplesRouter.post("/accept", asyncHandler(acceptInviteHandler));
couplesRouter.get("/me", asyncHandler(getMyCoupleHandler));
