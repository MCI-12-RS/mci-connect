// Os atalhos de semana da lista de Relatórios (E2.12, P90, RN-10, UXD-3 e UXD-4): as três semanas
// vêm prontas da `server_weeks` (data de Brasília pelo relógio do servidor). Nenhuma conta de data
// aqui, e nunca o relógio do aparelho. Sem React e sem Supabase.

import { formatFilterDate } from "@/lib/filters/dates";
import { effectiveReportDates, type CellReportFilters, type WeekRange } from "./filters";
import { CELL_REPORT_FILTER_TEXTS } from "./filter-texts";

/** A linha da `server_weeks()`. */
export interface ServerWeeks {
  today: string;
  this_week_start: string;
  this_week_end: string;
  last_week_start: string;
  last_week_end: string;
  week_before_last_start: string;
  week_before_last_end: string;
}

export const WEEK_SHORTCUT_KEYS = ["this", "last", "before_last"] as const;
export type WeekShortcutKey = (typeof WEEK_SHORTCUT_KEYS)[number];

export interface WeekShortcut extends WeekRange {
  key: WeekShortcutKey;
  /** "Esta semana". */
  label: string;
  /** "Esta semana, de 22/11/2026 a 28/11/2026" (começa pelo texto visível, WCAG 2.5.3). */
  spokenLabel: string;
}

const T = CELL_REPORT_FILTER_TEXTS.weeks;

const LABELS = { this: T.this, last: T.last, before_last: T.beforeLast } as const satisfies Record<WeekShortcutKey, string>;

/** Os rótulos, para os atalhos esperando a data do servidor (desabilitados, no mesmo lugar). */
export const WEEK_SHORTCUT_LABELS: readonly { key: WeekShortcutKey; label: string }[] = WEEK_SHORTCUT_KEYS.map((key) => ({
  key,
  label: LABELS[key],
}));

function shortcut(key: WeekShortcutKey, start: string, end: string): WeekShortcut {
  return { key, start, end, label: LABELS[key], spokenLabel: T.spoken(LABELS[key], formatFilterDate(start), formatFilterDate(end)) };
}

/** As três semanas da `server_weeks`, na ordem da tela. */
export function toWeekShortcuts(row: ServerWeeks): WeekShortcut[] {
  return [
    shortcut("this", row.this_week_start, row.this_week_end),
    shortcut("last", row.last_week_start, row.last_week_end),
    shortcut("before_last", row.week_before_last_start, row.week_before_last_end),
  ];
}

/**
 * O atalho marcado: o Período aplicado é exatamente o domingo e o sábado de uma das semanas, venha
 * ele do atalho, das datas digitadas ou de um link (T3). Só "De", só "Até", outra semana ou datas
 * invertidas não marcam nenhum.
 */
export function activeWeekShortcut(
  filters: Pick<CellReportFilters, "from" | "to">,
  shortcuts: readonly WeekShortcut[],
): WeekShortcutKey | null {
  const { from, to } = effectiveReportDates(filters);
  if (!from || !to) return null;
  return shortcuts.find((week) => week.start === from && week.end === to)?.key ?? null;
}
