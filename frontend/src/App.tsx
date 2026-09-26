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

// Wraps the `lazy(() => import(...).then((m) => ({ default: m.X })))`
// boilerplate a named export needs (React.lazy only accepts a default
// export) -- each call site below still has its own literal `import("./
// pages/X")`, which is what lets Vite give every page its own chunk; this
// just removes the repeated `.then((m) => ({ default: m.Name }))` typo risk.
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

// Lazy-loaded: everything past the login screen used to ship in the same
// single ~460KB bundle regardless of which page someone actually opens, so
// every visit paid to download/parse/execute all 13+ pages up front (Admin,
// Investments, Relatórios's chart code, etc. included) even for someone who
// only ever uses the Painel. Splitting per route means a page only costs
// what it weighs the first time it's actually visited; React Router caches
// the chunk after that, same as any other lazy import. LoginPage stays
// eager -- it's the one screen nearly everyone hits on the coldest possible
// load, so there's nothing to gain deferring it.
const SharedReportPage = lazy(() => importWithRecovery(() => import("./pages/SharedReportPage")));
const RegisterPage = namedLazy(() => import("./pages/RegisterPage"), "RegisterPage");
const PrivacyPage = namedLazy(() => import("./pages/PrivacyPage"), "PrivacyPage");
const TermsPage = namedLazy(() => import("./pages/TermsPage"), "TermsPage");
const PlanPage = namedLazy(() => import("./pages/PlanPage"), "PlanPage");
const GroupSetupPage = namedLazy(() => import("./pages/GroupSetupPage"), "GroupSetupPage");
const DashboardPage = namedLazy(() => import("./pages/DashboardPage"), "DashboardPage");
const ParPage = namedLazy(() => import("./pages/ParPage"), "ParPage");
const NewTransactionPage = namedLazy(() => import("./pages/NewTransactionPage"), "NewTransactionPage");
const DebtsPage = namedLazy(() => import("./pages/DebtsPage"), "DebtsPage");
const RecurringBillsPage = namedLazy(() => import("./pages/RecurringBillsPage"), "RecurringBillsPage");
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
            <Route
              path="/debts"
              element={
                <ProtectedRoute requireGroup>
                  <DebtsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/recurring-bills"
              element={
                <ProtectedRoute requireGroup>
                  <RecurringBillsPage />
                </ProtectedRoute>
              }
            />
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
