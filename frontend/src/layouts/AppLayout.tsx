import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { useTheme } from "../hooks/useTheme";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Painel", icon: "🏠" },
  { to: "/par", label: "Par", icon: "💞" },
  { to: "/transactions/new", label: "Nova despesa", icon: "➕" },
  { to: "/goals", label: "Metas", icon: "🎯" },
  { to: "/reports", label: "Relatórios", icon: "📊" },
  { to: "/account", label: "Conta", icon: "⚙️" },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  return (
    <div className="app-shell-nav">
      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <Brand />
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-nav-link${isActive ? " active" : ""}`}
            >
              <span className="app-nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="app-sidebar-footer">
          <span className="app-sidebar-user">{user?.displayName}</span>
          <button
            type="button"
            className="theme-toggle"
            onClick={toggle}
            title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
