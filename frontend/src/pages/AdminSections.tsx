import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ChatBubbles, KIND_LABELS, type FeedbackKind, type FeedbackMessage } from "../components/FeedbackChat";
import { AnnouncementContent, type Announcement } from "../components/AnnouncementPopup";
import { useConfirm } from "../components/ConfirmDialog";
import { Icon, type IconName } from "../components/Icon";
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

// ---------------------------------------------------------------------------
// Admin > Novidades: pop-ups que aparecem no app, pra todo mundo ou pra uma
// pessoa só. Cada pessoa vê cada pop-up uma vez.
// ---------------------------------------------------------------------------

interface Person {
  id: string;
  displayName: string;
  email: string;
}

interface AnnouncementDraft {
  icon: IconName;
  tag: string;
  title: string;
  text: string;
  bullets: string;
  ctaLabel: string;
  ctaPath: string;
  audience: "all" | "user";
  targetUserId: string;
}

const EMPTY_DRAFT: AnnouncementDraft = {
  icon: "spark",
  tag: "Novidade",
  title: "",
  text: "",
  bullets: "",
  ctaLabel: "",
  ctaPath: "",
  audience: "all",
  targetUserId: "",
};

// Modelos prontos: escolha um e só troque o texto.
const TEMPLATES: { label: string; draft: Partial<AnnouncementDraft> }[] = [
  {
    label: "Nova função",
    draft: {
      icon: "spark",
      tag: "Novidade",
      title: "Chegou: ",
      text: "Conta em uma frase o que mudou e por que ajuda.",
      bullets: "O que dá pra fazer\nOnde encontrar",
      ctaLabel: "Ver agora",
      ctaPath: "/dashboard",
      audience: "all",
    },
  },
  {
    label: "Aviso geral",
    draft: { icon: "info", tag: "Aviso", title: "", text: "", bullets: "", ctaLabel: "", ctaPath: "", audience: "all" },
  },
  {
    label: "Manutenção",
    draft: {
      icon: "wrench",
      tag: "Manutenção",
      title: "App fora do ar por alguns minutos",
      text: "Hoje às 23h vamos fazer uma atualização. Seus dados ficam guardados; se algo não abrir nesse horário, é só tentar de novo em seguida.",
      bullets: "",
      ctaLabel: "",
      ctaPath: "",
      audience: "all",
    },
  },
  {
    label: "Recado pessoal",
    draft: { icon: "chat", tag: "Pra você", title: "", text: "", bullets: "", ctaLabel: "", ctaPath: "", audience: "user" },
  },
];

const ICON_CHOICES: IconName[] = ["spark", "info", "alert", "heart", "chat", "wrench", "home", "coin", "chart", "target", "card", "cart"];

const SCREENS: { path: string; label: string }[] = [
  { path: "/dashboard", label: "Painel" },
  { path: "/par", label: "Par" },
  { path: "/transactions/new", label: "Novo lançamento" },
  { path: "/reports", label: "Relatórios" },
  { path: "/cards", label: "Cartões" },
  { path: "/debts", label: "Dívidas" },
  { path: "/recurring-bills", label: "Contas fixas" },
  { path: "/loans", label: "A receber" },
  { path: "/goals", label: "Metas" },
  { path: "/investments", label: "Investimentos" },
  { path: "/shopping", label: "Lista de compras" },
  { path: "/account", label: "Conta e grupo" },
];

