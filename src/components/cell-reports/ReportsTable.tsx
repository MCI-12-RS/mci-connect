import type { MouseEvent, ReactNode } from "react";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ReportRowView } from "@/lib/cell-reports/report-row";
import { CELL_REPORT_FILTER_TEXTS, REPORT_ROW_TEXTS } from "@/lib/cell-reports/filter-texts";
import { cn } from "@/lib/utils";
import { REPORT_OPEN_ATTRIBUTE } from "./report-open";
import { CellDeletedBadge, ReportMeetingBadge } from "@/components/StatusBadges";
import { ReportAddress, ReportDay, ReportG12, ReportText } from "./ReportRowParts";

const COLUMNS = CELL_REPORT_FILTER_TEXTS.columns;
const CELL = "px-3 align-top";

interface ReportsTableProps {
  rows: readonly ReportRowView[];
  /** Primeira carga: 5 linhas de `Skeleton`. O erro e a lista vazia ficam com a página (T9). */
  isLoading: boolean;
  /** A lista recarrega: `opacity-60` e `aria-busy` (E1.08). */
  refreshing: boolean;
  /** Mostrar a coluna Ações (com "Editar" ou "Excluir" relatórios). */
  showActions: boolean;
  renderActions: (row: ReportRowView) => ReactNode;
  onOpen: (row: ReportRowView, opener: HTMLElement) => void;
}

/** "—" com "não se aplica" para o leitor de tela, em "Não houve célula" (T2). */
const NotApplicable = () => (
  <>
    <span aria-hidden="true">{REPORT_ROW_TEXTS.none}</span>
    <span className="sr-only">{REPORT_ROW_TEXTS.notApplicable}</span>
  </>
);

/**
 * A lista de Relatórios em tabela, a partir de 1280 px (E2.12, T2, UXD-5): Célula, Data e horário,
 * Reunião, Participantes, Visitantes, Oferta e Ações. O nome do líder é o botão da consulta (P91); o
 * clique na linha é um atalho do mouse, que ignora os botões. Pelo teclado, só o nome e as ações
 * recebem o foco.
 */
const ReportsTable = ({ rows, isLoading, refreshing, showActions, renderActions, onOpen }: ReportsTableProps) => {
  const openRow = (row: ReportRowView) => (event: MouseEvent<HTMLTableRowElement>) => {
    if (event.target instanceof Element && event.target.closest("a, button, [role='menuitem']")) return;
    if (window.getSelection()?.toString()) return;
    const opener = event.currentTarget.querySelector<HTMLElement>(`[${REPORT_OPEN_ATTRIBUTE}]`);
    if (opener) onOpen(row, opener);
  };
  const columnCount = showActions ? 7 : 6;
  const numeric = (value: ReactNode, held: boolean) => (
    <TableCell className={cn(CELL, "text-right tabular-nums")}>{held ? value : <NotApplicable />}</TableCell>
  );

  return (
    <Table>
      <caption className="sr-only">{CELL_REPORT_FILTER_TEXTS.tableCaption}</caption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col" className="px-3">{COLUMNS.cell}</TableHead>
          <TableHead scope="col" className="px-3">{COLUMNS.dateTime}</TableHead>
          <TableHead scope="col" className="px-3">{COLUMNS.meeting}</TableHead>
          <TableHead scope="col" className="px-3 text-right">{COLUMNS.participants}</TableHead>
          <TableHead scope="col" className="px-3 text-right">{COLUMNS.visitors}</TableHead>
          <TableHead scope="col" className="px-3 text-right">{COLUMNS.offering}</TableHead>
          {showActions && <ActionsHead>{COLUMNS.actions}</ActionsHead>}
        </TableRow>
      </TableHeader>
      <TableBody className={refreshing ? "opacity-60" : undefined} aria-busy={refreshing || undefined}>
        {isLoading
          ? Array.from({ length: 5 }, (_, index) => (
              <TableRow key={index} aria-hidden="true">
                <TableCell colSpan={columnCount} className={CELL}>
                  <Skeleton className="h-12 w-full motion-reduce:animate-none" />
                </TableCell>
              </TableRow>
            ))
          : rows.map((row) => (
              <TableRow key={row.id} className="cursor-pointer" onClick={openRow(row)}>
                <TableCell className={cn(CELL, "min-w-48")}>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      aria-haspopup="dialog"
                      aria-label={row.openLabel}
                      {...{ [REPORT_OPEN_ATTRIBUTE]: row.id }}
                      onClick={(event) => onOpen(row, event.currentTarget)}
                      className="w-fit break-words rounded-sm text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {row.leader}
                    </button>
                    <span className="text-sm text-muted-foreground">
                      <ReportG12 row={row} />
                    </span>
                    {row.cellDeleted && <CellDeletedBadge />}
                    <span className="break-words text-sm text-muted-foreground">
                      <ReportAddress row={row} />
                    </span>
                  </div>
                </TableCell>
                <TableCell className={cn(CELL, "whitespace-nowrap")}>
                  <div className="flex flex-col">
                    <span>
                      <ReportDay row={row} />
                    </span>
                    <span className="text-sm text-muted-foreground">{row.date.time}</span>
                  </div>
                </TableCell>
                <TableCell className={cn(CELL, "min-w-44")}>
                  <div className="space-y-1">
                    <ReportMeetingBadge held={row.held} />
                    <ReportText row={row} />
                  </div>
                </TableCell>
                {numeric(row.numbers?.participants, !!row.numbers)}
                {numeric(row.numbers?.visitors, !!row.numbers)}
                <TableCell className={cn(CELL, "whitespace-nowrap text-right tabular-nums")}>
                  {row.numbers ? row.numbers.offering : <NotApplicable />}
                </TableCell>
                {showActions && <ActionsCell>{renderActions(row)}</ActionsCell>}
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
};

export default ReportsTable;
