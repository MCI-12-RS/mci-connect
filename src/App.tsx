import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute, PublicRoute } from "@/components/RouteGuards";
import { requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Members from "./pages/Members";
import MembersDeleted from "./pages/MembersDeleted";
import Roles from "./pages/Roles";
import Ministries from "./pages/Ministries";
import Cells from "./pages/Cells";
import CellsDeleted from "./pages/CellsDeleted";
import CellReports from "./pages/CellReports";
import CellReportsDeleted from "./pages/CellReportsDeleted";
import Events from "./pages/Events";
import NotFound from "./pages/NotFound";

// Toda recusa 42501 de leitura ou gravação pede a releitura do próprio cadastro:
// a de um membro excluído encerra a sessão (E2.01, RN-14 e DT-20).
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: requestSessionCheckOnDenied }),
  mutationCache: new MutationCache({ onError: requestSessionCheckOnDenied }),
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/members" element={<ProtectedRoute><Members /></ProtectedRoute>} />
            <Route path="/members/deleted" element={<ProtectedRoute><MembersDeleted /></ProtectedRoute>} />
            <Route path="/roles" element={<ProtectedRoute><Roles /></ProtectedRoute>} />
            <Route path="/ministries" element={<ProtectedRoute><Ministries /></ProtectedRoute>} />
            <Route path="/cells" element={<ProtectedRoute><Cells /></ProtectedRoute>} />
            <Route path="/cells/deleted" element={<ProtectedRoute><CellsDeleted /></ProtectedRoute>} />
            <Route path="/cell-reports" element={<ProtectedRoute><CellReports /></ProtectedRoute>} />
            <Route path="/cell-reports/deleted" element={<ProtectedRoute><CellReportsDeleted /></ProtectedRoute>} />
            <Route path="/events" element={<ProtectedRoute><Events /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
