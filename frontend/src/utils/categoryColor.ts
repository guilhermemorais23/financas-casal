// Ordem fixa de cores por categoria (validada pra contraste entre vizinhas
// com daltonismo -- ver a referência de paleta da skill dataviz). Cada
// categoria ganha uma posição estável por um hash do id, nunca uma cor
// sorteada.
const CATEGORY_SLOTS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

export function categoryColor(id: string | null): string {
  if (!id) return "var(--ink-muted)";
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_SLOTS[hash % CATEGORY_SLOTS.length];
}

// As cores de pessoa seguem a marca (roxo --person-1 pra "Você", azul
// --person-2 pro próximo membro) em vez da paleta de gráfico acima, que é
// segura pra daltonismo -- a cor da pessoa sempre vem junto com o nome, então
// o contraste rigoroso entre só duas posições fixas importa menos que
// combinar com a marca. Do 3º membro em diante, usa as posições das
// categorias.
const PERSON_SLOTS = ["var(--person-1)", "var(--person-2)", ...CATEGORY_SLOTS];

export function personColor(memberIndex: number): string {
  return PERSON_SLOTS[memberIndex % PERSON_SLOTS.length];
}

export function tint(color: string): string {
  return `color-mix(in srgb, ${color} 16%, var(--surface))`;
}

export function personTint(color: string): string {
  return `color-mix(in srgb, ${color} 14%, var(--cream))`;
}
