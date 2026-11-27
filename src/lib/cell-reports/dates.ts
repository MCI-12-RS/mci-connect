// Datas do relatório no horário de Brasília (E2.11, RN-04 a RN-07, RN-16,
// RN-18, P104, AQ-6). Espelho das regras puras do banco
// (`private.report_launch_rule`, `report_edit_rule`, `report_launch_status`,
// `report_launch_dates`, `report_edit_dates`), conferido contra a mesma tabela
// de casos (`report-rules-cases.json`). Sem React e sem Supabase.
//
// O "agora" vem do servidor (`server_now` da conferência) mais o tempo passado
// no aparelho; só quando a conferência falha a tela usa o relógio do aparelho,
// sempre convertido para Brasília (UXD-4).
import { addOneDay, formatIsoDateBr, parseIsoDate } from "@/lib/dates/sao-paulo";
import { WEEKDAYS, weekdayIndex } from "@/lib/cells/weekdays";

/** Um momento de Brasília: "aaaa-mm-dd HH:mm:ss". A comparação de texto é a do tempo. */
export type LocalMoment = string;

const SAO_PAULO_MOMENT = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** O momento de Brasília de um instante, como `public.sp_local`. */
export function spLocalMoment(instant: Date): LocalMoment {
  const parts = SAO_PAULO_MOMENT.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")}`;
}

export const momentDate = (moment: LocalMoment): string => moment.slice(0, 10);
/** "HH:mm". */
export const momentTime = (moment: LocalMoment): string => moment.slice(11, 16);

/** "20:00" ou "20:00:00" → "20:00:00"; `null` para o que não é um horário. */
export function toFullTime(time: string | null | undefined): string | null {
  const match = time == null ? null : /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(time);
  if (!match) return null;
  return `${match[1]}:${match[2]}:${match[3] ?? "00"}`;
}

export function toMoment(date: string, time: string): LocalMoment | null {
  const full = toFullTime(time);
  return parseIsoDate(date) && full ? `${date} ${full}` : null;
}

/** O minuto de um momento (`date_trunc('minute', …)`). */
const truncMinute = (moment: LocalMoment): LocalMoment => `${moment.slice(0, 16)}:00`;

function dayOfWeek(date: string): number {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Data inválida: ${date}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const parsed = parseIsoDate(date);
  if (!parsed) throw new RangeError(`Data inválida: ${date}`);
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days)).toISOString().slice(0, 10);
}

/** O domingo da semana da data (`public.week_start`). */
export const weekStart = (date: string): string => addDays(date, -dayOfWeek(date));

/** A reunião da semana (`private.report_meeting_at`): o dia e o horário da célula na semana. */
export function meetingAt(week: string, meetingDay: string, meetingTime: string): LocalMoment | null {
  const index = weekdayIndex(meetingDay);
  const full = toFullTime(meetingTime);
  if (index === null || !full) return null;
  return `${addDays(week, index)} ${full}`;
}

function datesBetween(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let d = first; d <= last; d = addOneDay(d)) dates.push(d);
  return dates;
}

/** Datas aceitas no lançamento: da reunião da semana até hoje; vazia antes da reunião (P-REL-22). */
export function launchDates(now: LocalMoment, meeting: LocalMoment): string[] {
  return now < meeting ? [] : datesBetween(momentDate(meeting), momentDate(now));
}

/** Datas aceitas na edição: a semana do relatório até o sábado dela ou até hoje (RN-16). */
export function editDates(now: LocalMoment, storedDate: string): string[] {
  const first = weekStart(storedDate);
  const saturday = addDays(first, 6);
  const today = momentDate(now);
  return datesBetween(first, today < saturday ? today : saturday);
}

export type LaunchWeekStatus = "already_sent" | "not_yet" | "can_submit";

/** Os três últimos degraus da conferência (RN-19): já enviado antes de "ainda não aconteceu". */
export function launchStatus(now: LocalMoment, meeting: LocalMoment, weekHasReport: boolean): LaunchWeekStatus {
  if (weekHasReport) return "already_sent";
  return now < meeting ? "not_yet" : "can_submit";
}

export type LaunchRuleCode =
  | "report_not_current_week"
  | "report_week_taken"
  | "meeting_not_yet"
  | "report_in_future"
  | "report_before_meeting";

