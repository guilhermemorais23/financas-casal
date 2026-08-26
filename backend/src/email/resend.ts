import { Resend } from "resend";
import { env } from "../config/env";

const resend = env.resendApiKey ? new Resend(env.resendApiKey) : null;

// Best-effort: a missing key or a failed send is logged, never thrown --
// email is a nice-to-have on the sign-up path, not something that should
// block a new user from getting into the app.
export async function sendWelcomeEmail(to: string, displayName: string): Promise<void> {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping welcome email to", to);
    return;
  }

  try {
    // The SDK returns { data, error } rather than throwing on API-level
    // failures (e.g. blocked test domains), so both paths must be checked.
    const { data, error } = await resend.emails.send({
      from: env.resendFromEmail,
      to,
      subject: "Bem-vindo(a) ao PAR.! 🎉",
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          <h1 style="font-size: 22px;">Olá, ${displayName}! 👋</h1>
          <p>Seja bem-vindo(a) ao <strong>PAR.</strong> — finanças em grupo, sem atrito.</p>
          <p>Você já pode criar um grupo ou aceitar um convite, lançar suas primeiras transações e acompanhar tudo em tempo real.</p>
          <p style="margin-top: 24px;">Bons controles financeiros! 💰</p>
        </div>
      `,
    });
    if (error) {
      console.error("Resend rejected welcome email to", to, error);
    } else {
      console.log("Welcome email sent to", to, "id=", data?.id);
    }
  } catch (err) {
    console.error("Failed to send welcome email to", to, err);
  }
}

// Same best-effort contract as sendWelcomeEmail: a missing key or a failed
// send is logged, never thrown -- a reminder is a courtesy, not something
// that should ever break the daily cron run for every other group.
export async function sendReminderEmail(to: string, subject: string, bodyHtml: string): Promise<void> {
  if (!resend) {
    console.warn("RESEND_API_KEY not set — skipping reminder email to", to);
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: env.resendFromEmail,
      to,
      subject,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
          ${bodyHtml}
          <p style="margin-top: 24px; font-size: 12px; color: #888;">PAR. — finanças em grupo, sem atrito.</p>
        </div>
      `,
    });
    if (error) {
      console.error("Resend rejected reminder email to", to, error);
    } else {
      console.log("Reminder email sent to", to, "id=", data?.id);
    }
  } catch (err) {
    console.error("Failed to send reminder email to", to, err);
  }
}
