import LevelSuffix from "@/components/hierarchy/LevelSuffix";
import { CellG12 } from "@/components/cells/CellListParts";
import { useMemberStatuses } from "@/hooks/use-member-statuses";
import type { CellRow } from "@/lib/cells/fields";
import { cellLeaderLevel } from "@/lib/cells/labels";
import { CELL_DETAIL_TEXTS as TEXTS } from "@/lib/cells/detail-texts";
import { personLabel } from "@/lib/members/labels";
import { DetailSection } from "./DetailSection";

/**
 * Pessoas da célula (RN-15 a e b, T8): líder com o nível (P40), timóteo,
 * anfitrião e o G12 numa `dl`. "(inativo)"/"(inativa)" só para quem vê a
 * pessoa (P63, `use-member-statuses`). Os nomes são de referência: só texto.
 */
export const CellPeopleSection = ({ cell }: { cell: CellRow }) => {
  const statuses = useMemberStatuses([cell.leader_id, cell.timothy_id, cell.host_id]);
  const name = (id: string | null, fallback: string | null) => {
    const status = id ? statuses.data?.get(id) : undefined;
    return personLabel({ name: fallback, is_active: status?.is_active, gender: status?.gender });
  };

  return (
    <DetailSection title={TEXTS.sections.people}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{TEXTS.people.leader}</dt>
        <dd className="min-w-0 break-words text-foreground">
          {name(cell.leader_id, cell.leader_name)}
          {cell.leader_name && <LevelSuffix {...cellLeaderLevel(cell)} />}
        </dd>
        <dt className="text-muted-foreground">{TEXTS.people.timothy}</dt>
        <dd className="min-w-0 break-words text-foreground">{name(cell.timothy_id, cell.timothy_name)}</dd>
        <dt className="text-muted-foreground">{TEXTS.people.host}</dt>
        <dd className="min-w-0 break-words text-foreground">{name(cell.host_id, cell.host_name)}</dd>
        <dt className="text-muted-foreground">{TEXTS.people.g12}</dt>
        <dd className="min-w-0 break-words text-foreground">
          <CellG12 cell={cell} />
        </dd>
      </dl>
    </DetailSection>
  );
};
