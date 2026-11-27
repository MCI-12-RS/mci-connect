// O filtro da lista de Células (E2.10, AQ-1; RN-01 a RN-13 e RN-21): o módulo único que lê, limpa e
// grava a URL, conta os filtros ativos, monta os chips, os argumentos da `cells_list` e os links dos
// cards do Dashboard (E2.14). Sem React e sem Supabase.
//
// O servidor normaliza os mesmos casos (DA-1): esta regra só adianta o que ele faz.

import { Constants, type Database } from "@/integrations/supabase/types";
import { toSearchPatterns } from "@/lib/search";
import { formatFilterDate, isDateRangeInverted, isIsoDate } from "@/lib/filters/dates";
import { isUuid, oneOf, readListParam, setParam, writeList } from "@/lib/filters/url";
import type { FilterChip } from "@/lib/filters/chips";
import { CELL_TYPES, type CellType } from "./cell-types";
import { WEEKDAY_OPTIONS, weekdayIndex, type Weekday } from "./weekdays";
import {
  REPORT_STATUS_FILTER,
  REPORT_STATUS_FILTER_CODES,
  REPORT_STATUS_FILTER_OPTIONS,
  REPORT_STATUS_FILTER_WEEKS,
  reportStatusFilterLabel,
  type CellReportStatus,
  type ReportStatusFilterOption,
} from "./report-status";
import { CELL_FILTER_LABELS, CELL_FILTER_TEXTS, CELL_STATUS_LABELS } from "./filter-texts";

export type CellsListArgs = Database["public"]["Functions"]["cells_list_count"]["Args"];

/** O tipo na URL (AQ-1). Um tipo novo em `CELL_TYPES` quebra a compilação até ganhar o nome. */
const TYPE_PARAMS = {
  Evangelística: "evangelistic",
  Discipulado: "discipleship",
  Macrocélula: "macrocell",
} as const satisfies Record<CellType, string>;
export type CellTypeOption = (typeof TYPE_PARAMS)[CellType];
export const CELL_TYPE_OPTIONS: readonly CellTypeOption[] = CELL_TYPES.map((type) => TYPE_PARAMS[type]);

/** O dia na URL (AQ-1), na ordem das opções do E2.08 (segunda a domingo). */
const DAY_PARAMS = {
  Segunda: "mon",
  Terça: "tue",
  Quarta: "wed",
  Quinta: "thu",
  Sexta: "fri",
  Sábado: "sat",
  Domingo: "sun",
} as const satisfies Record<Weekday, string>;
export type CellDayOption = (typeof DAY_PARAMS)[Weekday];
export const CELL_DAY_OPTIONS: readonly CellDayOption[] = WEEKDAY_OPTIONS.map((option) => DAY_PARAMS[option.value]);

export const CELL_STATUS_OPTIONS = ["active", "inactive"] as const;
export type CellStatusOption = (typeof CELL_STATUS_OPTIONS)[number];

/** O tipo gravado de uma opção da URL ("evangelistic" → "Evangelística"), que é também o rótulo. */
export function cellTypeOf(option: CellTypeOption): CellType {
  return CELL_TYPES.find((type) => TYPE_PARAMS[type] === option) ?? CELL_TYPES[0];
}

/** O dia de uma opção da URL: o valor gravado e o rótulo por extenso ("wed" → "Quarta-feira"). */
export function cellDayOf(option: CellDayOption): { value: Weekday; label: string } {
  return WEEKDAY_OPTIONS.find((day) => DAY_PARAMS[day.value] === option) ?? WEEKDAY_OPTIONS[0];
}

/** No máximo 10 pessoas no Líder e no G12 (RN-04, RN-05). */
export const MAX_FILTER_PEOPLE = 10;
/** Rua, bairro e cidade: até 100 caracteres (RN-07). */
export const CELL_FILTER_TEXT_MAX_LENGTH = 100;

export interface CellFilters {
  /** Ids, na ordem da escolha. */
  leaders: string[];
  g12: string[];
  street: string | null;
  neighborhood: string | null;
  city: string | null;
  types: CellTypeOption[];
  days: CellDayOption[];
  status: CellStatusOption | null;
  reportStatuses: ReportStatusFilterOption[];
  /** "aaaa-mm-dd", data de Brasília, inclusive (RN-11). */
  from: string | null;
  to: string | null;
}

