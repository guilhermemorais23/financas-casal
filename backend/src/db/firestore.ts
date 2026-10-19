// CONEXÃO COM O BANCO (Firestore) E COM O LOGIN (Firebase Auth), do lado do
// servidor. O "Admin SDK" é a chave de administrador: lê e grava qualquer
// documento, sem passar pelas regras de segurança do Firestore. Por isso só
// o backend tem essa chave, e quem decide quem pode ver o quê é o código dos
// services (conferindo dono e grupo), e não o banco.
//
// O Firestore guarda "documentos" (parecidos com objetos JSON) dentro de
// "coleções" (ex.: a coleção "debts" tem um documento por dívida). Os
// repositories usam o `db` daqui: db.collection("debts").doc(id).get().
//
// Em produção, as credenciais vêm de GOOGLE_APPLICATION_CREDENTIALS (um
// arquivo secreto no Render, ver DEPLOY.md).
import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "../config/env";

// No emulador, o ID do projeto + as variáveis FIRESTORE_EMULATOR_HOST /
// FIREBASE_AUTH_EMULATOR_HOST bastam pro Admin SDK -- não precisa de chave de
// conta de serviço.
if (getApps().length === 0) {
  initializeApp({ projectId: env.firebaseProjectId });
}

export const db = getFirestore();
export const auth = getAuth();
