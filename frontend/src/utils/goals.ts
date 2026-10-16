// Meses completos entre hoje e o prazo de uma meta -- 22/09 -> 22/12 dá 3,
// 22/09 -> 21/12 dá 2 (o terceiro mês ainda não fechou). Negativo depois que
// o prazo passou.
export function monthsUntil(deadline: string, today: Date = new Date()): number {
  const [year, month, day] = deadline.split("-").map(Number);
  let months = (year - today.getFullYear()) * 12 + (month - 1 - today.getMonth());
  if (day < today.getDate()) months -= 1;
  return months;
}

export interface MonthlySaving {
  perMonth: number;
  months: number;
}

// O mínimo que a pessoa precisa guardar por mês pra chegar no objetivo até o
// prazo: o que falta / meses restantes, arredondado PRA CIMA no centavo
// (arredondar pra baixo deixaria a meta uns centavos curta no último mês). Um
// prazo a menos de um mês conta como 1 mês. null quando não há prazo, a meta
// já foi atingida ou o prazo passou.
export function minimumMonthlySaving(
  targetAmount: number,
  currentAmount: number,
  deadline: string | null,
  today: Date = new Date()
): MonthlySaving | null {
  if (!deadline) return null;
  const missingCents = Math.round(targetAmount * 100) - Math.round(currentAmount * 100);
  if (missingCents <= 0) return null;

  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (deadline < todayISO) return null;

  const months = Math.max(1, monthsUntil(deadline, today));
  return { perMonth: Math.ceil(missingCents / months) / 100, months };
}
