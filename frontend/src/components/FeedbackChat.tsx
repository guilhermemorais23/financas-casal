import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Icon } from "./Icon";

export type FeedbackKind = "idea" | "problem" | "praise";

export interface FeedbackMessage {
  id: string;
  from: "user" | "team" | "auto";
  text: string;
  kind: FeedbackKind | null;
  authorName: string | null;
  createdAt: number;
}

export const KIND_LABELS: Record<FeedbackKind, string> = {
  idea: "Ideia",
  problem: "Problema",
  praise: "Elogio",
};

function timeLabel(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

// The bubbles, shared by the person's chat and the admin inbox. `mine` is
// which side is "me": the person sees their own messages on the right, the
// team sees the team's.
export function ChatBubbles({ messages, mine }: { messages: FeedbackMessage[]; mine: "user" | "team" }) {
  return (
    <>
      {messages.map((message) => {
        const isMine = mine === "user" ? message.from === "user" : message.from !== "user";
        const who =
          message.from === "auto" ? "PAR. · automático" : message.from === "team" ? message.authorName ?? "PAR." : null;
        return (
          <div key={message.id} className={`chat-bubble-row${isMine ? " mine" : ""}`}>
            {message.kind && <span className={`chat-kind kind-${message.kind}`}>{KIND_LABELS[message.kind]}</span>}
            <p className={`chat-bubble${isMine ? " mine" : ""}${message.from === "auto" ? " auto" : ""}`}>{message.text}</p>
            <span className="chat-meta">
              {who ? `${who} · ` : ""}
              {timeLabel(message.createdAt)}
            </span>
          </div>
        );
      })}
    </>
  );
}

// "Fale com a gente": a support chat. Sending gets an instant thank-you;
// the owner answers from Admin > Feedback and the answer shows up here (and
// by email).
export function FeedbackChat({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const location = useLocation();
  const [messages, setMessages] = useState<FeedbackMessage[] | null>(null);
  const [kind, setKind] = useState<FeedbackKind>("idea");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiRequest<{ messages: FeedbackMessage[] }>("/feedback", { token })
      .then((res) => setMessages(res.messages))
      .catch(() => setMessages([]));
    window.dispatchEvent(new Event("par:feedback-read"));
  }, [token]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (message.length < 2 || isSending) return;
    setIsSending(true);
    setError(null);
    const optimistic: FeedbackMessage = { id: `tmp-${Date.now()}`, from: "user", text: message, kind, authorName: null, createdAt: Date.now() };
    setMessages((prev) => [...(prev ?? []), optimistic]);
    setText("");
    try {
      const res = await apiRequest<{ messages: FeedbackMessage[] }>("/feedback", {
        method: "POST",
        token,
        body: { kind, message, page: location.pathname },
      });
      setMessages(res.messages);
    } catch (err) {
      setMessages((prev) => (prev ?? []).filter((m) => m.id !== optimistic.id));
      setText(message);
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar agora.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chat-backdrop" onClick={onClose}>
      <div className="chat-panel" role="dialog" aria-modal="true" aria-label="Fale com a gente" onClick={(e) => e.stopPropagation()}>
        <div className="chat-header">
          <button type="button" className="chat-back" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
          <span className="chat-avatar" aria-hidden="true">P.</span>
          <div className="chat-title">
            <strong>Fale com a gente</strong>
            <span>Respondemos por aqui, em até 1 dia</span>
          </div>
        </div>

        <div className="chat-messages" ref={listRef}>
          {messages === null ? (
            <p className="chat-empty">Carregando...</p>
          ) : messages.length === 0 ? (
            <div className="chat-empty">
              <p>
                <strong>Oi! Aqui você fala direto com quem faz o PAR.</strong>
              </p>
              <p>Achou um problema, teve uma ideia ou quer deixar um elogio? Escreve aqui embaixo.</p>
            </div>
          ) : (
            <ChatBubbles messages={messages} mine="user" />
          )}
        </div>

        {error && <p className="alert chat-error">{error}</p>}

        <div className="chat-kinds" role="radiogroup" aria-label="Tipo de mensagem">
          {(Object.keys(KIND_LABELS) as FeedbackKind[]).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={kind === option}
              className={`chat-kind-pick${kind === option ? " active" : ""}`}
              onClick={() => setKind(option)}
            >
              {KIND_LABELS[option]}
            </button>
          ))}
        </div>
        <form className="chat-input-row" onSubmit={handleSend}>
          <label htmlFor="feedback-chat-input" className="visually-hidden">
            Mensagem
          </label>
          <textarea
            id="feedback-chat-input"
            rows={1}
            value={text}
            maxLength={2000}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={kind === "problem" ? "O que aconteceu?" : "Escreva sua mensagem"}
            autoFocus
          />
          <button type="submit" className="chat-send" aria-label="Enviar" disabled={isSending || text.trim().length < 2}>
            <Icon name="send" />
          </button>
        </form>
      </div>
    </div>
  );
}

// Unread answers from the team, for the badge on "Fale com a gente".
export function useFeedbackUnread(): number {
  const { token } = useAuth();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!token) return;
    let active = true;
    const load = () =>
      apiRequest<{ unread: number }>("/feedback/unread", { token })
        .then((res) => active && setUnread(res.unread))
        .catch(() => {});
    void load();
    const onRead = () => setUnread(0);
    window.addEventListener("par:feedback-read", onRead);
    const timer = window.setInterval(load, 120_000);
    return () => {
      active = false;
      window.removeEventListener("par:feedback-read", onRead);
      window.clearInterval(timer);
    };
  }, [token]);
  return unread;
}
