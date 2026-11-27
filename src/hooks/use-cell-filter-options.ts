import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useOptionsPagination, type OptionsPagination, type SelectSearch } from "@/hooks/use-paginated-select";
import { levelInfo } from "@/lib/hierarchy/level";
import { resolvePersonLabel, type PersonLabel, type PersonNameSources, type VisiblePersonNames } from "@/lib/filters/person";
import { CELL_FILTER_TEXTS } from "@/lib/cells/filter-texts";
import { toSearchPatterns } from "@/lib/search";
import { OPTIONS_PAGE_SIZE, OPTIONS_STALE_TIME_MS, toOptionsPage, type OptionsPage, type SelectOption } from "@/lib/selectors";

export type CellFilterPerson = Database["public"]["Enums"]["cell_filter_person"];

/**
 * Uma pessoa do Líder ou do G12. O nível, a marca de pastor e o sexo podem vir nulos (sem liderança;
 * no G12, sempre nulos), embora o tipo gerado da RPC os dê como não nulos.
 */
export interface CellFilterPersonRow {
  id: string;
  name: string;
  g12_level: number | null;
  is_pastor: boolean | null;
  gender: string | null;
}

/** A opção do Líder traz o nível (UXD-2): "André Souza (144)", lido "André Souza, nível 144". */
export function toCellLeaderOption(row: CellFilterPersonRow): SelectOption {
  const { label, spoken } = levelInfo({ level: row.g12_level, isPastor: row.is_pastor, gender: row.gender });
  return { value: row.id, label: row.name, suffix: { text: `(${label})`, spoken } };
}

/** A opção do G12: só o nome. */
export function toCellG12Option(row: CellFilterPersonRow): SelectOption {
  return { value: row.id, label: row.name };
}

/**
 * As opções do Líder ou do G12 (E2.10, RN-04, RN-05, DA-8): quem lidera ou é o G12 de uma célula
 * visível, em ordem alfabética, 20 por página (21 linhas pedidas, a última só indica que há mais),
 * pela `cell_filter_options`. Mudar a busca troca a chave e recomeça da página 1.
 */
export function useCellFilterOptions(person: CellFilterPerson, search: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ["cells", "filter-options", person, search],
    enabled,
    staleTime: OPTIONS_STALE_TIME_MS,
    initialPageParam: 0,
    getNextPageParam: (lastPage: OptionsPage<CellFilterPersonRow>) => lastPage.nextOffset,
    queryFn: async ({ pageParam }): Promise<OptionsPage<CellFilterPersonRow>> => {
      const patterns = toSearchPatterns(search);
      const { data, error } = await supabase.rpc("cell_filter_options", {
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

/** A fonte do seletor do Líder (`PersonMultiFilter`). */
export function useCellLeaderOptions(search: SelectSearch): OptionsPagination {
  const query = useCellFilterOptions("leader", search.term, search.isMenuOpen);
  return useOptionsPagination(query, toCellLeaderOption);
}

/** A fonte do seletor do G12 (`PersonMultiFilter`). */
export function useCellG12Options(search: SelectSearch): OptionsPagination {
  const query = useCellFilterOptions("g12", search.term, search.isMenuOpen);
  return useOptionsPagination(query, toCellG12Option);
}

/**
 * Os nomes das pessoas escolhidas no Líder ou no G12, só os que quem consulta pode ver (RN-06,
 * DA-3): pela `cell_filter_names`, nunca pela `member_names`. Quem não volta aparece como "Pessoa
 * indisponível", sem nome e sem id. A leitura anterior fica enquanto a nova carrega.
 */
export function useCellFilterNames(person: CellFilterPerson, ids: readonly string[]) {
  return useQuery({
    queryKey: ["cells", "filter-names", person, ids],
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<VisiblePersonNames> => {
      const { data, error } = await supabase.rpc("cell_filter_names", { _person: person, _ids: [...ids] });
      if (error) throw error;
      const names = new Map<string, string>();
      for (const row of data ?? []) names.set(row.id, row.name);
      return { checked: new Set(ids), names };
    },
  });
}

/** As pessoas escolhidas num campo, já com o rótulo (P53), e quantas estão indisponíveis. */
export interface CellFilterPeopleField {
  options: SelectOption[];
  unavailableCount: number;
}

/**
 * Os rótulos das pessoas do Líder ou do G12 (P53, RN-06): o nome escolhido agora no seletor ou o
 * lido pela `cell_filter_names` (os ids aplicados), "Carregando…" ou "Pessoa indisponível".
 */
export function useCellFilterPeople(person: CellFilterPerson, ids: readonly string[], picked: ReadonlyMap<string, string>) {
  const names = useCellFilterNames(person, ids);
  const sources: PersonNameSources = { picked, visible: names.data, failed: names.isError && !names.data };
  const texts = person === "leader" ? CELL_FILTER_TEXTS.leaders : CELL_FILTER_TEXTS.g12;
  const label = (id: string): PersonLabel => resolvePersonLabel(id, sources, texts);
  const field = (chosen: readonly string[]): CellFilterPeopleField => ({
    options: chosen.map((id) => ({ value: id, label: label(id).label })),
    unavailableCount: chosen.filter((id) => label(id).unavailable).length,
  });
  return { label, field };
}
