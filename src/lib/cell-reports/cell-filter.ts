// O filtro Célula da lista de Relatórios (E2.10, RN-19, T15 e P84): ler e limpar o `cell` da URL, o
// texto do chip a partir da `cell_identity` e o "Limpar filtros". Sem React e sem Supabase.

import { isUuid } from "@/lib/filters/url";
import { formatMeetingTime } from "@/lib/cells/labels";
import { leaderLabel } from "@/lib/deletion/targets";
import type { RecordFilterChipState } from "@/lib/filters/record-chip";
import { CELL_REPORT_FILTER_TEXTS } from "./texts";

/** O parâmetro da URL (`/cell-reports?cell=<id>`). */
export const CELL_PARAM = "cell";

export interface ParsedCellReportFilter {
  /** O id da célula, só com o formato de UUID. */
  cellId: string | null;
  /** A URL sem o `cell` sem formato; `null` se já estava limpa. */
  cleanParams: URLSearchParams | null;
}

/** Lê o `cell`; um valor sem formato de UUID sai da URL (P84). */
export function parseCellReportFilter(params: URLSearchParams): ParsedCellReportFilter {
  const raw = params.get(CELL_PARAM);
  if (raw === null) return { cellId: null, cleanParams: null };
  if (isUuid(raw)) return { cellId: raw, cleanParams: null };
  const clean = new URLSearchParams(params);
  clean.delete(CELL_PARAM);
  return { cellId: null, cleanParams: clean };
}

/** Tira só o filtro Célula e volta para a página 1 (o chip). */
export function removeCellReportFilter(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete(CELL_PARAM);
  next.delete("page");
  return next;
}

/** "Limpar filtros": tira `cell`, a busca e a página; mantém `size` e o `report` do E2.01. */
export function clearCellReportFilters(params: URLSearchParams): URLSearchParams {
  const next = removeCellReportFilter(params);
  next.delete("q");
  return next;
}

/** A identificação da célula (`cell_identity`): os valores atuais dela (DA-10). */
export interface CellIdentity {
  leader_name: string | null;
  meeting_day: string | null;
  meeting_time: string | null;
}

/** "Célula de André Souza · Quarta · 20:00": o dia como gravado, que já é a forma curta. */
export function cellIdentityChipText(identity: CellIdentity): string {
  return CELL_REPORT_FILTER_TEXTS.chipText(
    leaderLabel(identity.leader_name),
    identity.meeting_day ?? "",
    formatMeetingTime(identity.meeting_time),
  );
}

/** O estado do chip: carregando, não carregada, indisponível (nenhuma linha) ou a célula. */
export function cellChipState(query: {
  data: CellIdentity | null | undefined;
  isError: boolean;
}): RecordFilterChipState {
  if (query.data === undefined) return query.isError ? { kind: "failed" } : { kind: "loading" };
  if (query.data === null) return { kind: "unavailable" };
  return { kind: "ready", text: cellIdentityChipText(query.data) };
}
