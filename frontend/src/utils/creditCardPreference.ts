import { groupSuffix } from "../api/activeGroup";
// Cartão padrão pro "Crédito": na primeira compra no crédito o app pergunta
// se quer lançar num cartão; a resposta fica guardada aqui e as próximas já
// vão direto pra ele (sempre dá pra trocar no próprio lançamento ou em
// Cartões). "none" = a pessoa disse que não quer ligar a nenhum cartão;
// null = ainda não respondeu. Fica neste aparelho (localStorage), por
// usuário -- se o armazenamento falhar, o app só volta a perguntar.

export type CreditCardPreference = string | "none" | null;

// Cartões são de um grupo: cada grupo lembra o seu.
const key = (userId: string) => `par:credit-card:${userId}${groupSuffix()}`;

export function readCreditCardPreference(userId: string): CreditCardPreference {
  if (!userId) return null;
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

export function saveCreditCardPreference(userId: string, value: string | "none" | null): void {
  if (!userId) return;
  try {
    if (value === null) localStorage.removeItem(key(userId));
    else localStorage.setItem(key(userId), value);
  } catch {
    // ignora
  }
}

// O cartão guardado só vale se ainda existe -- apagou o cartão, volta a
// perguntar.
export function resolveCreditCardPreference(
  preference: CreditCardPreference,
  cardIds: string[]
): CreditCardPreference {
  if (preference === "none") return "none";
  return preference && cardIds.includes(preference) ? preference : null;
}
