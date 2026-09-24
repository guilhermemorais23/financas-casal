import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { authErrorMessage } from "../auth/firebaseErrors";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { SocialLoginButtons } from "../components/SocialLoginButtons";
import { PasswordInput } from "../components/PasswordInput";
import { SlowServerHint, Spinner } from "../components/Spinner";
import { PENDING_INVITE_STORAGE_KEY } from "./AcceptInvitePage";

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  function goAfterAuth() {
    const pendingInviteToken = sessionStorage.getItem(PENDING_INVITE_STORAGE_KEY);
    if (pendingInviteToken) {
      sessionStorage.removeItem(PENDING_INVITE_STORAGE_KEY);
      navigate(`/group-setup?token=${pendingInviteToken}`);
    } else {
      navigate("/dashboard");
    }
  }

  function celebrateThenGo() {
    setJustCreated(true);
    setTimeout(goAfterAuth, 1300);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await register(email, password, displayName);
      celebrateThenGo();
    } catch (err) {
      setError(authErrorMessage(err, "Não foi possível criar a conta"));
      setIsSubmitting(false);
    }
  }

  if (justCreated) {
    return (
      <div className="page-center">
        <div className="success-check">
          <svg viewBox="0 0 52 52" width="64" height="64">
            <circle className="success-check-circle" cx="26" cy="26" r="24" fill="none" />
            <path className="success-check-mark" fill="none" d="M14 27l8 8 16-16" />
          </svg>
        </div>
        <h1>Conta criada!</h1>
        <p className="card-subtitle">Já estamos te levando pra lá...</p>
      </div>
    );
  }

  return (
    <div className="page-center">
      <Brand />
      <div className="card">
        <h1>Criar conta</h1>
        <p className="card-subtitle">Grátis para começar. Sem cartão necessário.</p>

        <SocialLoginButtons onSuccess={celebrateThenGo} onError={setError} />
        <div className="divider">ou</div>

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
            <PasswordInput
              id="register-password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="alert" role="alert">{error}</p>}
          <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? (
              <>
                <Spinner className="spinner-on-primary" /> Criando...
              </>
            ) : (
              "Criar conta"
            )}
          </button>
          <SlowServerHint active={isSubmitting} />
        </form>
      </div>
      <p className="footnote">
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
      <p className="footnote footnote-muted">
        Ao criar a conta você concorda com a <Link to="/privacidade">política de privacidade</Link>.
      </p>
    </div>
  );
}
