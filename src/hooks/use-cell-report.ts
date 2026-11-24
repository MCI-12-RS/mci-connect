import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  CELL_REPORT_DETAIL_SELECT,
  REPORT_PARTICIPANT_SELECT,
  type CellReportDetail,
} from "@/lib/cell-reports/fields";
import { fetchAllRows } from "@/lib/list-query";

/**
 * Um relatório para o painel de consulta ("Ver relatório", E2.01 T7): a linha
 * da `cell_reports_view` (com `cell_deleted`) e todos os participantes, da
 * `cell_report_participants_view`, em ordem alfabética e sem corte, inclusive
 * os excluídos, pelo nome (RN-09 b, RN-13). As duas consultas vão juntas.
 *
 * `null` se o relatório não vier: excluído no meio tempo, fora do escopo ou
 * inexistente. Sem `reportId`, não consulta nada.
 *
 * Com `enabled: false`, não consulta, mas devolve o que já leu desse
 * relatório (o painel fechando continua com ele, sem recarregar à toa).
 */
export function useCellReport(reportId: string | null, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ["cell_reports", "detail", reportId],
    enabled: !!reportId && enabled,
    queryFn: async (): Promise<CellReportDetail | null> => {
      const [{ data: report, error }, participants] = await Promise.all([
        supabase.from("cell_reports_view").select(CELL_REPORT_DETAIL_SELECT).eq("id", reportId).maybeSingle(),
        fetchAllRows((from, to) =>
          supabase
            .from("cell_report_participants_view")
            .select(REPORT_PARTICIPANT_SELECT)
            .eq("report_id", reportId)
            .order("member_name")
            .order("member_id")
            .range(from, to),
        ),
      ]);
      if (error) throw error;
      return report ? { report, participants } : null;
    },
  });
}
