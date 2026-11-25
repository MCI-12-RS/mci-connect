import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Abaixo de 768 px? `undefined` até medir (o primeiro render): a tela que
 * troca de estrutura mostra o `Skeleton` nesse meio tempo, sem piscar o
 * layout de desktop no celular (E2.02, T2).
 */
export function useMobileState(): boolean | undefined {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export function useIsMobile() {
  return !!useMobileState();
}