export interface LaunchRuleResult {
  code: LaunchRuleCode | null;
  finalDate: string;
  /** "HH:mm:ss". */
  finalTime: string;
}

/** Lançamento (RN-04 a RN-07, RN-09), itens 4 a 8 da RN-20, nesta ordem. */
export function launchRule(input: {
  now: LocalMoment;
  meeting: LocalMoment;
  held: boolean;
  date: string;
  time: string;
  weekHasReport: boolean;
}): LaunchRuleResult {
  const { now, meeting, held } = input;
  const finalDate = held ? input.date : momentDate(meeting);
  const finalTime = held ? (toFullTime(input.time) ?? "00:00:00") : meeting.slice(11);
  const week = weekStart(momentDate(now));
  const final = `${finalDate} ${finalTime}`;
  let code: LaunchRuleCode | null = null;
  if (finalDate < week || finalDate > addDays(week, 6)) code = "report_not_current_week";
  else if (input.weekHasReport) code = "report_week_taken";
  else if (now < meeting) code = "meeting_not_yet";
  else if (final > truncMinute(now)) code = "report_in_future";
  else if (final < meeting) code = "report_before_meeting";
  return { code, finalDate, finalTime };
}

export type EditRuleCode = "report_week_locked" | "report_in_future";

/** Edição (RN-05, RN-16): a semana do relatório e, se a data ou o horário mudaram, o futuro. */
export function editRule(input: {
  now: LocalMoment;
  storedDate: string;
  date: string;
  time: string;
  momentChanged: boolean;
}): EditRuleCode | null {
  const first = weekStart(input.storedDate);
  if (input.date < first || input.date > addDays(first, 6)) return "report_week_locked";
  const full = toFullTime(input.time);
  if (input.momentChanged && full && `${input.date} ${full}` > truncMinute(input.now)) return "report_in_future";
  return null;
}

/** Um relógio a partir do "agora" do servidor: o instante devolvido mais o tempo passado no aparelho (AQ-6). */
export type Clock = () => Date;

export function serverClock(serverNow: string, elapsedMs: () => number = () => performance.now()): Clock {
  const base = new Date(serverNow).getTime();
  const start = elapsedMs();
  return () => new Date(base + (elapsedMs() - start));
}

/** O relógio do aparelho: só quando a conferência falhou (UXD-4). */
export const deviceClock: Clock = () => new Date();

/** O que a tela precisa para sugerir e conferir a data do lançamento. */
export interface LaunchDates {
  today: string;
  weekStart: string;
  weekEnd: string;
  meeting: LocalMoment;
  allowedDates: string[];
}

/** O mesmo que a conferência devolveria, calculado por um relógio (a conferência que falhou). */
export function launchDatesAt(now: Date, meetingDay: string, meetingTime: string): LaunchDates | null {
  const local = spLocalMoment(now);
  const today = momentDate(local);
  const week = weekStart(today);
  const meeting = meetingAt(week, meetingDay, meetingTime);
  if (!meeting) return null;
  return { today, weekStart: week, weekEnd: addDays(week, 6), meeting, allowedDates: launchDates(local, meeting) };
}

/** A sugestão do lançamento (RN-18): a data e o horário da reunião da semana. */
export function suggestedLaunch(dates: LaunchDates): { date: string; time: string } {
  return { date: momentDate(dates.meeting), time: momentTime(dates.meeting) };
}

/** "Quarta" para a data. */
export const weekdayName = (date: string): string => WEEKDAYS[dayOfWeek(date)];

/** A opção da data (P104): "Quarta, 25/11/2026", com " (hoje)" no dia de hoje. */
export function dayOption(date: string, today: string, todaySuffix: string): string {
  return `${weekdayName(date)}, ${formatIsoDateBr(date)}${date === today ? todaySuffix : ""}`;
}

/** "quarta, 25/11/2026, às 20:00": o momento no meio de uma frase. */
export function meetingInSentence(date: string, time: string): string {
  return `${weekdayName(date).toLocaleLowerCase("pt-BR")}, ${formatIsoDateBr(date)}, às ${(time ?? "").slice(0, 5)}`;
}

/** O mesmo, a partir de um momento. */
export const momentInSentence = (moment: LocalMoment): string => meetingInSentence(momentDate(moment), momentTime(moment));
