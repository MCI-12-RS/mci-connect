import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type StatusTone = "success" | "destructive" | "warning" | "muted";

// Fundo tingido e borda do mesmo token, com o texto em `text-foreground`:
// passa 4,5:1 nos dois temas, ao contrário do texto branco sobre `bg-success`
// ou `bg-warning`.
const TONES: Readonly<Record<StatusTone, string>> = {
  success: "bg-success/15 border-success/40",
  destructive: "bg-destructive/15 border-destructive/40",
  warning: "bg-warning/15 border-warning/40",
  muted: "bg-muted border-border",
};

export interface StatusBadgeProps {
  tone: StatusTone;
  /** Ícone do estado (decorativo: o texto diz o estado). */
  icon: LucideIcon;
  /** O estado, em texto: "Célula excluída". */
  children: ReactNode;
  className?: string;
}

/**
 * Badge de estado com contraste (padrão P6 do E2.01 e de Escolas): ícone e
 * texto, nunca só a cor.
 */
const StatusBadge = ({ tone, icon: Icon, children, className }: StatusBadgeProps) => (
  <span className={cn(badgeVariants({ variant: "outline" }), "gap-1 text-foreground", TONES[tone], className)}>
    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    {children}
  </span>
);

export default StatusBadge;
