import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

const app = initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
});

export const firebaseAuth = getAuth(app);

const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST;
if (emulatorHost) {
  connectAuthEmulator(firebaseAuth, emulatorHost, { disableWarnings: true });
}
