// Colunas da `cell_reports_view` e da `cell_report_participants_view` lidas
// pelo front (E1.08, PR 2).
import type { Database } from "@/integrations/supabase/types";
import type { StreetLineParts } from "@/lib/cells/labels";

export type CellReportViewRow = Database["public"]["Views"]["cell_reports_view"]["Row"];
export type ReportParticipantViewRow = Database["public"]["Views"]["cell_report_participants_view"]["Row"];

/**
 * A linha da lista de Relatórios (E2.12, RN-15), lida pela `cell_reports_list`, que calcula as
 * colunas só para as linhas da página (DT-03). Traz também o que o topo da consulta mostra na hora
 * (T12): as observações, os visitantes, o número de participantes e a reunião atual da célula.
 * Nunca `*`, `search_text` nem `cell_visible` (risco 8).
 */
// Uma string literal só: o supabase-js deriva o tipo do resultado dela.
// O líder da linha é o registrado no relatório, com o G12 atual dele (E2.11, RN-14 d); o endereço é o atual.
export const CELL_REPORT_LIST_SELECT =
  "id, cell_id, date, time, theme, observations, visitors, offering, was_held, reason_not_held, visitors_count, participants_count, snapshot_leader_name, snapshot_g12_leader_name, snapshot_leader_g12_level, snapshot_leader_is_pastor, cell_leader_name, cell_meeting_day, cell_meeting_time, cell_street, cell_number, cell_complement, cell_neighborhood, cell_deleted";

export type CellReportListRow = Pick<
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
  | "participants_count"
  | "snapshot_leader_name"
  | "snapshot_g12_leader_name"
  | "snapshot_leader_g12_level"
  | "snapshot_leader_is_pastor"
  | "cell_leader_name"
  | "cell_meeting_day"
  | "cell_meeting_time"
  | "cell_street"
  | "cell_number"
  | "cell_complement"
  | "cell_neighborhood"
  | "cell_deleted"
>;

/** A linha da lista de Relatórios (o nome antigo, usado pela exclusão). */
export type CellReportRow = CellReportListRow;

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
 * O relatório na consulta "Ver relatório" (E2.12, T10, DT-09): a linha da lista, mais as pessoas
 * registradas e o tipo, o endereço completo atual, se quem consulta vê a célula (DA-9) e a autoria
 * (E2.05, P30). Lida por id, em paralelo com os participantes.
 */
export const CELL_REPORT_DETAIL_SELECT =
  "id, cell_id, date, time, theme, observations, visitors, offering, was_held, reason_not_held, visitors_count, participants_count, snapshot_leader_name, snapshot_g12_leader_name, snapshot_leader_g12_level, snapshot_leader_is_pastor, cell_leader_name, cell_meeting_day, cell_meeting_time, cell_street, cell_number, cell_complement, cell_neighborhood, cell_deleted, snapshot_leader_id, snapshot_timothy_id, snapshot_timothy_name, snapshot_host_id, snapshot_host_name, snapshot_cell_type, cell_city, cell_state, cell_zip_code, cell_visible, created_at, created_by_kind, created_by_name, updated_at, updated_by_kind, updated_by_name";

export type CellReportDetailRow = CellReportListRow &
  Pick<
    CellReportViewRow,
    | "snapshot_leader_id"
    | "snapshot_timothy_id"
    | "snapshot_timothy_name"
    | "snapshot_host_id"
    | "snapshot_host_name"
    | "snapshot_cell_type"
    | "cell_city"
    | "cell_state"
    | "cell_zip_code"
    | "cell_visible"
    | "created_at"
    | "created_by_kind"
    | "created_by_name"
    | "updated_at"
    | "updated_by_kind"
    | "updated_by_name"
  >;
