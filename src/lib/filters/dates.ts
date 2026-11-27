// Datas dos filtros (E2.07, P54; E2.05, P33). Datas de calendário de Brasília, em "aaaa-mm-dd". Sem React.

import { formatIsoDateBr, parseIsoDate } from "@/lib/dates/sao-paulo";

/** É uma data de calendário que existe ("2026-02-31" não é). */
export function isIsoDate(value: string | null | undefined): value is string {
  return parseIsoDate(value) !== null;
}

/** O fim antes do início (P33, P54): o filtro de data não vale. */
export function isDateRangeInverted(from: string | null, to: string | null): boolean {
  return !!from && !!to && to < from;
}

/** "22/11/2026", para os chips. */
export function formatFilterDate(value: string): string {
  return formatIsoDateBr(value);
}
