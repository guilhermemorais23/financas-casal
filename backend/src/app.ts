import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import { adminRouter } from "./modules/admin/admin.routes";
import { announcementsRouter } from "./modules/announcements/announcements.routes";
import { billingRouter } from "./modules/billing/billing.routes";
import { alertsRouter } from "./modules/alerts/alerts.routes";
import { assistantRouter } from "./modules/assistant/assistant.routes";
import { budgetsRouter } from "./modules/budgets/budgets.routes";
import { cardsRouter } from "./modules/cards/cards.routes";
import { categoriesRouter } from "./modules/categories/categories.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { billsRouter } from "./modules/upcoming/upcoming.routes";
import { debtsRouter } from "./modules/debts/debts.routes";
import { feedbackRouter } from "./modules/feedback/feedback.routes";
import { monthCloseRouter } from "./modules/monthClose/monthClose.routes";
import { loansRouter } from "./modules/loans/loans.routes";
import { goalsRouter } from "./modules/goals/goals.routes";
import { groupsRouter } from "./modules/groups/groups.routes";
import { quotesRouter } from "./modules/quotes/quotes.routes";
import { recurringBillsRouter } from "./modules/recurringBills/recurringBills.routes";
import { remindersRouter } from "./modules/reminders/reminders.routes";
import { maybeRunDailyJobs } from "./modules/reminders/reminders.service";
import { maybeRunOpsChecks } from "./utils/opsAlerts";
import { publicSharesRouter, sharesRouter } from "./modules/shares/shares.routes";
import { openFinanceRouter } from "./modules/openFinance/openFinance.routes";
import { statementsRouter } from "./modules/statements/statements.routes";
import { shoppingRouter } from "./modules/shopping/shopping.routes";
import { transactionsRouter } from "./modules/transactions/transactions.routes";
import {
  bootstrapHandler,
  deleteAccountHandler,
  logLoginEventHandler,
  welcomeSeenHandler,
  meHandler,
  revokeSessionsHandler,
  updateProfileHandler,
} from "./modules/users/users.controller";
import { asyncHandler } from "./middleware/asyncHandler";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";
import { readCacheScope } from "./middleware/readCacheScope";

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

// Limites mais apertados onde uma rajada custa caro (PDF, IA) ou dá pra
// tentar adivinhar algo (link público, código de convite).
const heavyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas seguidas. Espere uns minutos e tente de novo." },
});

// Webhooks (Telegram, WhatsApp, Asaas) chegam sempre dos mesmos servidores
// e já se autenticam por segredo/assinatura: não entram no limite por IP,
// senão com muita gente usando as mensagens começariam a ser recusadas.
const WEBHOOK_PATHS = new Set(["/assistant/telegram/webhook", "/assistant/whatsapp/webhook", "/billing/webhook"]);

// PDF/IA (custam), link público e convite (dá pra tentar adivinhar),
// mensagem de feedback (vira e-mail pro dono).
export function isHeavyRequest(method: string, path: string): boolean {
  if (method === "POST" && ["/statements/preview", "/assistant/chat", "/groups/accept", "/feedback"].includes(path)) return true;
  if (method === "POST" && /^\/open-finance\/(connect-token|items\/[^/]+\/preview)$/.test(path)) return true;
  return method === "GET" && path.startsWith("/public/shares/");
}

export function createApp() {
  const app = express();
  app.set("trust proxy", TRUST_PROXY);
  app.disable("x-powered-by");
  // Cabeçalhos básicos de proteção: não adivinhar tipo de arquivo, não abrir
  // dentro de outro site, não vazar a URL pra fora.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  // ALLOWED_ORIGIN unset (local dev) => allow any origin. Set it in
  // production to the real frontend URL(s), comma-separated, to stop
  // other sites from calling this API with a signed-in user's token.
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(",").map((origin) => origin.trim());
  app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined));
  // Default 100kb body limit is too small for a profile photo data URL
  // (base64 blows up ~33% over the raw image bytes).
  // Extrato em PDF vem em base64 (até 4MB de arquivo => ~5.4MB de JSON).
  app.use("/api/statements/preview", express.json({ limit: "6mb" }));
  // O webhook do WhatsApp precisa do corpo cru pra conferir a assinatura da Meta.
  app.use(
    express.json({
      limit: "1mb",
      verify: (req, _res, buf) => {
        if ((req as { url?: string }).url?.startsWith("/api/assistant/whatsapp/webhook")) {
          (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf);
        }
      },
    })
  );
  app.use("/api", (req, res, next) => (WEBHOOK_PATHS.has(req.path) ? next() : apiLimiter(req, res, next)));
  app.use("/api", (req, res, next) => (isHeavyRequest(req.method, req.path) ? heavyLimiter(req, res, next) : next()));
  app.use("/api", readCacheScope);

  // Unauthenticated on purpose -- this is what the keep-alive cron pings.
  // /api/me always answers 401 when hit without a token, which cron-job.org
  // (and similar services) count as a failed execution; enough of those in
  // a row auto-disables the cronjob even though the ping was doing its job.
  app.get("/api/health", (_req, res) => {
    void maybeRunDailyJobs();
    void maybeRunOpsChecks();
    res.status(200).json({ status: "ok" });
  });

  app.get("/api/me", requireAuth, asyncHandler(meHandler));
  app.post("/api/me/bootstrap", requireAuth, asyncHandler(bootstrapHandler));
  app.post("/api/me/login-event", requireAuth, asyncHandler(logLoginEventHandler));
  app.post("/api/me/welcome-seen", requireAuth, asyncHandler(welcomeSeenHandler));
  app.patch("/api/me", requireAuth, asyncHandler(updateProfileHandler));
  app.delete("/api/me", requireAuth, asyncHandler(deleteAccountHandler));
  app.post("/api/me/revoke-sessions", requireAuth, asyncHandler(revokeSessionsHandler));
  app.use("/api/groups", groupsRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/bills", billsRouter);
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
  app.use("/api/reminders", remindersRouter);
  app.use("/api/recurring-bills", recurringBillsRouter);
  app.use("/api/alerts", alertsRouter);
  app.use("/api/shares", sharesRouter);
  app.use("/api/statements", statementsRouter);
  app.use("/api/open-finance", openFinanceRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/announcements", announcementsRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/loans", loansRouter);
  app.use("/api/month-close", monthCloseRouter);
  app.use("/api/public/shares", publicSharesRouter);

  app.use(errorHandler);

  return app;
}
