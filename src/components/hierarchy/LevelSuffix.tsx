import { levelInfo, type LevelInput } from "@/lib/hierarchy/level";
import { cn } from "@/lib/utils";

export interface LevelSuffixProps extends LevelInput {
  className?: string;
}

/**
 * Nível entre parênteses, depois do nome (P40), onde o badge disputaria espaço
 * com botões (Células): "André Souza (144)". Os parênteses não são lidos: o
 * leitor de tela ouve ", nível 144", ", pastor" ou ", sem liderança".
 */
const LevelSuffix = ({ className, ...input }: LevelSuffixProps) => {
  const { label, spoken } = levelInfo(input);
  return (
    <span className={cn("font-normal text-muted-foreground", className)}>
      {" "}
      <span aria-hidden="true">({label})</span>
      <span className="sr-only">, {spoken}</span>
    </span>
  );
};

export default LevelSuffix;
