import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import DashboardIcon from "@/components/dashboard/DashboardIcon";
import type { CardTone, DashboardIconKey, DashboardList } from "@/lib/dashboard/cards";
import { DASHBOARD_PAGE_TEXTS, listDestinationText } from "@/lib/dashboard/texts";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** P111: fundo e borda, título, ícone e hover de cada tom. O número fica sempre em `text-foreground`. */
const TONES: Readonly<Record<CardTone, { box: string; title: string; icon: string; hover: string }>> = {
  neutral: { box: "bg-card", title: "text-muted-foreground", icon: "text-muted-foreground", hover: "hover:bg-muted/50" },
  warning: {
    box: "bg-warning/10 border-warning/50 border-l-4 border-l-warning",
    title: "text-foreground",
    icon: "text-warning",
    hover: "hover:bg-warning/20",
  },
  success: { box: "bg-success/10 border-success/50", title: "text-foreground", icon: "text-success", hover: "hover:bg-success/20" },
};

const CARD = "flex h-full flex-col gap-2 rounded-lg border p-4 text-card-foreground";
const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export interface StatCardProps {
  title: string;
  /** Sem valor (carregando), o número é um `Skeleton`. */
  value: number | undefined;
  /** Sem ícone: o card de pendentes enquanto carrega (T7). */
  icon: DashboardIconKey | null;
  tone: CardTone;
  /** A lista que o número abre, para o nome acessível. */
  list: DashboardList;
  /** O endereço da lista; sem ele, o card é um `div`, sem seta e fora do Tab (P110). */
  href?: string | null;
  /** A chave da volta na mesma posição (`data-return-key`, PR 3). */
  returnKey?: string;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Um card de número (P110, P111, T3): o `li` da grade, com o card inteiro como
 * link quando há `href`. O nome acessível é "{Título}: {número}, ver na lista
 * de {Lista}", com o ":" e o destino em `sr-only`.
 */
const StatCard = ({ title, value, icon, tone, list, href, returnKey, onOpen }: StatCardProps) => {
  const styles = TONES[tone];
  const content: ReactNode = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className={cn("min-w-0 break-words text-sm font-medium leading-snug", styles.title)}>
          {title}
          {value !== undefined && <span className="sr-only">{DASHBOARD_PAGE_TEXTS.numberSeparator}</span>}
        </span>
        {icon && <DashboardIcon icon={icon} className={styles.icon} />}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        {value === undefined ? (
          <Skeleton className="h-9 w-16" />
        ) : (
          <span className="text-3xl font-bold tabular-nums text-foreground">{formatCount(value)}</span>
        )}
        {href && <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </div>
      {href && <span className="sr-only">{listDestinationText(list)}</span>}
    </>
  );

  return (
    <li className="h-full">
      {href ? (
        <Link
          to={href}
          onClick={onOpen}
          data-return-key={returnKey}
          className={cn(CARD, styles.box, styles.hover, FOCUS_RING, "transition-colors motion-reduce:transition-none")}
        >
          {content}
        </Link>
      ) : (
        <div className={cn(CARD, styles.box)}>{content}</div>
      )}
    </li>
  );
};

export default StatCard;
