import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency } from "../utils/format";

interface GoalRow {
  id: string;
  name: string;
  emoji: string | null;
  target_amount: string;
  current_amount: string;
  deadline: string | null;
  achieved_at: string | null;
}

export function GoalsPage() {
  const { token } = useAuth();
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const [contributions, setContributions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function loadGoals() {
    const result = await apiRequest<GoalRow[]>("/goals", { token });
    setGoals(result);
  }

  useEffect(() => {
    loadGoals();
  }, [token]);

  async function handleCreate(event: FormEvent) {
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
          targetAmount: parsedTarget,
          deadline: deadline || null,
        },
      });
      setName("");
      setEmoji("");
      setTargetAmount("");
      setDeadline("");
      await loadGoals();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a meta");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleContribute(goalId: string) {
    const raw = contributions[goalId];
    const amount = Number((raw ?? "").replace(",", "."));
    if (!(amount > 0)) return;

    try {
      await apiRequest(`/goals/${goalId}/contribute`, {
        method: "POST",
        token,
        body: { amount },
      });
      setContributions((prev) => ({ ...prev, [goalId]: "" }));
      await loadGoals();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível contribuir");
    }
  }

  async function handleDelete(goalId: string) {
    try {
      await apiRequest(`/goals/${goalId}`, { method: "DELETE", token });
      await loadGoals();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a meta");
    }
  }

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="card form-card">
          <h1>Metas</h1>
          <p className="card-subtitle">Viagem, casa própria, casamento — acompanhem juntos.</p>
          <form onSubmit={handleCreate}>
            <div className="field-row">
              <div className="field" style={{ flex: 2 }}>
                <label htmlFor="goal-name">Nome</label>
                <input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="field" style={{ maxWidth: 90 }}>
                <label htmlFor="goal-emoji">Emoji</label>
                <input id="goal-emoji" value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="🎯" />
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
                <input
                  id="goal-deadline"
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                />
              </div>
            </div>
            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Criando..." : "Criar meta"}
            </button>
          </form>
        </div>

        {goals && goals.length === 0 && (
          <p className="empty-state">Nenhuma meta criada ainda. Que tal começar uma?</p>
        )}

        {goals?.map((goal) => {
          const current = Number(goal.current_amount);
          const target = Number(goal.target_amount);
          const percent = Math.min(100, Math.round((current / target) * 100));
          return (
            <div key={goal.id} className="card goal-card">
              <div className="section-header">
                <p className="card-title">
                  {goal.emoji ?? "🎯"} {goal.name}
                  {goal.achieved_at && <span className="badge goal-achieved">Concluída!</span>}
                </p>
                <button type="button" className="btn-icon" onClick={() => handleDelete(goal.id)} title="Remover meta">
                  ✕
                </button>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${percent}%` }} />
              </div>
              <div className="budget-amounts goal-amounts">
                <span>
                  {formatCurrency(current)} / {formatCurrency(target)}
                </span>
                {goal.deadline && <span>até {new Date(goal.deadline).toLocaleDateString("pt-BR")}</span>}
              </div>
              {!goal.achieved_at && (
                <div className="invite-link-row">
                  <input
                    placeholder="Adicionar valor"
                    inputMode="decimal"
                    value={contributions[goal.id] ?? ""}
                    onChange={(e) =>
                      setContributions((prev) => ({ ...prev, [goal.id]: e.target.value }))
                    }
                  />
                  <button type="button" className="btn btn-outline" onClick={() => handleContribute(goal.id)}>
                    Adicionar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </AppLayout>
  );
}
