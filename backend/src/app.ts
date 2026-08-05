import cors from "cors";
import express from "express";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { debtsRouter } from "./modules/debts/debts.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { groupsRouter } from "./modules/groups/groups.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import { bootstrapHandler, meHandler } from "./modules/users/users.controller";
import { asyncHandler } from "./middleware/asyncHandler";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  // ALLOWED_ORIGIN unset (local dev) => allow any origin. Set it in
  // production to the real frontend URL(s), comma-separated, to stop
  // other sites from calling this API with a signed-in user's token.
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(",").map((origin) => origin.trim());
  app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined));
  app.use(express.json());

  app.get("/api/me", requireAuth, asyncHandler(meHandler));
  app.post("/api/me/bootstrap", requireAuth, asyncHandler(bootstrapHandler));
  app.use("/api/groups", groupsRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/debts", debtsRouter);

  app.use(errorHandler);

  return app;
}
