// Liga o Firebase no navegador -- só a parte de LOGIN (Firebase Auth).
// O login acontece direto entre o navegador e o Firebase: o app recebe um
// token, e é esse token que o api/client.ts manda pro backend em todo pedido.
// O navegador NUNCA fala direto com o banco (Firestore); quem lê e grava é
// sempre o backend.
//
// As variáveis VITE_FIREBASE_* dizem qual projeto do Firebase usar:
//   - no seu PC: o projeto falso "demo-par", e VITE_FIREBASE_AUTH_EMULATOR_HOST
//     aponta pro emulador local (http://127.0.0.1:9099), então nada toca na
//     produção;
//   - em produção: o projeto real "par-projeto" (vem dos secrets do CI), sem
//     emulador.
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
