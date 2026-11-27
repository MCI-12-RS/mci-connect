import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FORM_PARTICIPANT_SELECT, type FormParticipant } from "@/lib/cell-reports/fields";
import { retryOnceOnNetworkError } from "@/lib/errors";
import { fetchAllRows } from "@/lib/list-query";

/** A chave dos participantes de um relatório (o formulário de edição e a consulta dividem a leitura). */
export const cellReportParticipantsKey = (reportId: string | null | undefined) => ["cell_reports", "participants", reportId] as const;

/**
 * Participantes de um relatório, com o nome, todos e sem corte (E1.08, RN-06; E2.12, RN-17), na
 * ordem do nome e do id, estável entre os blocos de 1000 linhas. O nome vem mesmo que o membro esteja
 * inativo, excluído ou fora do escopo, e `member_visible` diz se quem edita vê o participante (E2.02,
 * AQ-7). A ordem alfabética do português, sem acento, é da consulta (DA-8).
 */
export function useCellReportParticipants(reportId: string | null | undefined, { enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: cellReportParticipantsKey(reportId),
    enabled: !!reportId && enabled,
    retry: retryOnceOnNetworkError,
    queryFn: (): Promise<FormParticipant[]> =>
      fetchAllRows((from, to) =>
        supabase
          .from("cell_report_participants_view")
          .select(FORM_PARTICIPANT_SELECT)
          .eq("report_id", reportId ?? "")
          .order("member_name")
          .order("member_id")
          .range(from, to),
      ),
  });
}
