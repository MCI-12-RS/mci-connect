import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { BlockedActionDialog } from "@/components/BlockedActionDialog";
import { DeletedListBody, DeletedListPage, RestoreButton } from "@/components/DeletedListLayout";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useDeletedCellsList } from "@/hooks/use-deleted-cells-list";
import { useOneTapRestore } from "@/hooks/use-one-tap-restore";
import { useRestoreCell } from "@/hooks/use-restore";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { CELL_ROLE_LABELS } from "@/lib/cells/roles";
import {
  cellDayTime,
  cellPeople,
  cellScheduleLine,
  deletionInfo,
  personName,
  withDeletedMark,
  type DeletedCellRow,
} from "@/lib/deletion/deleted-lists";
import { cellRestoreBlock, restoreBlockFromRefusal, restoreFixLabel, restoreFixPath } from "@/lib/deletion/restore";
import { CELL_RESTORE_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";

const TEXTS = DELETED_LIST_TEXTS.cells;

/** O timóteo e o anfitrião excluídos, com o papel: "Anfitrião: Quintino Reis (cadastro excluído)". */
function deletedHelpers(cell: DeletedCellRow): string[] {
  return cellPeople(cell)
    .filter((person) => person.role !== "leader" && person.deleted)
    .map((person) => DELETED_LIST_TEXTS.personLine(CELL_ROLE_LABELS[person.role], withDeletedMark(person.name, true)));
}

/** A lista em si: só é montada para quem tem `manage_roles` (UX-17). */
const CellsDeletedList = () => {
  const list = useListSearchParams();
  const query = useDeletedCellsList(list.params);
  useClampPage(list, query);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const restoreCell = useRestoreCell();

  // O foco volta ao "Restaurar" quando o bloqueio fecha, ou vai à busca se a célula saiu da lista.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, query.data);

  const leaderOf = (cell: DeletedCellRow) => personName(cell.leader_name);

  const restore = useOneTapRestore<DeletedCellRow>(
    {
      rowId: (cell) => cell.id,
      restore: (id) => restoreCell.mutateAsync(id),
      doneText: CELL_RESTORE_TEXTS.restored,
      refusedTitle: (cell) => CELL_RESTORE_TEXTS.refusedTitle(leaderOf(cell)),
      anticipatedBlock: cellRestoreBlock,
      blockFromRefusal: (_cell, refusal) => restoreBlockFromRefusal(refusal),
    },
    returnFocus,
  );

  const renderRestore = (cell: DeletedCellRow) => (
    <RestoreButton
      label={CELL_RESTORE_TEXTS.restoreLabel(leaderOf(cell))}
      restoring={restore.isRestoring(cell.id)}
      onRestore={(button) => restore.restore(cell, button)}
    />
  );

  const renderCard = (cell: DeletedCellRow) => {
    const info = deletionInfo(cell, TEXTS.deletedAt);
    return (
      <>
        <p className="font-semibold text-sm break-words">
          {TEXTS.itemTitle(withDeletedMark(leaderOf(cell), cell.leader_deleted === true))}
        </p>
        <p className="text-xs text-muted-foreground">{cellScheduleLine(cell)}</p>
        <div className="text-xs text-muted-foreground">
          <p>{info.deletedAt}</p>
          <p>{info.deletedBy}</p>
        </div>
        {deletedHelpers(cell).map((line) => (
          <p key={line} className="text-xs break-words">
            {line}
          </p>
        ))}
        <div className="flex justify-end">{renderRestore(cell)}</div>
      </>
    );
  };

  const renderRow = (cell: DeletedCellRow, className: string | undefined) => {
    const info = deletionInfo(cell, TEXTS.deletedAt);
    return (
      <TableRow key={cell.id} className={className}>
        <TableCell>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium break-words">
              {withDeletedMark(leaderOf(cell), cell.leader_deleted === true)}
            </span>
            {deletedHelpers(cell).map((line) => (
              <span key={line} className="text-xs text-muted-foreground break-words">
                {line}
              </span>
            ))}
          </div>
        </TableCell>
        <TableCell className="text-sm whitespace-nowrap">
          {cellDayTime(cell) || "—"}
        </TableCell>
        <TableCell className="text-sm">{cell.type || "—"}</TableCell>
        <TableCell className="text-sm">{cell.neighborhood || "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{info.deletedAtShort}</TableCell>
        <TableCell className="text-sm">{info.deletedByShort}</TableCell>
        <TableCell className="text-right">{renderRestore(cell)}</TableCell>
      </TableRow>
    );
  };

  const blocked = restore.blocked;
  const fix = blocked?.block.fix ?? null;

  return (
    <>
      <DeletedListBody
        texts={TEXTS}
        list={list}
        query={query}
        searchRef={searchRef}
        isMobile={isMobile}
        rowKey={(cell) => cell.id}
        renderCard={renderCard}
        tableHead={
          <>
            <TableHead>{TEXTS.columns.leader}</TableHead>
            <TableHead>{TEXTS.columns.schedule}</TableHead>
            <TableHead>{TEXTS.columns.type}</TableHead>
            <TableHead>{TEXTS.columns.neighborhood}</TableHead>
            <TableHead>{TEXTS.columns.deletedAt}</TableHead>
            <TableHead>{TEXTS.columns.deletedBy}</TableHead>
          </>
        }
        renderRow={renderRow}
      />
      {blocked && (
        <BlockedActionDialog
          open
          onOpenChange={(open) => {
            if (!open) restore.closeBlocked();
          }}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          title={blocked.title}
          action={fix ? { label: restoreFixLabel(fix), onClick: () => navigate(restoreFixPath(fix)) } : undefined}
        >
          <p>{blocked.block.message}</p>
        </BlockedActionDialog>
      )}
    </>
  );
};

/** Células excluídas (E2.01, T4 e T6): `/cells/deleted`, só para administradores. */
const CellsDeleted = () => (
  <DeletedListPage texts={TEXTS} listPath="/cells">
    <CellsDeletedList />
  </DeletedListPage>
);

export default CellsDeleted;
