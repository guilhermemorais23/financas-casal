import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

// Trigger button lives in AppLayout's sidebar footer (next to the theme
// toggle) -- this component only renders the panel itself, so there's a
// single floating button on screen (the "+" FAB) instead of two competing
// circles.
export function GlobalAssistant({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { token } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isGreeting, setIsGreeting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const hasGreetedRef = useRef(false);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isOpen, isSending, isGreeting]);

  // Opens with something to say instead of a blank box -- fetched once per
  // session the first time the panel is opened, not on every reopen.
  useEffect(() => {
    if (!isOpen || hasGreetedRef.current) return;
    hasGreetedRef.current = true;
    setIsGreeting(true);
    apiRequest<{ text: string }>("/assistant/greeting", { token })
      .then((res) => setMessages((prev) => [...prev, { role: "assistant", text: res.text }]))
      .catch(() => {})
      .finally(() => setIsGreeting(false));
  }, [isOpen, token]);

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || isSending) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setError(null);
    setIsSending(true);
    try {
      const res = await apiRequest<{ reply: string }>("/assistant/chat", {
        method: "POST",
        token,
        body: { message: text },
      });
      setMessages((prev) => [...prev, { role: "assistant", text: res.reply }]);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? "Assistente ainda não configurado."
          : err instanceof ApiError
            ? err.message
            : "Não foi possível falar com o assistente agora."
      );
    } finally {
      setIsSending(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="assistant-panel">
      <div className="assistant-panel-header">
        <p>Assistente PAR.</p>
        <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
          ×
        </button>
      </div>

      <div className="assistant-messages" ref={listRef}>
        {messages.length === 0 && !isGreeting && (
          <p className="assistant-empty-state">
            Pergunte sobre seus gastos, conte qual é o objetivo financeiro de vocês, ou peça dicas de onde economizar.
          </p>
        )}
        {messages.map((message, index) => (
          <p key={index} className={`assistant-message ${message.role}`}>
            {message.text}
          </p>
        ))}
        {(isSending || isGreeting) && <p className="assistant-message assistant assistant-typing">Digitando...</p>}
      </div>

      {error && (
        <p className="alert assistant-error" role="alert">
          {error}
        </p>
      )}

      <form className="assistant-input-row" onSubmit={handleSend}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem..."
          disabled={isSending}
        />
        <button type="submit" className="btn btn-primary" disabled={isSending || !input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
