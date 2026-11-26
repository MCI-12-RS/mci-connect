import { useState, type ReactNode, type Ref } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import ResponsiveDialogContent from "@/components/ResponsiveDialogContent";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import { cn } from "@/lib/utils";
import { FormErrorSummary } from "@/components/members/FormErrorSummary";
import { useSlowPending } from "@/hooks/use-slow-pending";
import { SAVE_TEXTS } from "@/lib/hierarchy/texts";

/**
 * Lado a lado, meia largura cada, no celular; quando o texto não cabe (320 px
 * com a fonte a 200%), cada botão vai para a sua linha, na largura toda (UX-28).
 */
const FOOTER_BUTTON = "h-11 grow basis-[calc(50%-0.25rem)] md:h-10 md:grow-0 md:basis-auto";

/** O rodapé do formulário que grava: resumo, falha de envio, "Cancelar" e a ação primária. */
export interface FormDialogActions {
  /** O `id` do `<form>`, para o botão de envio ficar no rodapé. */
  formId: string;
  /** "Criar membro" ou "Salvar alterações". */
  primaryLabel: string;
  /** "Criando…" ou "Salvando…". */
  busyLabel: string;
  busy: boolean;
  /** Desabilitada por outro motivo (cadastro excluído no meio tempo, funções carregando). */
  disabled: boolean;
  /** Quantos campos têm erro (P22). */
  errorCount: number;
  /** Queda de conexão ou falha do servidor (T7), com `role="alert"`. */
  failure: string | null;
  primaryRef?: Ref<HTMLButtonElement>;
  /** Algo mudou: fechar pede a confirmação (UXD-14, UX-26). */
  isDirty: () => boolean;
}

/** Os textos da casca: o "✕", os botões, o resumo e a confirmação de descartar. */
export interface FormDialogTexts {
  close: string;
  /** O rodapé sem ações (só leitura e carregando). */
  readOnlyClose: string;
  errorSummary: (count: number) => string;
  buttons: { cancel: string };
  discard: { title: string; description: string; confirm: string; keepEditing: string };
}

export interface FormDialogProps {
  title: ReactNode;
  texts: FormDialogTexts;
  onClose: () => void;
  /** O foco ao abrir: o conteúdo do diálogo só existe a partir daqui (o `Portal` monta depois de quem o abre). */
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  /** Sem ações: só "Fechar" ("Meus dados" só para leitura e o carregando). */
  actions?: FormDialogActions;
  children: ReactNode;
}

/**
 * A casca dos formulários que gravam (E2.04, T1 e T7; P1; extraída do
 * formulário de membro no E2.08 para o de célula): tela cheia no
 * celular e centralizado no desktop, com cabeçalho e rodapé fixos, fora da
 * área que rola; o `scroll-padding` do corpo deixa o rótulo do campo em foco à
 * vista (WCAG 2.4.11). Fechar com alterações ("Cancelar", "✕", `Esc` e o clique
 * fora) pede "Descartar as alterações?". Durante o envio nada fecha, e aos 3 s
 * aparece "Ainda salvando…" (E2.06, T5 e P44).
 */
export function FormDialog({ title, texts: TEXTS, onClose, onOpenAutoFocus, onCloseAutoFocus, actions, children }: FormDialogProps) {
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const slow = useSlowPending(actions?.busy === true);

  const requestClose = () => {
    if (actions?.busy) return;
    if (actions?.isDirty()) setConfirmDiscard(true);
    else onClose();
  };

  /**
   * O clique fora com alterações abre o aviso aqui mesmo, sem passar pelo
   * fechamento do Radix, e cancela o `pointerdown`: sem isso, o `mousedown` que
   * vem depois tira o foco do "Continuar editando" quando o aviso já abriu
   * (UX-26). No toque, o Radix só avisa no `click`, depois do foco: nada muda.
   */
  const onPointerDownOutside = (event: CustomEvent<{ originalEvent: PointerEvent }>) => {
    if (actions?.busy || !actions?.isDirty()) return;
    event.preventDefault();
    event.detail.originalEvent.preventDefault();
    setConfirmDiscard(true);
  };

  const footer = actions ? (
    <div className="flex w-full flex-col gap-2 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-col gap-2 md:mr-auto">
        <FormErrorSummary count={actions.errorCount} text={TEXTS.errorSummary} />
        {slow && (
          <p role="status" className="text-sm text-muted-foreground">
            {SAVE_TEXTS.stillSaving}
          </p>
        )}
        {actions.failure && (
          <p role="alert" className="flex items-start gap-1.5 text-sm font-medium text-foreground">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
            <span>{actions.failure}</span>
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" className={FOOTER_BUTTON} disabled={actions.busy} onClick={requestClose}>
          {TEXTS.buttons.cancel}
        </Button>
        <Button
          ref={actions.primaryRef}
          type="submit"
          form={actions.formId}
          className={FOOTER_BUTTON}
          disabled={actions.busy || actions.disabled}
        >
          {actions.busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {actions.busy ? actions.busyLabel : actions.primaryLabel}
        </Button>
      </div>
    </div>
  ) : (
    <Button type="button" variant="outline" className={cn(FOOTER_BUTTON, "md:flex-none")} onClick={onClose}>
      {TEXTS.readOnlyClose}
    </Button>
  );

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) requestClose();
        }}
      >
        <ResponsiveDialogContent
          title={title}
          closeLabel={TEXTS.close}
          aria-describedby={undefined}
          onOpenAutoFocus={onOpenAutoFocus}
          onPointerDownOutside={onPointerDownOutside}
          onCloseAutoFocus={onCloseAutoFocus}
          className="md:max-w-3xl"
          bodyClassName="scroll-pb-6 scroll-pt-12"
          footer={footer}
        >
          {children}
        </ResponsiveDialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <LongAlertDialogContent>
          <AlertDialogHeader className="text-left">
            <AlertDialogTitle>{TEXTS.discard.title}</AlertDialogTitle>
            <AlertDialogDescription>{TEXTS.discard.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogAction className={cn(buttonVariants({ variant: "destructive" }), DIALOG_FOOTER_BUTTON)} onClick={onClose}>
              {TEXTS.discard.confirm}
            </AlertDialogAction>
            {/* O foco inicial do AlertDialog fica no "Continuar editando" (UX-26). */}
            <AlertDialogCancel className={cn(DIALOG_FOOTER_BUTTON, "mt-0")}>
              {TEXTS.discard.keepEditing}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </LongAlertDialogContent>
      </AlertDialog>
    </>
  );
}
