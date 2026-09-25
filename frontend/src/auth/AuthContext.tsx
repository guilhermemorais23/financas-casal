import {
  GoogleAuthProvider,
  OAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, apiRequest, setTokenRefresher, warmUpApi } from "../api/client";
import { firebaseAuth } from "../firebase";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  groupId: string | null;
  photoDataUrl: string | null;
  phone: string | null;
  // Backend-decided (ADMIN_EMAILS) -- drives whether the Admin nav item
  // shows up at all. The route itself re-checks independently, so this
  // never needs to be trusted as the actual security boundary.
  isAdmin: boolean;
  // Chaves do app (Admin): a tela Plano só aparece com a cobrança ligada;
  // maintenance é a mensagem do modo manutenção (null = desligado).
  billingEnabled?: boolean;
  maintenance?: string | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Resolves true once signed in, false when the popup couldn't open and the
  // page is being redirected to the provider instead (it comes back signed in).
  loginWithProvider: (provider: SocialProvider) => Promise<boolean>;
  deleteAccount: () => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  revokeAllSessions: () => Promise<void>;
}

export type SocialProvider = "google" | "apple";

const AuthContext = createContext<AuthContextValue | null>(null);

function providerFor(kind: SocialProvider) {
  if (kind === "apple") {
    const apple = new OAuthProvider("apple.com");
    apple.addScope("email");
    apple.addScope("name");
    apple.setCustomParameters({ locale: "pt_BR" });
    return apple;
  }
  return new GoogleAuthProvider();
}

// Apple only sends the name on the very first sign-in (and never if the
// person hides it), so there's always a fallback -- bootstrap requires one.
function displayNameFor(firebaseUser: User): string {
  return firebaseUser.displayName?.trim() || firebaseUser.email?.split("@")[0] || "Você";
}

// Popups don't open everywhere -- notably the app added to an iPhone's home
// screen. Those errors fall back to a full-page redirect.
const POPUP_UNAVAILABLE = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

// Cria o documento de perfil no primeiro login (nos outros não faz nada). A
// apresentação aparece pra toda conta que ainda não viu a edição atual (ver
// utils/welcomeTour.ts), nova ou não.
async function bootstrapProfile(idToken: string, displayName: string): Promise<AuthUser> {
  const { isNew: _isNew, ...profile } = await apiRequest<AuthUser & { isNew?: boolean }>("/me/bootstrap", {
    method: "POST",
    token: idToken,
    body: { displayName },
  });
  return profile;
}

async function fetchProfile(idToken: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("/me", { token: idToken });
}

// login() and the onIdTokenChanged listener both ask for /me with the very
// same token at the very same moment on every sign-in -- share the one
// request instead of making a (possibly just-woken) backend answer twice.
const inflightProfiles = new Map<string, Promise<AuthUser>>();
function fetchProfileShared(idToken: string): Promise<AuthUser> {
  let request = inflightProfiles.get(idToken);
  if (!request) {
    request = fetchProfile(idToken).finally(() => inflightProfiles.delete(idToken));
    inflightProfiles.set(idToken, request);
  }
  return request;
}

// Last known profile per account, so opening the app (or signing back in on
// the same phone) shows the app right away instead of a "Carregando..."
// that waits on the backend -- which on Render's free plan can take 30s+
// to wake up. The real /me still runs right after and replaces it.
const PROFILE_CACHE_PREFIX = "par:profile:";

function readCachedProfile(userId: string): AuthUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_PREFIX + userId);
    const profile = raw ? (JSON.parse(raw) as AuthUser) : null;
    return profile?.id === userId ? profile : null;
  } catch {
    return null;
  }
}

function writeCachedProfile(profile: AuthUser): void {
  try {
    localStorage.setItem(PROFILE_CACHE_PREFIX + profile.id, JSON.stringify(profile));
  } catch {
    // ignore -- it's only a speed-up
  }
}

