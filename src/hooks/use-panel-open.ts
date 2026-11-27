import { useCallback, useState } from "react";

/** A chave no `localStorage` de um painel de filtros (E2.07, UXD-14). */
export const panelOpenStorageKey = (list: string): string => `filters-panel-open:${list}`;

function readStored(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    // Navegação privada ou armazenamento bloqueado: começa fechado.
    return false;
  }
}

/**
 * Se o painel de filtros do computador está aberto (E2.07, UXD-14; P50): começa fechado e lembra,
 * neste navegador, o último estado. É preferência de quem usa, e não estado da lista: fica fora da URL.
 */
export function usePanelOpen(list: string): [open: boolean, setOpen: (open: boolean) => void] {
  const key = panelOpenStorageKey(list);
  const [open, setOpenState] = useState(() => readStored(key));
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      try {
        window.localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Sem armazenamento: vale só nesta visita.
      }
    },
    [key],
  );
  return [open, setOpen];
}
