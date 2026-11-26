import { CalendarClock, CalendarX2, CheckCircle2, Clock, TriangleAlert, type LucideIcon } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import {
  REPORT_STATUS_TEXTS,
  missingWeeksLine,
  reportStatusDisplay,
  type ReportStatusDisplay,
  type ReportStatusIcon,
} from "@/lib/cells/report-status";

const ICONS: Readonly<Record<ReportStatusIcon, LucideIcon>> = {
  check: CheckCircle2,
  clock: Clock,
  alert: TriangleAlert,
  "calendar-clock": CalendarClock,
};

/**
 * P70: o badge da situação da semana, sobre o `StatusBadge` (P6), com cantos
 * `rounded-md` e quebra de linha por dentro (UXD-8). No "Enviado", o "·" fica
 * fora do leitor de tela, que ouve "Enviado, Célula realizada". Não é
 * focável, não tem `title` e não abre nada (a explicação está na legenda, P73).
 */
export const ReportStatusBadge = ({ display }: { display: Extract<ReportStatusDisplay, { kind: "badge" }> }) => (
  <StatusBadge
    tone={display.tone}
    icon={ICONS[display.icon]}
    className="w-fit items-start whitespace-normal rounded-md text-left [&>svg]:mt-px"
  >
    <span>
      {display.parts.map((part, i) => (
        <span key={part}>
          {i > 0 && (
            <>
              <span aria-hidden="true">{REPORT_STATUS_TEXTS.separator}</span>
              <span className="sr-only">{REPORT_STATUS_TEXTS.separatorSpoken}</span>
            </>
          )}
          {part}
        </span>
      ))}
    </span>
  </StatusBadge>
);

/** P72: as semanas anteriores sem relatório, em texto com o ícone, e não em badge (UXD-3). */
export const MissingWeeksLine = ({ text, afterBadge = true }: { text: string; afterBadge?: boolean }) => (
  <span className="inline-flex items-start gap-1 text-xs font-medium text-foreground">
    <CalendarX2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    {/* Para o leitor de tela: "Pendente, Sem relatório nas 2 semanas anteriores" (UX-14). */}
    {afterBadge && <span className="sr-only">{REPORT_STATUS_TEXTS.separatorSpoken}</span>}
    <span>{text}</span>
  </span>
);

/** "—" na tela e, para o leitor de tela, o motivo. */
const NoStatus = ({ spoken }: { spoken: string }) => (
  <>
    <span aria-hidden="true">{REPORT_STATUS_TEXTS.none}</span>
    <span className="sr-only">{spoken}</span>
  </>
);

interface ReportStatusProps {
  status: unknown;
  missingWeeks: number | null | undefined;
  isActive: boolean | null | undefined;
  /** `card`: com o rótulo "Relatório:" e tudo numa linha que quebra; `table`: sem o rótulo, um embaixo do outro (P71). */
  variant: "card" | "table";
}

/**
 * P71: a informação "Relatório" de uma célula, na lista (e, no E2.10, no
 * detalhe). Só traduz o código do servidor (AQ-1, UX-12): nada é calculado
 * aqui.
 */
const ReportStatus = ({ status, missingWeeks, isActive, variant }: ReportStatusProps) => {
  const display = reportStatusDisplay(status, isActive);
  const weeks = missingWeeksLine(display, missingWeeks);

  if (variant === "card") {
    // RN-01: a célula inativa não tem a linha "Relatório"; o badge "Inativa" basta.
    if (display.kind === "inactive") return null;
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="text-muted-foreground">{REPORT_STATUS_TEXTS.cardLabel}</span>{" "}
        {display.kind === "badge" && <ReportStatusBadge display={display} />}
        {display.kind === "text" && <span className="text-foreground">{display.label}</span>}
        {display.kind === "unknown" && <NoStatus spoken={REPORT_STATUS_TEXTS.unknownSpoken} />}
        {weeks && <MissingWeeksLine text={weeks} />}
      </div>
    );
  }

  if (display.kind === "inactive") return <NoStatus spoken={REPORT_STATUS_TEXTS.inactiveSpoken} />;
  if (display.kind === "unknown") return <NoStatus spoken={REPORT_STATUS_TEXTS.unknownSpoken} />;
  if (display.kind === "text") return <span className="text-sm text-foreground">{display.label}</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      <ReportStatusBadge display={display} />
      {weeks && <MissingWeeksLine text={weeks} />}
    </div>
  );
};

export default ReportStatus;
