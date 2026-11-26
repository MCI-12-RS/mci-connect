// As recusas de uma gravação de célula e onde cada uma aparece (E2.08,
// "Formato dos erros", AQ-1, T5). Sem React e sem Supabase: a tela só mostra
// o que estas funções decidem. Nenhuma mostra o texto técnico (UX-12).
import { ACCESS_TEXTS } from "@/lib/access/texts";
import { isJsonObject, isPermissionDenied, isRecalcFailure, parseAppError, type AppError } from "@/lib/errors";
import { CELL_RULE_TEXTS } from "./texts";

/** Os campos que mostram erro, na ordem da tela (T1). */
export const CELL_FORM_ERROR_FIELDS = ["leader_id", "timothy_id", "host_id", "type", "meeting_day", "meeting_time"] as const;

export type CellFormErrorField = (typeof CELL_FORM_ERROR_FIELDS)[number];

const ERROR_FIELDS: ReadonlySet<string> = new Set(CELL_FORM_ERROR_FIELDS);

export function isCellFormErrorField(value: unknown): value is CellFormErrorField {
  return typeof value === "string" && ERROR_FIELDS.has(value);
}

/** A célula está inativa e não recebe relatórios (RN-11 c). */
export const CELL_INACTIVE = "cell_inactive";

/** Os códigos deste passo, com o texto do Negócio (o mesmo do banco). */
const RULE_MESSAGES: Readonly<Record<string, string>> = {
  leader_required: CELL_RULE_TEXTS.leaderRequired,
  timothy_required: CELL_RULE_TEXTS.timothyRequired,
  host_required: CELL_RULE_TEXTS.hostRequired,
  cell_type_invalid: CELL_RULE_TEXTS.cellTypeInvalid,
  meeting_day_required: CELL_RULE_TEXTS.meetingDayRequired,
  meeting_day_invalid: CELL_RULE_TEXTS.meetingDayInvalid,
  meeting_time_required: CELL_RULE_TEXTS.meetingTimeRequired,
  meeting_time_invalid: CELL_RULE_TEXTS.meetingTimeInvalid,
  cell_new_inactive: CELL_RULE_TEXTS.newCellInactive,
};

/** Reservas por constraint (23514) e por coluna (23502): o campo e o texto. */
const CHECK_FIELDS: Readonly<Record<string, { field: CellFormErrorField; message: string }>> = {
  cells_type_check: { field: "type", message: CELL_RULE_TEXTS.cellTypeInvalid },
  cells_meeting_day_check: { field: "meeting_day", message: CELL_RULE_TEXTS.meetingDayInvalid },
  cells_meeting_time_check: { field: "meeting_time", message: CELL_RULE_TEXTS.meetingTimeInvalid },
};
const REQUIRED_MESSAGES: Readonly<Record<CellFormErrorField, string>> = {
  leader_id: CELL_RULE_TEXTS.leaderRequired,
  timothy_id: CELL_RULE_TEXTS.timothyRequired,
  host_id: CELL_RULE_TEXTS.hostRequired,
  type: CELL_RULE_TEXTS.cellTypeInvalid,
  meeting_day: CELL_RULE_TEXTS.meetingDayRequired,
  meeting_time: CELL_RULE_TEXTS.meetingTimeRequired,
};

export type CellSaveFailure =
  /** Embaixo do campo, no resumo e com o foco. */
  | { kind: "field"; field: CellFormErrorField; message: string }
  /** No `Alert` do topo, com o foco. `rereadAccess`: a tela relê o acesso (42501, P13). */
  | { kind: "top"; message: string; rereadAccess: boolean }
  /** A célula foi excluída ou saiu do escopo no meio tempo (E2.01): `Alert` do topo com "Fechar". */
  | { kind: "gone" }
  /** 23505 em `cells_pkey` no cadastro: a tentativa anterior já gravou (DT-09). */
  | { kind: "duplicate" }
  /** Falha no recálculo da hierarquia ou transitória (E2.06): "Tente de novo" no rodapé. */
  | { kind: "recalc" }
  /** Rede, 5xx ou erro desconhecido: a mensagem de conexão no rodapé (T6). */
  | { kind: "connection" };

function fromAppError(refusal: AppError): CellSaveFailure {
  if (refusal.code === "not_found_or_deleted") return { kind: "gone" };
  const message = RULE_MESSAGES[refusal.code] ?? refusal.message;
  const { field } = refusal.detail;
  // `cell_new_inactive` aponta `is_active`, que não existe no cadastro: vai para o topo.
  if (isCellFormErrorField(field)) return { kind: "field", field, message };
  return { kind: "top", message, rereadAccess: false };
}

/** O nome entre aspas depois de `marker` na mensagem do Postgres (constraint ou coluna). */
function quotedAfter(message: string, marker: string): string | null {
  const match = new RegExp(`${marker} "([^"]+)"`).exec(message);
  return match ? match[1] : null;
}

/** Classifica a falha de um INSERT ou PATCH em `cells`. */
export function classifyCellSaveError(error: unknown): CellSaveFailure {
  if (isPermissionDenied(error)) return { kind: "top", message: ACCESS_TEXTS.permissionDenied, rereadAccess: true };
  const refusal = parseAppError(error);
  if (refusal) return fromAppError(refusal);
  if (isRecalcFailure(error)) return { kind: "recalc" };
  if (!isJsonObject(error) || typeof error.code !== "string") return { kind: "connection" };
  const message = typeof error.message === "string" ? error.message : "";
  switch (error.code) {
    // O tipo `time` não leu o valor (DA-8): o Horário.
    case "22007":
    case "22008":
      return { kind: "field", field: "meeting_time", message: CELL_RULE_TEXTS.meetingTimeInvalid };
    case "23514": {
      const check = CHECK_FIELDS[quotedAfter(message, "constraint") ?? ""];
      return check ? { kind: "field", ...check } : { kind: "connection" };
    }
    case "23502": {
      const column = quotedAfter(message, "column");
      return isCellFormErrorField(column)
        ? { kind: "field", field: column, message: REQUIRED_MESSAGES[column] }
        : { kind: "connection" };
    }
    case "23505":
      return message.includes("cells_pkey") ? { kind: "duplicate" } : { kind: "connection" };
    default:
      return { kind: "connection" };
  }
}
