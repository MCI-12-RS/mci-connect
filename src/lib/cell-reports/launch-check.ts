// A conferência antes de preencher como estado da tela (E2.11, RN-19, P100,
// T3; `cell_report_launch_check`). Sem React e sem Supabase.
import type { Database } from "@/integrations/supabase/types";
import { cellInactiveReportMessage } from "@/lib/cells/texts";
import { meetingInSentence, toFullTime, type LocalMoment } from "./dates";
import { LAUNCH_CHECK_TEXTS } from "./texts";

/** A linha da conferência; as colunas que o banco devolve nulas (a reunião, o relatório da semana) podem vir nulas. */
export type LaunchCheckRow = {
  [K in keyof Database["public"]["Functions"]["cell_report_launch_check"]["Returns"][number]]:
    | Database["public"]["Functions"]["cell_report_launch_check"]["Returns"][number][K]
    | null;
};

/** O relatório da semana, só para quem o vê (DA-10). */
export interface ExistingReport {
  id: string;
  date: string;
  time: string;
  held: boolean;
  canEdit: boolean;
}

/** As datas do lançamento que vieram do servidor (AQ-1, AQ-6). */
export interface LaunchContext {
  serverNow: string;
  today: string;
  weekStart: string;
  weekEnd: string;
  meeting: LocalMoment;
  allowedDates: string[];
}

/** O aviso no topo antes de preencher (T3). */
export type LaunchNotice =
  | { kind: "already_sent"; report: ExistingReport | null }
  | { kind: "not_yet"; meeting: LocalMoment }
  /** A célula some do seletor e do bloco (T2): excluída, invisível, sem permissão. */
  | { kind: "unavailable"; reason: "inactive" | "deleted" | "not_found" | "not_allowed" | "no_permission" };

export type LaunchCheckState =
  | { kind: "ready"; context: LaunchContext }
  | { kind: "notice"; notice: LaunchNotice; context: LaunchContext | null }
  /** A conferência não respondeu ou veio sem a reunião: os campos aparecem com o aviso (UXD-4). */
  | { kind: "failed" };

function context(row: LaunchCheckRow): LaunchContext | null {
  const time = toFullTime(row.meeting_time);
  if (!row.meeting_date || !time || !row.server_now || !row.today || !row.week_start || !row.week_end) return null;
  return {
    serverNow: row.server_now,
    today: row.today,
    weekStart: row.week_start,
    weekEnd: row.week_end,
    meeting: `${row.meeting_date} ${time}`,
    allowedDates: row.allowed_dates ?? [],
  };
}

function existing(row: LaunchCheckRow): ExistingReport | null {
  if (!row.existing_report_id || !row.existing_date) return null;
  return {
    id: row.existing_report_id,
    date: row.existing_date,
    time: row.existing_time ?? "",
    held: row.existing_was_held !== false,
    canEdit: row.existing_can_edit === true,
  };
}

/** A resposta da conferência como estado da tela, na precedência da RN-19. */
export function toLaunchCheckState(row: LaunchCheckRow | null | undefined): LaunchCheckState {
  if (!row) return { kind: "failed" };
  const ctx = context(row);
  switch (row.status) {
    case "can_submit":
      return ctx ? { kind: "ready", context: ctx } : { kind: "failed" };
    case "already_sent":
      return { kind: "notice", notice: { kind: "already_sent", report: existing(row) }, context: ctx };
    case "not_yet":
      return ctx ? { kind: "notice", notice: { kind: "not_yet", meeting: ctx.meeting }, context: ctx } : { kind: "failed" };
    case "cell_inactive":
      return { kind: "notice", notice: { kind: "unavailable", reason: "inactive" }, context: ctx };
    case "cell_deleted":
      return { kind: "notice", notice: { kind: "unavailable", reason: "deleted" }, context: ctx };
    case "not_found":
      return { kind: "notice", notice: { kind: "unavailable", reason: "not_found" }, context: ctx };
    case "not_allowed":
      return { kind: "notice", notice: { kind: "unavailable", reason: "not_allowed" }, context: ctx };
    case "no_permission":
      return { kind: "notice", notice: { kind: "unavailable", reason: "no_permission" }, context: ctx };
    default:
      return { kind: "failed" };
  }
}

/** O aviso some com o bloco da célula (T2): excluída, invisível ou sem permissão. A inativa mantém o bloco. */
export const noticeHidesCell = (notice: LaunchNotice): boolean => notice.kind === "unavailable" && notice.reason !== "inactive";

/** O aviso desmarca a célula livre (T3 c): inativa, excluída ou que não se vê. */
export const noticeClearsCell = (notice: LaunchNotice): boolean => notice.kind === "unavailable";

/** As linhas do aviso, a primeira em destaque (T3). */
export function launchNoticeLines(notice: LaunchNotice, canEditCell: boolean): string[] {
  switch (notice.kind) {
    case "already_sent":
      return notice.report
        ? [
            LAUNCH_CHECK_TEXTS.weekTaken,
            LAUNCH_CHECK_TEXTS.weekTakenDetail(meetingInSentence(notice.report.date, notice.report.time), notice.report.held),
          ]
        : [LAUNCH_CHECK_TEXTS.weekTaken];
    case "not_yet":
      return [LAUNCH_CHECK_TEXTS.notYet(meetingInSentence(notice.meeting.slice(0, 10), notice.meeting.slice(11, 16)))];
    case "unavailable":
      switch (notice.reason) {
        case "inactive":
          return [cellInactiveReportMessage(canEditCell)];
        case "deleted":
          return [LAUNCH_CHECK_TEXTS.cellDeleted];
        case "not_found":
          return [LAUNCH_CHECK_TEXTS.cellNotFound];
        case "not_allowed":
          return [LAUNCH_CHECK_TEXTS.notAllowed];
        default:
          return [LAUNCH_CHECK_TEXTS.noPermission];
      }
  }
}
