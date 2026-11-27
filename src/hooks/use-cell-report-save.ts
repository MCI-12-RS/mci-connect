import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { requestSessionCheck, requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import { classifyReportError, type ReportRefusal } from "@/lib/cell-reports/codes";
import { refreshAfterReportWrite } from "@/lib/query-refresh";

export interface CellReportSaveInput {
  reportId: string;
  /** Só as chaves que mudam (PATCH). */
  report: { [key: string]: Json };
  /** O conjunto final de participantes, com os de cadastro excluído; `null` não mexe neles. */
  participantIds: string[] | null;
}

export type CellReportSaveResult =
  /** `changed: false`: o servidor não mudou nada (E2.05, AQ-7), e a tela diz "Nenhuma alteração para salvar.". */
  { kind: "saved"; changed: boolean } | { kind: "refused"; refusal: ReportRefusal };

/** O mesmo tempo-limite das outras gravações: passado ele, é uma queda de conexão. */
export const CELL_REPORT_SAVE_TIMEOUT_MS = 20_000;

/**
 * A edição numa chamada só (E2.11, `save_cell_report`, *definer*): o relatório
 * e os participantes, numa alteração com um evento só (E2.05). Nenhuma gravação
 * direta em `cell_reports` nem nos participantes. Uma gravação por vez. Não
 * lança: resolve com o resultado classificado.
 */
export function useCellReportSave() {
  const queryClient = useQueryClient();
  const sending = useRef(false);

  const mutation = useMutation({
    // Sem rede, a gravação tenta e mostra a mensagem de conexão (T8), em vez de esperar a rede voltar.
    networkMode: "always",
    mutationFn: async ({ reportId, report, participantIds }: CellReportSaveInput): Promise<CellReportSaveResult> => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      // O sinal cancela o fetch; a corrida cobre a espera antes dele (a sessão sendo renovada sem rede).
      const expired = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve("timeout");
        }, CELL_REPORT_SAVE_TIMEOUT_MS);
      });
      try {
        const answer = await Promise.race([
          supabase
            .rpc("save_cell_report", {
              _report_id: reportId,
              _report: report,
              ...(participantIds ? { _participant_ids: participantIds } : {}),
            })
            .abortSignal(controller.signal),
          expired,
        ]);
        if (answer === "timeout") return { kind: "refused", refusal: { kind: "connection" } };
        const { data, error } = answer;
        if (error) {
          // 42501 e o relatório sumido também são o que um membro excluído recebe (RN-14 do E2.01).
          requestSessionCheckOnDenied(error);
          const refusal = classifyReportError(error);
          if (refusal.kind === "report_gone") requestSessionCheck();
          return { kind: "refused", refusal };
        }
        const row = data?.[0];
        if (!row) return { kind: "refused", refusal: { kind: "connection" } };
        return { kind: "saved", changed: row.changed };
      } catch {
        return { kind: "refused", refusal: { kind: "connection" } };
      } finally {
        clearTimeout(timer);
      }
    },
    onSettled: (result) => {
      if (!result) return;
      if ((result.kind === "saved" && result.changed) || (result.kind === "refused" && result.refusal.kind === "report_gone")) {
        void refreshAfterReportWrite(queryClient);
      }
    },
  });

  const save = async (input: CellReportSaveInput): Promise<CellReportSaveResult | null> => {
    if (sending.current) return null;
    sending.current = true;
    try {
      return await mutation.mutateAsync(input);
    } finally {
      sending.current = false;
    }
  };

  return { save, isPending: mutation.isPending };
}
