import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { type DailyTrendPoint } from "../components/DailyTrendChart";
import { GlobalAssistant } from "../components/GlobalAssistant";
import { Icon, type IconName } from "../components/Icon";
import { IncomeExpenseBars } from "../components/IncomeExpenseBars";
import { ProfileSettingsModal } from "../components/ProfileSettingsModal";
import { BILLS_TABS } from "../components/BillsTabs";
import { FeedbackChat, useFeedbackUnread } from "../components/FeedbackChat";
import { useSwipeDownToClose } from "../hooks/useSwipeDownToClose";
import { useTheme } from "../hooks/useTheme";
import { currentMonthParam, formatCurrency, monthLongName } from "../utils/format";

interface BudgetSummary {
  budget: { capAmount: string } | null;
  spent: number;
}

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

// Menu lateral do PC, agrupado pra 10 links virarem 4 listas curtas. "Nova
// despesa" não está aqui -- o + flutuante já faz isso em toda tela.
const NAV_GROUPS: { label: string | null; items: NavItem[] }[] = [
  {
    label: null,
    items: [
      { to: "/dashboard", label: "Painel", icon: "home" },
      { to: "/par", label: "Par", icon: "heart" },
      { to: "/reports", label: "Relatórios", icon: "chart" },
    ],
  },
  {
    label: "Contas",
    items: BILLS_TABS,
  },
  {
    label: "Planejar",
    items: [
      { to: "/goals", label: "Metas", icon: "target" },
      { to: "/investments", label: "Investimentos", icon: "trend" },
      { to: "/shopping", label: "Lista de compras", icon: "cart" },
    ],
  },
  {
    label: "Você",
    items: [{ to: "/account", label: "Conta e grupo", icon: "sliders" }],
  },
];

// Admin isn't a plain link -- it expands into a submenu (handled separately
// in the JSX below) instead of navigating straight to a page.
const ADMIN_SUBLINKS = [
  { section: "overview", label: "Visão geral" },
  { section: "feedback", label: "Feedback" },
  { section: "announcements", label: "Novidades" },
  { section: "billing", label: "Assinaturas" },
  { section: "diagnostics", label: "Diagnóstico" },
  { section: "logs", label: "Logs" },
];

// Celular: Painel · Par · [+] · Contas · Mais. Todo o resto fica na folha
// "Mais", então qualquer tela está a no máximo dois toques.
const MORE_TILES: NavItem[] = [
  { to: "/reports", label: "Relatórios", icon: "chart" },
  { to: "/goals", label: "Metas", icon: "target" },
  { to: "/investments", label: "Investir", icon: "trend" },
  { to: "/shopping", label: "Compras", icon: "cart" },
];

const BILLS_PATHS = BILLS_TABS.map((tab) => tab.to);
const MORE_PATHS = [...MORE_TILES.map((tile) => tile.to), "/account", "/admin"];

// Último valor dos widgets da barra lateral, por mês (vive enquanto o app
// estiver aberto).
const sidebarCache = new Map<string, unknown>();

