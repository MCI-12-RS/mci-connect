// Colunas da `cell_reports_view` e da `cell_report_participants_view` lidas
// pelo front (E1.08, PR 2).
import type { Database } from "@/integrations/supabase/types";
import type { StreetLineParts } from "@/lib/cells/labels";

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
// O líder da linha é o registrado no relatório, com o G12 atual dele (E2.11, RN-14 d, T10); o endereço é o atual.
export const CELL_REPORT_ROW_SELECT =
  "id, cell_id, date, time, theme, observations, visitors, offering, was_held, reason_not_held, visitors_count, snapshot_leader_name, snapshot_g12_leader_name, snapshot_leader_g12_level, snapshot_leader_is_pastor, cell_street, cell_number, cell_complement, cell_neighborhood, cell_deleted";

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
  | "snapshot_leader_name"
  | "snapshot_g12_leader_name"
  | "snapshot_leader_g12_level"
  | "snapshot_leader_is_pastor"
  | "cell_street"
  | "cell_number"
  | "cell_complement"
  | "cell_neighborhood"
  | "cell_deleted"
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

/**
 * Participantes de um relatório, com o nome (E1.08, RN-06) e se o cadastro
 * foi excluído (E2.01, AQ-5).
 */
export const REPORT_PARTICIPANT_SELECT = "member_id, member_name, member_deleted";

export type ReportParticipant = Pick<ReportParticipantViewRow, "member_id" | "member_name" | "member_deleted">;

/**
 * Participantes no formulário de relatório: os de `ReportParticipant` e se
 * quem edita vê o participante (E2.02, `member_visible`, AQ-7), para o aviso
 * de que, retirado, ele não volta pelo seletor.
 */
export const FORM_PARTICIPANT_SELECT =
  "member_id, member_name, member_deleted, member_visible, is_snapshot_person, member_is_active, member_gender";

export type FormParticipant = Pick<
  ReportParticipantViewRow,
  "member_id" | "member_name" | "member_deleted" | "member_visible"
> &
  Partial<Pick<ReportParticipantViewRow, "is_snapshot_person" | "member_is_active" | "member_gender">>;

/**
 * O relatório na edição (E2.11, T9, AQ-10): lido pelo id ao abrir, com o
 * retrato para o bloco, a célula e a autoria.
 */
export const CELL_REPORT_EDIT_SELECT =
  "id, cell_id, date, time, theme, observations, visitors, offering, was_held, reason_not_held, cell_deleted, snapshot_leader_id, snapshot_leader_name, snapshot_timothy_id, snapshot_timothy_name, snapshot_host_id, snapshot_host_name, snapshot_cell_type, snapshot_g12_leader_name, snapshot_leader_g12_level, snapshot_leader_is_pastor, cell_meeting_day, cell_meeting_time, cell_street, cell_number, cell_neighborhood";

export type CellReportEditRow = Pick<
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
  | "cell_deleted"
  | "snapshot_leader_id"
  | "snapshot_leader_name"
  | "snapshot_timothy_id"
  | "snapshot_timothy_name"
  | "snapshot_host_id"
  | "snapshot_host_name"
  | "snapshot_cell_type"
  | "snapshot_g12_leader_name"
  | "snapshot_leader_g12_level"
  | "snapshot_leader_is_pastor"
  | "cell_meeting_day"
  | "cell_meeting_time"
  | "cell_street"
  | "cell_number"
  | "cell_neighborhood"
>;

/**
 * Um relatório no painel de consulta ("Ver relatório", E2.01 T7): o que o
 * painel mostra e se a célula foi excluída (AQ-4).
 */
// Com o retrato e a célula de hoje, para o bloco da célula (E2.11, P105, RN-14 c).
export const CELL_REPORT_DETAIL_SELECT =
  "id, date, time, theme, observations, visitors, offering, was_held, reason_not_held, cell_leader_name, cell_deleted, created_at, created_by_kind, created_by_name, updated_at, updated_by_kind, updated_by_name, snapshot_leader_id, snapshot_leader_name, snapshot_timothy_id, snapshot_timothy_name, snapshot_host_id, snapshot_host_name, snapshot_cell_type, snapshot_g12_leader_name, snapshot_leader_g12_level, snapshot_leader_is_pastor, cell_meeting_day, cell_meeting_time, cell_street, cell_number, cell_neighborhood";

/** O painel "Ver relatório" já lê a autoria com o relatório (E2.05, T4, AQ-1). */
export type CellReportDetailRow = Pick<
  CellReportViewRow,
  | "id"
  | "date"
  | "time"
  | "theme"
  | "observations"
  | "visitors"
  | "offering"
  | "was_held"
  | "reason_not_held"
  | "cell_leader_name"
  | "cell_deleted"
  | "created_at"
  | "created_by_kind"
  | "created_by_name"
  | "updated_at"
  | "updated_by_kind"
  | "updated_by_name"
  | "snapshot_leader_id"
  | "snapshot_leader_name"
  | "snapshot_timothy_id"
  | "snapshot_timothy_name"
  | "snapshot_host_id"
  | "snapshot_host_name"
  | "snapshot_cell_type"
  | "snapshot_g12_leader_name"
  | "snapshot_leader_g12_level"
  | "snapshot_leader_is_pastor"
  | "cell_meeting_day"
  | "cell_meeting_time"
  | "cell_street"
  | "cell_number"
  | "cell_neighborhood"
>;

/** O relatório e todos os participantes dele, inclusive os excluídos (RN-13), na ordem do nome e do id. */
export interface CellReportDetail {
  report: CellReportDetailRow;
  participants: ReportParticipant[];
}

export type ReportCellParts = Pick<
  CellReportViewRow,
  "cell_id" | "cell_street" | "cell_number" | "cell_complement" | "cell_neighborhood"
>;

/** O endereço atual da célula do relatório no formato dos rótulos de célula. */
export function cellOfReport(report: ReportCellParts): StreetLineParts & { id: string | null; neighborhood: string | null } {
  return {
    id: report.cell_id,
    street: report.cell_street,
    number: report.cell_number,
    complement: report.cell_complement,
    neighborhood: report.cell_neighborhood,
  };
}
