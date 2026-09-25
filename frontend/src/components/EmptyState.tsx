// Texto de lista vazia -- reusado em todo lugar pra manter o mesmo visual.
// Sem emoji: o app fica com cara de produto, não de gerado por IA.
export function EmptyState({ children }: { children: string }) {
  return (
    <div className="empty-state-friendly">
      <p>{children}</p>
    </div>
  );
}
