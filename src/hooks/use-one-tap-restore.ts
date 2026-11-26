import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { usePendingIds } from "@/hooks/use-pending-ids";
import type { ReturnFocus } from "@/hooks/use-return-focus";
import type { RestoreBlock, RestoreResult } from "@/lib/deletion/restore";
import { DELETION_TEXTS } from "@/lib/deletion/texts";
import type { AppError } from "@/lib/errors";
import { requestGate } from "@/lib/auth/session-check";

/** O diálogo de bloqueio aberto: "Não é possível restaurar {item}", o motivo e a ação que resolve. */
export interface OpenRestoreBlock {
  title: string;
  block: RestoreBlock;
}

export interface OneTapRestoreOptions<Row> {
  rowId: (row: Row) => string;
  /** A RPC, pelo hook de `use-restore` (não lança). */
  restore: (id: string) => Promise<RestoreResult>;
  /** Toast do sucesso: "Célula restaurada.". */
  doneText: string;
  /** "Não é possível restaurar a célula de {Líder}". */
  refusedTitle: (row: Row) => string;
  /** O motivo que a linha já mostra (aviso antecipado): o bloqueio abre sem chamar o servidor. */
  anticipatedBlock: (row: Row) => RestoreBlock | null;
  /** O bloqueio de uma recusa do servidor. */
  blockFromRefusal: (row: Row, refusal: AppError) => RestoreBlock;
}

/**
 * Restauração com um toque (E2.01, T6, UXD-6): célula e relatório. Só o botão
 * do item fica "Restaurando…" (UX-21); no fim, o toast do Negócio, o aviso
 * informativo (UX-24) ou o diálogo de bloqueio (UX-23).
 *
 * @param focus o foco da lista: volta ao "Restaurar" quando o bloqueio fecha e
 *   vai para a busca quando o item sai da lista.
 */
export function useOneTapRestore<Row>(options: OneTapRestoreOptions<Row>, focus: ReturnFocus) {
  const { toast } = useToast();
  const pending = usePendingIds();
  const [blocked, setBlocked] = useState<OpenRestoreBlock | null>(null);

  const openBlock = (row: Row, block: RestoreBlock, button: HTMLElement) => {
    focus.setOpener(button);
    setBlocked({ title: options.refusedTitle(row), block });
  };

  const showResult = (row: Row, result: RestoreResult, button: HTMLElement) => {
    switch (result.kind) {
      case "done":
        toast({ title: options.doneText });
        return;
      case "stale":
        toast({ title: result.message });
        return;
      case "refused":
        openBlock(row, options.blockFromRefusal(row, result.refusal), button);
        return;
      case "gate":
        requestGate(result.code);
        return;
      case "forbidden":
        toast({ variant: "destructive", title: DELETION_TEXTS.permissionDenied });
        return;
      case "network":
        toast({ variant: "destructive", title: DELETION_TEXTS.restoreNetworkError });
        return;
      case "unexpected":
        toast({ variant: "destructive", title: DELETION_TEXTS.restoreFailed });
    }
  };

  const restore = (row: Row, button: HTMLElement) => {
    const anticipated = options.anticipatedBlock(row);
    if (anticipated) {
      openBlock(row, anticipated, button);
      return;
    }
    const id = options.rowId(row);
    const task = pending.run(id, () => options.restore(id));
    if (!task) return;
    focus.trackFocus(button);
    void task.then(
      (result) => showResult(row, result, button),
      () => toast({ variant: "destructive", title: DELETION_TEXTS.restoreFailed }),
    );
  };

  return {
    restore,
    isRestoring: pending.isPending,
    blocked,
    closeBlocked: () => setBlocked(null),
  };
}
