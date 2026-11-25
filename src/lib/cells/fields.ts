// Colunas da `cells_view` lidas pelo front (E1.08, PR 2).
import type { Database } from "@/integrations/supabase/types";

export type CellViewRow = Database["public"]["Views"]["cells_view"]["Row"];

/**
 * Linha da lista de Células, também usada pelo formulário de célula e como
 * célula inicial do formulário de relatório. Ficam de fora `search_text` (só
 * filtra), `last_report_date` (E2.09), `meeting_weekday` e `g12_leader_id`.
 * `can_submit_report` diz se quem consulta pode lançar o relatório da célula
 * (E2.02, RN-13, AQ-4): é a mesma regra da política e do trigger.
 */
// Uma string literal só: o supabase-js deriva o tipo do resultado dela.
export const CELL_ROW_SELECT =
  "id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, street, number, complement, neighborhood, city, state, zip_code, is_active, leader_name, leader_g12_level, timothy_name, host_name, g12_leader_name, can_submit_report";

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
  | "timothy_name"
  | "host_name"
  | "g12_leader_name"
  | "can_submit_report"
>;

/** Resumo da célula no formulário de relatório: rótulo, dia e horário sugeridos. */
export const CELL_SUMMARY_SELECT = "id, leader_name, meeting_day, meeting_time, street, number, neighborhood";

export type CellSummary = Pick<
  CellViewRow,
  "id" | "leader_name" | "meeting_day" | "meeting_time" | "street" | "number" | "neighborhood"
>;
