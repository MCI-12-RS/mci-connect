import { useCallback, useEffect, useRef, type RefObject } from "react";

export interface ReturnFocus {
  /** Guarda quem abriu o diálogo: o ícone da linha, o "⋯" do card ou o botão do cabeçalho. */
  setOpener: (element: HTMLElement | null) => void;
  /** Vai no `onCloseAutoFocus` do conteúdo do diálogo (`AlertDialogContent`, `DialogContent`). */
  onCloseAutoFocus: (event: Event) => void;
  /**
   * Ação sem diálogo (o "Restaurar" de uma célula): o botão continua com o
   * foco e, se sair da página quando a lista recarregar, o foco vai para a busca.
   */
  trackFocus: (element: HTMLElement | null) => void;
}

/**
 * Devolve o foco a quem abriu um diálogo de uma lista (E2.01, Acessibilidade;
 * WCAG 2.4.3). Os diálogos das listas abrem por estado, sem o `Trigger` do
 * Radix, e o Radix levaria o foco ao `body` ao fechar.
 *
 * Ao fechar, o foco vai para o botão que abriu o diálogo. Se ele não está mais
 * na página (o item saiu da lista), vai para o campo de busca da lista. Se o
 * botão sair depois, quando a lista recarregar sem o item, o foco também passa
 * para a busca, desde que a pessoa não o tenha levado para outro lugar.
 *
 * @param searchRef o campo de busca da lista.
 * @param listData os dados da lista: a cada mudança, confere se o botão saiu da página.
 */
export function useReturnFocus(searchRef: RefObject<HTMLElement>, listData: unknown): ReturnFocus {
  const opener = useRef<HTMLElement | null>(null);
  // O botão que recebeu o foco de volta, enquanto a lista pode recarregar sem ele.
  const returnedTo = useRef<HTMLElement | null>(null);

  const setOpener = useCallback((element: HTMLElement | null) => {
    opener.current = element;
    returnedTo.current = null;
  }, []);

  const onCloseAutoFocus = useCallback(
    (event: Event) => {
      event.preventDefault();
      const target = opener.current;
      opener.current = null;
      if (target?.isConnected) {
        target.focus();
        returnedTo.current = target;
      } else {
        searchRef.current?.focus();
      }
    },
    [searchRef],
  );

  const trackFocus = useCallback((element: HTMLElement | null) => {
    opener.current = null;
    returnedTo.current = element;
  }, []);

  useEffect(() => {
    const target = returnedTo.current;
    if (!target || target.isConnected) return;
    returnedTo.current = null;
    // O botão saiu da página com o foco: o navegador o largou no `body`.
    const active = document.activeElement;
    if (active === null || active === document.body) searchRef.current?.focus();
  }, [listData, searchRef]);

  return { setOpener, onCloseAutoFocus, trackFocus };
}
