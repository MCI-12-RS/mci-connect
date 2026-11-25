import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { SESSION_ENDED_REASON } from "@/lib/auth/session";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/password-change-route";

const Loading = () => (
  <div className="min-h-dvh flex items-center justify-center text-muted-foreground">Carregando...</div>
);

/**
 * Só com sessão. Sem ela, o login; se a sessão foi encerrada pelo sistema, com
 * o aviso (E2.01, RN-14). Com a marca de troca obrigatória, a troca, antes de
 * qualquer dado da tela (E2.03, RN-09, P18).
 */
export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading, sessionEnded, mustChangePassword, passwordStatusLoaded } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={sessionEnded ? { reason: SESSION_ENDED_REASON } : undefined} />;
  if (!passwordStatusLoaded) return <Loading />;
  if (mustChangePassword) return <Navigate to={CHANGE_PASSWORD_PATH} replace />;
  return <>{children}</>;
};

/** Só sem sessão (o login). Com ela, o Dashboard, ou a troca obrigatória com a marca. */
export const PublicRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading, mustChangePassword } = useAuth();
  if (loading) return <Loading />;
  if (session) return <Navigate to={mustChangePassword ? CHANGE_PASSWORD_PATH : "/"} replace />;
  return <>{children}</>;
};

/** A troca obrigatória (T2): só com sessão e com a marca. Sem a marca, o início. */
export const ChangePasswordRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading, sessionEnded, mustChangePassword, passwordStatusLoaded } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={sessionEnded ? { reason: SESSION_ENDED_REASON } : undefined} />;
  if (!passwordStatusLoaded) return <Loading />;
  if (!mustChangePassword) return <Navigate to="/" replace />;
  return <>{children}</>;
};
