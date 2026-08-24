import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { AppLayout } from "../layouts/AppLayout";

interface ErrorLogEntry {
  id: string;
  source: string;
  message: string;
  path: string | null;
  method: string | null;
  createdAt: number;
}

interface AdminOverview {
  totalUsers: number;
  totalGroups: number;
  pairedGroups: number;
  soloGroups: number;
  telegramLinked: number;
  whatsappLinked: number;
  recentErrors: ErrorLogEntry[];
}

function relativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.round(hours / 24)}d`;
}

export function AdminPage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  // Only one section is ever on screen at a time -- driven entirely by the
  // sidebar's "Admin > Visão geral"/"Logs" sub-links (?section=...).
  const section = searchParams.get("section") === "logs" ? "logs" : "overview";

  useEffect(() => {
    apiRequest<AdminOverview>("/admin/overview", { token })
      .then(setOverview)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 403) {
          setForbidden(true);
          return;
        }
        setError(err instanceof ApiError ? err.message : "Não foi possível carregar o painel");
      });
  }, [token]);

  if (forbidden) {
    return (
      <AppLayout>
        <div className="page-stack">
          <h1>Admin</h1>
          <p className="empty-state">Você não tem acesso a essa área.</p>
        </div>
      </AppLayout>
    );
  }

  if (error) {
    return (
      <AppLayout>
        <p className="alert" role="alert">
          {error}
        </p>
      </AppLayout>
    );
  }

  if (!overview) {
    return (
      <AppLayout>
        <p className="loading-page">Carregando...</p>
      </AppLayout>
    );
  }

  const channelMax = Math.max(overview.telegramLinked, overview.whatsappLinked, 1);

  return (
    <AppLayout wide>
      <div className="page-stack">
        <h1>Admin · {section === "overview" ? "Visão geral" : "Logs"}</h1>

        {section === "overview" && (
          <>
            <div className="stat-row wrap">
              <div className="stat-box tone-accent">
                <p className="label">Usuários</p>
                <p className="value-sm">{overview.totalUsers}</p>
              </div>
              <div className="stat-box tone-accent">
                <p className="label">Grupos</p>
                <p className="value-sm">{overview.totalGroups}</p>
              </div>
              <div className="stat-box tone-good">
                <p className="label">Casais parceados</p>
                <p className="value-sm">{overview.pairedGroups}</p>
              </div>
              <div className="stat-box">
                <p className="label">Contas solo</p>
                <p className="value-sm">{overview.soloGroups}</p>
              </div>
            </div>

            <div className="card">
              <p className="card-title">Canal do assistente</p>
              <ul className="category-breakdown">
                <li>
                  <div className="category-row-header">
                    <span className="category-name">
                      <span className="identity-dot" style={{ background: "var(--series-1)" }} />
                      Telegram
                    </span>
                    <span className="value">{overview.telegramLinked}</span>
                  </div>
                  <div className="progress-track thin">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(overview.telegramLinked / channelMax) * 100}%`,
                        background: "var(--series-1)",
                      }}
                    />
                  </div>
                </li>
                <li>
                  <div className="category-row-header">
                    <span className="category-name">
                      <span className="identity-dot" style={{ background: "var(--series-2)" }} />
                      WhatsApp
                    </span>
                    <span className="value">{overview.whatsappLinked}</span>
                  </div>
                  <div className="progress-track thin">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${(overview.whatsappLinked / channelMax) * 100}%`,
                        background: "var(--series-2)",
                      }}
                    />
                  </div>
                </li>
              </ul>
            </div>
          </>
        )}

        {section === "logs" && (
          <div className="card">
            <p className="card-title">Logs{overview.recentErrors.length > 0 ? ` (${overview.recentErrors.length})` : ""}</p>
            {overview.recentErrors.length === 0 ? (
              <p className="empty-state">Nenhum erro registrado.</p>
            ) : (
              <ul className="transaction-list">
                {overview.recentErrors.map((entry) => (
                  <li key={entry.id} className="transaction-row">
                    <div className="transaction-info">
                      <span className="transaction-desc">{entry.message}</span>
                      <span className="transaction-meta">
                        {entry.source}
                        {entry.method && entry.path ? ` · ${entry.method} ${entry.path}` : ""} ·{" "}
                        {relativeTime(entry.createdAt)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
