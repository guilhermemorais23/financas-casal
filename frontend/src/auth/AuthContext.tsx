import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest } from "../api/client";
import { firebaseAuth } from "../firebase";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  groupId: string | null;
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
  }, []);

  const loginWithGoogle = useCallback(async () => {
    const credential = await signInWithPopup(firebaseAuth, new GoogleAuthProvider());
    const idToken = await credential.user.getIdToken();
    const profile = await bootstrapProfile(idToken, credential.user.displayName ?? credential.user.email ?? "");
    setToken(idToken);
    setUser(profile);
  }, []);

  const register = useCallback(async (email: string, password: string, displayName: string) => {
    const credential = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    await updateProfile(credential.user, { displayName });
    const idToken = await credential.user.getIdToken();
    const profile = await bootstrapProfile(idToken, displayName);
    setToken(idToken);
    setUser(profile);
  }, []);

  const logout = useCallback(async () => {
    await signOut(firebaseAuth);
  }, []);

  const value = useMemo(
    () => ({ user, token, isLoading, login, loginWithGoogle, register, logout, refreshUser }),
    [user, token, isLoading, login, loginWithGoogle, register, logout, refreshUser]
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
