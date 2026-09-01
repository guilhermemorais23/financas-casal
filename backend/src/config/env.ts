import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST come from .env in
// local dev (see backend/.env.example) and must be read before anything
// calls initializeApp()/getFirestore() -- the "dotenv/config" import above
// already ran, so process.env is populated by the time db/firestore.ts
// initializes the Admin SDK. Leave them unset in production so the SDK
// targets the real project instead.

export const env = {
  firebaseProjectId: required("FIREBASE_PROJECT_ID"),
  port: Number(process.env.PORT ?? 4000),
  // Optional: no credentials means email sending is skipped (logged, not
  // thrown). Sends via Gmail's own SMTP using a personal account + an App
  // Password (not the account's real password -- generated under Google
  // Account > Security > 2-Step Verification > App passwords, only
  // available once 2FA is on). A temporary stand-in for a proper
  // transactional provider (Resend, etc.) on a verified custom domain --
  // that needs a domain this project doesn't have yet.
  gmailUser: process.env.GMAIL_USER,
  gmailAppPassword: process.env.GMAIL_APP_PASSWORD,
  // Shared secret for POST /api/reminders/run -- an external daily cron
  // (same cron-job.org setup already used for the health-check keep-alive)
  // calls it with this as the x-cron-secret header. Unset means the route
  // refuses every call, same "off by default" posture as a missing Resend key.
  cronSecret: process.env.CRON_SECRET,
};
