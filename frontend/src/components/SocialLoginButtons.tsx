import { FirebaseError } from "firebase/app";
import { useState } from "react";
import { useAuth, type SocialProvider } from "../auth/AuthContext";
import { authErrorMessage } from "../auth/firebaseErrors";
import { AppleIcon } from "./AppleIcon";
import { GoogleIcon } from "./GoogleIcon";

const LABELS: Record<SocialProvider, string> = { google: "Google", apple: "Apple" };

// "Continuar com Google / Apple" -- shared by Entrar and Criar conta, since
// both do the exact same thing (the first sign-in creates the account).
export function SocialLoginButtons({
  onSuccess,
  onError,
}: {
  onSuccess: () => void;
  onError: (message: string | null) => void;
}) {
  const { loginWithProvider } = useAuth();
  const [busy, setBusy] = useState<SocialProvider | null>(null);

  async function handle(provider: SocialProvider) {
    onError(null);
    setBusy(provider);
    try {
      // false = the popup wasn't possible (iPhone app na tela de início) and
      // the page is being sent to the provider instead; nothing to do here.
      if (await loginWithProvider(provider)) onSuccess();
    } catch (err) {
      if (err instanceof FirebaseError && err.code === "auth/operation-not-allowed") {
        onError(`Entrar com ${LABELS[provider]} ainda não está ativado.`);
      } else {
        onError(authErrorMessage(err, `Não foi possível entrar com ${LABELS[provider]}`));
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="social-login-row">
      {(["google", "apple"] as const).map((provider) => (
        <button
          key={provider}
          type="button"
          className={`btn btn-social btn-social-${provider}`}
          onClick={() => handle(provider)}
          disabled={busy !== null}
          aria-label={`Continuar com ${LABELS[provider]}`}
        >
          {provider === "google" ? <GoogleIcon /> : <AppleIcon />}
          <span>{LABELS[provider]}</span>
        </button>
      ))}
    </div>
  );
}
