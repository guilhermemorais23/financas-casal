// ============================================================================
// QUEM ESTÁ LOGADO -- disponível pra qualquer tela com useAuth()
// ============================================================================
// Um "Context" do React guarda uma informação num lugar só e deixa qualquer
// componente por dentro do <AuthProvider> (ver App.tsx) ler, sem passar de
// mão em mão. Aqui ficam:
//   - user: o perfil (nome, e-mail, grupo...) que veio do backend (/api/me);
//   - token: o "crachá" do Firebase que vai em todo pedido ao backend;
//   - login, loginWithProvider (Google/Apple), register, logout...
//
// Como o login funciona, passo a passo:
//   1. a tela de login chama login(email, senha);
//   2. o Firebase confere a senha e devolve um token (firebase.ts);
//   3. com o token, o app chama GET /api/me/bootstrap e /api/me no backend,
//      que garante que o perfil existe e devolve os dados da pessoa;
//   4. user e token ficam aqui, e as telas leem com useAuth().
// O Firebase renova o token sozinho (~1 vez por hora); o ouvinte
// onIdTokenChanged abaixo pega o token novo.
// ============================================================================
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
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { getActiveGroupId, setActiveGroupId, subscribeActiveGroup } from "../api/activeGroup";
import { ApiError, apiRequest, setTokenRefresher, warmUpApi } from "../api/client";
import { firebaseAuth } from "../firebase";
import { clearCache } from "../utils/pageCache";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  // Grupo padrão (o último em que a pessoa entrou) e todos os grupos dela.
  groupId: string | null;
  // Perfis guardados no aparelho antes dos vários grupos não têm a lista.
  groupIds?: string[];
  photoDataUrl: string | null;
  phone: string | null;
  // Decidido pelo backend (ADMIN_EMAILS) -- define se o item Admin aparece no
  // menu. A rota confere de novo por conta própria, então isto nunca precisa
  // ser confiado como a barreira de segurança de verdade.
  isAdmin: boolean;
  // Chaves do app (Admin): a tela Plano só aparece com a cobrança ligada;
  // maintenance é a mensagem do modo manutenção (null = desligado).
  billingEnabled?: boolean;
  maintenance?: string | null;
  // Conta recém-criada que ainda não viu a apresentação de boas-vindas.
  welcomePending?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  // Resolve true quando entrou, false quando o popup não abriu e a página está
  // sendo levada ao provedor (ela volta já logada).
  loginWithProvider: (provider: SocialProvider) => Promise<boolean>;
  deleteAccount: () => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  revokeAllSessions: () => Promise<void>;
  // Grupo aberto no app (casal, família...). Trocar recarrega as telas com
  // os dados do outro grupo.
  activeGroupId: string | null;
  switchGroup: (groupId: string) => void;
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

// A Apple só manda o nome no primeiríssimo login (e nunca, se a pessoa
// esconder), então sempre tem um nome reserva -- o bootstrap exige um.
function displayNameFor(firebaseUser: User): string {
  return firebaseUser.displayName?.trim() || firebaseUser.email?.split("@")[0] || "Você";
}

// Popup não abre em todo lugar -- principalmente no app adicionado à tela
// inicial do iPhone. Nesses erros, cai pro redirecionamento de página
// inteira.
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

// O login() e o ouvinte onIdTokenChanged pedem o /me com o mesmíssimo token
// no mesmíssimo momento em todo login -- dividem o pedido em vez de fazer o
// backend (talvez recém-acordado) responder duas vezes.
const inflightProfiles = new Map<string, Promise<AuthUser>>();
function fetchProfileShared(idToken: string): Promise<AuthUser> {
  let request = inflightProfiles.get(idToken);
  if (!request) {
    request = fetchProfile(idToken).finally(() => inflightProfiles.delete(idToken));
    inflightProfiles.set(idToken, request);
  }
  return request;
}

// Último perfil conhecido de cada conta, pra abrir o app (ou entrar de novo
// no mesmo celular) mostrar o app na hora, em vez de um "Carregando..." que
// espera o backend -- que no plano grátis do Render pode levar mais de 30 s
// pra acordar. O /me de verdade roda logo depois e substitui.
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
    // ignora -- é só pra ficar mais rápido
  }
}

function clearCachedProfiles(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PROFILE_CACHE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // ignora
  }
}

