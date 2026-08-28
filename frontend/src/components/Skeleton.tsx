// Shimmering placeholder blocks, shaped like the content that's about to
// load, instead of a plain "Carregando..." line -- reads as "getting there"
// rather than "something might be broken". Purely decorative, so each block
// is aria-hidden; the accessible "loading" announcement lives once on the
// PageSkeleton wrapper instead (role="status"), matching what a screen
// reader got from the plain text this replaces.
export function Skeleton({
  width = "100%",
  height = "0.9rem",
  radius = "6px",
}: {
  width?: string;
  height?: string;
  radius?: string;
}) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius }} />;
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card">
      <Skeleton width="45%" height="1.05rem" />
      <div style={{ marginTop: "0.9rem", display: "flex", flexDirection: "column", gap: "0.55rem" }}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton key={i} width={i === lines - 1 ? "60%" : "100%"} />
        ))}
      </div>
    </div>
  );
}

export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="page-stack" role="status" aria-label="Carregando">
      {Array.from({ length: cards }).map((_, i) => (
        <CardSkeleton key={i} lines={i === 0 ? 1 : 2} />
      ))}
    </div>
  );
}

// Mirrors the Dashboard's actual two-column layout (.dashboard-grid /
// .dashboard-col) instead of PageSkeleton's single stacked column -- a
// generic skeleton there would flash as one wide column, then jump to two
// once real data lands.
export function DashboardSkeleton() {
  return (
    <div className="page-stack" role="status" aria-label="Carregando">
      <Skeleton height="6.5rem" radius="20px" />
      <div className="dashboard-grid">
        <div className="dashboard-col">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
        <div className="dashboard-col">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </div>
  );
}
