import { useLayoutEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

/**
 * Toda navegação nova (`PUSH`) para outra rota começa do topo (E2.14, DA-5).
 * A volta (`POP`) e a troca com `replace` não mexem na rolagem, nem a troca
 * só de parâmetros na mesma rota (filtros, a consulta do E2.12).
 */
const ScrollToTopOnPush = () => {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();
  const lastPathname = useRef(pathname);

  useLayoutEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    if (navigationType === "PUSH") window.scrollTo(0, 0);
  }, [pathname, navigationType]);

  return null;
};

export default ScrollToTopOnPush;
