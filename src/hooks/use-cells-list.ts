import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toRange } from "@/lib/pagination";
import { toSearchPatterns } from "@/lib/search";
import { fetchListPage, withSearch, type ListParams, type ListResult } from "@/lib/list-query";
import { CELL_LIST_SELECT, type CellListRow } from "@/lib/cells/fields";

/**
 * Células visíveis, paginadas no servidor, com total exato (E1.08, RN-01 a
 * RN-04). Da cadastrada mais recentemente para a mais antiga. Cada linha
 * traz a situação do relatório, calculada pelo servidor com um "agora" só para
 * a página (E2.09, AQ-2); o total não a pede.
 */
export function useCellsList({ page, pageSize, search }: ListParams) {
  return useQuery({
    queryKey: ["cells", "list", { page, pageSize, search }],
    placeholderData: keepPreviousData,
    queryFn: (): Promise<ListResult<CellListRow>> => {
      const patterns = toSearchPatterns(search);
      const [from, to] = toRange(page, pageSize);
      return fetchListPage(
        withSearch(supabase.from("cells_view").select(CELL_LIST_SELECT, { count: "exact" }), patterns)
          // O cadastro do legado pode não ter data (E2.05, DT-03): fica no fim.
          .order("created_at", { ascending: false, nullsFirst: false })
          .order("id")
          .range(from, to),
        () => withSearch(supabase.from("cells_view").select("id", { count: "exact", head: true }), patterns),
      );
    },
  });
}
