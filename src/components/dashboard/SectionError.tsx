import { CircleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DASHBOARD_PAGE_TEXTS } from "@/lib/dashboard/texts";

export interface SectionErrorProps {
  message: string;
  /** Refaz só a consulta que falhou (AQ-9). */
  onRetry: () => void;
  /** A nova tentativa está em andamento: o botão fica ocupado. */
  retrying: boolean;
  /** `role="alert"` só quando "Tentar de novo" falhou; na primeira carga, não interrompe a leitura (T7). */
  announce: boolean;
}

/** O erro de uma seção do Dashboard (T7, UXD-9): o que aconteceu, o que fazer e "Tentar de novo". */
const SectionError = ({ message, onRetry, retrying, announce }: SectionErrorProps) => (
  <Alert role={announce ? "alert" : undefined}>
    <CircleAlert className="h-4 w-4" aria-hidden="true" />
    <div className="space-y-3">
      <AlertDescription className="text-foreground">{message}</AlertDescription>
      {/* Ocupado sem `disabled`, para o foco não sair do botão durante a nova tentativa. */}
      <Button
        type="button"
        variant="outline"
        className="h-11 w-full aria-disabled:opacity-60 md:h-10 md:w-auto"
        onClick={() => {
          if (!retrying) onRetry();
        }}
        aria-disabled={retrying || undefined}
        aria-busy={retrying || undefined}
      >
        {DASHBOARD_PAGE_TEXTS.retry}
      </Button>
    </div>
  </Alert>
);

export default SectionError;
