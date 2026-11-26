import type { ReactNode } from "react";
import { FormDialog, type FormDialogActions } from "@/components/form/FormDialog";
import { MEMBER_FORM_LAYOUT_TEXTS } from "@/lib/members/texts";

/** O rodapé do formulário de membro (a casca comum, `FormDialog`). */
export type MemberFormDialogActions = FormDialogActions;

interface MemberFormDialogProps {
  title: string;
  onClose: () => void;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  actions?: MemberFormDialogActions;
  children: ReactNode;
}

/** O diálogo do formulário de membro (E2.04, T1 e T7; P1): a casca comum com os textos de membro. */
export function MemberFormDialog(props: MemberFormDialogProps) {
  return <FormDialog texts={MEMBER_FORM_LAYOUT_TEXTS} {...props} />;
}
