import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import LongAlertDialogContent from "@/components/LongAlertDialogContent";
import { ConfirmDeleteContent } from "@/components/ConfirmDeleteDialog";
import { BlockedActionContent } from "@/components/BlockedActionDialog";
import { EditCellDialog, EditMemberDialog } from "@/components/EditRecordDialogs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  useDeleteMember,
  useMarkMemberInactive,
  useMemberDeletionCheck,
  useRefreshMemberData,
  type MemberWriteResult,
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
}

/** Textos e reação de cada gravação do diálogo (excluir ou inativar). */
interface ResultHandlers {
  doneText: string;
  networkText: string;
  unexpectedText: string;
  onRefused: (refusal: AppError) => void;
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
const MemberDeletionFlow = ({ member, onClose }: MemberDeletionFlowProps) => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const check = useMemberDeletionCheck(member.id);
  const deletion = useDeleteMember();
  const inactivation = useMarkMemberInactive();
  const refresh = useRefreshMemberData();
  const [step, setStep] = useState<Step>({ kind: "dialog" });
  const [serverRefusal, setServerRefusal] = useState<AppError | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  // Um toque duplo, antes de o botão desabilitar, não faz duas chamadas (UX-06).
  const sending = useRef(false);

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

  /** Fecha, avisa ou mostra a falha no diálogo, conforme o resultado da gravação. */
  const handleResult = (result: MemberWriteResult, handlers: ResultHandlers) => {
    switch (result.kind) {
      case "done":
        toast({ title: handlers.doneText });
        onClose();
        return;
      case "gone":
        toast({ title: result.message });
        onClose();
        return;
      case "forbidden":
        toast({ variant: "destructive", title: DELETION_TEXTS.permissionDenied });
        onClose();
        return;
      case "refused":
        handlers.onRefused(result.refusal);
        return;
      case "network":
        setSendError(handlers.networkText);
        return;
      case "unexpected":
        setSendError(handlers.unexpectedText);
    }
  };

  /** Uma gravação por vez; uma falha inesperada (que não veio classificada) pede para tentar de novo. */
  const send = (run: () => Promise<void>, failedText: string) => {
    if (sending.current) return;
    sending.current = true;
    setSendError(null);
    void run()
      .catch(() => setSendError(failedText))
      .finally(() => {
        sending.current = false;
      });
  };

  const handleDelete = () =>
    send(async () => {
      handleResult(await deletion.mutateAsync(member.id), {
        doneText: MEMBER_DELETION_TEXTS.deleted,
        networkText: DELETION_TEXTS.deleteNetworkError,
        unexpectedText: DELETION_TEXTS.deleteFailed,
        // A recusa do servidor troca o conteúdo para o bloqueio (UX-11).
        onRefused: setServerRefusal,
      });
    }, DELETION_TEXTS.deleteFailed);

  const handleInactivate = () =>
    send(async () => {
      handleResult(await inactivation.mutateAsync(member.id), {
        doneText: MEMBER_DELETION_TEXTS.inactivated,
        networkText: MEMBER_DELETION_TEXTS.inactivateNetworkError,
        unexpectedText: MEMBER_DELETION_TEXTS.inactivateFailed,
        // Uma regra que recuse o PATCH aparece no aviso do próprio diálogo.
        onRefused: (refusalFromServer) => setSendError(refusalFromServer.message),
      });
    }, MEMBER_DELETION_TEXTS.inactivateFailed);

  if (step.kind === "member") return <EditMemberDialog memberId={step.id} onClose={onClose} />;
  if (step.kind === "cell") return <EditCellDialog cellId={step.id} onClose={onClose} />;

  const links = refusal ? memberLinksFromRefusal(refusal) : null;

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <LongAlertDialogContent>
        {refusal ? (
          <BlockedActionContent title={MEMBER_LINKS_TEXTS.blockedTitle(member.name)} focusTitle>
            {links ? (
              <MemberLinksList
                groups={buildBlockerGroups(links)}
                canOpenMember={canEditMember}
                canOpenCell={canEditCell}
                onOpenMember={(id) => setStep({ kind: "member", id })}
                onOpenCell={(id) => setStep({ kind: "cell", id })}
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
            error={sendError}
          />
        )}
      </LongAlertDialogContent>
    </AlertDialog>
  );
};

export default MemberDeletionFlow;
