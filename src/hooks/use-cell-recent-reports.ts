import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RECENT_REPORTS_LIMIT, type CellRecentReport } from "@/lib/cells/detail";

export const cellRecentReportsKey = (cellId: string) => ["cells", "detail", cellId, "reports"] as const;

/**
 * Tira um relatório dos últimos da célula no cache (E2.12, T14, como a DA-12 na lista): depois de
 * excluir pela consulta, o detalhe não mostra o excluído enquanto recarrega.
 */
export function removeReportFromRecentCache(queryClient: QueryClient, cellId: string, reportId: string): void {
  queryClient.setQueryData<CellRecentReport[]>(cellRecentReportsKey(cellId), (data) =>
    data?.some((report) => report.id === reportId) ? data.filter((report) => report.id !== reportId) : data,
  );
}

/**
 * Os até 10 relatórios mais recentes de uma célula, visíveis e não excluídos,
 * com os números e as setas (E2.10, RN-17, RN-18 e RN-20; `cell_recent_reports`).
 * Vazio para quem não vê a célula (DA-4). Fica sob `["cells", "detail", id]`:
 * as gravações de célula e de relatório já recarregam (AQ-10).
 */
export function useCellRecentReports(cellId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: cellRecentReportsKey(cellId),
    enabled,
    queryFn: async (): Promise<CellRecentReport[]> => {
      const { data, error } = await supabase.rpc("cell_recent_reports", {
        _cell_id: cellId,
        _limit: RECENT_REPORTS_LIMIT,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
}