export const EMPTY_CELL_FILTERS: CellFilters = {
  leaders: [],
  g12: [],
  street: null,
  neighborhood: null,
  city: null,
  types: [],
  days: [],
  status: null,
  reportStatuses: [],
  from: null,
  to: null,
};

/** Os nomes na URL (AQ-1). */
export const CELL_FILTER_PARAMS = {
  leaders: "leaders",
  g12: "g12",
  street: "street",
  neighborhood: "neighborhood",
  city: "city",
  types: "type",
  days: "day",
  status: "status",
  reportStatuses: "report_status",
  from: "from",
  to: "to",
} as const satisfies Record<keyof CellFilters, string>;

const FILTER_PARAM_NAMES: readonly string[] = Object.values(CELL_FILTER_PARAMS);

const isType = oneOf(CELL_TYPE_OPTIONS);
const isDay = oneOf(CELL_DAY_OPTIONS);
const isStatus = oneOf(CELL_STATUS_OPTIONS);
const isReportStatus = oneOf(REPORT_STATUS_FILTER_OPTIONS);
const isPersonId = (value: string): value is string => isUuid(value);

/** Rua, bairro e cidade como vão para a URL: sem espaços nas pontas, até 100 caracteres; vazio é nulo. */
export function normalizeCellFilterText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().slice(0, CELL_FILTER_TEXT_MAX_LENGTH).trim();
  return text === "" ? null : text;
}

export interface ParsedCellFilters {
  filters: CellFilters;
  /** A URL sem os valores inválidos, repetidos e excedentes; `null` se já estava limpa (RN-12). */
  cleanParams: URLSearchParams | null;
  /** A URL trazia mais de 10 pessoas no Líder ou no G12: valem as 10 primeiras. */
  leadersTruncated: boolean;
  g12Truncated: boolean;
  /** As duas datas são válidas, mas "até" vem antes de "a partir de": não valem (DA-7). */
  dateRangeInverted: boolean;
}

/** Lê os filtros da URL, sem os inválidos (RN-12). Não mexe em `q`, `page` e `size`. */
export function parseCellFilters(params: URLSearchParams): ParsedCellFilters {
  const P = CELL_FILTER_PARAMS;
  const leaderIds = readListParam(params, P.leaders, isPersonId);
  const g12Ids = readListParam(params, P.g12, isPersonId);
  const readDate = (key: string): string | null => {
    const value = params.get(key);
    return isIsoDate(value) ? value : null;
  };
  const status = params.get(P.status);
  const filters: CellFilters = {
    leaders: leaderIds.slice(0, MAX_FILTER_PEOPLE),
    g12: g12Ids.slice(0, MAX_FILTER_PEOPLE),
    street: normalizeCellFilterText(params.get(P.street)),
    neighborhood: normalizeCellFilterText(params.get(P.neighborhood)),
    city: normalizeCellFilterText(params.get(P.city)),
    types: readListParam(params, P.types, isType, CELL_TYPE_OPTIONS),
    days: readListParam(params, P.days, isDay, CELL_DAY_OPTIONS),
    status: status !== null && isStatus(status) ? status : null,
    reportStatuses: readListParam(params, P.reportStatuses, isReportStatus, REPORT_STATUS_FILTER_OPTIONS),
    from: readDate(P.from),
    to: readDate(P.to),
  };
  const clean = writeFilterParams(new URLSearchParams(params), filters);
  return {
    filters,
    cleanParams: clean.toString() !== params.toString() ? clean : null,
    leadersTruncated: leaderIds.length > MAX_FILTER_PEOPLE,
    g12Truncated: g12Ids.length > MAX_FILTER_PEOPLE,
    dateRangeInverted: isDateRangeInverted(filters.from, filters.to),
  };
}

/** Escreve os filtros nos parâmetros, no lugar, sem os valores padrão e na ordem das opções. */
function writeFilterParams(params: URLSearchParams, filters: CellFilters): URLSearchParams {
  const P = CELL_FILTER_PARAMS;
  setParam(params, P.leaders, writeList(filters.leaders.slice(0, MAX_FILTER_PEOPLE)));
  setParam(params, P.g12, writeList(filters.g12.slice(0, MAX_FILTER_PEOPLE)));
  setParam(params, P.street, normalizeCellFilterText(filters.street));
  setParam(params, P.neighborhood, normalizeCellFilterText(filters.neighborhood));
  setParam(params, P.city, normalizeCellFilterText(filters.city));
  setParam(params, P.types, writeList(CELL_TYPE_OPTIONS.filter((o) => filters.types.includes(o))));
  setParam(params, P.days, writeList(CELL_DAY_OPTIONS.filter((o) => filters.days.includes(o))));
  setParam(params, P.status, filters.status);
  setParam(params, P.reportStatuses, writeList(REPORT_STATUS_FILTER_OPTIONS.filter((o) => filters.reportStatuses.includes(o))));
  setParam(params, P.from, filters.from);
  setParam(params, P.to, filters.to);
  return params;
}

