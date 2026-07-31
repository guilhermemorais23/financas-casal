import { Navigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export const PENDING_INVITE_STORAGE_KEY = "fincae_pending_invite_token";

export function AcceptInvitePage() {
  const { token: invitationToken } = useParams<{ token: string }>();
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <p className="loading-page">Carregando...</p>;
  }

  if (!invitationToken) {
    return <Navigate to="/couple-setup" replace />;
  }

  if (!user) {
    sessionStorage.setItem(PENDING_INVITE_STORAGE_KEY, invitationToken);
    return <Navigate to="/login" replace />;
  }

  return <Navigate to={`/couple-setup?token=${invitationToken}`} replace />;
}
