// Formatação de números para exibição, no padrão pt-BR.

const COUNT_FORMAT = new Intl.NumberFormat("pt-BR");

/** Contagem com o separador de milhar do pt-BR: 1530 → "1.530". */
export function formatCount(value: number): string {
  return COUNT_FORMAT.format(value);
}

const CURRENCY_FORMAT = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valor em reais, no padrão pt-BR: 50 → "R$ 50,00" (com espaço inseparável depois do "R$"). */
export function formatCurrency(value: number): string {
  return CURRENCY_FORMAT.format(value);
}

/** Lista em frase, no padrão pt-BR: "Ana", "Ana e Bruno", "Ana, Bruno e Sara". */
export function formatList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

/** Data ("dd/MM/aaaa") e hora ("HH:mm") de um instante. */
export interface DateTimeParts {
  date: string;
  time: string;
}

// Sempre no horário de Brasília, qualquer que seja o fuso do navegador.
const BRASILIA_DATE_TIME = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/**
 * Data e hora de um `timestamptz` do banco no horário de Brasília (E2.01,
 * UX-15): "2026-11-10T17:32:00+00:00" → { date: "10/11/2026", time: "14:32" }.
 * `null` para um valor que não é uma data.
 */
export function formatDateTimeInBrasilia(instant: string | null | undefined): DateTimeParts | null {
  if (!instant) return null;
  const value = new Date(instant);
  if (Number.isNaN(value.getTime())) return null;
  const parts = BRASILIA_DATE_TIME.formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return { date: `${part("day")}/${part("month")}/${part("year")}`, time: `${part("hour")}:${part("minute")}` };
}
