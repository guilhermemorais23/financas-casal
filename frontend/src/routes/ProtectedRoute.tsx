import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LoadingScreen } from "../components/Spinner";

export function ProtectedRoute({
  children,
  requireGroup = false,
}: {
  children: React.ReactNode;
  requireGroup?: boolean;
}) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (requireGroup && !user.groupId) {
    return <Navigate to="/group-setup" replace />;
  }

  return <>{children}</>;
}
