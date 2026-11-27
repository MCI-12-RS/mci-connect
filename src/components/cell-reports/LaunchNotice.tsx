import { forwardRef } from "react";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { REPORT_FORM_TEXTS } from "@/lib/cell-reports/texts";

export type NoticeTone = "info" | "waiting" | "error";

interface ReportNoticeProps {
  tone: NoticeTone;
  lines: string[];
  /** "Editar relatório" (só para quem edita o relatório da semana, T3 a). */
  onEditReport?: () => void;
  /** "Fechar" dentro do aviso (relatório ou célula excluídos na edição, E2.01). */
  onClose?: () => void;
}

const ICONS = {
  info: CheckCircle2,
  waiting: Clock,
  error: AlertCircle,
} as const;

/**
 * Um aviso no topo do formulário de relatório (E2.11, T3, T7, P100, P107):
 * informação (`CheckCircle2`, `role="status"`), espera (`Clock`) ou recusa
 * (`AlertCircle`, `role="alert"`). O texto em `text-foreground` (P21). Recebe o
 * foco quando aparece (quem o mostra decide).
 */
export const ReportNotice = forwardRef<HTMLDivElement, ReportNoticeProps>(({ tone, lines, onEditReport, onClose }, ref) => {
  const Icon = ICONS[tone];
  return (
    <Alert
      ref={ref}
      tabIndex={-1}
      role={tone === "error" ? "alert" : "status"}
      variant={tone === "error" ? "destructive" : "default"}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <AlertDescription className="space-y-2 text-foreground">
        {lines.map((line, index) => (
          <p key={index} className={index === 0 ? "font-medium" : undefined}>
            {line}
          </p>
        ))}
        {(onEditReport || onClose) && (
          <div className="flex flex-col gap-2 pt-1 md:flex-row">
            {onEditReport && (
              <Button type="button" variant="outline" className="h-11 w-full md:h-9 md:w-auto" onClick={onEditReport}>
                {REPORT_FORM_TEXTS.buttons.editReport}
              </Button>
            )}
            {onClose && (
              <Button type="button" variant="outline" className="h-11 w-full md:h-9 md:w-auto" onClick={onClose}>
                {REPORT_FORM_TEXTS.buttons.close}
              </Button>
            )}
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
});
ReportNotice.displayName = "ReportNotice";
