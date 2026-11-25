import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRefreshCellData } from "@/hooks/use-cell-deletion";
import {
  classifyRestoreError,
  parseMemberRestoreOutcome,
  refreshesAfterRestore,
  type MemberRestoreResult,
  type RestoreResult,
} from "@/lib/deletion/restore";
import { refreshAfterMemberWrite } from "@/lib/query-refresh";

// Restauração pelas RPCs `restore_*` (E2.01, RN-15 a RN-17), só para quem tem
// `manage_roles`. Os hooks não lançam: resolvem com o resultado já
// classificado e ficam pendentes até as listas recarregarem, para o item sair
// da lista junto com o fim do "Restaurando…".

/**
 * Recarrega o que muda quando um membro volta: Membros (lista, seletores,
 * árvore de Ministérios e Excluídos), Células (inclusive as excluídas, que
 * marcam as pessoas excluídas), Relatórios e o Dashboard, sem mostrar o valor
 * de antes (E2.06, P44 e AQ-6).
 */
function useRefreshAfterMemberRestore() {
  const queryClient = useQueryClient();
  return () => refreshAfterMemberWrite(queryClient);
}

/**
 * Recarrega o que muda quando um relatório volta: os relatórios (inclusive os
 * excluídos, que dizem se a semana está ocupada), as células (último
 * relatório e pendentes), o vínculo celular dos membros e o Dashboard.
 */
function useRefreshAfterCellReportRestore() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] }),
      queryClient.invalidateQueries({ queryKey: ["cells"] }),
      queryClient.invalidateQueries({ queryKey: ["members"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

/** Restaura um membro (RN-16): volta sem cônjuge, sem líder se o líder foi excluído, e com a função padrão se a dele foi apagada. */
export function useRestoreMember() {
  const refresh = useRefreshAfterMemberRestore();
  return useMutation({
    mutationFn: async (memberId: string): Promise<MemberRestoreResult> => {
      const { data, error } = await supabase.rpc("restore_member", { _member_id: memberId });
      if (error) return classifyRestoreError(error);
      return { kind: "done", outcome: parseMemberRestoreOutcome(data) };
    },
    onSuccess: async (result) => {
      if (refreshesAfterRestore(result)) await refresh();
    },
  });
}

/** Restaura uma célula (RN-17): recusada se o líder, o timóteo ou o anfitrião foi excluído. */
export function useRestoreCell() {
  const refresh = useRefreshCellData();
  return useMutation({
    mutationFn: async (cellId: string): Promise<RestoreResult> => {
      const { error } = await supabase.rpc("restore_cell", { _cell_id: cellId });
      return error ? classifyRestoreError(error) : { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesAfterRestore(result)) await refresh();
    },
  });
}

/** Restaura um relatório (RN-17): recusado se a célula já tem outro relatório na mesma semana. */
export function useRestoreCellReport() {
  const refresh = useRefreshAfterCellReportRestore();
  return useMutation({
    mutationFn: async (reportId: string): Promise<RestoreResult> => {
      const { error } = await supabase.rpc("restore_cell_report", { _report_id: reportId });
      return error ? classifyRestoreError(error) : { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesAfterRestore(result)) await refresh();
    },
  });
}
