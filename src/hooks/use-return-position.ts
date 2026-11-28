import { useCallback, useLayoutEffect, useRef, type MouseEvent } from "react";
import { useNavigationType } from "react-router-dom";
import { clearReturnPosition, readReturnPosition, sessionStore, writeReturnPosition } from "@/lib/navigation/return-position";

/** O atributo do item que a volta procura (o card, a linha do gráfico, o nome do casal). */
export const RETURN_KEY_ATTRIBUTE = "data-return-key";

export interface ReturnPositionOptions {
  /** A tela tem os dados no primeiro render (vieram do cache): só então a volta restaura (DA-4). */
  restorable: boolean;
  /** Para onde vai o foco quando o item guardado não está mais na tela (o `h2` da seção). */
  fallback?: (key: string) => HTMLElement | null;
}

/** O clique abre uma aba nova, ou não é o botão principal: não guarda nada (DA-4). */
function opensElsewhere(event: MouseEvent): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

/**
 * A volta de uma lista na mesma posição e com o foco no item aberto (E2.14,
 * DA-4, UXD-7). `remember(key, event?)` guarda o item e a rolagem da janela no
 * clique. Na montagem:
 * - numa volta (`POP`) com a entrada guardada e `restorable`, rola na hora
 *   para a posição guardada e põe o foco no item, sem rolar de novo;
 * - numa volta sem cache, começa do topo (a tela carrega do zero, RN-13);
 * - em todo caso, a entrada é apagada: vale uma vez.
 */
export function useReturnPosition(scope: string, { restorable, fallback }: ReturnPositionOptions) {
  const navigationType = useNavigationType();
  const mounted = useRef(false);
  // Lidos só na primeira montagem.
  const initial = useRef({ navigationType, restorable, fallback });

  useLayoutEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    const store = sessionStore();
    const saved = readReturnPosition(store, scope);
    clearReturnPosition(store, scope);
    const { navigationType: type, restorable: fromCache, fallback: fallbackFor } = initial.current;
    if (type !== "POP") return;
    if (!saved || !fromCache) {
      window.scrollTo({ top: 0, behavior: "instant" });
      return;
    }
    window.scrollTo({ top: saved.y, behavior: "instant" });
    const target = Array.from(document.querySelectorAll<HTMLElement>(`[${RETURN_KEY_ATTRIBUTE}]`)).find(
      (element) => element.getAttribute(RETURN_KEY_ATTRIBUTE) === saved.key,
    );
    (target ?? fallbackFor?.(saved.key))?.focus({ preventScroll: true });
  }, [scope]);

  return useCallback(
    (key: string, event?: MouseEvent) => {
      if (event && opensElsewhere(event)) return;
      writeReturnPosition(sessionStore(), scope, { key, y: window.scrollY });
    },
    [scope],
  );
}
