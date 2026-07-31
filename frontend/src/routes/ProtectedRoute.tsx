import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute({
  children,
  requireCouple = false,
}: {
  children: React.ReactNode;
  requireCouple?: boolean;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <p className="loading-page">Carregando...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireCouple && !user.coupleId) {
    return <Navigate to="/couple-setup" replace />;
  }

  return <>{children}</>;
}
