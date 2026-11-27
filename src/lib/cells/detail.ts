// Regras de tela do detalhe da célula (E2.10, T8 a T13, RN-14 a RN-20). Sem
// React e sem Supabase: o complemento, o endereço, o caminho de volta, o
// cabeçalho de cada relatório e o recorte dos últimos relatórios.
import { canSeeRoute, type Access } from "@/lib/access/access";
import { cepDigits, CEP_LENGTH, maskCep } from "@/lib/address/cep";
import type { Authorship } from "@/lib/audit/authorship";
import { formatIsoDateBr, parseIsoDate } from "@/lib/dates/sao-paulo";
import { formatMeetingTime } from "./labels";
import { WEEKDAYS } from "./weekdays";
import { CELL_DETAIL_TEXTS as TEXTS } from "./detail-texts";

/**
 * Um relatório de `cell_recent_reports` (E2.10, migration 2). O `types.ts`
 * mostra tudo como não nulo (`RETURNS TABLE`), mas o texto opcional, a oferta
 * do legado e as setas podem vir nulos: o tipo daqui é o que a tela trata.
 */
export interface CellRecentReport {
  id: string;
  date: string;
  time: string | null;
  was_held: boolean | null;
  theme: string | null;
  reason_not_held: string | null;
  observations: string | null;
  offering: number | null;
  participants_count: number | null;
  visitors_count: number | null;
  participants_trend: number | null;
  visitors_trend: number | null;
}

/** Quantos relatórios a RPC devolve (o gráfico, RN-20) e quantos aparecem em "Últimos relatórios" (RN-17). */
export const RECENT_REPORTS_LIMIT = 10;
export const RECENT_REPORTS_SHOWN = 3;

/** Os relatórios de "Últimos relatórios": os 3 primeiros, já do mais recente para o mais antigo. */
export function shownReports<T>(reports: readonly T[]): T[] {
  return reports.slice(0, RECENT_REPORTS_SHOWN);
}

export interface MeetingParts {
  day: string;
  time: string;
  type: string;
}

/**
 * As partes do complemento do título (RN-15 c): "Quarta · 20:00 ·
 * Evangelística", com o dia na forma curta (a gravada). As vazias saem.
 */
export function meetingParts(cell: {
  meeting_day: string | null;
  meeting_time: string | null;
  type: string | null;
}): string[] {
  return [cell.meeting_day ?? "", formatMeetingTime(cell.meeting_time), cell.type ?? ""].filter((part) => part !== "");
}

export interface AddressSource {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
}

/**
 * O endereço da célula em até quatro linhas, sem as partes vazias (RN-15 d,
 * T8): "{Rua}, {Número}" ("s/n" sem número), o complemento, "{Bairro} ·
 * {Cidade}, {UF}" e "CEP 00000-000". Sem nenhuma parte, lista vazia ("Sem endereço").
 */
export function addressLines(cell: AddressSource): string[] {
  const clean = (value: string | null) => (value ?? "").trim();
  const street = clean(cell.street);
  const number = clean(cell.number);
  const lines: string[] = [];
  if (street) lines.push(`${street}, ${number || TEXTS.noNumber}`);
  else if (number) lines.push(number);
  const complement = clean(cell.complement);
  if (complement) lines.push(complement);
  const cityState = [clean(cell.city), clean(cell.state)].filter(Boolean).join(", ");
  const place = [clean(cell.neighborhood), cityState].filter(Boolean).join(" · ");
  if (place) lines.push(place);
  const cep = cepDigits(cell.zip_code);
  if (cep.length === CEP_LENGTH) lines.push(TEXTS.cep(maskCep(cep)));
  else if (clean(cell.zip_code)) lines.push(TEXTS.cep(clean(cell.zip_code)));
  return lines;
}

export type BackLink = { kind: "history"; label: string } | { kind: "link"; label: string; to: string };

/**
 * O caminho de volta (RN-14, UXD-10, AQ-8): vindo da lista, o voltar do
 * histórico (a URL da lista com filtros, busca e página); aberto por link,
 * `/cells`; sem a lista de Células, "Ir para o início".
 */
export function backLink(access: Access | null | undefined, cameFromList: boolean): BackLink {
  if (!canSeeRoute(access, "/cells")) return { kind: "link", label: TEXTS.back.home, to: "/" };
  if (cameFromList) return { kind: "history", label: TEXTS.back.list };
  return { kind: "link", label: TEXTS.back.list, to: "/cells" };
}

/** O endereço do detalhe de uma célula (E2.10, P80). */
export function cellDetailPath(cellId: string): string {
  return `/cells/${cellId}`;
}

/** O estado da navegação que a lista põe no link do detalhe (P81). */
export interface CellDetailLocationState {
  fromList: true;
}

/** O detalhe foi aberto pela lista? (o estado da navegação traz `fromList`). */
export function cameFromList(state: unknown): boolean {
  return typeof state === "object" && state !== null && "fromList" in state && state.fromList === true;
}

/** O dia da semana de uma data do calendário ("2026-11-18" → "Quarta"); vazio se não for uma data. */
export function weekdayOfDate(date: string): string {
  const parsed = parseIsoDate(date);
  if (!parsed) return "";
  const index = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
  return WEEKDAYS[index];
}

/** O cabeçalho de cada relatório (T11): "Quarta, 18/11/2026 às 20:00". */
export function reportHeading(report: { date: string; time: string | null }): string {
  return TEXTS.reports.heading(weekdayOfDate(report.date), formatIsoDateBr(report.date), formatMeetingTime(report.time));
}

/** A autoria da célula lida junto com o detalhe (RN-15 g; E2.05, P30): o bloco não lê de novo. */
export function cellAuthorship(cell: {
  created_at: string | null;
  created_by_kind: Authorship["created_by_kind"];
  created_by_name: string | null;
  updated_at?: string | null;
  updated_by_kind: Authorship["updated_by_kind"];
  updated_by_name: string | null;
}): Authorship {
  return {
    created_at: cell.created_at,
    created_by_kind: cell.created_by_kind,
    created_by_name: cell.created_by_name,
    updated_at: cell.updated_at ?? null,
    updated_by_kind: cell.updated_by_kind,
    updated_by_name: cell.updated_by_name,
  };
}
