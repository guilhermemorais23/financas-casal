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

// Person/identity colors are brand-matched (terracotta for "Você", olive
// green for the next member) rather than the CVD-safe chart palette above --
// identity is always paired with a name label too, so strict CVD contrast
// between just two fixed slots matters less than matching the brand look.
// Falls back to the categorical slots for a 3rd+ member.
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
