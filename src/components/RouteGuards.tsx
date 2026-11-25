import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { SESSION_ENDED_REASON } from "@/lib/auth/session";

const Loading = () => (
  <div className="min-h-screen flex items-center justify-center text-muted-foreground">Carregando...</div>
);

/** Só com sessão. Sem ela, o login; se a sessão foi encerrada pelo sistema, com o aviso (E2.01, RN-14). */
export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading, sessionEnded } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Navigate to="/login" replace state={sessionEnded ? { reason: SESSION_ENDED_REASON } : undefined} />;
  return <>{children}</>;
};

/** Só sem sessão (o login). Com ela, o Dashboard. */
export const PublicRoute = ({ children }: { children: ReactNode }) => {
  const { session, loading } = useAuth();
  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
};
