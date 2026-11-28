import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  applyWeek,
  clearCellReportFilters,
  parseCellReportFilters,
  removeCellReportFilterChip,
  writeCellReportFilters,
  type CellReportFilterChipKey,
  type CellReportFilters,
  type WeekRange,
} from "@/lib/cell-reports/filters";

export interface CellReportFiltersState {
  /** Os filtros da URL, já sem os valores inválidos. */
  filters: CellReportFilters;
  /** A URL trouxe mais de 10 pessoas no Líder ou no G12: "Escolha até 10 pessoas." até o campo mudar. */
  leadersTruncated: boolean;
  g12Truncated: boolean;
  /** Aplica os filtros e volta para a página 1. */
  apply: (filters: CellReportFilters) => void;
  /** O atalho de semana (P90): troca o Período, mantém o resto e volta para a página 1. */
  applyWeek: (week: WeekRange) => void;
  /** Tira o valor de um chip, na hora, e volta para a página 1. */
  removeChip: (key: CellReportFilterChipKey) => void;
  /** Tira a Célula (o chip do P84), na hora. */
  removeCell: () => void;
  /** "Limpar filtros": os filtros, a busca e a página; mantém o tamanho e a consulta (DA-13). */
  clearAll: () => void;
}

/**
 * O estado dos filtros de Relatórios na URL (E2.12, RN-12; UX-15). Na primeira leitura, a URL perde
 * os valores inválidos (e o `report` sem formato), com `replace`. Convive com o `useListSearchParams`
 * (`q`, `page` e `size`) e com o `report` da consulta pelas atualizações funcionais do
 * `setSearchParams`, e toda troca é com `replace`, sem entrada no histórico. O molde do
 * `useCellFilters` (E2.10).
 */
export function useCellReportFilters(): CellReportFiltersState {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: navigationState } = useLocation();
  const parsed = useMemo(() => parseCellReportFilters(searchParams), [searchParams]);
  const [leadersTruncated, setLeadersTruncated] = useState(parsed.leadersTruncated);
  const [g12Truncated, setG12Truncated] = useState(parsed.g12Truncated);

  useEffect(() => {
    if (parsed.leadersTruncated) setLeadersTruncated(true);
    if (parsed.g12Truncated) setG12Truncated(true);
    if (!parsed.cleanParams) return;
    setSearchParams((prev) => parseCellReportFilters(prev).cleanParams ?? prev, { replace: true, state: navigationState });
  }, [parsed, setSearchParams, navigationState]);

  const update = useCallback(
    (change: (prev: URLSearchParams) => URLSearchParams) =>
      setSearchParams((prev) => change(prev), { replace: true, state: navigationState }),
    [setSearchParams, navigationState],
  );

  const apply = useCallback(
    (next: CellReportFilters) => {
      if (next.leaderIds.join() !== parsed.filters.leaderIds.join()) setLeadersTruncated(false);
      if (next.g12Ids.join() !== parsed.filters.g12Ids.join()) setG12Truncated(false);
      update((prev) => writeCellReportFilters(prev, next));
    },
    [update, parsed.filters.leaderIds, parsed.filters.g12Ids],
  );

  const applyWeekRange = useCallback(
    (week: WeekRange) => update((prev) => writeCellReportFilters(prev, applyWeek(parseCellReportFilters(prev).filters, week))),
    [update],
  );

  const removeChip = useCallback(
    (key: CellReportFilterChipKey) => {
      if (key.startsWith("leaders:")) setLeadersTruncated(false);
      if (key.startsWith("g12:")) setG12Truncated(false);
      update((prev) => writeCellReportFilters(prev, removeCellReportFilterChip(parseCellReportFilters(prev).filters, key)));
    },
    [update],
  );

  const removeCell = useCallback(
    () => update((prev) => writeCellReportFilters(prev, { ...parseCellReportFilters(prev).filters, cellId: null })),
    [update],
  );

  const clearAll = useCallback(() => {
    setLeadersTruncated(false);
    setG12Truncated(false);
    update(clearCellReportFilters);
  }, [update]);

  return {
    filters: parsed.filters,
    leadersTruncated,
    g12Truncated,
    apply,
    applyWeek: applyWeekRange,
    removeChip,
    removeCell,
    clearAll,
  };
}
