// O que a tela faz ao restaurar um membro, uma célula ou um relatório (E2.01,
// T5, T6, RN-15 a RN-17): a classificação da resposta das RPCs `restore_*`,
// os textos da confirmação e do resultado do membro e os bloqueios, os
// antecipados pela lista (AQ-3) e os do servidor.
import {
  gateCode,
  isJsonObject,
  isNetworkError,
  isPermissionDenied,
  parseAppError,
  type AppError,
  type GateCode,
  type JsonObject,
} from "@/lib/errors";
import { CELL_ROLE_LABELS } from "@/lib/cells/roles";
import { withSearchParam } from "@/lib/navigation";
import type { DeletionErrorCode } from "./codes";
import { cellPeople, personName, type DeletedCellReportRow, type DeletedCellRow, type DeletedMemberRow } from "./deleted-lists";
import { CELL_REPORT_RESTORE_TEXTS, CELL_RESTORE_TEXTS, MEMBER_RESTORE_TEXTS } from "./texts";

/** Recusas que dizem que o registro já não está na lista: não está excluído, ou não existe para quem restaura (DA-4). */
const STALE_CODES: ReadonlySet<string> = new Set<DeletionErrorCode>(["not_deleted", "not_found"]);
const PERSON_DELETED: DeletionErrorCode = "restore_person_deleted";
const WEEK_TAKEN: DeletionErrorCode = "restore_week_taken";

export type RestoreFailure =
  /** Portão da senha (E2.03, AQ-3): sem toast; o portão leva à troca ou ao login. */
  | { kind: "gate"; code: GateCode }
  /** Não está mais excluído (ou sumiu): toast informativo, e a lista recarrega (UX-24). */
  | { kind: "stale"; message: string }
  /** Recusa de regra (RN-16 b e e, RN-17): o diálogo de bloqueio, com a mensagem (UX-23). */
  | { kind: "refused"; refusal: AppError }
  /** 42501: o toast "Você não tem permissão para esta ação." (UX-39). */
  | { kind: "forbidden" }
  /** Queda de conexão: o toast de conexão, e o botão volta. */
  | { kind: "network" }
  /** Qualquer outra falha: o toast que pede para tentar de novo. */
  | { kind: "unexpected" };

/** Resultado de uma restauração de célula ou de relatório. */
export type RestoreResult = { kind: "done" } | RestoreFailure;

/** Classifica o erro de uma RPC `restore_*`. */
export function classifyRestoreError(error: unknown): RestoreFailure {
  // O portão também vem com 42501: vai antes da recusa de permissão.
  const gate = gateCode(error);
  if (gate) return { kind: "gate", code: gate };
  if (isPermissionDenied(error)) return { kind: "forbidden" };
  const refusal = parseAppError(error);
  if (refusal) {
    return STALE_CODES.has(refusal.code)
      ? { kind: "stale", message: refusal.message }
      : { kind: "refused", refusal };
  }
  if (isNetworkError(error)) return { kind: "network" };
  return { kind: "unexpected" };
}

/**
 * A lista recarrega depois de restaurar, de saber que o registro já não está
 * excluído e de uma recusa (que pode vir de uma mudança que a lista ainda não
 * mostra, como outro relatório na mesma semana).
 */
export function refreshesAfterRestore(result: { kind: string }): boolean {
  return result.kind === "done" || result.kind === "stale" || result.kind === "refused";
}

// ---------------------------------------------------------------------------
// Membro (T5)

/** O que `restore_member` devolve, já lido (AQ-7). */
export interface MemberRestoreOutcome {
  restoredWithoutLeader: boolean;
  previousLeaderName: string | null;
  roleResetToDefault: boolean;
  roleName: string | null;
}

/** Resultado de uma restauração de membro: feita, com o que ela mudou, ou a falha classificada. */
export type MemberRestoreResult = { kind: "done"; outcome: MemberRestoreOutcome } | RestoreFailure;

const textOrNull = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Lê a resposta de `restore_member` (uma linha, numa lista). Num formato
 * inesperado, nada a avisar: a restauração valeu.
 */
export function parseMemberRestoreOutcome(data: unknown): MemberRestoreOutcome {
  const row: unknown = Array.isArray(data) ? data[0] : data;
  if (!isJsonObject(row)) {
    return { restoredWithoutLeader: false, previousLeaderName: null, roleResetToDefault: false, roleName: null };
  }
  return {
    restoredWithoutLeader: row.restored_without_leader === true,
    previousLeaderName: textOrNull(row.previous_leader_name),
    roleResetToDefault: row.role_reset_to_default === true,
    roleName: textOrNull(row.role_name),
  };
}

/** O diálogo "Cadastro restaurado" (RN-16 a e d): as mensagens e se o membro precisa de um líder. */
export interface MemberRestoreNotices {
  /** Vazio: nada a avisar, só o toast "Cadastro restaurado.". */
  messages: string[];
  /** Voltou sem líder: "Definir líder" (para quem tem `edit_member`). */
  withoutLeader: boolean;
}

