// ============================================================================
// APP: AS ROTAS E AS "CAMADAS" QUE ENVOLVEM TODAS AS TELAS
// ============================================================================
// Este arquivo responde "qual tela abre em cada endereço". Cada
// <Route path="/a-pagar" element={...} /> lá embaixo liga um endereço a uma
// página de pages/. Quer saber qual arquivo desenha uma tela? Procure o
// endereço aqui.
//
// As camadas em volta das rotas (de fora pra dentro, no return do App):
//   ToastProvider   -> os avisos que aparecem no topo ("Conta salva")
//   ConfirmProvider -> a janela "Tem certeza?" (useConfirm)
//   AuthProvider    -> quem está logado e o token (auth/AuthContext.tsx)
//   ErrorBoundary   -> se uma tela quebrar, mostra "Algo deu errado" em vez
//                      de deixar a página em branco
//   Suspense        -> o esqueleto (PageSkeleton) enquanto o código de uma
//                      página ainda está baixando
//   GroupScoped     -> trocar de grupo recarrega todas as telas
//
// Uma camada ("Provider") por fora deixa qualquer tela por dentro usar o que
// ela oferece (ex.: useAuth(), useToast()) sem passar de mão em mão.
//
// <ProtectedRoute> em volta de uma página = só entra quem está logado (senão
// vai pro /login). Com requireGroup, também precisa ter grupo (senão vai pro
// /group-setup). Ver routes/ProtectedRoute.tsx.
// ============================================================================
import { Fragment, lazy, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageSkeleton } from "./components/Skeleton";
import { ConfirmProvider } from "./components/ConfirmDialog";
import { ToastProvider } from "./components/ToastProvider";
import { AnnouncementPopup } from "./components/AnnouncementPopup";
import { PremiumPrompt } from "./components/PremiumPrompt";
import { WelcomeTour } from "./components/WelcomeTour";
import { importWithRecovery } from "./utils/appRecovery";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";

// Embrulha o `lazy(() => import(...).then((m) => ({ default: m.X })))` que
// um export com nome exige (o React.lazy só aceita export default) -- cada
// uso abaixo continua com o seu próprio `import("./pages/X")` escrito por
// extenso, que é o que deixa o Vite dar um pedaço (chunk) próprio pra cada
// página; isto só tira o risco de errar o `.then((m) => ({ default: m.Name }))`
// repetido.
// importWithRecovery: um chunk que sumiu depois de um deploy recarrega na
// versão nova (o skeleton continua na tela) em vez de cair na tela de erro.
// Cada página também entra em PAGE_LOADERS, pra ser baixada em segundo plano
// logo depois que o app abre (preloadPages): trocar de tela não espera mais
// a rede, que era o que dava a "travada" com o skeleton piscando.
const PAGE_LOADERS: Array<() => Promise<unknown>> = [];

function namedLazy<K extends string>(loader: () => Promise<Record<K, ComponentType<object>>>, name: K) {
  PAGE_LOADERS.push(loader);
  return lazy(async () => ({ default: (await importWithRecovery(loader))[name] }));
}

let pagesPreloaded = false;
function preloadPages() {
  if (pagesPreloaded) return;
  pagesPreloaded = true;
  const run = () => {
    // Uma de cada vez, pra não disputar a rede com os dados da tela aberta.
    // Se uma falhar (sem internet), tudo bem: ela baixa quando for aberta.
    PAGE_LOADERS.reduce<Promise<unknown>>((chain, load) => chain.then(() => load().catch(() => undefined)), Promise.resolve());
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 2000);
}

