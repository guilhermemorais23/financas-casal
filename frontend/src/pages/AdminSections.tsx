import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ChatBubbles, KIND_LABELS, type FeedbackKind, type FeedbackMessage } from "../components/FeedbackChat";
import { Icon } from "../components/Icon";
import { useToast } from "../components/ToastProvider";

interface FeedbackThread {
  id: string;
  email: string;
  displayName: string;
  lastMessage: string;
  lastFrom: "user" | "team" | "auto";
  lastKind: FeedbackKind | null;
  lastMessageAt: number;
  unreadForTeam: number;
}

const QUICK_REPLIES = [
  "Obrigado pelo carinho! Isso ajuda muito a gente a continuar.",
  "Valeu por avisar! Já corrigimos, é só atualizar o app.",
  "Boa ideia! Anotei aqui e te aviso quando sair.",
];

function when(ms: number): string {
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// Admin > Feedback: todas as conversas do "Fale com a gente", as mais
// recentes primeiro. Aguardando = a última palavra foi da pessoa (ou do
// agradecimento automático).
export function AdminFeedback() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [threads, setThreads] = useState<FeedbackThread[] | null>(null);
  const [filter, setFilter] = useState<"waiting" | "all">("waiting");
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<FeedbackMessage[]>([]);
  const [reply, setReply] = useState("");
  const [isSending, setIsSending] = useState(false);

  function loadThreads() {
    apiRequest<{ threads: FeedbackThread[] }>("/feedback/threads", { token })
      .then((res) => setThreads(res.threads))
      .catch(() => setThreads([]));
  }

  useEffect(loadThreads, [token]);

  async function openThread(id: string) {
    setOpenId(id);
    setMessages([]);
    setReply("");
    const res = await apiRequest<{ messages: FeedbackMessage[] }>(`/feedback/threads/${id}`, { token });
    setMessages(res.messages);
    setThreads((prev) => prev?.map((t) => (t.id === id ? { ...t, unreadForTeam: 0 } : t)) ?? prev);
  }

  async function handleReply(event: FormEvent) {
    event.preventDefault();
    if (!openId || reply.trim().length < 2) return;
    setIsSending(true);
    try {
      const res = await apiRequest<{ messages: FeedbackMessage[] }>(`/feedback/threads/${openId}/reply`, {
        method: "POST",
        token,
        body: { message: reply.trim() },
      });
      setMessages(res.messages);
      setReply("");
      showToast("Resposta enviada", { description: "A pessoa vê no app e recebe um email" });
      loadThreads();
    } catch (err) {
      showToast("Não foi possível responder", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setIsSending(false);
    }
  }

  const waiting = (threads ?? []).filter((t) => t.lastFrom !== "team");
  const visible = filter === "waiting" ? waiting : threads ?? [];
  const open = threads?.find((t) => t.id === openId) ?? null;

  if (open) {
    return (
      <div className="card admin-thread">
        <button type="button" className="link-button" onClick={() => setOpenId(null)}>
          ← Todas as conversas
        </button>
        <p className="card-title">{open.displayName}</p>
        <p className="card-subtitle">{open.email}</p>
        <div className="admin-thread-messages">
          <ChatBubbles messages={messages} mine="team" />
        </div>
        <form onSubmit={handleReply} className="admin-reply">
          <div className="admin-quick-replies">
            {QUICK_REPLIES.map((quick) => (
              <button key={quick} type="button" className="chat-kind-pick" onClick={() => setReply(quick)}>
                {quick.split("!")[0]}!
              </button>
            ))}
          </div>
          <label htmlFor="admin-reply" className="visually-hidden">
            Resposta
          </label>
          <textarea
            id="admin-reply"
            rows={4}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={`Responder ${open.displayName.split(" ")[0]}...`}
          />
          <button type="submit" className="btn btn-primary" disabled={isSending || reply.trim().length < 2}>
            {isSending ? "Enviando..." : "Enviar resposta"}
          </button>
          <p className="field-hint">A pessoa vê a resposta no app e recebe um email avisando.</p>
        </form>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="admin-feedback-filters">
        <button type="button" className={`chat-kind-pick${filter === "waiting" ? " active" : ""}`} onClick={() => setFilter("waiting")}>
          Aguardando ({waiting.length})
        </button>
        <button type="button" className={`chat-kind-pick${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>
          Todas ({threads?.length ?? 0})
        </button>
      </div>
      {threads === null ? (
        <p className="empty-state">Carregando...</p>
      ) : visible.length === 0 ? (
        <p className="empty-state">{filter === "waiting" ? "Nenhuma conversa esperando resposta." : "Ninguém mandou feedback ainda."}</p>
      ) : (
        <ul className="admin-thread-list">
          {visible.map((thread) => (
            <li key={thread.id}>
              <button type="button" className={`admin-thread-row${thread.unreadForTeam > 0 ? " unread" : ""}`} onClick={() => openThread(thread.id)}>
                <span className="loan-avatar" aria-hidden="true">
                  {thread.displayName.charAt(0).toUpperCase()}
                </span>
                <span className="admin-thread-info">
                  <span className="admin-thread-top">
                    <strong className="text-truncate">{thread.displayName}</strong>
                    <small>{when(thread.lastMessageAt)}</small>
                  </span>
                  {thread.lastKind && <span className={`chat-kind kind-${thread.lastKind}`}>{KIND_LABELS[thread.lastKind]}</span>}
                  <span className="text-truncate admin-thread-last">
                    {thread.lastFrom === "team" ? "Você: " : ""}
                    {thread.lastMessage}
                  </span>
                </span>
                {thread.unreadForTeam > 0 && <span className="unread-badge">{thread.unreadForTeam}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Diagnostics {
  email: { provider: "brevo" | "gmail-smtp" | "none"; brevoKey: boolean; from: boolean; gmailSmtp: boolean; ownerEmail: boolean };
  ai: { geminiKey: boolean };
  reminders: { cronSecret: boolean };
}

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className={`diag-row${ok ? " ok" : " bad"}`}>
      <span className="diag-icon" aria-hidden="true">
        <Icon name={ok ? "check" : "alert"} />
      </span>
      <span className="diag-text">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </li>
  );
}

// Admin > Diagnóstico: a produção está mesmo configurada, e funciona?
export function AdminDiagnostics() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [testing, setTesting] = useState<"email" | "ai" | null>(null);

  useEffect(() => {
    apiRequest<Diagnostics>("/admin/diagnostics", { token }).then(setDiag).catch(() => setDiag(null));
  }, [token]);

  async function run(kind: "email" | "ai") {
    setTesting(kind);
    try {
      const res = await apiRequest<{ ok: boolean; to?: string }>(`/admin/test-${kind}`, { method: "POST", token });
      showToast(kind === "email" ? "Email de teste enviado" : "A IA respondeu", {
        description: kind === "email" ? `Confira a caixa de ${res.to} (e o spam)` : "Está funcionando",
      });
    } catch (err) {
      showToast(kind === "email" ? "O email não saiu" : "A IA não respondeu", {
        variant: "error",
        description: err instanceof ApiError ? err.message : undefined,
        durationMs: 9000,
      });
    } finally {
      setTesting(null);
    }
  }

  if (!diag) return <p className="empty-state">Carregando...</p>;

  const providerLabel =
    diag.email.provider === "brevo" ? "Brevo (API)" : diag.email.provider === "gmail-smtp" ? "Gmail SMTP" : "nenhum";

  return (
    <>
      <div className="card">
        <p className="card-title">Emails</p>
        <ul className="diag-list">
          <Check
            ok={diag.email.provider === "brevo"}
            label={`Provedor: ${providerLabel}`}
            hint={
              diag.email.provider === "brevo"
                ? undefined
                : "O Render grátis bloqueia Gmail SMTP. Crie uma chave em brevo.com e coloque BREVO_API_KEY no Render."
            }
          />
          <Check ok={diag.email.from} label="Remetente definido" hint={diag.email.from ? undefined : "EMAIL_FROM (o email verificado na Brevo)"} />
          <Check ok={diag.email.ownerEmail} label="Seu email pros avisos" hint={diag.email.ownerEmail ? undefined : "OWNER_EMAIL ou ADMIN_EMAILS"} />
        </ul>
        <button type="button" className="btn btn-outline btn-sm" disabled={testing !== null} onClick={() => run("email")}>
          {testing === "email" ? "Enviando..." : "Mandar email de teste pra mim"}
        </button>
      </div>
      <div className="card">
        <p className="card-title">Assistente (IA)</p>
        <ul className="diag-list">
          <Check
            ok={diag.ai.geminiKey}
            label="Chave do Gemini"
            hint={diag.ai.geminiKey ? undefined : "Sem ela o assistente responde só com os números do mês. Chave grátis em aistudio.google.com/apikey → GEMINI_API_KEY."}
          />
        </ul>
        <button type="button" className="btn btn-outline btn-sm" disabled={testing !== null} onClick={() => run("ai")}>
          {testing === "ai" ? "Testando..." : "Testar a IA agora"}
        </button>
      </div>
      <div className="card">
        <p className="card-title">Lembretes diários</p>
        <ul className="diag-list">
          <Check ok label="Rodam sozinhos 1x por dia" hint="No primeiro acesso depois das 8h, mesmo sem o cron." />
          <Check ok={diag.reminders.cronSecret} label="Cron externo (opcional)" hint={diag.reminders.cronSecret ? undefined : "CRON_SECRET não configurado"} />
        </ul>
      </div>
    </>
  );
}
