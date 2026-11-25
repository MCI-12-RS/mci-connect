import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Info } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { canSeeRoute } from "@/lib/access/access";
import { ACCESS_TEXTS } from "@/lib/access/texts";

interface NoAccessProps {
  /** O `h1` da rota, para a pessoa e o leitor de tela saberem onde estão (T12). */
  title: string;
}

/**
 * Tela sem acesso (E2.02, T12 e P13): o título da rota, "Você não tem acesso a
 * esta tela." e "Ir para o início", sem redirecionar e sem nenhum dado da tela.
 */
export function NoAccess({ title }: NoAccessProps) {
  return (
    <AppLayout>
      <div className="space-y-4 animate-fade-in" data-testid="no-access">
        <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
        <Alert>
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <p>{ACCESS_TEXTS.noAccessScreen}</p>
            <Button asChild variant="outline" className="h-11">
              <Link to="/">{ACCESS_TEXTS.goHome}</Link>
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    </AppLayout>
  );
}

interface RouteAccessProps extends NoAccessProps {
  /** A rota, como o menu a conhece (`/members`, `/roles`…). */
  path: string;
  children: ReactNode;
}

/**
 * Guarda de uma rota pelo acesso (RN-22, T12). Fica acima da página: sem
 * permissão, a página nem é montada, e nenhuma consulta de dados sai. Enquanto
 * o acesso não foi lido, também não monta (mostra o carregando; se a leitura
 * falhou, o `AppLayout` mostra o aviso com "Tentar de novo").
 */
export function RouteAccess({ path, title, children }: RouteAccessProps) {
  const { access, permissionsLoaded, accessLoadFailed } = useAuth();
  if (!permissionsLoaded) {
    return (
      <AppLayout>
        <div className="space-y-4">
          <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
          {!accessLoadFailed && (
            <div className="space-y-3" aria-busy="true">
              <span className="sr-only">{ACCESS_TEXTS.loading}</span>
              <Skeleton className="h-10 w-full max-w-sm" />
              <Skeleton className="h-24 w-full" />
            </div>
          )}
        </div>
      </AppLayout>
    );
  }
  if (!canSeeRoute(access, path)) return <NoAccess title={title} />;
  return <>{children}</>;
}
