import type { MouseEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { AboveCardLink } from "@/components/cells/CellListParts";
import type { ReportRowView } from "@/lib/cell-reports/report-row";
import { REPORT_ROW_TEXTS as TEXTS } from "@/lib/cell-reports/filter-texts";
import { ReportAddress, ReportBadges, ReportDay, ReportG12, ReportText } from "./ReportRowParts";

/** O atributo do botão que abre a consulta: a volta do foco o procura (T9). */
export const REPORT_OPEN_ATTRIBUTE = "data-report-id";

interface ReportCardProps {
  row: ReportRowView;
  /** "Editar" e o "⋯", por cima do botão esticado; nada quando a pessoa não tem nenhuma. */
  actions?: ReactNode;
  onOpen: (opener: HTMLElement) => void;
}

/** Uma unidade dos números, que não quebra por dentro (UXD-6). */
const NumberItem = ({ label, value }: { label: string; value: string | number }) => (
  <span className="whitespace-nowrap">
    <span className="text-muted-foreground">{label}</span> <span className="font-medium tabular-nums">{value}</span>
  </span>
);

const Dot = () => <span aria-hidden="true">·</span>;

/**
 * Um relatório na lista em cartões, até 1279 px (E2.12, T1, UXD-6). De 1024 a 1279 px, o corpo vira
 * duas colunas sem reordenar o DOM (T2). O cartão inteiro abre a consulta (P91): o nome do líder é um
 * botão esticado sobre o cartão, e as ações ficam por cima, fora dele.
 */
const ReportCard = ({ row, actions, onOpen }: ReportCardProps) => (
  <li className="relative space-y-2 px-4 py-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="min-w-0 grow basis-32 text-sm">
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={row.openLabel}
          {...{ [REPORT_OPEN_ATTRIBUTE]: row.id }}
          onClick={(event: MouseEvent<HTMLButtonElement>) => onOpen(event.currentTarget)}
          className="break-words rounded-sm text-left font-semibold outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
        >
          {row.leader}
        </button>
      </p>
      {actions && <AboveCardLink>{actions}</AboveCardLink>}
    </div>

    <div className="space-y-2 pr-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:space-y-0">
      <div className="space-y-0.5 text-sm">
        <p className="text-muted-foreground">
          <ReportG12 row={row} />
        </p>
        <p>
          <ReportDay row={row} />
          {row.date.time && (
            <>
              <span aria-hidden="true"> · </span>
              <span className="sr-only">, </span>
              {row.date.time}
            </>
          )}
        </p>
        <p className="break-words text-muted-foreground">
          <ReportAddress row={row} />
        </p>
      </div>
      <div className="space-y-2">
        <ReportBadges row={row} />
        <ReportText row={row} />
        {row.numbers && (
          <p className="flex flex-wrap gap-x-2 text-sm">
            <NumberItem label={TEXTS.participants} value={row.numbers.participants} />
            <Dot />
            <NumberItem label={TEXTS.visitors} value={row.numbers.visitors} />
            <Dot />
            <NumberItem label={TEXTS.offering} value={row.numbers.offering} />
          </p>
        )}
      </div>
    </div>
    <ChevronRight className="pointer-events-none absolute bottom-4 right-4 h-4 w-4 text-muted-foreground" aria-hidden="true" />
  </li>
);

export default ReportCard;
