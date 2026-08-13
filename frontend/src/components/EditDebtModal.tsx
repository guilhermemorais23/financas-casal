import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export interface EditableDebt {
  id: string;
  name: string;
  description: string | null;
}

export function EditDebtModal({
  debt,
  onClose,
  onSaved,
}: {
  debt: EditableDebt;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();

  const [name, setName] = useState(debt.name);
  const [description, setDescription] = useState(debt.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Informe o nome da dívida.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest(`/debts/${debt.id}`, {
        method: "PATCH",
        token,
        body: {
          name: name.trim(),
          description: description.trim() || null,
        },
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar as alterações");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
        <h1>Editar dívida</h1>

        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="edit-debt-name">Nome</label>
            <input id="edit-debt-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>

          <div className="field">
            <label htmlFor="edit-debt-description">Descrição (opcional)</label>
            <input
              id="edit-debt-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
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
              {isSubmitting ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
