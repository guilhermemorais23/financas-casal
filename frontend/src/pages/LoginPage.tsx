import { FirebaseError } from "firebase/app";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authErrorMessage } from "../auth/firebaseErrors";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { GoogleIcon } from "../components/GoogleIcon";
import { PasswordInput } from "../components/PasswordInput";
import { PENDING_INVITE_STORAGE_KEY } from "./AcceptInvitePage";

export function LoginPage() {
  const { login, loginWithGoogle, resetPassword } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
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
      // "user-not-found" is treated the same as success -- otherwise this
      // form would leak which emails have an account here.
      if (!(err instanceof FirebaseError) || err.code !== "auth/user-not-found") {
        setError(authErrorMessage(err, "Não foi possível enviar o email"));
        setIsResetting(false);
        return;
      }
    }
    setResetMessage("Se esse email tiver uma conta aqui, enviamos um link pra redefinir a senha.");
    setIsResetting(false);
  }

  async function handleGoogle() {
    setError(null);
    setIsGoogleSubmitting(true);
    try {
      await loginWithGoogle();
      goAfterAuth();
    } catch (err) {
      setError(authErrorMessage(err, "Não foi possível entrar com Google"));
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  if (isResetMode) {
    return (
      <div className="page-center">
        <Brand />
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
            <button type="submit" className="btn btn-primary" disabled={isResetting}>
              {isResetting ? "Enviando..." : "Enviar link"}
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
      </div>
    );
  }

  return (
    <div className="page-center">
      <Brand />
      <div className="card">
        <h1>Entrar</h1>
        <p className="card-subtitle">Finanças em grupo, sem atrito.</p>

        <button
          type="button"
          className="btn btn-google-icon"
          onClick={handleGoogle}
          disabled={isGoogleSubmitting}
          aria-label="Continuar com Google"
          title="Continuar com Google"
        >
          <GoogleIcon />
        </button>
        <div className="divider">ou</div>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="alert" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
      <p className="footnote">
        Não tem conta? <Link to="/register">Criar conta</Link>
      </p>
    </div>
  );
}
