import LevelSuffix from "@/components/hierarchy/LevelSuffix";
import { cellG12, cellLeaderLevel, formatG12Label } from "@/lib/cells/labels";
import type { CellRow } from "@/lib/cells/fields";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";

/** "André Souza (144)": o líder com o nível do P40, que quebra entre as palavras (E2.06, RN-11). */
export const CellLeader = ({ cell, className }: { cell: CellRow; className: string }) => (
  <span className={`${className} break-words`}>
    {cell.leader_name || "Sem líder"}
    {cell.leader_name && <LevelSuffix {...cellLeaderLevel(cell)} />}
  </span>
);

/** O G12 da célula (RN-11): o nome, "Pastores" ou "—", lido como "nenhum". */
export const CellG12 = ({ cell }: { cell: CellRow }) =>
  cellG12(cell).kind === "none" ? (
    <>
      <span aria-hidden="true">{CELLS_LIST_TEXTS.g12None}</span>
      <span className="sr-only">{CELLS_LIST_TEXTS.g12NoneSpoken}</span>
    </>
  ) : (
    <>{formatG12Label(cell)}</>
  );
