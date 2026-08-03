import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { AccountPage } from "./pages/AccountPage";
import { CoupleSetupPage } from "./pages/CoupleSetupPage";
import { DashboardPage } from "./pages/DashboardPage";
import { GoalsPage } from "./pages/GoalsPage";
import { LoginPage } from "./pages/LoginPage";
import { NewTransactionPage } from "./pages/NewTransactionPage";
import { ParPage } from "./pages/ParPage";
import { RegisterPage } from "./pages/RegisterPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ProtectedRoute } from "./routes/ProtectedRoute";

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/couple-setup"
          element={
            <ProtectedRoute>
              <CoupleSetupPage />
            </ProtectedRoute>
          }
        />
        <Route path="/invite/:token" element={<AcceptInvitePage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute requireCouple>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/par"
          element={
            <ProtectedRoute requireCouple>
              <ParPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transactions/new"
          element={
            <ProtectedRoute requireCouple>
              <NewTransactionPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/goals"
          element={
            <ProtectedRoute requireCouple>
              <GoalsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute requireCouple>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute requireCouple>
              <AccountPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
