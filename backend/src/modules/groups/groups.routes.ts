import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  acceptInviteHandler,
  createGroupHandler,
  createInviteHandler,
  getMyGroupHandler,
  leaveGroupHandler,
} from "./groups.controller";

export const groupsRouter = Router();

groupsRouter.use(requireAuth);

groupsRouter.post("/", asyncHandler(createGroupHandler));
groupsRouter.post("/accept", asyncHandler(acceptInviteHandler));
groupsRouter.get("/me", asyncHandler(getMyGroupHandler));
groupsRouter.post("/invite", asyncHandler(createInviteHandler));
groupsRouter.post("/leave", asyncHandler(leaveGroupHandler));
