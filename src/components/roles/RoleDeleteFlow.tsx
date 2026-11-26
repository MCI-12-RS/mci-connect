import { useState } from "react";
import { AlertDialog } from "@/components/ui/alert-dialog";
import LongAlertDialogContent from "@/components/LongAlertDialogContent";
import { BlockedActionContent } from "@/components/BlockedActionDialog";
import { ConfirmDeleteContent } from "@/components/ConfirmDeleteDialog";
import { useToast } from "@/hooks/use-toast";
import { useDeleteRole, useReloadRoles } from "@/hooks/use-roles";
import { ACCESS_TEXTS, ROLE_TEXTS } from "@/lib/access/texts";
import { classifyRoleWriteError, deleteBlockMessage, deleteConsequences, type Role } from "@/lib/roles/roles";

export interface RoleDeleteFlowProps {
  role: Role;
  /** Fim do fluxo: a tela volta para a lista. */
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o fluxo (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/**
 * Exclusão de uma função (E2.02, T4; RN-20):
 * - padrão ou em uso (a lista já sabe, AQ-2): abre direto o bloqueio, sem chamar o servidor;
 * - sem uso: a confirmação, e a exclusão pela `delete_role`;
 * - a recusa do servidor troca a confirmação pelo bloqueio, com a mensagem dele.
 *
 * Nenhuma recusa é silenciosa. Monte com `key` da função: cada abertura começa do zero.
 */
const RoleDeleteFlow = ({ role, onClose, onCloseAutoFocus }: RoleDeleteFlowProps) => {
  const { toast } = useToast();
  const deletion = useDeleteRole();
  const reload = useReloadRoles();
  const [initialBlock] = useState(() => deleteBlockMessage(role));
  const [serverBlock, setServerBlock] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deleting = deletion.isPending;
  const blockMessage = serverBlock ?? initialBlock;

  const handleDelete = async () => {
    if (deleting) return;
    setError(null);
    try {
      await deletion.mutateAsync(role.id);
    } catch (failure) {
      const result = classifyRoleWriteError(failure);
      switch (result.kind) {
        case "gate":
          onClose();
          return;
        case "forbidden":
          toast({ variant: "destructive", title: ACCESS_TEXTS.permissionDenied });
          onClose();
          return;
        case "gone":
          toast({ title: result.message });
          void reload();
          onClose();
          return;
        case "protected":
          toast({ variant: "destructive", title: result.message });
          onClose();
          return;
        case "name":
        case "refused":
          setServerBlock(result.message);
          void reload();
          return;
        case "network":
          setError(ROLE_TEXTS.deleteNetworkError);
          return;
        case "unexpected":
          setError(ROLE_TEXTS.deleteFailed);
          return;
      }
    }
    toast({ title: ROLE_TEXTS.deleted });
    onClose();
  };

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !deleting) onClose();
      }}
    >
      <LongAlertDialogContent onCloseAutoFocus={onCloseAutoFocus}>
        {blockMessage ? (
          <BlockedActionContent title={ROLE_TEXTS.deleteBlockedTitle(role.name)} focusTitle={serverBlock !== null}>
            <p>{blockMessage}</p>
          </BlockedActionContent>
        ) : (
          <ConfirmDeleteContent
            title={ROLE_TEXTS.deleteTitle(role.name)}
            consequences={deleteConsequences(role)}
            confirmLabel={ROLE_TEXTS.deleteAction}
            onConfirm={() => void handleDelete()}
            deleting={deleting}
            error={error}
          />
        )}
      </LongAlertDialogContent>
    </AlertDialog>
  );
};

export default RoleDeleteFlow;
