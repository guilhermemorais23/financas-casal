import type { Request, Response } from "express";
import { emailProvider, sendEmail } from "../../email/mailer";
import { checkAssistant } from "../assistant/assistant.service";
import { getAdminOverview, NotAdminError, requireAdminEmail } from "./admin.service";

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
  res.json({
    email: {
      provider: emailProvider(),
      brevoKey: Boolean(process.env.BREVO_API_KEY),
      from: Boolean(process.env.EMAIL_FROM || process.env.GMAIL_USER),
      gmailSmtp: Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD),
      ownerEmail: Boolean(process.env.OWNER_EMAIL || process.env.ADMIN_EMAILS),
    },
    ai: { geminiKey: Boolean(process.env.GEMINI_API_KEY) },
    reminders: { cronSecret: Boolean(process.env.CRON_SECRET) },
  });
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
