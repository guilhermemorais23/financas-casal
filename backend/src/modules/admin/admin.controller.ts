import type { Request, Response } from "express";
import { emailProvider, sendEmail } from "../../email/mailer";
import { checkAssistant } from "../assistant/assistant.service";
import { getAdminOverview, NotAdminError, requireAdminEmail } from "./admin.service";
import { getAdminInsights } from "./admin.insights";
import { buildDiagnostics } from "./admin.diagnostics";
import { AdminUserError, getUserDetailForAdmin, listUsersForAdmin, setUserBlocked } from "./admin.users";
import { billingConfig } from "../billing/billing.config";
import { recordAdminAction } from "../billing/billing.repository";
import { updateAppSettings } from "../settings/appSettings";

export async function getAdminOverviewHandler(req: Request, res: Response) {
  try {
    requireAdminEmail(req.user!.email);
  } catch (err) {
    if (err instanceof NotAdminError) {
      res.status(403).json({ error: "not an admin" });
      return;
    }
    throw err;
  }

  const overview = await getAdminOverview();
  res.status(200).json(overview);
}

function ensureAdmin(req: Request, res: Response): boolean {
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

// Admin > Diagnóstico: o que está configurado em produção, sem precisar abrir
// o Render. Nunca devolve valores secretos, só se existem.
export async function getDiagnosticsHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  res.json({ sections: await buildDiagnostics() });
}

export async function testEmailHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  const result = await sendEmail(
    req.user!.email,
    "Teste de email do PAR.",
    `<div style="font-family: sans-serif; padding: 24px;"><h1 style="font-size: 20px;">Chegou! ✅</h1><p>Os emails do PAR. estão funcionando (${emailProvider()}).</p></div>`
  );
  res.status(result.ok ? 200 : 502).json({ ...result, to: req.user!.email });
}


export async function testAiHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  const result = await checkAssistant();
  res.status(result.ok ? 200 : 502).json(result);
}

// ---------------------------------------------------------------------------
// Usuários, números de uso e as chaves do app (cobrança, manutenção).
// ---------------------------------------------------------------------------

export async function listUsersHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  res.json({ users: await listUsersForAdmin(typeof req.query.q === "string" ? req.query.q : "") });
}

export async function getUserHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  try {
    res.json(await getUserDetailForAdmin(String(req.params.userId)));
  } catch (err) {
    if (err instanceof AdminUserError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function blockUserHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  try {
    await setUserBlocked(req.user!.email, String(req.params.userId), req.body?.blocked === true);
    res.status(204).end();
  } catch (err) {
    if (err instanceof AdminUserError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function insightsHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  res.json(await getAdminInsights());
}

export async function updateSettingsHandler(req: Request, res: Response) {
  if (!ensureAdmin(req, res)) return;
  const { billingEnabled, maintenance } = req.body ?? {};
  if (billingEnabled === true) {
    const config = billingConfig();
    if (!config.asaasApiKey || !config.webhookToken) {
      res.status(400).json({ error: "Configure a chave do Asaas (ASAAS_API_KEY) e o token do webhook (ASAAS_WEBHOOK_TOKEN) no Render antes de ligar a cobrança." });
      return;
    }
  }
  const patch: Parameters<typeof updateAppSettings>[0] = {};
  if (typeof billingEnabled === "boolean") patch.billingEnabled = billingEnabled;
  if (maintenance && typeof maintenance.enabled === "boolean") {
    patch.maintenance = { enabled: maintenance.enabled, message: typeof maintenance.message === "string" ? maintenance.message : undefined };
  }
  const settings = await updateAppSettings(patch);
  const changes = [
    patch.billingEnabled !== undefined ? `cobrança ${patch.billingEnabled ? "ligada" : "desligada"}` : null,
    patch.maintenance ? `manutenção ${patch.maintenance.enabled ? "ligada" : "desligada"}` : null,
  ].filter(Boolean);
  if (changes.length) {
    await recordAdminAction({ adminEmail: req.user!.email, action: "settings", groupId: null, detail: changes.join(", ") });
  }
  res.json(settings);
}
