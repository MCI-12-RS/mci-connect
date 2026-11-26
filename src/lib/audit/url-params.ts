// O estado da Auditoria na URL (E2.05, "Navegação e rotas", AQ-9; UX-12): os filtros `action`,
// `entity`, `status`, `from` e `to` e o registro do histórico (`record_type` e `record_id`). A
// página, o tamanho e a busca ficam com o `useListSearchParams` (E1.08). Os valores padrão não
// aparecem; um valor inválido é ignorado e sai da URL.

import { formatIsoDateBr, parseIsoDate } from "@/lib/dates/sao-paulo";
import { isUuid } from "@/lib/ids";
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  isEventAction,
  isHistoryAction,
  isRecordType,
  isShownEntity,
  type EventAction,
  type RecordType,
  type ShownEntity,
} from "@/lib/audit/events";
import { AUDIT_TEXTS } from "@/lib/audit/texts";

export type AuditStatus = "success" | "error";

export interface AuditFilters {
  action: EventAction | null;
  entity: ShownEntity | null;
  status: AuditStatus | null;
  /** "aaaa-mm-dd", data de Brasília (RN-18), inclusive. */
  from: string | null;
  to: string | null;
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = { action: null, entity: null, status: null, from: null, to: null };

export interface AuditRecordRef {
  type: RecordType;
  id: string;
}

export interface AuditUrlState {
  filters: AuditFilters;
  /** O registro do histórico (T9); `null` na Auditoria toda. */
  record: AuditRecordRef | null;
  /** Os parâmetros com valor inválido, para a tela tirá-los da URL. */
  invalidKeys: string[];
}

export const AUDIT_FILTER_KEYS = ["action", "entity", "status", "from", "to"] as const;
export const AUDIT_RECORD_KEYS = ["record_type", "record_id"] as const;

const isStatus = (value: string): value is AuditStatus => value === "success" || value === "error";
const isDate = (value: string) => parseIsoDate(value) !== null;

/** O fim antes do início (P33): o erro de "Até". */
export function isPeriodInverted(from: string | null, to: string | null): boolean {
  return !!from && !!to && to < from;
}

/** Lê a URL. No histórico de um registro, só valem as ações do histórico e o período (T9). */
export function readAuditUrl(params: URLSearchParams): AuditUrlState {
  const invalidKeys: string[] = [];
  const read = <T extends string>(key: string, valid: (value: string) => value is T): T | null => {
    const value = params.get(key);
    if (value === null) return null;
    if (valid(value)) return value;
    invalidKeys.push(key);
    return null;
  };

  const recordType = params.get("record_type");
  const recordId = params.get("record_id");
  let record: AuditRecordRef | null = null;
  if (recordType !== null || recordId !== null) {
    if (recordType !== null && recordId !== null && isRecordType(recordType) && isUuid(recordId)) {
      record = { type: recordType, id: recordId };
    } else {
      invalidKeys.push(...AUDIT_RECORD_KEYS.filter((key) => params.has(key)));
    }
  }

  const action = read("action", record ? isHistoryAction : isEventAction);
  const entity = record ? null : read("entity", isShownEntity);
  const status = record ? null : read("status", isStatus);
  if (record) invalidKeys.push(...(["entity", "status"] as const).filter((key) => params.has(key)));

  const fromValue = params.get("from");
  const toValue = params.get("to");
  const from = fromValue !== null && isDate(fromValue) ? fromValue : null;
  let to = toValue !== null && isDate(toValue) ? toValue : null;
  if (fromValue !== null && from === null) invalidKeys.push("from");
  if (toValue !== null && to === null) invalidKeys.push("to");
  if (isPeriodInverted(from, to)) {
    invalidKeys.push("to");
    to = null;
  }

  return { filters: { action, entity, status, from, to }, record, invalidKeys };
}

/** Grava os filtros na URL, sem os vazios, e volta para a página 1 (UX-12). */
export function writeAuditFilters(params: URLSearchParams, filters: AuditFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of AUDIT_FILTER_KEYS) {
    const value = filters[key];
    if (value) next.set(key, value);
    else next.delete(key);
  }
  next.delete("page");
  return next;
}

/** Tira da URL os parâmetros inválidos. */
export function withoutKeys(params: URLSearchParams, keys: readonly string[]): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of keys) next.delete(key);
  return next;
}

/** Quantos filtros estão ativos ("Filtros (2)"); a busca não conta (T7). */
export function activeFilterCount(filters: AuditFilters): number {
  return AUDIT_FILTER_KEYS.filter((key) => filters[key] !== null).length;
}

export interface FilterChip {
  key: (typeof AUDIT_FILTER_KEYS)[number];
  text: string;
}

const STATUS_LABELS: Record<AuditStatus, string> = {
  success: AUDIT_TEXTS.filters.success,
  error: AUDIT_TEXTS.filters.error,
};

export function statusLabel(status: AuditStatus): string {
  return STATUS_LABELS[status];
}

/** Os chips dos filtros ativos (T8), na ordem dos controles. */
export function filterChips(filters: AuditFilters): FilterChip[] {
  const CHIPS = AUDIT_TEXTS.chips;
  const chips: FilterChip[] = [];
  if (filters.action) chips.push({ key: "action", text: CHIPS.action(ACTION_LABELS[filters.action]) });
  if (filters.entity) chips.push({ key: "entity", text: CHIPS.entity(ENTITY_LABELS[filters.entity]) });
  if (filters.status) chips.push({ key: "status", text: CHIPS.status(STATUS_LABELS[filters.status]) });
  if (filters.from) chips.push({ key: "from", text: CHIPS.from(formatIsoDateBr(filters.from)) });
  if (filters.to) chips.push({ key: "to", text: CHIPS.to(formatIsoDateBr(filters.to)) });
  return chips;
}
