import { useCallback } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { withQueryParam } from "@/lib/navigation";

/**
 * Um parâmetro da URL (por exemplo, o `report` que abre o painel de consulta
 * em Relatórios, E2.01 T7) e a função que o troca ou o retira (`null`).
 *
 * Troca o endereço sem criar entrada no histórico, como o
 * `useListSearchParams`, e mantém os outros parâmetros (`q`, `page`, `size`)
 * e o estado da navegação.
 */
export function useSearchParam(name: string): [string | null, (value: string | null) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state: navigationState } = useLocation();
  const value = searchParams.get(name) || null;

  const setValue = useCallback(
    (next: string | null) =>
      setSearchParams((prev) => withQueryParam(prev, name, next), { replace: true, state: navigationState }),
    [setSearchParams, name, navigationState],
  );

  return [value, setValue];
}
