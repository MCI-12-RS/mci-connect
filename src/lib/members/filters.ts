// O filtro da lista de Membros (E2.07, AQ-1; RN-01 a RN-17): o módulo único que lê, limpa e grava
// a URL, conta os filtros ativos, monta os chips, os argumentos da `members_list` e os links dos
// cards do Dashboard (E2.14). Sem React e sem Supabase.
//
// O servidor normaliza os mesmos casos (DA-1 do E2.07): esta regra só adianta o que ele faz.

import { Constants, type Database } from "@/integrations/supabase/types";
import { toSearchPatterns } from "@/lib/search";
import { formatFilterDate, isDateRangeInverted, isIsoDate } from "@/lib/filters/dates";
import { isUuid, oneOf, readListParam, setParam, writeList } from "@/lib/filters/url";
import type { FilterChip } from "@/lib/filters/chips";
import { resolvePersonLabel, type PersonLabel, type PersonNameSources, type VisiblePersonNames } from "@/lib/filters/person";
import {
  MEMBER_BAPTIZED_LABELS,
  MEMBER_CELL_LINK_LABELS,
  MEMBER_FILTER_LABELS,
  MEMBER_FILTER_TEXTS,
  MEMBER_LEADERSHIP_LABELS,
  MEMBER_LEVEL_LABELS,
  MEMBER_STATUS_LABELS,
} from "./filter-texts";

type Enums = Database["public"]["Enums"];
export type MembersListArgs = Database["public"]["Functions"]["members_list_count"]["Args"];

export type MemberLeadershipOption = Enums["member_leadership_status"];
export type MemberCellLinkOption = Enums["member_cell_link"];

/** As opções na ordem do enum (DT-08). */
export const MEMBER_LEADERSHIP_OPTIONS: readonly MemberLeadershipOption[] = Constants.public.Enums.member_leadership_status;
export const MEMBER_CELL_LINK_OPTIONS: readonly MemberCellLinkOption[] = Constants.public.Enums.member_cell_link;
/** Os níveis do filtro: 0 a 4 e "5 ou mais" (RN-09). */
export const MEMBER_LEVEL_OPTIONS = ["0", "1", "2", "3", "4", "5plus"] as const;
export type MemberLevelOption = (typeof MEMBER_LEVEL_OPTIONS)[number];
export const MEMBER_STATUS_OPTIONS = ["active", "inactive"] as const;
export type MemberStatusOption = (typeof MEMBER_STATUS_OPTIONS)[number];
export const MEMBER_BAPTIZED_OPTIONS = ["yes", "no"] as const;
export type MemberBaptizedOption = (typeof MEMBER_BAPTIZED_OPTIONS)[number];

/** No máximo 10 pessoas na Liderança (RN-04). */
export const MAX_LEADERS = 10;
/** Bairro e cidade: até 100 caracteres (RN-06). */
export const FILTER_TEXT_MAX_LENGTH = 100;

export interface MemberFilters {
  /** Ids, na ordem da escolha. */
  leaders: string[];
  neighborhood: string | null;
  city: string | null;
  status: MemberStatusOption | null;
  leadership: MemberLeadershipOption[];
  baptized: MemberBaptizedOption | null;
  levels: MemberLevelOption[];
  cellLinks: MemberCellLinkOption[];
  /** "aaaa-mm-dd", data de Brasília, inclusive (RN-12). */
  from: string | null;
  to: string | null;
}

export const EMPTY_MEMBER_FILTERS: MemberFilters = {
  leaders: [],
  neighborhood: null,
  city: null,
  status: null,
  leadership: [],
  baptized: null,
  levels: [],
  cellLinks: [],
  from: null,
  to: null,
};

/** Os nomes na URL (AQ-1). */
export const MEMBER_FILTER_PARAMS = {
  leaders: "leaders",
  neighborhood: "neighborhood",
  city: "city",
  status: "status",
  leadership: "leadership",
  baptized: "baptized",
  levels: "level",
  cellLinks: "cell_link",
  from: "from",
  to: "to",
} as const satisfies Record<keyof MemberFilters, string>;

const FILTER_PARAM_NAMES: readonly string[] = Object.values(MEMBER_FILTER_PARAMS);

