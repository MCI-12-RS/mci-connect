// O que mudou no formulário de célula (E2.08, T6; E2.05): a edição manda só o
// que mudou, e sem mudança nada vai ao servidor. Sem React e sem Supabase.
import { cepDigits } from "@/lib/address/cep";
import { CELL_ADDRESS_COLUMNS, meetingTimeToWrite, optionalText, type CellFormValues, type CellUpdate } from "./write";

/** O PATCH só com as colunas que mudaram. */
export type CellPatch = Pick<
  CellUpdate,
  | "leader_id"
  | "timothy_id"
  | "host_id"
  | "type"
  | "meeting_day"
  | "meeting_time"
  | "zip_code"
  | "street"
  | "number"
  | "complement"
  | "neighborhood"
  | "city"
  | "state"
  | "is_active"
>;

const PEOPLE_AND_MEETING = ["leader_id", "timothy_id", "host_id", "type", "meeting_day"] as const;

/**
 * As colunas que mudaram entre o gravado (`stored`, a abertura) e o formulário:
 * - o horário é comparado sem os segundos ("20:00:00" gravado e "20:00" no campo não mudam);
 * - o endereço, aparado, e o CEP, pelos dígitos;
 * - o vazio e o nulo são iguais.
 */
export function changedCellFields(stored: CellFormValues, current: CellFormValues): CellPatch {
  const patch: CellPatch = {};
  for (const column of PEOPLE_AND_MEETING) {
    const value = current[column];
    if ((value ?? "") !== (stored[column] ?? "") && value) patch[column] = value;
  }
  const time = meetingTimeToWrite(current.meeting_time);
  if (time !== meetingTimeToWrite(stored.meeting_time)) patch.meeting_time = time;
  for (const column of CELL_ADDRESS_COLUMNS) {
    const before = column === "zip_code" ? cepDigits(stored[column]) : (optionalText(stored[column]) ?? "");
    const after = column === "zip_code" ? cepDigits(current[column]) : (optionalText(current[column]) ?? "");
    if (before !== after) patch[column] = optionalText(current[column]);
  }
  if (current.is_active !== stored.is_active) patch.is_active = current.is_active;
  return patch;
}

/** Algo mudou: fechar pede "Descartar as alterações?" (UX-25). */
export function isCellFormDirty(stored: CellFormValues, current: CellFormValues): boolean {
  return Object.keys(changedCellFields(stored, current)).length > 0;
}
