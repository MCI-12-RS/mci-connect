// Listas de excluídos (E2.01, T4 e P7, AQ-3): as colunas lidas das views de
// excluídos e o que cada card e cada linha mostram.
import type { Database } from "@/integrations/supabase/types";
import { formatDateTimeInBrasilia } from "@/lib/format";
import { formatMeetingTime } from "@/lib/cells/labels";
import { CELL_ROLES, type CellRole } from "@/lib/cells/roles";
import { formatReportDate } from "@/lib/cell-reports/labels";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import { DELETED_LIST_TEXTS } from "./texts";

type Views = Database["public"]["Views"];

// As views são `security_barrier`: toda coluna pedida é calculada para todas
// as linhas antes do LIMIT. Por isso as páginas não pedem `search_text` (só
// filtram por ela) nem o que a tela não mostra.
// Uma string literal só por select: o supabase-js deriva o tipo do resultado dela.

/** Membros excluídos: identificação, líder, situação e o que a confirmação da restauração mostra (T5). */
export const DELETED_MEMBER_SELECT =
  "id, name, is_active, leader_name, leader_deleted, restore_role_name, has_account, deleted_at, deleted_by_name";

export type DeletedMemberRow = Pick<
  Views["members_deleted_view"]["Row"],
  | "id"
  | "name"
  | "is_active"
  | "leader_name"
  | "leader_deleted"
  | "restore_role_name"
  | "has_account"
  | "deleted_at"
  | "deleted_by_name"
>;

/**
 * Células excluídas: dia, horário, tipo, bairro e as pessoas da célula, com
 * quem foi excluído (RN-17). Os ids dizem quando o timóteo ou o anfitrião é o
 * próprio líder.
 */
export const DELETED_CELL_SELECT =
  "id, type, meeting_day, meeting_time, neighborhood, leader_id, leader_name, leader_deleted, timothy_id, timothy_name, timothy_deleted, host_id, host_name, host_deleted, deleted_at, deleted_by_name";

export type DeletedCellRow = Pick<
  Views["cells_deleted_view"]["Row"],
  | "id"
  | "type"
  | "meeting_day"
  | "meeting_time"
  | "neighborhood"
  | "leader_id"
  | "leader_name"
  | "leader_deleted"
  | "timothy_id"
  | "timothy_name"
  | "timothy_deleted"
  | "host_id"
  | "host_name"
  | "host_deleted"
  | "deleted_at"
  | "deleted_by_name"
>;

/** Relatórios excluídos: data, situação, tema, a célula e se a semana já tem outro relatório (RN-17). */
export const DELETED_CELL_REPORT_SELECT =
  "id, date, time, was_held, theme, cell_leader_name, cell_deleted, week_taken, deleted_at, deleted_by_name";

export type DeletedCellReportRow = Pick<
  Views["cell_reports_deleted_view"]["Row"],
  | "id"
  | "date"
  | "time"
  | "was_held"
  | "theme"
  | "cell_leader_name"
  | "cell_deleted"
  | "week_taken"
  | "deleted_at"
  | "deleted_by_name"
>;

/** Quando e por quem o registro foi excluído, nos textos do card e da tabela. */
export interface DeletionInfo {
  /** "Excluído em 10/11/2026 às 14:32" (card). */
  deletedAt: string;
  /** "10/11/2026 14:32" (coluna, no desktop). */
  deletedAtShort: string;
  /** "por Elisa Martins" ou "Autor não registrado" (card). */
  deletedBy: string;
  /** "Elisa Martins" ou "Não registrado" (coluna, no desktop). */
  deletedByShort: string;
}

interface DeletionColumns {
  deleted_at: string | null;
  deleted_by_name: string | null;
}

/**
 * A data e a hora da exclusão, sempre no horário de Brasília (UX-15), e o
 * autor. Sem autor (exclusões vindas do legado), "Autor não registrado".
 *
 * @param deletedAt o texto da entidade: "Excluído em …" ou "Excluída em …".
 */