const isStatus = oneOf(MEMBER_STATUS_OPTIONS);
const isBaptized = oneOf(MEMBER_BAPTIZED_OPTIONS);
const isLeadership = oneOf(MEMBER_LEADERSHIP_OPTIONS);
const isLevel = oneOf(MEMBER_LEVEL_OPTIONS);
const isCellLink = oneOf(MEMBER_CELL_LINK_OPTIONS);
const isLeaderId = (value: string): value is string => isUuid(value);

/** Bairro e cidade como vão para a URL: sem espaços nas pontas, até 100 caracteres; vazio é nulo. */
export function normalizeFilterText(value: string | null | undefined): string | null {
  const text = (value ?? "").trim().slice(0, FILTER_TEXT_MAX_LENGTH).trim();
  return text === "" ? null : text;
}

export interface ParsedMemberFilters {
  filters: MemberFilters;
  /** A URL sem os valores inválidos, repetidos e excedentes; `null` se já estava limpa (RN-14). */
  cleanParams: URLSearchParams | null;
  /** A URL trazia mais de 10 pessoas na Liderança: valem as 10 primeiras (RN-04, P-FIL-17). */
  leadersTruncated: boolean;
  /** As duas datas são válidas, mas "até" vem antes de "a partir de": não valem (DA-4). */
  dateRangeInverted: boolean;
}

/** Lê os filtros da URL, sem os inválidos (RN-14). Não mexe em `q`, `page` e `size`. */
export function parseMemberFilters(params: URLSearchParams): ParsedMemberFilters {
  const P = MEMBER_FILTER_PARAMS;
  const leaderIds = readListParam(params, P.leaders, isLeaderId);
  const leadersTruncated = leaderIds.length > MAX_LEADERS;
  const readDate = (key: string): string | null => {
    const value = params.get(key);
    return isIsoDate(value) ? value : null;
  };
  const filters: MemberFilters = {
    leaders: leaderIds.slice(0, MAX_LEADERS),
    neighborhood: normalizeFilterText(params.get(P.neighborhood)),
    city: normalizeFilterText(params.get(P.city)),
    status: (() => {
      const value = params.get(P.status);
      return value !== null && isStatus(value) ? value : null;
    })(),
    leadership: readListParam(params, P.leadership, isLeadership, MEMBER_LEADERSHIP_OPTIONS),
    baptized: (() => {
      const value = params.get(P.baptized);
      return value !== null && isBaptized(value) ? value : null;
    })(),
    levels: readListParam(params, P.levels, isLevel, MEMBER_LEVEL_OPTIONS),
    cellLinks: readListParam(params, P.cellLinks, isCellLink, MEMBER_CELL_LINK_OPTIONS),
    from: readDate(P.from),
    to: readDate(P.to),
  };
  const clean = writeFilterParams(new URLSearchParams(params), filters);
  return {
    filters,
    cleanParams: clean.toString() !== params.toString() ? clean : null,
    leadersTruncated,
    dateRangeInverted: isDateRangeInverted(filters.from, filters.to),
  };
}

/** Escreve os filtros nos parâmetros, no lugar, sem os valores padrão. */
function writeFilterParams(params: URLSearchParams, filters: MemberFilters): URLSearchParams {
  const P = MEMBER_FILTER_PARAMS;
  setParam(params, P.leaders, writeList(filters.leaders));
  setParam(params, P.neighborhood, normalizeFilterText(filters.neighborhood));
  setParam(params, P.city, normalizeFilterText(filters.city));
  setParam(params, P.status, filters.status);
  setParam(params, P.leadership, writeList(MEMBER_LEADERSHIP_OPTIONS.filter((o) => filters.leadership.includes(o))));
  setParam(params, P.baptized, filters.baptized);
  setParam(params, P.levels, writeList(MEMBER_LEVEL_OPTIONS.filter((o) => filters.levels.includes(o))));
  setParam(params, P.cellLinks, writeList(MEMBER_CELL_LINK_OPTIONS.filter((o) => filters.cellLinks.includes(o))));
  setParam(params, P.from, filters.from);
  setParam(params, P.to, filters.to);
  return params;
}

/**
 * Aplica os filtros à URL: sem os padrões, as opções na ordem delas e a Liderança na ordem da
 * escolha; volta para a página 1 (RN-02). A busca e o tamanho da página ficam.
 */
