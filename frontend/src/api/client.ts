const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Set once by AuthContext on mount -- gives this module a way to force a
// fresh Firebase ID token without importing AuthContext itself (would be a
// dependency cycle: AuthContext is the thing that calls apiRequest).
let refreshToken: (() => Promise<string | null>) | null = null;
export function setTokenRefresher(fn: (() => Promise<string | null>) | null): void {
  refreshToken = fn;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {}
): Promise<T> {
  const doFetch = async (token?: string | null) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(`${API_URL}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  };

  let response = await doFetch(options.token);

  // A 401 on a request that DID carry a token usually means the ID token
  // was stale, not that the user is actually signed out -- most often
  // because the background tab was suspended long enough that Firebase's
  // own auto-refresh timer never got to run. Force one fresh token and
  // retry exactly once before surfacing anything to the caller.
  if (response.status === 401 && options.token && refreshToken) {
    const freshToken = await refreshToken().catch(() => null);
    if (freshToken && freshToken !== options.token) {
      response = await doFetch(freshToken);
    }
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Recurso do Premium: avisa o app (components/PremiumPrompt abre a janela
    // "Isso é do Premium") além de devolver o erro pra tela que chamou.
    if (response.status === 402 && data?.code === "premium_required") {
      window.dispatchEvent(new CustomEvent("par:premium-required"));
    }
    throw new ApiError(data?.error ?? "Request failed", response.status);
  }

  return data as T;
}

// For file downloads (CSV export, etc.) -- apiRequest always parses the
// response as JSON, which a file response isn't. Fetches with the same auth
// header, then hands the browser a real file via a throwaway <a download>.
export async function apiDownload(path: string, token: string | null, filename: string): Promise<void> {
  const fetchWith = (t: string | null) =>
    fetch(`${API_URL}${path}`, { headers: t ? { Authorization: `Bearer ${t}` } : {} });

  let response = await fetchWith(token);
  if (response.status === 401 && token && refreshToken) {
    const freshToken = await refreshToken().catch(() => null);
    if (freshToken && freshToken !== token) {
      response = await fetchWith(freshToken);
    }
  }

  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 402 && data?.code === "premium_required") {
      window.dispatchEvent(new CustomEvent("par:premium-required"));
    }
    throw new ApiError(data?.error ?? "Request failed", response.status);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// The backend runs on Render's free plan, which puts it to sleep after a
// while idle -- the first request after that can take 30s+ while it boots.
// Firing a throwaway /health ping as soon as the app opens lets that boot
// overlap with the person typing their email/password (or Firebase
// restoring their session), instead of it all landing on the "Entrar" tap.
let warmUpStarted = false;
export function warmUpApi(): void {
  if (warmUpStarted || !API_URL) return;
  warmUpStarted = true;
  fetch(`${API_URL}/health`, { cache: "no-store" }).catch(() => {});
}
