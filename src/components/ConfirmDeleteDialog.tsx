import { AlertCircle, Info } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import { DELETION_TEXTS } from "@/lib/deletion/texts";
import { cn } from "@/lib/utils";

/** Aviso que sugere inativar em vez de excluir, com o atalho (UXD-3). */
export interface ConfirmDeleteHint {
  /** "Se a pessoa só deixou de frequentar, prefira marcá-la como inativa." */
  text: string;
  /** "Marcar como inativo": só para quem pode editar. Sem ele, fica só o texto. */
  action?: { label: string; onClick: () => void };
}

export interface ConfirmDeleteContentProps {
  /** "Excluir Bruno Almeida?" */
  title: string;
  /** Linha que identifica o item, abaixo do título (na célula: dia, hora e endereço). */
  summary?: string;
  /** As consequências, em tópicos. */
  consequences: readonly string[];
  /** Aviso de inativar: só para membro ou célula ativos. */
  hint?: ConfirmDeleteHint;
  /** Botão destrutivo, com verbo e objeto: "Excluir cadastro". */
  confirmLabel: string;
  onConfirm: () => void;
  /** Exclusão em andamento: "Excluindo…", e os botões ficam desabilitados (UX-06). */
  deleting?: boolean;
  /** Outra gravação do diálogo em andamento (o atalho de inativar): os botões ficam desabilitados. */
  busy?: boolean;
  /** Pré-checagem em andamento: `Skeleton`, o texto e o botão desabilitado (UX-08). */
  checking?: { text: string; actionLabel: string } | null;
  /** Falha no envio (por exemplo, a conexão), num `Alert` acima dos botões. */
  error?: string | null;
}

/**
 * Corpo da confirmação de exclusão (T2): título, consequências em tópicos,
 * aviso de inativar e os botões, com "Cancelar" no foco inicial. Fica dentro
 * de um `AlertDialog`; use o `ConfirmDeleteDialog` quando não houver troca de
 * conteúdo no mesmo diálogo.
 */
export function ConfirmDeleteContent({
  title,
  summary,
  consequences,
  hint,
  confirmLabel,
  onConfirm,
  deleting = false,
  busy = false,
  checking = null,
  error = null,
}: ConfirmDeleteContentProps) {
  const locked = deleting || busy;

  let confirmText = confirmLabel;
  if (checking) confirmText = checking.actionLabel;
  else if (deleting) confirmText = DELETION_TEXTS.deleting;

  return (
    <>
      <AlertDialogHeader className="text-left">
        <AlertDialogTitle className="break-words">{title}</AlertDialogTitle>
        <AlertDialogDescription asChild>
          {checking ? (
            <div className="space-y-3" aria-busy="true">
              <div className="space-y-2" aria-hidden="true">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <p role="status">{checking.text}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {summary && <p className="break-words font-medium text-foreground">{summary}</p>}
              <ul className="list-disc space-y-1 pl-5">
                {consequences.map((consequence) => (
                  <li key={consequence}>{consequence}</li>
                ))}
              </ul>
            </div>
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>

      {!checking && hint && (
        <Alert role="note">
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3">
            <p>{hint.text}</p>
            {hint.action && (
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-11 whitespace-normal md:min-h-9"
                disabled={locked}
                onClick={hint.action.onClick}
              >
                {hint.action.label}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <AlertDialogFooter className="gap-2 sm:gap-0">
        <AlertDialogCancel className={cn(DIALOG_FOOTER_BUTTON, "mt-0")} disabled={locked}>
          {DELETION_TEXTS.cancel}
        </AlertDialogCancel>
        <Button
          type="button"
          variant="destructive"
          className={DIALOG_FOOTER_BUTTON}
          disabled={!!checking || locked}
          onClick={onConfirm}
        >
          {confirmText}
        </Button>
      </AlertDialogFooter>
    </>
  );
}

export interface ConfirmDeleteDialogProps extends ConfirmDeleteContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Confirmação de exclusão (T2, padrões P8 e P9). Não fecha enquanto exclui:
 * quem chama fecha no sucesso e troca o conteúdo nas recusas.
 */
export function ConfirmDeleteDialog({ open, onOpenChange, ...content }: ConfirmDeleteDialogProps) {
  const locked = content.deleting || content.busy;
  const handleOpenChange = (next: boolean) => {
    if (!next && locked) return;
    onOpenChange(next);
  };
  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <LongAlertDialogContent>
        <ConfirmDeleteContent {...content} />
      </LongAlertDialogContent>
    </AlertDialog>
  );
}