function bulletsOf(draft: AnnouncementDraft): string[] {
  return draft.bullets
    .split("\n")
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function AdminAnnouncements() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<AnnouncementDraft>(EMPTY_DRAFT);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [sent, setSent] = useState<Announcement[] | null>(null);
  const [isSending, setIsSending] = useState(false);

  function loadSent() {
    apiRequest<{ announcements: Announcement[] }>("/announcements", { token })
      .then((res) => setSent(res.announcements))
      .catch(() => setSent([]));
  }

  useEffect(loadSent, [token]);

  // A lista de pessoas só é baixada quando o admin escolhe "Uma pessoa".
  useEffect(() => {
    if (draft.audience !== "user" || people !== null) return;
    apiRequest<{ people: Person[] }>("/announcements/people", { token })
      .then((res) => setPeople(res.people))
      .catch(() => setPeople([]));
  }, [draft.audience, people, token]);

  function set<K extends keyof AnnouncementDraft>(key: K, value: AnnouncementDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  const target = people?.find((p) => p.id === draft.targetUserId) ?? null;
  const query = personQuery.trim().toLowerCase();
  const matches = (people ?? [])
    .filter((p) => !query || p.displayName.toLowerCase().includes(query) || p.email.toLowerCase().includes(query))
    .slice(0, 8);

  const missing =
    draft.title.trim().length < 2
      ? "Falta o título"
      : draft.text.trim().length < 2
        ? "Falta o texto"
        : draft.audience === "user" && !target
          ? "Escolha a pessoa"
          : draft.ctaPath && !draft.ctaLabel.trim()
            ? "Dê um nome pro botão"
            : null;

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (missing) return;
    const who = draft.audience === "all" ? "todo mundo" : target!.displayName || target!.email;
    const ok = await confirm({
      title: `Mandar pra ${who}?`,
      body:
        draft.audience === "all"
          ? "O pop-up aparece uma vez pra cada pessoa, na próxima vez que ela abrir o app."
          : "O pop-up aparece pra essa pessoa na próxima vez que ela abrir o app.",
      confirmLabel: "Mandar",
      tone: "primary",
    });
    if (!ok) return;
    setIsSending(true);
    try {
      await apiRequest("/announcements", {
        method: "POST",
        token,
        body: {
          icon: draft.icon,
          tag: draft.tag,
          title: draft.title,
          text: draft.text,
          bullets: bulletsOf(draft),
          ctaLabel: draft.ctaPath ? draft.ctaLabel : "",
          ctaPath: draft.ctaPath,
          audience: draft.audience,
          targetUserId: draft.audience === "user" ? draft.targetUserId : undefined,
        },
      });
      showToast("Pop-up enviado", { description: `Vai aparecer pra ${who}` });
      setDraft(EMPTY_DRAFT);
      setPersonQuery("");
      loadSent();
    } catch (err) {
      showToast("Não foi possível enviar", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    } finally {
      setIsSending(false);
    }
  }

  async function toggleActive(announcement: Announcement) {
    try {
      const updated = await apiRequest<Announcement>(`/announcements/${announcement.id}`, {
        method: "PATCH",
        token,
        body: { active: !announcement.active },
      });
      setSent((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? prev);
      showToast(updated.active ? "Pop-up reativado" : "Pop-up desativado", {
        description: updated.active ? "Quem ainda não viu vai ver" : "Ninguém mais vai ver este pop-up",
      });
    } catch (err) {
      showToast("Não foi possível mudar", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  return (
    <div className="announce-admin">
      <form className="card announce-form" onSubmit={handleSend}>
        <p className="card-title">Novo pop-up</p>

        <div className="announce-row" role="group" aria-label="Modelo">
          {TEMPLATES.map((t) => (
            <button key={t.label} type="button" className="chat-kind-pick" onClick={() => setDraft({ ...EMPTY_DRAFT, ...t.draft })}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="field">
          <span className="field-label">Pra quem</span>
          <div className="announce-row">
            <button type="button" className={`chat-kind-pick${draft.audience === "all" ? " active" : ""}`} onClick={() => set("audience", "all")}>
              Todo mundo
            </button>
            <button type="button" className={`chat-kind-pick${draft.audience === "user" ? " active" : ""}`} onClick={() => set("audience", "user")}>
              Uma pessoa
            </button>
          </div>
        </div>

        {draft.audience === "user" && (
          <div className="field">
            <label htmlFor="announce-person">Pessoa</label>
            {target ? (
              <div className="announce-person-picked">
                <span className="loan-avatar" aria-hidden="true">
                  {(target.displayName || target.email).charAt(0).toUpperCase()}
                </span>
                <span className="announce-person-info">
                  <strong className="text-truncate">{target.displayName || "Sem nome"}</strong>
                  <small className="text-truncate">{target.email}</small>
                </span>
                <button type="button" className="link-button" onClick={() => set("targetUserId", "")}>
                  Trocar
                </button>
              </div>
            ) : (
              <>
                <input
                  id="announce-person"
                  type="search"
                  value={personQuery}
                  onChange={(e) => setPersonQuery(e.target.value)}
                  placeholder="Buscar por nome ou email"
                  autoComplete="off"
                />
                <ul className="announce-people">
                  {people === null ? (
                    <li className="field-hint">Carregando...</li>
                  ) : matches.length === 0 ? (
                    <li className="field-hint">Ninguém encontrado.</li>
                  ) : (
                    matches.map((p) => (
                      <li key={p.id}>
                        <button type="button" className="announce-person-row" onClick={() => set("targetUserId", p.id)}>
                          <strong className="text-truncate">{p.displayName || "Sem nome"}</strong>
                          <small className="text-truncate">{p.email}</small>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              </>
            )}
          </div>
        )}

        <div className="field">
          <span className="field-label">Ícone</span>
          <div className="announce-icons">
            {ICON_CHOICES.map((icon) => (
              <button
                key={icon}
                type="button"
                className={`announce-icon-pick${draft.icon === icon ? " active" : ""}`}
                aria-label={icon}
                aria-pressed={draft.icon === icon}
                onClick={() => set("icon", icon)}
              >
                <Icon name={icon} className="icon" />
              </button>
            ))}
          </div>
        </div>

        <div className="announce-grid">
          <div className="field">
            <label htmlFor="announce-tag">Etiqueta</label>
            <input id="announce-tag" value={draft.tag} maxLength={24} onChange={(e) => set("tag", e.target.value)} placeholder="Novidade" />
          </div>
          <div className="field">
            <label htmlFor="announce-title">Título</label>
            <input id="announce-title" value={draft.title} maxLength={80} onChange={(e) => set("title", e.target.value)} placeholder="Chegou o fechamento do mês" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="announce-text">Texto</label>
          <textarea id="announce-text" rows={3} value={draft.text} maxLength={600} onChange={(e) => set("text", e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="announce-bullets">Destaques (opcional, um por linha, até 4)</label>
          <textarea id="announce-bullets" rows={3} value={draft.bullets} onChange={(e) => set("bullets", e.target.value)} />
        </div>

        <div className="announce-grid">
          <div className="field">
            <label htmlFor="announce-cta-path">Botão leva pra (opcional)</label>
            <select id="announce-cta-path" value={draft.ctaPath} onChange={(e) => set("ctaPath", e.target.value)}>
              <option value="">Sem botão, só "Entendi"</option>
              {SCREENS.map((s) => (
                <option key={s.path} value={s.path}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          {draft.ctaPath && (
            <div className="field">
              <label htmlFor="announce-cta-label">Texto do botão</label>
              <input id="announce-cta-label" value={draft.ctaLabel} maxLength={30} onChange={(e) => set("ctaLabel", e.target.value)} placeholder="Ver agora" />
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={!!missing || isSending}>
          {isSending ? "Enviando..." : missing ?? (draft.audience === "all" ? "Mandar pra todo mundo" : `Mandar pra ${target?.displayName.split(" ")[0] || "essa pessoa"}`)}
        </button>
      </form>

      <div className="announce-side">
        <p className="announce-side-label">Prévia</p>
        <div className="modal-panel welcome-tour announce-preview" aria-hidden="true">
          <span className="welcome-tour-skip link-button">Fechar</span>
          <AnnouncementContent
            announcement={{
              icon: draft.icon,
              tag: draft.tag,
              title: draft.title || "Título do pop-up",
              text: draft.text || "O texto aparece aqui.",
              bullets: bulletsOf(draft),
            }}
          />
          <div className="modal-actions">
            {draft.ctaPath ? (
              <>
                <span className="btn btn-outline">Agora não</span>
                <span className="btn btn-primary">{draft.ctaLabel || "Botão"}</span>
              </>
            ) : (
              <span className="btn btn-primary">Entendi</span>
            )}
          </div>
        </div>
      </div>

      <div className="card announce-sent">
        <p className="card-title">Enviados</p>
        {sent === null ? (
          <p className="empty-state">Carregando...</p>
        ) : sent.length === 0 ? (
          <p className="empty-state">Nenhum pop-up enviado ainda.</p>
        ) : (
          <ul className="announce-sent-list">
            {sent.map((a) => (
              <li key={a.id} className={a.active ? "" : "is-off"}>
                <span className="announce-sent-icon" aria-hidden="true">
                  <Icon name={a.icon} className="icon" />
                </span>
                <span className="announce-sent-info">
                  <strong className="text-truncate">{a.title}</strong>
                  <small>
                    {a.audience === "all" ? "Todo mundo" : `Pra ${a.targetName ?? "uma pessoa"}`} · {when(a.createdAt)} · visto por {a.seenCount}
                    {a.active ? "" : " · desativado"}
                  </small>
                </span>
                <button type="button" className="link-button" onClick={() => toggleActive(a)}>
                  {a.active ? "Desativar" : "Reativar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admin > Assinaturas: como está a cobrança, quem assina e cortesias.
// ---------------------------------------------------------------------------

type AccessStateName = "trial" | "active" | "past_due" | "canceled_active" | "courtesy" | "free";

interface BillingAdmin {
  config: {
    enabled: boolean;
    asaasConfigured: boolean;
    asaasEnv: "sandbox" | "production";
    webhookConfigured: boolean;
    prices: { monthly: number; yearly: number };
    trialDays: number;
  };
  totals: { active: number; pastDue: number; canceledActive: number; trial: number; courtesy: number; free: number; mrr: number };
  groups: {
    groupId: string;
    members: string[];
    access: { premium: boolean; state: AccessStateName; endsAt: number | null };
    plan: "monthly" | "yearly" | null;
    payerName: string | null;
    courtesyNote: string | null;
  }[];
  events: { id: string; event: string; groupId: string | null; value: number | null; receivedAt: number }[];
  actions: { id: string; adminEmail: string; action: string; groupId: string | null; detail: string; at: number }[];
}

const STATE_LABELS: Record<AccessStateName, string> = {
  trial: "Em teste",
  active: "Assinante",
  past_due: "Pagamento atrasado",
  canceled_active: "Cancelou (ainda vale)",
  courtesy: "Cortesia",
  free: "Grátis",
};

const EVENT_LABELS: Record<string, string> = {
  PAYMENT_CONFIRMED: "Pagamento confirmado",
  PAYMENT_RECEIVED: "Pagamento recebido",
  PAYMENT_OVERDUE: "Pagamento atrasado",
  PAYMENT_REFUNDED: "Reembolso",
  PAYMENT_CHARGEBACK_REQUESTED: "Contestação no cartão",
  SUBSCRIPTION_DELETED: "Assinatura cancelada",
  SUBSCRIPTION_INACTIVATED: "Assinatura desativada",
};

function brl(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function AdminBilling() {
  const { token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<BillingAdmin | null>(null);
  const [filter, setFilter] = useState<AccessStateName | "all">("all");

  function load() {
    apiRequest<BillingAdmin>("/billing/admin", { token })
      .then(setData)
      .catch(() => setData(null));
  }
  useEffect(load, [token]);

  async function grant(groupId: string, days: number | null) {
    const ok = await confirm({
      title: days ? `Dar ${days} dias de Premium?` : "Dar Premium sem prazo?",
      body: "O grupo passa a ter tudo do Premium sem pagar. Fica registrado nas ações do admin.",
      confirmLabel: "Dar cortesia",
      tone: "primary",
    });
    if (!ok) return;
    try {
      await apiRequest("/billing/admin/courtesy", { method: "POST", token, body: { groupId, days, note: "" } });
      showToast("Cortesia dada");
      load();
    } catch (err) {
      showToast("Não foi possível", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  async function revoke(groupId: string) {
    try {
      await apiRequest("/billing/admin/courtesy/revoke", { method: "POST", token, body: { groupId } });
      showToast("Cortesia removida");
      load();
    } catch (err) {
      showToast("Não foi possível", { variant: "error", description: err instanceof ApiError ? err.message : undefined });
    }
  }

  if (!data) return <p className="empty-state">Carregando...</p>;
  const { config, totals } = data;
  const visible = filter === "all" ? data.groups : data.groups.filter((g) => g.access.state === filter);

  return (
    <div className="page-stack admin-billing">
      <div className="card">
        <p className="card-title">Configuração</p>
        <ul className="diag-list">
          <Check ok={config.enabled} label="Cobrança ligada" hint="BILLING_ENABLED=true no Render. Desligada, todo mundo tem tudo." />
          <Check ok={config.asaasConfigured} label={`Chave do Asaas (${config.asaasEnv === "production" ? "produção" : "testes"})`} hint="ASAAS_API_KEY e ASAAS_ENV" />
          <Check ok={config.webhookConfigured} label="Webhook do Asaas" hint="ASAAS_WEBHOOK_TOKEN, o mesmo token cadastrado no painel do Asaas" />
        </ul>
        <p className="field-hint">
          Preços: {brl(config.prices.monthly)}/mês ou {brl(config.prices.yearly)}/ano · teste de {config.trialDays} dias.
        </p>
      </div>

      <div className="stat-row wrap">
        <div className="stat-box tone-accent">
          <p className="label">Receita por mês (MRR)</p>
          <p className="value-sm">{brl(totals.mrr)}</p>
        </div>
        <div className="stat-box">
          <p className="label">Assinantes</p>
          <p className="value-sm">{totals.active + totals.pastDue}</p>
        </div>
        <div className="stat-box">
          <p className="label">Em teste</p>
          <p className="value-sm">{totals.trial}</p>
        </div>
        <div className="stat-box">
          <p className="label">Atrasados</p>
          <p className="value-sm">{totals.pastDue}</p>
        </div>
        <div className="stat-box">
          <p className="label">Cortesia</p>
          <p className="value-sm">{totals.courtesy}</p>
        </div>
        <div className="stat-box">
          <p className="label">Grátis</p>
          <p className="value-sm">{totals.free}</p>
        </div>
      </div>

      <div className="card">
        <p className="card-title">Grupos</p>
        <div className="admin-feedback-filters announce-row">
          {(["all", "active", "past_due", "trial", "courtesy", "canceled_active", "free"] as const).map((f) => (
            <button key={f} type="button" className={`chat-kind-pick${filter === f ? " active" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? "Todos" : STATE_LABELS[f]}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <p className="empty-state">
            {data.groups.length === 0 ? "Nenhum grupo ainda. Eles aparecem aqui quando a cobrança está ligada e alguém abre o app." : "Nenhum grupo nesse filtro."}
          </p>
        ) : (
          <ul className="announce-sent-list">
            {visible.map((g) => (
              <li key={g.groupId}>
                <span className="announce-sent-info">
                  <strong className="text-truncate">{g.members.join(" e ") || "Grupo sem nomes"}</strong>
                  <small>
                    {STATE_LABELS[g.access.state]}
                    {g.plan ? ` · ${g.plan === "yearly" ? "anual" : "mensal"}` : ""}
                    {g.access.endsAt ? ` · até ${new Date(g.access.endsAt).toLocaleDateString("pt-BR")}` : ""}
                    {g.payerName ? ` · paga: ${g.payerName}` : ""}
                  </small>
                </span>
                {g.access.state === "courtesy" ? (
                  <button type="button" className="link-button" onClick={() => revoke(g.groupId)}>
                    Tirar cortesia
                  </button>
                ) : (
                  <span className="admin-grant">
                    <button type="button" className="link-button" onClick={() => grant(g.groupId, 30)}>
                      +30 dias
                    </button>
                    <button type="button" className="link-button" onClick={() => grant(g.groupId, null)}>
                      Sem prazo
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p className="card-title">Últimos eventos do Asaas</p>
        {data.events.length === 0 ? (
          <p className="empty-state">Nenhum pagamento ainda.</p>
        ) : (
          <ul className="announce-sent-list">
            {data.events.map((ev) => (
              <li key={ev.id}>
                <span className="announce-sent-info">
                  <strong>{EVENT_LABELS[ev.event] ?? ev.event}</strong>
                  <small>
                    {when(ev.receivedAt)}
                    {ev.value !== null ? ` · ${brl(ev.value)}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <p className="card-title">Ações do admin</p>
        {data.actions.length === 0 ? (
          <p className="empty-state">Nenhuma ação registrada.</p>
        ) : (
          <ul className="announce-sent-list">
            {data.actions.map((a) => (
              <li key={a.id}>
                <span className="announce-sent-info">
                  <strong>{a.action === "grant_courtesy" ? "Deu cortesia" : a.action === "revoke_courtesy" ? "Tirou cortesia" : a.action}</strong>
                  <small>
                    {a.adminEmail} · {when(a.at)}
                    {a.detail ? ` · ${a.detail}` : ""}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