/** Aplica os filtros à URL e volta para a página 1 (RN-02). A busca e o tamanho da página ficam. */
export function writeCellFilters(params: URLSearchParams, filters: CellFilters): URLSearchParams {
  const next = writeFilterParams(new URLSearchParams(params), filters);
  next.delete("page");
  return next;
}

/** "Limpar filtros" (RN-12): tira os filtros, a busca e a página; mantém o tamanho da página. */
export function clearCellFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...FILTER_PARAM_NAMES, "q", "page"]) next.delete(key);
  return next;
}

/** As datas que valem: nenhuma com o intervalo invertido (RN-11, DA-7). */
export function effectiveCellDates(filters: CellFilters): { from: string | null; to: string | null } {
  if (isDateRangeInverted(filters.from, filters.to)) return { from: null, to: null };
  return { from: filters.from, to: filters.to };
}

/**
 * Quantos filtros estão em uso, de 0 a 10 (RN-12, DA-6): o Líder e o G12 contam 1 cada com qualquer
 * número de pessoas, as duas datas contam 1, e a busca e os valores inválidos não contam.
 */
export function countActiveCellFilters(filters: CellFilters): number {
  const dates = effectiveCellDates(filters);
  return [
    filters.leaders.length > 0,
    filters.g12.length > 0,
    filters.street !== null,
    filters.neighborhood !== null,
    filters.city !== null,
    filters.types.length > 0,
    filters.days.length > 0,
    filters.status !== null,
    filters.reportStatuses.length > 0,
    dates.from !== null || dates.to !== null,
  ].filter(Boolean).length;
}

/** A chave de um chip. A das pessoas é a posição, e não o id: o id nunca vai para o DOM (UX-09). */
export type CellFilterChipKey =
  | `leaders:${number}`
  | `g12:${number}`
  | "street"
  | "neighborhood"
  | "city"
  | `type:${CellTypeOption}`
  | `day:${CellDayOption}`
  | "status"
  | `report_status:${ReportStatusFilterOption}`
  | "from"
  | "to";

/** O rótulo da pessoa em cada posição do Líder e do G12 ("Pessoa indisponível", "Carregando…"). */
export interface CellFilterPersonLabels {
  leader: (index: number) => string;
  g12: (index: number) => string;
}

/** Os chips, um por valor, na ordem dos campos (UXD-1); as pessoas na ordem da escolha. */
export function cellFilterChips(filters: CellFilters, personLabel: CellFilterPersonLabels): FilterChip<CellFilterChipKey>[] {
  const L = CELL_FILTER_LABELS;
  const chip = CELL_FILTER_TEXTS.chips.labeled;
  const chips: FilterChip<CellFilterChipKey>[] = [];
  filters.leaders.forEach((_, index) => chips.push({ key: `leaders:${index}`, text: chip(L.leaders, personLabel.leader(index)) }));
  filters.g12.forEach((_, index) => chips.push({ key: `g12:${index}`, text: chip(L.g12, personLabel.g12(index)) }));
  if (filters.street) chips.push({ key: "street", text: chip(L.street, filters.street) });
  if (filters.neighborhood) chips.push({ key: "neighborhood", text: chip(L.neighborhood, filters.neighborhood) });
  if (filters.city) chips.push({ key: "city", text: chip(L.city, filters.city) });
  for (const value of filters.types) chips.push({ key: `type:${value}`, text: chip(L.type, cellTypeOf(value)) });
  for (const value of filters.days) chips.push({ key: `day:${value}`, text: chip(L.dayChip, cellDayOf(value).label) });
  if (filters.status) chips.push({ key: "status", text: chip(L.status, CELL_STATUS_LABELS[filters.status]) });
  for (const value of filters.reportStatuses)
    chips.push({ key: `report_status:${value}`, text: chip(REPORT_STATUS_FILTER.legend, reportStatusFilterLabel(value)) });
  const dates = effectiveCellDates(filters);
  if (dates.from) chips.push({ key: "from", text: CELL_FILTER_TEXTS.chips.from(formatFilterDate(dates.from)) });
  if (dates.to) chips.push({ key: "to", text: CELL_FILTER_TEXTS.chips.to(formatFilterDate(dates.to)) });
  return chips;
}

