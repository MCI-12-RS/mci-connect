import type { ReactNode } from "react";
import { FormDialog, type FormDialogActions } from "@/components/form/FormDialog";
import { CellStatusBadge } from "@/components/StatusBadges";
import { CELL_FORM_TEXTS } from "@/lib/cells/texts";

const DIALOG_TEXTS = {
  close: CELL_FORM_TEXTS.close,
  readOnlyClose: CELL_FORM_TEXTS.close,
  errorSummary: CELL_FORM_TEXTS.errorSummary,
  buttons: { cancel: CELL_FORM_TEXTS.buttons.cancel },
};

interface CellFormDialogProps {
  isEditing: boolean;
  /** A célula gravada está inativa: o badge "Inativa" no cabeçalho (P60). Não muda com o interruptor. */
  storedInactive?: boolean;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** Sem ações: só "Fechar" (o carregando da célula aberta pelo id). */
  actions?: FormDialogActions;
  children: ReactNode;
}

/**
 * O diálogo do formulário de célula (E2.08, T1 e T6; P1): a casca comum do
 * E2.04, com "Nova célula" ou "Editar célula" e, na célula gravada inativa, o
 * badge "Inativa".
 */
export function CellFormDialog({ isEditing, storedInactive = false, onClose, onCloseAutoFocus, actions, children }: CellFormDialogProps) {
  const title = isEditing ? CELL_FORM_TEXTS.titles.edit : CELL_FORM_TEXTS.titles.create;
  return (
    <FormDialog
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{title}</span>
          {storedInactive && <CellStatusBadge active={false} />}
        </span>
      }
      texts={DIALOG_TEXTS}
      onClose={onClose}
      onCloseAutoFocus={onCloseAutoFocus}
      actions={actions}
    >
      {children}
    </FormDialog>
  );
}
