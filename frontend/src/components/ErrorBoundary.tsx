import { Component, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { clearCache } from "../utils/pageCache";
import { canRecover, forceFreshReload, recoverApp } from "../utils/appRecovery";
import { BrandMark } from "./Brand";
import { LoadingScreen } from "./Spinner";

interface Props {
  children: ReactNode;
  pathname: string;
}

interface State {
  hasError: boolean;
  isReloading: boolean;
  pathname: string;
}

// Catches render/lazy-import errors below it -- without this a crash is a
// blank white screen. Almost every crash here comes from a tab running an
// old build across a deploy (see utils/appRecovery.ts) or stale cached page
// data (pageCache.ts), and a fresh reload fixes both -- so the app reloads
// itself behind a "Atualizando o app..." screen instead of asking. The
// fallback screen only shows if recovering already failed twice in a row.
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false, isReloading: false, pathname: this.props.pathname };

  static getDerivedStateFromError(): Partial<State> {
    // Read-only check here (must stay side-effect free); the reload itself
    // starts in componentDidCatch.
    return { hasError: true, isReloading: canRecover() };
  }

  componentDidCatch() {
    clearCache();
    if (this.state.isReloading && !recoverApp()) this.setState({ isReloading: false });
  }

  // Navigating away (menu, back button) gives the new page a fresh try.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.pathname === state.pathname) return null;
    return { pathname: props.pathname, hasError: state.hasError && state.isReloading };
  }

  handleReload = () => {
    this.setState({ isReloading: true });
    forceFreshReload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.state.isReloading) return <LoadingScreen label="Atualizando o app..." />;
    return (
      <div className="error-boundary-fallback" role="alert">
        <BrandMark size={44} />
        <p className="error-boundary-title">Vamos atualizar o app</p>
        <p className="error-boundary-text">Tem uma versão nova do PAR. Toque abaixo pra carregar.</p>
        <div className="onboarding-actions">
          <button type="button" className="btn btn-primary" onClick={this.handleReload}>
            Atualizar agora
          </button>
          <button type="button" className="btn btn-outline" onClick={() => window.location.assign("/dashboard")}>
            Ir pro painel
          </button>
        </div>
      </div>
    );
  }
}

export function ErrorBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <ErrorBoundaryInner pathname={pathname}>{children}</ErrorBoundaryInner>;
}
