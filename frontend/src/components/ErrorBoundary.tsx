import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// Catches render/lazy-import errors below it -- without this, a failed
// dynamic import() (React.lazy in App.tsx) throws with nothing to catch it,
// crashing to a blank white screen. That failure got more likely once this
// app started code-splitting per route AND running a service worker that
// updates itself automatically: someone with a tab open across a deploy, or
// a stale service-worker cache, can click into a route whose chunk file no
// longer exists at its old hashed URL. A simple "algo deu errado, recarregar"
// with a real reload button recovers instead of leaving a blank page.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback">
          <p className="card-title">Algo deu errado ao carregar essa página</p>
          <p className="card-subtitle">Pode ser uma versão nova do app -- recarregar já resolve.</p>
          <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
