import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { useToast } from "../components/ToastProvider";

type Mode = "choose" | "name" | "create" | "accept";

interface CreateGroupResponse {
  group: { id: string };
  inviteToken: string;
}

const EMOJI_OPTIONS = ["💜", "🏠", "👨‍👩‍👧", "🏖️", "🍻", "🐶", "💼", "✈️"];

function initialMode(params: URLSearchParams): Mode {
  if (params.get("convidar")) return "create";
  if (params.get("token") || params.get("convite")) return "accept";
  if (params.get("novo")) return "name";
  return "choose";
}

export function GroupSetupPage() {
  const { user, token, refreshUser, switchGroup } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Quem já tem grupo chega aqui pelo seletor de grupo, pra criar ou entrar
  // em mais um; "Voltar" leva de volta pro app em vez da tela de boas-vindas.
  const hasGroup = Boolean(user?.groupId);

  const [chosenMode, setMode] = useState<Mode>(() => initialMode(searchParams));
  const createdInvite = searchParams.get("convidar");
  // Lido da URL a cada render (e não só no início): trocar pro grupo novo
  // remonta a tela, às vezes antes da URL com o convite chegar.
  const mode: Mode = createdInvite ? "create" : chosenMode;
  const inviteLink = createdInvite ? `${window.location.origin}/invite/${createdInvite}` : null;
  const [acceptToken, setAcceptToken] = useState(searchParams.get("token") ?? "");
  const [groupName, setGroupName] = useState("");
  const [groupEmoji, setGroupEmoji] = useState(EMOJI_OPTIONS[0]);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function goBack() {
    if (hasGroup) navigate("/dashboard");
    else setMode("choose");
  }

  async function handleCreate(event?: FormEvent) {
    event?.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await apiRequest<CreateGroupResponse>("/groups", {
        method: "POST",
        token,
        body: { name: groupName, emoji: groupEmoji },
      });
      showToast("Grupo criado", { description: "Agora é só mandar o link do convite" });
      await refreshUser();
      // Trocar de grupo recarrega as telas; o link do convite vai na URL pra
      // continuar aparecendo depois disso.
      navigate(`/group-setup?convidar=${encodeURIComponent(response.inviteToken)}`, { replace: true });
      switchGroup(response.group.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar o grupo");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleAccept(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await apiRequest<{ group: { id: string } | null }>("/groups/accept", {
        method: "POST",
        token,
        body: { token: acceptToken.trim() },
      });
      await refreshUser();
      showToast("Você entrou no grupo");
      navigate("/dashboard");
      if (response.group) switchGroup(response.group.id);
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
          <h1>Convide seu grupo</h1>
          <p className="card-subtitle">Compartilhe este link com quem for entrar (pode ser mais de uma pessoa):</p>
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

  if (mode === "name") {
    return (
      <div className="page-center">
        <Brand />
        <div className="card">
          <h1>Novo grupo</h1>
          <p className="card-subtitle">
            {hasGroup
              ? "Um grupo separado dos que você já tem: quem entrar nele não vê os outros, e vice-versa."
              : "Dê um nome pro grupo. Dá pra mudar depois na tela Conta."}
          </p>
          <form onSubmit={handleCreate}>
            <div className="field">
              <label htmlFor="group-name">Nome do grupo</label>
              <input
                id="group-name"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Ex.: Eu & Ana, Casa da família"
                maxLength={40}
                autoFocus
              />
            </div>
            <div className="field">
              <span className="field-label" id="group-emoji-label">Ícone</span>
              <div className="group-emoji-options" role="radiogroup" aria-labelledby="group-emoji-label">
                {EMOJI_OPTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    role="radio"
                    aria-checked={groupEmoji === emoji}
                    className={`group-emoji-option${groupEmoji === emoji ? " active" : ""}`}
                    onClick={() => setGroupEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="alert" role="alert">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Criando..." : "Criar grupo"}
            </button>
          </form>
          <button type="button" className="btn btn-ghost" onClick={goBack}>
            Voltar
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
          <p className="card-subtitle">Cole o código que você recebeu.</p>
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
              {isSubmitting ? "Entrando..." : "Entrar no grupo"}
            </button>
          </form>
          <button type="button" className="btn btn-ghost" onClick={goBack}>
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
      <p className="onboarding-subtitle">Finanças em grupo, sem atrito.</p>
      {error && <p className="alert" role="alert">{error}</p>}
      <div className="onboarding-actions">
        <button type="button" className="btn btn-white" onClick={() => setMode("name")} disabled={isSubmitting}>
          Criar grupo
        </button>
        <button type="button" className="btn btn-outline-light" onClick={() => setMode("accept")}>
          Já tenho um convite
        </button>
      </div>
    </div>
  );
}
