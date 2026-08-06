interface FinancialHealthBadgeProps {
  monthlyIncome: number;
  monthlyExpense: number;
}

// Scoped entirely to the selected month (never the account's all-time
// balance) -- net <= 0 is critical, a thin leftover (less than what was
// spent) is a warning, a comfortable leftover reads as healthy.
export function FinancialHealthBadge({ monthlyIncome, monthlyExpense }: FinancialHealthBadgeProps) {
  const net = monthlyIncome - monthlyExpense;
  let level: "good" | "warning" | "critical";
  let text: string;

  if (net <= 0) {
    level = "critical";
    text = "Atenção com o mês";
  } else if (monthlyExpense > 0 && net < monthlyExpense) {
    level = "warning";
    text = "Fique de olho";
  } else {
    level = "good";
    text = "Saúde financeira boa";
  }

  const icon = level === "good" ? "🟢" : level === "warning" ? "🟡" : "🔴";

  return (
    <span className={`health-badge health-badge-${level}`} title="Entrada vs. gasto do mês selecionado">
      {icon} {text}
    </span>
  );
}
