// Códigos das recusas da exclusão e da restauração (E2.01, "Formato dos
// erros"). Chegam no `code` dos detalhes do erro `app_error` (ver
// `parseAppError`) e na pré-checagem da exclusão de membro.

export const DELETION_ERROR_CODES = [
  // Registro inexistente, excluído ou fora do escopo (RN-02, RN-07).
  "not_found_or_deleted",
  // Restauração: registro inexistente ou fora do escopo.
  "not_found",
  // Restauração de um registro que não está excluído (RN-15).
  "not_deleted",
  // Exclusão de membro (RN-03 e RN-04).
  "self_delete",
  "role_above",
  "member_has_links",
  // Restauração de membro (RN-16 b e e).
  "restore_role_above",
  "restore_value_in_use",
  // Cadastro com o e-mail da conta de um excluído (RN-18).
  "deleted_account_email",
  // Membro ou célula excluídos escolhidos (RN-06, RN-11).
  "deleted_member_chosen",
  "cell_deleted",
  "report_cell_deleted",
  // Participantes do relatório (RN-13).
  "deleted_participant_removal",
  "too_many_participants",
  // Restauração de célula e de relatório (RN-17).
  "restore_person_deleted",
  "restore_week_taken",
] as const;

export type DeletionErrorCode = (typeof DELETION_ERROR_CODES)[number];

const KNOWN_CODES: ReadonlySet<string> = new Set(DELETION_ERROR_CODES);

/** O código é um dos da exclusão e da restauração? */
export function isDeletionErrorCode(code: string): code is DeletionErrorCode {
  return KNOWN_CODES.has(code);
}

/** Entidade dos detalhes de `not_found_or_deleted`, `not_found` e `not_deleted`. */
export const DELETION_ENTITIES = ["member", "cell", "cell_report"] as const;

export type DeletionEntity = (typeof DELETION_ENTITIES)[number];
