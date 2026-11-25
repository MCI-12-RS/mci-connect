import { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import AppSidebar from "./AppSidebar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { ACCESS_TEXTS } from "@/lib/access/texts";

/**
 * O acesso nunca foi lido (por exemplo, a rede caiu no login): o aviso no topo
 * da área principal, no lugar de um menu vazio sem explicação (E2.02, T12).
 */
const AccessLoadFailed = ({ onRetry }: { onRetry: () => void }) => (
  <Alert variant="destructive" className="mb-4" data-testid="access-load-failed">
    <AlertCircle className="h-4 w-4" aria-hidden="true" />
    <AlertDescription className="space-y-3 text-foreground">
      <p>{ACCESS_TEXTS.loadFailed}</p>
      <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onRetry}>
        {ACCESS_TEXTS.tryAgain}
      </Button>
    </AlertDescription>
  </Alert>
);

const AppLayout = ({ children }: { children: ReactNode }) => {
  const { accessLoadFailed, retryAccess } = useAuth();
  return (
    <div className="flex min-h-screen">
      <AppSidebar />
      <main className="flex-1 p-4 md:p-6 overflow-auto pt-14 md:pt-6">
        {accessLoadFailed && <AccessLoadFailed onRetry={retryAccess} />}
        {children}
      </main>
    </div>
  );
};

export default AppLayout;
