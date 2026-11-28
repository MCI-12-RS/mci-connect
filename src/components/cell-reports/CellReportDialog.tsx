import { useState } from "react";
import type { CellSummary } from "@/lib/cells/fields";
import { EditReportForm } from "./EditReportForm";
import { LaunchReportForm } from "./LaunchReportForm";
import { ReportFormDialog } from "./ReportFormDialog";
import { REPORT_FORM_TEXTS } from "@/lib/cell-reports/texts";

export type CellReportDialogProps = {
  onClose: () => void;
  /** Ao fechar, o foco volta a quem abriu o diálogo (`useReturnFocus`), inclusive depois da troca para a edição. */
  onCloseAutoFocus?: (event: Event) => void;
  /** Pedido de fechar vindo de fora: o voltar do aparelho com o formulário aberto pela consulta (DA-11 do E2.12). */
  closeRequest?: number;
  onCloseRequestDeclined?: () => void;
} & (
  | {
      mode: "launch";
      /** A célula fixa (lista de Células, detalhe da célula); sem ela, o seletor (Relatórios, Dashboard). */
      cell?: CellSummary | null;
    }
  | { mode: "edit"; reportId: string }
);

/**
 * O formulário de relatório (E2.11, UXD-1): um componente para os quatro
 * caminhos, com três modos (célula fixa, célula livre e edição). "Editar
 * relatório" no aviso de "já foi enviado" troca o conteúdo pela edição do
 * relatório da semana (UXD-13).
 */
export function CellReportDialog(props: CellReportDialogProps) {
  const [editingId, setEditingId] = useState<string | null>(props.mode === "edit" ? props.reportId : null);
  return (
    <ReportFormDialog
      initialTitle={editingId ? REPORT_FORM_TEXTS.titles.edit : REPORT_FORM_TEXTS.titles.create}
      onClose={props.onClose}
      onCloseAutoFocus={props.onCloseAutoFocus}
      closeRequest={props.closeRequest}
      onCloseRequestDeclined={props.onCloseRequestDeclined}
    >
      {editingId ? (
        <EditReportForm key={editingId} reportId={editingId} onClose={props.onClose} />
      ) : (
        <LaunchReportForm
          cell={props.mode === "launch" ? (props.cell ?? null) : null}
          onEditReport={setEditingId}
          onClose={props.onClose}
        />
      )}
    </ReportFormDialog>
  );
}
