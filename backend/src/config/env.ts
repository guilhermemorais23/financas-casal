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
};
