// Os valores do formulário de célula e a gravação do cadastro (E2.08, RN-02,
// RN-05 a RN-07, RN-11; DT-09). A regra vale no banco; aqui ela só monta o que
// vai ao servidor. Sem React e sem Supabase.
import type { Database } from "@/integrations/supabase/types";
import { maskCep } from "@/lib/address/cep";
import { readHhmmOnBlur, toHhmm } from "@/lib/time/hhmm";
import { DEFAULT_CELL_TYPE } from "./cell-types";
import type { CellRow } from "./fields";

export type CellInsert = Database["public"]["Tables"]["cells"]["Insert"];
export type CellUpdate = Database["public"]["Tables"]["cells"]["Update"];

/** O formulário: campos vazios enquanto a pessoa preenche. */
export interface CellFormValues {
  leader_id: string | null;
  timothy_id: string | null;
  host_id: string | null;
  type: string;
  /** O valor da RN-05 ("Quarta"); vazio sem dia escolhido. */
  meeting_day: string;
  /** "HH:mm", como o campo mostra (P62). */
  meeting_time: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zip_code: string;
  is_active: boolean;
}

/** As colunas de endereço, opcionais (RN-09). */
export const CELL_ADDRESS_COLUMNS = ["zip_code", "street", "number", "complement", "neighborhood", "city", "state"] as const;

/** Célula nova: sem pessoas, sem dia e sem horário (P-CEL-02); o tipo padrão (P-CEL-03); ativa (RN-11). */
export const EMPTY_CELL_FORM: CellFormValues = {
  leader_id: null,
  timothy_id: null,
  host_id: null,
  type: DEFAULT_CELL_TYPE,
  meeting_day: "",
  meeting_time: "",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  zip_code: "",
  is_active: true,
};

/** O formulário a partir da linha gravada (`cells_view`), sem inventar valores; o horário sem segundos. */
export function cellFormFromRow(row: CellRow): CellFormValues {
  return {
    leader_id: row.leader_id ?? null,
    timothy_id: row.timothy_id ?? null,
    host_id: row.host_id ?? null,
    type: row.type ?? DEFAULT_CELL_TYPE,
    meeting_day: row.meeting_day ?? "",
    meeting_time: toHhmm(row.meeting_time),
    street: row.street ?? "",
    number: row.number ?? "",
    complement: row.complement ?? "",
    neighborhood: row.neighborhood ?? "",
    city: row.city ?? "",
    state: row.state ?? "",
    zip_code: maskCep(row.zip_code ?? ""),
    is_active: row.is_active !== false,
  };
}

/** O texto opcional como vai ao banco: aparado, e vazio vira nulo. */
export function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** O horário como vai ao banco: o lido ao sair do campo ("20" → "20:00"). */
export function meetingTimeToWrite(value: string): string {
  return readHhmmOnBlur(value);
}

/**
 * O cadastro novo, com o `id` gerado ao abrir o formulário (DT-09). Sem
 * `is_active`: a célula nova sempre começa ativa (RN-11). Só chamar depois de
 * `validateCellForm` sem erros.
 */
export function toCellInsert(values: CellFormValues, id: string): CellInsert {
  return {
    id,
    leader_id: values.leader_id ?? "",
    timothy_id: values.timothy_id ?? "",
    host_id: values.host_id ?? "",
    type: values.type,
    meeting_day: values.meeting_day,
    meeting_time: meetingTimeToWrite(values.meeting_time),
    zip_code: optionalText(values.zip_code),
    street: optionalText(values.street),
    number: optionalText(values.number),
    complement: optionalText(values.complement),
    neighborhood: optionalText(values.neighborhood),
    city: optionalText(values.city),
    state: optionalText(values.state),
  };
}
