// Gravação de célula pelo formulário atual (E2.08, PR 2, ajuste mínimo): o
// estado do formulário aceita campos vazios enquanto a pessoa preenche, e a
// gravação só sai com as cinco colunas obrigatórias (RN-02, RN-05, RN-06). A
// regra vale no banco; aqui ela só evita a ida ao servidor. Sem React e sem
// Supabase.
import type { Database } from "@/integrations/supabase/types";
import { DEFAULT_CELL_TYPE } from "./cell-types";
import type { CellRow } from "./fields";
import { CELL_RULE_TEXTS } from "./texts";

type CellInsert = Database["public"]["Tables"]["cells"]["Insert"];

/** Os campos que o formulário grava, sem `id` e sem `is_active` (só na edição). */
export type CellWritePayload = Omit<CellInsert, "id" | "is_active" | "created_at" | "updated_at" | "deleted_at" | "deleted_by">;

export interface CellFormValues {
  leader_id: string | null;
  timothy_id: string | null;
  host_id: string | null;
  type: string;
  meeting_day: string | null;
  meeting_time: string | null;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  is_active: boolean;
}

export type CellRequiredField = "leader_id" | "timothy_id" | "host_id" | "meeting_day" | "meeting_time";

/** Célula nova: sem pessoas, sem dia e sem horário (P-CEL-02); o tipo padrão (P-CEL-03); ativa (RN-11). */
export const EMPTY_CELL_FORM: CellFormValues = {
  leader_id: null,
  timothy_id: null,
  host_id: null,
  type: DEFAULT_CELL_TYPE,
  meeting_day: null,
  meeting_time: null,
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  zip_code: "",
  is_active: true,
};

/** O formulário a partir da linha gravada (`cells_view`), sem inventar valores. */
export function cellFormFromRow(row: CellRow): CellFormValues {
  return {
    leader_id: row.leader_id ?? null,
    timothy_id: row.timothy_id ?? null,
    host_id: row.host_id ?? null,
    type: row.type ?? DEFAULT_CELL_TYPE,
    meeting_day: row.meeting_day ?? null,
    meeting_time: row.meeting_time ?? null,
    street: row.street ?? "",
    number: row.number ?? "",
    complement: row.complement ?? "",
    neighborhood: row.neighborhood ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip_code: row.zip_code ?? "",
    is_active: row.is_active !== false,
  };
}

const filled = (value: string | null | undefined): value is string => !!value && value.trim() !== "";

export type CellWriteResult =
  | { ok: true; payload: CellWritePayload }
  | { ok: false; field: CellRequiredField; message: string };

/**
 * A gravação, ou o primeiro campo obrigatório vazio, na ordem da tela (RN-14):
 * líder, timóteo, anfitrião, dia e horário.
 */
export function buildCellWrite(values: CellFormValues): CellWriteResult {
  const { leader_id, timothy_id, host_id, meeting_day, meeting_time } = values;
  if (!filled(leader_id)) return { ok: false, field: "leader_id", message: CELL_RULE_TEXTS.leaderRequired };
  if (!filled(timothy_id)) return { ok: false, field: "timothy_id", message: CELL_RULE_TEXTS.timothyRequired };
  if (!filled(host_id)) return { ok: false, field: "host_id", message: CELL_RULE_TEXTS.hostRequired };
  if (!filled(meeting_day)) return { ok: false, field: "meeting_day", message: CELL_RULE_TEXTS.meetingDayRequired };
  if (!filled(meeting_time)) return { ok: false, field: "meeting_time", message: CELL_RULE_TEXTS.meetingTimeRequired };
  return {
    ok: true,
    payload: {
      leader_id,
      timothy_id,
      host_id,
      type: values.type,
      meeting_day,
      meeting_time,
      street: values.street,
      number: values.number,
      complement: values.complement,
      neighborhood: values.neighborhood,
      city: values.city,
      state: values.state,
      zip_code: values.zip_code,
    },
  };
}
