import { formatCurrency } from "../utils/format";

// O mesmo par series-1/series-2 do IncomeExpenseDonut -- validado pra
// daltonismo (scripts/validate_palette.js) e coerente com como "Entrada" e
// "Saída" já aparecem no resto do app.
const BARS = [
  { key: "income" as const, label: "Entrada", color: "var(--series-1)" },
  { key: "expense" as const, label: "Saída", color: "var(--series-2)" },
];

export function IncomeExpenseBars({ income, expense }: { income: number; expense: number }) {
  // As duas barras usam a mesma escala (a maior das duas), pra os comprimentos
  // serem comparáveis -- nunca cada barra no seu próprio 100%.
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
