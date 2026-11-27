import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import { classifyReportError, type ReportRefusal } from "@/lib/cell-reports/codes";
import { refreshAfterReportWrite } from "@/lib/query-refresh";

export interface CellReportSubmitInput {
  /** O id gerado ao abrir o formulário: a repetição nunca grava outro relatório (P-REL-29). */
  attemptId: string;
  report: { [key: string]: Json };
  participantIds: string[];
}

export type CellReportSubmitResult =
  /** `sameContent: false`: a primeira tentativa já tinha gravado, e o formulário mudou depois. */
  { kind: "sent"; replayed: boolean; sameContent: boolean } | { kind: "refused"; refusal: ReportRefusal };

/** O mesmo tempo-limite das outras gravações (E2.04, E2.08): passado ele, é uma queda de conexão. */
export const CELL_REPORT_SUBMIT_TIMEOUT_MS = 20_000;

/**
 * O lançamento numa chamada só (E2.11, RN-15, `submit_cell_report`): o
 * relatório, os escolhidos e, pelo servidor, os automáticos e o retrato. Uma
 * gravação por vez (o toque duplo não envia duas vezes). Não lança: resolve com
 * o resultado classificado.
 */
export function useCellReportSubmit() {
  const queryClient = useQueryClient();
  const sending = useRef(false);

  const mutation = useMutation({
    // Sem rede, a gravação tenta e mostra a mensagem de conexão (T8), em vez de esperar a rede voltar.
    networkMode: "always",
    mutationFn: async ({ attemptId, report, participantIds }: CellReportSubmitInput): Promise<CellReportSubmitResult> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      // O sinal cancela o fetch; a corrida cobre a espera antes dele (a sessão sendo renovada sem rede).
      const expired = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, CELL_REPORT_SUBMIT_TIMEOUT_MS);
      });
      try {
        const answer = await Promise.race([
          supabase
            .rpc("submit_cell_report", { _report_id: attemptId, _report: report, _participant_ids: participantIds })
            .abortSignal(controller.signal),
          expired,
        ]);
        if (answer === "timeout") return { kind: "refused", refusal: { kind: "connection" } };
        const { data, error } = answer;
        if (error) {
          requestSessionCheckOnDenied(error);
          return { kind: "refused", refusal: classifyReportError(error) };
        }
        const row = data?.[0];
        if (!row) return { kind: "refused", refusal: { kind: "connection" } };
        const replayed = row.outcome === "replayed";
        return { kind: "sent", replayed, sameContent: !replayed || row.same_content === true };
      } catch {
        return { kind: "refused", refusal: { kind: "connection" } };
      } finally {
        clearTimeout(timer);
      }
    },
    onSettled: (result) => {
      // Gravado, ou recusado porque a semana, a célula ou o relatório mudaram: as telas abertas relêem (AQ-9).
      if (!result) return;
      if (result.kind === "sent" || ["week_taken", "cell", "report_gone"].includes(result.refusal.kind)) {
        void refreshAfterReportWrite(queryClient);
      }
      if (result.kind === "refused" && result.refusal.kind === "cell") {
        void queryClient.invalidateQueries({ queryKey: ["access"] });
      }
    },
  });

  const submit = async (input: CellReportSubmitInput): Promise<CellReportSubmitResult | null> => {
    if (sending.current) return null;
    sending.current = true;
    try {
      return await mutation.mutateAsync(input);
    } finally {
      sending.current = false;
    }
  };

  return { submit, isPending: mutation.isPending };
}
