import { FirebaseError } from "firebase/app";
import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { authErrorMessage } from "../auth/firebaseErrors";
import { useAuth } from "../auth/AuthContext";
import { AuthShell } from "../components/AuthShell";
import { SocialLoginButtons } from "../components/SocialLoginButtons";
import { PasswordInput } from "../components/PasswordInput";
import { LoadingScreen, SlowServerHint, Spinner } from "../components/Spinner";
import { PENDING_INVITE_STORAGE_KEY } from "./AcceptInvitePage";

// Só o email fica no aparelho. A senha quem guarda é o próprio celular (Chaves
// do iCloud / Gerenciador de senhas do Google), que oferece salvar e preencher
// com Face ID porque os campos dizem o que são (autoComplete).
const REMEMBERED_EMAIL_KEY = "par:remembered-email";

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveRememberedEmail(email: string | null): void {
  try {
    if (email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // ignora -- só deixa de lembrar
  }
}

export function LoginPage() {
  const { user, isLoading, login, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(readRememberedEmail);
  const [rememberEmail, setRememberEmail] = useState(true);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetMode, setIsResetMode] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  function goAfterAuth() {
    const pendingInviteToken = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (pendingInviteToken) {
      sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
      navigate(`/group-setup?token=${pendingInviteToken}`);
    } else {
      navigate("/dashboard");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      saveRememberedEmail(rememberEmail ? email.trim() : null);
      goAfterAuth();
    } catch (err) {
      setError(authErrorMessage(err, "Não foi possível entrar"));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResetPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setResetMessage(null);

    if (!email.trim()) {
      setError("Informe seu email pra receber o link de redefinição.");
      return;
    }

    setIsResetting(true);
    try {
      await resetPassword(email.trim());
    } catch (err) {
      // "user-not-found" é tratado igual a sucesso -- senão este formulário
      // entregaria quais e-mails têm conta aqui.
      if (!(err instanceof FirebaseError) || err.code !== "auth/user-not-found") {
        setError(authErrorMessage(err, "Não foi possível enviar o email"));
        setIsResetting(false);
        return;
      }
    }
    setResetMessage("Se esse email tiver uma conta aqui, enviamos um link pra redefinir a senha.");
    setIsResetting(false);
  }

  // O ícone da tela de início abre em "/" -> /login. Com a sessão ainda
  // valendo, entra direto (convite pendente segue o caminho do goAfterAuth).
  if (isLoading) return <LoadingScreen />;
  if (user && !isSubmitting && !sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY)) {
    return <Navigate to="/dashboard" replace />;
  }

  if (isResetMode) {
    return (
      <AuthShell>
        <div className="card">
          <h1>Redefinir senha</h1>
          <p className="card-subtitle">Informe seu email e mandamos um link pra você trocar a senha.</p>

          <form onSubmit={handleResetPassword}>
            <div className="field">
              <label htmlFor="reset-email">Email</label>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {error && <p className="alert" role="alert">{error}</p>}
            {resetMessage && <p className="card-subtitle">{resetMessage}</p>}
            <button type="submit" className="btn btn-primary" disabled={isResetting} aria-busy={isResetting}>
              {isResetting ? (
                <>
                  <Spinner className="spinner-on-primary" /> Enviando...
                </>
              ) : (
                "Enviar link"
              )}
            </button>
          </form>
        </div>
        <p className="footnote">
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setIsResetMode(false);
              setError(null);
              setResetMessage(null);
            }}
          >
            Voltar pro login
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="card auth-card">
        <h1>Entrar</h1>

        <SocialLoginButtons onSuccess={goAfterAuth} onError={setError} />
        <div className="divider">ou</div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <div className="field-label-row">
              <label htmlFor="login-password">Senha</label>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setIsResetMode(true);
                  setError(null);
                  setResetMessage(null);
                }}
              >
                Esqueceu a senha?
              </button>
            </div>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <label className="checkbox-field">
            <input type="checkbox" checked={rememberEmail} onChange={(e) => setRememberEmail(e.target.checked)} />
            Lembrar meu email
          </label>
          {error && <p className="alert" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? (
              <>
                <Spinner className="spinner-on-primary" /> Entrando...
              </>
            ) : (
              "Entrar"
            )}
          </button>
          <SlowServerHint active={isSubmitting} />
        </form>
      </div>
      <p className="footnote">
        Não tem conta? <Link to="/register">Criar conta</Link>
      </p>
      <p className="footnote footnote-muted">
        <Link to="/termos">Termos de uso</Link> · <Link to="/privacidade">Política de privacidade</Link>
      </p>
    </AuthShell>
  );
}
