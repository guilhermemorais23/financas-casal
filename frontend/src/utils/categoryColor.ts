// Fixed categorical order (validated for CVD-safe adjacent contrast — see the
// dataviz skill's palette reference). Categories get a stable slot via a hash
// of their id, never a randomly-cycled color.
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

// Stable categorical slot per member, by their sorted index within the
// group (0 = "Você", 1..N-1 = the other members in a fixed order) -- no
// longer a fixed you/partner pair now that a group can have any size.
export function personColor(memberIndex: number): string {
  return CATEGORY_SLOTS[memberIndex % CATEGORY_SLOTS.length];
}

export function tint(color: string): string {
  return `color-mix(in srgb, ${color} 16%, var(--surface))`;
}
