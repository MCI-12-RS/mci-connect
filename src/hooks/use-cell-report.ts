import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CELL_REPORT_DETAIL_SELECT, type CellReportDetailRow } from "@/lib/cell-reports/fields";
import { retryOnceOnNetworkError } from "@/lib/errors";

/** A chave da consulta de um relatório. */
export const cellReportDetailKey = (reportId: string | null) => ["cell_reports", "detail", reportId] as const;

/**
 * Um relatório para a consulta "Ver relatório" (E2.12, T10, DT-09): só a linha da
 * `cell_reports_view` por id, com o retrato, o endereço atual, `cell_visible` e a autoria. Os
 * participantes vêm à parte (`useCellReportParticipants`), em paralelo, e podem falhar sozinhos (T12).
 *
 * `null` se o relatório não vier: excluído, fora do escopo ou inexistente ("Relatório não
 * encontrado", o mesmo para os três). Sem `reportId`, não consulta nada. Na queda de conexão, tenta
 * de novo uma vez só, para o erro não demorar a aparecer.
 *
 * Com `enabled: false`, não consulta, mas devolve o que já leu (o painel fechando continua com ele).
 */
export function useCellReport(reportId: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: cellReportDetailKey(reportId),
    enabled: !!reportId && enabled,
    retry: retryOnceOnNetworkError,
    queryFn: async (): Promise<CellReportDetailRow | null> => {
      const { data, error } = await supabase
        .from("cell_reports_view")
        .select(CELL_REPORT_DETAIL_SELECT)
        .eq("id", reportId ?? "")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}
