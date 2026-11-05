import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/client";
import { currentMonthParam, formatCurrency, monthLongName, previousMonthParam } from "../utils/format";

interface MonthClose {
  month: string;
  income: number;
  expense: number;
  left: number;
  previousMonth: string;
  previousIncome: number;
  previousExpense: number;
  previousLeft: number;
  topCategories: { name: string; total: number }[];
  hasActivity: boolean;
  // "Entendi" já tocado nesse mês (fica na conta, vale em todo aparelho).
  seen: boolean;
}

// Na primeira semana do mês o Painel mostra como o mês passado fechou -- o
// mesmo resumo do email do dia 1. Depois do "Entendi" só volta no mês
// seguinte (o servidor guarda, então vale depois de sair e entrar e em
// qualquer aparelho); sem o "Entendi", some sozinho no dia 8.
const SHOW_UNTIL_DAY = 7;

export function MonthCloseCard({ token }: { token: string | null }) {
  const [close, setClose] = useState<MonthClose | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!token || new Date().getDate() > SHOW_UNTIL_DAY) return;
    // O mês vem daqui (relógio do aparelho), o mesmo que decidiu mostrar o card.
    apiRequest<MonthClose>(`/month-close?month=${previousMonthParam(currentMonthParam())}`, { token })
      .then((data) => {
        if (data.hasActivity && !data.seen) setClose(data);
      })
      .catch(() => setClose(null));
  }, [token]);

  if (!close || hidden) return null;

  function dismiss() {
    void apiRequest("/month-close/seen", { method: "POST", token, body: { month: close!.month } }).catch(() => {});
    setHidden(true);
  }

  const hadPrevious = close.previousIncome > 0 || close.previousExpense > 0;
  const diff = close.left - close.previousLeft;
  const name = monthLongName(close.month);

  return (
    <div className="card month-close-card">
      <div className="section-header">
        <p className="card-title">Fechamento de {name}</p>
        <Link to={`/reports?month=${close.month}`} className="link">
          Ver relatório
        </Link>
      </div>
      <div className="month-close-numbers">
        <div>
          <span>Entrou</span>
          <strong>{formatCurrency(close.income)}</strong>
        </div>
        <div>
          <span>Saiu</span>
          <strong>{formatCurrency(close.expense)}</strong>
        </div>
        <div>
          <span>Sobrou</span>
          <strong className={close.left < 0 ? "negative" : ""}>{formatCurrency(close.left)}</strong>
        </div>
      </div>
      {hadPrevious && (
        <p className="card-subtitle">
          {diff >= 0 ? `${formatCurrency(diff)} a mais` : `${formatCurrency(-diff)} a menos`} que em{" "}
          {monthLongName(close.previousMonth)}.
        </p>
      )}
      {close.topCategories.length > 0 && (
        <p className="card-subtitle">
          Onde mais foi: {close.topCategories.map((row) => `${row.name} (${formatCurrency(row.total)})`).join(", ")}.
        </p>
      )}
      <button type="button" className="btn btn-outline month-close-dismiss" onClick={dismiss}>
        Entendi
      </button>
    </div>
  );
}
