import type { CSSProperties } from "react";
import { formatCurrency } from "../utils/format";

interface IncomeExpenseDonutProps {
  income: number;
  expense: number;
}

const SIZE = 152;
const RADIUS = 56;
const STROKE = 20;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Small breathing gap between the two arcs (Apple-Health-ring style) instead
// of them butting into each other -- reads much cleaner than a hard seam.
const GAP = 9;

export function IncomeExpenseDonut({ income, expense }: IncomeExpenseDonutProps) {
  const total = income + expense;
  const incomeFraction = total > 0 ? income / total : 0;
  const expenseFraction = total > 0 ? expense / total : 0;
  const net = income - expense;

  const incomeArc = Math.max(incomeFraction * CIRCUMFERENCE - GAP, 0);
  const expenseArc = Math.max(expenseFraction * CIRCUMFERENCE - GAP, 0);

  return (
    <div className="donut-chart">
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="img"
        aria-label={`Receita ${formatCurrency(income)}, gasto ${formatCurrency(expense)}, saldo ${formatCurrency(net)}`}
      >
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={STROKE}
        />
        {total > 0 && (
          <>
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${incomeArc} ${CIRCUMFERENCE}`}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              fill="none"
              stroke="var(--series-2)"
              strokeWidth={STROKE}
              strokeLinecap="round"
              strokeDasharray={`${expenseArc} ${CIRCUMFERENCE}`}
              strokeDashoffset={-(incomeFraction * CIRCUMFERENCE)}
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            />
          </>
        )}
        <text
          x="50%"
          y="46%"
          textAnchor="middle"
          className="donut-center-value"
          fill={net >= 0 ? "var(--status-good)" : "var(--color-danger-text)"}
        >
          {formatCurrency(net)}
        </text>
        <text x="50%" y="61%" textAnchor="middle" className="donut-center-label">
          saldo do mês
        </text>
      </svg>
      <div className="donut-legend">
        <div className="donut-legend-item" style={{ "--legend-tint": "var(--series-1)" } as CSSProperties}>
          <span className="donut-legend-label">
            <span className="identity-dot" style={{ background: "var(--series-1)" }} />
            Receita
          </span>
          <span className="donut-legend-value">{formatCurrency(income)}</span>
          {total > 0 && <span className="donut-legend-percent">{Math.round(incomeFraction * 100)}% do fluxo</span>}
        </div>
        <div className="donut-legend-item" style={{ "--legend-tint": "var(--series-2)" } as CSSProperties}>
          <span className="donut-legend-label">
            <span className="identity-dot" style={{ background: "var(--series-2)" }} />
            Gasto
          </span>
          <span className="donut-legend-value">{formatCurrency(expense)}</span>
          {total > 0 && <span className="donut-legend-percent">{Math.round(expenseFraction * 100)}% do fluxo</span>}
        </div>
      </div>
    </div>
  );
}
