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
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  if (!transporter) {
    console.warn("GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping email to", to);
    return;
  }

  try {
    await transporter.sendMail({ from: `"PAR." <${env.gmailUser}>`, to, subject, html });
    console.log("Email sent to", to);
  } catch (err) {
    console.error("Failed to send email to", to, err);
  }
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
