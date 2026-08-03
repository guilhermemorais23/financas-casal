import cors from "cors";
import express from "express";
import { meHandler } from "./modules/auth/auth.controller";
import { authRouter } from "./modules/auth/auth.routes";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { couplesRouter } from "./modules/couples/couples.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import { asyncHandler } from "./middleware/asyncHandler";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use("/api/auth", authRouter);
  app.get("/api/me", requireAuth, asyncHandler(meHandler));
  app.use("/api/couples", couplesRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/budgets", budgetsRouter);

  app.use(errorHandler);

  return app;
}
