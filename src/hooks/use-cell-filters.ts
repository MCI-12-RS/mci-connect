import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  clearCellFilters,
  parseCellFilters,
  removeCellFilterChip,
  writeCellFilters,
  type CellFilterChipKey,
  type CellFilters,
} from "@/lib/cells/filters";

export interface CellFiltersState {
  /** Os filtros da URL, já sem os valores inválidos. */
  filters: CellFilters;
  /** A URL trouxe mais de 10 pessoas no Líder ou no G12: "Escolha até 10 pessoas." até o campo mudar. */
  leadersTruncated: boolean;
  g12Truncated: boolean;
  /** Aplica os filtros e volta para a página 1. */
  apply: (filters: CellFilters) => void;
  /** Tira o valor de um chip, na hora, e volta para a página 1. */
  removeChip: (key: CellFilterChipKey) => void;
  /** "Limpar filtros": os filtros, a busca e a página; mantém o tamanho (RN-12). */
  clearAll: () => void;
}

/**
 * O estado dos filtros de Células na URL (E2.10, RN-12; UX-12). Na primeira leitura, a URL perde os
 * valores inválidos, com `replace`. Convive com o `useListSearchParams` (`q`, `page` e `size`) pelas
 * atualizações funcionais do `setSearchParams`, e toda troca é com `replace`, sem entrada no
 * histórico. O mesmo molde do `useMemberFilters` (E2.07).
 */
export function useCellFilters(): CellFiltersState {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: navigationState } = useLocation();
  const parsed = useMemo(() => parseCellFilters(searchParams), [searchParams]);
  const [leadersTruncated, setLeadersTruncated] = useState(parsed.leadersTruncated);
  const [g12Truncated, setG12Truncated] = useState(parsed.g12Truncated);

  useEffect(() => {
    if (parsed.leadersTruncated) setLeadersTruncated(true);
    if (parsed.g12Truncated) setG12Truncated(true);
    if (!parsed.cleanParams) return;
    setSearchParams((prev) => parseCellFilters(prev).cleanParams ?? prev, { replace: true, state: navigationState });
  }, [parsed, setSearchParams, navigationState]);

  const update = useCallback(
    (change: (prev: URLSearchParams) => URLSearchParams) =>
      setSearchParams((prev) => change(prev), { replace: true, state: navigationState }),
    [setSearchParams, navigationState],
  );

  const apply = useCallback(
    (next: CellFilters) => {
      if (next.leaders.join() !== parsed.filters.leaders.join()) setLeadersTruncated(false);
      if (next.g12.join() !== parsed.filters.g12.join()) setG12Truncated(false);
      update((prev) => writeCellFilters(prev, next));
    },
    [update, parsed.filters.leaders, parsed.filters.g12],
  );

  const removeChip = useCallback(
    (key: CellFilterChipKey) => {
      if (key.startsWith("leaders:")) setLeadersTruncated(false);
      if (key.startsWith("g12:")) setG12Truncated(false);
      update((prev) => writeCellFilters(prev, removeCellFilterChip(parseCellFilters(prev).filters, key)));
    },
    [update],
  );

  const clearAll = useCallback(() => {
    setLeadersTruncated(false);
    setG12Truncated(false);
    update(clearCellFilters);
  }, [update]);

  return { filters: parsed.filters, leadersTruncated, g12Truncated, apply, removeChip, clearAll };
}
