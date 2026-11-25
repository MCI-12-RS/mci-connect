import { UserX } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import { badgeVariants } from "@/components/ui/badge";
import { levelInfo, type LevelInput } from "@/lib/hierarchy/level";
import { cn } from "@/lib/utils";

export interface LevelBadgeProps extends LevelInput {
  className?: string;
}

/**
 * Nível como badge (P40): "Pastor" (`default`), "G12", "144"… (`outline`) ou
 * "Sem liderança" com o aviso do P6 e o ícone. É um `span`, e não o `Badge`
 * (um `div`), para poder ficar dentro de um botão.
 */
const LevelBadge = ({ className, ...input }: LevelBadgeProps) => {
  const { label, tone, srPrefix } = levelInfo(input);
  if (tone === "no_leadership") {
    return (
      <StatusBadge tone="warning" icon={UserX} className={cn("whitespace-nowrap", className)}>
        {label}
      </StatusBadge>
    );
  }
  return (
    <span
      className={cn(badgeVariants({ variant: tone === "pastor" ? "default" : "outline" }), "whitespace-nowrap", className)}
    >
      {srPrefix && <span className="sr-only">{srPrefix} </span>}
      {label}
    </span>
  );
};

export default LevelBadge;
