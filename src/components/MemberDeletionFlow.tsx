import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import LongAlertDialogContent from "@/components/LongAlertDialogContent";
import { ConfirmDeleteContent } from "@/components/ConfirmDeleteDialog";
import { BlockedActionContent } from "@/components/BlockedActionDialog";
import { EditCellDialog, EditMemberDialog } from "@/components/EditRecordDialogs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useDialogWrite } from "@/hooks/use-dialog-write";
import {
  useDeleteMember,
  useMarkMemberInactive,
  useMemberDeletionCheck,
  useRefreshMemberData,
} from "@/hooks/use-member-deletion";
import { buildBlockerGroups, memberLinksFromRefusal, type BlockerGroup } from "@/lib/deletion/blockers";
import { DELETION_TEXTS, MEMBER_DELETION_TEXTS, MEMBER_LINKS_TEXTS } from "@/lib/deletion/texts";
import type { AppError } from "@/lib/errors";

/** O membro que se quer excluir, como a lista o mostra. */
export interface MemberDeletionTarget {
  id: string;
  name: string;
  isActive: boolean;
}

interface MemberDeletionFlowProps {
  member: MemberDeletionTarget;
  /** Fim do fluxo: a tela volta para a lista. */
  onClose: () => void;
  /** Quando o último diálogo do fluxo fecha, leva o foco a quem o abriu (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** Depois do bloqueio, o fluxo pode abrir o formulário do discípulo ou da célula (T3). */
type Step = { kind: "dialog" } | { kind: "member"; id: string } | { kind: "cell"; id: string };

interface MemberLinksListProps {
  groups: BlockerGroup[];
  canOpenMember: boolean;
  canOpenCell: boolean;
  onOpenMember: (id: string) => void;
  onOpenCell: (id: string) => void;
}

const ITEM_CLASS = "flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left";

/** "Antes, reatribua:", os grupos de discípulos e de células e a ajuda (T3). */
function MemberLinksList({ groups, canOpenMember, canOpenCell, onOpenMember, onOpenCell }: MemberLinksListProps) {
  return (
    <>
      <p>{MEMBER_LINKS_TEXTS.intro}</p>
      {groups.map((group) => {
        const isDisciples = group.kind === "disciples";
        const canOpen = isDisciples ? canOpenMember : canOpenCell;
        const open = isDisciples ? onOpenMember : onOpenCell;
        return (
          <section key={group.kind} className="space-y-2">
            <h3 className="font-semibold">{group.title}</h3>
            <ul className="divide-y rounded-md border">
              {group.items.map((item) => (
                <li key={item.id}>
                  {canOpen ? (
                    <button
                      type="button"
                      className={`${ITEM_CLASS} rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                      aria-label={isDisciples ? MEMBER_LINKS_TEXTS.openMember(item.label) : undefined}
                      onClick={() => open(item.id)}
                    >
                      <span className="break-words">{item.label}</span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className={`${ITEM_CLASS} break-words`}>{item.label}</span>
                  )}
                </li>
              ))}
            </ul>
            {group.more && <p className="text-muted-foreground">{group.more}</p>}
          </section>
        );
      })}
      <p className="text-muted-foreground">{MEMBER_LINKS_TEXTS.help}</p>
    </>
  );
}

/**
 * Exclusão de um membro (E2.01, T2 e T3): verifica antes o que impede a
 * exclusão (UXD-2), mostra o bloqueio ou a confirmação no mesmo diálogo e
 * exclui pela RPC. Do bloqueio, abre o cadastro do discípulo ou a célula a
 * reatribuir. Monte com `key` do membro: cada abertura começa do zero.
 */
const MemberDeletionFlow = ({ member, onClose, onCloseAutoFocus }: MemberDeletionFlowProps) => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const check = useMemberDeletionCheck(member.id);
  const deletion = useDeleteMember();
  const inactivation = useMarkMemberInactive();
  const refresh = useRefreshMemberData();
  const [step, setStep] = useState<Step>({ kind: "dialog" });
  // Do bloqueio, o diálogo dá lugar ao formulário: o foco fica nele, e é o
  // formulário que o devolve a quem abriu o fluxo, quando fechar.
  const formOpened = useRef(false);
  const openForm = (next: Step) => {
    formOpened.current = true;
    setStep(next);
  };
  const [serverRefusal, setServerRefusal] = useState<AppError | null>(null);
  const write = useDialogWrite(onClose);

  const canEditMember = hasPermission("edit_member");
  const canEditCell = hasPermission("edit_cell");

  const precheck = check.data?.canDelete === false ? check.data.failure : null;
  const refusal = serverRefusal ?? (precheck?.kind === "refused" ? precheck.refusal : null);
  const checking = !refusal && (check.isPending || precheck?.kind === "gone");
  const busy = deletion.isPending || inactivation.isPending;

  // O cadastro já não existe para quem exclui: avisa sem erro e recarrega a lista (UX-24).
  const goneMessage = precheck?.kind === "gone" ? precheck.message : null;
  const goneHandled = useRef(false);
  useEffect(() => {
    if (!goneMessage || goneHandled.current) return;
    goneHandled.current = true;
    toast({ title: goneMessage });
    void refresh();
    onClose();
  }, [goneMessage, toast, refresh, onClose]);

  const handleDelete = () =>
    write.send(() => deletion.mutateAsync(member.id), {
      doneText: MEMBER_DELETION_TEXTS.deleted,
      networkText: DELETION_TEXTS.deleteNetworkError,
      unexpectedText: DELETION_TEXTS.deleteFailed,
      // A recusa do servidor troca o conteúdo para o bloqueio (UX-11).
      onRefused: setServerRefusal,
    });

  const handleInactivate = () =>
    write.send(() => inactivation.mutateAsync(member.id), {
      doneText: MEMBER_DELETION_TEXTS.inactivated,
      networkText: MEMBER_DELETION_TEXTS.inactivateNetworkError,
      unexpectedText: MEMBER_DELETION_TEXTS.inactivateFailed,
      // Uma regra que recuse o PATCH aparece no aviso do próprio diálogo.
      onRefused: (refusalFromServer) => write.setError(refusalFromServer.message),
    });

  if (step.kind === "member") {
    return <EditMemberDialog memberId={step.id} onClose={onClose} onCloseAutoFocus={onCloseAutoFocus} />;
  }
  if (step.kind === "cell") {
    return <EditCellDialog cellId={step.id} onClose={onClose} onCloseAutoFocus={onCloseAutoFocus} />;
  }

  const links = refusal ? memberLinksFromRefusal(refusal) : null;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <LongAlertDialogContent
        onCloseAutoFocus={(event) => {
          if (formOpened.current) event.preventDefault();
          else onCloseAutoFocus?.(event);
        }}
      >
        {refusal ? (
          <BlockedActionContent title={MEMBER_LINKS_TEXTS.blockedTitle(member.name)} focusTitle>
            {links ? (
              <MemberLinksList
                groups={buildBlockerGroups(links)}
                canOpenMember={canEditMember}
                canOpenCell={canEditCell}
                onOpenMember={(id) => openForm({ kind: "member", id })}
                onOpenCell={(id) => openForm({ kind: "cell", id })}
              />
            ) : (
              <p>{refusal.message}</p>
            )}
          </BlockedActionContent>
        ) : (
          <ConfirmDeleteContent
            title={MEMBER_DELETION_TEXTS.confirmTitle(member.name)}
            consequences={MEMBER_DELETION_TEXTS.consequences}
            hint={
              member.isActive
                ? {
                    text: MEMBER_DELETION_TEXTS.inactivateHint,
                    action: canEditMember
                      ? { label: MEMBER_DELETION_TEXTS.inactivateAction, onClick: handleInactivate }
                      : undefined,
                  }
                : undefined
            }
            confirmLabel={MEMBER_DELETION_TEXTS.deleteAction}
            onConfirm={handleDelete}
            deleting={deletion.isPending}
            busy={inactivation.isPending}
            checking={
              checking
                ? { text: MEMBER_DELETION_TEXTS.checking, actionLabel: MEMBER_DELETION_TEXTS.checkingAction }
                : null
            }
            error={write.error}
          />
        )}
      </LongAlertDialogContent>
    </AlertDialog>
  );
};

export default MemberDeletionFlow;
