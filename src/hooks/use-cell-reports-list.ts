import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { fetchListPage, withSearch, type ListParams, type ListResult } from "@/lib/list-query";
import {
  CELL_REPORT_ROW_SELECT,
  PARTICIPANT_COUNT_SELECT,
  withParticipantCounts,
  type CellReportRow,
} from "@/lib/cell-reports/fields";

/**
 * Relatórios visíveis, paginados no servidor, com total exato (E1.08, RN-01 a
 * RN-04). Da data mais recente para a mais antiga.
 *
 * O número de participantes vem de uma segunda consulta, só com os ids da
 * página: pedido junto com a página, ele seria calculado para todos os
 * relatórios visíveis (ver CELL_REPORT_ROW_SELECT).
 *
 * `cellId` é o filtro Célula (E2.10, RN-19): só os relatórios visíveis daquela célula, na página e
 * no total.
 */
export function useCellReportsList({ page, pageSize, search }: ListParams, cellId: string | null = null) {
  return useQuery({
    queryKey: ["cell_reports", "list", { page, pageSize, search, cellId }],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListResult<CellReportRow>> => {
      const patterns = toSearchPatterns(search);
      const [from, to] = toRange(page, pageSize);
      let pageQuery = withSearch(supabase.from("cell_reports_view").select(CELL_REPORT_ROW_SELECT, { count: "exact" }), patterns);
      if (cellId) pageQuery = pageQuery.eq("cell_id", cellId);
      const countAll = () => {
        const countQuery = withSearch(supabase.from("cell_reports_view").select("id", { count: "exact", head: true }), patterns);
        return cellId ? countQuery.eq("cell_id", cellId) : countQuery;
      };
      const { rows, total } = await fetchListPage(
        pageQuery
          .order("date", { ascending: false })
          .order("time", { ascending: false })
          .order("id")
          .range(from, to),
        countAll,
      );
      if (rows.length === 0) return { rows: [], total };

      const { data: counts, error } = await supabase
        .from("cell_reports_view")
        .select(PARTICIPANT_COUNT_SELECT)
        .in(
          "id",
          rows.map((r) => r.id),
        );
      if (error) throw error;
      return { rows: withParticipantCounts(rows, counts ?? []), total };
    },
  });
}