export function writeMemberFilters(params: URLSearchParams, filters: MemberFilters): URLSearchParams {
  const next = writeFilterParams(new URLSearchParams(params), { ...filters, leaders: filters.leaders.slice(0, MAX_LEADERS) });
  next.delete("page");
  return next;
}

/** "Limpar filtros" (RN-14): tira os filtros, a busca e a página; mantém o tamanho da página. */
export function clearMemberFilters(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of [...FILTER_PARAM_NAMES, "q", "page"]) next.delete(key);
  return next;
}

/** As datas que valem: nenhuma com o intervalo invertido (RN-12, DA-4). */
export function effectiveDates(filters: MemberFilters): { from: string | null; to: string | null } {
  if (isDateRangeInverted(filters.from, filters.to)) return { from: null, to: null };
  return { from: filters.from, to: filters.to };
}

/**
 * Quantos filtros estão em uso, de 0 a 9 (RN-14, P-FIL-19): a Liderança conta 1 com qualquer número
 * de pessoas, as duas datas contam 1, e a busca e os valores inválidos não contam. Uma múltipla
 * escolha com todas as opções conta (DA-8).
 */
export function countActiveFilters(filters: MemberFilters): number {
  const dates = effectiveDates(filters);
  return [
    filters.leaders.length > 0,
    filters.neighborhood !== null,
    filters.city !== null,
    filters.status !== null,
    filters.leadership.length > 0,
    filters.baptized !== null,
    filters.levels.length > 0,
    filters.cellLinks.length > 0,
    dates.from !== null || dates.to !== null,
  ].filter(Boolean).length;
}

/** A chave de um chip. A da Liderança é a posição, e não o id: o id nunca vai para o DOM (UX-09). */
export type MemberFilterChipKey =
  | `leaders:${number}`
  | "neighborhood"
  | "city"
  | "status"
  | `leadership:${MemberLeadershipOption}`
  | "baptized"
  | `level:${MemberLevelOption}`
  | `cell_link:${MemberCellLinkOption}`
  | "from"
  | "to";

/**
 * Os chips, um por valor, na ordem dos campos (UXD-3, UXD-5); a Liderança na ordem da escolha.
 * `leaderName(index)` dá o rótulo da pessoa naquela posição ("Pessoa indisponível", "Carregando…").
 */
export function memberFilterChips(
  filters: MemberFilters,
  leaderName: (index: number) => string,
): FilterChip<MemberFilterChipKey>[] {
  const L = MEMBER_FILTER_LABELS;
  const chip = MEMBER_FILTER_TEXTS.chips.labeled;
  const chips: FilterChip<MemberFilterChipKey>[] = [];
  filters.leaders.forEach((_, index) => chips.push({ key: `leaders:${index}`, text: chip(L.leaders, leaderName(index)) }));
  if (filters.neighborhood) chips.push({ key: "neighborhood", text: chip(L.neighborhood, filters.neighborhood) });
  if (filters.city) chips.push({ key: "city", text: chip(L.city, filters.city) });
  if (filters.status) chips.push({ key: "status", text: chip(L.status, MEMBER_STATUS_LABELS[filters.status]) });
  for (const value of filters.leadership)
    chips.push({ key: `leadership:${value}`, text: chip(L.leadership, MEMBER_LEADERSHIP_LABELS[value]) });
  if (filters.baptized) chips.push({ key: "baptized", text: chip(L.baptized, MEMBER_BAPTIZED_LABELS[filters.baptized]) });
  for (const value of filters.levels) chips.push({ key: `level:${value}`, text: chip(L.level, MEMBER_LEVEL_LABELS[value]) });
  for (const value of filters.cellLinks)
    chips.push({ key: `cell_link:${value}`, text: chip(L.cellLink, MEMBER_CELL_LINK_LABELS[value]) });
  const dates = effectiveDates(filters);
  if (dates.from) chips.push({ key: "from", text: MEMBER_FILTER_TEXTS.chips.from(formatFilterDate(dates.from)) });
  if (dates.to) chips.push({ key: "to", text: MEMBER_FILTER_TEXTS.chips.to(formatFilterDate(dates.to)) });
  return chips;
}

