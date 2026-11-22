import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { REPORT_PARTICIPANT_SELECT, type ReportParticipant } from "@/lib/cell-reports/fields";

/**
 * Participantes de um relatório, com o nome, em ordem alfabética (E1.08,
 * RN-06). O nome vem mesmo que o membro esteja inativo ou fora do escopo.
 */
export function useCellReportParticipants(reportId: string | null | undefined) {
  return useQuery({
    queryKey: ["cell_reports", "participants", reportId],
    enabled: !!reportId,
    queryFn: async (): Promise<ReportParticipant[]> => {
      const { data, error } = await supabase
        .from("cell_report_participants_view")
        .select(REPORT_PARTICIPANT_SELECT)
        .eq("report_id", reportId)
        .order("member_name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
