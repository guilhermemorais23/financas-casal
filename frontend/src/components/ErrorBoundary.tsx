import { Component, type ReactNode } from "react";
import { clearCache } from "../utils/pageCache";
import { LoadingScreen } from "./Spinner";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  isReloading: boolean;
}

const AUTO_RELOAD_KEY = "par:auto-reload-at";

// The messages browsers use when a lazy route chunk can't be fetched
// (Chrome/Edge, Safari, Firefox) -- almost always "a new version was
// deployed and this tab still points at the old file names".
function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(message);
}

// Only auto-reload once per 20s: if the reload didn't fix it, stop and show
// the screen instead of looping forever. (Read-only here -- it's called from
// getDerivedStateFromError, which must stay side-effect free.)
function canAutoReload(): boolean {
  try {
    return Date.now() - Number(sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0) >= 20_000;
  } catch {
    return false;
  }
}

function rememberAutoReload(): void {
  try {
    sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
  } catch {
    // ignore
  }
}

// On phones the old service worker can keep serving the previous build for
// a reload or two, which is what made "Recarregar" feel slow/useless. Ask it
// to check for the new version first (capped at 1.5s so a bad connection
// never blocks the reload), then reload.
async function reloadFresh(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await Promise.race([registration.update(), new Promise((resolve) => setTimeout(resolve, 1500))]);
    }
  } catch {
    // ignore -- reload anyway
  }
  window.location.reload();
}

// Catches render/lazy-import errors below it -- without this, a failed
// dynamic import() (React.lazy in App.tsx) throws with nothing to catch it,
// crashing to a blank white screen. That failure got more likely once this
// app started code-splitting per route AND running a service worker that
// updates itself automatically: someone with a tab open across a deploy, or
// a stale service-worker cache, can click into a route whose chunk file no
// longer exists at its old hashed URL. That case reloads on its own; any
// other crash gets a "Recarregar" button that reacts right away.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, isReloading: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, isReloading: isChunkLoadError(error) && canAutoReload() };
  }

  // A render crash is very often bad cached data (see pageCache.ts) -- drop
  // it so "Recarregar" actually recovers instead of crashing again on the
  // same stale entry.
  componentDidCatch() {
    clearCache();
    if (this.state.isReloading) {
      rememberAutoReload();
      void reloadFresh();
    }
  }

  handleReload = () => {
    this.setState({ isReloading: true });
    void reloadFresh();
  };

  render() {
    if (this.state.hasError) {
      if (this.state.isReloading) {
        return <LoadingScreen label="Atualizando o app..." />;
      }
      return (
        <div className="error-boundary-fallback">
          <p className="card-title">Algo deu errado ao carregar essa página</p>
          <p className="card-subtitle">Pode ser uma versão nova do app -- recarregar já resolve.</p>
          <div className="onboarding-actions">
            <button type="button" className="btn btn-primary" onClick={this.handleReload}>
              Recarregar
            </button>
            <button type="button" className="btn btn-outline" onClick={() => window.location.assign("/dashboard")}>
              Ir pro painel
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

