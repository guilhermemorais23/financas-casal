// Shimmering placeholder blocks, shaped like the content that's about to
// load, instead of a plain "Carregando..." line -- reads as "getting there"
// rather than "something might be broken".
export function Skeleton({
  width = "100%",
  height = "0.9rem",
  radius = "6px",
}: {
  width?: string;
  height?: string;
  radius?: string;
}) {
  return <span className="skeleton" style={{ width, height, borderRadius: radius }} />;
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
    <div className="page-stack">
      {Array.from({ length: cards }).map((_, i) => (
        <CardSkeleton key={i} lines={i === 0 ? 1 : 2} />
      ))}
    </div>
  );
}
