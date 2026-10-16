// ============================================================================
// MONTAGEM DO SERVIDOR: segurança, limites e o MAPA DE ROTAS da API
// ============================================================================
// O Express é a biblioteca que recebe pedidos HTTP e decide qual função
// responde. Um pedido do frontend passa por estas etapas, NESTA ORDEM (é a
// ordem dos app.use lá embaixo):
//
//   1. cabeçalhos de proteção (nosniff, não abrir dentro de outro site...)
//   2. CORS: só o site do PAR. pode chamar a API (ALLOWED_ORIGIN)
//   3. express.json: transforma o corpo do pedido (JSON) em objeto (req.body)
//   4. limite de pedidos por IP (apiLimiter) e limite apertado pras rotas
//      caras (heavyLimiter)
//   5. readCacheScope: liga o cache de leituras e o limpa depois de gravar
//   6. a ROTA: app.use("/api/debts", debtsRouter) manda tudo que começa com
//      /api/debts pro módulo de dívidas (backend/src/modules/debts/)
//   7. errorHandler: se qualquer etapa der erro, vira uma resposta JSON
//
// Quer saber quem responde um endereço? Procure aqui o começo dele
// (ex.: "/api/recurring-bills") e abra o *.routes.ts daquele módulo.
// Dentro de cada módulo, o caminho é sempre o mesmo:
//   routes (endereço -> função) -> controller (lê e valida o pedido)
//   -> service (regra de negócio) -> repository (lê/grava no Firestore)
// ============================================================================
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
import { webhookHandler as pluggyWebhookHandler } from "./modules/openFinance/openFinance.controller";
import { pushRouter } from "./modules/push/push.routes";
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

// O Render fica atrás de um proxy reverso, então o req.ip seria o endereço
// do próprio proxy -- confiar no X-Forwarded-For dele faz o limite de pedidos
// (e qualquer lógica futura por IP) usar o cliente real, e não tratar "todo
// mundo como um IP só".
const TRUST_PROXY = process.env.NODE_ENV === "production" ? 1 : false;

// Todo pedido aqui bate no Firestore (custa de verdade, e é o que cai sob
// carga -- uma rajada de conexões simultâneas levou respostas de poucos ms
// pra mais de 1,5 s de mediana, medido). 300 pedidos a cada 15 min por IP é
// bem acima do uso normal (o frontend guarda em cache e só busca de novo ao
// trocar de tela), mas segura uma enxurrada muito antes de ela chegar no
// Firestore ou derrubar a instância do Render.
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
const WEBHOOK_PATHS = new Set(["/assistant/telegram/webhook", "/assistant/whatsapp/webhook", "/billing/webhook", "/open-finance/webhook"]);

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

  // ALLOWED_ORIGIN vazio (no seu PC) => aceita qualquer origem. Em produção,
  // coloque a(s) URL(s) do frontend, separadas por vírgula, pra impedir que
  // outros sites chamem esta API usando o token de quem está logado.
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(",").map((origin) => origin.trim());
  app.use(cors(allowedOrigins ? { origin: allowedOrigins } : undefined));
  // O limite padrão de 100kb pro corpo é pequeno demais pra foto de perfil em
  // data URL (o base64 fica ~33% maior que os bytes da imagem).
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

  // Sem login de propósito -- é o que o cron de "manter acordado" chama.
  // O /api/me sempre responde 401 sem token, e o cron-job.org (e serviços
  // parecidos) conta isso como execução com falha; várias seguidas desligam o
  // cron sozinhas, mesmo com o ping fazendo o trabalho dele.
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
  // Aviso do Pluggy: sem login (confere o segredo do endereço), antes do
  // roteador que exige login.
  app.post("/api/open-finance/webhook", asyncHandler(pluggyWebhookHandler));
  app.use("/api/open-finance", openFinanceRouter);
  app.use("/api/push", pushRouter);
  app.use("/api/feedback", feedbackRouter);
  app.use("/api/announcements", announcementsRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/loans", loansRouter);
  app.use("/api/month-close", monthCloseRouter);
  app.use("/api/public/shares", publicSharesRouter);

  app.use(errorHandler);

  return app;
}
