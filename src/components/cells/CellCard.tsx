import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CellStatusBadge } from "@/components/StatusBadges";
import { ChevronRight } from "lucide-react";
import { AboveCardLink, CellDetailLink, CellG12, CellMeeting } from "@/components/cells/CellListParts";
import ReportStatus from "@/components/cells/ReportStatus";
import type { CellListRow } from "@/lib/cells/fields";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";

interface CellCardProps {
  cell: CellListRow;
  /** As ações do cartão ("Novo relatório", "Editar" e o "⋯"); nada quando a pessoa não tem nenhuma. */
  actions?: ReactNode;
}

/**
 * Uma célula na lista em cartões, até 1279 px (E2.06, T2; E2.08, T7; E2.09,
 * T1 e P74). A ordem é a da UXD-4: o líder e as ações; G12, Timóteo, Anfitrião
 * e endereço; tipo e situação, dia e horário; e o relatório. De 1024 a 1279
 * px, o corpo vira duas colunas, "quem e onde" à esquerda e "quando e
 * relatório" à direita, sem reordenar o DOM.
 *
 * O cartão inteiro abre o detalhe (E2.10, P81, UXD-4): o nome do líder é um
 * link esticado sobre o cartão, e as ações ficam por cima, fora do link.
 */
const CellCard = ({ cell: c, actions }: CellCardProps) => (
  <li className="relative space-y-3 px-4 py-4">
    {/* Com a fonte ampliada, as ações descem para a linha de baixo. */}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="grow basis-32 min-w-0 text-sm">
        <CellDetailLink cell={c} stretched className="font-semibold" />
      </p>
      {actions && <AboveCardLink>{actions}</AboveCardLink>}
    </div>

    {/* `pr-6`: o espaço do `ChevronRight` no canto de baixo (P81). */}
    <div className="space-y-3 pr-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-x-8 lg:space-y-0">
      <div className="space-y-1 text-xs text-muted-foreground" data-part="people">
        <p>
          {CELLS_LIST_TEXTS.g12Label} <CellG12 cell={c} />
        </p>
        {c.timothy_name && (
          <p className="break-words">
            Timóteo: <span className="font-medium text-foreground">{c.timothy_name}</span>
          </p>
        )}
        {c.host_name && (
          <p className="break-words">
            Anfitrião: <span className="font-medium text-foreground">{c.host_name}</span>
          </p>
        )}
        {c.street && (
          <p className="break-words">
            {c.street}, {c.number || "s/n"} — {c.neighborhood || ""}
          </p>
        )}
      </div>

      <div className="space-y-2" data-part="meeting">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{c.type}</Badge>
          <CellStatusBadge active={c.is_active === true} />
        </div>
        <p className="text-xs text-muted-foreground">
          <CellMeeting cell={c} />
        </p>
        <ReportStatus
          variant="card"
          status={c.report_status}
          missingWeeks={c.report_missing_weeks}
          isActive={c.is_active}
        />
      </div>
    </div>
    <ChevronRight className="pointer-events-none absolute bottom-4 right-4 h-4 w-4 text-muted-foreground" aria-hidden="true" />
  </li>
);

export default CellCard;
