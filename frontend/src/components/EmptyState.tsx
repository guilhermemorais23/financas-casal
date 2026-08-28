// Icon + friendly copy for an empty list -- reused everywhere instead of
// each page hand-rolling the same emoji-span-plus-paragraph markup, so a
// future tweak (spacing, a CTA) only needs to happen in one place.
export function EmptyState({ icon, children }: { icon: string; children: string }) {
  return (
    <div className="empty-state-friendly">
      <span className="empty-state-emoji" aria-hidden="true">
        {icon}
      </span>
      <p>{children}</p>
    </div>
  );
}