// Carregadas sob demanda (lazy): tudo depois da tela de login ia no mesmo
// pacote de ~460KB, qualquer que fosse a página aberta, então toda visita
// pagava pra baixar, ler e rodar as 13+ páginas logo de cara (Admin,
// Investimentos, os gráficos de Relatórios etc.), mesmo pra quem só usa o
// Painel. Separar por rota faz cada página custar o que pesa só na primeira
// vez que é aberta; o React Router guarda o pedaço depois disso, como
// qualquer import lazy. A LoginPage continua carregada de cara -- é a tela
// que quase todo mundo abre no carregamento mais frio, então não há o que
// ganhar adiando.
const SharedReportPage = lazy(() => importWithRecovery(() => import("./pages/SharedReportPage")));
const RegisterPage = namedLazy(() => import("./pages/RegisterPage"), "RegisterPage");
const PrivacyPage = namedLazy(() => import("./pages/PrivacyPage"), "PrivacyPage");
const TermsPage = namedLazy(() => import("./pages/TermsPage"), "TermsPage");
const PlanPage = namedLazy(() => import("./pages/PlanPage"), "PlanPage");
const GroupSetupPage = namedLazy(() => import("./pages/GroupSetupPage"), "GroupSetupPage");
const DashboardPage = namedLazy(() => import("./pages/DashboardPage"), "DashboardPage");
const ParPage = namedLazy(() => import("./pages/ParPage"), "ParPage");
const NewTransactionPage = namedLazy(() => import("./pages/NewTransactionPage"), "NewTransactionPage");
const PayablesPage = namedLazy(() => import("./pages/PayablesPage"), "PayablesPage");
const BillsPage = namedLazy(() => import("./pages/BillsPage"), "BillsPage");
const CardsPage = namedLazy(() => import("./pages/CardsPage"), "CardsPage");
const GoalsPage = namedLazy(() => import("./pages/GoalsPage"), "GoalsPage");
const ReportsPage = namedLazy(() => import("./pages/ReportsPage"), "ReportsPage");
const AccountPage = namedLazy(() => import("./pages/AccountPage"), "AccountPage");
const AdminPage = namedLazy(() => import("./pages/AdminPage"), "AdminPage");
const InvestmentsPage = namedLazy(() => import("./pages/InvestmentsPage"), "InvestmentsPage");
const ShoppingListPage = namedLazy(() => import("./pages/ShoppingListPage"), "ShoppingListPage");
const LoansPage = namedLazy(() => import("./pages/LoansPage"), "LoansPage");

// Trocar de grupo remonta todas as telas: cada uma busca de novo os dados
// do grupo aberto e nada do grupo anterior fica na tela.
function GroupScoped({ children }: { children: ReactNode }) {
  const { activeGroupId } = useAuth();
  return <Fragment key={activeGroupId ?? "none"}>{children}</Fragment>;
}

function App() {
  useEffect(preloadPages, []);
  return (
    <ToastProvider>
      <ConfirmProvider>
      <AuthProvider>
        <ErrorBoundary>
        <Suspense fallback={<PageSkeleton />}>
          <GroupScoped>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/r/:token" element={<SharedReportPage />} />
            <Route path="/privacidade" element={<PrivacyPage />} />
            <Route path="/termos" element={<TermsPage />} />
            <Route
              path="/group-setup"
              element={
                <ProtectedRoute>
                  <GroupSetupPage />
                </ProtectedRoute>
              }
            />
            <Route path="/invite/:token" element={<AcceptInvitePage />} />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute requireGroup>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/par"
              element={
                <ProtectedRoute requireGroup>
                  <ParPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/transactions/new"
              element={
                <ProtectedRoute requireGroup>
                  <NewTransactionPage />
                </ProtectedRoute>
              }
            />
            {/* Dívidas e Contas fixas agora ficam juntas em "A pagar"; os
                endereços antigos continuam valendo. */}
            <Route
              path="/contas"
              element={
                <ProtectedRoute requireGroup>
                  <BillsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/a-pagar"
              element={
                <ProtectedRoute requireGroup>
                  <PayablesPage />
                </ProtectedRoute>
              }
            />
            <Route path="/debts" element={<Navigate to="/a-pagar?aba=dividas" replace />} />
            <Route path="/recurring-bills" element={<Navigate to="/a-pagar?aba=fixas" replace />} />
            <Route
              path="/cards"
              element={
                <ProtectedRoute requireGroup>
                  <CardsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/goals"
              element={
                <ProtectedRoute requireGroup>
                  <GoalsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute requireGroup>
                  <ReportsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/account"
              element={
                <ProtectedRoute requireGroup>
                  <AccountPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/plano"
              element={
                <ProtectedRoute requireGroup>
                  <PlanPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireGroup>
                  <AdminPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/investments"
              element={
                <ProtectedRoute requireGroup>
                  <InvestmentsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/loans"
              element={
                <ProtectedRoute requireGroup>
                  <LoansPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/shopping"
              element={
                <ProtectedRoute requireGroup>
                  <ShoppingListPage />
                </ProtectedRoute>
              }
            />
          </Routes>
          </GroupScoped>
        </Suspense>
        <WelcomeTour />
        <AnnouncementPopup />
        <PremiumPrompt />
        </ErrorBoundary>
      </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default App;
