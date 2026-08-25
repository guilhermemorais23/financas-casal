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
  "auth/wrong-password": "Senha incorreta.",
  "auth/requires-recent-login": "Por segurança, confirme sua senha atual pra trocar o email.",
  "auth/operation-not-allowed": "Sua conta usa login do Google -- o email é gerenciado por lá.",
  "auth/email-already-exists": "Esse email já está em uso por outra conta.",
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
