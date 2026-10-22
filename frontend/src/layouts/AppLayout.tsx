// A MOLDURA DO APP: tudo que aparece em volta de uma tela logada.
//   - no PC: a barra do topo (app-topnav), com a marca, o seletor de grupo,
//     os links, o botão "Lançar" e o menu da conta;
//   - no celular: a barra do topo (app-mobile-topbar) e a barra de baixo
//     (app-bottom-nav), com o botão "+" no meio.
// Cada página usa assim: <AppLayout> ...miolo da tela... </AppLayout>. A
// página desenha só o miolo; o que é igual em todas fica aqui. Qual barra
// aparece (a do PC ou as do celular) é decidido pelo CSS conforme a largura
// da tela (index.css), não por código.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiRequest } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Brand } from "../components/Brand";
import { GlobalAssistant } from "../components/GlobalAssistant";
import { GroupSwitcher } from "../components/GroupSwitcher";
import { Icon, type IconName } from "../components/Icon";
import { LaunchMenu } from "../components/LaunchMenu";
import { ProfileSettingsModal } from "../components/ProfileSettingsModal";
import { BILLS_TABS } from "../components/BillsTabs";
import { FeedbackChat, useFeedbackUnread } from "../components/FeedbackChat";
import { useSwipeDownToClose } from "../hooks/useSwipeDownToClose";
import { useTheme } from "../hooks/useTheme";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

// Menu do PC (barra do topo): uma lista só, na ordem de uso. "Nova despesa"
// não está aqui -- o botão "Lançar" já faz isso em toda tela.
// Contas é uma entrada só -- Cartões, A pagar e Empréstimos ficam nas abas
// dentro dela. couple = só aparece pra quem está com o par no grupo; solo =
// só pra quem está sozinho.
const NAV_ITEMS: (NavItem & { couple?: boolean; solo?: boolean })[] = [
  { to: "/dashboard", label: "Painel", icon: "home" },
  { to: "/par", label: "Par", icon: "heart", couple: true },
  { to: "/reports", label: "Relatórios", icon: "chart" },
  { to: "/contas", label: "Contas", icon: "receipt" },
  { to: "/goals", label: "Metas", icon: "target" },
  { to: "/shopping", label: "Lista de compras", icon: "cart", couple: true },
  { to: "/account", label: "Conta e grupo", icon: "sliders" },
];

// Celular: Painel · Par · [+] · Contas · Mais. Todo o resto fica na folha
// "Mais", então qualquer tela está a no máximo dois toques.
const MORE_TILES: (NavItem & { couple?: boolean })[] = [
  { to: "/reports", label: "Relatórios", icon: "chart", couple: true },
  { to: "/goals", label: "Metas", icon: "target" },
  { to: "/shopping", label: "Compras", icon: "cart", couple: true },
];

const BILLS_PATHS = [...BILLS_TABS.map((tab) => tab.to), "/debts", "/recurring-bills"];
const INVITE_PATH = "/account#convite";
// Cotações (Investimentos) saiu do menu mas a tela continua, pelo link em Metas.
const MORE_PATHS = [...MORE_TILES.map((tile) => tile.to), "/investments", "/account", "/admin"];

// Par e Lista de compras são coisa de casal: quem usa sozinho não vê no menu
// (as telas continuam existindo) e vê "Convidar meu par" no lugar. Guarda a
// resposta pra não piscar a cada troca de tela.
const coupleCache = new Map<string, boolean>();

function readCoupleFlag(userId: string | undefined): boolean | null {
  if (!userId) return null;
  if (coupleCache.has(userId)) return coupleCache.get(userId) ?? null;
  try {
    const stored = localStorage.getItem(`par:is-couple:${userId}`);
    if (stored === "1" || stored === "0") return stored === "1";
  } catch {
    // Sem storage: decide quando /groups/me responder.
  }
  return null;
}

