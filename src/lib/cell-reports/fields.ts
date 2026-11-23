// Colunas da `cell_reports_view` e da `cell_report_participants_view` lidas
// pelo front (E1.08, PR 2).
import type { Database } from "@/integrations/supabase/types";
import type { CellLabelParts, StreetLineParts } from "@/lib/cells/labels";

export type CellReportViewRow = Database["public"]["Views"]["cell_reports_view"]["Row"];
export type ReportParticipantViewRow = Database["public"]["Views"]["cell_report_participants_view"]["Row"];

/**
 * Página da lista de Relatórios. A view é `security_barrier`: toda coluna
 * pedida é calculada para todas as linhas visíveis antes do `LIMIT`. Por isso
 * a página nunca pede `search_text` (só filtra por ela) nem
 * `participants_count`, que vem de uma segunda consulta, só com os ids da
 * página (`PARTICIPANT_COUNT_SELECT`).
 */
// Uma string literal só: o supabase-js deriva o tipo do resultado dela.
export const CELL_REPORT_ROW_SELECT =
  "id, cell_id, date, time, theme, observations, visitors, offering, was_held, reason_not_held, visitors_count, cell_leader_name, cell_street, cell_number, cell_complement, cell_neighborhood";

export type CellReportPageRow = Pick<
  CellReportViewRow,
  | "id"
  | "cell_id"
  | "date"
  | "time"
  | "theme"
  | "observations"
  | "visitors"
  | "offering"
  | "was_held"
  | "reason_not_held"
  | "visitors_count"
  | "cell_leader_name"
  | "cell_street"
  | "cell_number"
  | "cell_complement"
  | "cell_neighborhood"
>;

/** Linha da lista de Relatórios, já com o número de participantes. */
export type CellReportRow = CellReportPageRow & Pick<CellReportViewRow, "participants_count">;

export const PARTICIPANT_COUNT_SELECT = "id, participants_count";

export type ParticipantCount = Pick<CellReportViewRow, "id" | "participants_count">;

/** Junta às linhas da página o número de participantes de cada uma (0 se faltar). */
export function withParticipantCounts(rows: CellReportPageRow[], counts: ParticipantCount[]): CellReportRow[] {
  const byId = new Map(counts.map((c) => [c.id, c.participants_count ?? 0]));
  return rows.map((row) => ({ ...row, participants_count: byId.get(row.id) ?? 0 }));
}

/** Participantes de um relatório, com o nome (RN-06). */
export const REPORT_PARTICIPANT_SELECT = "member_id, member_name";

export type ReportParticipant = Pick<ReportParticipantViewRow, "member_id" | "member_name">;

export type ReportCellParts = Pick<
  CellReportViewRow,
  "cell_id" | "cell_leader_name" | "cell_street" | "cell_number" | "cell_complement" | "cell_neighborhood"
>;

/** A célula do relatório no formato dos rótulos de célula. */
export function cellOfReport(report: ReportCellParts): CellLabelParts & StreetLineParts {
  return {
    id: report.cell_id,
    leader_name: report.cell_leader_name,
    street: report.cell_street,
    number: report.cell_number,
    complement: report.cell_complement,
    neighborhood: report.cell_neighborhood,
  };
}
