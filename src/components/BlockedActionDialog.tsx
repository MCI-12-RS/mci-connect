import { useEffect, useRef, type ReactNode, type Ref } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import { DELETION_TEXTS } from "@/lib/deletion/texts";
import { cn } from "@/lib/utils";

/** A ação que resolve o bloqueio ("Ver membros excluídos"), ao lado de "Fechar". */
export interface BlockedAction {
  label: string;
  onClick: () => void;
}

export interface BlockedActionContentProps {
  /** O que não pôde ser feito: "Não é possível excluir Gil Souza". */
  title: string;
  /** A mensagem do Negócio, em texto ou organizada em listas. */
  children: ReactNode;
  action?: BlockedAction;
  /** Referência do botão da ação, para receber o foco. */
  actionRef?: Ref<HTMLButtonElement>;
  /** Referência de "Fechar", para receber o foco quando o bloqueio aparece num diálogo já aberto (E2.03, T6). */
  closeRef?: Ref<HTMLButtonElement>;
  /**
   * Leva o foco ao título quando o conteúdo aparece num diálogo já aberto
   * (a verificação virou bloqueio, T3), para o leitor de tela ler o motivo.
   */
  focusTitle?: boolean;
}

/**
 * Corpo do diálogo de bloqueio (padrão P3): título, mensagem e "Fechar", sem
 * botão destrutivo. Fica dentro de um `AlertDialog`; use o
 * `BlockedActionDialog` quando o bloqueio abre sozinho.
 */
export function BlockedActionContent({ title, children, action, actionRef, closeRef, focusTitle = false }: BlockedActionContentProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusTitle) titleRef.current?.focus();
  }, [focusTitle]);

  return (
    <>
      <AlertDialogHeader className="text-left">
        <AlertDialogTitle ref={titleRef} tabIndex={-1} className="break-words focus:outline-none">
          {title}
        </AlertDialogTitle>
        {/* A cor vai num elemento de dentro: o `asChild` só concatena as classes, e o cinza da descrição prevaleceria. */}
        <AlertDialogDescription asChild>
          <div>
            <div className="space-y-3 text-foreground">{children}</div>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="gap-2 sm:gap-0">
        <AlertDialogCancel ref={closeRef} className={cn(DIALOG_FOOTER_BUTTON, "mt-0")}>
          {DELETION_TEXTS.close}
        </AlertDialogCancel>
        {action && (
          <Button ref={actionRef} type="button" className={DIALOG_FOOTER_BUTTON} onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}

export interface BlockedActionDialogProps extends Omit<BlockedActionContentProps, "actionRef" | "closeRef" | "focusTitle"> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ao fechar, leva o foco a quem abriu o diálogo (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Diálogo de bloqueio (padrão P3, E2.01 T3 e T6, Escolas T16). O foco vai
 * para a ação que resolve ou, sem ela, para "Fechar".
 */
export function BlockedActionDialog({ open, onOpenChange, onCloseAutoFocus, ...content }: BlockedActionDialogProps) {
  const actionRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <LongAlertDialogContent
        onOpenAutoFocus={(event) => {
          if (!actionRef.current) return;
          event.preventDefault();
          actionRef.current.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <BlockedActionContent {...content} actionRef={actionRef} />
      </LongAlertDialogContent>
    </AlertDialog>
  );
}
