import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

/**
 * Se a pessoa pediu menos movimento no sistema (E2.10: a rolagem até a célula, o gráfico). O valor
 * certo já no primeiro render, e acompanha a mudança da preferência.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
