import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Os nomes das pessoas escolhidas num filtro, lidos só entre as visíveis (`members_view` por id;
 * E2.07, DT-12 e AQ-2). Quem não volta (fora do escopo, excluído ou inexistente) fica sem nome e
 * aparece como "Pessoa indisponível". Nunca pela `member_names`, que resolve nomes fora do escopo.
 */
export function useVisibleMemberNames(ids: readonly string[]) {
  return useQuery({
    queryKey: ["members", "visible-names", ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<ReadonlyMap<string, string>> => {
      const { data, error } = await supabase.from("members_view").select("id, name").in("id", [...ids]);
      if (error) throw error;
      const names = new Map<string, string>();
      for (const row of data ?? []) if (row.id) names.set(row.id, row.name ?? "");
      return names;
    },
  });
}
