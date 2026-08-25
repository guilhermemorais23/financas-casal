import { useEffect, useRef, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export function GlobalAssistant() {
  const { token } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isOpen, isSending]);

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

  return (
    <>
      <button
        type="button"
        className="assistant-fab"
        onClick={() => setIsOpen((open) => !open)}
        aria-label={isOpen ? "Fechar assistente" : "Abrir assistente"}
        title="Assistente PAR."
      >
        {isOpen ? "×" : "💬"}
      </button>

      {isOpen && (
        <div className="assistant-panel">
          <div className="assistant-panel-header">
            <p>Assistente PAR.</p>
            <button type="button" className="btn-icon" onClick={() => setIsOpen(false)} aria-label="Fechar">
              ×
            </button>
          </div>

          <div className="assistant-messages" ref={listRef}>
            {messages.length === 0 && (
              <p className="assistant-empty-state">
                Pergunte sobre seus gastos, conte qual é o objetivo financeiro de vocês, ou peça dicas de onde
                economizar.
              </p>
            )}
            {messages.map((message, index) => (
              <p key={index} className={`assistant-message ${message.role}`}>
                {message.text}
              </p>
            ))}
            {isSending && <p className="assistant-message assistant assistant-typing">Digitando...</p>}
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
      )}
    </>
  );
}
