import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { adminRouter } from "./modules/admin/admin.routes";
import { assistantRouter } from "./modules/assistant/assistant.routes";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { cardsRouter } from "./modules/cards/cards.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { debtsRouter } from "./modules/debts/debts.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { groupsRouter } from "./modules/groups/groups.routes";
import { quotesRouter } from "./modules/quotes/quotes.routes";
import { shoppingRouter } from "./modules/shopping/shopping.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import { bootstrapHandler, meHandler, updateProfileHandler } from "./modules/users/users.controller";
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
  // Default 100kb body limit is too small for a profile photo data URL
  // (base64 blows up ~33% over the raw image bytes).
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiLimiter);

  // Unauthenticated on purpose -- this is what the keep-alive cron pings.
  // /api/me always answers 401 when hit without a token, which cron-job.org
  // (and similar services) count as a failed execution; enough of those in
  // a row auto-disables the cronjob even though the ping was doing its job.
  app.get("/api/health", (_req, res) => res.status(200).json({ status: "ok" }));

  app.get("/api/me", requireAuth, asyncHandler(meHandler));
  app.post("/api/me/bootstrap", requireAuth, asyncHandler(bootstrapHandler));
  app.patch("/api/me", requireAuth, asyncHandler(updateProfileHandler));
  app.use("/api/groups", groupsRouter);
  app.use("/api/categories", categoriesRouter);
  app.use("/api/transactions", transactionsRouter);
  app.use("/api/goals", goalsRouter);
  app.use("/api/budgets", budgetsRouter);
  app.use("/api/debts", debtsRouter);
  app.use("/api/cards", cardsRouter);
  app.use("/api/assistant", assistantRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/quotes", quotesRouter);
  app.use("/api/shopping", shoppingRouter);

  app.use(errorHandler);

  return app;
}
