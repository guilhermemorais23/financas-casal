// O que a pessoa respondeu na pergunta inicial ("com quem você vai usar?",
// "o que quer resolver?") e quais partes do app ficam visíveis. Quem decide
// os módulos a partir das respostas é o servidor (PUT /me/preferences);
// a tela Conta e grupo liga e desliga um por um (PATCH .../modules).
//
// preferences null = nunca respondeu: o app mostra tudo, como sempre foi.
// Módulo desligado só some do menu e do Painel -- a tela continua abrindo
// por link.
export type Usage = "solo" | "couple" | "friends";
export type Goal = "spending" | "split" | "debts" | "saving";
export type ModuleKey = "cards" | "payables" | "debts" | "loans" | "goals" | "investments" | "shopping" | "reports";

export interface Preferences {
  usage: Usage | null;
  goals: Goal[];
  modules: Record<ModuleKey, boolean>;
}

export const MODULE_KEYS: ModuleKey[] = ["cards", "payables", "debts", "loans", "goals", "investments", "shopping", "reports"];

// Nome e uma linha do que cada função faz (tela Conta e grupo).
export const MODULE_INFO: Record<ModuleKey, { label: string; hint: string }> = {
  cards: { label: "Cartões", hint: "Faturas e limite dos cartões." },
  payables: { label: "Contas a pagar", hint: "Aluguel, internet e o que vence todo mês." },
  debts: { label: "Dívidas", hint: "Parcelas pra quitar aos poucos." },
  loans: { label: "Empréstimos", hint: "Quem te deve e pra quem você deve." },
  goals: { label: "Metas", hint: "Juntar dinheiro pra um objetivo." },
  investments: { label: "Investimentos", hint: "Cotações de moedas e ações." },
  shopping: { label: "Lista de compras", hint: "A lista do mercado, junto com o grupo." },
  reports: { label: "Relatórios", hint: "Gráficos e o extrato completo." },
};

// Ligado, a não ser que a pessoa tenha desligado. Sem resposta (null) ou
// perfil antigo sem o campo: tudo ligado.
export function isModuleOn(preferences: Preferences | null | undefined, key: ModuleKey): boolean {
  return preferences?.modules?.[key] ?? true;
}

// "Refazer as perguntas" (Conta e grupo) reabre a pergunta inicial, que fica
// montada no App, fora das telas.
const listeners = new Set<() => void>();
let reopenCount = 0;

export function reopenOnboarding(): void {
  reopenCount++;
  listeners.forEach((listener) => listener());
}

export function onboardingReopenCount(): number {
  return reopenCount;
}

export function subscribeOnboarding(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Enquanto a pergunta está na tela, os pop-ups de novidade esperam (mesma
// regra da apresentação de boas-vindas).
let onboardingOpen = false;

export function setOnboardingOpen(open: boolean): void {
  if (onboardingOpen === open) return;
  onboardingOpen = open;
  listeners.forEach((listener) => listener());
}

export function isOnboardingOpen(): boolean {
  return onboardingOpen;
}
