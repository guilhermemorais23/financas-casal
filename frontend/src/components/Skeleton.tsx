// Blocos brilhando, com o formato do conteúdo que vai carregar, em vez de
// uma linha "Carregando..." -- passa a ideia de "está chegando", e não de
// "pode ter quebrado". Só decoração, então cada bloco é aria-hidden; o aviso
// acessível de "carregando" fica uma vez só no PageSkeleton (role="status"),
// igual ao que o leitor de tela recebia do texto que isto substituiu.
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

// Imita o layout real de duas colunas do Painel (.dashboard-grid /
// .dashboard-col) em vez da coluna única do PageSkeleton -- um esqueleto
// genérico ali apareceria como uma coluna larga e depois pularia pra duas
// quando os dados chegassem.
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
