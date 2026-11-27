import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { useDialogWrite } from "@/hooks/use-dialog-write";
import { useDeleteCellReport } from "@/hooks/use-cell-report-deletion";
import type { CellReportDeletionTarget } from "@/lib/deletion/targets";
import { CELL_REPORT_DELETION_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";

interface CellReportDeletionFlowProps {
  report: CellReportDeletionTarget;
  /** Fim do fluxo: a tela volta para a lista. */
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o fluxo (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
  /** Excluído: roda antes de as listas recarregarem (a consulta fecha, E2.12 DA-12). */
  onDeleted?: () => void;
}

/**
 * Exclusão de um relatório (E2.01, T2): confirmação sem o aviso de inativar e
 * exclusão pela RPC. Monte com `key` do relatório: cada abertura começa do
 * zero.
 */
const CellReportDeletionFlow = ({ report, onClose, onCloseAutoFocus, onDeleted }: CellReportDeletionFlowProps) => {
  const deletion = useDeleteCellReport({ onDeleted });
  const write = useDialogWrite(onClose);

  const handleDelete = () =>
    write.send(() => deletion.mutateAsync(report.id), {
      doneText: CELL_REPORT_DELETION_TEXTS.deleted,
      networkText: DELETION_TEXTS.deleteNetworkError,
      unexpectedText: DELETION_TEXTS.deleteFailed,
      // `delete_cell_report` só recusa com "não existe ou já foi excluído"; outra recusa aparece no aviso do diálogo.
      onRefused: (refusal) => write.setError(refusal.message),
    });

  return (
    <ConfirmDeleteDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      title={CELL_REPORT_DELETION_TEXTS.confirmTitle(report.date, report.leaderName)}
      consequences={CELL_REPORT_DELETION_TEXTS.consequences}
      confirmLabel={CELL_REPORT_DELETION_TEXTS.deleteAction}
      onConfirm={handleDelete}
      deleting={deletion.isPending}
      error={write.error}
    />
  );
};

export default CellReportDeletionFlow;
