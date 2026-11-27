import { useCallback, useEffect, useMemo } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { clearCellReportFilters, parseCellReportFilter, removeCellReportFilter } from "@/lib/cell-reports/cell-filter";

/**
 * O filtro Célula de Relatórios na URL (E2.10, RN-19, T15). Um `cell` sem formato sai da URL na
 * primeira leitura, com `replace`. Convive com o `useListSearchParams` e o `?report=` do E2.01.
 */
export function useCellReportFilter() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: navigationState } = useLocation();
  const parsed = useMemo(() => parseCellReportFilter(searchParams), [searchParams]);

  useEffect(() => {
    if (!parsed.cleanParams) return;
    setSearchParams((prev) => parseCellReportFilter(prev).cleanParams ?? prev, { replace: true, state: navigationState });
  }, [parsed, setSearchParams, navigationState]);

  const update = useCallback(
    (change: (prev: URLSearchParams) => URLSearchParams) =>
      setSearchParams((prev) => change(prev), { replace: true, state: navigationState }),
    [setSearchParams, navigationState],
  );

  const removeCell = useCallback(() => update(removeCellReportFilter), [update]);
  const clearAll = useCallback(() => update(clearCellReportFilters), [update]);

  return { cellId: parsed.cellId, removeCell, clearAll };
}
