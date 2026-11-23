import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { retryUnlessPermissionDenied } from "@/lib/errors";

/**
 * Um nó da árvore de ministérios: um casal (o homem como principal) com as
 * contagens. `spouse_id` e `spouse_name` são nulos quando não há cônjuge
 * visível e ativo. `direct_disciples > 0` garante que abrir o nó traz ao menos
 * um filho.
 */
export type MinistryTreeNode = Database["public"]["Functions"]["ministry_tree_nodes"]["Returns"][number];

/**
 * A árvore muda pouco: recolher e reabrir um nó nesse intervalo não repete a
 * chamada. Salvar um membro invalida `["members"]` e atualiza a árvore.
 */
const MINISTRY_TREE_STALE_TIME_MS = 5 * 60_000;

/**
 * Um nível da árvore numa chamada só (E1.08, RN-10), já ordenado pelo nome:
 * sem `parentIds`, as raízes (pastores ativos visíveis); com os ids de um nó
 * (principal e cônjuge), os filhos dele. Quem não vê nenhum pastor recebe uma
 * lista vazia.
 */
export function useMinistryTree(parentIds: readonly string[] | null, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["members", "ministry-tree", parentIds ?? "roots"],
    enabled,
    staleTime: MINISTRY_TREE_STALE_TIME_MS,
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<MinistryTreeNode[]> => {
      const { data, error } = await (parentIds
        ? supabase.rpc("ministry_tree_nodes", { _parent_ids: [...parentIds] })
        : supabase.rpc("ministry_tree_nodes"));
      if (error) throw error;
      return data ?? [];
    },
  });
}