export function AppLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, token, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const feedbackUnread = useFeedbackUnread();
  const navigate = useNavigate();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isAdminNavOpen, setIsAdminNavOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  useSwipeDownToClose(moreSheetRef, () => setIsMoreOpen(false), isMoreOpen);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isOnNewTransaction = location.pathname === "/transactions/new";
  // Dashboard/Reports keep their selected month in the URL (?month=...) --
  // read the same value here so these widgets track whatever month is being
  // browsed instead of always defaulting to the real current month.
  const [searchParams] = useSearchParams();
  const sidebarMonth = searchParams.get("month") ?? currentMonthParam();
  // Cada página monta o próprio AppLayout, então sem cache a barra lateral
  // sumia e voltava a cada troca de tela. Começa com o último valor do mês e
  // atualiza por trás.
  const [budgetSummary, setBudgetSummary] = useState<BudgetSummary | null>(
    () => (sidebarCache.get(`${user?.id}:budget:${sidebarMonth}`) as BudgetSummary | undefined) ?? null
  );
  const [dailyTrend, setDailyTrend] = useState<DailyTrendPoint[] | null>(
    () => (sidebarCache.get(`${user?.id}:trend:${sidebarMonth}`) as DailyTrendPoint[] | undefined) ?? null
  );

  useEffect(() => {
    if (!token) return;
    // Decorative sidebar widgets -- a failed fetch just hides them, no error UI.
    apiRequest<BudgetSummary>(`/budgets/current?month=${sidebarMonth}`, { token })
      .then((data) => {
        sidebarCache.set(`${user?.id}:budget:${sidebarMonth}`, data);
        setBudgetSummary(data);
      })
      .catch(() => setBudgetSummary(null));
    apiRequest<DailyTrendPoint[]>(`/transactions/daily-series?month=${sidebarMonth}`, { token })
      .then((data) => {
        sidebarCache.set(`${user?.id}:trend:${sidebarMonth}`, data);
        setDailyTrend(data);
      })
      .catch(() => setDailyTrend(null));
  }, [token, sidebarMonth, user?.id]);

  useEffect(() => {
    if (!isUserMenuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setIsUserMenuOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsUserMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isUserMenuOpen]);

  useEffect(() => {
    document.body.style.overflow = isMoreOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMoreOpen]);

  useEffect(() => {
    if (!isMoreOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsMoreOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMoreOpen]);

  // O email "Você recebeu uma resposta" aponta pra ?feedback=1.
  useEffect(() => {
    if (searchParams.get("feedback") === "1") setIsFeedbackOpen(true);
  }, [searchParams]);

  // Qualquer navegação (um atalho, o botão voltar) fecha a folha.
  useEffect(() => {
    setIsMoreOpen(false);
  }, [location.pathname]);

  const isOnBills = BILLS_PATHS.includes(location.pathname);
  const isOnMore = MORE_PATHS.includes(location.pathname);

  function fromSheet(action: () => void) {
    setIsMoreOpen(false);
    action();
  }

  return (
    <div className="app-shell-nav">
      <header className="app-mobile-topbar">
        <Brand animated />
        <button
          type="button"
          className="topbar-avatar"
          onClick={() => setIsMoreOpen(true)}
          aria-label="Abrir menu da conta"
        >
          <Avatar photoDataUrl={user?.photoDataUrl} name={user?.displayName} />
        </button>
      </header>

      <aside className="app-sidebar">
        <div className="app-sidebar-brand">
          <Brand animated />
        </div>
        <div className="app-sidebar-scroll">
        <nav className="app-nav">
          {NAV_GROUPS.map((group) => (
            <div key={group.label ?? "main"} className="app-nav-group">
              {group.label && <p className="app-nav-group-label">{group.label}</p>}
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `app-nav-link${isActive ? " active" : ""}`}
                >
                  <span className="app-nav-icon"><Icon name={item.icon} /></span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}

          {user?.isAdmin && (
            <>
              <button
                type="button"
                className={`app-nav-link app-nav-link-expandable${location.pathname === "/admin" ? " active" : ""}`}
                onClick={() => setIsAdminNavOpen((open) => !open)}
                aria-expanded={isAdminNavOpen}
              >
                <span className="app-nav-icon"><Icon name="wrench" /></span>
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
                        location.pathname === "/admin" &&
                        (searchParams.get("section") ?? "overview") === sublink.section
                          ? " active"
                          : ""
                      }`}
                    >
                      {sublink.label}
                    </Link>
                  ))}
                </div>
              )}
            </>
          )}
        </nav>

        {budgetSummary && <SidebarSpending summary={budgetSummary} month={sidebarMonth} />}
        {dailyTrend && dailyTrend.length > 0 && (
          <div className="daily-trend-chart">
            <p className="app-sidebar-spending-label">Entrada x saída · todas as contas</p>
            <IncomeExpenseBars
              income={Number(dailyTrend[dailyTrend.length - 1].income)}
              expense={Number(dailyTrend[dailyTrend.length - 1].expense)}
            />
          </div>
        )}
        </div>

        <div className="app-sidebar-footer">
          <div className="app-sidebar-footer-row">
            <Avatar photoDataUrl={user?.photoDataUrl} name={user?.displayName} />
            <span className="app-sidebar-user">{user?.displayName}</span>
            <div className="user-menu-wrap" ref={userMenuRef}>
              <button
                type="button"
                className="theme-toggle"
                onClick={() => setIsUserMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={isUserMenuOpen}
                title="Mais opções"
              >
                <Icon name="more" />
              </button>
              {isUserMenuOpen && (
                <div className="user-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setIsProfileOpen(true);
                    }}
                  >
                    <Icon name="user" />
                    Editar perfil
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setIsAssistantOpen((open) => !open);
                    }}
                  >
                    <Icon name="spark" />
                    Assistente PAR.
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      setIsFeedbackOpen(true);
                    }}
                  >
                    <Icon name="chat" />
                    Fale com a gente
                    {feedbackUnread > 0 && <span className="unread-badge">{feedbackUnread}</span>}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu-item"
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      toggle();
                    }}
                  >
                    <Icon name={theme === "dark" ? "sun" : "moon"} />
                    {theme === "dark" ? "Tema claro" : "Tema escuro"}
                  </button>
                  <div className="user-menu-sep" />
                  <button type="button" role="menuitem" className="user-menu-item danger" onClick={logout}>
                    <Icon name="logout" />
                    Sair
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {isProfileOpen && <ProfileSettingsModal onClose={() => setIsProfileOpen(false)} />}
      <main className={`app-main${wide ? " app-main-wide" : ""}`}>{children}</main>

      <nav className="app-bottom-nav" aria-label="Menu principal">
        <NavLink to="/dashboard" className={({ isActive }) => `app-bottom-nav-link${isActive ? " active" : ""}`}>
          <span className="app-bottom-nav-icon"><Icon name="home" /></span>
          Painel
        </NavLink>
        <NavLink to="/par" className={({ isActive }) => `app-bottom-nav-link${isActive ? " active" : ""}`}>
          <span className="app-bottom-nav-icon"><Icon name="heart" /></span>
          Par
        </NavLink>
        <Link
          to="/transactions/new"
          className={`app-bottom-nav-add${isOnNewTransaction ? " active" : ""}`}
          aria-label="Nova despesa"
        >
          <Icon name="plus" />
        </Link>
        <Link to="/cards" className={`app-bottom-nav-link${isOnBills ? " active" : ""}`}>
          <span className="app-bottom-nav-icon"><Icon name="receipt" /></span>
          Contas
        </Link>
        <button
          type="button"
          className={`app-bottom-nav-link${isOnMore || isMoreOpen ? " active" : ""}`}
          onClick={() => setIsMoreOpen((open) => !open)}
          aria-expanded={isMoreOpen}
        >
          <span className="app-bottom-nav-icon">
            <Icon name="more" />
            {feedbackUnread > 0 && <span className="nav-dot" aria-label="Nova resposta" />}
          </span>
          Mais
        </button>
      </nav>

      {isMoreOpen && (
        <div className="more-sheet-backdrop" onClick={() => setIsMoreOpen(false)}>
          <div
            ref={moreSheetRef}
            className="more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Mais opções"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="more-sheet-handle" data-swipe-handle aria-hidden="true" />
            <div className="more-sheet-user">
              <Avatar photoDataUrl={user?.photoDataUrl} name={user?.displayName} />
              <div className="more-sheet-user-text">
                <strong className="text-truncate">{user?.displayName}</strong>
                <span className="text-truncate">{user?.email}</span>
              </div>
            </div>

            <div className="more-sheet-tiles">
              {MORE_TILES.map((tile) => (
                <Link
                  key={tile.to}
                  to={tile.to}
                  className={`more-sheet-tile${location.pathname === tile.to ? " active" : ""}`}
                >
                  <span className="more-sheet-tile-icon"><Icon name={tile.icon} /></span>
                  {tile.label}
                </Link>
              ))}
            </div>

            <div className="more-sheet-list">
              <Link to="/account" className="more-sheet-row">
                <Icon name="sliders" />
                <span>Conta e grupo</span>
              </Link>
              <button type="button" className="more-sheet-row" onClick={() => fromSheet(() => setIsProfileOpen(true))}>
                <Icon name="user" />
                <span>Editar perfil</span>
              </button>
              <button type="button" className="more-sheet-row" onClick={() => fromSheet(() => setIsAssistantOpen(true))}>
                <Icon name="spark" />
                <span>Assistente do mês</span>
              </button>
              <button type="button" className="more-sheet-row" onClick={() => fromSheet(() => setIsFeedbackOpen(true))}>
                <Icon name="chat" />
                <span>Fale com a gente</span>
                {feedbackUnread > 0 && <span className="unread-badge">{feedbackUnread}</span>}
              </button>
              <button type="button" className="more-sheet-row" onClick={toggle}>
                <Icon name={theme === "dark" ? "sun" : "moon"} />
                <span>{theme === "dark" ? "Tema claro" : "Tema escuro"}</span>
              </button>
              {user?.isAdmin && (
                <button type="button" className="more-sheet-row" onClick={() => fromSheet(() => navigate("/admin"))}>
                  <Icon name="wrench" />
                  <span>Admin</span>
                </button>
              )}
              <button type="button" className="more-sheet-row danger" onClick={() => fromSheet(() => void logout())}>
                <Icon name="logout" />
                <span>Sair</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isFeedbackOpen && <FeedbackChat onClose={() => setIsFeedbackOpen(false)} />}

      {!isOnNewTransaction && (
        <Link to="/transactions/new" className="global-fab" aria-label="Nova despesa" title="Nova despesa">
          +
        </Link>
      )}

      <GlobalAssistant isOpen={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} />
    </div>
  );
}

function Avatar({ photoDataUrl, name }: { photoDataUrl?: string | null; name?: string | null }) {
  if (photoDataUrl) return <img src={photoDataUrl} alt="" className="app-sidebar-avatar" />;
  return (
    <span className="app-sidebar-avatar app-sidebar-avatar-fallback">{name?.charAt(0).toUpperCase() ?? "?"}</span>
  );
}

function SidebarSpending({ summary, month }: { summary: BudgetSummary; month: string }) {
  const cap = summary.budget ? Number(summary.budget.capAmount) : null;
  const rawPercent = cap ? (summary.spent / cap) * 100 : 0;
  const percent = Math.min(100, rawPercent);
  const severity = rawPercent >= 100 ? "over" : rawPercent >= 80 ? "warning" : "";

  return (
    <div className="app-sidebar-spending">
      <p className="app-sidebar-spending-label">Nossa Conta em {monthLongName(month)}</p>
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