/** Os filtros sem o valor do chip (o "✕" tira só aquele valor). */
export function removeCellFilterChip(filters: CellFilters, key: CellFilterChipKey): CellFilters {
  const [name, value] = key.split(":");
  switch (name) {
    case "leaders":
      return { ...filters, leaders: filters.leaders.filter((_, index) => String(index) !== value) };
    case "g12":
      return { ...filters, g12: filters.g12.filter((_, index) => String(index) !== value) };
    case "type":
      return { ...filters, types: filters.types.filter((option) => option !== value) };
    case "day":
      return { ...filters, days: filters.days.filter((option) => option !== value) };
    case "report_status":
      return { ...filters, reportStatuses: filters.reportStatuses.filter((option) => option !== value) };
    case "street":
    case "neighborhood":
    case "city":
    case "status":
    case "from":
    case "to":
      return { ...filters, [name]: null };
    default:
      return filters;
  }
}

/** Os códigos do servidor de uma opção da semana ("Enviado" vira os dois, PO-UX-1). */
function serverStatuses(option: ReportStatusFilterOption): CellReportStatus[] {
  return Constants.public.Enums.cell_report_status.filter((code) => REPORT_STATUS_FILTER_CODES[code] === option);
}

const isMissedWeeks = oneOf(["missed_1", "missed_2", "missed_3", "missed_4plus"] as const);

/** Os argumentos da `cells_list` e da `cells_list_count`: só os filtros em uso. */
export function toCellsListArgs(filters: CellFilters, search: string): CellsListArgs {
  const args: CellsListArgs = {};
  const patterns = toSearchPatterns(search);
  if (patterns.length > 0) args._search = patterns;
  if (filters.leaders.length > 0) args._leader_ids = filters.leaders.slice(0, MAX_FILTER_PEOPLE);
  if (filters.g12.length > 0) args._g12_ids = filters.g12.slice(0, MAX_FILTER_PEOPLE);
  const street = normalizeCellFilterText(filters.street);
  if (street) args._street = street;
  const neighborhood = normalizeCellFilterText(filters.neighborhood);
  if (neighborhood) args._neighborhood = neighborhood;
  const city = normalizeCellFilterText(filters.city);
  if (city) args._city = city;
  if (filters.types.length > 0) args._types = filters.types.map(cellTypeOf);
  if (filters.days.length > 0)
    args._weekdays = filters.days.map((option) => weekdayIndex(cellDayOf(option).value)).filter((day): day is number => day !== null);
  if (filters.status) args._is_active = filters.status === "active";
  const statuses = filters.reportStatuses.flatMap(serverStatuses);
  if (statuses.length > 0) args._report_statuses = statuses;
  const weeks = filters.reportStatuses.flatMap((option) => (isMissedWeeks(option) ? [REPORT_STATUS_FILTER_WEEKS[option]] : []));
  if (weeks.length > 0) args._missing_weeks = weeks;
  const dates = effectiveCellDates(filters);
  if (dates.from) args._created_from = dates.from;
  if (dates.to) args._created_to = dates.to;
  return args;
}

/** Os cards de células do Dashboard (RN-21), para o E2.14. */
export type CellListCard =
  | { kind: "pending" }
  | { kind: "type"; type: CellType; activeOnly?: boolean }
  | { kind: "new_this_week"; week: { start: string; end: string } }
  | { kind: "g12_couple"; ids: readonly string[] };

function cardFilters(card: CellListCard): Partial<CellFilters> {
  switch (card.kind) {
    case "pending":
      return { reportStatuses: ["pending"] };
    case "type":
      return { types: [TYPE_PARAMS[card.type]], status: card.activeOnly ? "active" : null };
    case "new_this_week":
      return { from: card.week.start, to: card.week.end };
    case "g12_couple":
      return { g12: [...card.ids], status: "active" };
  }
}

/** O link da lista de Células equivalente a um card (RN-21): `/cells?report_status=pending`. */
export function cellListHref(card: CellListCard): string {
  const params = writeCellFilters(new URLSearchParams(), { ...EMPTY_CELL_FILTERS, ...cardFilters(card) });
  const query = params.toString();
  return query ? `/cells?${query}` : "/cells";
}
