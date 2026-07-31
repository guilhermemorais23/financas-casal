import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { PENDING_INVITE_STORAGE_KEY } from "./AcceptInvitePage";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      const pendingInviteToken = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
      if (pendingInviteToken) {
        sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
        navigate(`/couple-setup?token=${pendingInviteToken}`);
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível entrar");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-center">
      <Brand />
      <div className="card">
        <h1>Entrar</h1>
        <p className="card-subtitle">Finanças a dois, sem atrito.</p>
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
            <input
              id="login-password"
              type="password"
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
