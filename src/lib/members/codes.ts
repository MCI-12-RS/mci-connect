// Recusas do servidor na gravação de um membro (E2.04, "Formato dos erros",
// AQ-1): os códigos de regra, os campos que o servidor aponta (`field` e
// `fields`) e as reservas para os erros crus do PostgREST (23505 e 23514).
import { isJsonObject, type AppError } from "@/lib/errors";
import { MEMBER_RULE_TEXTS } from "./texts";

/** SQLSTATE de valor repetido num índice único (`unique_violation`). */
export const UNIQUE_VIOLATION = "23505";

/** SQLSTATE de `CHECK` violado (`check_violation`). */
export const CHECK_VIOLATION = "23514";

/** O código de regra de um dado em uso por outro cadastro (RN-09). */
export const VALUE_IN_USE_CODE = "value_in_use";

/** Os códigos de regra do E2.04, no `code` dos detalhes do `app_error`. */
export const MEMBER_RULE_CODES = [
  "name_invalid",
  "gender_required",
  "birth_date_future",
  "birth_date_too_old",
  "mobile_invalid",
  "email_placeholder",
  "email_invalid",
  "cpf_invalid",
  "identifier_required",
  "spouse_self",
  "pastor_with_leader",
  "leader_required",
  "leader_self",
  "leader_cycle",
  "baptism_date_without_baptism",
  VALUE_IN_USE_CODE,
  "deleted_account_email",
  "attempt_already_used",
  "too_many_ids",
] as const;

