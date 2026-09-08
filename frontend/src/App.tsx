import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PageSkeleton } from "./components/Skeleton";
import { ToastProvider } from "./components/ToastProvider";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";

// Wraps the `lazy(() => import(...).then((m) => ({ default: m.X })))`
// boilerplate a named export needs (React.lazy only accepts a default
// export) -- each call site below still has its own literal `import("./
// pages/X")`, which is what lets Vite give every page its own chunk; this
// just removes the repeated `.then((m) => ({ default: m.Name }))` typo risk.
function namedLazy<K extends string>(loader: () => Promise<Record<K, ComponentType<object>>>, name: K) {
  return lazy(async () => ({ default: (await loader())[name] }));
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
const RegisterPage = namedLazy(() => import("./pages/RegisterPage"), "RegisterPage");
const GroupSetupPage = namedLazy(() => import("./pages/GroupSetupPage"), "GroupSetupPage");
const DashboardPage = namedLazy(() => import("./pages/DashboardPage"), "DashboardPage");
const ParPage = namedLazy(() => import("./pages/ParPage"), "ParPage");
const NewTransactionPage = namedLazy(() => import("./pages/NewTransactionPage"), "NewTransactionPage");
const DebtsPage = namedLazy(() => import("./pages/DebtsPage"), "DebtsPage");
const CardsPage = namedLazy(() => import("./pages/CardsPage"), "CardsPage");
const GoalsPage = namedLazy(() => import("./pages/GoalsPage"), "GoalsPage");
const ReportsPage = namedLazy(() => import("./pages/ReportsPage"), "ReportsPage");
const AccountPage = namedLazy(() => import("./pages/AccountPage"), "AccountPage");
const AdminPage = namedLazy(() => import("./pages/AdminPage"), "AdminPage");
const InvestmentsPage = namedLazy(() => import("./pages/InvestmentsPage"), "InvestmentsPage");
const ShoppingListPage = namedLazy(() => import("./pages/ShoppingListPage"), "ShoppingListPage");

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <ErrorBoundary>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
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
              path="/shopping"
              element={
                <ProtectedRoute requireGroup>
                  <ShoppingListPage />
                </ProtectedRoute>
              }
            />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
