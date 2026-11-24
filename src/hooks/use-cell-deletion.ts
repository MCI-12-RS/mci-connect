import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { classifyWriteError, refreshesList, type WriteResult } from "@/lib/deletion/outcome";
import { CELL_DELETION_TEXTS } from "@/lib/deletion/texts";

/**
 * Recarrega o que muda quando uma célula sai das listas ou fica inativa: a
 * lista e os seletores de Células, os relatórios (que mostram os dados da
 * célula), os membros (vínculo celular, totais e a árvore de Ministérios) e
 * os números do Dashboard.
 */
export function useRefreshCellData() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cells"] }),
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] }),
      queryClient.invalidateQueries({ queryKey: ["members"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

/**
 * Exclusão lógica pela RPC `delete_cell` (E2.01, RN-01 e RN-11): os relatórios
 * da célula ficam. Não lança: resolve com o resultado classificado. Fica
 * pendente até a lista recarregar.
 */
export function useDeleteCell() {
  const refresh = useRefreshCellData();
  return useMutation({
    mutationFn: async (cellId: string): Promise<WriteResult> => {
      const { error } = await supabase.rpc("delete_cell", { _cell_id: cellId });
      return error ? classifyWriteError(error) : { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesList(result)) await refresh();
    },
  });
}

/**
 * Atalho "Marcar como inativa" (E2.01, UXD-3 e AQ-11): grava só
 * `is_active = false`, pelo caminho de edição de hoje (`edit_cell`). Pede o
 * `id` de volta: sem linha, a célula não existe mais ou foi excluída (DT-19).
 */
export function useMarkCellInactive() {
  const refresh = useRefreshCellData();
  return useMutation({
    mutationFn: async (cellId: string): Promise<WriteResult> => {
      const { data, error } = await supabase.from("cells").update({ is_active: false }).eq("id", cellId).select("id");
      if (error) return classifyWriteError(error);
      if (!data?.length) return { kind: "gone", message: CELL_DELETION_TEXTS.notFoundOrDeleted };
      return { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesList(result)) await refresh();
    },
  });
}
