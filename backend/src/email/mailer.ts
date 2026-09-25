import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logError } from "../utils/errorLog";

// O plano grátis do Render bloqueia SMTP de saída (portas 25/465/587) desde
// 26/09/2025, então o Gmail SMTP só dá timeout em produção -- por isso os
// emails de boas-vindas pararam de chegar. A API HTTPS da Brevo sai pela
// porta 443 e funciona lá: plano grátis (~300 emails/dia) com um único
// remetente verificado (o mesmo Gmail serve), sem precisar de domínio. O
// Gmail SMTP fica de reserva pro dev local ou pra uma instância paga.
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

// Melhor esforço: sem provedor ou com falha no envio, fica registrado (e
// aparece em Admin > Logs), nunca lança erro -- email é sempre uma cortesia,
// nunca algo que deva travar a requisição que o disparou. O resultado diz a
// quem se importa (lembretes, o botão de teste do admin) se o email saiu de
// verdade.
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

// Pra onde vão os avisos pro dono (cadastro novo, feedback): OWNER_EMAIL se
// existir, senão o primeiro de ADMIN_EMAILS, senão o próprio remetente.
function ownerEmail(): string | undefined {
  const firstAdmin = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .find(Boolean);
  return process.env.OWNER_EMAIL?.trim() || firstAdmin || senderAddress();
}

// Texto digitado pelo usuário entra nesses emails -- nunca deixar virar HTML.
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
    `Novo cadastro no PAR.: ${user.displayName}`,
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
    "Bem-vindo(a) ao PAR.",
    `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
        <h1 style="font-size: 22px;">Olá, ${displayName}!</h1>
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
