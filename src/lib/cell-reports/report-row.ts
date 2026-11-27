// A linha da lista de Relatórios (E2.12, RN-15, T1, T2, UXD-6 e UXD-15): o que o cartão e a tabela
// mostram de um relatório. Sem React e sem Supabase.

import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { weekdayOfDate } from "@/lib/cells/detail";
import { formatMeetingTime } from "@/lib/cells/labels";
import { WEEKDAY_ABBREVIATIONS, WEEKDAYS, type Weekday } from "@/lib/cells/weekdays";
import { leaderLabel } from "@/lib/deletion/targets";
import type { CellReportListRow } from "./fields";
import { formatOffering } from "./labels";
import { cellAddress, reportLeaderLines } from "./snapshot";
import { REPORT_ROW_TEXTS as TEXTS } from "./filter-texts";

export interface ReportRowDate {
  /** "Qua" (`aria-hidden`). */
  dayShort: string;
  /** "Quarta" (`sr-only`). */
  dayFull: string;
  /** "18/11/2026". */
  date: string;
  /** "20:00", ou vazio. */
  time: string;
}

export interface ReportRowView {
  id: string;
  /** O líder registrado no relatório (RN-15), sem o nível. */
  leader: string;
  /** "Pedro Alves", "Pastores" ou "—" (lido como "nenhum"). */
  g12: { text: string; none: boolean };
  date: ReportRowDate;
  /** "Rua das Flores, 100 · Centro" ("s/n" sem número); `null` é "Sem endereço". */
  address: string | null;
  held: boolean;
  cellDeleted: boolean;
  /** "Tema: …" na célula realizada ou "Motivo: …" em "Não houve célula"; `null` sem texto. */
  text: { label: string; value: string } | null;
  /** Só na célula realizada (P-LRE-34). */
  numbers: { participants: number; visitors: number; offering: string } | null;
  /** "Editar": com "Editar Relatórios de Células" e a célula não excluída (RN-11 do E2.01). */
  canEdit: boolean;
  /** "Ver o relatório de 18/11/2026, André Souza" (P91). */
  openLabel: string;
}

const isWeekday = (value: string): value is Weekday => WEEKDAYS.some((day) => day === value);

/**
 * A data com o dia abreviado (UXD-15): o dia da semana da própria data, que já é a de Brasília
 * (`date`, sem fuso): nada é convertido, e o dia não muda com o fuso do navegador.
 */
export function reportRowDate(date: string | null, time: string | null): ReportRowDate {
  const day = date ? weekdayOfDate(date) : "";
  return {
    dayShort: isWeekday(day) ? WEEKDAY_ABBREVIATIONS[day] : "",
    dayFull: day,
    date: date ? formatIsoDateBr(date) : "",
    time: formatMeetingTime(time),
  };
}

/** A linha de um relatório (RN-15). */
export function toReportRowView(row: CellReportListRow, { canEditReports }: { canEditReports: boolean }): ReportRowView {
  const held = row.was_held === true;
  const { leader, g12, g12None } = reportLeaderLines(row);
  const leaderName = leaderLabel(leader);
  const mainText = (held ? row.theme : row.reason_not_held)?.trim() ?? "";
  const date = reportRowDate(row.date, row.time);
  const cellDeleted = row.cell_deleted === true;
  return {
    id: row.id ?? "",
    leader: leaderName,
    g12: { text: g12, none: g12None },
    date,
    address: cellAddress(row.cell_street, row.cell_number, row.cell_neighborhood) || null,
    held,
    cellDeleted,
    text: mainText ? { label: held ? TEXTS.theme : TEXTS.reason, value: mainText } : null,
    numbers: held
      ? { participants: row.participants_count ?? 0, visitors: row.visitors_count ?? 0, offering: formatOffering(row.offering) }
      : null,
    canEdit: canEditReports && !cellDeleted,
    openLabel: TEXTS.openLabel(date.date, leaderName),
  };
}
