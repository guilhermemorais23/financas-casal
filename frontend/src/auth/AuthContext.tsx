import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "../api/client";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  coupleId: string | null;
}

interface AuthResponse {
  user: AuthUser;
  token: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const TOKEN_STORAGE_KEY = "fincae_token";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function rehydrate() {
      if (!token) {
        setIsLoading(false);
        return;
      }
      try {
        const me = await apiRequest<AuthUser>("/me", { token });
        setUser(me);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setToken(null);
        }
      } finally {
        setIsLoading(false);
      }
    }
    rehydrate();
  }, [token]);

  async function refreshUser() {
    if (!token) return;
    const me = await apiRequest<AuthUser>("/me", { token });
    setUser(me);
  }

  function applyAuthResponse(response: AuthResponse) {
    localStorage.setItem(TOKEN_STORAGE_KEY, response.token);
    setToken(response.token);
    setUser(response.user);
  }

  async function login(email: string, password: string) {
    const response = await apiRequest<AuthResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    applyAuthResponse(response);
  }

  async function register(email: string, password: string, displayName: string) {
    const response = await apiRequest<AuthResponse>("/auth/register", {
      method: "POST",
      body: { email, password, displayName },
    });
    applyAuthResponse(response);
  }

  function logout() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
