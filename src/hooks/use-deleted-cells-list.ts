import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { fetchListPage, withSearch, type ListParams, type ListResult } from "@/lib/list-query";
import { DELETED_CELL_SELECT, type DeletedCellRow } from "@/lib/deletion/deleted-lists";

/**
 * Células excluídas que o administrador veria se não estivessem excluídas
 * (E2.01, RN-15, T4), paginadas no servidor, com total exato. Da exclusão
 * mais recente para a mais antiga. A busca usa os campos da lista principal.
 */
export function useDeletedCellsList({ page, pageSize, search }: ListParams) {
  return useQuery({
    queryKey: ["cells", "deleted", { page, pageSize, search }],
    placeholderData: keepPreviousData,
    queryFn: (): Promise<ListResult<DeletedCellRow>> => {
      const patterns = toSearchPatterns(search);
      const [from, to] = toRange(page, pageSize);
      return fetchListPage(
        withSearch(supabase.from("cells_deleted_view").select(DELETED_CELL_SELECT, { count: "exact" }), patterns)
          .order("deleted_at", { ascending: false })
          .order("id")
          .range(from, to),
        () => withSearch(supabase.from("cells_deleted_view").select("id", { count: "exact", head: true }), patterns),
      );
    },
  });
}
