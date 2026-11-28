import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ListParams, ListResult } from "@/lib/list-query";
import { CELL_REPORT_LIST_SELECT, type CellReportListRow } from "@/lib/cell-reports/fields";
import { EMPTY_CELL_REPORT_FILTERS, toCellReportsListArgs, type CellReportFilters } from "@/lib/cell-reports/filters";

/** A chave das páginas da lista (a exclusão pela consulta tira o relatório delas, DA-12). */
export const CELL_REPORTS_LIST_KEY = ["cell_reports", "list"] as const;

/**
 * Relatórios visíveis, filtrados e paginados no servidor, com o total exato (E2.12, RN-01 a RN-03):
 * a página pela `cell_reports_list` e o total pela `cell_reports_list_count`, em paralelo. A ordem
 * (data e horário mais recentes primeiro, RN-13) é a da RPC: nada de `.order()` aqui. O número de
 * participantes vem na linha, calculado só para a página (DT-03).
 */
export function useCellReportsList(
  { page, pageSize, search }: ListParams,
  filters: CellReportFilters = EMPTY_CELL_REPORT_FILTERS,
) {
  return useQuery({
    queryKey: [...CELL_REPORTS_LIST_KEY, { page, pageSize, search, filters }],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListResult<CellReportListRow>> => {
      const args = toCellReportsListArgs(filters, search);
      const [rowsResult, countResult] = await Promise.all([
        supabase
          .rpc("cell_reports_list", { ...args, _limit: pageSize, _offset: (page - 1) * pageSize })
          .select(CELL_REPORT_LIST_SELECT),
        supabase.rpc("cell_reports_list_count", args),
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (countResult.error) throw countResult.error;
      return { rows: rowsResult.data ?? [], total: countResult.data ?? 0 };
    },
  });
}
