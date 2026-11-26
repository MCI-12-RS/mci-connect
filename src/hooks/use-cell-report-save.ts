import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { requestSessionCheck, requestSessionCheckOnDenied } from "@/lib/auth/session-check";
import { classifyReportSaveError, type CellReportWrite, type ReportSaveFailure } from "@/lib/cell-reports/report-form";
import { refreshAfterReportWrite } from "@/lib/query-refresh";

export interface CellReportSaveInput {
  /** O relatório em edição; `null` envia um novo. */
  reportId: string | null;
  report: CellReportWrite;
  /** O conjunto final de participantes (RN-13 do E2.01); `null` não mexe nos participantes. */
  participantIds: string[] | null;
}

export type CellReportSaveResult =
  /** `changed: false`: o servidor não mudou nada (E2.05, AQ-7), e a tela diz "Nenhuma alteração para salvar.". */
  | { kind: "saved"; reportId: string; changed: boolean }
  /** Nada foi gravado: nem o relatório, nem os participantes (RN-14). */
  | { kind: "failed"; failure: ReportSaveFailure };

/**
 * Tempo-limite da gravação, o mesmo do cadastro de membro e de célula. Sem
 * rede a chamada pode nunca voltar; passado o limite, é uma queda de conexão.
 */
export const CELL_REPORT_SAVE_TIMEOUT_MS = 20_000;

/**
 * Grava o relatório e os participantes numa chamada só, pela `save_cell_report`
 * (E2.05, DT-09): o envio leva os participantes dentro do cadastro (RN-04 d), e
 * a edição é uma alteração só, com um evento só (RN-04 e). Uma recusa em
 * qualquer etapa desfaz tudo (RN-14). Nenhuma gravação direta em
 * `cell_reports` nem em `cell_report_participants`.
 *
 * Uma gravação por vez: um toque duplo não envia duas vezes (T5). Não lança:
 * resolve com o resultado classificado.
 */
export function useCellReportSave() {
  const queryClient = useQueryClient();
  const sending = useRef(false);

  const mutation = useMutation({
    mutationFn: async ({ reportId, report, participantIds }: CellReportSaveInput): Promise<CellReportSaveResult> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CELL_REPORT_SAVE_TIMEOUT_MS);
      try {
        const { data, error } = await supabase
          .rpc("save_cell_report", {
            _report_id: reportId,
            _report: report,
            ...(participantIds ? { _participant_ids: participantIds } : {}),
          })
          .abortSignal(controller.signal);
        if (error) {
          // "0 linhas" e 42501 também são o que um membro excluído recebe (RN-14 do E2.01): confere a própria sessão.
          requestSessionCheckOnDenied(error);
          const failure = classifyReportSaveError(error);
          if (failure.kind === "gone") requestSessionCheck();
          return { kind: "failed", failure };
        }
        const row = data?.[0];
        if (!row) return { kind: "failed", failure: { kind: "connection" } };
        return { kind: "saved", reportId: row.report_id, changed: row.changed };
      } catch {
        return { kind: "failed", failure: { kind: "connection" } };
      } finally {
        clearTimeout(timer);
      }
    },
    onSuccess: (result) => {
      // O relatório gravado muda a lista, a situação da célula, os números da semana
      // no Dashboard e o vínculo celular dos membros (E2.09, RN-09 e AQ-3).
      if (result.kind === "saved" && result.changed) void refreshAfterReportWrite(queryClient);
    },
  });

  /** Grava; com outra gravação em andamento, nada acontece (`null`). */
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
