// Dias da semana das células (`cells.meeting_day`), exatamente como gravados
// no banco. Lista única do front: o CellForm oferece estes valores e o
// CellReportForm sugere a data a partir deles.

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * Índice do dia (0 = domingo … 6 = sábado), ou `null` para um valor
 * desconhecido. Espelho de `public.weekday_index` (comparação exata, sem
 * normalizar maiúsculas nem acentos).
 */
export function weekdayIndex(day: string | null | undefined): number | null {
  const index = WEEKDAYS.findIndex((weekday) => weekday === day);
  return index === -1 ? null : index;
}

/**
 * O dia no meio de uma frase, em minúsculas ("Timóteo na célula de Carlos,
 * quarta, 20:00"). Um valor desconhecido volta como veio.
 */
export function weekdayInSentence(day: string): string {
  return weekdayIndex(day) === null ? day : day.toLocaleLowerCase("pt-BR");
}
