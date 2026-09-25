import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  createHandler,
  listForAdminHandler,
  listPendingHandler,
  listPeopleHandler,
  markSeenHandler,
  setActiveHandler,
} from "./announcements.controller";

// Pop-ups de novidade/aviso que o admin manda pra todo mundo ou pra uma pessoa.
export const announcementsRouter = Router();
announcementsRouter.use(requireAuth);
announcementsRouter.get("/pending", asyncHandler(listPendingHandler));
announcementsRouter.post("/:id/seen", asyncHandler(markSeenHandler));
// Admin
announcementsRouter.get("/", asyncHandler(listForAdminHandler));
announcementsRouter.get("/people", asyncHandler(listPeopleHandler));
announcementsRouter.post("/", asyncHandler(createHandler));
announcementsRouter.patch("/:id", asyncHandler(setActiveHandler));
