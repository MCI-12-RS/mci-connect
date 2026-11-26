import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { fetchListPage, withSearch, type ListParams, type ListResult } from "@/lib/list-query";
import { AUDIT_EVENT_SELECT, HISTORY_ACTIONS, toAuditEvent, type AuditEvent, type EventAction } from "@/lib/audit/events";
import type { AuditFilters, AuditRecordRef } from "@/lib/audit/url-params";

export interface EventsListParams extends ListParams {
  filters: AuditFilters;
  record: AuditRecordRef | null;
}

/** Um filtro do PostgREST (tabela da AQ-2), aplicado igual à página e à contagem. */
type EventFilter =
  | { op: "eq"; column: "entity" | "entity_id" | "action"; value: string }
  | { op: "eqBool"; column: "success"; value: boolean }
  | { op: "in"; column: "action"; values: readonly EventAction[] }
  | { op: "gte" | "lte"; column: "occurred_on"; value: string };

function eventFilters({ filters, record }: EventsListParams): EventFilter[] {
  const list: EventFilter[] = [];
  if (record) {
    list.push({ op: "eq", column: "entity", value: record.type });
    list.push({ op: "eq", column: "entity_id", value: record.id });
    list.push({ op: "in", column: "action", values: HISTORY_ACTIONS });
  } else {
    if (filters.entity) list.push({ op: "eq", column: "entity", value: filters.entity });
    if (filters.status) list.push({ op: "eqBool", column: "success", value: filters.status === "success" });
  }
  if (filters.action) list.push({ op: "eq", column: "action", value: filters.action });
  if (filters.from) list.push({ op: "gte", column: "occurred_on", value: filters.from });
  if (filters.to) list.push({ op: "lte", column: "occurred_on", value: filters.to });
  return list;
}

/**
 * Os eventos da Auditoria (E2.05, T7 e T9; RN-18, RN-19, AQ-2, DT-12), da `events_view`, paginados no
 * servidor com o total exato, do mais recente para o mais antigo. Sem "Visualizar Auditoria", a view
 * responde 42501 e a tela nem chama este hook (P13).
 */
export function useEventsList(params: EventsListParams, { enabled = true } = {}) {
  const { page, pageSize, search, filters, record } = params;
  return useQuery({
    queryKey: ["events", "list", { page, pageSize, search, filters, record }],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListResult<AuditEvent>> => {
      const [from, to] = toRange(page, pageSize);
      const patterns = toSearchPatterns(search);
      // A página e a contagem (só pedida quando a página passa do fim) com os mesmos filtros.
      const filtered = (head: boolean) => {
        let query = withSearch(supabase.from("events_view").select(AUDIT_EVENT_SELECT, { count: "exact", head }), patterns);
        for (const filter of eventFilters(params)) {
          switch (filter.op) {
            case "eq":
              query = query.eq(filter.column, filter.value);
              break;
            case "eqBool":
              query = query.eq(filter.column, filter.value);
              break;
            case "in":
              query = query.in(filter.column, filter.values);
              break;
            case "gte":
              query = query.gte(filter.column, filter.value);
              break;
            case "lte":
              query = query.lte(filter.column, filter.value);
              break;
          }
        }
        return query;
      };
      const result = await fetchListPage(
        filtered(false).order("occurred_at", { ascending: false }).order("seq", { ascending: false }).range(from, to),
        () => filtered(true),
      );
      return {
        rows: result.rows.flatMap((row) => {
          const event = toAuditEvent(row);
          return event ? [event] : [];
        }),
        total: result.total,
      };
    },
  });
}
