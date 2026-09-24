// Full months between today and a goal's deadline -- 22/09 -> 22/12 is 3,
// 22/09 -> 21/12 is 2 (the third month isn't complete yet). Negative once
// the deadline has passed.
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

// The least someone has to put in each month to hit the target by the
// deadline: what's missing / months left, rounded UP to the cent (rounding
// down would leave the goal a few cents short on the last month). A
// deadline less than a month away counts as 1 month. null when there's no
// deadline, the goal is already reached, or the deadline has passed.
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
