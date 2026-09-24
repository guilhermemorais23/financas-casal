import { useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ToastProvider";

const KINDS = [
  { value: "idea", label: "💡 Ideia" },
  { value: "problem", label: "🐞 Problema" },
  { value: "praise", label: "💜 Elogio" },
] as const;

type Kind = (typeof KINDS)[number]["value"];

// "Enviar feedback" (Mais menu / sidebar): goes straight to the owner's
// inbox (see backend feedback module), with the sender's email as Reply-To.
export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const location = useLocation();
  const [kind, setKind] = useState<Kind>("idea");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (message.trim().length < 3) {
      setError("Escreva pelo menos algumas palavras.");
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      await apiRequest("/feedback", {
        method: "POST",
        token,
        body: { kind, message: message.trim(), page: location.pathname },
      });
      showToast("Feedback enviado", { description: "Obrigado! A gente lê tudo" });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível enviar agora");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel feedback-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h1>Enviar feedback</h1>
        <p className="card-subtitle">Ideia, problema ou elogio: chega direto pra gente.</p>
        <form onSubmit={handleSubmit}>
          <div className="feedback-kinds" role="radiogroup" aria-label="Tipo">
            {KINDS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={kind === option.value}
                className={`feedback-kind${kind === option.value ? " active" : ""}`}
                onClick={() => setKind(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="feedback-message">Mensagem</label>
            <textarea
              id="feedback-message"
              rows={5}
              maxLength={2000}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={
                kind === "problem" ? "O que aconteceu e em qual tela?" : "Conta pra gente..."
              }
              autoFocus
            />
          </div>
          {error && <p className="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? "Enviando..." : "Enviar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
