import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  acceptInviteHandler,
  createGroupHandler,
  createInviteHandler,
  getMyGroupHandler,
  leaveGroupHandler,
  listMyGroupsHandler,
  removeMemberHandler,
  updateFinancialProfileHandler,
  updateGroupIdentityHandler,
} from "./groups.controller";

export const groupsRouter = Router();

groupsRouter.use(requireAuth);

groupsRouter.get("/", asyncHandler(listMyGroupsHandler));
groupsRouter.post("/", asyncHandler(createGroupHandler));
groupsRouter.post("/accept", asyncHandler(acceptInviteHandler));
groupsRouter.get("/me", asyncHandler(getMyGroupHandler));
groupsRouter.patch("/me", asyncHandler(updateGroupIdentityHandler));
groupsRouter.post("/invite", asyncHandler(createInviteHandler));
groupsRouter.post("/leave", asyncHandler(leaveGroupHandler));
groupsRouter.delete("/members/:userId", asyncHandler(removeMemberHandler));
groupsRouter.patch("/financial-profile", asyncHandler(updateFinancialProfileHandler));
