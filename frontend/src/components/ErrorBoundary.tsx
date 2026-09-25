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

// Pega erros de renderização e de import lazy abaixo dele -- sem isso, um
// erro vira uma tela branca. Quase todo erro aqui vem de uma aba rodando uma
// versão antiga depois de um deploy (ver utils/appRecovery.ts) ou de dados
// velhos no cache das páginas (pageCache.ts), e recarregar resolve os dois --
// então o app se recarrega sozinho atrás de uma tela "Atualizando o app..."
// em vez de perguntar. A tela de erro só aparece se a recuperação já falhou
// duas vezes seguidas.
class ErrorBoundaryInner extends Component<Props, State> {
  state: State = { hasError: false, isReloading: false, pathname: this.props.pathname };

  static getDerivedStateFromError(): Partial<State> {
    // Aqui só consulta (não pode ter efeito colateral); o recarregamento
    // começa no componentDidCatch.
    return { hasError: true, isReloading: canRecover() };
  }

  componentDidCatch() {
    clearCache();
    if (this.state.isReloading && !recoverApp()) this.setState({ isReloading: false });
  }

  // Mudar de página (menu, botão voltar) dá uma nova chance pra página nova.
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
