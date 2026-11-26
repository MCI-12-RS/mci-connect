// Dias da semana das células (`cells.meeting_day`), exatamente como gravados
// no banco. Lista única do front: o CellForm oferece estes valores e o
// CellReportForm sugere a data a partir deles.

export const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/**
 * As opções do Dia da semana no formulário de célula (E2.08, RN-05, UXD-4,
 * P-CEL-14): de segunda a domingo, com o rótulo do legado e o valor gravado.
 */
export const WEEKDAY_OPTIONS: ReadonlyArray<{ readonly label: string; readonly value: Weekday }> = [
  { label: "Segunda-feira", value: "Segunda" },
  { label: "Terça-feira", value: "Terça" },
  { label: "Quarta-feira", value: "Quarta" },
  { label: "Quinta-feira", value: "Quinta" },
  { label: "Sexta-feira", value: "Sexta" },
  { label: "Sábado", value: "Sábado" },
  { label: "Domingo", value: "Domingo" },
];

/** O rótulo por extenso do dia gravado ("Quarta" → "Quarta-feira"); um valor desconhecido volta como veio. */
export function weekdayLongLabel(day: string): string {
  return WEEKDAY_OPTIONS.find((option) => option.value === day)?.label ?? day;
}

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
