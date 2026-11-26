import { useEffect, useState } from "react";

/** A partir daqui, as listas densas mostram a tabela; abaixo, os cartões (P45, `lg`). */
export const TABLE_MIN_WIDTH = 1024;
/**
 * Células: a tabela com a coluna Relatório não cabe em 720 px, então os cartões
 * vão até 1279 px e a tabela entra em 1280 px (E2.09, P74, UXD-5).
 */
export const CELLS_TABLE_MIN_WIDTH = 1280;
/** A partir daqui, as colunas secundárias (foto, celular) entram na tabela (P45, `xl`). */
export const WIDE_TABLE_MIN_WIDTH = 1280;

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * A janela tem pelo menos `minWidth` px? Lê o `matchMedia` já no valor inicial,
 * para o primeiro render sair com o layout certo (P45): o `useIsMobile`
 * começa em `false` e faria o celular piscar a tabela.
 */
export function useMinWidth(minWidth: number): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [isWide, setIsWide] = useState(() => matches(query));

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setIsWide(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return isWide;
}
