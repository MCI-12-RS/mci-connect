import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { classifyWriteError, refreshesList, type WriteResult } from "@/lib/deletion/outcome";
import { refreshAfterReportWrite } from "@/lib/query-refresh";

/**
 * Recarrega o que muda quando um relatório sai das listas e das somas: os
 * relatórios, as células (a situação do relatório), o vínculo celular dos
 * membros e os números do Dashboard, sem mostrar o valor de antes nas telas
 * fechadas (E2.09, RN-09 e AQ-3).
 */
export function useRefreshCellReportData() {
  const queryClient = useQueryClient();
  return () => refreshAfterReportWrite(queryClient);
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
