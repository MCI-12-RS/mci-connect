import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CellStatusBadge } from "@/components/StatusBadges";
import { CellG12, CellLeader } from "@/components/cells/CellListParts";
import type { CellRow } from "@/lib/cells/fields";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";

interface CellCardProps {
  cell: CellRow;
  /** As ações do cartão ("Novo relatório", "Editar" e o "⋯"); nada quando a pessoa não tem nenhuma. */
  actions?: ReactNode;
}

/** Uma célula na lista em cartões (E2.06, T2; E2.08, T7). */
const CellCard = ({ cell: c, actions }: CellCardProps) => (
  <div className="px-4 py-4 space-y-3">
    {/* Com a fonte ampliada, as ações descem para a linha de baixo. */}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="grow basis-32 min-w-0">
        <p className="text-sm">
          <CellLeader cell={c} className="font-semibold" />
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {CELLS_LIST_TEXTS.g12Label} <CellG12 cell={c} />
        </p>
      </div>
      {actions}
    </div>

    <div className="flex gap-4 text-xs text-muted-foreground">
      {c.timothy_name && (
        <span>Timóteo: <span className="font-medium text-foreground">{c.timothy_name}</span></span>
      )}
      {c.host_name && (
        <span>Anfitrião: <span className="font-medium text-foreground">{c.host_name}</span></span>
      )}
    </div>

    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{c.type}</Badge>
        <CellStatusBadge active={c.is_active === true} />
      </div>
      <span className="text-xs text-muted-foreground">
        {c.meeting_day} · {c.meeting_time?.substring(0, 5) || "—"}
      </span>
    </div>

    {c.street && (
      <p className="text-xs text-muted-foreground">
        {c.street}, {c.number || "s/n"} — {c.neighborhood || ""}
      </p>
    )}
  </div>
);

export default CellCard;
