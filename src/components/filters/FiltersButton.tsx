import { forwardRef } from "react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { cn } from "@/lib/utils";

interface FiltersButtonProps {
  /** Quantos filtros estão em uso (P50: filtros, e não valores). */
  count: number;
  /** Abre o `Sheet` (abaixo de 1024 px) ou abre e fecha o painel acima da lista. */
  mode: "sheet" | "panel";
  /** O `Sheet` ou o painel está aberto. */
  expanded: boolean;
  /** O id do painel (`aria-controls`), no modo painel. */
  controlsId?: string;
  onClick: () => void;
}

/**
 * O botão "Filtros" (E2.07, P50): "Filtros" sem filtro e "Filtros ({N})" com N filtros, com
 * "Filtros ({N} ativos)" como nome acessível. No painel, o ícone gira quando ele está aberto.
 */
export const FiltersButton = forwardRef<HTMLButtonElement, FiltersButtonProps>(function FiltersButton(
  { count, mode, expanded, controlsId, onClick },
  ref,
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      className="h-11 w-fit md:h-10"
      aria-expanded={expanded}
      aria-haspopup={mode === "sheet" ? "dialog" : undefined}
      aria-controls={mode === "panel" ? controlsId : undefined}
      onClick={onClick}
    >
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? (
        // Visível "Filtros (2)"; o leitor de tela ouve "Filtros (2 ativos)".
        <span>
          {FILTER_TEXTS.button} ({count}
          <span className="sr-only">{`${FILTER_TEXTS.buttonCountSrSuffix})`}</span>
          <span aria-hidden="true">)</span>
        </span>
      ) : (
        <span>{FILTER_TEXTS.button}</span>
      )}
      {mode === "panel" && (
        <ChevronDown
          className={cn("h-4 w-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")}
          aria-hidden="true"
        />
      )}
    </Button>
  );
});
