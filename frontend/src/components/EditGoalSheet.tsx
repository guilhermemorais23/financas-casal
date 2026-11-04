import { useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Sheet } from "./Sheet";
import { useToast } from "./ToastProvider";
import { parseMoney, toMoneyInput } from "../utils/money";

export interface EditableGoal {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  items?: unknown[];
}


const toInput = (value: string) => toMoneyInput(Number(value));

// Editar a meta: nome, prazo e -- sem submetas -- o alvo e quanto já tem
// guardado (a diferença entra no histórico como "Ajuste", sem mexer em conta).
// Com submetas, alvo e guardado são a soma delas e mudam por elas.
export function EditGoalSheet({
  goal,
  onClose,
  onSaved,
}: {
  goal: EditableGoal;
  onClose: () => void;
  onSaved: (updated: unknown) => void;
}) {
  const { token } = useAuth();
  const { showToast } = useToast();
  const hasItems = (goal.items?.length ?? 0) > 0;
  const [name, setName] = useState(goal.name);
  const [deadline, setDeadline] = useState(goal.deadline ?? "");
  const [target, setTarget] = useState(toInput(goal.targetAmount));
  const [current, setCurrent] = useState(toInput(goal.currentAmount));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsedTarget = parseMoney(target);
    const parsedCurrent = parseMoney(current);
    if (!name.trim()) {
      setError("Dê um nome pra meta.");
      return;
    }
    if (!hasItems && (!(parsedTarget > 0) || !(parsedCurrent >= 0))) {
      setError("O alvo precisa ser maior que zero, e o guardado não pode ser negativo.");
      return;
    }
    setIsSaving(true);
    try {
      const updated = await apiRequest(`/goals/${goal.id}`, {
        method: "PATCH",
        token,
        body: {
          name: name.trim(),
          deadline: deadline || null,
          ...(hasItems ? {} : { targetAmount: parsedTarget, currentAmount: parsedCurrent }),
        },
      });
      showToast("Meta atualizada");
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar a meta");
      setIsSaving(false);
    }
  }

  return (
    <Sheet onClose={onClose} labelledBy="edit-goal-title">
      <h1 id="edit-goal-title">Editar meta</h1>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="edit-goal-name">Nome</label>
          <input id="edit-goal-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} required />
        </div>
        {hasItems ? (
          <p className="field-hint">Essa meta tem submetas: o alvo e o guardado são a soma delas. Mude o preço em cada submeta.</p>
        ) : (
          <div className="field-row">
            <div className="field">
              <label htmlFor="edit-goal-target">Alvo (R$)</label>
              <input id="edit-goal-target" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="edit-goal-current">Já guardado (R$)</label>
              <input id="edit-goal-current" inputMode="decimal" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
          </div>
        )}
        {!hasItems && (
          <p className="field-hint">Mudar o guardado aqui não mexe em conta nenhuma: entra no histórico como ajuste.</p>
        )}
        <div className="field">
          <label htmlFor="edit-goal-deadline">Prazo (opcional)</label>
          <input id="edit-goal-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
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
          <button type="submit" className="btn btn-primary" disabled={isSaving}>
            {isSaving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
