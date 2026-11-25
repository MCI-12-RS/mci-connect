// Códigos das recusas de regra do E2.02 (Solução técnica, "Formato dos erros",
// AQ-5). Chegam no `code` dos detalhes do erro `app_error`, que o
// `parseAppError` do E2.01 já lê. O `not_found_or_deleted` é do E2.01
// (`DELETION_ERROR_CODES`) e não se repete aqui.

import { isPermissionDenied, parseAppError, type AppError } from "@/lib/errors";
import { ACCESS_TEXTS } from "./texts";

export const ACCESS_ERROR_CODES = [
  // Escopo (RN-09, RN-10, RN-13).
  "person_not_visible",
  "pastor_or_no_leadership_requires_church",
  "report_submit_not_allowed",
  "would_leave_scope",
  // Função do membro (RN-11, RN-18, RN-19, RN-21).
  "default_role_not_covered",
  "own_role",
  "role_change_not_allowed",
  "role_not_assignable",
  "own_data_only",
  "last_admin",
  // Tela de Funções (RN-17, RN-19, RN-20; `save_role` e `delete_role`).
  "admin_role_protected",
  "role_is_default",
  "role_default_required",
  "role_in_use",
  "role_name_required",
  "role_name_taken",
  "role_not_found",
  "role_changed",
  "permission_retired",
  "permission_not_covered",
] as const;

export type AccessErrorCode = (typeof ACCESS_ERROR_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(ACCESS_ERROR_CODES);

/** O código é um dos do E2.02? */
export function isAccessErrorCode(code: string): code is AccessErrorCode {
  return KNOWN_CODES.has(code);
}

/** Campos que o servidor aponta em `detail.field` (`person_not_visible` e `pastor_or_no_leadership_requires_church`). */
export const REFUSAL_FIELDS = [
  "leader_id",
  "spouse_id",
  "timothy_id",
  "host_id",
  "member_id",
  "is_pastor",
  "has_leadership",
] as const;

export type RefusalField = (typeof REFUSAL_FIELDS)[number];

const KNOWN_FIELDS: ReadonlySet<string> = new Set(REFUSAL_FIELDS);

function isRefusalField(value: unknown): value is RefusalField {
  return typeof value === "string" && KNOWN_FIELDS.has(value);
}

/**
 * O campo em que a recusa aparece (T11: "embaixo do campo, quando o servidor
 * diz qual"). `null` quando o servidor não diz, e aí a recusa vai para o
 * `Alert` do topo.
 */
export function refusalField(error: AppError): RefusalField | null {
  return isRefusalField(error.detail.field) ? error.detail.field : null;
}

/**
 * O texto de uma recusa do servidor para a tela, sem nada técnico (UX-30):
 * - 42501: "Você não tem permissão para esta ação.";
 * - regra (`app_error`): a mensagem do Negócio, como veio do banco;
 * - qualquer outro erro: `null` (a tela usa o texto de falha dela).
 */
export function refusalMessage(error: unknown): string | null {
  if (isPermissionDenied(error)) return ACCESS_TEXTS.permissionDenied;
  return parseAppError(error)?.message ?? null;
}
