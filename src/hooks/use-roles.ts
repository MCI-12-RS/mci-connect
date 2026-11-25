import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { refreshAccess } from "@/hooks/use-access";
import { retryUnlessPermissionDenied } from "@/lib/errors";
import { rolesFromView, type Role, type SaveRoleArgs } from "@/lib/roles/roles";

// Tela de Funções (E2.02, T2 a T4): a leitura vem só da `roles_view` e as
// gravações só das RPCs `save_role` e `delete_role`, nunca das tabelas
// `roles` e `role_permissions` (risco 7).

/** Prefixo de tudo o que depende das funções (a lista daqui e o seletor do cadastro de membro). */
const ROLES_KEY = ["roles"] as const;
const ROLES_VIEW_KEY = [...ROLES_KEY, "view"] as const;

/** As funções, na ordem da lista (T2). */
export function useRoles() {
  return useQuery({
    queryKey: ROLES_VIEW_KEY,
    queryFn: async (): Promise<Role[]> => {
      const { data, error } = await supabase
        .from("roles_view")
        .select("id, name, description, is_protected, is_default, permissions, members_count, updated_at");
      if (error) throw error;
      return rolesFromView(data ?? []);
    },
    retry: retryUnlessPermissionDenied,
  });
}

/**
 * Recarrega o que muda com uma função: a lista, o seletor de função e o
 * acesso de quem está logado (a própria função pode ter mudado).
 */
function useRefreshRoles() {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: ROLES_KEY }), refreshAccess(queryClient)]);
}

/**
 * Cria ou atualiza uma função numa chamada só, inclusive a troca da padrão
 * (RN-19). Lança o erro do Supabase: a recusa 42501 passa pelo
 * `MutationCache` (releitura do acesso e da sessão), e a tela classifica.
 */
export function useSaveRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: async (args: SaveRoleArgs): Promise<string> => {
      const { data, error } = await supabase.rpc("save_role", args);
      if (error) throw error;
      return data;
    },
    onSuccess: () => refresh(),
  });
}

/** Exclui uma função pela `delete_role` (RN-20). Lança o erro, como a gravação. */
export function useDeleteRole() {
  const refresh = useRefreshRoles();
  return useMutation({
    mutationFn: async (roleId: string): Promise<void> => {
      const { error } = await supabase.rpc("delete_role", { _role_id: roleId });
      if (error) throw error;
    },
    onSuccess: () => refresh(),
  });
}

/** Recarrega a lista depois de uma recusa que diz que a função mudou em outra tela. */
export function useReloadRoles() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROLES_KEY });
}
