// A trava das páginas que exigem login. Em App.tsx, toda página "de dentro"
// fica embrulhada assim: <ProtectedRoute requireGroup><DashboardPage /></ProtectedRoute>.
//   - ainda conferindo a sessão -> tela de carregando;
//   - ninguém logado -> manda pro /login;
//   - requireGroup e a pessoa ainda não tem grupo -> manda pro /group-setup;
//   - tudo certo -> mostra a página.
// É só conforto de tela: a segurança de verdade está no backend, que confere
// o token em todo pedido (backend/src/middleware/auth.ts).
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