export function AppLayout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { user, token, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);
  const feedbackUnread = useFeedbackUnread();
  const navigate = useNavigate();
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  useSwipeDownToClose(moreSheetRef, () => setIsMoreOpen(false), isMoreOpen);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isOnNewTransaction = location.pathname === "/transactions/new";
  const [searchParams] = useSearchParams();

  // Enquanto não sabe (primeiro acesso), mostra tudo -- a maioria é casal.
  const [isCouple, setIsCouple] = useState<boolean | null>(() => readCoupleFlag(user?.id));
  useEffect(() => {
    if (!token || !user?.id) return;
    const userId = user.id;
    apiRequest<{ members: unknown[] }>("/groups/me", { token })
      .then((group) => {
        const couple = (group?.members?.length ?? 0) > 1;
        coupleCache.set(userId, couple);
        try {
          localStorage.setItem(`par:is-couple:${userId}`, couple ? "1" : "0");
        } catch {
          // Sem storage: o cache em memória basta.
        }
        setIsCouple(couple);
      })
      .catch(() => undefined);
  }, [token, user?.id]);
  // Enquanto não sabe, mostra o menu do casal (a maioria).
  const isSolo = isCouple === false;
  const showItem = (item: { couple?: boolean; solo?: boolean }) => (item.couple ? !isSolo : item.solo ? isSolo : true);

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

  // A fatura (/cards/:id/fatura) também fica dentro de Contas.
  const isOnBills = BILLS_PATHS.includes(location.pathname) || location.pathname.startsWith("/cards/");
  const isOnMore = MORE_PATHS.includes(location.pathname) && !(isSolo && location.pathname === "/reports");

  function fromSheet(action: () => void) {
    setIsMoreOpen(false);
    action();
  }

  return (
    <div className="app-shell-nav has-topnav">
      <header className="app-mobile-topbar">
        <Brand animated />
        <GroupSwitcher className="group-switcher-topbar" />
        <button
          type="button"
          className="topbar-avatar"
          onClick={() => setIsMoreOpen(true)}
          aria-label="Abrir menu da conta"
        >
          <Avatar photoDataUrl={user?.photoDataUrl} name={user?.displayName} />
        </button>
      </header>

      <header className="app-topnav">
        <Brand animated />
        <GroupSwitcher className="group-switcher-topnav" />
        <nav className="app-topnav-links" aria-label="Menu principal">
          {NAV_ITEMS.filter(showItem).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `app-topnav-link${isActive || (item.to === "/contas" && isOnBills) ? " active" : ""}`
              }
            >
              {item.label}
            </NavLink>
          ))}
          {isSolo && (
            <Link to={INVITE_PATH} className="app-topnav-link">
              Convidar meu par
            </Link>
          )}
          {user?.isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => `app-topnav-link${isActive ? " active" : ""}`}>
              Admin
            </NavLink>
          )}
        </nav>
        <div className="app-topnav-right">
          {/* O mesmo menu de hoje (Despesa, Receita, Importar extrato,
              Guardar na meta); no PC ele abre embaixo deste botão. */}
          <button
            type="button"
            data-launch-toggle
            className="app-topnav-launch"
            aria-expanded={isLaunchOpen}
            onClick={() => setIsLaunchOpen((open) => !open)}
          >
            <Icon name="plus" />
            Lançar
          </button>
          <div className="user-menu-wrap" ref={userMenuRef}>
            <button
              type="button"
              className="app-topnav-avatar"
              onClick={() => setIsUserMenuOpen((open) => !open)}
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              aria-label="Menu da conta"
              title={user?.displayName ?? "Menu da conta"}
            >
              <Avatar photoDataUrl={user?.photoDataUrl} name={user?.displayName} />
              {feedbackUnread > 0 && <span className="nav-dot" aria-label="Nova resposta" />}
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
      </header>

      {isProfileOpen && <ProfileSettingsModal onClose={() => setIsProfileOpen(false)} />}
      <main className={`app-main${wide ? " app-main-wide" : ""}`}>
        {user?.maintenance && (
          <p className="maintenance-banner" role="status">
            <Icon name="wrench" className="icon" />
            <span>{user.maintenance}</span>
          </p>
        )}
        {children}
      </main>

      <nav className="app-bottom-nav" aria-label="Menu principal">
        <NavLink to="/dashboard" className={({ isActive }) => `app-bottom-nav-link${isActive ? " active" : ""}`}>
          <span className="app-bottom-nav-icon"><Icon name="home" /></span>
          Painel
        </NavLink>
        {isSolo ? (
          <NavLink to="/reports" className={({ isActive }) => `app-bottom-nav-link${isActive ? " active" : ""}`}>
            <span className="app-bottom-nav-icon"><Icon name="chart" /></span>
            Relatórios
          </NavLink>
        ) : (
          <NavLink to="/par" className={({ isActive }) => `app-bottom-nav-link${isActive ? " active" : ""}`}>
            <span className="app-bottom-nav-icon"><Icon name="heart" /></span>
            Par
          </NavLink>
        )}
        <button
          type="button"
          data-launch-toggle
          className={`app-bottom-nav-add${isOnNewTransaction || isLaunchOpen ? " active" : ""}`}
          aria-label="Lançar"
          aria-expanded={isLaunchOpen}
          onClick={() => setIsLaunchOpen((open) => !open)}
        >
          <Icon name="plus" />
        </button>
        <Link to="/contas" className={`app-bottom-nav-link${isOnBills ? " active" : ""}`}>
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
              {MORE_TILES.filter(showItem).map((tile) => (
                <Link
                  key={tile.to}
                  to={tile.to}
                  className={`more-sheet-tile${location.pathname === tile.to ? " active" : ""}`}
                >
                  <span className="more-sheet-tile-icon"><Icon name={tile.icon} /></span>
                  {tile.label}
                </Link>
              ))}
              {isSolo && (
                <Link to={INVITE_PATH} className="more-sheet-tile">
                  <span className="more-sheet-tile-icon"><Icon name="user" /></span>
                  Convidar par
                </Link>
              )}
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
        <button
          type="button"
          data-launch-toggle
          className={`global-fab${isLaunchOpen ? " is-open" : ""}`}
          aria-label="Lançar"
          aria-expanded={isLaunchOpen}
          onClick={() => setIsLaunchOpen((open) => !open)}
        >
          <span className="global-fab-plus" aria-hidden="true">
            +
          </span>
          <span className="global-fab-label">Lançar</span>
        </button>
      )}
      <LaunchMenu open={isLaunchOpen} onClose={() => setIsLaunchOpen(false)} />

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

