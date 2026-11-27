import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOptionsPagination, type OptionsPagination, type SelectSearch } from "@/hooks/use-paginated-select";
import {
  toCellG12Option,
  toCellLeaderOption,
  type CellFilterPerson,
  type CellFilterPersonRow,
} from "@/hooks/use-cell-filter-options";
import { resolvePersonLabel, type PersonLabel, type PersonNameSources, type VisiblePersonNames } from "@/lib/filters/person";
import { CELL_REPORT_FILTER_TEXTS } from "@/lib/cell-reports/filter-texts";
import { toSearchPatterns } from "@/lib/search";
import { OPTIONS_PAGE_SIZE, OPTIONS_STALE_TIME_MS, toOptionsPage, type OptionsPage, type SelectOption } from "@/lib/selectors";

/**
 * As opções do Líder ou do G12 de Relatórios (E2.12, RN-05, RN-06, DA-4): quem é o líder registrado
 * ou o G12 de um relatório visível, em ordem alfabética, 20 por página (21 linhas pedidas, a última
 * só indica que há mais), pela `cell_report_filter_options`. Mudar a busca recomeça da página 1.
 */
export function useCellReportFilterOptions(person: CellFilterPerson, search: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["cell_reports", "filter-options", person, search],
    enabled,
    staleTime: OPTIONS_STALE_TIME_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: OptionsPage<CellFilterPersonRow>) => lastPage.nextOffset,
    queryFn: async ({ pageParam }): Promise<OptionsPage<CellFilterPersonRow>> => {
      const patterns = toSearchPatterns(search);
      const { data, error } = await supabase.rpc("cell_report_filter_options", {
        _person: person,
        ...(patterns.length > 0 ? { _search: patterns } : {}),
        _limit: OPTIONS_PAGE_SIZE + 1,
        _offset: pageParam,
      });
      if (error) throw error;
      const rows: CellFilterPersonRow[] = data ?? [];
      return toOptionsPage(rows, pageParam);
    },
  });
}

/** A fonte do seletor do Líder (`PersonMultiFilter`), com o nível entre parênteses (P40). */
export function useCellReportLeaderOptions(search: SelectSearch): OptionsPagination {
  const query = useCellReportFilterOptions("leader", search.term, search.isMenuOpen);
  return useOptionsPagination(query, toCellLeaderOption);
}

/** A fonte do seletor do G12 (`PersonMultiFilter`), só com o nome. */
export function useCellReportG12Options(search: SelectSearch): OptionsPagination {
  const query = useCellReportFilterOptions("g12", search.term, search.isMenuOpen);
  return useOptionsPagination(query, toCellG12Option);
}

/**
 * Os nomes das pessoas escolhidas no Líder ou no G12, só os que quem consulta pode ver (RN-07): pela
 * `cell_report_filter_names`, nunca pela `member_names`. Quem não volta é "Pessoa indisponível", sem
 * nome e sem id. A leitura anterior fica enquanto a nova carrega.
 */
export function useCellReportFilterNames(person: CellFilterPerson, ids: readonly string[]) {
  return useQuery({
    queryKey: ["cell_reports", "filter-names", person, ids],
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<VisiblePersonNames> => {
      const { data, error } = await supabase.rpc("cell_report_filter_names", { _person: person, _ids: [...ids] });
      if (error) throw error;
      const names = new Map<string, string>();
      for (const row of data ?? []) names.set(row.id, row.name);
      return { checked: new Set(ids), names };
    },
  });
}

/** As pessoas escolhidas num campo, já com o rótulo (P53), e quantas estão indisponíveis. */
export interface CellReportPeopleField {
  options: SelectOption[];
  unavailableCount: number;
}

/**
 * Os rótulos das pessoas do Líder ou do G12 (P53, RN-07): o nome escolhido agora no seletor ou o lido
 * pela `cell_report_filter_names` (os ids aplicados), "Carregando…" ou "Pessoa indisponível".
 */
export function useCellReportFilterPeople(person: CellFilterPerson, ids: readonly string[], picked: ReadonlyMap<string, string>) {
  const names = useCellReportFilterNames(person, ids);
  const sources: PersonNameSources = { picked, visible: names.data, failed: names.isError && !names.data };
  const texts = person === "leader" ? CELL_REPORT_FILTER_TEXTS.leaders : CELL_REPORT_FILTER_TEXTS.g12;
  const label = (id: string): PersonLabel => resolvePersonLabel(id, sources, texts);
  const field = (chosen: readonly string[]): CellReportPeopleField => ({
    options: chosen.map((id) => ({ value: id, label: label(id).label })),
    unavailableCount: chosen.filter((id) => label(id).unavailable).length,
  });
  return { label, field };
}
