// ============================================================================
// Preferências do app: pra que a pessoa usa o PAR. e quais telas ela quer ver
// ============================================================================
// O app tem muita coisa (cartões, dívidas, empréstimos, metas...). Quem só
// quer anotar gastos se perde. No primeiro acesso a pessoa diz o uso (sozinha,
// casal, amigos) e o que quer resolver; daí sai quais módulos ficam ligados no
// menu. Ela pode ligar/desligar cada um depois, na tela Conta.
// Guardado no documento do usuário (campo `preferences`): é da pessoa, não do
// grupo -- o par pode querer ver outras telas.
// ============================================================================

export const USAGES = ["solo", "couple", "friends"] as const;
export type Usage = (typeof USAGES)[number];

export const GOALS = ["spending", "split", "debts", "saving"] as const;
export type Goal = (typeof GOALS)[number];

export const MODULE_KEYS = ["cards", "payables", "debts", "loans", "goals", "investments", "shopping", "reports"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export type Modules = Record<ModuleKey, boolean>;

export interface Preferences {
  usage: Usage | null;
  goals: Goal[];
  modules: Modules;
}

// Quais módulos ligar a partir das respostas. Sem resposta (usage null) liga
// tudo: é o app como sempre foi, e ninguém perde tela que já usava.
// Cartões, contas a pagar e relatórios servem pra todo mundo; o resto só
// aparece pra quem disse que precisa.
export function defaultModules(usage: Usage | null, goals: Goal[]): Modules {
  if (usage === null) {
    return Object.fromEntries(MODULE_KEYS.map((key) => [key, true])) as Modules;
  }
  const saving = goals.includes("saving");
  const debts = goals.includes("debts");
  return {
    cards: true,
    payables: true,
    reports: true,
    goals: saving,
    investments: saving,
    debts,
    loans: debts,
    // Lista de compras é coisa de casa dividida.
    shopping: usage === "couple",
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class InvalidPreferencesError extends Error {}

// Ligar/desligar: só chaves conhecidas, valor sempre booleano.
export function parseModulesPatch(value: unknown): Partial<Modules> {
  if (!isPlainObject(value)) {
    throw new InvalidPreferencesError("Os módulos precisam ser um objeto { módulo: true/false }.");
  }
  const result: Partial<Modules> = {};
  for (const [key, flag] of Object.entries(value)) {
    if (!(MODULE_KEYS as readonly string[]).includes(key)) {
      throw new InvalidPreferencesError(`Módulo desconhecido: ${key}.`);
    }
    if (typeof flag !== "boolean") {
      throw new InvalidPreferencesError(`O módulo ${key} precisa ser true ou false.`);
    }
    result[key as ModuleKey] = flag;
  }
  return result;
}

// Corpo do PUT /api/me/preferences. Sem `modules`, vale o padrão das
// respostas; com `modules`, o que faltar também vem do padrão.
export function parsePreferencesBody(body: unknown): Preferences {
  if (!isPlainObject(body)) {
    throw new InvalidPreferencesError("Envie as preferências como { usage, goals, modules? }.");
  }
  const { usage, goals, modules } = body;
  if (usage !== null && !(USAGES as readonly unknown[]).includes(usage)) {
    throw new InvalidPreferencesError("Uso inválido: escolha solo, couple, friends ou null.");
  }
  if (!Array.isArray(goals)) {
    throw new InvalidPreferencesError("Os objetivos precisam ser uma lista.");
  }
  for (const goal of goals) {
    if (!(GOALS as readonly unknown[]).includes(goal)) {
      throw new InvalidPreferencesError(`Objetivo desconhecido: ${String(goal)}.`);
    }
  }
  if (new Set(goals).size !== goals.length) {
    throw new InvalidPreferencesError("Objetivo repetido na lista.");
  }
  const validUsage = usage as Usage | null;
  const validGoals = goals as Goal[];
  const patch = modules === undefined ? {} : parseModulesPatch(modules);
  return { usage: validUsage, goals: validGoals, modules: { ...defaultModules(validUsage, validGoals), ...patch } };
}

// Leitura do que está gravado: tolerante (dado velho ou mexido à mão no
// console não derruba o /api/me). Valor estranho vira o padrão.
export function preferencesFromStored(value: unknown): Preferences | null {
  if (!isPlainObject(value)) return null;
  const usage = (USAGES as readonly unknown[]).includes(value.usage) ? (value.usage as Usage) : null;
  const goals = Array.isArray(value.goals)
    ? [...new Set(value.goals.filter((goal): goal is Goal => (GOALS as readonly unknown[]).includes(goal)))]
    : [];
  const modules = defaultModules(usage, goals);
  if (isPlainObject(value.modules)) {
    for (const key of MODULE_KEYS) {
      const flag = value.modules[key];
      if (typeof flag === "boolean") modules[key] = flag;
    }
  }
  return { usage, goals, modules };
}