export function deletionInfo(row: DeletionColumns, deletedAt: (date: string, time: string) => string): DeletionInfo {
  const when = formatDateTimeInBrasilia(row.deleted_at);
  const author = row.deleted_by_name?.trim();
  return {
    deletedAt: when ? deletedAt(when.date, when.time) : "",
    deletedAtShort: when ? DELETED_LIST_TEXTS.deletedAtShort(when.date, when.time) : "",
    deletedBy: author ? DELETED_LIST_TEXTS.deletedBy(author) : DELETED_LIST_TEXTS.authorNotRecorded,
    deletedByShort: author || DELETED_LIST_TEXTS.authorNotRecordedShort,
  };
}

/** O nome, com "(cadastro excluído)" quando a pessoa foi excluída (aviso antecipado, AQ-3). */
export function withDeletedMark(name: string, deleted: boolean): string {
  return deleted ? `${name} ${DELETED_LIST_TEXTS.personDeleted}` : name;
}

/** O nome de uma pessoa nos cards; sem nome, "Membro sem nome". */
export function personName(name: string | null | undefined): string {
  return name?.trim() || UNNAMED_MEMBER_LABEL;
}

/** Uma pessoa da célula excluída, no papel dela. */
export interface CellPerson {
  role: CellRole;
  id: string | null;
  name: string;
  deleted: boolean;
}

/** Líder, timóteo e anfitrião da célula, nessa ordem (a da DA-5). Quem não está na célula fica de fora. */
export function cellPeople(cell: DeletedCellRow): CellPerson[] {
  const byRole: Readonly<Record<CellRole, { id: string | null; name: string | null; deleted: boolean | null }>> = {
    leader: { id: cell.leader_id, name: cell.leader_name, deleted: cell.leader_deleted },
    timothy: { id: cell.timothy_id, name: cell.timothy_name, deleted: cell.timothy_deleted },
    host: { id: cell.host_id, name: cell.host_name, deleted: cell.host_deleted },
  };
  return CELL_ROLES.filter((role) => byRole[role].name !== null || byRole[role].deleted === true).map((role) => ({
    role,
    id: byRole[role].id,
    name: personName(byRole[role].name),
    deleted: byRole[role].deleted === true,
  }));
}

/**
 * O timóteo e o anfitrião excluídos, que o card e a linha mostram com o papel
 * (aviso antecipado, AQ-3). Quem é a mesma pessoa do líder fica de fora: o
 * líder já aparece no título, com a marca "(cadastro excluído)".
 */
export function deletedCellHelpers(cell: DeletedCellRow): CellPerson[] {
  return cellPeople(cell).filter(
    (person) => person.role !== "leader" && person.deleted && (person.id === null || person.id !== cell.leader_id),
  );
}

/** "Quarta · 20:00" (coluna "Dia / Hora"): o que estiver vazio fica de fora. */
export function cellDayTime(cell: Pick<DeletedCellRow, "meeting_day" | "meeting_time">): string {
  return [cell.meeting_day, formatMeetingTime(cell.meeting_time)].filter(Boolean).join(" · ");
}

/** "Quarta · 20:00 · Evangelística" (card): o que estiver vazio fica de fora. */
export function cellScheduleLine(cell: Pick<DeletedCellRow, "meeting_day" | "meeting_time" | "type">): string {
  return [cellDayTime(cell), cell.type].filter(Boolean).join(" · ");
}

/** "Relatório de 19/11/2026 · 20:00" (sem a hora, se ela não veio). */
export function reportTitleLine(report: Pick<DeletedCellReportRow, "date" | "time">): string {
  const title = DELETED_LIST_TEXTS.cellReports.itemTitle(reportDateLabel(report));
  const time = formatMeetingTime(report.time);
  return time ? `${title} · ${time}` : title;
}

/** A data do relatório, "19/11/2026"; vazia se não veio. */
export function reportDateLabel(report: Pick<DeletedCellReportRow, "date">): string {
  return report.date ? formatReportDate(report.date) : "";
}