// Melhor esforço, dispara e esquece -- só alimenta a tela Admin > Logs "quem
// está entrando", e nunca pode segurar nem fazer falhar um login de verdade.
// Chamado de propósito só no login/loginWithProvider/register, e não pelo
// ouvinte silencioso de renovação de token abaixo (que dispara mais ou menos
// a cada hora e não é um evento de "alguém entrou").
function logLoginEvent(idToken: string, event: "login" | "register"): void {
  apiRequest("/me/login-event", { method: "POST", token: idToken, body: { event } }).catch(() => {});
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    warmUpApi();

    // Dispara ao entrar, ao sair e na renovação automática do token -- o token
    // guardado no contexto fica sempre novo, sem cada tela precisar chamar
    // getIdToken().
    const unsubscribe = onIdTokenChanged(firebaseAuth, async (firebaseUser) => {
      if (!firebaseUser) {
        clearCachedProfiles();
        // Extrato, saldos e cia. guardados pra abrir rápido: não ficam no
        // aparelho depois de sair (ou de excluir a conta).
        clearCache();
        setActiveGroupId(null);
        setUser(null);
        setToken(null);
        setIsLoading(false);
        return;
      }

      const idToken = await firebaseUser.getIdToken();
      setToken(idToken);
      const cached = readCachedProfile(firebaseUser.uid);
      if (cached) {
        // Conta já conhecida neste aparelho: mostra o app agora e atualiza abaixo.
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
        // Sem internet / backend ainda acordando: mantém o perfil guardado, se
        // houver; sem ele não há o que mostrar, então o erro aparece como antes.
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

  // Dá ao api/client.ts um jeito de pedir um token novo (usado pra repetir um
  // pedido que voltou 401 porque o token guardado ficou velho -- ver
  // apiRequest). Registrado uma vez só; o setToken é uma referência estável do
  // setState, então isto nunca precisa rodar de novo.
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

  // A renovação automática do próprio Firebase roda num timer que o navegador
  // desacelera (ou pausa) enquanto a aba está escondida -- ao voltar pra uma
  // aba aberta há tempo, o token guardado pode já ter passado da validade de
  // ~1h. Força uma renovação assim que a aba volta ao foco, em vez de esperar
  // o primeiro pedido à API levar um 401 e tentar de novo.
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

  const activeGroupId = useSyncExternalStore(subscribeActiveGroup, getActiveGroupId);

  // O grupo guardado no aparelho precisa ser um dos grupos da pessoa (outra
  // conta no mesmo celular, ou saiu do grupo em outro aparelho); se não for,
  // abre o grupo padrão.
  useEffect(() => {
    if (!user) return;
    const groupIds = user.groupIds ?? (user.groupId ? [user.groupId] : []);
    const current = getActiveGroupId();
    if (!current || !groupIds.includes(current)) setActiveGroupId(user.groupId);
  }, [user, activeGroupId]);

  // O backend recusou o grupo aberto (ver api/client.ts): relê o perfil pra
  // lista de grupos ficar certa.
  useEffect(() => {
    function onGroupLost() {
      refreshUser().catch(() => {});
    }
    window.addEventListener("par:group-lost", onGroupLost);
    return () => window.removeEventListener("par:group-lost", onGroupLost);
  }, [refreshUser]);

  const switchGroup = useCallback((groupId: string) => setActiveGroupId(groupId), []);

  // login/loginWithProvider/register preenchem user e token eles mesmos, dentro
  // da própria promise, em vez de depender só do onIdTokenChanged (um ouvinte
  // separado, que dispara por conta própria). Sem isto, quem espera o
  // register() e já navega pode cair numa rota protegida por `user` antes de o
  // ouvinte preencher -- e o ProtectedRoute, sem usuário, joga de volta pro
  // /login.
  const login = useCallback(async (email: string, password: string) => {
    const credential = await signInWithEmailAndPassword(firebaseAuth, email, password);
    const idToken = await credential.user.getIdToken();
    // Já entrou neste celular antes: vai direto com o perfil guardado (o ouvinte
    // acima busca o atualizado em segundo plano).
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

  // Invalida todo refresh token que o Firebase emitiu pra esta conta (backend:
  // auth.revokeRefreshTokens) -- todo outro aparelho logado perde a sessão na
  // próxima conferência. Também desloga este aparelho na hora, em vez de
  // esperar o próprio token ser recusado no próximo pedido.
  const revokeAllSessions = useCallback(async () => {
    if (!token) return;
    await apiRequest("/me/revoke-sessions", { method: "POST", token });
    await signOut(firebaseAuth);
  }, [token]);

  // "Excluir conta": o backend apaga os dados e o próprio login do Firebase;
  // sair aqui só descarta a sessão, que já morreu.
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
      activeGroupId,
      switchGroup,
    }),
    [user, token, isLoading, login, loginWithProvider, register, logout, refreshUser, resetPassword, revokeAllSessions, deleteAccount, activeGroupId, switchGroup]
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
