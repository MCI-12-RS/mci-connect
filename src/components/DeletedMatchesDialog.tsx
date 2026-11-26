import { useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import LongAlertDialogContent, { DIALOG_FOOTER_BUTTON } from "@/components/LongAlertDialogContent";
import { UNAVAILABLE_WHILE_SAVING } from "@/components/ConfirmDeleteDialog";
import { BlockedActionContent } from "@/components/BlockedActionDialog";
import { useToast } from "@/hooks/use-toast";
import { useRestoreMember } from "@/hooks/use-restore";
import { restoreBlockFromRefusal, type MemberRestoreOutcome, type RestoreBlock } from "@/lib/deletion/restore";
import type { DeletedMatchesDialogModel, RestorableMatch } from "@/lib/members/deleted-matches";
import { DELETED_MATCHES_TEXTS, DELETION_TEXTS, MEMBER_RESTORE_TEXTS } from "@/lib/deletion/texts";
import { cn } from "@/lib/utils";
import { requestGate } from "@/lib/auth/session-check";

/** O cadastro restaurado a partir do aviso, para o formulário abrir em edição (UX-32). */
export interface RestoredFromWarning {
  memberId: string;
  name: string;
  outcome: MemberRestoreOutcome;
}

interface DeletedMatchesDialogProps {
  dialog: DeletedMatchesDialogModel;
  /** "Cadastrar mesmo assim" em andamento: o botão mostra "Salvando…". */
  registering: boolean;
  onRegisterAnyway: () => void;
  /** "Voltar ao formulário" (e Esc): fecha só o aviso, e o formulário fica como estava. */
  onClose: () => void;
  onRestored: (restored: RestoredFromWarning) => void;
}

/** A recusa da restauração (RN-16 b e e): o diálogo de bloqueio, no lugar do aviso. */
type Blocked = { name: string; block: RestoreBlock };

/**
 * Aviso de cadastro com o e-mail, o celular ou o CPF de um membro excluído
 * (E2.01, T9, RN-18). Fica sobre o formulário, que continua aberto por baixo.
 * O administrador restaura dali os cadastros que veria na lista Excluídos; os
 * demais aparecem sem nome (DA-8).
 */
const DeletedMatchesDialog = ({ dialog, registering, onRegisterAnyway, onClose, onRestored }: DeletedMatchesDialogProps) => {
  const { toast } = useToast();
  const restore = useRestoreMember();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Blocked | null>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  const busy = registering || restoringId !== null;

  const handleRestore = (match: RestorableMatch) => {
    if (busy) return;
    setRestoringId(match.memberId);
    void restore
      .mutateAsync(match.memberId)
      .then(
        (result) => {
          switch (result.kind) {
            case "done":
              onRestored({ memberId: match.memberId, name: match.name, outcome: result.outcome });
              return;
            case "stale":
              toast({ title: result.message });
              onClose();
              return;
            case "refused":
              setBlocked({ name: match.name, block: restoreBlockFromRefusal(result.refusal) });
              return;
            case "gate":
              requestGate(result.code);
              onClose();
              return;
            case "forbidden":
              toast({ variant: "destructive", title: DELETION_TEXTS.permissionDenied });
              onClose();
              return;
            case "network":
              toast({ variant: "destructive", title: DELETION_TEXTS.restoreNetworkError });
              return;
            case "unexpected":
              toast({ variant: "destructive", title: DELETION_TEXTS.restoreFailed });
          }
        },
        () => toast({ variant: "destructive", title: DELETION_TEXTS.restoreFailed }),
      )
      .finally(() => setRestoringId(null));
  };

  // Um cadastro restaurável é a ação principal; com 2 ou mais, nenhum se destaca.
  const restoreVariant = dialog.restorable.length === 1 ? "default" : "outline";

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <LongAlertDialogContent
        onOpenAutoFocus={(event) => {
          // O foco começa em "Voltar ao formulário" (T9).
          event.preventDefault();
          backRef.current?.focus();
        }}
      >
        {blocked ? (
          <BlockedActionContent title={MEMBER_RESTORE_TEXTS.refusedTitle(blocked.name)} focusTitle>
            <p>{blocked.block.message}</p>
          </BlockedActionContent>
        ) : (
          <>
            <AlertDialogHeader className="text-left">
              <AlertDialogTitle className="break-words">{dialog.title}</AlertDialogTitle>
              {/* Tudo na descrição, para o leitor de tela ler o aviso junto com o título. */}
              <AlertDialogDescription asChild>
                <div>
                  <div className="space-y-4 text-foreground">
                    {dialog.restorable.length > 0 && (
                      <ul className="divide-y" data-testid="deleted-matches-restorable">
                        {dialog.restorable.map((match) => {
                          const restoring = restoringId === match.memberId;
                          return (
                            <li key={match.memberId} className="space-y-2 py-3 first:pt-0 last:pb-0">
                              <p className="break-words">{match.message}</p>
                              <Button
                                type="button"
                                variant={restoreVariant}
                                className={cn(DIALOG_FOOTER_BUTTON, UNAVAILABLE_WHILE_SAVING, "w-full")}
                                aria-disabled={busy || undefined}
                                onClick={busy ? undefined : () => handleRestore(match)}
                              >
                                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                                {restoring ? DELETION_TEXTS.restoring : match.restoreLabel}
                              </Button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {dialog.anonymous && (
                      <div className="space-y-1">
                        {dialog.anonymous.heading && <p className="font-medium">{dialog.anonymous.heading}</p>}
                        <p>{dialog.anonymous.text}</p>
                      </div>
                    )}
                    {(dialog.explanation || dialog.accountEmailHint) && (
                      <div className="space-y-1 text-muted-foreground">
                        {dialog.explanation && <p>{dialog.explanation}</p>}
                        {dialog.accountEmailHint && <p>{dialog.accountEmailHint}</p>}
                      </div>
                    )}
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
              {dialog.canRegisterAnyway && (
                <Button
                  type="button"
                  variant="outline"
                  className={cn(DIALOG_FOOTER_BUTTON, UNAVAILABLE_WHILE_SAVING, "w-full")}
                  aria-disabled={busy || undefined}
                  onClick={busy ? undefined : onRegisterAnyway}
                >
                  {registering ? DELETED_MATCHES_TEXTS.registering : DELETED_MATCHES_TEXTS.registerAnyway}
                </Button>
              )}
              <Button
                ref={backRef}
                type="button"
                variant="outline"
                className={cn(DIALOG_FOOTER_BUTTON, UNAVAILABLE_WHILE_SAVING, "w-full")}
                aria-disabled={busy || undefined}
                onClick={busy ? undefined : onClose}
              >
                {DELETED_MATCHES_TEXTS.backToForm}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </LongAlertDialogContent>
    </AlertDialog>
  );
};

export default DeletedMatchesDialog;
