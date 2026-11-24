import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  classifyWriteError,
  parseDeletionCheck,
  refreshesList,
  type DeletionCheck,
  type WriteResult,
} from "@/lib/deletion/outcome";
import { MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";

/** Resultado de uma gravação do fluxo de exclusão: feita, ou a falha já classificada. */
export type MemberWriteResult = WriteResult;

/**
 * Recarrega o que muda quando um cadastro sai das listas ou fica inativo: a
 * lista de Membros, os seletores, a árvore de Ministérios (todos em
 * `["members", …]`) e os números do Dashboard.
 */
export function useRefreshMemberData() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["members"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
}

/**
 * Pré-checagem da exclusão (E2.01, AQ-1 e UXD-2): o que impede excluir o
 * membro, sem gravar nada. Consulta a cada abertura do diálogo e não tenta de
 * novo: se falhar, a confirmação abre e o servidor confere no envio.
 */
export function useMemberDeletionCheck(memberId: string) {
  return useQuery({
    queryKey: ["member-deletion-check", memberId],
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<DeletionCheck> => {
      const { data, error } = await supabase.rpc("check_member_deletion", { _member_id: memberId });
      if (error) throw error;
      const check = parseDeletionCheck(data);
      if (!check) throw new Error("Resposta inesperada de check_member_deletion");
      return check;
    },
  });
}

/**
 * Exclusão lógica pela RPC `delete_member` (RN-01). Não lança: resolve com o
 * resultado classificado (recusa de regra, sem permissão, queda de conexão).
 * Fica pendente até a lista recarregar.
 */
export function useDeleteMember() {
  const refresh = useRefreshMemberData();
  return useMutation({
    mutationFn: async (memberId: string): Promise<MemberWriteResult> => {
      const { error } = await supabase.rpc("delete_member", { _member_id: memberId });
      return error ? classifyWriteError(error) : { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesList(result)) await refresh();
    },
  });
}

/**
 * Atalho "Marcar como inativo" (E2.01, UXD-3 e AQ-11): grava só
 * `is_active = false`, pelo caminho de edição de hoje (`edit_member`). Pede o
 * `id` de volta: sem linha, o cadastro não existe mais ou foi excluído (DT-19).
 */
export function useMarkMemberInactive() {
  const refresh = useRefreshMemberData();
  return useMutation({
    mutationFn: async (memberId: string): Promise<MemberWriteResult> => {
      const { data, error } = await supabase
        .from("members")
        .update({ is_active: false })
        .eq("id", memberId)
        .select("id");
      if (error) return classifyWriteError(error);
      if (!data?.length) return { kind: "gone", message: MEMBER_DELETION_TEXTS.notFoundOrDeleted };
      return { kind: "done" };
    },
    onSuccess: async (result) => {
      if (refreshesList(result)) await refresh();
    },
  });
}
