import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { Brand } from "../components/Brand";
import { CategoryBars } from "../components/CategoryBars";
import { categoryColor, tint } from "../utils/categoryColor";
import { formatCurrency, groupByDay, monthLongName } from "../utils/format";
import { paymentMethodLabel, type PaymentMethod } from "../utils/paymentMethod";

interface SharedReport {
  month: string;
  ownerName: string;
  totalIncome: string;
  totalExpense: string;
  expiresAt: string;
  byCategory: { categoryName: string | null; categoryEmoji: string | null; total: string }[];
  transactions: {
    description: string;
    amount: string;
    transactionType: "expense" | "income";
    occurredAt: string;
    categoryName: string | null;
    categoryEmoji: string | null;
    paymentMethod: PaymentMethod | null;
  }[];
}

// Public, read-only page behind the "Copiar link do extrato" button. No
// login and no app chrome: whoever has the link sees this month's snapshot
// until it expires or the owner revokes it.
export default function SharedReportPage() {
  const { token } = useParams();
  const [report, setReport] = useState<SharedReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<SharedReport>(`/public/shares/${token}`)
      .then(setReport)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Não foi possível abrir esse link."));
  }, [token]);

  if (error) {
    return (
      <main className="shared-page">
        <Brand />
        <p className="alert" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!report) {
    return (
      <main className="shared-page">
        <Brand />
        <p className="refresh-note">Abrindo...</p>
      </main>
    );
  }

  const income = Number(report.totalIncome);
  const expense = Number(report.totalExpense);
  const groups = groupByDay(report.transactions);
  const slices = report.byCategory.map((row, index) => ({
    id: `${row.categoryName ?? "none"}-${index}`,
    label: row.categoryName ?? "Sem categoria",
    emoji: row.categoryEmoji,
    value: Number(row.total),
    color: categoryColor(row.categoryName),
  }));

  return (
    <main className="shared-page">
      <Brand />
      <header className="shared-head">
        <h1>
          Extrato de {monthLongName(report.month)} de {report.month.slice(0, 4)}
        </h1>
        <p className="card-subtitle">
          Compartilhado por {report.ownerName} · só leitura · vale até{" "}
          {new Date(report.expiresAt).toLocaleDateString("pt-BR")}
        </p>
      </header>

      <div className="stat-row wrap">
        <div className="stat-box tone-good">
          <p className="label">Entrou</p>
          <p className="value-sm income-text">{formatCurrency(income)}</p>
        </div>
        <div className="stat-box tone-warm">
          <p className="label">Saiu</p>
          <p className="value-sm">{formatCurrency(expense)}</p>
        </div>
        <div className="stat-box">
          <p className="label">Sobrou</p>
          <p className={`value-sm${income - expense >= 0 ? " income-text" : ""}`}>{formatCurrency(income - expense)}</p>
        </div>
      </div>

      {slices.length > 0 && (
        <div className="card">
          <p className="card-title">Para onde foi</p>
          <CategoryBars slices={slices} />
        </div>
      )}

      <div className="card">
        <p className="card-title">Lançamentos</p>
        {report.transactions.length === 0 && <p className="empty-state">Nenhum lançamento neste mês.</p>}
        <ul className="transaction-list">
          {groups.map((dayGroup) => (
            <li key={dayGroup.label} className="shared-day">
              <p className="date-group-header">{dayGroup.label}</p>
              <ul>
                {dayGroup.items.map((tx, index) => (
                  <li key={`${tx.occurredAt}-${index}`} className="transaction-row">
                    <span className="transaction-icon" style={{ background: tint(categoryColor(tx.categoryName)) }}>
                      {tx.categoryEmoji ?? "💸"}
                    </span>
                    <div className="transaction-info">
                      <span className="transaction-desc">
                        <span className="text-truncate">{tx.description}</span>
                      </span>
                      <span className="transaction-meta">
                        <span className="text-truncate">
                          {tx.categoryName ?? "Sem categoria"}
                          {tx.paymentMethod && ` · ${paymentMethodLabel(tx.paymentMethod)}`}
                        </span>
                      </span>
                    </div>
                    <span className={`transaction-amount ${tx.transactionType}`}>
                      {tx.transactionType === "income" ? "+" : "-"}
                      {formatCurrency(Number(tx.amount))}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
