import { FirebaseError } from "firebase/app";
import { ApiError } from "../api/client";

const MESSAGES: Record<string, string> = {
  "auth/email-already-in-use": "Esse email já tem uma conta.",
  "auth/invalid-credential": "Email ou senha incorretos.",
  "auth/invalid-email": "Email inválido.",
  "auth/weak-password": "Senha muito fraca (mínimo 6 caracteres).",
  "auth/popup-closed-by-user": "Login com Google cancelado.",
  "auth/network-request-failed": "Falha de conexão. Tente de novo.",
  "auth/too-many-requests": "Muitas tentativas. Espere um pouco e tente de novo.",
};

export function authErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof FirebaseError) {
    return MESSAGES[err.code] ?? fallback;
  }
  if (err instanceof ApiError) {
    return err.message;
  }
  return fallback;
}
