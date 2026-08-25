import { useEffect, useState } from "react";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { QuotesLineChart, type QuoteSeries } from "../components/QuotesLineChart";
import { AppLayout } from "../layouts/AppLayout";

export function InvestmentsPage() {
  const { token } = useAuth();
  const [series, setSeries] = useState<QuoteSeries[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<QuoteSeries[]>("/quotes", { token })
      .then(setSeries)
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 503
            ? "Cotações ainda não configuradas."
            : err instanceof ApiError
              ? err.message
              : "Não foi possível carregar as cotações"
        );
      });
  }, [token]);

  return (
    <AppLayout wide>
      <div className="page-stack">
        <h1>Investimentos</h1>
        <p className="card-subtitle">
          Variação do Ibovespa e de algumas ações no período -- só informativo, não é recomendação de investimento.
        </p>

        <div className="card">
          <p className="card-title">Últimas movimentações</p>
          {error && (
            <p className="alert" role="alert">
              {error}
            </p>
          )}
          {!error && !series && <p className="loading-page">Carregando...</p>}
          {!error && series && series.length === 0 && <p className="empty-state">Nenhuma cotação disponível.</p>}
          {!error && series && series.length > 0 && <QuotesLineChart series={series} />}
        </div>
      </div>
    </AppLayout>
  );
}
