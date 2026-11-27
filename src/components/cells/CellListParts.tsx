import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import LevelSuffix from "@/components/hierarchy/LevelSuffix";
import { cellDetailPath, type CellDetailLocationState } from "@/lib/cells/detail";
import { CELL_DETAIL_TEXTS } from "@/lib/cells/detail-texts";
import { cellG12, cellLeaderLevel, formatG12Label } from "@/lib/cells/labels";
import type { CellRow } from "@/lib/cells/fields";
import { CELLS_LIST_TEXTS } from "@/lib/hierarchy/texts";
import { CELLS_PAGE_TEXTS } from "@/lib/cells/texts";

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

/**
 * "Quarta · 20:00", com o "·" fora do leitor de tela, que ouve "Quarta, 20:00"
 * (E2.09, Acessibilidade). Sem dia válido, "—" no lugar do dia (RN-07).
 */
export const CellMeeting = ({ cell }: { cell: CellRow }) => (
  <span>
    {cell.meeting_day || CELLS_PAGE_TEXTS.missing}
    <span aria-hidden="true"> · </span>
    <span className="sr-only">, </span>
    {cell.meeting_time?.substring(0, 5) || CELLS_PAGE_TEXTS.missing}
  </span>
);

const FROM_LIST: CellDetailLocationState = { fromList: true };

/**
 * O link do item da lista para o detalhe (P81): o nome do líder com o nível,
 * com "Célula de " em `sr-only` ("Célula de André Souza, nível 144"). Leva
 * `state.fromList`, para o "Voltar para Células" usar o histórico (AQ-8), e o
 * atributo que a volta procura para devolver o foco (`useListReturnFocus`).
 * `stretched`: no cartão, o link cobre o cartão inteiro (`after:absolute`),
 * com o anel de foco nele; as ações ficam por cima (`relative z-10`).
 */
export const CellDetailLink = ({
  cell,
  stretched = false,
  className,
  onClick,
}: {
  cell: CellRow;
  stretched?: boolean;
  className: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) => (
  <Link
    to={cellDetailPath(cell.id)}
    state={FROM_LIST}
    // O atributo é o `CELL_LINK_ATTRIBUTE`, que a volta procura.
    data-cell-link={cell.id}
    onClick={onClick}
    className={
      stretched
        ? "rounded-sm outline-none after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background hover:underline"
        : "rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    }
  >
    <span className="sr-only">{CELL_DETAIL_TEXTS.listLinkPrefix}</span>
    <CellLeader cell={cell} className={className} />
  </Link>
);

/** Conteúdo por cima do link esticado do cartão (P81): as ações continuam clicáveis. */
export const AboveCardLink = ({ children }: { children: ReactNode }) => <div className="relative z-10">{children}</div>;
