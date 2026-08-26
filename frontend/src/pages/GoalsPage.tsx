import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { NewGoalModal } from "../components/NewGoalModal";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency, parseLocalDate } from "../utils/format";

interface GoalRow {
  id: string;
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  achievedAt: string | null;
}

export function GoalsPage() {
  const { token } = useAuth();
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const [contributions, setContributions] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  async function loadGoals() {
    const result = await apiRequest<GoalRow[]>("/goals", { token });
    setGoals(result);
  }

  useEffect(() => {
    loadGoals();
  }, [token]);

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
    const confirmed = window.confirm("Excluir essa meta? O progresso salvo também será perdido.");
    if (!confirmed) return;

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
        <h1>Metas</h1>

        <button type="button" className="dashed-add-card" onClick={() => setIsCreating(true)}>
          <span className="dashed-add-card-icon">+</span>
          Nova meta
        </button>

        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}

        {goals && goals.length === 0 && (
          <p className="empty-state">Nenhuma meta criada ainda. Que tal começar uma?</p>
        )}

        {goals?.map((goal) => {
          const current = Number(goal.currentAmount);
          const target = Number(goal.targetAmount);
          const percent = Math.min(100, Math.round((current / target) * 100));
          return (
            <div key={goal.id} className="card goal-card">
              {goal.photoDataUrl && <img src={goal.photoDataUrl} alt="" className="goal-card-cover" />}
              <div className="section-header">
                <p className="card-title">
                  {goal.emoji ?? "🎯"} {goal.name}
                  {goal.achievedAt && <span className="badge goal-achieved">Concluída!</span>}
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
                {goal.deadline && <span>até {parseLocalDate(goal.deadline).toLocaleDateString("pt-BR")}</span>}
              </div>
              {!goal.achievedAt && (
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

      {isCreating && <NewGoalModal onClose={() => setIsCreating(false)} onCreated={loadGoals} />}
    </AppLayout>
  );
}
