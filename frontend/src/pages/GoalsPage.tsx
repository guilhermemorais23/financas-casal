import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { NewGoalModal } from "../components/NewGoalModal";
import { GoalMoneySheet, type GoalForMoney } from "../components/GoalMoneySheet";
import { useToast } from "../components/ToastProvider";
import { AppLayout } from "../layouts/AppLayout";
import { Icon } from "../components/Icon";
import { formatCurrency, parseLocalDate } from "../utils/format";
import { minimumMonthlySaving } from "../utils/goals";
import { useConfirm } from "../components/ConfirmDialog";
import { cancelDeferred, isDeferredPending, scheduleDeferred } from "../utils/deferredDelete";
import { whenWritesSettled } from "../utils/pendingWrites";

interface GoalItemRow {
  id: string;
  name: string;
  targetAmount: string;
  currentAmount: string;
  isDone: boolean;
}

interface GoalRow {
  id: string;
  name: string;
  emoji: string | null;
  photoDataUrl: string | null;
  targetAmount: string;
  currentAmount: string;
  deadline: string | null;
  achievedAt: string | null;
  items?: GoalItemRow[];
}

interface ContributionRow {
  id: string;
  userId: string;
  amount: string;
  itemName: string | null;
  accountId: string | null;
  createdAt: number;
}

interface MemberRow {
  id: string;
  displayName: string;
}

function parseMoney(value: string): number {
  const clean = value.trim().replace(/\s|R\$/g, "");
  return Number(clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean);
}

