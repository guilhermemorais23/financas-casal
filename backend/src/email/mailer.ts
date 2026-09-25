import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logError } from "../utils/errorLog";

// Render's free plan blocks outbound SMTP (ports 25/465/587) since
// 2025-09-26, so Gmail SMTP just times out in production -- that's why
// welcome emails stopped arriving. Brevo's HTTPS API goes over 443 and works
// there: free plan (~300 emails/day) with a single verified sender address
// (the same Gmail works), no domain needed. Gmail SMTP stays as the fallback
// for local dev or a paid instance.
const transporter =
  env.gmailUser && env.gmailAppPassword
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: env.gmailUser, pass: env.gmailAppPassword },
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      })
    : null;

function senderAddress(): string | undefined {
  return process.env.EMAIL_FROM?.trim() || env.gmailUser;
}

export type EmailProvider = "brevo" | "gmail-smtp" | "none";

export function emailProvider(): EmailProvider {
  if (process.env.BREVO_API_KEY && senderAddress()) return "brevo";
  if (transporter) return "gmail-smtp";
  return "none";
}

export interface EmailResult {
  ok: boolean;
  provider: EmailProvider;
  error?: string;
}

async function sendViaBrevo(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY!,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "PAR.", email: senderAddress() },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Brevo ${res.status}: ${detail.slice(0, 300)}`);
  }
}

// Best-effort: a missing provider or a failed send is logged (and shows up
// in Admin > Logs), never thrown -- email is always a courtesy, never
// something that should block the request that triggered it. The result
// tells callers that care (reminders, the admin test button) whether it
// actually went out.
export async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<EmailResult> {
  const provider = emailProvider();
  if (provider === "none") {
    console.warn("No email provider (BREVO_API_KEY or GMAIL_USER/GMAIL_APP_PASSWORD) — skipping email to", to);
    return { ok: false, provider, error: "Nenhum provedor de email configurado" };
  }
  try {
    if (provider === "brevo") {
      await sendViaBrevo(to, subject, html, replyTo);
    } else {
      await transporter!.sendMail({ from: `"PAR." <${env.gmailUser}>`, to, subject, html, replyTo });
    }
    console.log("Email sent to", to, "via", provider);
    return { ok: true, provider };
  } catch (err) {
    console.error("Failed to send email to", to, err);
    logError("email", err);
    return { ok: false, provider, error: err instanceof Error ? err.message : String(err) };
  }
}

// Where owner-facing notices (new sign-up, feedback) go: OWNER_EMAIL if set,
// else the first ADMIN_EMAILS entry, else the Gmail sender account itself.
function ownerEmail(): string | undefined {
  const firstAdmin = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .find(Boolean);
  return process.env.OWNER_EMAIL?.trim() || firstAdmin || senderAddress();
}

// User-typed text goes into these emails -- never let it become markup.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendOwnerEmail(subject: string, bodyHtml: string, replyTo?: string): Promise<EmailResult> {
  const to = ownerEmail();
  if (!to) {
    console.warn("No OWNER_EMAIL/ADMIN_EMAILS/GMAIL_USER — skipping owner email:", subject);
    return { ok: false, provider: emailProvider(), error: "Sem email de destino (OWNER_EMAIL)" };
  }
  return sendEmail(
    to,
    subject,
    `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
        ${bodyHtml}
        <p style="margin-top: 24px; font-size: 12px; color: #888;">Aviso automático do PAR.</p>
      </div>
    `,
    replyTo
  );
}

export async function sendNewSignupEmail(user: { email: string; displayName: string }): Promise<void> {
  const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  await sendOwnerEmail(
    `🎉 Novo cadastro no PAR.: ${user.displayName}`,
    `
      <h1 style="font-size: 20px;">Alguém novo entrou no PAR.</h1>
      <p><strong>Nome:</strong> ${escapeHtml(user.displayName)}<br />
      <strong>Email:</strong> ${escapeHtml(user.email)}<br />
      <strong>Quando:</strong> ${when}</p>
    `
  );
}

export async function sendWelcomeEmail(to: string, displayName: string): Promise<void> {
  await sendEmail(
    to,
    "Bem-vindo(a) ao PAR.! 🎉",
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 22px;">Olá, ${displayName}! 👋</h1>
        <p>Seja bem-vindo(a) ao <strong>PAR.</strong> — finanças em grupo, sem atrito.</p>
        <p>Você já pode criar um grupo ou aceitar um convite, lançar suas primeiras transações e acompanhar tudo em tempo real.</p>
        <p style="margin-top: 24px;">Bons controles financeiros! 💰</p>
      </div>
    `
  );
}

export async function sendReminderEmail(to: string, subject: string, bodyHtml: string): Promise<EmailResult> {
  return sendEmail(
    to,
    subject,
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        ${bodyHtml}
        <p style="margin-top: 24px; font-size: 12px; color: #888;">PAR. — finanças em grupo, sem atrito.</p>
      </div>
    `
  );
}
