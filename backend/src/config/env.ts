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
  // Optional: no key means the welcome email is skipped (logged, not thrown).
  resendApiKey: process.env.RESEND_API_KEY,
  resendFromEmail: process.env.RESEND_FROM_EMAIL ?? "PAR. <onboarding@resend.dev>",
  // Shared secret for POST /api/reminders/run -- an external daily cron
  // (same cron-job.org setup already used for the health-check keep-alive)
  // calls it with this as the x-cron-secret header. Unset means the route
  // refuses every call, same "off by default" posture as a missing Resend key.
  cronSecret: process.env.CRON_SECRET,
};
