import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CELL_SUMMARY_SELECT, type CellSummary } from "@/lib/cells/fields";
import { cellOptionLines } from "@/lib/cell-reports/snapshot";
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

/** A opção em duas linhas (E2.11, RN-17, T2): o valor escolhido mostra só a primeira. */
export function toCellOption(cell: CellSummary): SelectOption {
  const { title, description } = cellOptionLines({ ...cell, id: cell.id ?? "" });
  return { value: cell.id ?? "", label: title, description };
}

/** Prefixo da chave das opções: recarregar o seletor depois de uma recusa (T8). */
export const CELL_OPTIONS_QUERY_KEY = ["cells", "options"] as const;

/**
 * Opções do seletor de célula do relatório, 20 por página, da `cells_view`
 * (E1.08, RN-05 e RN-07): só as células visíveis e ativas em que quem consulta
 * pode lançar o relatório (E2.02, RN-13, AQ-4, UXD-9). As células em que a
 * pessoa é líder, timóteo ou anfitrião vêm primeiro (`is_mine`), e depois a
 * ordem é pelo nome do líder (sem líder no fim), com a busca por palavra em
 * `search_text`. Mudar a busca troca a chave e recomeça da página 1.
 */
export function useCellOptions({ search, enabled = true }: CellOptionsParams) {
  return useInfiniteQuery({
    queryKey: [...CELL_OPTIONS_QUERY_KEY, { search }],
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
        .eq("can_submit_report", true)
        .order("is_mine", { ascending: false, nullsFirst: false })
        .order("leader_name", { nullsFirst: false })
        .order("id")
        .range(from, to);
      if (error) throw error;
      return toOptionsPage(data ?? [], pageParam);
    },
  });
}
