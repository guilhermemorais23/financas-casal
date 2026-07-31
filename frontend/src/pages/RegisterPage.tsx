import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { PENDING_INVITE_STORAGE_KEY } from "./AcceptInvitePage";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await register(email, password, displayName);
      const pendingInviteToken = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
      if (pendingInviteToken) {
        sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
        navigate(`/couple-setup?token=${pendingInviteToken}`);
      } else {
        navigate("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a conta");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-center">
      <Brand />
      <div className="card">
        <h1>Criar conta</h1>
        <p className="card-subtitle">Grátis para começar. Sem cartão necessário.</p>
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="register-name">Nome</label>
            <input
              id="register-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="register-email">Email</label>
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="register-password">Senha</label>
            <input
              id="register-password"
              type="password"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="alert" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
            {isSubmitting ? "Criando..." : "Criar conta"}
          </button>
        </form>
      </div>
      <p className="footnote">
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
    </div>
  );
}
