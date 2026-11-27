// Datas de calendário no horário de Brasília (E2.04, RN-15, DA-13). Uma data
// é sempre a string ISO "aaaa-mm-dd", sem fuso: nada aqui depende do fuso do
// navegador.

import { formatDateTimeInBrasilia, type DateTimeParts } from "@/lib/format";

const SAO_PAULO_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** O "hoje" de Brasília ("aaaa-mm-dd"), como `public.sp_today()`, qualquer que seja o fuso do navegador. */
export function spToday(now: Date = new Date()): string {
  const parts = SAO_PAULO_DATE.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Uma data de calendário em números. */
export interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Lê "aaaa-mm-dd". `null` para o que não é uma data de calendário que existe. */
export function parseIsoDate(value: string | null | undefined): CalendarDate | null {
  const match = value == null ? null : ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/**
 * Uma data completa, como a que um filtro aplica: existe e tem o ano com 4 dígitos, de 1000 a 9999
 * (E2.07, P54). Enquanto se digita o ano no campo nativo, ele passa por "0002", "0020" e "0202", e
 * um 5º dígito sai do formato: nenhum desses vale.
 */
export function isCompleteIsoDate(value: string | null | undefined): boolean {
  const parsed = parseIsoDate(value);
  return parsed !== null && parsed.year >= 1000;
}

const pad = (value: number, length: number): string => String(value).padStart(length, "0");

/** Escreve "aaaa-mm-dd". */
export function toIsoDate({ year, month, day }: CalendarDate): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/**
 * A mesma data `years` anos antes, como `data - interval 'N years'` do
 * Postgres (DA-13): um 29/02 vira 28/02 quando o ano não é bissexto.
 */
export function subtractYears(date: string, years: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Data inválida: ${date}`);
  const year = parsed.year - years;
  return toIsoDate({ year, month: parsed.month, day: Math.min(parsed.day, daysInMonth(year, parsed.month)) });
}

/** A data seguinte. */
export function addOneDay(date: string): string {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Data inválida: ${date}`);
  const { year, month, day } = parsed;
  if (day < daysInMonth(year, month)) return toIsoDate({ year, month, day: day + 1 });
  if (month < 12) return toIsoDate({ year, month: month + 1, day: 1 });
  return toIsoDate({ year: year + 1, month: 1, day: 1 });
}

/** "aaaa-mm-dd" → "dd/mm/aaaa". O que não é uma data volta como veio. */
export function formatIsoDateBr(date: string): string {
  const parsed = parseIsoDate(date);
  return parsed ? `${pad(parsed.day, 2)}/${pad(parsed.month, 2)}/${pad(parsed.year, 4)}` : date;
}

/**
 * Data e hora de um instante (`timestamptz`) no horário de Brasília (E2.05, UX-02), qualquer que seja o
 * fuso do navegador: { date: "21/11/2026", time: "23:59" }. `null` para o que não é um instante.
 */
export function formatSpDateTime(instant: string | null | undefined): DateTimeParts | null {
  return formatDateTimeInBrasilia(instant);
}

/** Só a data ("dd/mm/aaaa") de um instante, no horário de Brasília; `null` para o que não é um instante. */
export function formatSpDate(instant: string | null | undefined): string | null {
  return formatDateTimeInBrasilia(instant)?.date ?? null;
}
