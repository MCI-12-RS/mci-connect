import { forwardRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CellStatusBadge } from "@/components/StatusBadges";
import { FROM_DETAIL_STATE } from "@/hooks/use-list-return-focus";
import type { BackLink } from "@/lib/cells/detail";
import { CELL_DETAIL_TEXTS as TEXTS } from "@/lib/cells/detail-texts";

/**
 * "Voltar para Células" ou "Ir para o início" (P80, UXD-10). Vindo da lista,
 * o clique volta pelo histórico, que devolve a URL da lista com os filtros, a
 * busca e a página (AQ-8); o endereço do link continua sendo `/cells`.
 */
export const CellBackLink = ({ back, onBack }: { back: BackLink; onBack: () => void }) => (
  <Button asChild variant="link" className="-ml-2 h-11 px-2 text-foreground">
    <Link
      to={back.kind === "link" ? back.to : "/cells"}
      state={FROM_DETAIL_STATE}
      onClick={(event) => {
        if (back.kind !== "history" || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onBack();
      }}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {back.label}
    </Link>
  </Button>
);

interface CellDetailHeaderProps {
  back: BackLink;
  onBack: () => void;
  /** O `h1`: "Célula de {Líder}" ou, sem a célula, "Célula". */
  title: string;
  /** As partes do complemento ("Quarta · 20:00 · Evangelística"); nulo enquanto carrega por link. */
  meeting: readonly string[] | null;
  /** Ativa ou inativa; nulo enquanto carrega por link. */
  isActive: boolean | null;
  /** As ações a partir de 768 px, à direita do título (T9). */
  desktopActions?: ReactNode;
  /** As ações do cabeçalho abaixo de 768 px: "Editar célula" e o "⋯" (UXD-6). */
  mobileActions?: ReactNode;
  /** Carregando por link: `Skeleton` no lugar do complemento e da situação (T13). */
  loading?: boolean;
}

/**
 * O topo do detalhe (P80, T8, T9): voltar, `h1` com o foco ao abrir,
 * complemento ("Reunião: " em `sr-only`, os "·" fora do leitor de tela),
 * situação e as ações.
 */
export const CellDetailHeader = forwardRef<HTMLHeadingElement, CellDetailHeaderProps>(
  ({ back, onBack, title, meeting, isActive, desktopActions, mobileActions, loading = false }, ref) => (
    <div className="space-y-2">
      <CellBackLink back={back} onBack={onBack} />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 ref={ref} tabIndex={-1} className="break-words text-2xl font-bold outline-none md:text-3xl">
            {title}
            {loading && <Skeleton className="ml-2 inline-block h-7 w-40 align-middle" aria-hidden="true" />}
          </h1>
          {loading ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-5 w-16" />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {meeting && meeting.length > 0 && (
                <p className="text-muted-foreground" data-testid="cell-detail-meeting">
                  <span className="sr-only">{TEXTS.meetingSpoken}</span>
                  {meeting.map((part, index) => (
                    <span key={`${index}-${part}`}>
                      {index > 0 && (
                        <>
                          <span aria-hidden="true"> · </span>
                          <span className="sr-only">, </span>
                        </>
                      )}
                      {part}
                    </span>
                  ))}
                </p>
              )}
              {isActive !== null && <CellStatusBadge active={isActive} />}
            </div>
          )}
        </div>
        {desktopActions && <div className="hidden flex-wrap gap-2 md:flex">{desktopActions}</div>}
      </div>
      {mobileActions && <div className="flex flex-wrap items-center gap-2 md:hidden">{mobileActions}</div>}
    </div>
  ),
);
CellDetailHeader.displayName = "CellDetailHeader";
