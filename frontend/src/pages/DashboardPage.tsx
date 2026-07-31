import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";

export function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Brand />
        <button type="button" className="btn btn-ghost" onClick={logout}>
          Sair
        </button>
      </header>
      <main className="app-content">
        <div className="stat-card">
          <p className="label">Conta conjunta</p>
          <p className="value">Nossa Conta</p>
        </div>
        <h1>Bem-vindo(a), {user?.displayName}</h1>
        <p className="card-subtitle">{user?.email}</p>
        <span className="badge">Casal vinculado</span>
      </main>
    </div>
  );
}
