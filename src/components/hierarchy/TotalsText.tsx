import { TOTALS_TEXTS } from "@/lib/hierarchy/texts";
import { cellsText, disciplesText, totalsSpokenText, type TotalsInput } from "@/lib/hierarchy/totals";
import { cn } from "@/lib/utils";

export interface TotalsTextProps extends TotalsInput {
  /** `inline`: numa linha, que quebra no "·" (cartão, árvore); `stacked`: um total por linha (tabela). */
  layout?: "inline" | "stacked";
  className?: string;
}

/**
 * Totais por extenso (P42): "2 discípulos · 3 células". Cada total é uma
 * unidade que não se parte entre o número e a palavra; o leitor de tela ouve
 * "2 discípulos, 3 células".
 */
const TotalsText = ({ disciples, cells, layout = "inline", className }: TotalsTextProps) => {
  const spoken = <span className="sr-only">{totalsSpokenText({ disciples, cells })}</span>;
  if (layout === "stacked") {
    return (
      <span className={cn("flex flex-col text-sm", className)}>
        <span aria-hidden="true" className="whitespace-nowrap font-medium">
          {disciplesText(disciples)}
        </span>
        <span aria-hidden="true" className="whitespace-nowrap text-muted-foreground">
          {cellsText(cells)}
        </span>
        {spoken}
      </span>
    );
  }
  return (
    <span className={className}>
      <span aria-hidden="true">
        <span className="whitespace-nowrap">{disciplesText(disciples)}</span> {TOTALS_TEXTS.separator}{" "}
        <span className="whitespace-nowrap">{cellsText(cells)}</span>
      </span>
      {spoken}
    </span>
  );
};

export default TotalsText;
