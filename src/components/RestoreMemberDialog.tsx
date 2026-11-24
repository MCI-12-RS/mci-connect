import { useEffect, useRef, useState, type ReactNode } from "react";
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
import { UNAVAILABLE_WHILE_SAVING } from "@/components/ConfirmDeleteDialog";
import { BlockedActionContent } from "@/components/BlockedActionDialog";
import { EditMemberDialog } from "@/components/EditRecordDialogs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useRestoreMember } from "@/hooks/use-restore";
import { personName, type DeletedMemberRow } from "@/lib/deletion/deleted-lists";
import {
  memberRestoreConsequences,
  memberRestoreNotices,
  restoreBlockFromRefusal,
  type MemberRestoreNotices,
  type RestoreBlock,
} from "@/lib/deletion/restore";
import { DELETION_TEXTS, MEMBER_RESTORE_TEXTS } from "@/lib/deletion/texts";
import { cn } from "@/lib/utils";

type Step =
  | { kind: "confirm" }
  /** Restaurado, com algo a avisar (RN-16 a e d). */
  | { kind: "result"; notices: MemberRestoreNotices }
  /** Recusado pelo servidor (RN-16 b e e). */
  | { kind: "blocked"; block: RestoreBlock }
  /** "Definir líder": o formulário do cadastro restaurado (UX-22). */
  | { kind: "form" };

interface RestoreResultContentProps {
  notices: MemberRestoreNotices;
  /** "Definir líder": só quando ele voltou sem líder e para quem tem `edit_member`. */
  onDefineLeader: (() => void) | null;
}

/** "Cadastro restaurado", com os avisos e "Definir líder" (T5). O foco vai para o título. */
function RestoreResultContent({ notices, onDefineLeader }: RestoreResultContentProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <>
      <AlertDialogHeader className="text-left">
        <AlertDialogTitle ref={titleRef} tabIndex={-1} className="break-words focus:outline-none">
          {MEMBER_RESTORE_TEXTS.resultTitle}
        </AlertDialogTitle>
        <AlertDialogDescription asChild>
          <div>
            <div className="space-y-3 text-foreground">
              {notices.messages.map((message) => (
                <p key={message}>{message}</p>
              ))}
            </div>
          </div>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter className="gap-2 sm:gap-0">
        {/* "Agora não" responde a "Definir líder"; sem ele, o diálogo só fecha. */}
        <AlertDialogCancel className={cn(DIALOG_FOOTER_BUTTON, "mt-0")}>
          {onDefineLeader ? MEMBER_RESTORE_TEXTS.notNow : DELETION_TEXTS.close}
        </AlertDialogCancel>
        {onDefineLeader && (
          <Button type="button" className={DIALOG_FOOTER_BUTTON} onClick={onDefineLeader}>
            {MEMBER_RESTORE_TEXTS.defineLeader}
          </Button>
        )}
      </AlertDialogFooter>
    </>
  );
}

interface RestoreMemberDialogProps {
  member: DeletedMemberRow;
  /** Fim do fluxo: a tela volta para a lista. */
  onClose: () => void;
  /** Quando o último diálogo do fluxo fecha, leva o foco a quem o abriu (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Restauração de um membro (E2.01, T5, UXD-6): confirmação com a função, o
 * acesso, o cônjuge e o líder (UX-20); depois, o resultado com "Definir
 * líder" (UX-22) ou o bloqueio da recusa (UX-23), no mesmo diálogo. Monte com
 * `key` do membro: cada abertura começa do zero.
 */
const RestoreMemberDialog = ({ member, onClose, onCloseAutoFocus }: RestoreMemberDialogProps) => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const restore = useRestoreMember();
  const [step, setStep] = useState<Step>({ kind: "confirm" });
  const sending = useRef(false);
  // "Definir líder": o diálogo dá lugar ao formulário, que devolve o foco a quem abriu o fluxo.
  const formOpened = useRef(false);

  const name = personName(member.name);
  const restoring = restore.isPending;

  const handleRestore = () => {
    if (sending.current) return;
    sending.current = true;
    void restore
      .mutateAsync(member.id)
      .then(
        (result) => {
          switch (result.kind) {
            case "done": {
              const notices = memberRestoreNotices(result.outcome);
              if (notices.messages.length > 0) {
                setStep({ kind: "result", notices });
                return;
              }
              toast({ title: MEMBER_RESTORE_TEXTS.restored });
              onClose();
              return;
            }
            case "stale":
              toast({ title: result.message });
              onClose();
              return;
            case "refused":
              setStep({ kind: "blocked", block: restoreBlockFromRefusal(result.refusal) });
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
      .finally(() => {
        sending.current = false;
      });
  };

  const defineLeader = () => {
    formOpened.current = true;
    setStep({ kind: "form" });
  };

  if (step.kind === "form") {
    return <EditMemberDialog memberId={member.id} defineLeader onClose={onClose} onCloseAutoFocus={onCloseAutoFocus} />;
  }

  let content: ReactNode;
  if (step.kind === "result") {
    content = (
      <RestoreResultContent
        notices={step.notices}
        onDefineLeader={step.notices.withoutLeader && hasPermission("edit_member") ? defineLeader : null}
      />
    );
  } else if (step.kind === "blocked") {
    content = (
      <BlockedActionContent title={MEMBER_RESTORE_TEXTS.refusedTitle(name)} focusTitle>
        <p>{step.block.message}</p>
      </BlockedActionContent>
    );
  } else {
    content = (
      <>
        <AlertDialogHeader className="text-left">
          <AlertDialogTitle className="break-words">{MEMBER_RESTORE_TEXTS.confirmTitle(name)}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              <ul className="list-disc space-y-1 pl-5">
                {memberRestoreConsequences(member).map((consequence) => (
                  <li key={consequence}>{consequence}</li>
                ))}
              </ul>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel className={cn(DIALOG_FOOTER_BUTTON, "mt-0")} disabled={restoring}>
            {DELETION_TEXTS.cancel}
          </AlertDialogCancel>
          <Button
            type="button"
            className={cn(DIALOG_FOOTER_BUTTON, UNAVAILABLE_WHILE_SAVING)}
            aria-disabled={restoring || undefined}
            onClick={restoring ? undefined : handleRestore}
          >
            {restoring ? DELETION_TEXTS.restoring : MEMBER_RESTORE_TEXTS.confirmAction}
          </Button>
        </AlertDialogFooter>
      </>
    );
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !restoring) onClose();
      }}
    >
      <LongAlertDialogContent
        onCloseAutoFocus={(event) => {
          if (formOpened.current) event.preventDefault();
          else onCloseAutoFocus?.(event);
        }}
      >
        {content}
      </LongAlertDialogContent>
    </AlertDialog>
  );
};

export default RestoreMemberDialog;
