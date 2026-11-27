import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { RECENT_REPORTS_LIMIT, type CellRecentReport } from "@/lib/cells/detail";

/**
 * Os até 10 relatórios mais recentes de uma célula, visíveis e não excluídos,
 * com os números e as setas (E2.10, RN-17, RN-18 e RN-20; `cell_recent_reports`).
 * Vazio para quem não vê a célula (DA-4). Fica sob `["cells", "detail", id]`:
 * as gravações de célula e de relatório já recarregam (AQ-10).
 */
export function useCellRecentReports(cellId: string, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["cells", "detail", cellId, "reports"],
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
