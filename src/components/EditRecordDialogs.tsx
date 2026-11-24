import { AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import MemberForm from "@/components/MemberForm";
import CellForm from "@/components/CellForm";
import { useMember } from "@/hooks/use-member";
import { useCell } from "@/hooks/use-cell";
import { CELL_DELETION_TEXTS, DELETION_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";

// Formulários abertos a partir de um id (os itens do bloqueio da exclusão de
// membro, E2.01 T3). Leem o registro na view e mostram o formulário de
// sempre; fechar ou salvar volta para a lista.

const DIALOG_CONTENT = "max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full";

interface LoadStateProps {
  isPending: boolean;
  isError: boolean;
  /** O registro não existe mais, foi excluído ou saiu do escopo. */
  isMissing: boolean;
  missingText: string;
  errorText: string;
  onRetry: () => void;
}

/** Carregando, erro ou registro inexistente; `null` com o registro pronto. */
function LoadState({ isPending, isError, isMissing, missingText, errorText, onRetry }: LoadStateProps) {
  if (isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    );
  }
  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="space-y-3 text-foreground">
          <p>{errorText}</p>
          <Button type="button" variant="outline" className="h-11 md:h-9" onClick={onRetry}>
            {DELETION_TEXTS.tryAgain}
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (isMissing) return <p className="text-sm">{missingText}</p>;
  return null;
}

interface EditByIdDialogProps {
  onClose: () => void;
  /** Ao fechar, leva o foco a quem abriu o fluxo (`useReturnFocus`). */
  onCloseAutoFocus?: (event: Event) => void;
}

/** "Editar Membro" de um membro pelo id. */
export function EditMemberDialog({ memberId, onClose, onCloseAutoFocus }: EditByIdDialogProps & { memberId: string }) {
  const { data: member, isPending, isError, refetch } = useMember(memberId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CONTENT} aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Editar Membro</DialogTitle>
        </DialogHeader>
        {member ? (
          <MemberForm member={member} onClose={onClose} />
        ) : (
          <LoadState
            isPending={isPending}
            isError={isError}
            isMissing={!isPending && !isError}
            missingText={MEMBER_DELETION_TEXTS.notFoundOrDeleted}
            errorText={MEMBER_DELETION_TEXTS.loadFailed}
            onRetry={() => void refetch()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "Editar Célula" de uma célula pelo id. */
export function EditCellDialog({ cellId, onClose, onCloseAutoFocus }: EditByIdDialogProps & { cellId: string }) {
  const { data: cell, isPending, isError, refetch } = useCell(cellId);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={DIALOG_CONTENT} aria-describedby={undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Editar Célula</DialogTitle>
        </DialogHeader>
        {cell ? (
          <CellForm cell={cell} onClose={onClose} />
        ) : (
          <LoadState
            isPending={isPending}
            isError={isError}
            isMissing={!isPending && !isError}
            missingText={CELL_DELETION_TEXTS.notFoundOrDeleted}
            errorText={CELL_DELETION_TEXTS.loadFailed}
            onRetry={() => void refetch()}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
