import { apiRequest } from "../api/client";

// Cartão padrão pro "Crédito": na primeira compra no crédito o app pergunta
// se quer lançar num cartão; a resposta fica guardada e as próximas já vão
// direto pra ele (sempre dá pra trocar no próprio lançamento ou em Cartões).
// "none" = a pessoa disse que não quer ligar a nenhum cartão; null = ainda
// não respondeu. Fica no perfil (vale em qualquer aparelho); o localStorage
// é só uma cópia pra abrir rápido e pra quando a internet falha.

export type CreditCardPreference = string | "none" | null;

const key = (userId: string) => `par:credit-card:${userId}`;

function readLocal(userId: string): CreditCardPreference {
  if (!userId) return null;
  try {
    return localStorage.getItem(key(userId));
  } catch {
    return null;
  }
}

function writeLocal(userId: string, value: CreditCardPreference): void {
  if (!userId) return;
  try {
    if (value === null) localStorage.removeItem(key(userId));
    else localStorage.setItem(key(userId), value);
  } catch {
    // ignora
  }
}

// Só o que já está neste aparelho, sem esperar a rede.
export function readCachedCreditCardPreference(userId: string): CreditCardPreference {
  return readLocal(userId);
}

export async function readCreditCardPreference(token: string | null | undefined, userId: string): Promise<CreditCardPreference> {
  try {
    const { value } = await apiRequest<{ value: CreditCardPreference }>("/cards/preference", { token });
    // Quem respondeu antes disso existir tinha a resposta só no aparelho:
    // sobe pro perfil uma vez.
    const local = readLocal(userId);
    if (value === null && local) {
      try {
        await saveCreditCardPreference(token, userId, local);
        return local;
      } catch {
        // Cartão que já foi apagado: esquece e volta a perguntar.
        writeLocal(userId, null);
        return null;
      }
    }
    writeLocal(userId, value);
    return value;
  } catch {
    return readLocal(userId);
  }
}

export async function saveCreditCardPreference(
  token: string | null | undefined,
  userId: string,
  value: CreditCardPreference
): Promise<void> {
  writeLocal(userId, value);
  await apiRequest("/cards/preference", { method: "PUT", token, body: { value } });
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
