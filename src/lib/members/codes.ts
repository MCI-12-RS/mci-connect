// Recusas do servidor na gravação de um membro (E2.04, "Formato dos erros").
import { isJsonObject, type AppError } from "@/lib/errors";

/** SQLSTATE de valor repetido num índice único (`unique_violation`). */
export const UNIQUE_VIOLATION = "23505";

/** O código de regra de um dado em uso por outro cadastro (RN-09). */
export const VALUE_IN_USE_CODE = "value_in_use";

/** Os campos de `value_in_use`, no vocabulário do banco (`fields`). */
export type ValueInUseField = "email" | "mobile" | "cpf";

/** Mensagem de `value_in_use` pelo campo, igual à do banco. */
export const VALUE_IN_USE_MESSAGES: Readonly<Record<ValueInUseField, string>> = {
  email: "Este e-mail já está sendo usado por outro cadastro.",
  mobile: "Este celular já está sendo usado por outro cadastro.",
  cpf: "Este CPF já está sendo usado por outro cadastro.",
};

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
