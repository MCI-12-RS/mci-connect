// Campos de membro por grupo (E1.08, RN-11 e RN-12).
//
// SENSITIVE_MEMBER_FIELDS espelha a máscara da `members_view` e a regra 6 de
// `enforce_member_write_rules` (migration 20261115120000_e108_read_foundation).
// Mudou aqui, mude lá.
import type { Database } from "@/integrations/supabase/types";

export type MemberViewRow = Database["public"]["Views"]["members_view"]["Row"];
export type MemberWrite = Database["public"]["Tables"]["members"]["Update"];

/** Rótulo de um membro cujo nome não veio do banco (seletores e participantes). */
export const UNNAMED_MEMBER_LABEL = "Membro sem nome";

/**
 * Colunas da `members_view` usadas nas telas de membro (lista, formulário e o
 * próprio cadastro no AuthContext). Ficam de fora as colunas de vínculo
 * celular e de busca, que custam uma subconsulta por linha, e a `role_id`: a
 * função vem de `my_access` (a própria) e de `role_options` (a de outra
 * pessoa), nunca da linha do membro (E2.02, RN-23). `leader_name` e
 * `spouse_name` são os nomes salvos dos seletores (DT-23). `g12_name` é o G12
 * do membro, nome de referência da Liderança (E2.06, RN-10).
 *
 * A `role_id` é uma coluna mascarada à parte, ligada a "Atribuir Função" e
 * "Gerenciar Funções" (não a "Ver Dados Sensíveis"): desde o E2.02 (PR 6) o
 * banco também a esconde, sem SELECT na tabela e nula na `members_view` para
 * quem não atribui funções, a não ser no próprio cadastro. Por isso ela não
 * entra em SENSITIVE_MEMBER_FIELDS. A gravação continua (`toMemberWritePayload`
 * com `includeRole`), sem lê-la de volta.
 *
 * A `password_reset_status` (E2.03) também fica de fora: chama funções de
 * escopo por linha e só a tela de redefinição de senha a usa.
 */
// Uma string literal só: o supabase-js deriva o tipo do resultado dela.
export const MEMBER_ROW_SELECT =
  "id, name, gender, birth_date, instagram, avatar_url, notes, neighborhood, city, state, is_pastor, has_leadership, leader_id, leader_name, spouse_id, spouse_name, is_baptized, baptism_date, is_active, g12_level, g12_name, total_disciples, total_cells, auth_user_id, sensitive_visible, email, cpf, mobile_whatsapp, phone, street, number, complement, zip_code";

export type MemberRow = Omit<
  MemberViewRow,
  | "is_cell_leader"
  | "is_cell_timothy"
  | "is_cell_host"
  | "attended_last_30_days"
  | "search_text"
  | "male_cells"
  | "female_cells"
  | "role_id"
  | "created_at"
  | "updated_at"
  | "g12_id"
  | "password_reset_status"
>;

/**
 * Endereço de um membro na `members_view` (o formulário de célula copia o do
 * anfitrião). Rua, número, complemento e CEP vêm nulos sem `sensitive_visible`.
 */
export const MEMBER_ADDRESS_SELECT = "street, number, complement, neighborhood, city, state, zip_code, sensitive_visible";

export type MemberAddress = Pick<
  MemberViewRow,
  "street" | "number" | "complement" | "neighborhood" | "city" | "state" | "zip_code" | "sensitive_visible"
>;

/** Só saem do banco para o próprio membro e para quem tem view_sensitive_data. */
export const SENSITIVE_MEMBER_FIELDS = [
  "email",
  "cpf",
  "mobile_whatsapp",
  "phone",
  "street",
  "number",
  "complement",
  "zip_code",
] as const;

/** Dados pessoais que qualquer editor do cadastro altera. Bairro, cidade e UF não são sensíveis (D-2). */
export const PERSONAL_MEMBER_FIELDS = [
  "name",
  "gender",
  "birth_date",
  "instagram",
  "avatar_url",
  "notes",
  "neighborhood",
  "city",
  "state",
] as const;

/** Dados ministeriais: só com edit_member (regra 5 do E1.03). */
export const MINISTRY_MEMBER_FIELDS = [
  "is_pastor",
  "has_leadership",
  "leader_id",
  "spouse_id",
  "is_baptized",
  "baptism_date",
  "is_active",
] as const;

// Gravados só com dígitos.
const DIGITS_ONLY_FIELDS = new Set<string>(["cpf", "mobile_whatsapp", "phone", "zip_code"]);

type WritableField =
  | (typeof SENSITIVE_MEMBER_FIELDS)[number]
  | (typeof PERSONAL_MEMBER_FIELDS)[number]
  | (typeof MINISTRY_MEMBER_FIELDS)[number]
  | "role_id";

export type MemberFormValues = Partial<Record<WritableField, string | boolean | null | undefined>>;

export interface MemberWriteOptions {
  /** O usuário vê (e portanto edita) os dados sensíveis deste membro. */
  sensitiveVisible: boolean;
  /** O usuário edita os dados ministeriais (edit_member). */
  canEditMinistry: boolean;
  /** A função (role_id) vai junto: no cadastro e para quem pode atribuí-la. */
  includeRole: boolean;
}

function clean(field: string, value: string | boolean | null | undefined): string | boolean | null | undefined {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  return DIGITS_ONLY_FIELDS.has(field) ? trimmed.replace(/\D/g, "") || null : trimmed;
}

/**
 * Monta o corpo do INSERT/UPDATE de `members` com lista branca: só vão os
 * campos que o usuário pode ver e editar; texto vazio vira `null`; CPF,
 * telefones e CEP vão só com dígitos. Campos `undefined` ficam de fora (não
 * mudam no banco).
 */
export function toMemberWritePayload(form: MemberFormValues, options: MemberWriteOptions): MemberWrite {
  const fields: WritableField[] = [...PERSONAL_MEMBER_FIELDS];
  if (options.sensitiveVisible) fields.push(...SENSITIVE_MEMBER_FIELDS);
  if (options.canEditMinistry) fields.push(...MINISTRY_MEMBER_FIELDS);
  if (options.includeRole) fields.push("role_id");

  const payload: Record<string, string | boolean | null> = {};
  for (const field of fields) {
    const value = clean(field, form[field]);
    if (value !== undefined) payload[field] = value;
  }
  return payload;
}
