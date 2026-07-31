import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";

type Mode = "choose" | "create" | "accept";

interface CreateCoupleResponse {
  couple: { id: string };
  inviteToken: string;
}

export function CoupleSetupPage() {
  const { token, refreshUser } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [mode, setMode] = useState<Mode>(searchParams.get("token") ? "accept" : "choose");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [acceptToken, setAcceptToken] = useState(searchParams.get("token") ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreate() {
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await apiRequest<CreateCoupleResponse>("/couples", {
        method: "POST",
        token,
      });
      setInviteLink(`${window.location.origin}/invite/${response.inviteToken}`);
      setMode("create");
      await refreshUser();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar o casal");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAccept(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest("/couples/accept", {
        method: "POST",
        token,
        body: { token: acceptToken },
      });
      await refreshUser();
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível aceitar o convite");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (mode === "create") {
    return (
      <div className="page-center">
        <Brand />
        <div className="card">
          <h1>Convide seu par</h1>
          <p className="card-subtitle">Compartilhe este link com seu parceiro(a):</p>
          <div className="invite-link-row">
            <input readOnly value={inviteLink ?? ""} onFocus={(e) => e.target.select()} />
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => inviteLink && navigator.clipboard.writeText(inviteLink)}
            >
              Copiar
            </button>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/dashboard")}>
            Ir para o painel
          </button>
        </div>
      </div>
    );
  }

  if (mode === "accept") {
    return (
      <div className="page-center">
        <Brand />
        <div className="card">
          <h1>Já tenho um convite</h1>
          <p className="card-subtitle">Cole o código que seu parceiro(a) te enviou.</p>
          <form onSubmit={handleAccept}>
            <div className="field">
              <label htmlFor="invite-token">Código do convite</label>
              <input
                id="invite-token"
                value={acceptToken}
                onChange={(e) => setAcceptToken(e.target.value)}
                required
              />
            </div>
            {error && <p className="alert" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Entrando..." : "Entrar no casal"}
            </button>
          </form>
          <button type="button" className="btn btn-ghost" onClick={() => setMode("choose")}>
            Voltar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="onboarding-screen">
      <div className="onboarding-avatars">
        <div className="circle" />
        <div className="circle" />
      </div>
      <h1>Bem-vindos ao PAR.</h1>
      <p className="onboarding-subtitle">Finanças a dois, sem atrito.</p>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="onboarding-actions">
        <button type="button" className="btn btn-white" onClick={handleCreate} disabled={isSubmitting}>
          Criar conta do casal
        </button>
        <button type="button" className="btn btn-outline-light" onClick={() => setMode("accept")}>
          Já tenho um convite
        </button>
      </div>
    </div>
  );
}
