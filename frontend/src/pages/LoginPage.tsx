import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authErrorMessage } from "../auth/firebaseErrors";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { GoogleIcon } from "../components/GoogleIcon";
import { PasswordInput } from "../components/PasswordInput";
import { PENDING_INVITE_STORAGE_KEY } from "./AcceptInvitePage";

export function LoginPage() {
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

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
            <label htmlFor="login-password">Senha</label>
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
