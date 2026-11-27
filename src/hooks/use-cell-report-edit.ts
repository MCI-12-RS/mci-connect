import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CELL_REPORT_EDIT_SELECT, type CellReportEditRow } from "@/lib/cell-reports/fields";
import { retryOnceOnNetworkError } from "@/lib/errors";

/** As datas da edição (RN-16, P-REL-22): a semana do relatório até hoje, pelo servidor. */
export interface EditDatesContext {
  serverNow: string;
  today: string;
  weekStart: string;
  weekEnd: string;
  allowedDates: string[];
}

export interface CellReportEditData {
  report: CellReportEditRow;
  dates: EditDatesContext | null;
}

/**
 * O relatório da edição, lido pelo id ao abrir (E2.11, AQ-10): a linha da
 * `cell_reports_view` (com o retrato) e o `cell_report_edit_context`, juntos.
 * `null` quando o relatório não está mais visível (excluído no meio tempo). Os
 * participantes vêm de `useCellReportParticipants`.
 */
export function useCellReportEdit(reportId: string | null) {
  return useQuery({
    // Fora de `["cell_reports"]`: a gravação não relê a edição que ainda está aberta (sem cache, `gcTime: 0`).
    queryKey: ["cell_report_form", "edit", reportId],
    enabled: !!reportId,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: retryOnceOnNetworkError,
    queryFn: async (): Promise<CellReportEditData | null> => {
      const id = reportId ?? "";
      const [row, context] = await Promise.all([
        supabase.from("cell_reports_view").select(CELL_REPORT_EDIT_SELECT).eq("id", id).maybeSingle(),
        supabase.rpc("cell_report_edit_context", { _report_id: id }),
      ]);
      if (row.error) throw row.error;
      if (context.error) throw context.error;
      if (!row.data) return null;
      const ctx = context.data?.[0];
      return {
        report: row.data,
        dates: ctx
          ? {
              serverNow: ctx.server_now,
              today: ctx.today,
              weekStart: ctx.week_start,
              weekEnd: ctx.week_end,
              allowedDates: ctx.allowed_dates ?? [],
            }
          : null,
      };
    },
  });
}