function clearCachedProfiles(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PROFILE_CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

// Best-effort, fire-and-forget -- purely feeds the Admin > Logs "who's
// coming in" view, must never hold up or fail an actual sign-in. Called
// explicitly from login/loginWithProvider/register only, not from the silent
// token-refresh listener below (that fires roughly hourly and isn't a
// "someone logged in" event).
function logLoginEvent(idToken: string, event: "login" | "register"): void {
  apiRequest("/me/login-event", { method: "POST", token: idToken, body: { event } }).catch(() => {});
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    warmUpApi();

    // Fires on sign-in, sign-out, and automatic ID-token refresh -- token in
    // context stays fresh without every page having to call getIdToken().
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        clearCachedProfiles();
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }

      const idToken = await firebaseUser.getIdToken();
      setToken(idToken);
      const cached = readCachedProfile(firebaseUser.uid);
      if (cached) {
        // Known account on this device: show the app now, refresh below.
        setUser((current) => current ?? cached);
        setIsLoading(false);
      }
      try {
        let profile: AuthUser;
        try {
          profile = await fetchProfileShared(idToken);
        } catch (err) {
          // Só cria o perfil quando ele não existe mesmo (404, primeiro
          // login). Servidor fora ou cota do banco estourada não é motivo
          // pra tentar gravar de novo -- só piora.
          if (!(err instanceof ApiError && err.status === 404)) throw err;
          profile = await bootstrapProfile(idToken, displayNameFor(firebaseUser));
        }
        setUser(profile);
      } catch (err) {
        // Offline / backend still waking: keep the cached profile if there
        // is one; without it there's nothing to show, so it surfaces as before.
        if (!cached) throw err;
      } finally {
        setIsLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (user) writeCachedProfile(user);
  }, [user]);

  // Gives api/client.ts a way to force a fresh ID token (used to retry a
  // request that came back 401 because the cached token had gone stale --
  // see apiRequest). Registered once; setToken is a stable setState
  // reference, so this never needs to re-run.
  useEffect(() => {
    setTokenRefresher(async () => {
      const current = firebaseAuth.currentUser;
      if (!current) return null;
      const fresh = await current.getIdToken(true);
      setToken(fresh);
      return fresh;
    });
    return () => setTokenRefresher(null);
  }, []);

  // Firebase's own background refresh runs on a timer that browsers throttle
  // (or pause outright) while the tab is hidden -- come back to a tab left
  // open for a while and the cached token can already be past its ~1h
  // expiry. Force a refresh right when the tab regains focus, instead of
  // waiting for the first API call to hit a 401 and retry reactively.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") {
        firebaseAuth.currentUser?.getIdToken(true).then(setToken).catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    const profile = await fetchProfile(token);
    setUser(profile);
  }, [token]);

  // login/loginWithProvider/register set user+token themselves, synchronously
  // within their own promise, rather than relying solely on onIdTokenChanged
  // (a separate, independently-fired listener). Without this, a caller that
  // awaits register() and immediately navigates can land on a route guarded
  // by `user` before the listener has gotten around to populating it --
  // ProtectedRoute then sees no user and bounces back to /login.
  const login = useCallback(async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const idToken = await credential.user.getIdToken();
    // Signed in on this phone before: go straight in with the saved profile
    // (the listener above fetches the fresh one in the background).
    const profile = readCachedProfile(credential.user.uid) ?? (await fetchProfileShared(idToken));
    setToken(idToken);
    setUser(profile);
    logLoginEvent(idToken, "login");
  }, []);

  const loginWithProvider = useCallback(async (kind: SocialProvider) => {
    const provider = providerFor(kind);
    let credential;
    try {
      credential = await signInWithPopup(firebaseAuth, provider);
    } catch (err) {
      if (err instanceof FirebaseError && POPUP_UNAVAILABLE.has(err.code)) {
        await signInWithRedirect(firebaseAuth, provider);
        return false;
      }
      throw err;
    }
    const idToken = await credential.user.getIdToken();
    const profile =
      readCachedProfile(credential.user.uid) ?? (await bootstrapProfile(idToken, displayNameFor(credential.user)));
    setToken(idToken);
    setUser(profile);
    logLoginEvent(idToken, "login");
    return true;
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    await updateProfile(credential.user, { displayName });
    const idToken = await credential.user.getIdToken();
    const profile = await bootstrapProfile(idToken, displayName);
    setToken(idToken);
    setUser(profile);
    logLoginEvent(idToken, "register");
  }, []);

  const logout = useCallback(async () => {
    await signOut(firebaseAuth);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(firebaseAuth, email);
  }, []);

  // Invalidates every refresh token Firebase has issued for this account
  // (backend: auth.revokeRefreshTokens) -- every other signed-in device
  // loses its session the next time it's checked. Signs this device out
  // locally too, right away, instead of waiting for its own token to be
  // rejected on the next request.
  const revokeAllSessions = useCallback(async () => {
    if (!token) return;
    await apiRequest("/me/revoke-sessions", { method: "POST", token });
    await signOut(firebaseAuth);
  }, [token]);

  // "Excluir conta": the backend erases the data and the Firebase login
  // itself; signing out locally just drops the now-dead session.
  const deleteAccount = useCallback(async () => {
    if (!token) return;
    await apiRequest("/me", { method: "DELETE", token });
    await signOut(firebaseAuth);
  }, [token]);

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      login,
      loginWithProvider,
      register,
      logout,
      refreshUser,
      resetPassword,
      revokeAllSessions,
      deleteAccount,
    }),
    [user, token, isLoading, login, loginWithProvider, register, logout, refreshUser, resetPassword, revokeAllSessions, deleteAccount]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