export function memberRestoreNotices(outcome: MemberRestoreOutcome): MemberRestoreNotices {
  const messages: string[] = [];
  if (outcome.restoredWithoutLeader) {
    messages.push(MEMBER_RESTORE_TEXTS.restoredWithoutLeader(personName(outcome.previousLeaderName)));
  }
  if (outcome.roleResetToDefault && outcome.roleName) {
    messages.push(MEMBER_RESTORE_TEXTS.roleResetToDefault(outcome.roleName));
  }
  return { messages, withoutLeader: outcome.restoredWithoutLeader };
}

export type MemberRestoreSource = Pick<
  DeletedMemberRow,
  "restore_role_name" | "has_account" | "leader_name" | "leader_deleted"
>;

/**
 * Os tópicos da confirmação (T5, UX-20): a função com que ele volta, a volta
 * do acesso (só com conta), o cônjuge e, quando a lista já sabe, a volta sem
 * líder.
 */
export function memberRestoreConsequences(member: MemberRestoreSource): string[] {
  const role = member.restore_role_name?.trim();
  const consequences = [role ? MEMBER_RESTORE_TEXTS.backWithRole(role) : MEMBER_RESTORE_TEXTS.backWithoutRole];
  if (member.has_account === true) consequences.push(MEMBER_RESTORE_TEXTS.backWithAccess);
  consequences.push(MEMBER_RESTORE_TEXTS.spouseNotBack);
  if (member.leader_deleted === true) {
    consequences.push(MEMBER_RESTORE_TEXTS.backWithoutLeader(personName(member.leader_name)));
  }
  return consequences;
}

// ---------------------------------------------------------------------------
// Bloqueios (T6, UX-23)

/** A ação que resolve o bloqueio: abre outra lista, já com a busca. */
export type RestoreFix =
  /** "Ver membros excluídos": `/members/deleted?q={Nome}`. */
  | { kind: "deletedMembers"; search: string }
  /** "Ver relatórios da célula": `/cell-reports?q={Líder}`. */
  | { kind: "cellReports"; search: string };

/** O motivo da recusa e a ação que a resolve, quando houver. */
export interface RestoreBlock {
  message: string;
  fix: RestoreFix | null;
}

export function restoreFixPath(fix: RestoreFix): string {
  return fix.kind === "deletedMembers"
    ? withSearchParam("/members/deleted", fix.search)
    : withSearchParam("/cell-reports", fix.search);
}

export function restoreFixLabel(fix: RestoreFix): string {
  return fix.kind === "deletedMembers" ? CELL_RESTORE_TEXTS.seeDeletedMembers : CELL_REPORT_RESTORE_TEXTS.seeCellReports;
}

const cellReportsFix = (leaderName: string | null | undefined): RestoreFix | null => {
  const search = leaderName?.trim();
  return search ? { kind: "cellReports", search } : null;
};

/**
 * Célula com líder, timóteo ou anfitrião excluído: a recusa que o servidor
 * daria (RN-17), sem chamar o servidor. Cita a primeira pessoa, na ordem
 * líder, timóteo, anfitrião (DA-5). `null` se ninguém foi excluído.
 */
export function cellRestoreBlock(cell: DeletedCellRow): RestoreBlock | null {
  const person = cellPeople(cell).find((p) => p.deleted);
  if (!person) return null;
  return {
    message: CELL_RESTORE_TEXTS.personDeleted(CELL_ROLE_LABELS[person.role].toLocaleLowerCase("pt-BR"), person.name),
    fix: { kind: "deletedMembers", search: person.name },
  };
}

/**
 * Relatório cuja célula já tem outro relatório na mesma semana: a recusa que
 * o servidor daria (RN-17), sem chamar o servidor. `null` se a semana está livre.
 */
export function cellReportRestoreBlock(report: DeletedCellReportRow): RestoreBlock | null {
  if (report.week_taken !== true) return null;
  return { message: CELL_REPORT_RESTORE_TEXTS.weekTaken, fix: cellReportsFix(report.cell_leader_name) };
}

/** O nome da primeira pessoa excluída dos detalhes de `restore_person_deleted`. */
function firstDeletedPersonName(detail: JsonObject): string | null {
  const { people } = detail;
  if (!Array.isArray(people)) return null;
  const first: unknown = people[0];
  if (!isJsonObject(first)) return null;
  const name = textOrNull(first.member_name)?.trim();
  return name || null;
}

/**
 * Uma recusa do servidor na restauração, com a ação que a resolve (T6):
 * "Ver membros excluídos" para a pessoa excluída da célula e "Ver relatórios
 * da célula" para a semana ocupada. As demais só têm "Fechar".
 *
 * @param cellLeaderName o líder da célula do relatório, para a busca em Relatórios.
 */
export function restoreBlockFromRefusal(refusal: AppError, cellLeaderName: string | null = null): RestoreBlock {
  if (refusal.code === PERSON_DELETED) {
    const name = firstDeletedPersonName(refusal.detail);
    return { message: refusal.message, fix: name ? { kind: "deletedMembers", search: name } : null };
  }
  if (refusal.code === WEEK_TAKEN) return { message: refusal.message, fix: cellReportsFix(cellLeaderName) };
  return { message: refusal.message, fix: null };
}
