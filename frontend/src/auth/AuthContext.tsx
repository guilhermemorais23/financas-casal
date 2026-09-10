import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest, setTokenRefresher } from "../api/client";
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
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  revokeAllSessions: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function bootstrapProfile(idToken: string, displayName: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("/me/bootstrap", {
    method: "POST",
    token: idToken,
    body: { displayName },
  });
}

async function fetchProfile(idToken: string): Promise<AuthUser> {
  return apiRequest<AuthUser>("/me", { token: idToken });
}

// Best-effort, fire-and-forget -- purely feeds the Admin > Logs "who's
// coming in" view, must never hold up or fail an actual sign-in. Called
// explicitly from login/loginWithGoogle/register only, not from the silent
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
    // Fires on sign-in, sign-out, and automatic ID-token refresh -- token in
    // context stays fresh without every page having to call getIdToken().
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }

      const idToken = await firebaseUser.getIdToken();
      setToken(idToken);
      try {
        const profile = await fetchProfile(idToken);
        setUser(profile);
      } catch {
        // No Firestore profile doc yet (first sign-in) -- bootstrap creates it.
        const profile = await bootstrapProfile(idToken, firebaseUser.displayName ?? "");
        setUser(profile);
      } finally {
        setIsLoading(false);
      }
    });
    return unsubscribe;
  }, []);

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

  // login/loginWithGoogle/register set user+token themselves, synchronously
  // within their own promise, rather than relying solely on onIdTokenChanged
  // (a separate, independently-fired listener). Without this, a caller that
  // awaits register() and immediately navigates can land on a route guarded
  // by `user` before the listener has gotten around to populating it --
  // ProtectedRoute then sees no user and bounces back to /login.
  const login = useCallback(async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const idToken = await credential.user.getIdToken();
    const profile = await fetchProfile(idToken);
    setToken(idToken);
    setUser(profile);
    logLoginEvent(idToken, "login");
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    const idToken = await credential.user.getIdToken();
    const profile = await bootstrapProfile(idToken, credential.user.displayName ?? credential.user.email ?? "");
    setToken(idToken);
    setUser(profile);
    logLoginEvent(idToken, "login");
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

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      login,
      loginWithGoogle,
      register,
      logout,
      refreshUser,
      resetPassword,
      revokeAllSessions,
    }),
    [user, token, isLoading, login, loginWithGoogle, register, logout, refreshUser, resetPassword, revokeAllSessions]
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
