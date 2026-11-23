import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { fetchListPage, withSearch, type ListParams, type ListResult } from "@/lib/list-query";
import { CELL_ROW_SELECT, type CellRow } from "@/lib/cells/fields";

/**
 * Células visíveis, paginadas no servidor, com total exato (E1.08, RN-01 a
 * RN-04). Da cadastrada mais recentemente para a mais antiga.
 */
export function useCellsList({ page, pageSize, search }: ListParams) {
  return useQuery({
    queryKey: ["cells", "list", { page, pageSize, search }],
    placeholderData: keepPreviousData,
    queryFn: (): Promise<ListResult<CellRow>> => {
      const patterns = toSearchPatterns(search);
      const [from, to] = toRange(page, pageSize);
      return fetchListPage(
        withSearch(supabase.from("cells_view").select(CELL_ROW_SELECT, { count: "exact" }), patterns)
          .order("created_at", { ascending: false })
          .order("id")
          .range(from, to),
        () => withSearch(supabase.from("cells_view").select("id", { count: "exact", head: true }), patterns),
      );
    },
  });
}
