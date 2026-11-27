import { useQueryClient } from "@tanstack/react-query";
import type { CellReportListRow } from "@/lib/cell-reports/fields";
import type { ListResult } from "@/lib/list-query";
import { CELL_REPORTS_LIST_KEY } from "@/hooks/use-cell-reports-list";

function isListResult(value: unknown): value is ListResult<CellReportListRow> {
  return typeof value === "object" && value !== null && "rows" in value && Array.isArray(value.rows);
}

/**
 * A linha do relatório que a lista de Relatórios já tem no cache, sem nenhuma leitura (E2.12, T12):
 * só para o topo da consulta aparecer na hora. Quando a leitura por id chega, ela manda; se diz "não
 * encontrado", a linha é descartada.
 */
export function useCellReportListPreview(reportId: string | null): CellReportListRow | null {
  const queryClient = useQueryClient();
  if (!reportId) return null;
  for (const [, data] of queryClient.getQueriesData({ queryKey: CELL_REPORTS_LIST_KEY })) {
    if (!isListResult(data)) continue;
    const row = data.rows.find((candidate) => candidate.id === reportId);
    if (row) return row;
  }
  return null;
}

/**
 * Tira um relatório de todas as páginas da lista no cache e diminui o total delas (DA-12): depois de
 * excluir pela consulta, a página antiga (o `placeholderData`) não mostra o excluído nem por um instante.
 */
export function removeReportFromListCache(queryClient: ReturnType<typeof useQueryClient>, reportId: string): void {
  queryClient.setQueriesData({ queryKey: CELL_REPORTS_LIST_KEY }, (data: unknown) => {
    if (!isListResult(data) || !data.rows.some((row) => row.id === reportId)) return data;
    return { rows: data.rows.filter((row) => row.id !== reportId), total: Math.max(0, data.total - 1) };
  });
}
