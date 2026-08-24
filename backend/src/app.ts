import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { cardsRouter } from "./modules/cards/cards.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { debtsRouter } from "./modules/debts/debts.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { groupsRouter } from "./modules/groups/groups.routes";
import { insightsRouter } from "./modules/insights/insights.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import { bootstrapHandler, meHandler } from "./modules/users/users.controller";
import { asyncHandler } from "./middleware/asyncHandler";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

// Render sits behind a reverse proxy, so req.ip is otherwise the proxy's own
// address -- trust its X-Forwarded-For so rate limiting (and any future
// IP-based logic) keys on the real client, not "everyone is one IP".
const TRUST_PROXY = process.env.NODE_ENV === "production" ? 1 : false;

// Every request here hits Firestore (a real cost, and the thing that
// actually falls over under load -- a burst of concurrent connections was
// measured to push single-digit-ms responses past 1.5s median). 300
// requests/15min/IP is far above normal usage (the frontend caches and only
// refetches on navigation) but stops a flood well before it reaches
// Firestore or exhausts the Render instance.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas requisições. Tente novamente em alguns minutos." },
});

export function createApp() {
  const app = express();
  app.set("trust proxy", TRUST_PROXY);

  // ALLOWED_ORIGIN unset (local dev) => allow any origin. Set it in
  // production to the real frontend URL(s), comma-separated, to stop
  // other sites from calling this API with a signed-in user's token.
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(",").map((origin) => origin.trim());
  app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined));
  app.use(express.json());
  app.use("/api", apiLimiter);

  app.get("/api/me", requireAuth, asyncHandler(meHandler));
  app.post("/api/me/bootstrap", requireAuth, asyncHandler(bootstrapHandler));
  app.use("/api/groups", groupsRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/debts", debtsRouter);
  app.use("/api/cards", cardsRouter);
  app.use("/api/insights", insightsRouter);

  app.use(errorHandler);

  return app;
}
