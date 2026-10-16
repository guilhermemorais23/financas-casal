interface FinancialHealthBadgeProps {
  monthlyIncome: number;
  monthlyExpense: number;
}

// Considera só o mês escolhido (nunca o saldo de sempre da conta) -- sobra
// <= 0 é crítico, uma sobra pequena (menor que o que foi gasto) é atenção, e
// uma sobra folgada é saudável.
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

  return (
    <span className={`health-badge health-badge-${level}`} title="Entrada vs. gasto do mês selecionado">
      <span className="health-badge-dot" aria-hidden="true" />
      {text}
    </span>
  );
}
