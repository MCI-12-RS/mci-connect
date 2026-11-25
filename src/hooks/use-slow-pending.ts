import { useEffect, useState } from "react";

/** Depois de quanto tempo uma gravação pendente avisa "Ainda salvando…" (E2.06, P44 e UXD-11). */
export const SLOW_PENDING_MS = 3_000;

/**
 * Verdadeiro depois de 3 s com a gravação pendente, e falso assim que ela
 * termina (P44): o aviso "Ainda salvando…" aparece aos 3 s, e não antes, e
 * some quando a resposta chega.
 */
export function useSlowPending(pending: boolean, delayMs: number = SLOW_PENDING_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [pending, delayMs]);

  return pending && slow;
}
