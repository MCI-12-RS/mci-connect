import { forwardRef } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { BackLink } from "@/lib/cells/detail";
import { CELL_DETAIL_TEXTS as TEXTS } from "@/lib/cells/detail-texts";

interface CellNotFoundProps {
  back: BackLink;
  onBack: () => void;
}

/**
 * "Célula não encontrada" (RN-14, UXD-11, T13): o mesmo DOM para a célula
 * invisível, a excluída, a inexistente e o id sem formato, sem nenhum dado da
 * célula. O botão volta como o link do topo (que não aparece aqui).
 */
export const CellNotFound = forwardRef<HTMLHeadingElement, CellNotFoundProps>(({ back, onBack }, ref) => (
  <div className="space-y-4">
    <h1 ref={ref} tabIndex={-1} className="text-2xl font-bold outline-none md:text-3xl">
      {TEXTS.notFound.title}
    </h1>
    <p className="text-muted-foreground">{TEXTS.notFound.description}</p>
    {back.kind === "link" ? (
      <Button asChild className="h-11 w-full sm:w-auto">
        <Link to={back.to}>{back.label}</Link>
      </Button>
    ) : (
      <Button type="button" className="h-11 w-full sm:w-auto" onClick={onBack}>
        {back.label}
      </Button>
    )}
  </div>
));
CellNotFound.displayName = "CellNotFound";
