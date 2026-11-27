// O que a confirmação de exclusão mostra de uma célula ou de um relatório
// (E2.01, T1 e T2), a partir das linhas das listas.
import { formatMeetingTime, formatShortAddress } from "@/lib/cells/labels";
import type { CellRow } from "@/lib/cells/fields";
import { formatReportDate } from "@/lib/cell-reports/labels";
import type { CellReportRow } from "@/lib/cell-reports/fields";
import { CELL_DELETION_TEXTS } from "@/lib/deletion/texts";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";

/** O nome do líder nos rótulos de célula e de relatório; sem nome, "Membro sem nome". */
export function leaderLabel(name: string | null | undefined): string {
  return name || UNNAMED_MEMBER_LABEL;
}

/** A célula que se quer excluir. */
export interface CellDeletionTarget {
  id: string;
  /** Nome do líder: "Excluir a célula de {Líder}?". */
  leaderName: string;
  /** "{Dia}, {hora} · {endereço}", que identifica a célula (RN-04). */
  summary: string;
  /** O aviso de inativar só aparece para a célula ativa (UX-05). */
  isActive: boolean;
}

export type CellDeletionSource = Pick<
  CellRow,
  "id" | "leader_name" | "meeting_day" | "meeting_time" | "street" | "number" | "neighborhood" | "is_active"
>;

export function toCellDeletionTarget(cell: CellDeletionSource): CellDeletionTarget {
  return {
    id: cell.id,
    leaderName: leaderLabel(cell.leader_name),
    summary: CELL_DELETION_TEXTS.summary(
      cell.meeting_day ?? "",
      formatMeetingTime(cell.meeting_time),
      formatShortAddress(cell),
    ),
    isActive: cell.is_active === true,
  };
}

/** O relatório que se quer excluir. */
export interface CellReportDeletionTarget {
  id: string;
  /** "dd/MM/aaaa": "Excluir o relatório de {data} da célula de {Líder}?". */
  date: string;
  leaderName: string;
}

/** O líder é o registrado no relatório (E2.11, RN-14 d). */
export type CellReportDeletionSource = Pick<CellReportRow, "id" | "date" | "snapshot_leader_name">;

export function toCellReportDeletionTarget(report: CellReportDeletionSource): CellReportDeletionTarget {
  return {
    id: report.id,
    date: formatReportDate(report.date),
    leaderName: leaderLabel(report.snapshot_leader_name),
  };
}