export function GoalsPage() {
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [goals, setGoals] = useState<GoalRow[] | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // Guardar / Retirar
  const [moving, setMoving] = useState<{ goal: GoalForMoney; direction: "deposit" | "withdraw" } | null>(null);
  // Submetas: nova (por meta) e edição de preço
  const [newItemFor, setNewItemFor] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [editingItem, setEditingItem] = useState<{ goalId: string; itemId: string } | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [busy, setBusy] = useState(false);
  // Histórico aberto
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [history, setHistory] = useState<ContributionRow[] | null>(null);

  async function loadGoals() {
    await whenWritesSettled();
    const result = await apiRequest<GoalRow[]>("/goals", { token });
    setGoals(result.filter((goal) => !isDeferredPending(`goal:${goal.id}`)));
  }

  useEffect(() => {
    void loadGoals();
    apiRequest<{ members: MemberRow[] }>("/groups/me", { token })
      .then((res) => setMembers(res.members))
      .catch(() => setMembers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function replaceGoal(updated: GoalRow) {
    setGoals((current) => current?.map((goal) => (goal.id === updated.id ? updated : goal)) ?? current);
  }

  async function addItem(event: FormEvent, goal: GoalRow) {
    event.preventDefault();
    const price = parseMoney(newItemPrice);
    if (!newItemName.trim() || !(price > 0)) {
      setError("Dê um nome e um preço pra submeta.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await apiRequest<GoalRow>(`/goals/${goal.id}/items`, {
        method: "POST",
        token,
        body: { name: newItemName.trim(), targetAmount: price },
      });
      replaceGoal(updated);
      setNewItemFor(null);
      setNewItemName("");
      setNewItemPrice("");
      showToast(`${newItemName.trim()} adicionada`, { description: `A meta agora é ${formatCurrency(Number(updated.targetAmount))}` });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível adicionar a submeta");
    } finally {
      setBusy(false);
    }
  }

  async function savePrice(event: FormEvent, goal: GoalRow, item: GoalItemRow) {
    event.preventDefault();
    const price = parseMoney(editPrice);
    if (!(price > 0)) {
      setError("O preço precisa ser maior que zero.");
      return;
    }
    setBusy(true);
    try {
      replaceGoal(await apiRequest<GoalRow>(`/goals/${goal.id}/items/${item.id}`, { method: "PATCH", token, body: { targetAmount: price } }));
      setEditingItem(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível mudar o preço");
    } finally {
      setBusy(false);
    }
  }

  async function removeItem(goal: GoalRow, item: GoalItemRow) {
    const hasMoney = Number(item.currentAmount) > 0;
    const confirmed = await confirm({
      title: `Tirar “${item.name}” da meta?`,
      body: hasMoney
        ? `O que estava guardado nela (${formatCurrency(Number(item.currentAmount))}) passa pra outra submeta. Nada sai da meta.`
        : "O alvo da meta diminui no preço dela.",
      confirmLabel: "Tirar submeta",
    });
    if (!confirmed) return;
    try {
      replaceGoal(await apiRequest<GoalRow>(`/goals/${goal.id}/items/${item.id}`, { method: "DELETE", token }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível tirar a submeta");
    }
  }

  async function toggleHistory(goal: GoalRow) {
    if (historyFor === goal.id) {
      setHistoryFor(null);
      return;
    }
    setHistoryFor(goal.id);
    setHistory(null);
    try {
      setHistory(await apiRequest<ContributionRow[]>(`/goals/${goal.id}/contributions`, { token }));
    } catch {
      setHistory([]);
    }
  }

  const memberName = (id: string) => (id === user?.id ? "Você" : members.find((m) => m.id === id)?.displayName ?? "Alguém");

  // Delete with Desfazer (utils/deferredDelete.ts): the card leaves the list
  // at once, the DELETE goes out after the undo window.
  async function handleDelete(goal: GoalRow) {
    const confirmed = await confirm({
      title: `Excluir a meta “${goal.name}”?`,
      body: "O que saiu da conta pra ela volta pra conta. Você ainda vai poder desfazer por alguns segundos.",
      confirmLabel: "Excluir meta",
    });
    if (!confirmed) return;

    setError(null);
    const before = goals;
    const key = `goal:${goal.id}`;
    setGoals((current) => current?.filter((row) => row.id !== goal.id) ?? current);
    scheduleDeferred(key, async () => {
      try {
        await apiRequest(`/goals/${goal.id}`, { method: "DELETE", token });
        await loadGoals();
      } catch (err) {
        setGoals(before);
        setError(err instanceof ApiError ? err.message : "Não foi possível remover a meta");
      }
    });
    showToast(`Meta “${goal.name}” excluída`, {
      actionLabel: "Desfazer",
      onAction: () => {
        if (cancelDeferred(key)) setGoals(before);
      },
    });
  }

  function renderItems(goal: GoalRow) {
    const items = goal.items ?? [];
    return (
      <>
        {items.length > 0 && (
          <ul className="goal-items">
            {items.map((item) => {
              const percent = Math.min(100, (Number(item.currentAmount) / Number(item.targetAmount)) * 100);
              const isEditing = editingItem?.goalId === goal.id && editingItem.itemId === item.id;
              return (
                <li key={item.id} className="goal-item">
                  <div className="goal-item-top">
                    <span className="goal-item-name">
                      {item.name}
                      {item.isDone && <span className="goal-item-done">Comprada</span>}
                    </span>
                    {isEditing ? (
                      <form className="goal-item-price-form" onSubmit={(e) => void savePrice(e, goal, item)}>
                        <input
                          aria-label={`Novo preço de ${item.name}`}
                          inputMode="decimal"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          autoFocus
                        />
                        <button type="submit" className="btn-icon" title="Salvar" disabled={busy}>
                          ✓
                        </button>
                        <button type="button" className="btn-icon" title="Cancelar" onClick={() => setEditingItem(null)}>
                          ×
                        </button>
                      </form>
                    ) : (
                      <span className="goal-item-amount">
                        {formatCurrency(Number(item.currentAmount))} <span>de {formatCurrency(Number(item.targetAmount))}</span>
                      </span>
                    )}
                  </div>
                  <div className="progress-track goal-item-track">
                    <div className="progress-fill" style={{ width: `${percent}%` }} />
                  </div>
                  {!isEditing && (
                    <div className="goal-item-actions">
                      <button
                        type="button"
                        className="link-button"
                        onClick={() => {
                          setEditingItem({ goalId: goal.id, itemId: item.id });
                          setEditPrice(Number(item.targetAmount).toFixed(2).replace(".", ","));
                        }}
                      >
                        Mudar preço
                      </button>
                      <button type="button" className="link-button" onClick={() => void removeItem(goal, item)}>
                        Tirar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {newItemFor === goal.id ? (
          <form className="goal-item-new" onSubmit={(e) => void addItem(e, goal)}>
            <input
              aria-label="Nome da submeta"
              placeholder="Ex.: Placa de vídeo"
              value={newItemName}
              maxLength={60}
              onChange={(e) => setNewItemName(e.target.value)}
              autoFocus
            />
            <input
              aria-label="Preço"
              placeholder="R$ 3.200"
              inputMode="decimal"
              value={newItemPrice}
              onChange={(e) => setNewItemPrice(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy}>
              Adicionar
            </button>
            <button type="button" className="link-button" onClick={() => setNewItemFor(null)}>
              Cancelar
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="link-button goal-item-add"
            onClick={() => {
              setNewItemFor(goal.id);
              setNewItemName("");
              setNewItemPrice("");
            }}
          >
            + Submeta {items.length === 0 && <span className="field-hint">(dividir em partes, cada uma com o preço)</span>}
          </button>
        )}
      </>
    );
  }

  return (
    <AppLayout>
      <div className="page-stack">
        <div className="page-title-row">
          <h1>Metas</h1>
          <button type="button" className="btn btn-primary btn-compact" onClick={() => setIsCreating(true)}>
            Nova meta
          </button>
        </div>

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
          const percent = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
          const monthly = goal.achievedAt ? null : minimumMonthlySaving(target, current, goal.deadline);
          // minimumMonthlySaving only returns null for a dated, unfinished goal
          // once its deadline is behind us.
          const isOverdue = !goal.achievedAt && goal.deadline !== null && monthly === null && current < target;
          const forMoney: GoalForMoney = {
            id: goal.id,
            name: goal.name,
            currentAmount: goal.currentAmount,
            monthlyMinimum: monthly?.perMonth ?? null,
            items: (goal.items ?? []).map((item) => ({
              id: item.id,
              name: item.name,
              missing: Math.max(0, Number(item.targetAmount) - Number(item.currentAmount)),
              saved: Number(item.currentAmount),
            })),
          };
          return (
            <div key={goal.id} className={`card goal-card${goal.achievedAt ? " is-achieved" : ""}`}>
              {goal.photoDataUrl && <img src={goal.photoDataUrl} alt="" className="goal-card-cover" />}
              <div className="section-header">
                <h2 className="section-title">{goal.name}</h2>
                <div className="goal-card-side">
                  {goal.achievedAt ? (
                    <span className="goal-achieved-label">
                      <Icon name="check" />
                      Concluída
                    </span>
                  ) : (
                    goal.deadline && (
                      <span className="goal-deadline">
                        até{" "}
                        {parseLocalDate(goal.deadline).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
                      </span>
                    )
                  )}
                  <button type="button" className="btn-icon" onClick={() => handleDelete(goal)} title="Remover meta">
                    ✕
                  </button>
                </div>
              </div>
              <p className="goal-amount">
                {formatCurrency(current)} <span>de {formatCurrency(target)}</span>
              </p>
              {!goal.achievedAt && (
                <div className="progress-track goal-track">
                  <div className="progress-fill" style={{ width: `${percent}%` }} />
                </div>
              )}
              {monthly && (
                <p className="goal-monthly">
                  Guarde no mínimo <strong>{formatCurrency(monthly.perMonth)}/mês</strong>{" "}
                  <span className="field-hint">
                    por {monthly.months} {monthly.months === 1 ? "mês" : "meses"} pra chegar no prazo
                  </span>
                </p>
              )}
              {isOverdue && (
                <p className="goal-monthly field-hint">
                  O prazo passou e faltam {formatCurrency(target - current)}.
                </p>
              )}

              {renderItems(goal)}

              <div className="goal-actions">
                <button type="button" className="btn btn-primary" onClick={() => setMoving({ goal: forMoney, direction: "deposit" })}>
                  Guardar
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  disabled={current <= 0}
                  onClick={() => setMoving({ goal: forMoney, direction: "withdraw" })}
                >
                  Retirar
                </button>
                <button type="button" className="link-button" onClick={() => void toggleHistory(goal)} aria-expanded={historyFor === goal.id}>
                  {historyFor === goal.id ? "Fechar histórico" : "Histórico"}
                </button>
              </div>

              {historyFor === goal.id && (
                <ul className="goal-history">
                  {history === null && <li className="field-hint">Carregando...</li>}
                  {history?.length === 0 && <li className="field-hint">Nada guardado ainda.</li>}
                  {history?.map((row) => {
                    const amount = Number(row.amount);
                    return (
                      <li key={row.id}>
                        <span>
                          {memberName(row.userId)} {amount >= 0 ? "guardou" : "retirou"}
                          {row.itemName && <> · {row.itemName}</>}
                        </span>
                        <span className={amount >= 0 ? "" : "goal-history-out"}>
                          {formatCurrency(Math.abs(amount))} ·{" "}
                          {new Date(row.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      {/* Cotações saíram do menu (não é o dinheiro do casal), mas a tela continua. */}
      <Link to="/investments" className="link goals-quotes-link">
        <Icon name="trend" /> Ver cotações do mercado (Ibovespa e ações)
      </Link>

      {isCreating && <NewGoalModal onClose={() => setIsCreating(false)} onCreated={loadGoals} />}
      {moving && (
        <GoalMoneySheet
          goal={moving.goal}
          direction={moving.direction}
          onClose={() => setMoving(null)}
          onDone={(updated) => replaceGoal(updated as GoalRow)}
        />
      )}
    </AppLayout>
  );
}
