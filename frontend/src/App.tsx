import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { ToastProvider } from "./components/ToastProvider";
import { PageSkeleton } from "./components/Skeleton";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { LoginPage } from "./pages/LoginPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";

// Lazy-loaded: everything past the login screen used to ship in the same
// single ~460KB bundle regardless of which page someone actually opens, so
// every visit paid to download/parse/execute all 13+ pages up front (Admin,
// Investments, Relatórios's chart code, etc. included) even for someone who
// only ever uses the Painel. Splitting per route means a page only costs
// what it weighs the first time it's actually visited; React Router caches
// the chunk after that, same as any other lazy import. LoginPage stays
// eager -- it's the one screen nearly everyone hits on the coldest possible
// load, so there's nothing to gain deferring it.
const RegisterPage = lazy(() => import("./pages/RegisterPage").then((m) => ({ default: m.RegisterPage })));
const GroupSetupPage = lazy(() => import("./pages/GroupSetupPage").then((m) => ({ default: m.GroupSetupPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ParPage = lazy(() => import("./pages/ParPage").then((m) => ({ default: m.ParPage })));
const NewTransactionPage = lazy(() =>
  import("./pages/NewTransactionPage").then((m) => ({ default: m.NewTransactionPage }))
);
const DebtsPage = lazy(() => import("./pages/DebtsPage").then((m) => ({ default: m.DebtsPage })));
const CardsPage = lazy(() => import("./pages/CardsPage").then((m) => ({ default: m.CardsPage })));
const GoalsPage = lazy(() => import("./pages/GoalsPage").then((m) => ({ default: m.GoalsPage })));
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const AccountPage = lazy(() => import("./pages/AccountPage").then((m) => ({ default: m.AccountPage })));
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const InvestmentsPage = lazy(() =>
  import("./pages/InvestmentsPage").then((m) => ({ default: m.InvestmentsPage }))
);
const ShoppingListPage = lazy(() =>
  import("./pages/ShoppingListPage").then((m) => ({ default: m.ShoppingListPage }))
);

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
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
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
