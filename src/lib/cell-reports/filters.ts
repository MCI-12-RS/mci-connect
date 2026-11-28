// O filtro da lista de Relatórios (E2.12, AQ-1; RN-01 a RN-14 e RN-18): o módulo único que lê, limpa
// e grava a URL, conta os filtros ativos, monta os chips, os argumentos da `cell_reports_list`, os
// links prontos (o detalhe da célula e o Dashboard) e o chip da Célula (P84, vindo do E2.10). Sem
// React e sem Supabase.
//
// O servidor normaliza os mesmos casos (DA-1): esta regra só adianta o que ele faz.

import type { Database } from "@/integrations/supabase/types";
import { toSearchPatterns } from "@/lib/search";
import { formatFilterDate, isDateRangeInverted, isIsoDate } from "@/lib/filters/dates";
import { isUuid, oneOf, readListParam, setParam, writeList } from "@/lib/filters/url";
import type { FilterChip } from "@/lib/filters/chips";
import type { RecordFilterChipState } from "@/lib/filters/record-chip";
import { CELL_TYPE_OPTIONS, cellTypeOf, type CellTypeOption } from "@/lib/cells/filters";
import { formatMeetingTime } from "@/lib/cells/labels";
import { leaderLabel } from "@/lib/deletion/targets";
import { DEFAULT_PAGE_SIZE } from "@/lib/pagination";
import { CELL_REPORT_FILTER_LABELS as LABELS, CELL_REPORT_FILTER_TEXTS as TEXTS, HELD_LABELS } from "./filter-texts";

export type CellReportsListArgs = Database["public"]["Functions"]["cell_reports_list_count"]["Args"];

export type { CellTypeOption };
export { CELL_TYPE_OPTIONS, cellTypeOf };

/** A Reunião na URL (AQ-1): `held=yes` / `no`. Uma opção nova quebra a compilação até ganhar o valor. */
export const HELD_OPTIONS = ["yes", "no"] as const;
export type HeldOption = (typeof HELD_OPTIONS)[number];
const HELD_VALUES = { yes: true, no: false } as const satisfies Record<HeldOption, boolean>;

/** No máximo 10 pessoas no Líder e no G12 (RN-05). */
export const MAX_FILTER_PEOPLE = 10;

/** O parâmetro da consulta "Ver relatório" (`?report=<id>`). */
export const REPORT_PARAM = "report";

export interface CellReportFilters {
  /** A Célula, vinda de link (P93). */
  cellId: string | null;
  /** Ids, na ordem da escolha. */
  leaderIds: string[];
  g12Ids: string[];
  /** "aaaa-mm-dd", datas de Brasília, inclusive (RN-09). */
  from: string | null;
  to: string | null;
  types: CellTypeOption[];
  held: HeldOption | null;
}

export const EMPTY_CELL_REPORT_FILTERS: CellReportFilters = {
  cellId: null,
  leaderIds: [],
  g12Ids: [],
  from: null,
  to: null,
  types: [],
  held: null,
};

/** Os nomes na URL (AQ-1). */
export const CELL_REPORT_FILTER_PARAMS = {
  cellId: "cell",
  leaderIds: "leaders",
  g12Ids: "g12",
  from: "from",
  to: "to",
  types: "type",
  held: "held",
} as const satisfies Record<keyof CellReportFilters, string>;

const FILTER_PARAM_NAMES: readonly string[] = Object.values(CELL_REPORT_FILTER_PARAMS);

const isType = oneOf(CELL_TYPE_OPTIONS);
const isHeld = oneOf(HELD_OPTIONS);
const isPersonId = (value: string): value is string => isUuid(value);

export interface ParsedCellReportFilters {
  filters: CellReportFilters;
  /** A URL sem os valores inválidos, repetidos e excedentes (e sem o `report` sem formato); `null` se já estava limpa. */
  cleanParams: URLSearchParams | null;
  /** A URL trazia mais de 10 pessoas no Líder ou no G12: valem as 10 primeiras. */
  leadersTruncated: boolean;
  g12Truncated: boolean;
  /** As duas datas são válidas, mas "Até" vem antes de "De": não valem (DA-6). */
  dateRangeInverted: boolean;
}

/**
 * Lê os filtros da URL, sem os inválidos (RN-12). Não mexe em `q`, `page` e `size`. Um `report` sem
 * formato de id sai junto, na mesma limpeza (Navegação e rotas).
 */
