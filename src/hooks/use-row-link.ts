import { useCallback, type MouseEvent } from "react";
import { useNavigate } from "react-router-dom";

export interface RowLinkOptions {
  /** O estado da navegação (o `fromList` do detalhe da célula, E2.10). */
  state?: unknown;
  /** Chamado antes de navegar (a volta na mesma posição do Dashboard, E2.14). */
  onNavigate?: () => void;
}

/**
 * O atalho do ponteiro de uma linha de tabela que abre outra tela (P81, E2.10
 * e E2.14): o clique em qualquer lugar da linha navega para o mesmo endereço
 * do link dela, ignorando o clique no próprio link, nos botões e nos itens de
 * menu, e a seleção de texto. Pelo teclado, só o link recebe o foco.
 */
export function useRowLink() {
  const navigate = useNavigate();
  return useCallback(
    (to: string, options: RowLinkOptions = {}) =>
      (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest("a, button, [role='menuitem']")) return;
        if (window.getSelection()?.toString()) return;
        options.onNavigate?.();
        navigate(to, { state: options.state });
      },
    [navigate],
  );
}
