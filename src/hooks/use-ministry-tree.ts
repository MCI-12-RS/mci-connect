import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { retryUnlessPermissionDenied } from "@/lib/errors";
import { toMinistryTreeItem, type MinistryTreeItem } from "@/lib/ministries/tree";

/** Uma linha da RPC `ministry_tree_nodes`, como o `types.ts` a descreve. */
export type MinistryTreeNodeRow = Database["public"]["Functions"]["ministry_tree_nodes"]["Returns"][number];

/**
 * A árvore muda pouco: recolher e reabrir um nó nesse intervalo não repete a
 * chamada. Salvar um membro invalida `["members"]` e atualiza a árvore.
 */
const MINISTRY_TREE_STALE_TIME_MS = 5 * 60_000;

/**
 * Um nível da árvore numa chamada só (E1.08, RN-10), já ordenado pelo nome:
 * sem `parentIds`, as raízes de quem consulta; com os ids de um nó (principal
 * e cônjuge), os filhos dele. Cada item é um nó, com os totais (RN-09), ou a
 * referência de quem aparece com o cônjuge mais acima (T4). Quem não vê
 * ninguém recebe uma lista vazia.
 */
export function useMinistryTree(parentIds: readonly string[] | null, { enabled = true } = {}) {
  return useQuery({
    queryKey: ["members", "ministry-tree", parentIds ?? "roots"],
    enabled,
    staleTime: MINISTRY_TREE_STALE_TIME_MS,
    retry: retryUnlessPermissionDenied,
    queryFn: async (): Promise<MinistryTreeItem[]> => {
      const { data, error } = await (parentIds
        ? supabase.rpc("ministry_tree_nodes", { _parent_ids: [...parentIds] })
        : supabase.rpc("ministry_tree_nodes"));
      if (error) throw error;
      return (data ?? []).map(toMinistryTreeItem);
    },
  });
}
