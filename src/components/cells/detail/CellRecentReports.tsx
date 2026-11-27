import { forwardRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowDown, ArrowRight, ArrowUp, CalendarX, CheckCircle2, Equal, Pencil, Trash2, type LucideIcon } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import RowActionsMenu from "@/components/RowActionsMenu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reportHeading, shownReports, type CellRecentReport } from "@/lib/cells/detail";
import { CELL_DETAIL_TEXTS } from "@/lib/cells/detail-texts";
import { anyTrend, trendOf, TREND_SPOKEN, type Trend } from "@/lib/cells/report-comparison";
import { formatOffering } from "@/lib/cell-reports/labels";
import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { CELL_REPORT_DELETION_TEXTS } from "@/lib/deletion/texts";
import { DetailSection } from "./DetailSection";

const TEXTS = CELL_DETAIL_TEXTS.reports;

const TREND_ICONS: Readonly<Record<Trend, LucideIcon>> = { up: ArrowUp, down: ArrowDown, same: Equal };

/** O número com a seta neutra (P82): a seta é `aria-hidden`, e o sentido vai em `sr-only`. */
export const CellReportTrend = ({ value, sign }: { value: number | null; sign: number | null }) => {
  const trend = trendOf(sign);
  const Icon = trend ? TREND_ICONS[trend] : null;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      {value ?? 0}
      {Icon && trend && (
        <>
          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" data-trend={trend} />
          <span className="sr-only">{TREND_SPOKEN[trend]}</span>
        </>
      )}
    </span>
  );
};

/** "Célula realizada" ou "Não houve célula" (P6), com os termos do Negócio (T11). */
const HeldBadge = ({ held }: { held: boolean }) =>
  held ? (
    <StatusBadge tone="success" icon={CheckCircle2} className="w-fit">
      {TEXTS.held}
    </StatusBadge>
  ) : (
    <StatusBadge tone="muted" icon={CalendarX} className="w-fit">
      {TEXTS.notHeld}
    </StatusBadge>
  );

/** "Tema: …" ou "Motivo: …" e "Observações: …", só quando há (T11). */
const ReportTexts = ({ report }: { report: CellRecentReport }) => {
  const held = report.was_held !== false;
  const main = held ? report.theme : report.reason_not_held;
  return (
    <>
      {main && (
        <p className="break-words text-sm">
          <span className="text-muted-foreground">{held ? TEXTS.theme : TEXTS.reason}</span> {main}
        </p>
      )}
      {report.observations && (
        <p className="break-words text-sm">
          <span className="text-muted-foreground">{TEXTS.observations}</span> {report.observations}
        </p>
      )}
    </>
  );
};

/** Um bloco de número do cartão: rótulo pequeno e valor em destaque. */
const NumberBlock = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-base font-semibold">{children}</p>
  </div>
);

interface CellRecentReportsProps {
  reports: readonly CellRecentReport[] | undefined;
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  /** O id da célula: "Ver todos os relatórios" abre `/cell-reports?cell=<id>` (RN-19). */
  cellId: string;
  /** O líder atual da célula, nos nomes acessíveis das ações e de "Ver todos os relatórios". */
  leaderName: string;
  /** A partir de 1024 px, a tabela; abaixo, os cartões (UXD-8). */
  showTable: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (report: CellRecentReport, opener: HTMLElement) => void;
  onDelete: (report: CellRecentReport, opener: HTMLElement | null) => void;
}

/**
 * Últimos relatórios (RN-17, RN-18, RN-19; T11, P82): os 3 mais recentes
 * visíveis, em cartões até 1023 px e numa tabela a partir de 1024 px, com as
 * setas e as ações de cada relatório; "Ver todos os relatórios". Só números:
 * nenhum nome de participante ou de visitante.
 */
