import { useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { BlockedActionDialog } from "@/components/BlockedActionDialog";
import { ActionsCell } from "@/components/ActionsColumn";
import { DeletedListBody, DeletedListPage, RestoreButton } from "@/components/DeletedListLayout";
import { CellDeletedBadge, HeldStatusBadge } from "@/components/StatusBadges";
import { TableCell, TableHead, TableRow } from "@/components/ui/table";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useDeletedCellReportsList } from "@/hooks/use-deleted-cell-reports-list";
import { useOneTapRestore } from "@/hooks/use-one-tap-restore";
import { useRestoreCellReport } from "@/hooks/use-restore";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { formatMeetingTime } from "@/lib/cells/labels";
import {
  deletionInfo,
  personName,
  reportDateLabel,
  reportTitleLine,
  type DeletedCellReportRow,
} from "@/lib/deletion/deleted-lists";
import {
  cellReportRestoreBlock,
  restoreBlockFromRefusal,
  restoreFixLabel,
  restoreFixPath,
} from "@/lib/deletion/restore";
import { CELL_REPORT_RESTORE_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";

const TEXTS = DELETED_LIST_TEXTS.cellReports;

/** "Já há outro relatório desta célula na mesma semana." (aviso antecipado, AQ-3): texto, nunca só a cor. */
const WeekTakenNotice = () => (
  <p className="flex items-start gap-1.5 text-xs text-foreground">
    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    <span>{DELETED_LIST_TEXTS.weekTaken}</span>
  </p>
);

/** A lista em si: só é montada para quem tem `manage_roles` (UX-17). */
const CellReportsDeletedList = () => {
  const list = useListSearchParams();
  const query = useDeletedCellReportsList(list.params);
  useClampPage(list, query);
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const restoreReport = useRestoreCellReport();

  // O foco volta ao "Restaurar" quando o bloqueio fecha, ou vai à busca se o relatório saiu da lista.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, query.data);

  const leaderOf = (report: DeletedCellReportRow) => personName(report.cell_leader_name);

  const restore = useOneTapRestore<DeletedCellReportRow>(
    {
      rowId: (report) => report.id,
      restore: (id) => restoreReport.mutateAsync(id),
      doneText: CELL_REPORT_RESTORE_TEXTS.restored,
      refusedTitle: (report) => CELL_REPORT_RESTORE_TEXTS.refusedTitle(reportDateLabel(report), leaderOf(report)),
      anticipatedBlock: cellReportRestoreBlock,
      blockFromRefusal: (report, refusal) => restoreBlockFromRefusal(refusal, report.cell_leader_name),
    },
    returnFocus,
  );

  const renderRestore = (report: DeletedCellReportRow) => (
    <RestoreButton
      label={CELL_REPORT_RESTORE_TEXTS.restoreLabel(reportDateLabel(report), leaderOf(report))}
      restoringLabel={CELL_REPORT_RESTORE_TEXTS.restoringLabel(reportDateLabel(report), leaderOf(report))}
      restoring={restore.isRestoring(report.id)}
      onRestore={(button) => restore.restore(report, button)}
    />
  );

  const renderCard = (report: DeletedCellReportRow) => {
    const info = deletionInfo(report, TEXTS.deletedAt);
    return (
      <>
        <p className="font-semibold text-sm break-words">
          {DELETED_LIST_TEXTS.cells.itemTitle(leaderOf(report))}
        </p>
        {report.cell_deleted === true && <CellDeletedBadge />}
        <p className="text-xs text-muted-foreground">{reportTitleLine(report)}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <HeldStatusBadge held={report.was_held === true} />
          {report.theme && <span className="break-words">{DELETED_LIST_TEXTS.themeLine(report.theme)}</span>}
        </div>
        <div className="text-xs text-muted-foreground">
          <p>{info.deletedAt}</p>
          <p>{info.deletedBy}</p>
        </div>
        {report.week_taken === true && <WeekTakenNotice />}
        <div className="flex justify-end">{renderRestore(report)}</div>
      </>
    );
  };

  const renderRow = (report: DeletedCellReportRow, className: string | undefined) => {
    const info = deletionInfo(report, TEXTS.deletedAt);
    return (
      <TableRow key={report.id} className={className}>
        <TableCell>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium break-words">{leaderOf(report)}</span>
            {report.cell_deleted === true && <CellDeletedBadge />}
            {report.week_taken === true && <WeekTakenNotice />}
          </div>
        </TableCell>
        <TableCell className="text-sm">
          <div className="flex flex-col">
            <span>{reportDateLabel(report)}</span>
            <span className="text-xs text-muted-foreground">{formatMeetingTime(report.time) || "—"}</span>
          </div>
        </TableCell>
        <TableCell>
          <HeldStatusBadge held={report.was_held === true} />
        </TableCell>
        <TableCell className="text-sm break-words">{report.theme || "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{info.deletedAtShort}</TableCell>
        <TableCell className="text-sm">{info.deletedByShort}</TableCell>
        <ActionsCell>{renderRestore(report)}</ActionsCell>
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
        rowKey={(report) => report.id}
        renderCard={renderCard}
        tableHead={
          <>
            <TableHead>{TEXTS.columns.cell}</TableHead>
            <TableHead>{TEXTS.columns.dateTime}</TableHead>
            <TableHead>{TEXTS.columns.status}</TableHead>
            <TableHead>{TEXTS.columns.theme}</TableHead>
            <TableHead className="whitespace-nowrap">{TEXTS.columns.deletedAt}</TableHead>
            <TableHead className="whitespace-nowrap">{TEXTS.columns.deletedBy}</TableHead>
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

/** Relatórios excluídos (E2.01, T4 e T6): `/cell-reports/deleted`, só para administradores. */
const CellReportsDeleted = () => (
  <DeletedListPage texts={TEXTS} listPath="/cell-reports">
    <CellReportsDeletedList />
  </DeletedListPage>
);

export default CellReportsDeleted;