/** Os filtros sem o valor do chip (o "✕" tira só aquele valor). */
export function removeMemberFilterChip(filters: MemberFilters, key: MemberFilterChipKey): MemberFilters {
  const [name, value] = key.split(":");
  switch (name) {
    case "leaders":
      return { ...filters, leaders: filters.leaders.filter((_, index) => String(index) !== value) };
    case "leadership":
      return { ...filters, leadership: filters.leadership.filter((option) => option !== value) };
    case "level":
      return { ...filters, levels: filters.levels.filter((option) => option !== value) };
    case "cell_link":
      return { ...filters, cellLinks: filters.cellLinks.filter((option) => option !== value) };
    case "neighborhood":
    case "city":
    case "status":
    case "baptized":
    case "from":
    case "to":
      return { ...filters, [name]: null };
    default:
      return filters;
  }
}

const levelNumber = (level: MemberLevelOption): number => (level === "5plus" ? 5 : Number(level));

/** Os argumentos da `members_list` e da `members_list_count`: só os filtros em uso (DT-01). */
export function toMembersListArgs(filters: MemberFilters, search: string): MembersListArgs {
  const args: MembersListArgs = {};
  const patterns = toSearchPatterns(search);
  if (patterns.length > 0) args._search = patterns;
  if (filters.leaders.length > 0) args._leader_ids = filters.leaders.slice(0, MAX_LEADERS);
  const neighborhood = normalizeFilterText(filters.neighborhood);
  if (neighborhood) args._neighborhood = neighborhood;
  const city = normalizeFilterText(filters.city);
  if (city) args._city = city;
  if (filters.status) args._is_active = filters.status === "active";
  if (filters.leadership.length > 0) args._leadership = filters.leadership;
  if (filters.baptized) args._is_baptized = filters.baptized === "yes";
  if (filters.levels.length > 0) args._levels = filters.levels.map(levelNumber);
  if (filters.cellLinks.length > 0) args._cell_links = filters.cellLinks;
  const dates = effectiveDates(filters);
  if (dates.from) args._created_from = dates.from;
  if (dates.to) args._created_to = dates.to;
  return args;
}

/** Os cards de membros do Dashboard (RN-17), para o E2.14. */
export type MemberListCard =
  | "total"
  | "active"
  | "inactive"
  | "baptized"
  | "not_baptized"
  | "no_leadership"
  | "no_cell_link"
  | "new_this_week";

const CARD_FILTERS: Record<Exclude<MemberListCard, "new_this_week">, Partial<MemberFilters>> = {
  total: {},
  active: { status: "active" },
  inactive: { status: "inactive" },
  baptized: { baptized: "yes" },
  not_baptized: { baptized: "no" },
  no_leadership: { status: "active", leadership: ["no_leadership"] },
  no_cell_link: { status: "active", cellLinks: ["none"] },
};

/**
 * O link da lista de Membros equivalente a um card (RN-17): `/members?status=active&cell_link=none`.
 * "Novos membros da semana" pede a semana atual (domingo e sábado, "aaaa-mm-dd").
 */
export function memberListHref(card: MemberListCard, week?: { start: string; end: string }): string {
  const changes: Partial<MemberFilters> =
    card === "new_this_week" ? { from: week?.start ?? null, to: week?.end ?? null } : CARD_FILTERS[card];
  const params = writeMemberFilters(new URLSearchParams(), { ...EMPTY_MEMBER_FILTERS, ...changes });
  const query = params.toString();
  return query ? `/members?${query}` : "/members";
}

/** Como uma pessoa escolhida na Liderança aparece (P53, UXD-7). */
export type LeaderLabel = PersonLabel;
/** A leitura das pessoas visíveis por id (`members_view`). */
export type VisibleMemberNames = VisiblePersonNames;
export type LeaderNameSources = PersonNameSources;

/**
 * O rótulo de uma pessoa da Liderança: o nome lido entre as visíveis, "Carregando…", "nome não
 * carregado" ou "Pessoa indisponível", sem nome e sem id (RN-05, UXD-7). Nunca da `member_names`.
 */
export function resolveLeaderLabel(id: string, sources: LeaderNameSources): LeaderLabel {
  return resolvePersonLabel(id, sources, MEMBER_FILTER_TEXTS.leaders);
}
