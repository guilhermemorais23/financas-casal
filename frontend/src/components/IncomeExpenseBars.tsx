import { formatCurrency } from "../utils/format";

// Same series-1/series-2 pair as IncomeExpenseDonut -- validated CVD-safe
// (scripts/validate_palette.js) and consistent with how "Entrada"/"Saída"
// already read everywhere else in the app.
const BARS = [
  { key: "income" as const, label: "Entrada", color: "var(--series-1)" },
  { key: "expense" as const, label: "Saída", color: "var(--series-2)" },
];

export function IncomeExpenseBars({ income, expense }: { income: number; expense: number }) {
  // Both bars share one scale (the larger of the two) so their lengths stay
  // comparable -- never each bar normalized to its own 100%.
  const max = Math.max(income, expense, 1);
  const values = { income, expense };

  return (
    <ul className="category-breakdown">
      {BARS.map((bar) => {
        const value = values[bar.key];
        return (
          <li key={bar.key}>
            <div className="category-row-header">
              <span className="category-name">
                <span className="identity-dot" style={{ background: bar.color }} />
                {bar.label}
              </span>
              <span className="value">{formatCurrency(value)}</span>
            </div>
            <div className="progress-track thin">
              <div className="progress-fill" style={{ width: `${(value / max) * 100}%`, background: bar.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
