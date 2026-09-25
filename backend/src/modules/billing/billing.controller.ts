import type { Request, Response } from "express";
import { NotAdminError, requireAdminEmail } from "../admin/admin.service";
import { logError } from "../../utils/errorLog";
import { AsaasError, AsaasNotConfiguredError } from "./asaas.client";
import { billingConfig } from "./billing.config";
import {
  BillingError,
  cancelSubscription,
  getBillingAdminOverview,
  getBillingForUser,
  grantCourtesy,
  handleAsaasWebhook,
  revokeCourtesy,
  startCheckout,
  type AsaasWebhook,
} from "./billing.service";

function sendError(err: unknown, res: Response): boolean {
  if (err instanceof BillingError) {
    res.status(err.status).json({ error: err.message });
    return true;
  }
  if (err instanceof AsaasNotConfiguredError) {
    res.status(503).json({ error: "O pagamento ainda não foi configurado no servidor." });
    return true;
  }
  if (err instanceof AsaasError) {
    logError("asaas", err);
    res.status(502).json({ error: `Não foi possível falar com o sistema de pagamento: ${err.message}` });
    return true;
  }
  return false;
}

function isAdmin(req: Request, res: Response): boolean {
  try {
    requireAdminEmail(req.user!.email);
    return true;
  } catch (err) {
    if (err instanceof NotAdminError) {
      res.status(403).json({ error: "not an admin" });
      return false;
    }
    throw err;
  }
}

export async function getBillingHandler(req: Request, res: Response) {
  try {
    res.json(await getBillingForUser(req.user!.id));
  } catch (err) {
    if (!sendError(err, res)) throw err;
  }
}

export async function checkoutHandler(req: Request, res: Response) {
  try {
    res.json(await startCheckout(req.user!.id, req.body ?? {}));
  } catch (err) {
    if (!sendError(err, res)) throw err;
  }
}

export async function cancelHandler(req: Request, res: Response) {
  try {
    await cancelSubscription(req.user!.id, req.body ?? {});
    res.status(204).end();
  } catch (err) {
    if (!sendError(err, res)) throw err;
  }
}

// Sem requireAuth: quem chama é o Asaas. A autenticidade vem do token que
// você cadastra no webhook do painel do Asaas (cabeçalho asaas-access-token).
// Responde 200 mesmo pra evento ignorado, senão o Asaas fica reenviando e
// pausa a fila de webhooks.
export async function webhookHandler(req: Request, res: Response) {
  const expected = billingConfig().webhookToken;
  if (!expected || req.header("asaas-access-token") !== expected) {
    res.status(401).json({ error: "invalid token" });
    return;
  }
  try {
    res.json(await handleAsaasWebhook((req.body ?? {}) as AsaasWebhook));
  } catch (err) {
    logError("asaas-webhook", err, { path: req.path, method: req.method });
    // 500 faz o Asaas tentar de novo depois -- é o que queremos se o banco caiu.
    res.status(500).json({ error: "failed" });
  }
}

export async function adminOverviewHandler(req: Request, res: Response) {
  if (!isAdmin(req, res)) return;
  res.json(await getBillingAdminOverview());
}

export async function adminGrantHandler(req: Request, res: Response) {
  if (!isAdmin(req, res)) return;
  try {
    await grantCourtesy(req.user!.email, req.body ?? {});
    res.status(204).end();
  } catch (err) {
    if (!sendError(err, res)) throw err;
  }
}

export async function adminRevokeHandler(req: Request, res: Response) {
  if (!isAdmin(req, res)) return;
  try {
    await revokeCourtesy(req.user!.email, req.body ?? {});
    res.status(204).end();
  } catch (err) {
    if (!sendError(err, res)) throw err;
  }
}
