import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ListParams, ListResult } from "@/lib/list-query";
import { CELL_LIST_SELECT, type CellListRow } from "@/lib/cells/fields";
import { EMPTY_CELL_FILTERS, toCellsListArgs, type CellFilters } from "@/lib/cells/filters";

/**
 * Células visíveis, filtradas e paginadas no servidor, com o total exato (E2.10, RN-01 a RN-03): a
 * página pela `cells_list` e o total pela `cells_list_count`, em paralelo. A ordem (cadastrada mais
 * recentemente primeiro, "data não registrada" no fim, RN-13) é a da RPC: nada de `.order()` aqui.
 * Cada linha traz a situação do relatório, calculada pelo servidor (E2.09); o total não a pede.
 */
export function useCellsList({ page, pageSize, search }: ListParams, filters: CellFilters = EMPTY_CELL_FILTERS) {
  return useQuery({
    queryKey: ["cells", "list", { page, pageSize, search, filters }],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<ListResult<CellListRow>> => {
      const args = toCellsListArgs(filters, search);
      const [rowsResult, countResult] = await Promise.all([
        supabase.rpc("cells_list", { ...args, _limit: pageSize, _offset: (page - 1) * pageSize }).select(CELL_LIST_SELECT),
        supabase.rpc("cells_list_count", args),
      ]);
      if (rowsResult.error) throw rowsResult.error;
      if (countResult.error) throw countResult.error;
      return { rows: rowsResult.data ?? [], total: countResult.data ?? 0 };
    },
  });
}
