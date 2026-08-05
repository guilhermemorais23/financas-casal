import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "../config/env";

// In an emulator, project ID + FIRESTORE_EMULATOR_HOST/FIREBASE_AUTH_EMULATOR_HOST
// env vars are all the Admin SDK needs -- no service account credentials.
if (getApps().length === 0) {
  initializeApp({ projectId: env.firebaseProjectId });
}

export const db = getFirestore();
export const auth = getAuth();
