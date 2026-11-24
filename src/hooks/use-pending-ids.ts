import { useCallback, useRef, useState } from "react";

export interface PendingIds {
  /** O item tem uma gravação em andamento? */
  isPending: (id: string) => boolean;
  /**
   * Roda a gravação do item, se ele não tiver outra em andamento (um toque
   * duplo não faz duas chamadas). `null` quando já havia uma.
   */
  run: <T>(id: string, task: () => Promise<T>) => Promise<T> | null;
}

/**
 * Gravações em andamento por item de uma lista (E2.01, T6, UX-21): só o botão
 * daquele item fica indisponível, e os outros itens continuam livres.
 */
export function usePendingIds(): PendingIds {
  const pending = useRef(new Set<string>());
  const [snapshot, setSnapshot] = useState<ReadonlySet<string>>(() => new Set());

  const run = useCallback(<T,>(id: string, task: () => Promise<T>): Promise<T> | null => {
    if (pending.current.has(id)) return null;
    pending.current.add(id);
    setSnapshot(new Set(pending.current));
    return task().finally(() => {
      pending.current.delete(id);
      setSnapshot(new Set(pending.current));
    });
  }, []);

  const isPending = useCallback((id: string) => snapshot.has(id), [snapshot]);

  return { isPending, run };
}
