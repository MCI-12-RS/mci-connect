import type { ReactNode } from "react";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellStatusBadge } from "@/components/StatusBadges";
import { CellG12, CellLeader, CellMeeting } from "@/components/cells/CellListParts";
import ReportStatus from "@/components/cells/ReportStatus";
import type { CellListRow } from "@/lib/cells/fields";
import { REPORT_STATUS_TEXTS } from "@/lib/cells/report-status";
import { CELLS_PAGE_TEXTS } from "@/lib/cells/texts";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";

interface CellsTableProps {
  rows: CellListRow[];
  isLoading: boolean;
  isError: boolean;
  /** A lista recarrega (troca de página ou depois de uma gravação): `opacity-60` e `aria-busy` (E1.08; E2.06, P44). */
  refreshing: boolean;
  /** As ações da linha; `null` quando a pessoa não tem nenhuma naquela célula. A coluna some se nenhuma linha tiver. */
  renderActions: (cell: CellListRow) => ReactNode | null;
  /** A legenda da tabela, só para o leitor de tela (E2.10, T1: a ordem da lista). */
  caption?: string;
}

/**
 * A lista de Células em tabela, a partir de 1280 px (E2.06, T2; E2.08, T7;
 * E2.09, T2 e P74). Colunas da UXD-6: Líder, G12, Endereço, Reunião (dia,
 * horário e tipo), Relatório, Situação e Ações.
 */
const CellsTable = ({ rows, isLoading, isError, refreshing, renderActions, caption }: CellsTableProps) => {
  const actions = rows.map(renderActions);
  const showActions = actions.some((a) => a !== null);
  const columnCount = showActions ? 7 : 6;

  const message = (text: string, className = "text-muted-foreground") => (
    <TableRow>
      <TableCell colSpan={columnCount} className={`text-center py-8 ${className}`}>
        {text}
      </TableCell>
    </TableRow>
  );

  return (
    <Table>
      {caption && <caption className="sr-only">{caption}</caption>}
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Líder</TableHead>
          <TableHead scope="col">G12</TableHead>
          <TableHead scope="col">Endereço</TableHead>
          <TableHead scope="col">{CELLS_PAGE_TEXTS.columnMeeting}</TableHead>
          {/* `min-w-40`: o badge do relatório não quebra a cada palavra. */}
          <TableHead scope="col" className="min-w-40">
            {REPORT_STATUS_TEXTS.column}
          </TableHead>
          <TableHead scope="col">{CELLS_LIST_TEXTS.columnStatus}</TableHead>
          {showActions && <ActionsHead scope="col">Ações</ActionsHead>}
        </TableRow>
      </TableHeader>
      <TableBody aria-busy={refreshing}>
        {isLoading
          ? // Primeira carga (E2.10, T7): 5 `Skeleton` no formato das linhas, já com a tabela.
            Array.from({ length: 5 }, (_, index) => (
              <TableRow key={index} data-testid="cells-loading-row">
                <TableCell colSpan={columnCount}>
                  <Skeleton className="h-12 w-full" />
                </TableCell>
              </TableRow>
            ))
          : isError
            ? message("Erro ao carregar as células", "text-destructive")
            : rows.length === 0
              ? message("Nenhuma célula encontrada")
              : rows.map((c, i) => (
                  <TableRow key={c.id} className={refreshing ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <CellLeader cell={c} className="text-sm font-medium" />
                        <div className="flex flex-col break-words text-xs text-muted-foreground italic">
                          {c.timothy_name && <span>Timóteo: {c.timothy_name}</span>}
                          {c.host_name && <span>Anfitrião: {c.host_name}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm break-words">
                      <CellG12 cell={c} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col break-words">
                        <span className="font-medium">{c.street ? `${c.street}, ${c.number || "s/n"}` : "—"}</span>
                        <span className="text-xs text-muted-foreground">{c.neighborhood || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-sm whitespace-nowrap">
                          <CellMeeting cell={c} />
                        </span>
                        <Badge variant="outline" className="whitespace-nowrap">
                          {c.type}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ReportStatus
                        variant="table"
                        status={c.report_status}
                        missingWeeks={c.report_missing_weeks}
                        isActive={c.is_active}
                      />
                    </TableCell>
                    <TableCell>
                      <CellStatusBadge active={c.is_active === true} />
                    </TableCell>
                    {showActions && <ActionsCell>{actions[i]}</ActionsCell>}
                  </TableRow>
                ))}
      </TableBody>
    </Table>
  );
};

export default CellsTable;