export function parseCellReportFilters(params: URLSearchParams): ParsedCellReportFilters {
  const P = CELL_REPORT_FILTER_PARAMS;
  const leaderIds = readListParam(params, P.leaderIds, isPersonId);
  const g12Ids = readListParam(params, P.g12Ids, isPersonId);
  const readDate = (key: string): string | null => {
    const value = params.get(key);
    return isIsoDate(value) ? value : null;
  };
  const cell = params.get(P.cellId);
  const held = params.get(P.held);
  const filters: CellReportFilters = {
    cellId: cell !== null && isUuid(cell) ? cell : null,
    leaderIds: leaderIds.slice(0, MAX_FILTER_PEOPLE),
    g12Ids: g12Ids.slice(0, MAX_FILTER_PEOPLE),
    from: readDate(P.from),
    to: readDate(P.to),
    types: readListParam(params, P.types, isType, CELL_TYPE_OPTIONS),
    held: held !== null && isHeld(held) ? held : null,
  };
  const clean = writeFilterParams(new URLSearchParams(params), filters);
  const report = clean.get(REPORT_PARAM);
  if (report !== null && !isUuid(report)) clean.delete(REPORT_PARAM);
  return {
    filters,
    cleanParams: clean.toString() !== params.toString() ? clean : null,
    leadersTruncated: leaderIds.length > MAX_FILTER_PEOPLE,
    g12Truncated: g12Ids.length > MAX_FILTER_PEOPLE,
    dateRangeInverted: isDateRangeInverted(filters.from, filters.to),
  };
}

/** Escreve os filtros nos parâmetros, no lugar, sem os valores padrão e na ordem das opções. */
function writeFilterParams(params: URLSearchParams, filters: CellReportFilters): URLSearchParams {
  const P = CELL_REPORT_FILTER_PARAMS;
  setParam(params, P.cellId, filters.cellId && isUuid(filters.cellId) ? filters.cellId : null);
  setParam(params, P.leaderIds, writeList(filters.leaderIds.slice(0, MAX_FILTER_PEOPLE)));
  setParam(params, P.g12Ids, writeList(filters.g12Ids.slice(0, MAX_FILTER_PEOPLE)));
  setParam(params, P.from, filters.from);
  setParam(params, P.to, filters.to);
  setParam(params, P.types, writeList(CELL_TYPE_OPTIONS.filter((o) => filters.types.includes(o))));
  setParam(params, P.held, filters.held);
  return params;
}

/** Aplica os filtros à URL e volta para a página 1 (RN-02). A busca, o tamanho e a consulta ficam. */
export function writeCellReportFilters(params: URLSearchParams, filters: CellReportFilters): URLSearchParams {
  const next = writeFilterParams(new URLSearchParams(params), filters);
  next.delete("page");
  return next;
}

/** "Limpar filtros" (RN-12): tira os filtros, a busca e a página; mantém `size` e `report` (DA-13). */
export function clearCellReportFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...FILTER_PARAM_NAMES, "q", "page"]) next.delete(key);
  return next;
}

/** As datas que valem: nenhuma com o intervalo invertido (RN-09, DA-6). */
export function effectiveReportDates(filters: Pick<CellReportFilters, "from" | "to">): { from: string | null; to: string | null } {
  if (isDateRangeInverted(filters.from, filters.to)) return { from: null, to: null };
  return { from: filters.from, to: filters.to };
}

/**
 * Quantos filtros estão em uso, de 0 a 6 (RN-12): a Célula, o Líder e o G12 contam 1 cada com
 * qualquer número de pessoas, as duas datas contam 1, e a busca e os valores inválidos não contam.
 */
export function countActiveCellReportFilters(filters: CellReportFilters): number {
  const dates = effectiveReportDates(filters);
  return [
    filters.cellId !== null,
    filters.leaderIds.length > 0,
    filters.g12Ids.length > 0,
    dates.from !== null || dates.to !== null,
    filters.types.length > 0,
    filters.held !== null,
  ].filter(Boolean).length;
}

/**
 * A chave de um chip. A das pessoas é a posição, e não o id: o id nunca vai para o DOM (UX-11). A
 * Célula tem o chip próprio do P84 (`RecordFilterChip`), sempre antes destes.
 */
export type CellReportFilterChipKey =
  | `leaders:${number}`
  | `g12:${number}`
  | "from"
  | "to"
  | `type:${CellTypeOption}`
  | "held";

/** O rótulo da pessoa em cada posição do Líder e do G12 ("Pessoa indisponível", "Carregando…"). */
export interface CellReportFilterPersonLabels {
  leader: (index: number) => string;
  g12: (index: number) => string;
}

/** Os chips depois do da Célula, um por valor, na ordem da UXD-2; as pessoas na ordem da escolha. */
export function cellReportFilterChips(
  filters: CellReportFilters,
  personLabel: CellReportFilterPersonLabels,
): FilterChip<CellReportFilterChipKey>[] {
  const chip = TEXTS.chips.labeled;
  const chips: FilterChip<CellReportFilterChipKey>[] = [];
  filters.leaderIds.forEach((_, index) => chips.push({ key: `leaders:${index}`, text: chip(LABELS.leaders, personLabel.leader(index)) }));
  filters.g12Ids.forEach((_, index) => chips.push({ key: `g12:${index}`, text: chip(LABELS.g12, personLabel.g12(index)) }));
  const dates = effectiveReportDates(filters);
  if (dates.from) chips.push({ key: "from", text: chip(LABELS.from, formatFilterDate(dates.from)) });
  if (dates.to) chips.push({ key: "to", text: chip(LABELS.to, formatFilterDate(dates.to)) });
  for (const value of filters.types) chips.push({ key: `type:${value}`, text: chip(LABELS.type, cellTypeOf(value)) });
  if (filters.held) chips.push({ key: "held", text: chip(LABELS.held, HELD_LABELS[filters.held]) });
  return chips;
}

