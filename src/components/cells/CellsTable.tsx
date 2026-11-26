import type { ReactNode } from "react";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CellStatusBadge } from "@/components/StatusBadges";
import { CellG12, CellLeader } from "@/components/cells/CellListParts";
import type { CellRow } from "@/lib/cells/fields";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";

interface CellsTableProps {
  rows: CellRow[];
  isLoading: boolean;
  isError: boolean;
  /** A lista recarrega (troca de página ou depois de uma gravação): `opacity-60` e `aria-busy` (E1.08; E2.06, P44). */
  refreshing: boolean;
  /** As ações da linha; `null` quando a pessoa não tem nenhuma naquela célula. A coluna some se nenhuma linha tiver. */
  renderActions: (cell: CellRow) => ReactNode | null;
}

/** A lista de Células em tabela (E2.06, T2; E2.08, T7). */
const CellsTable = ({ rows, isLoading, isError, refreshing, renderActions }: CellsTableProps) => {
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
      <TableHeader>
        <TableRow>
          <TableHead>Líder</TableHead>
          <TableHead>G12</TableHead>
          <TableHead>Endereço</TableHead>
          <TableHead>Tipo</TableHead>
          <TableHead>Dia / Hora</TableHead>
          <TableHead>{CELLS_LIST_TEXTS.columnStatus}</TableHead>
          {showActions && <ActionsHead>Ações</ActionsHead>}
        </TableRow>
      </TableHeader>
      <TableBody aria-busy={refreshing}>
        {isLoading
          ? message("Carregando...")
          : isError
            ? message("Erro ao carregar as células", "text-destructive")
            : rows.length === 0
              ? message("Nenhuma célula encontrada")
              : rows.map((c, i) => (
                  <TableRow key={c.id} className={refreshing ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <CellLeader cell={c} className="text-sm font-medium" />
                        <div className="flex flex-col text-xs text-muted-foreground italic">
                          {c.timothy_name && <span>Timóteo: {c.timothy_name}</span>}
                          {c.host_name && <span>Anfitrião: {c.host_name}</span>}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <CellG12 cell={c} />
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="flex flex-col">
                        <span className="font-medium">{c.street ? `${c.street}, ${c.number || "s/n"}` : "—"}</span>
                        <span className="text-xs text-muted-foreground">{c.neighborhood || "—"}</span>
                      </div>
                    </TableCell>
                    <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                    <TableCell className="text-sm">{c.meeting_day} às {c.meeting_time?.substring(0, 5) || "—"}</TableCell>
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
