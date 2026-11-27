import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { classifyWriteError, refreshesList, type WriteResult } from "@/lib/deletion/outcome";
import { CELL_DELETION_TEXTS } from "@/lib/deletion/texts";
import { refreshAfterCellWrite } from "@/lib/query-refresh";

/**
 * Recarrega o que muda quando uma célula sai das listas, fica inativa ou
 * volta: a lista e os seletores de Células, os relatórios (que mostram os
 * dados da célula), os membros (vínculo celular, totais e a árvore de
 * Ministérios) e o Dashboard, sem mostrar o valor de antes (E2.06, P44 e AQ-6).
 */
export function useRefreshCellData() {
  const queryClient = useQueryClient();
  return () => refreshAfterCellWrite(queryClient);
}

/**
 * Exclusão lógica pela RPC `delete_cell` (E2.01, RN-01 e RN-11): os relatórios
 * da célula ficam. Não lança: resolve com o resultado classificado. Fica
 * pendente até a lista recarregar.
 *
 * `onDeleted` (o detalhe da célula, E2.10, AQ-10): na exclusão feita, quem
 * chama cuida da ordem (descarta a lista, volta para ela e só então
 * recarrega), para a lista nunca mostrar a célula excluída vinda do cache.
 */
export function useDeleteCell({ onDeleted }: { onDeleted?: () => void } = {}) {
  const refresh = useRefreshCellData();
  return useMutation({
    mutationFn: async (cellId: string): Promise<WriteResult> => {
      const { error } = await supabase.rpc("delete_cell", { _cell_id: cellId });
      return error ? classifyWriteError(error) : { kind: "done" };
    },
    onSuccess: async (result) => {
      if (result.kind === "done" && onDeleted) onDeleted();
      else if (refreshesList(result)) await refresh();
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
