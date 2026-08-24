import { useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { type DailyTrendPoint } from "../components/DailyTrendChart";
import { IncomeExpenseBars } from "../components/IncomeExpenseBars";
import { ProfileSettingsModal } from "../components/ProfileSettingsModal";
import { useTheme } from "../hooks/useTheme";
import { currentMonthParam, formatCurrency, monthLongName } from "../utils/format";

interface BudgetSummary {
  budget: { capAmount: string } | null;
  spent: number;
}

const NAV_ITEMS = [
  { to: "/dashboard", label: "Painel", icon: "🏠" },
  { to: "/par", label: "Par", icon: "💞" },
  { to: "/transactions/new", label: "Nova despesa", icon: "➕" },
  { to: "/debts", label: "Dívidas", icon: "💳" },
  { to: "/cards", label: "Cartão conjunto", icon: "🧾" },
  { to: "/goals", label: "Metas", icon: "🎯" },
  { to: "/reports", label: "Relatórios", icon: "📊" },
  { to: "/account", label: "Conta", icon: "⚙️" },
];

// Admin isn't a plain link -- it expands into a submenu (handled separately
// in the JSX below) instead of navigating straight to a page.
const ADMIN_SUBLINKS = [
  { section: "overview", label: "Visão geral" },
  { section: "logs", label: "Logs" },
];

const BOTTOM_NAV_ITEMS = [
  { to: "/dashboard", label: "Painel", icon: "🏠" },
  { to: "/par", label: "Par", icon: "💞" },
  { to: "/debts", label: "Dívidas", icon: "💳" },
  { to: "/goals", label: "Metas", icon: "🎯" },
  { to: "/reports", label: "Relatórios", icon: "📊" },
];

export function AppLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, token, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [isNavOpen, setIsNavOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAdminNavOpen, setIsAdminNavOpen] = useState(false);
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(null);
  const [dailyTrend, setDailyTrend] = useState<DailyTrendPoint[] | null>(null);
  const location = useLocation();
  const isOnNewTransaction = location.pathname === "/transactions/new";
  // Dashboard/Reports keep their selected month in the URL (?month=...) --
  // read the same value here so these widgets track whatever month is being
  // browsed instead of always defaulting to the real current month.
  const [searchParams] = useSearchParams();
  const sidebarMonth = searchParams.get("month") ?? currentMonthParam();

  useEffect(() => {
    if (!token) return;
    // Decorative sidebar widgets -- a failed fetch just hides them, no error UI.
    apiRequest<BudgetSummary>(`/budgets/current?month=${sidebarMonth}`, { token })
      .then(setBudgetSummary)
      .catch(() => setBudgetSummary(null));
    apiRequest<DailyTrendPoint[]>(`/transactions/daily-series?month=${sidebarMonth}`, { token })
      .then(setDailyTrend)
      .catch(() => setDailyTrend(null));
  }, [token, sidebarMonth]);

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

          <button
            type="button"
            className={`app-nav-link app-nav-link-expandable${location.pathname === "/admin" ? " active" : ""}`}
            onClick={() => setIsAdminNavOpen((open) => !open)}
            aria-expanded={isAdminNavOpen}
          >
            <span className="app-nav-icon">🛠️</span>
            Admin
            <span className={`app-nav-chevron${isAdminNavOpen ? " open" : ""}`}>▾</span>
          </button>
          {isAdminNavOpen && (
            <div className="app-nav-submenu">
              {ADMIN_SUBLINKS.map((sublink) => (
                <Link
                  key={sublink.section}
                  to={`/admin?section=${sublink.section}`}
                  className={`app-nav-sublink${
                    location.pathname === "/admin" && (searchParams.get("section") ?? "overview") === sublink.section
                      ? " active"
                      : ""
                  }`}
                  onClick={() => setIsNavOpen(false)}
                >
                  {sublink.label}
                </Link>
              ))}
            </div>
          )}
        </nav>

        {budgetSummary && <SidebarSpending summary={budgetSummary} month={sidebarMonth} />}
        {dailyTrend && dailyTrend.length > 0 && (
          <div className="daily-trend-chart">
            <p className="app-sidebar-spending-label">Entrada x saída</p>
            <IncomeExpenseBars
              income={Number(dailyTrend[dailyTrend.length - 1].income)}
              expense={Number(dailyTrend[dailyTrend.length - 1].expense)}
            />
          </div>
        )}

        <div className="app-sidebar-footer">
          <div className="app-sidebar-footer-row">
            {user?.photoDataUrl ? (
              <img src={user.photoDataUrl} alt="" className="app-sidebar-avatar" />
            ) : (
              <span className="app-sidebar-avatar app-sidebar-avatar-fallback">
                {user?.displayName?.charAt(0).toUpperCase() ?? "?"}
              </span>
            )}
            <span className="app-sidebar-user">{user?.displayName}</span>
            <button
              type="button"
              className="theme-toggle"
              onClick={() => setIsProfileOpen(true)}
              title="Editar perfil"
            >
              ⚙️
            </button>
            <button
              type="button"
              className="theme-toggle"
              onClick={toggle}
              title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={logout}>
            Sair
          </button>
        </div>
      </aside>

      {isProfileOpen && <ProfileSettingsModal onClose={() => setIsProfileOpen(false)} />}
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

function SidebarSpending({ summary, month }: { summary: BudgetSummary; month: string }) {
  const cap = summary.budget ? Number(summary.budget.capAmount) : null;
  const rawPercent = cap ? (summary.spent / cap) * 100 : 0;
  const percent = Math.min(100, rawPercent);
  const severity = rawPercent >= 100 ? "over" : rawPercent >= 80 ? "warning" : "";

  return (
    <div className="app-sidebar-spending">
      <p className="app-sidebar-spending-label">Gasto em {monthLongName(month)}</p>
      <p className="app-sidebar-spending-value">{formatCurrency(summary.spent)}</p>
      {cap ? (
        <>
          <div className="progress-track thin">
            <div className={`progress-fill${severity ? ` ${severity}` : ""}`} style={{ width: `${percent}%` }} />
          </div>
          <p className="app-sidebar-spending-cap">de {formatCurrency(cap)}</p>
        </>
      ) : (
        <Link to="/account" className="app-sidebar-spending-cap link">
          Definir orçamento
        </Link>
      )}
    </div>
  );
}
