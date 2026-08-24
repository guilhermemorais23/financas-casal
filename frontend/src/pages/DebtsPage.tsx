import { useEffect, useMemo, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EditDebtModal } from "../components/EditDebtModal";
import { EditInstallmentModal } from "../components/EditInstallmentModal";
import { AppLayout } from "../layouts/AppLayout";
import { currentMonthParam, formatCurrency, monthYearLabel } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

interface InstallmentRow {
  id: string;
  installmentNumber: number;
  amount: string;
  isPaid: boolean;
  referenceMonth: string;
}

interface DebtRow {
  id: string;
  scope: "personal" | "joint";
  name: string;
  description: string | null;
  totalAmount: string;
  installmentsCount: number;
  startMonth: string;
  installments: InstallmentRow[];
  paidAmount: number;
  remainingAmount: number;
  paidCount: number;
  remainingCount: number;
}

export function DebtsPage() {
  const { user, token } = useAuth();
  const cacheKey = `debts:${user?.id ?? "anon"}`;

  const [debts, setDebts] = useState<DebtRow[] | null>(() => readCache(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [editingDebt, setEditingDebt] = useState<DebtRow | null>(null);
  const [editingInstallment, setEditingInstallment] = useState<
    (InstallmentRow & { debtId: string; installmentsCount: number }) | null
  >(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentsCount, setInstallmentsCount] = useState("2");
  const [scope, setScope] = useState<"personal" | "joint">("personal");
  const [startMonth, setStartMonth] = useState(currentMonthParam());
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function load() {
    const result = await apiRequest<DebtRow[]>("/debts", { token });
    setDebts(result);
    writeCache(cacheKey, result);
  }

  useEffect(() => {
    load();
  }, [token]);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsedTotal = Number(totalAmount.replace(",", "."));
    const parsedCount = isInstallment ? Number(installmentsCount) : 1;
    if (!name.trim() || !(parsedTotal > 0) || !(parsedCount >= 1) || !startMonth) {
      setError("Informe nome, valor total, mês de início e (se parcelado) a quantidade de parcelas.");
      return;
    }

    setIsSubmitting(true);
    try {
      await apiRequest("/debts", {
        method: "POST",
        token,
        body: {
          name: name.trim(),
          description: description.trim() || null,
          totalAmount: parsedTotal,
          installmentsCount: parsedCount,
          scope,
          startMonth,
        },
      });
      setName("");
      setDescription("");
      setTotalAmount("");
      setIsInstallment(false);
      setInstallmentsCount("2");
      setStartMonth(currentMonthParam());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a dívida");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleInstallment(debt: DebtRow, installment: InstallmentRow) {
    if (installment.isPaid) {
      const confirmed = window.confirm(
        "Desfazer o pagamento dessa parcela? O lançamento gerado por ela some do extrato."
      );
      if (!confirmed) return;
    }

    try {
      await apiRequest(`/debts/${debt.id}/installments/${installment.id}`, {
        method: "PATCH",
        token,
        body: { isPaid: !installment.isPaid },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível atualizar a parcela");
    }
  }

  async function handleDelete(debtId: string) {
    const confirmed = window.confirm(
      "Excluir essa dívida? Isso também remove as parcelas e os lançamentos gerados por ela."
    );
    if (!confirmed) return;

    try {
      await apiRequest(`/debts/${debtId}`, { method: "DELETE", token });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível remover a dívida");
    }
  }

  function renderDebtCard(debt: DebtRow) {
    const percent = Math.round((debt.paidAmount / Number(debt.totalAmount)) * 100);
    return (
      <div key={debt.id} className="card debt-card">
        <div className="section-header">
          <p className="card-title">
            {debt.scope === "joint" ? "💞" : "💳"} {debt.name}
          </p>
          <div className="transaction-row-actions">
            <button type="button" className="btn-icon" title="Editar dívida" onClick={() => setEditingDebt(debt)}>
              ✎
            </button>
            <button type="button" className="btn-icon" title="Remover dívida" onClick={() => handleDelete(debt.id)}>
              ✕
            </button>
          </div>
        </div>
        {debt.description && <p className="card-subtitle" style={{ marginBottom: "0.75rem" }}>{debt.description}</p>}

        <div className="progress-track">
          <div
            className={`progress-fill${debt.scope === "personal" ? " tone-accent" : ""}`}
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="goal-amounts">
          <span className="debt-mini-value">
            {formatCurrency(debt.paidAmount)} pago de {formatCurrency(Number(debt.totalAmount))}
          </span>
          <span className="debt-mini-remaining">
            faltam {formatCurrency(debt.remainingAmount)} · {debt.remainingCount} de {debt.installmentsCount} parcelas
          </span>
        </div>

        {debt.installmentsCount > 1 && (
          <div className="installment-grid">
            {debt.installments.map((installment) => (
              <button
                key={installment.id}
                type="button"
                className={`installment-chip${installment.isPaid ? " paid" : ""}`}
                title={
                  installment.isPaid
                    ? `Parcela ${installment.installmentNumber} · ${formatCurrency(Number(installment.amount))} · ${monthYearLabel(installment.referenceMonth)} · clique pra editar`
                    : `Parcela ${installment.installmentNumber} · ${formatCurrency(Number(installment.amount))} · conta em ${monthYearLabel(installment.referenceMonth)}`
                }
                onClick={() =>
                  installment.isPaid
                    ? setEditingInstallment({ ...installment, debtId: debt.id, installmentsCount: debt.installmentsCount })
                    : toggleInstallment(debt, installment)
                }
              >
                {installment.isPaid ? "✓" : installment.installmentNumber}
              </button>
            ))}
          </div>
        )}

        {debt.installmentsCount === 1 && (
          <label className="checkbox-field" style={{ marginTop: "0.75rem", marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={debt.installments[0]?.isPaid ?? false}
              onChange={() => debt.installments[0] && toggleInstallment(debt, debt.installments[0])}
            />
            Já foi paga
          </label>
        )}
      </div>
    );
  }

  const jointDebts = useMemo(() => debts?.filter((d) => d.scope === "joint") ?? [], [debts]);
  const personalDebts = useMemo(() => debts?.filter((d) => d.scope === "personal") ?? [], [debts]);

  return (
    <>
      <AppLayout>
      <div className="page-stack">
        <div className="card form-card">
          <h1>Dívidas</h1>
          <p className="card-subtitle">
            Já comprou e tá pagando aos poucos? Registre aqui — parcelado ou não.
          </p>
          <form onSubmit={handleCreate}>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-option${scope === "personal" ? " active" : ""}`}
                onClick={() => setScope("personal")}
              >
                Pessoal
              </button>
              <button
                type="button"
                className={`segmented-option${scope === "joint" ? " active" : ""}`}
                onClick={() => setScope("joint")}
              >
                Do grupo
              </button>
            </div>

            <div className="field">
              <label htmlFor="debt-name">Nome</label>
              <input id="debt-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>

            <div className="field">
              <label htmlFor="debt-description">Descrição (opcional)</label>
              <input
                id="debt-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="field">
              <label htmlFor="debt-total">Valor total (R$) — já com juros, se tiver</label>
              <input
                id="debt-total"
                inputMode="decimal"
                placeholder="0,00"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="debt-start-month">Mês de início</label>
              <input
                id="debt-start-month"
                type="month"
                value={startMonth}
                onChange={(e) => setStartMonth(e.target.value)}
                required
              />
              <p className="card-subtitle" style={{ marginBottom: 0 }}>
                {isInstallment
                  ? "A parcela 1 conta nesse mês, a 2 no seguinte, e assim por diante."
                  : "Mês em que essa dívida entra nas contas."}
              </p>
            </div>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={isInstallment}
                onChange={(e) => setIsInstallment(e.target.checked)}
              />
              Foi parcelado?
            </label>

            {isInstallment && (
              <div className="field">
                <label htmlFor="debt-installments">Quantas parcelas?</label>
                <input
                  id="debt-installments"
                  type="number"
                  min={2}
                  value={installmentsCount}
                  onChange={(e) => setInstallmentsCount(e.target.value)}
                />
                {totalAmount && Number(installmentsCount) >= 1 && (
                  <p className="card-subtitle" style={{ marginBottom: 0 }}>
                    ≈ {formatCurrency(Number(totalAmount.replace(",", ".")) / Number(installmentsCount))} por parcela
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="alert" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
              {isSubmitting ? "Salvando..." : "Adicionar dívida"}
            </button>
          </form>
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            💞 Dívidas do grupo
          </p>
          {jointDebts.length === 0 ? (
            <p className="empty-state">Nenhuma dívida conjunta ainda.</p>
          ) : (
            <div className="page-stack">{jointDebts.map(renderDebtCard)}</div>
          )}
        </div>

        <div>
          <p className="card-title" style={{ marginBottom: "0.75rem" }}>
            👤 Suas dívidas pessoais
          </p>
          {personalDebts.length === 0 ? (
            <p className="empty-state">Nenhuma dívida pessoal ainda.</p>
          ) : (
            <div className="page-stack">{personalDebts.map(renderDebtCard)}</div>
          )}
        </div>
      </div>
      </AppLayout>

      {editingDebt && (
        <EditDebtModal debt={editingDebt} onClose={() => setEditingDebt(null)} onSaved={load} />
      )}

      {editingInstallment && (
        <EditInstallmentModal
          installment={editingInstallment}
          onClose={() => setEditingInstallment(null)}
          onSaved={load}
        />
      )}
    </>
  );
}