export const CellRecentReports = forwardRef<HTMLHeadingElement, CellRecentReportsProps>(
  (
    { reports, isPending, isError, onRetry, cellId, leaderName, showTable, canEdit, canDelete, onEdit, onDelete },
    headingRef,
  ) => {
    const shown = shownReports(reports ?? []);
    const showTrendHint = !isError && anyTrend(shown);
    const showActions = canEdit || canDelete;
    const dateOf = (r: CellRecentReport) => formatIsoDateBr(r.date);

    const editButton = (r: CellRecentReport, className: string) =>
      canEdit && (
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={(e) => onEdit(r, e.currentTarget)}
          aria-label={CELL_REPORT_DELETION_TEXTS.editLabel(dateOf(r), leaderName)}
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      );

    let body: ReactNode;
    if (isError && !reports) {
      body = (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3 text-foreground">
            <p>{TEXTS.loadFailed}</p>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onRetry}>
              {CELL_DETAIL_TEXTS.tryAgain}
            </Button>
          </AlertDescription>
        </Alert>
      );
    } else if (isPending) {
      body = (
        <div className="space-y-3" aria-hidden="true" data-testid="cell-reports-loading">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className={showTable ? "h-12 w-full" : "h-32 w-full"} />
          ))}
        </div>
      );
    } else if (shown.length === 0) {
      body = <p className="text-sm text-muted-foreground">{TEXTS.empty}</p>;
    } else if (showTable) {
      body = (
        <Table>
          <caption className="sr-only">{CELL_DETAIL_TEXTS.sections.recentReports}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">{TEXTS.dateTime}</TableHead>
              <TableHead scope="col">{TEXTS.report}</TableHead>
              <TableHead scope="col" className="text-right">
                {TEXTS.participants}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {TEXTS.visitors}
              </TableHead>
              <TableHead scope="col" className="text-right">
                {TEXTS.offering}
              </TableHead>
              {showActions && (
                <TableHead scope="col" className="text-right">
                  {TEXTS.actions}
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => {
              const held = r.was_held !== false;
              const notApplicable = (
                <>
                  <span aria-hidden="true">{TEXTS.notApplicable}</span>
                  <span className="sr-only">{TEXTS.notApplicableSpoken}</span>
                </>
              );
              return (
                <TableRow key={r.id}>
                  <TableCell className="align-top text-sm">{reportHeading(r)}</TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col items-start gap-1">
                      <HeldBadge held={held} />
                      <ReportTexts report={r} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {held ? <CellReportTrend value={r.participants_count} sign={r.participants_trend} /> : notApplicable}
                  </TableCell>
                  <TableCell className="text-right align-top">
                    {held ? <CellReportTrend value={r.visitors_count} sign={r.visitors_trend} /> : notApplicable}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right align-top tabular-nums">
                    {held ? formatOffering(r.offering) : notApplicable}
                  </TableCell>
                  {showActions && (
                    <TableCell className="align-top">
                      <div className="flex items-center justify-end gap-1">
                        {editButton(r, "h-8 w-8")}
                        {canDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={CELL_REPORT_DELETION_TEXTS.deleteLabel(dateOf(r), leaderName)}
                            onClick={(e) => onDelete(r, e.currentTarget)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      );
    } else {
      body = (
        <ul className="space-y-3">
          {shown.map((r) => {
            const held = r.was_held !== false;
            return (
              <li key={r.id}>
                <article className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="min-w-0 pt-2 font-body text-sm font-semibold">{reportHeading(r)}</h3>
                    {showActions && (
                      <div className="flex shrink-0 items-center gap-2">
                        {editButton(r, "h-11 w-11")}
                        <RowActionsMenu
                          label={CELL_REPORT_DELETION_TEXTS.actionsLabel(dateOf(r), leaderName)}
                          actions={
                            canDelete
                              ? [{ label: CELL_REPORT_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => onDelete(r, trigger) }]
                              : []
                          }
                        />
                      </div>
                    )}
                  </div>
                  <HeldBadge held={held} />
                  {held ? (
                    <>
                      <ReportTexts report={{ ...r, observations: null }} />
                      <div className="flex flex-wrap gap-x-6 gap-y-2">
                        <NumberBlock label={TEXTS.participants}>
                          <CellReportTrend value={r.participants_count} sign={r.participants_trend} />
                        </NumberBlock>
                        <NumberBlock label={TEXTS.visitors}>
                          <CellReportTrend value={r.visitors_count} sign={r.visitors_trend} />
                        </NumberBlock>
                        <NumberBlock label={TEXTS.offering}>
                          <span className="tabular-nums">{formatOffering(r.offering)}</span>
                        </NumberBlock>
                      </div>
                      <ReportTexts report={{ ...r, theme: null }} />
                    </>
                  ) : (
                    <ReportTexts report={r} />
                  )}
                </article>
              </li>
            );
          })}
        </ul>
      );
    }

    return (
      <DetailSection
        ref={headingRef}
        focusableTitle
        className="md:col-span-2 xl:col-span-3"
        title={CELL_DETAIL_TEXTS.sections.recentReports}
        description={showTrendHint && <p className="text-sm text-muted-foreground">{TEXTS.trendHint}</p>}
      >
        {body}
        {!isPending && shown.length > 0 && (
          <Button asChild variant="outline" className="h-11 w-full md:h-10 md:w-auto">
            <Link to={`/cell-reports?cell=${cellId}`}>
              {TEXTS.viewAll}
              <span className="sr-only">{TEXTS.viewAllSpoken(leaderName)}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Button>
        )}
      </DetailSection>
    );
  },
);
CellRecentReports.displayName = "CellRecentReports";
