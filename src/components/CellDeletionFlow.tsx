import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useDialogWrite } from "@/hooks/use-dialog-write";
import { useDeleteCell, useMarkCellInactive } from "@/hooks/use-cell-deletion";
import type { CellDeletionTarget } from "@/lib/deletion/targets";
import { CELL_DELETION_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";
import type { AppError } from "@/lib/errors";

interface CellDeletionFlowProps {
  cell: CellDeletionTarget;
  /** Fim do fluxo: a tela volta para a lista. */
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o fluxo (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Exclusão de uma célula (E2.01, T2): confirmação com o dia, a hora e o
 * endereço, o atalho "Marcar como inativa" para a célula ativa e a exclusão
 * pela RPC. Monte com `key` da célula: cada abertura começa do zero.
 */
const CellDeletionFlow = ({ cell, onClose, onCloseAutoFocus }: CellDeletionFlowProps) => {
  const { hasPermission } = useAuth();
  const deletion = useDeleteCell();
  const inactivation = useMarkCellInactive();
  const write = useDialogWrite(onClose);

  // `delete_cell` só recusa com "não existe ou já foi excluída"; outra recusa aparece no aviso do diálogo.
  const showRefusal = (refusal: AppError) => write.setError(refusal.message);

  const handleDelete = () =>
    write.send(() => deletion.mutateAsync(cell.id), {
      doneText: CELL_DELETION_TEXTS.deleted,
      networkText: DELETION_TEXTS.deleteNetworkError,
      unexpectedText: DELETION_TEXTS.deleteFailed,
      onRefused: showRefusal,
    });

  const handleInactivate = () =>
    write.send(() => inactivation.mutateAsync(cell.id), {
      doneText: CELL_DELETION_TEXTS.inactivated,
      networkText: CELL_DELETION_TEXTS.inactivateNetworkError,
      unexpectedText: CELL_DELETION_TEXTS.inactivateFailed,
      onRefused: showRefusal,
    });

  return (
    <ConfirmDeleteDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onCloseAutoFocus={onCloseAutoFocus}
      title={CELL_DELETION_TEXTS.confirmTitle(cell.leaderName)}
      summary={cell.summary}
      consequences={CELL_DELETION_TEXTS.consequences}
      hint={
        cell.isActive
          ? {
              text: CELL_DELETION_TEXTS.inactivateHint,
              action: hasPermission("edit_cell")
                ? { label: CELL_DELETION_TEXTS.inactivateAction, onClick: handleInactivate }
                : undefined,
            }
          : undefined
      }
      confirmLabel={CELL_DELETION_TEXTS.deleteAction}
      onConfirm={handleDelete}
      deleting={deletion.isPending}
      busy={inactivation.isPending}
      error={write.error}
    />
  );
};

export default CellDeletionFlow;