/** Os filtros sem o valor do chip (o "✕" tira só aquele valor). */
export function removeCellReportFilterChip(filters: CellReportFilters, key: CellReportFilterChipKey): CellReportFilters {
  const [name, value] = key.split(":");
  switch (name) {
    case "leaders":
      return { ...filters, leaderIds: filters.leaderIds.filter((_, index) => String(index) !== value) };
    case "g12":
      return { ...filters, g12Ids: filters.g12Ids.filter((_, index) => String(index) !== value) };
    case "type":
      return { ...filters, types: filters.types.filter((option) => option !== value) };
    case "from":
    case "to":
    case "held":
      return { ...filters, [name]: null };
    default:
      return filters;
  }
}

/** Uma semana inteira, de domingo a sábado ("aaaa-mm-dd"), como a `server_weeks` devolve. */
export interface WeekRange {
  start: string;
  end: string;
}

/** O atalho de semana (P90, RN-10): troca o Período pela semana e mantém o resto. */
export function applyWeek(filters: CellReportFilters, week: WeekRange): CellReportFilters {
  return { ...filters, from: week.start, to: week.end };
}

/** Os argumentos da `cell_reports_list` e da `cell_reports_list_count`: só os filtros em uso. */
export function toCellReportsListArgs(filters: CellReportFilters, search: string): CellReportsListArgs {
  const args: CellReportsListArgs = {};
  const patterns = toSearchPatterns(search);
  if (patterns.length > 0) args._search = patterns;
  if (filters.cellId) args._cell_id = filters.cellId;
  if (filters.leaderIds.length > 0) args._leader_ids = filters.leaderIds.slice(0, MAX_FILTER_PEOPLE);
  if (filters.g12Ids.length > 0) args._g12_ids = filters.g12Ids.slice(0, MAX_FILTER_PEOPLE);
  const dates = effectiveReportDates(filters);
  if (dates.from) args._date_from = dates.from;
  if (dates.to) args._date_to = dates.to;
  if (filters.types.length > 0) args._types = filters.types.map(cellTypeOf);
  if (filters.held) args._held = HELD_VALUES[filters.held];
  return args;
}

/** O que os links prontos levam (RN-08, RN-18). */
export interface CellReportListLink {
  cellId?: string | null;
  from?: string | null;
  to?: string | null;
  held?: HeldOption | null;
  /** O tamanho da página atual, que o link mantém (fora o padrão). */
  size?: number | null;
}

/**
 * O link da lista de Relatórios: "Ver todos os relatórios desta célula" (`/cell-reports?cell=<id>`,
 * sem outro filtro, sem busca, na página 1), o "Ver todos os relatórios" do detalhe da célula e os
 * links do Dashboard (RN-18): `/cell-reports?from=2026-11-22&to=2026-11-28&held=yes`.
 */
export function cellReportListHref({ cellId = null, from = null, to = null, held = null, size = null }: CellReportListLink): string {
  const params = writeCellReportFilters(new URLSearchParams(), { ...EMPTY_CELL_REPORT_FILTERS, cellId, from, to, held });
  if (size && size !== DEFAULT_PAGE_SIZE) params.set("size", String(size));
  const query = params.toString();
  return query ? `/cell-reports?${query}` : "/cell-reports";
}

/** A identificação da célula (`cell_identity`, E2.10): os valores atuais dela (DA-10 de lá). */
export interface CellIdentity {
  leader_name: string | null;
  meeting_day: string | null;
  meeting_time: string | null;
}

/** "Célula de André Souza · Quarta · 20:00": o dia como gravado, que já é a forma curta. */
export function cellIdentityChipText(identity: CellIdentity): string {
  return TEXTS.cellChipText(leaderLabel(identity.leader_name), identity.meeting_day ?? "", formatMeetingTime(identity.meeting_time));
}

/** O estado do chip da Célula: carregando, não carregada, indisponível (nenhuma linha) ou a célula. */
export function cellChipState(query: { data: CellIdentity | null | undefined; isError: boolean }): RecordFilterChipState {
  if (query.data === undefined) return query.isError ? { kind: "failed" } : { kind: "loading" };
  if (query.data === null) return { kind: "unavailable" };
  return { kind: "ready", text: cellIdentityChipText(query.data) };
}
