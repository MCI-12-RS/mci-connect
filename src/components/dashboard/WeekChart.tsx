import { useId, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarX, CheckCircle2, ChevronRight, TriangleAlert, type LucideIcon } from "lucide-react";
import StatusBadge, { type StatusTone } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import { HELD_LABELS } from "@/lib/cell-reports/filter-texts";
import { reportBadgeLabel } from "@/lib/cells/report-status";
import type { ChartPart, ChartRow } from "@/lib/dashboard/cards";
import { DASHBOARD_PAGE_TEXTS, listDestinationText } from "@/lib/dashboard/texts";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** O badge e a barra de cada parte: os badges das listas (P6, P70; E2.10 e E2.12). */
const PARTS: Readonly<Record<ChartPart, { label: string; tone: StatusTone; icon: LucideIcon; bar: string }>> = {
  held: { label: HELD_LABELS.yes, tone: "success", icon: CheckCircle2, bar: "bg-success" },
  not_held: { label: HELD_LABELS.no, tone: "muted", icon: CalendarX, bar: "bg-muted-foreground" },
  pending: { label: reportBadgeLabel("pending"), tone: "warning", icon: TriangleAlert, bar: "bg-warning" },
};

const ROW =
  "grid min-h-11 grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 rounded-md px-2 py-1.5 md:grid-cols-[minmax(0,13rem)_1fr_auto] md:items-center";
const ROW_LINK =
  "transition-colors hover:bg-muted/50 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

/** A barra mínima de uma parte maior que zero (P113). */
const MIN_BAR = "4px";

export interface WeekChartProps {
  rows: readonly ChartRow[];
  /** O endereço da lista de cada parte; `null` (zero ou sem acesso), a linha é um `div` (PR 3). */
  hrefFor?: (row: ChartRow) => string | null;
  /** A chave da volta de cada linha (`chart:<parte>`, PR 3). */
  returnKeyFor?: (row: ChartRow) => string;
  onOpen?: (row: ChartRow, event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * O gráfico "Relatórios de células" (P113, T4): três linhas em HTML, cada uma
 * com o badge da parte, o número e uma barra proporcional ao maior número, sem
 * trilho, sem animação e sem biblioteca de gráfico (AQ-8).
 */
const WeekChart = ({ rows, hrefFor, returnKeyFor, onOpen }: WeekChartProps) => {
  const titleId = useId();
  const legendId = useId();
  return (
    <figure aria-labelledby={titleId} aria-describedby={legendId} className="space-y-2">
      <h3 id={titleId} className="text-lg font-semibold">
        {DASHBOARD_PAGE_TEXTS.chartTitle}
      </h3>
      <p id={legendId} className="text-sm text-muted-foreground">
        {DASHBOARD_PAGE_TEXTS.chartLegend}
      </p>
      <Card className="p-2 md:max-w-3xl">
        <ul role="list" className="space-y-1">
          {rows.map((row) => {
            const part = PARTS[row.part];
            const href = hrefFor?.(row) ?? null;
            const content: ReactNode = (
              <>
                <span className="col-start-1 row-start-1 min-w-0">
                  <StatusBadge tone={part.tone} icon={part.icon} className="w-fit rounded-md">
                    {part.label}
                  </StatusBadge>
                  <span className="sr-only">{DASHBOARD_PAGE_TEXTS.numberSeparator}</span>
                </span>
                <span className="col-start-2 row-start-1 flex items-center justify-end gap-1 md:col-start-3">
                  <span className="text-lg font-semibold tabular-nums">{formatCount(row.value)}</span>
                  {href ? (
                    <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  ) : (
                    <span className="h-5 w-5 shrink-0" aria-hidden="true" />
                  )}
                  {href && <span className="sr-only">{listDestinationText(row.list)}</span>}
                </span>
                <span className="col-span-2 row-start-2 h-3 md:col-span-1 md:col-start-2 md:row-start-1" aria-hidden="true">
                  {row.value > 0 && (
                    <span
                      className={cn("block h-3 rounded-sm", part.bar)}
                      style={{ width: `max(${MIN_BAR}, ${row.ratio * 100}%)` }}
                    />
                  )}
                </span>
              </>
            );
            return (
              <li key={row.part}>
                {href ? (
                  <Link
                    to={href}
                    onClick={(event) => onOpen?.(row, event)}
                    data-return-key={returnKeyFor?.(row)}
                    className={cn(ROW, ROW_LINK)}
                  >
                    {content}
                  </Link>
                ) : (
                  <div className={ROW}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </figure>
  );
};

export default WeekChart;
