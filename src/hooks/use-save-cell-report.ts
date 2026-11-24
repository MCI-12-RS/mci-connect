import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { classifyReportSaveError, type CellReportWrite, type ReportSaveFailure } from "@/lib/cell-reports/report-form";

export interface SaveCellReportInput {
  /** O relatório a atualizar: o da edição ou o criado numa tentativa anterior. `null` cria um novo. */
  reportId: string | null;
  report: CellReportWrite;
  /** O conjunto final de participantes (RN-13); `null` não mexe nos participantes. */
  participantIds: string[] | null;
}

export type SaveCellReportResult =
  | { kind: "saved"; reportId: string }
  | {
      kind: "failed";
      /** O relatório gravado, quando a falha veio depois dele (nos participantes); senão, o de `reportId`. */
      reportId: string | null;
      /** Em que chamada falhou: o relatório não mudou, ou mudou e os participantes não. */
      step: "report" | "participants";
      failure: ReportSaveFailure;
    };

/**
 * Grava o relatório e, depois, os participantes, numa chamada só de
 * `set_cell_report_participants` com o conjunto final (E2.01, RN-13 e DT-15).
 * Nenhuma exclusão nem inclusão direta em `cell_report_participants`.
 *
 * São duas chamadas, não atômicas, até o E2.11. Se os participantes falharem
 * depois de um relatório novo, o resultado traz o id dele: a nova tentativa
 * atualiza esse relatório em vez de criar outro, que o índice da semana
 * recusaria.
 *
 * A edição pede o `id` de volta: sem linha, o relatório não existe mais ou
 * foi excluído (DT-19). Não lança: resolve com o resultado classificado.
 */
export function useSaveCellReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reportId, report, participantIds }: SaveCellReportInput): Promise<SaveCellReportResult> => {
      let savedId = reportId;
      if (savedId) {
        const { data, error } = await supabase.from("cell_reports").update(report).eq("id", savedId).select("id");
        if (error) return { kind: "failed", reportId: savedId, step: "report", failure: classifyReportSaveError(error) };
        if (!data?.length) return { kind: "failed", reportId: savedId, step: "report", failure: { kind: "gone" } };
      } else {
        const { data, error } = await supabase.from("cell_reports").insert([report]).select("id").single();
        if (error) return { kind: "failed", reportId: null, step: "report", failure: classifyReportSaveError(error) };
        savedId = data.id;
      }

      if (participantIds) {
        const { error } = await supabase.rpc("set_cell_report_participants", {
          _report_id: savedId,
          _member_ids: participantIds,
        });
        if (error) {
          return { kind: "failed", reportId: savedId, step: "participants", failure: classifyReportSaveError(error) };
        }
      }
      return { kind: "saved", reportId: savedId };
    },
    onSuccess: (result) => {
      // A lista mostra o relatório gravado, mesmo que os participantes tenham falhado.
      if (result.kind === "saved" || result.step === "participants") {
        void queryClient.invalidateQueries({ queryKey: ["cell_reports"] });
      }
    },
  });
}
