import { useEffect, useRef, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { clearReturnPosition, readReturnPosition, sessionStore, writeReturnPosition } from "@/lib/navigation/return-position";

/** A tela no `return-position.ts` (o mesmo armazenamento da volta do Dashboard, E2.14). */
const RETURN_SCOPE = "cells";

/** O atributo do link de cada célula na lista (P81), que a volta procura. */
export const CELL_LINK_ATTRIBUTE = "data-cell-link";

/** O estado da navegação de quem volta do detalhe sem o histórico (aberto por link, ou depois de excluir). */
export interface ListReturnState {
  fromDetail: true;
}

export const FROM_DETAIL_STATE: ListReturnState = { fromDetail: true };

/** Grava o id da célula aberta no detalhe: a lista volta a ela (E2.10, UXD-10, AQ-8). */
export function rememberOpenedCell(cellId: string): void {
  writeReturnPosition(sessionStore(), RETURN_SCOPE, { key: cellId, y: typeof window === "undefined" ? 0 : window.scrollY });
}

function fromDetail(state: unknown): boolean {
  return typeof state === "object" && state !== null && "fromDetail" in state && state.fromDetail === true;
}

/**
 * Na volta do detalhe para a lista de Células (o "Voltar para Células" e o
 * voltar do navegador, pelo histórico; ou depois de excluir a célula), rola até
 * o link da célula aberta e põe o foco nele, quando os dados da lista chegam
 * (AQ-8). A rolagem é instantânea com `prefers-reduced-motion`. Se a célula
 * não está na página (ou foi excluída), o foco vai para o `h1` da lista. Numa
 * entrada pelo menu, a chave é apagada sem mexer no foco.
 *
 * @param ready os dados da página atual chegaram (não é a primeira carga nem a página de antes).
 * @param headingRef o `h1` "Células", com `tabIndex={-1}`.
 */
export function useListReturnFocus(ready: boolean, headingRef: RefObject<HTMLElement>): void {
  const navigationType = useNavigationType();
  const location = useLocation();
  const reduced = usePrefersReducedMotion();
  // Lido uma vez, na montagem da lista: só a volta do detalhe vale.
  const pending = useRef<string | null | undefined>(undefined);
  if (pending.current === undefined) {
    const stored = readReturnPosition(sessionStore(), RETURN_SCOPE)?.key ?? null;
    const returning = navigationType === "POP" || fromDetail(location.state);
    pending.current = returning ? stored : null;
    if (stored !== null && !returning) clearReturnPosition(sessionStore(), RETURN_SCOPE);
  }

  useEffect(() => {
    const cellId = pending.current;
    if (!ready || !cellId) return;
    pending.current = null;
    clearReturnPosition(sessionStore(), RETURN_SCOPE);
    const link = Array.from(document.querySelectorAll<HTMLElement>(`[${CELL_LINK_ATTRIBUTE}]`)).find(
      (element) => element.getAttribute(CELL_LINK_ATTRIBUTE) === cellId,
    );
    if (link) {
      // `scrollIntoView` falta no jsdom dos testes de componente.
      link.scrollIntoView?.({ block: "center", behavior: reduced ? "auto" : "smooth" });
      link.focus({ preventScroll: true });
    } else {
      headingRef.current?.focus();
    }
  }, [ready, reduced, headingRef]);
}
