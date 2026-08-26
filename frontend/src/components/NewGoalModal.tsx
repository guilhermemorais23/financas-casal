import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmojiPicker } from "./EmojiPicker";
import { compressToSquareDataUrl } from "../utils/imageCompression";

const PHOTO_SIZE = 240;

export function NewGoalModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { token } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [targetAmount, setTargetAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressToSquareDataUrl(file, PHOTO_SIZE);
      setPhotoDataUrl(dataUrl);
    } catch {
      setError("Não foi possível processar essa imagem.");
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedTarget = Number(targetAmount.replace(",", "."));
    if (!name.trim() || !(parsedTarget > 0)) {
      setError("Informe nome e valor da meta.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/goals", {
        method: "POST",
        token,
        body: {
          name: name.trim(),
          emoji: emoji.trim() || null,
          photoDataUrl,
          targetAmount: parsedTarget,
          deadline: deadline || null,
        },
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a meta");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1>Nova meta</h1>
        <p className="card-subtitle">Viagem, casa própria, casamento — acompanhem juntos.</p>

        <form onSubmit={handleSubmit}>
          <div className="profile-avatar-picker">
            {photoDataUrl ? (
              <img src={photoDataUrl} alt="" className="profile-avatar-preview" />
            ) : (
              <span className="profile-avatar-preview profile-avatar-fallback">{emoji || "🎯"}</span>
            )}
            <div className="profile-avatar-actions">
              <button type="button" className="btn btn-outline" onClick={() => fileInputRef.current?.click()}>
                {photoDataUrl ? "Trocar foto" : "Adicionar foto (opcional)"}
              </button>
              {photoDataUrl && (
                <button type="button" className="link-button" onClick={() => setPhotoDataUrl(null)}>
                  Remover foto
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handlePhotoChange} />
            </div>
          </div>

          <div className="field-row">
            <div className="field" style={{ flex: 2 }}>
              <label htmlFor="goal-name">Nome</label>
              <input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <div className="field" style={{ maxWidth: 90 }}>
              <label>Emoji</label>
              <EmojiPicker value={emoji} onChange={setEmoji} />
            </div>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="goal-target">Valor alvo (R$)</label>
              <input
                id="goal-target"
                inputMode="decimal"
                value={targetAmount}
                onChange={(e) => setTargetAmount(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="goal-deadline">Prazo (opcional)</label>
              <input id="goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>

          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Criando..." : "Criar meta"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
