import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { useTheme } from "../hooks/useTheme";

const NAV_ITEMS = [
  { to: "/dashboard", label: "Painel", icon: "🏠" },
  { to: "/par", label: "Par", icon: "💞" },
  { to: "/transactions/new", label: "Nova despesa", icon: "➕" },
  { to: "/debts", label: "Dívidas", icon: "💳" },
  { to: "/goals", label: "Metas", icon: "🎯" },
  { to: "/reports", label: "Relatórios", icon: "📊" },
  { to: "/account", label: "Conta", icon: "⚙️" },
];

const BOTTOM_NAV_ITEMS = [
  { to: "/dashboard", label: "Painel", icon: "🏠" },
  { to: "/par", label: "Par", icon: "💞" },
  { to: "/debts", label: "Dívidas", icon: "💳" },
  { to: "/goals", label: "Metas", icon: "🎯" },
  { to: "/reports", label: "Relatórios", icon: "📊" },
];

export function AppLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const location = useLocation();
  const isOnNewTransaction = location.pathname === "/transactions/new";

  useEffect(() => {
    document.body.style.overflow = isNavOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isNavOpen]);

  useEffect(() => {
    if (!isNavOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsNavOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isNavOpen]);

  return (
    <div className="app-shell-nav">
      <header className="app-mobile-topbar">
        <button
          type="button"
          className="hamburger-btn"
          onClick={() => setIsNavOpen(true)}
          aria-label="Abrir menu"
        >
          ☰
        </button>
        <Brand />
      </header>

      {isNavOpen && <div className="app-nav-overlay" onClick={() => setIsNavOpen(false)} />}

      <aside className={`app-sidebar${isNavOpen ? " is-open" : ""}`}>
        <div className="app-sidebar-brand">
          <Brand />
        </div>
        <nav className="app-nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `app-nav-link${isActive ? " active" : ""}`}
              onClick={() => setIsNavOpen(false)}
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
      <main className={`app-main${wide ? " app-main-wide" : ""}`}>{children}</main>

      <nav className="app-bottom-nav">
        {BOTTOM_NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `app-bottom-nav-link${isActive ? " active" : ""}`}
          >
            <span className="app-bottom-nav-icon">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      {!isOnNewTransaction && (
        <Link to="/transactions/new" className="global-fab" aria-label="Nova despesa" title="Nova despesa">
          +
        </Link>
      )}
    </div>
  );
}
