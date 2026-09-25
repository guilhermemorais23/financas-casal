import nodemailer from "nodemailer";
import { env } from "../config/env";

// Temporary stand-in for a real transactional provider (Resend, etc.) on a
// verified custom domain -- that needs a domain this project doesn't have
// yet, and sending from Resend's shared onboarding@resend.dev sandbox
// address (the fallback every unverified Resend account gets) lands in spam
// close to 100% of the time. A real personal Gmail account already carries
// its own sender reputation, so mail sent through Gmail's own SMTP tends to
// land in the inbox far more often -- at the cost of Gmail's own sending
// limits (~500/day on a personal account, comfortably above what this app's
// email volume needs) and the "from" address being a real @gmail.com
// instead of something branded.
const transporter =
  env.gmailUser && env.gmailAppPassword
    ? nodemailer.createTransport({
        service: "gmail",
        auth: { user: env.gmailUser, pass: env.gmailAppPassword },
      })
    : null;

// Best-effort: missing credentials or a failed send is logged, never thrown
// -- email is always a courtesy (welcome message, reminder), never something
// that should block the request that triggered it.
async function sendEmail(to: string, subject: string, html: string, replyTo?: string): Promise<void> {
  if (!transporter) {
    console.warn("GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping email to", to);
    return;
  }

  try {
    await transporter.sendMail({ from: `"PAR." <${env.gmailUser}>`, to, subject, html, replyTo });
    console.log("Email sent to", to);
  } catch (err) {
    console.error("Failed to send email to", to, err);
  }
}

// Where owner-facing notices (new sign-up, feedback) go: OWNER_EMAIL if set,
// else the first ADMIN_EMAILS entry, else the Gmail sender account itself.
function ownerEmail(): string | undefined {
  const firstAdmin = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .find(Boolean);
  return process.env.OWNER_EMAIL?.trim() || firstAdmin || env.gmailUser;
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

export async function sendOwnerEmail(subject: string, bodyHtml: string, replyTo?: string): Promise<void> {
  const to = ownerEmail();
  if (!to) {
    console.warn("No OWNER_EMAIL/ADMIN_EMAILS/GMAIL_USER — skipping owner email:", subject);
    return;
  }
  await sendEmail(
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

export async function sendReminderEmail(to: string, subject: string, bodyHtml: string): Promise<void> {
  await sendEmail(
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
