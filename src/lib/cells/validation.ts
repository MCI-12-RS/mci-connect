// A conferência do formulário de célula (E2.08, RN-02, RN-05, RN-06, RN-07,
// RN-14, P22). A regra vale no banco; aqui ela só evita a ida ao servidor e
// mostra todos os erros de uma vez. Sem React e sem Supabase.
import { isValidHhmm, readHhmmOnBlur } from "@/lib/time/hhmm";
import { isCellType } from "./cell-types";
import type { CellFormErrorField } from "./codes";
import { CELL_RULE_TEXTS } from "./texts";
import { weekdayIndex } from "./weekdays";

export interface CellFormFieldError {
  field: CellFormErrorField;
  code: string;
  message: string;
}

/** Os valores que a conferência lê. */
export interface CellRuleValues {
  leader_id: string | null;
  timothy_id: string | null;
  host_id: string | null;
  type: string;
  meeting_day: string;
  meeting_time: string;
}

const filled = (value: string | null | undefined): value is string => !!value && value.trim() !== "";

/** Só o formato do horário, ao sair do campo alterado e preenchido (P22). */
export function validateMeetingTimeOnBlur(value: string): CellFormFieldError | null {
  if (!filled(value) || isValidHhmm(readHhmmOnBlur(value))) return null;
  return { field: "meeting_time", code: "meeting_time_invalid", message: CELL_RULE_TEXTS.meetingTimeInvalid };
}

/** Todos os erros de preenchimento, na ordem da tela (RN-14). Vazio: pode enviar. */
export function validateCellForm(values: CellRuleValues): CellFormFieldError[] {
  const errors: CellFormFieldError[] = [];
  const require = (field: CellFormErrorField, value: string | null, code: string, message: string) => {
    if (!filled(value)) errors.push({ field, code, message });
  };
  require("leader_id", values.leader_id, "leader_required", CELL_RULE_TEXTS.leaderRequired);
  require("timothy_id", values.timothy_id, "timothy_required", CELL_RULE_TEXTS.timothyRequired);
  require("host_id", values.host_id, "host_required", CELL_RULE_TEXTS.hostRequired);
  if (!isCellType(values.type)) {
    errors.push({ field: "type", code: "cell_type_invalid", message: CELL_RULE_TEXTS.cellTypeInvalid });
  }
  if (!filled(values.meeting_day)) {
    errors.push({ field: "meeting_day", code: "meeting_day_required", message: CELL_RULE_TEXTS.meetingDayRequired });
  } else if (weekdayIndex(values.meeting_day) === null) {
    errors.push({ field: "meeting_day", code: "meeting_day_invalid", message: CELL_RULE_TEXTS.meetingDayInvalid });
  }
  if (!filled(values.meeting_time)) {
    errors.push({ field: "meeting_time", code: "meeting_time_required", message: CELL_RULE_TEXTS.meetingTimeRequired });
  } else {
    const blurError = validateMeetingTimeOnBlur(values.meeting_time);
    if (blurError) errors.push(blurError);
  }
  return errors;
}
