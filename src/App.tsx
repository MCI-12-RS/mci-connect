import { MutationCache, QueryCache, QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ScrollToTopOnPush from "@/components/ScrollToTopOnPush";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ChangePasswordRoute, ProtectedRoute, PublicRoute } from "@/components/RouteGuards";
import { RouteAccess } from "@/components/NoAccess";
import { handleGateError, requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import { CHANGE_PASSWORD_PATH } from "@/lib/auth/password-change-route";
import { isPermissionDenied, retryUnlessGate } from "@/lib/errors";
import { SCREEN_TITLES } from "@/lib/access/texts";
import { isAccessQueryKey, refreshAccess } from "@/hooks/use-access";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import MembersDeleted from "./pages/MembersDeleted";
import Roles from "./pages/Roles";
import Ministries from "./pages/Ministries";
import Cells from "./pages/Cells";
import CellsDeleted from "./pages/CellsDeleted";
import CellDetail from "./pages/CellDetail";
import CellReports from "./pages/CellReports";
import CellReportsDeleted from "./pages/CellReportsDeleted";
import Events from "./pages/Events";
import NotFound from "./pages/NotFound";

// Toda recusa 42501 de leitura ou gravação pede:
//   - a releitura do próprio cadastro: a de um membro excluído encerra a sessão (E2.01, RN-14 e DT-20);
//   - a releitura do acesso, que pode ter mudado (E2.02, RN-08 e P13). A recusa
//     da própria leitura do acesso não pede outra, para não repetir sem fim.
// Antes de tudo, o portão da senha (E2.03, AQ-3): a marca leva à troca e a
// sessão apagada ao login, sem as releituras, que cairiam no portão de novo.
function onDenied(error: unknown, queryKey?: QueryKey) {
  if (handleGateError(error)) return;
  requestSessionCheckOnDenied(error);
  if (isPermissionDenied(error) && !isAccessQueryKey(queryKey)) void refreshAccess(queryClient);
}

const queryClient: QueryClient = new QueryClient({
  defaultOptions: { queries: { retry: retryUnlessGate } },
  queryCache: new QueryCache({ onError: (error, query) => onDenied(error, query.queryKey) }),
  mutationCache: new MutationCache({ onError: (error) => onDenied(error) }),
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ScrollToTopOnPush />
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path={CHANGE_PASSWORD_PATH} element={<ChangePasswordRoute><ChangePassword /></ChangePasswordRoute>} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/members" element={<ProtectedRoute><RouteAccess path="/members" title={SCREEN_TITLES.members}><Members /></RouteAccess></ProtectedRoute>} />
            <Route path="/members/deleted" element={<ProtectedRoute><MembersDeleted /></ProtectedRoute>} />
            <Route path="/roles" element={<ProtectedRoute><RouteAccess path="/roles" title={SCREEN_TITLES.roles}><Roles /></RouteAccess></ProtectedRoute>} />
            <Route path="/ministries" element={<ProtectedRoute><RouteAccess path="/ministries" title={SCREEN_TITLES.ministries}><Ministries /></RouteAccess></ProtectedRoute>} />
            <Route path="/cells" element={<ProtectedRoute><RouteAccess path="/cells" title={SCREEN_TITLES.cells}><Cells /></RouteAccess></ProtectedRoute>} />
            <Route path="/cells/deleted" element={<ProtectedRoute><CellsDeleted /></ProtectedRoute>} />
            {/* Depois da rota fixa de excluídas (E2.10, AQ-7): quem abre é decidido pela visibilidade da célula. */}
            <Route path="/cells/:id" element={<ProtectedRoute><CellDetail /></ProtectedRoute>} />
            <Route path="/cell-reports" element={<ProtectedRoute><RouteAccess path="/cell-reports" title={SCREEN_TITLES.cellReports}><CellReports /></RouteAccess></ProtectedRoute>} />
            <Route path="/cell-reports/deleted" element={<ProtectedRoute><CellReportsDeleted /></ProtectedRoute>} />
            <Route path="/events" element={<ProtectedRoute><RouteAccess path="/events" title={SCREEN_TITLES.events}><Events /></RouteAccess></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
