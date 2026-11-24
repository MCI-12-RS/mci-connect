import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { classifyWriteError, refreshesList, type WriteResult } from "@/lib/deletion/outcome";

/**
 * Recarrega o que muda quando um relatório sai das listas e das somas: os
 * relatórios, as células (último relatório e pendentes) e os números do
 * Dashboard.
 */
export function useRefreshCellReportData() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] }),
      queryClient.invalidateQueries({ queryKey: ["cells"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

/**
 * Exclusão lógica pela RPC `delete_cell_report` (E2.01, RN-01 e RN-12): os
 * participantes ficam guardados com o relatório. Vale também para relatório
 * de célula excluída (RN-11). Não lança: resolve com o resultado
 * classificado. Fica pendente até a lista recarregar.
 */
export function useDeleteCellReport() {
  const refresh = useRefreshCellReportData();
  return useMutation({
    mutationFn: async (reportId: string): Promise<WriteResult> => {
      const { error } = await supabase.rpc("delete_cell_report", { _report_id: reportId });
      return error ? classifyWriteError(error) : { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesList(result)) await refresh();
    },
  });
}
