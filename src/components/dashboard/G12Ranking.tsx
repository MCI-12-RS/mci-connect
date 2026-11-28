import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useRowLink } from "@/hooks/use-row-link";
import type { DashboardG12Couple } from "@/lib/dashboard/cards";
import { DASHBOARD_PAGE_TEXTS, rankingLinkSuffix } from "@/lib/dashboard/texts";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

const TEXTS = DASHBOARD_PAGE_TEXTS.ranking;

// Espaçamento menor no celular, para a coluna Total caber sem rolar (E1.08).
const CELL = "px-2 sm:px-4 py-3";
const HEADER = `${CELL} font-medium text-muted-foreground`;

/** "Pedro & Paula", com o "&" fora do leitor de tela, que ouve "Pedro e Paula" (T5). */
const CoupleName = ({ row }: { row: DashboardG12Couple }) => (
  <>
    {row.name}
    {row.spouse_name && (
      <>
        <span aria-hidden="true">{TEXTS.coupleSeparator}</span>
        <span className="sr-only">{TEXTS.coupleSeparatorSpoken}</span>
        {row.spouse_name}
      </>
    )}
  </>
);

export interface G12RankingProps {
  rows: readonly DashboardG12Couple[];
  /** O endereço das células ativas do casal; `null` (Total 0 ou sem acesso), o nome é texto (PR 3). */
  hrefFor?: (row: DashboardG12Couple) => string | null;
  /** A chave da volta de cada linha (`g12:<couple_key>`, PR 3). */
  returnKeyFor?: (row: DashboardG12Couple) => string;
  /** Chamado ao abrir a lista pelo link (com o evento) ou pela linha (sem). */
  onOpen?: (row: DashboardG12Couple, event?: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * O ranking "Células por G12" (T5): a tabela de casais, na ordem do servidor,
 * com o Total em destaque. O nome do casal é o link, e o clique na linha é um
 * atalho do ponteiro para o mesmo endereço (P81).
 */
const G12Ranking = ({ rows, hrefFor, returnKeyFor, onOpen }: G12RankingProps) => {
  const rowLink = useRowLink();
  return (
    <Card className="lg:max-w-3xl">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{TEXTS.caption}</caption>
            <thead>
              <tr className="border-b">
                <th scope="col" className={cn(HEADER, "text-left")}>
                  {TEXTS.couple}
                </th>
                <th scope="col" className={cn(HEADER, "text-center")}>
                  {TEXTS.male}
                </th>
                <th scope="col" className={cn(HEADER, "text-center")}>
                  {TEXTS.female}
                </th>
                <th scope="col" className={cn(HEADER, "text-center")}>
                  {TEXTS.total}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const href = hrefFor?.(row) ?? null;
                let name: ReactNode = <CoupleName row={row} />;
                if (href) {
                  name = (
                    <Link
                      to={href}
                      onClick={(event) => onOpen?.(row, event)}
                      data-return-key={returnKeyFor?.(row)}
                      className="block min-h-11 rounded-sm py-3 font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      <CoupleName row={row} />
                      <span className="sr-only">{rankingLinkSuffix(row.total_cells)}</span>
                    </Link>
                  );
                }
                return (
                  <tr
                    key={row.couple_key}
                    className={cn(index % 2 === 0 && "bg-muted/30", href && "cursor-pointer hover:bg-muted/60")}
                    onClick={href ? rowLink(href, { onNavigate: () => onOpen?.(row) }) : undefined}
                  >
                    <th scope="row" className={cn(href ? "px-2 sm:px-4" : CELL, "text-left font-medium")}>
                      {name}
                    </th>
                    <td className={cn(CELL, "text-center tabular-nums")}>{formatCount(row.male_cells)}</td>
                    <td className={cn(CELL, "text-center tabular-nums")}>{formatCount(row.female_cells)}</td>
                    <td className={cn(CELL, "text-center font-semibold tabular-nums")}>
                      <span className="inline-flex items-center gap-1">
                        {formatCount(row.total_cells)}
                        {href && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
};

export default G12Ranking;