export type MemberRuleCode = (typeof MEMBER_RULE_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(MEMBER_RULE_CODES);

/** O código é um dos do E2.04? */
export function isMemberRuleCode(code: string): code is MemberRuleCode {
  return KNOWN_CODES.has(code);
}

/**
 * Os campos do formulário que mostram erros e avisos, na ordem da tela (T1):
 * o primeiro com erro recebe o foco. `identification` é o grupo de Celular,
 * E-mail e CPF (RN-08).
 */
export const MEMBER_FIELDS = [
  "name",
  "gender",
  "birth_date",
  "identification",
  "mobile_whatsapp",
  "email",
  "cpf",
  "spouse_id",
  "is_pastor",
  "leader_id",
  "baptism_date",
] as const;

export type MemberField = (typeof MEMBER_FIELDS)[number];

/** Os campos de `value_in_use`, no vocabulário do banco (`fields`). */
export type ValueInUseField = "email" | "mobile" | "cpf";

/** Mensagem de `value_in_use` pelo campo, igual à do banco. */
export const VALUE_IN_USE_MESSAGES: Readonly<Record<ValueInUseField, string>> = MEMBER_RULE_TEXTS.valueInUse;

// O vocabulário do servidor → o campo da tela. `mobile` (de `value_in_use`) e
// `mobile_whatsapp` vão para o Celular; `identification`, para o grupo.
const SERVER_FIELD_TO_MEMBER_FIELD: ReadonlyMap<string, MemberField> = new Map<string, MemberField>([
  ["name", "name"],
  ["gender", "gender"],
  ["birth_date", "birth_date"],
  ["identification", "identification"],
  ["mobile", "mobile_whatsapp"],
  ["mobile_whatsapp", "mobile_whatsapp"],
  ["email", "email"],
  ["cpf", "cpf"],
  ["spouse_id", "spouse_id"],
  ["is_pastor", "is_pastor"],
  ["leader_id", "leader_id"],
  ["baptism_date", "baptism_date"],
]);

function toMemberField(value: unknown): MemberField | null {
  return typeof value === "string" ? (SERVER_FIELD_TO_MEMBER_FIELD.get(value) ?? null) : null;
}

/**
 * Os campos da tela em que a recusa aparece, na ordem da tela, sem repetir:
 * - `value_in_use` cita um ou mais (`fields`), e cada um recebe a própria mensagem;
 * - `identifier_required` aponta o grupo (`field: "identification"`);
 * - as demais apontam um campo (`field`).
 * Vazio quando o servidor não aponta um campo conhecido: a recusa vai para o `Alert` do topo.
 */
export function memberRefusalFields(error: AppError): MemberField[] {
  const raw: unknown[] = [error.detail.field];
  if (error.code === VALUE_IN_USE_CODE && Array.isArray(error.detail.fields)) raw.push(...error.detail.fields);
  const fields = new Set(raw.map(toMemberField).filter((field): field is MemberField => field !== null));
  return MEMBER_FIELDS.filter((field) => fields.has(field));
}

function isValueInUseField(value: unknown): value is ValueInUseField {
  return value === "email" || value === "mobile" || value === "cpf";
}

/**
 * As mensagens de uma recusa por campo da tela. Em `value_in_use`, cada campo
 * recebe a sua ("Este e-mail…", "Este celular…", "Este CPF…"); nas demais, o
 * campo recebe a mensagem que veio.
 */
export function memberRefusalMessages(error: AppError): Partial<Record<MemberField, string>> {
  const messages: Partial<Record<MemberField, string>> = {};
  if (error.code === VALUE_IN_USE_CODE && Array.isArray(error.detail.fields)) {
    for (const field of error.detail.fields) {
      const memberField = toMemberField(field);
      if (memberField && isValueInUseField(field)) messages[memberField] = VALUE_IN_USE_MESSAGES[field];
    }
    if (Object.keys(messages).length > 0) return messages;
  }
  for (const field of memberRefusalFields(error)) messages[field] = error.message;
  return messages;
}

/** Índice único de `members` → campo (reserva do "Formato dos erros"). */
const UNIQUE_INDEX_FIELDS: ReadonlyArray<readonly [string, ValueInUseField]> = [
  ["members_email_key", "email"],
  ["members_mobile_key", "mobile"],
  ["members_cpf_key", "cpf"],
];

/**
 * Lê um `23505` cru do PostgREST, que escapou do trigger (corrida sem trava):
 * o nome do índice no `message` dá o campo. Devolve a mesma recusa que o
 * banco daria (`value_in_use`), sem o texto técnico. `null` para qualquer
 * outro erro ou índice.
 */
export function valueInUseFromUniqueViolation(error: unknown): AppError | null {
  if (!isJsonObject(error) || error.code !== UNIQUE_VIOLATION || typeof error.message !== "string") return null;
  const { message } = error;
  const match = UNIQUE_INDEX_FIELDS.find(([index]) => message.includes(index));
  if (!match) return null;
  const field = match[1];
  return {
    code: VALUE_IN_USE_CODE,
    message: VALUE_IN_USE_MESSAGES[field],
    detail: { code: VALUE_IN_USE_CODE, fields: [field] },
  };
}

/**
 * `CHECK` de `members` → a recusa que o trigger daria. O trigger confere antes,
 * então o `CHECK` é só reserva. `members_leadership_check` (RN-11) vira
 * `leader_required`: pela tela, o pastor nunca tem o Líder à vista, e o caso
 * que sobra é "Tem Liderança?" sem líder.
 */
const CHECK_REFUSALS: ReadonlyArray<readonly [string, MemberRuleCode, MemberField, string]> = [
  ["members_email_not_placeholder_check", "email_placeholder", "email", MEMBER_RULE_TEXTS.emailPlaceholder],
  ["members_email_check", "email_invalid", "email", MEMBER_RULE_TEXTS.emailInvalid],
  ["members_cpf_check", "cpf_invalid", "cpf", MEMBER_RULE_TEXTS.cpfInvalid],
  ["members_leadership_check", "leader_required", "leader_id", MEMBER_RULE_TEXTS.leaderRequired],
  ["members_leader_not_self_check", "leader_self", "leader_id", MEMBER_RULE_TEXTS.leaderSelf],
  ["members_spouse_not_self_check", "spouse_self", "spouse_id", MEMBER_RULE_TEXTS.spouseSelf],
  ["members_baptism_check", "baptism_date_without_baptism", "baptism_date", MEMBER_RULE_TEXTS.baptismDateWithoutBaptism],
];

/**
 * Lê um `23514` cru do PostgREST: o nome do `CHECK` no `message` dá o campo e
 * a recusa, sem o texto técnico (UX-30). `null` para qualquer outro erro.
 */
export function memberRefusalFromCheckViolation(error: unknown): AppError | null {
  if (!isJsonObject(error) || error.code !== CHECK_VIOLATION || typeof error.message !== "string") return null;
  const { message } = error;
  const match = CHECK_REFUSALS.find(([constraint]) => message.includes(`"${constraint}"`));
  if (!match) return null;
  const [, code, field, text] = match;
  return { code, message: text, detail: { code, field } };
}
