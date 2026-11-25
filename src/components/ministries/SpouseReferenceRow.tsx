import { CornerLeftUp } from "lucide-react";
import LevelBadge from "@/components/hierarchy/LevelBadge";
import { Button } from "@/components/ui/button";
import { MINISTRIES_TEXTS } from "@/lib/hierarchy/texts";
import { findCoupleInPath, type MinistrySpouseReference } from "@/lib/ministries/tree";
import { ROW, ROW_ICON_SLOT, type TreePathEntry } from "./tree-shared";

interface SpouseReferenceRowProps {
  reference: MinistrySpouseReference;
  /** Os nós abertos, da raiz ao pai desta linha. */
  path: readonly TreePathEntry[];
}

/**
 * Quem aparece com o cônjuge num nó mais acima (T4, P43): o nome, o nível,
 * onde a pessoa aparece e "Ir para o casal". Não abre e não mostra totais.
 */
const SpouseReferenceRow = ({ reference, path }: SpouseReferenceRowProps) => {
  const couple = findCoupleInPath(path, reference.spouse_id);

  return (
    <li>
      <div className={ROW}>
        <span className={ROW_ICON_SLOT} aria-hidden="true">
          <CornerLeftUp className="h-4 w-4 text-muted-foreground" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-words font-medium text-foreground">{reference.member_name}</span>
            <LevelBadge {...reference.level} className="text-xs" />
            <span className="break-words text-sm text-muted-foreground">
              {MINISTRIES_TEXTS.spouseAbove(reference.spouse_name)}
            </span>
          </span>
          {couple && (
            <Button
              type="button"
              variant="link"
              className="h-11 px-0 md:h-9"
              aria-label={
                couple.node.spouse_name
                  ? MINISTRIES_TEXTS.goToCoupleLabel(couple.node.member_name, couple.node.spouse_name)
                  : undefined
              }
              onClick={couple.reveal}
            >
              {MINISTRIES_TEXTS.goToCouple}
            </Button>
          )}
        </span>
      </div>
    </li>
  );
};

export default SpouseReferenceRow;
