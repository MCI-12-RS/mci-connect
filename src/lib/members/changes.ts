// O que mudou numa edição de membro (E2.04, RN-17, DT-05, DT-19, DT-24).
//
// "Mudou" é decidido pelo valor lido pela regra de cada campo, como no
// `a0_normalize_member` do banco: espaços, maiúsculas, máscara e o 55 do
// celular não contam. O PATCH leva só o que mudou, e sem mudança nada é
// enviado (DA-9). Assim, um valor antigo fora do formato que a pessoa não
// mexeu nunca é regravado nem conferido.

import {
  MINISTRY_MEMBER_FIELDS,
  PERSONAL_MEMBER_FIELDS,
  SENSITIVE_MEMBER_FIELDS,
  toMemberWritePayload,
  type MemberFormValues,
  type MemberWrite,
  type MemberWriteOptions,
} from "./fields";
import { normalizeDigits, normalizeEmail, normalizeMobile } from "./identifiers";
import { normalizePersonName } from "./name";

const WRITABLE_FIELDS = [...PERSONAL_MEMBER_FIELDS, ...SENSITIVE_MEMBER_FIELDS, ...MINISTRY_MEMBER_FIELDS, "role_id"] as const;

/** Um campo gravável de `members` pelo formulário. */
export type MemberWritableField = (typeof WRITABLE_FIELDS)[number];

type FieldValue = string | boolean | null | undefined;

/** Texto livre: sem os espaços das pontas; vazio vira nulo (DT-24). */
function readText(value: string): string | null {
  const text = value.trim();
  return text === "" ? null : text;
}

/**
 * O valor como a regra do campo o lê, para comparar (DT-05):
 * - Nome: `normalizePersonName` (RN-02);
 * - E-mail: `normalizeEmail` (RN-04);
 * - Celular: a forma lida, ou só os dígitos quando ilegível (RN-06, como o `a0_`);
 * - CPF, Telefone e CEP: só os dígitos;
 * - os demais textos: sem os espaços das pontas, vazio como nulo;
 * - interruptores e ids: como estão.
 */
export function readByRule(field: MemberWritableField, value: FieldValue): string | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value;
  switch (field) {
    case "name":
      return normalizePersonName(value);
    case "email":
      return normalizeEmail(value);
    case "mobile_whatsapp":
      return normalizeMobile(value) ?? normalizeDigits(value);
    case "cpf":
    case "phone":
    case "zip_code":
      return normalizeDigits(value);
    default:
      return readText(value);
  }
}

/** O campo mudou em relação ao gravado, lidos os dois pela regra (RN-17)? */
export function memberFieldChanged(field: MemberWritableField, stored: FieldValue, value: FieldValue): boolean {
  return readByRule(field, stored) !== readByRule(field, value);
}

/**
 * O PATCH de uma edição (DT-19): a mesma lista branca de
 * `toMemberWritePayload` (o que quem edita vê e altera), só com os campos que
 * mudaram. Objeto vazio quando nada mudou: a tela não chama o servidor (DA-9).
 *
 * `values` são os valores que vão para o banco: os interruptores já aplicados
 * (`leadership.ts`), com o líder e a data do batismo vazios quando escondidos.
 */
export function changedMemberFields(stored: MemberFormValues, values: MemberFormValues, options: MemberWriteOptions): MemberWrite {
  const payload = toMemberWritePayload(values, options);
  const patch: Record<string, string | boolean | null> = {};
  for (const field of WRITABLE_FIELDS) {
    if (!(field in payload)) continue;
    const value = payload[field];
    if (value !== undefined && memberFieldChanged(field, stored[field], value)) patch[field] = value;
  }
  return patch;
}

/** O PATCH tem alguma mudança? */
export function hasMemberChanges(patch: MemberWrite): boolean {
  return Object.keys(patch).length > 0;
}
