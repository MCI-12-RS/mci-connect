import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CELL_SUMMARY_SELECT, type CellSummary } from "@/lib/cells/fields";
import { formatCellLabel } from "@/lib/cells/labels";
import { withSearch } from "@/lib/list-query";
import { toSearchPatterns } from "@/lib/search";
import {
  OPTIONS_STALE_TIME_MS,
  optionsPageRange,
  toOptionsPage,
  type OptionsPage,
  type SelectOption,
} from "@/lib/selectors";

export interface CellOptionsParams {
  /** Texto digitado (já com o atraso de digitação). */
  search: string;
  /** Só consulta com o seletor aberto. */
  enabled?: boolean;
}

export function toCellOption(cell: CellSummary): SelectOption {
  return { value: cell.id, label: formatCellLabel(cell) };
}

/**
 * Opções do seletor de célula do relatório, 20 por página, da `cells_view`
 * (E1.08, RN-05 e RN-07): só as células visíveis e ativas, pelo nome do líder
 * (sem líder no fim), com a busca por palavra em `search_text`. Mudar a busca
 * troca a chave e recomeça da página 1.
 */
export function useCellOptions({ search, enabled = true }: CellOptionsParams) {
  return useInfiniteQuery({
    queryKey: ["cells", "options", { search }],
    enabled,
    staleTime: OPTIONS_STALE_TIME_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: OptionsPage<CellSummary>) => lastPage.nextOffset,
    queryFn: async ({ pageParam }): Promise<OptionsPage<CellSummary>> => {
      const [from, to] = optionsPageRange(pageParam);
      const { data, error } = await withSearch(
        supabase.from("cells_view").select(CELL_SUMMARY_SELECT),
        toSearchPatterns(search),
      )
        .eq("is_active", true)
        .order("leader_name", { nullsFirst: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return toOptionsPage(data ?? [], pageParam);
    },
  });
}
