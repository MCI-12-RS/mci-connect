import { useCallback, useEffect, useReducer, useRef, type ReactNode } from "react";
import { FormDialog } from "@/components/form/FormDialog";
import { ReportShellContext, signature, type Register, type ReportShellConfig } from "./report-shell";
import { REPORT_FORM_TEXTS } from "@/lib/cell-reports/texts";

const DIALOG_TEXTS = {
  close: REPORT_FORM_TEXTS.close,
  readOnlyClose: REPORT_FORM_TEXTS.buttons.close,
  errorSummary: REPORT_FORM_TEXTS.errorSummary,
  buttons: { cancel: REPORT_FORM_TEXTS.buttons.cancel },
};

interface ReportFormDialogProps {
  initialTitle: string;
  /** O fechar padrão, antes de o conteúdo informar o dele. */
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** O pedido de fechar vindo de fora (DA-11 do E2.12), repassado à casca comum. */
  closeRequest?: number;
  onCloseRequestDeclined?: () => void;
  children: ReactNode;
}

/**
 * A casca do formulário de relatório (E2.11, T1, UXD-1, P1): o diálogo
 * responsivo do E2.04, igual pelos quatro caminhos. Um diálogo só do começo ao
 * fim: o carregando da edição, os campos e a troca para a edição pelo aviso
 * (UXD-13) trocam só o conteúdo, e o foco volta a quem abriu ao fechar. O foco
 * inicial fica no título (UXD-14), também quando o título muda.
 */
export function ReportFormDialog({
  initialTitle,
  onClose,
  onCloseAutoFocus,
  closeRequest,
  onCloseRequestDeclined,
  children,
}: ReportFormDialogProps) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const config = useRef<ReportShellConfig>({ title: initialTitle, onClose });
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const register = useCallback<Register>((next) => {
    const changed = signature(config.current) !== signature(next);
    config.current = next;
    if (changed) rerender();
  }, []);

  const { title, actions } = config.current;
  const firstTitle = useRef(title);
  useEffect(() => {
    if (title === firstTitle.current) return;
    firstTitle.current = title;
    titleRef.current?.focus();
  }, [title]);

  return (
    <ReportShellContext.Provider value={register}>
      <FormDialog
        title={
          <span ref={titleRef} tabIndex={-1} className="focus:outline-none">
            {title}
          </span>
        }
        texts={DIALOG_TEXTS}
        onClose={() => config.current.onClose()}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          titleRef.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
        closeRequest={closeRequest}
        onCloseRequestDeclined={onCloseRequestDeclined}
        actions={
          actions
            ? {
                ...actions,
                isDirty: () => config.current.actions?.isDirty() ?? false,
              }
            : undefined
        }
      >
        {children}
      </FormDialog>
    </ReportShellContext.Provider>
  );
}
