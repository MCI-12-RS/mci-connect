// Colunas da `cells_view` lidas pelo front (E1.08, PR 2).
import type { Database } from "@/integrations/supabase/types";

export type CellViewRow = Database["public"]["Views"]["cells_view"]["Row"];

/**
 * Linha da lista de Células, também usada pelo formulário de célula e como
 * célula inicial do formulário de relatório. Ficam de fora `search_text` (só
 * filtra), `last_report_date`, `meeting_weekday`, `g12_leader_id` e a situação
 * do relatório (só a lista a pede, por `CELL_LIST_SELECT`, E2.09).
 * `leader_is_pastor` e `leader_gender` dão o rótulo do nível do líder
 * ("Pastor", "Pastora") e o G12 "Pastores" (E2.06, RN-11).
 * `can_submit_report` diz se quem consulta pode lançar o relatório da célula
 * (E2.02, RN-13, AQ-4): é a mesma regra da política e do trigger.
 */
// Uma string literal só: o supabase-js deriva o tipo do resultado dela.
export const CELL_ROW_SELECT =
  "id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, street, number, complement, neighborhood, city, state, zip_code, is_active, leader_name, leader_g12_level, leader_is_pastor, leader_gender, timothy_name, host_name, g12_leader_name, can_submit_report";

export type CellRow = Pick<
  CellViewRow,
  | "id"
  | "leader_id"
  | "timothy_id"
  | "host_id"
  | "type"
  | "meeting_day"
  | "meeting_time"
  | "street"
  | "number"
  | "complement"
  | "neighborhood"
  | "city"
  | "state"
  | "zip_code"
  | "is_active"
  | "leader_name"
  | "leader_g12_level"
  | "leader_is_pastor"
  | "leader_gender"
  | "timothy_name"
  | "host_name"
  | "g12_leader_name"
  | "can_submit_report"
>;

/**
 * Linha da lista de Células (E2.09, PR 3): as colunas de `CELL_ROW_SELECT` e a
 * situação do relatório, calculada pelo servidor (`report_status`,
 * `report_missing_weeks`; RN-04, RN-05, AQ-1). Só a lista pede as duas: o
 * formulário de célula e o seletor do relatório não pagam o cálculo.
 */
// Uma string literal só (não concatenada): o supabase-js deriva o tipo do resultado dela.
export const CELL_LIST_SELECT =
  "id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, street, number, complement, neighborhood, city, state, zip_code, is_active, leader_name, leader_g12_level, leader_is_pastor, leader_gender, timothy_name, host_name, g12_leader_name, can_submit_report, report_status, report_missing_weeks";

export type CellListRow = CellRow & Pick<CellViewRow, "report_status" | "report_missing_weeks">;

/**
 * As colunas que o formulário de célula grava, lidas de volta na conferência
 * da nova tentativa de cadastro (DT-09): a célula achada só vale como a mesma
 * se elas forem iguais ao que está sendo enviado.
 */
export const CELL_STORED_SELECT =
  "id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, street, number, complement, neighborhood, city, state, zip_code, is_active";

export type CellStoredRow = Pick<
  CellViewRow,
  | "id"
  | "leader_id"
  | "timothy_id"
  | "host_id"
  | "type"
  | "meeting_day"
  | "meeting_time"
  | "street"
  | "number"
  | "complement"
  | "neighborhood"
  | "city"
  | "state"
  | "zip_code"
  | "is_active"
>;

/** Resumo da célula no formulário de relatório: rótulo, dia e horário sugeridos. */
export const CELL_SUMMARY_SELECT = "id, leader_name, meeting_day, meeting_time, street, number, neighborhood";

export type CellSummary = Pick<
  CellViewRow,
  "id" | "leader_name" | "meeting_day" | "meeting_time" | "street" | "number" | "neighborhood"
>;
