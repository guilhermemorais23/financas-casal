import { useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AppLayout } from "../layouts/AppLayout";
import { formatCurrency } from "../utils/format";
import { readCache, writeCache } from "../utils/pageCache";

interface InstallmentRow {
  id: string;
  installmentNumber: number;
  amount: string;
  isPaid: boolean;
}

interface DebtRow {
  id: string;
  scope: "personal" | "joint";
  name: string;
  description: string | null;
  totalAmount: string;
  installmentsCount: number;
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

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [isInstallment, setIsInstallment] = useState(false);
  const [installmentsCount, setInstallmentsCount] = useState("2");
  const [scope, setScope] = useState<"personal" | "joint">("personal");
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
    if (!name.trim() || !(parsedTotal > 0) || !(parsedCount >= 1)) {
      setError("Informe nome, valor total e (se parcelado) a quantidade de parcelas.");
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
        },
      });
      setName("");
      setDescription("");
      setTotalAmount("");
      setIsInstallment(false);
      setInstallmentsCount("2");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível criar a dívida");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleInstallment(debt: DebtRow, installment: InstallmentRow) {
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
          <button type="button" className="btn-icon" title="Remover dívida" onClick={() => handleDelete(debt.id)}>
            ✕
          </button>
        </div>
        {debt.description && <p className="card-subtitle" style={{ marginBottom: "0.75rem" }}>{debt.description}</p>}

        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${percent}%` }} />
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
                title={`Parcela ${installment.installmentNumber} · ${formatCurrency(Number(installment.amount))}`}
                onClick={() => toggleInstallment(debt, installment)}
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

  const jointDebts = debts?.filter((d) => d.scope === "joint") ?? [];
  const personalDebts = debts?.filter((d) => d.scope === "personal") ?? [];

  return (
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
  );
}
