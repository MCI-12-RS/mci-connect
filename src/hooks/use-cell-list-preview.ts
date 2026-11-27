import { useQueryClient } from "@tanstack/react-query";
import type { CellListRow } from "@/lib/cells/fields";
import type { ListResult } from "@/lib/list-query";

function isListResult(value: unknown): value is ListResult<CellListRow> {
  return typeof value === "object" && value !== null && "rows" in value && Array.isArray(value.rows);
}

/**
 * A linha da célula que a lista de Células já tem no cache, sem nenhuma
 * leitura (E2.10, UXD-12, AQ-5): só para o topo do detalhe aparecer na hora.
 * Quando a leitura do detalhe chega, ela manda; se diz "não encontrada", a
 * linha é descartada (RN-14).
 */
export function useCellListPreview(cellId: string): CellListRow | null {
  const queryClient = useQueryClient();
  for (const [, data] of queryClient.getQueriesData({ queryKey: ["cells", "list"] })) {
    if (!isListResult(data)) continue;
    const row = data.rows.find((candidate) => candidate.id === cellId);
    if (row) return row;
  }
  return null;
}
