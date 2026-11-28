import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, FilePlus, Pencil, Trash2 } from "lucide-react";
import AppLayout from "@/components/AppLayout";
import CellForm from "@/components/CellForm";
import CellDeletionFlow from "@/components/CellDeletionFlow";
import CellReportDeletionFlow from "@/components/CellReportDeletionFlow";
import RowActionsMenu from "@/components/RowActionsMenu";
import { RecordAuthorship } from "@/components/RecordAuthorship";
import { CellReportDialog } from "@/components/cell-reports/CellReportDialog";
import { CellReportSheet } from "@/components/cell-reports/CellReportSheet";
import { findReportOpenButton } from "@/components/cell-reports/report-open";
import { CellDetailHeader } from "@/components/cells/detail/CellDetailHeader";
import { CellDetailFooter } from "@/components/cells/detail/CellDetailFooter";
import { CellReportStatusSection } from "@/components/cells/detail/CellReportStatusSection";
import { CellPeopleSection } from "@/components/cells/detail/CellPeopleSection";
import { CellAddressSection } from "@/components/cells/detail/CellAddressSection";
import { CellRecentReports } from "@/components/cells/detail/CellRecentReports";
import { CellEvolution } from "@/components/cells/detail/CellEvolution";
import { CellNotFound } from "@/components/cells/detail/CellNotFound";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useCell } from "@/hooks/use-cell";
import { useCellListPreview } from "@/hooks/use-cell-list-preview";
import { removeReportFromRecentCache, useCellRecentReports } from "@/hooks/use-cell-recent-reports";
import { cellReportDetailKey } from "@/hooks/use-cell-report";
import { useCellReportListPreview } from "@/hooks/use-cell-report-list-preview";
import { cellReportParticipantsKey } from "@/hooks/use-cell-report-participants";
import { useCellReportSheet } from "@/hooks/use-cell-report-sheet";
import { useReportEditEntry } from "@/hooks/use-report-edit-entry";
import { FROM_DETAIL_STATE, rememberOpenedCell } from "@/hooks/use-list-return-focus";
import { TABLE_MIN_WIDTH, useMinWidth } from "@/hooks/use-min-width";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { backLink, cameFromList, cellAuthorship, meetingParts, type CellRecentReport } from "@/lib/cells/detail";
import { CELL_DETAIL_TEXTS as TEXTS } from "@/lib/cells/detail-texts";
import type { CellDetailRow, CellListRow } from "@/lib/cells/fields";
import { toEvolutionPoints } from "@/lib/cells/evolution";
import { formatReportDate } from "@/lib/cell-reports/labels";
import { leaderLabel, toCellDeletionTarget, type CellDeletionTarget, type CellReportDeletionTarget } from "@/lib/deletion/targets";
import { CELL_DELETION_TEXTS } from "@/lib/deletion/texts";
import { isUuid } from "@/lib/ids";
import { refreshAfterCellWrite } from "@/lib/query-refresh";

/** O que a tela mostra (T13): carregando por link, a célula (inteira ou só a linha da lista), não encontrada ou erro. */
type View =
  | { kind: "loading" }
  | { kind: "not_found" }
  | { kind: "error"; preview: CellListRow | null }
  | { kind: "ready"; cell: CellListRow; detail: CellDetailRow | null };

/** A autoria enquanto a leitura do detalhe não chega (T13): 2 linhas de `Skeleton` e o `Separator`. */
const AuthorshipLoading = () => (
  <div className="space-y-4" aria-hidden="true" data-testid="authorship-loading">
    <div className="space-y-2">
      <Skeleton className="h-4 w-full max-w-sm" />
      <Skeleton className="h-4 w-2/3 max-w-xs" />
    </div>
    <Separator />
  </div>
);

/** As seções enquanto carrega por link (T13), cada uma no seu formato. */
const SectionsLoading = () => (
  <div className="space-y-6" aria-busy="true" data-testid="cell-detail-loading">
    {[TEXTS.sections.reportStatus, TEXTS.sections.people, TEXTS.sections.address].map((title) => (
      <div key={title} className="space-y-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-16 w-full" />
      </div>
    ))}
  </div>
);

/**
 * O detalhe da célula (E2.10, RN-14 a RN-20; T8 a T14; P80 a P83). Abre quem
 * vê a célula na `cells_view`; para os demais, "Célula não encontrada" (o id
 * sem formato nem consulta o servidor). Aberto pela lista, o topo aparece na
 * hora com a linha que a lista já tem (UXD-12).
 */
const CellDetail = () => {
  const { id = "" } = useParams();
  const valid = isUuid(id);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { access, hasPermission } = useAuth();
  const fromList = cameFromList(location.state);
  const back = backLink(access, fromList);
  const showReportsTable = useMinWidth(TABLE_MIN_WIDTH);

  const cellQuery = useCell(id, { enabled: valid });
  const reportsQuery = useCellRecentReports(id, { enabled: valid });
  const preview = useCellListPreview(id);

  // Depois de excluir, a tela volta para a lista sem passar por "Célula não encontrada" (T14).
  const [leaving, setLeaving] = useState(false);
  const lastCell = useRef<CellListRow | null>(null);

  let view: View;
  if (!valid) view = { kind: "not_found" };
  else if (cellQuery.data) view = { kind: "ready", cell: cellQuery.data, detail: cellQuery.data };
  else if (leaving && lastCell.current) view = { kind: "ready", cell: lastCell.current, detail: null };
  else if (cellQuery.data === null) view = { kind: "not_found" };
  else if (cellQuery.isError) view = { kind: "error", preview };
  else view = preview ? { kind: "ready", cell: preview, detail: null } : { kind: "loading" };
  if (view.kind === "ready") lastCell.current = view.cell;

  // A volta para a lista rola até esta célula (AQ-8): só quando ela foi encontrada.
  const found = !!cellQuery.data;
  useEffect(() => {
    if (found) rememberOpenedCell(id);
  }, [found, id]);

  // O foco vai para o `h1` ao abrir e quando a tela troca de estado sem foco (não encontrada, erro).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reportsHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusedOnce = useRef(false);
  useEffect(() => {
    const active = document.activeElement;
    if (focusedOnce.current && active !== null && active !== document.body) return;
    focusedOnce.current = true;
    headingRef.current?.focus({ preventScroll: true });
  }, [view.kind]);

  // Ao fechar um diálogo, o foco volta a quem o abriu; se ele saiu da tela, ao título da seção.
  const cellFocus = useReturnFocus(headingRef, cellQuery.data);
  const reportFocus = useReturnFocus(reportsHeadingRef, reportsQuery.data);

  const [editingCell, setEditingCell] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [deletingCell, setDeletingCell] = useState<CellDeletionTarget | null>(null);
  const [editingReport, setEditingReport] = useState<{ id: string; fromSheet: boolean } | null>(null);
  const [deletingReport, setDeletingReport] = useState<{ target: CellReportDeletionTarget; fromSheet: boolean } | null>(null);

  // A consulta "Ver relatório" sobre o detalhe (E2.12, T14): `?report=<id>` no endereço da célula.
  const sheet = useCellReportSheet({ cleanInvalid: true });
  const sheetPreview = useCellReportListPreview(sheet.reportId);
  const editEntry = useReportEditEntry();
  // Aberta pelo relatório, o foco volta ao botão dele; por link, ao título "Últimos relatórios".
  const sheetFromList = useRef(false);
  if (sheet.reportId) sheetFromList.current = sheet.fromList;

  const goBack = () => {
    if (back.kind === "history") navigate(-1);
    else navigate(back.to, { state: FROM_DETAIL_STATE });
  };

  // A ordem da exclusão pelo detalhe (Front, AQ-10): descarta a lista do cache, volta para ela e só
  // então recarrega. Assim a lista nunca mostra a célula excluída, nem por um instante.
  const afterCellDeleted = () => {
    setLeaving(true);
    queryClient.removeQueries({ queryKey: ["cells", "list"] });
    if (fromList) navigate(-1);
    else navigate("/cells", { state: FROM_DETAIL_STATE });
    void refreshAfterCellWrite(queryClient);
  };

  if (view.kind === "not_found") {
    return (
      <AppLayout>
        <CellNotFound ref={headingRef} back={back} onBack={goBack} />
      </AppLayout>
    );
  }

  if (view.kind === "loading" || view.kind === "error") {
    const title = view.kind === "error" && view.preview ? TEXTS.title(leaderLabel(view.preview.leader_name)) : TEXTS.titleLoading;
    return (
      <AppLayout>
        <div className="space-y-6">
          <CellDetailHeader
            ref={headingRef}
            back={back}
            onBack={goBack}
            title={title}
            meeting={null}
            isActive={null}
            loading={view.kind === "loading"}
          />
          {view.kind === "loading" ? (
            <SectionsLoading />
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" aria-hidden="true" />
              <AlertDescription className="space-y-3 text-foreground">
                <p>{TEXTS.loadFailed}</p>
                <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => void cellQuery.refetch()}>
                  {TEXTS.tryAgain}
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </AppLayout>
    );
  }

  const { cell, detail } = view;
  const leader = leaderLabel(cell.leader_name);
  // RN-16: as mesmas regras da linha da lista. "Novo relatório" pela regra do banco
  // (`cells_view.can_submit_report`, já falsa na célula inativa).
  const canSubmit = cell.can_submit_report === true && !leaving;
  const canEditCell = hasPermission("edit_cell") && !leaving;
  const canDeleteCell = hasPermission("delete_cell") && !leaving;
  const canEditReport = hasPermission("edit_cell_report");
  const canDeleteReport = hasPermission("delete_cell_report");
  const reports = reportsQuery.data;
  const busy = cellQuery.isRefetching || reportsQuery.isRefetching;

  const openLaunch = (opener: HTMLElement) => {
    cellFocus.setOpener(opener);
    setLaunching(true);
  };
  const openEdit = (opener: HTMLElement) => {
    cellFocus.setOpener(opener);
    setEditingCell(true);
  };
  const openDelete = (opener: HTMLElement | null) => {
    cellFocus.setOpener(opener);
    setDeletingCell(toCellDeletionTarget(cell));
  };
  const editReport = (report: CellRecentReport, opener: HTMLElement) => {
    reportFocus.setOpener(opener);
    setEditingReport({ id: report.id, fromSheet: false });
  };
  const deleteReport = (report: CellRecentReport, opener: HTMLElement | null) => {
    reportFocus.setOpener(opener);
    setDeletingReport({ target: { id: report.id, date: formatReportDate(report.date), leaderName: leader }, fromSheet: false });
  };
  // Pela consulta (T13): o formulário por cima, com a entrada no histórico (DA-11), e a exclusão do E2.01.
  const editReportFromSheet = (reportId: string, opener: HTMLElement) => {
    reportFocus.setOpener(opener);
    setEditingReport({ id: reportId, fromSheet: true });
    editEntry.start();
  };
  const deleteReportFromSheet = (target: CellReportDeletionTarget, opener: HTMLElement | null) => {
    reportFocus.setOpener(opener);
    setDeletingReport({ target, fromSheet: true });
  };
  const closeReportForm = () => {
    if (editingReport?.fromSheet) editEntry.closed();
    setEditingReport(null);
  };
  // Excluído pela consulta: fecha, tira o relatório dos últimos no cache e as leituras dele (como a DA-12).
  const afterReportDeletedFromSheet = (reportId: string) => {
    sheet.close();
    removeReportFromRecentCache(queryClient, cell.id, reportId);
    queryClient.removeQueries({ queryKey: cellReportDetailKey(reportId) });
    queryClient.removeQueries({ queryKey: cellReportParticipantsKey(reportId) });
  };
  const onSheetCloseAutoFocus = (event: Event, reportId: string | null) => {
    event.preventDefault();
    const opener = sheetFromList.current ? findReportOpenButton(reportId) : null;
    if (opener) opener.focus();
    else reportsHeadingRef.current?.focus();
  };

  const newReportButton = (className: string) => (
    <Button className={className} onClick={(e) => openLaunch(e.currentTarget)}>
      <FilePlus className="h-4 w-4" aria-hidden="true" />
      {TEXTS.actions.newReport}
    </Button>
  );
  const editCellButton = (
    <Button variant="outline" className="h-11 md:h-10" onClick={(e) => openEdit(e.currentTarget)}>
      <Pencil className="h-4 w-4" aria-hidden="true" />
      {TEXTS.actions.editCell}
    </Button>
  );

  const desktopActions = (canSubmit || canEditCell || canDeleteCell) && (
    <>
      {canSubmit && newReportButton("h-10")}
      {canEditCell && editCellButton}
      {canDeleteCell && (
        <Button variant="outline" className="h-10" onClick={(e) => openDelete(e.currentTarget)}>
          <Trash2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {TEXTS.actions.deleteCell}
        </Button>
      )}
    </>
  );
  const mobileActions = (canEditCell || canDeleteCell) && (
    <>
      {canEditCell && editCellButton}
      <RowActionsMenu
        label={CELL_DELETION_TEXTS.actionsLabel(leader)}
        actions={canDeleteCell ? [{ label: TEXTS.actions.deleteCell, icon: Trash2, onSelect: openDelete }] : []}
      />
    </>
  );

  const evolutionPoints = toEvolutionPoints(reports ?? []);

  return (
    <AppLayout>
      <div className={`space-y-6 ${canSubmit ? "pb-24 md:pb-0" : ""}`}>
        <CellDetailHeader
          ref={headingRef}
          back={back}
          onBack={goBack}
          title={TEXTS.title(leader)}
          meeting={meetingParts(cell)}
          isActive={cell.is_active === true}
          desktopActions={desktopActions}
          mobileActions={mobileActions}
        />

        {detail ? (
          <RecordAuthorship entity="cell" recordId={cell.id} recordName={leader} authorship={cellAuthorship(detail)} />
        ) : (
          <AuthorshipLoading />
        )}

        <div
          className={`space-y-6 md:grid md:grid-cols-2 md:gap-6 md:space-y-0 xl:grid-cols-3 ${busy ? "opacity-60" : ""}`}
          aria-busy={busy}
        >
          {/* No celular, a primeira seção fica logo abaixo do `Separator` da autoria, sem outra borda. */}
          <CellReportStatusSection cell={cell} className="max-md:border-t-0 max-md:pt-0" />
          <CellPeopleSection cell={cell} />
          <CellAddressSection cell={cell} />
          <CellRecentReports
            ref={reportsHeadingRef}
            reports={reports}
            isPending={reportsQuery.isPending}
            isError={reportsQuery.isError}
            onRetry={() => void reportsQuery.refetch()}
            cellId={cell.id}
            leaderName={leader}
            showTable={showReportsTable}
            canEdit={canEditReport}
            canDelete={canDeleteReport}
            onEdit={editReport}
            onDelete={deleteReport}
            onOpen={(report) => sheet.open(report.id)}
          />
          {evolutionPoints.length > 0 && <CellEvolution points={evolutionPoints} />}
        </div>
      </div>

      {canSubmit && <CellDetailFooter>{newReportButton("h-11 w-full")}</CellDetailFooter>}

      {editingCell && (
        <CellForm cell={detail ?? cell} onClose={() => setEditingCell(false)} onCloseAutoFocus={cellFocus.onCloseAutoFocus} />
      )}
      {launching && (
        <CellReportDialog mode="launch" cell={cell} onClose={() => setLaunching(false)} onCloseAutoFocus={cellFocus.onCloseAutoFocus} />
      )}
      {deletingCell && (
        <CellDeletionFlow
          key={deletingCell.id}
          cell={deletingCell}
          onClose={() => setDeletingCell(null)}
          onCloseAutoFocus={cellFocus.onCloseAutoFocus}
          onDeleted={afterCellDeleted}
        />
      )}
      {/* A consulta fica ao lado dos formulários, e não dentro deles (T13, T14); sem "Ver célula". */}
      <CellReportSheet
        reportId={sheet.reportId}
        preview={sheetPreview}
        context="cell"
        onClose={sheet.close}
        onCloseAutoFocus={onSheetCloseAutoFocus}
        onEdit={editReportFromSheet}
        onDelete={deleteReportFromSheet}
      />
      {editingReport && (
        <CellReportDialog
          mode="edit"
          reportId={editingReport.id}
          onClose={closeReportForm}
          onCloseAutoFocus={reportFocus.onCloseAutoFocus}
          {...(editingReport.fromSheet ? { closeRequest: editEntry.closeRequest, onCloseRequestDeclined: editEntry.declined } : {})}
        />
      )}
      {deletingReport && (
        <CellReportDeletionFlow
          key={deletingReport.target.id}
          report={deletingReport.target}
          onClose={() => setDeletingReport(null)}
          onDeleted={deletingReport.fromSheet ? () => afterReportDeletedFromSheet(deletingReport.target.id) : undefined}
          onCloseAutoFocus={(event) => {
            // Excluído pela consulta, o foco vai para "Últimos relatórios"; recusado, volta à consulta.
            if (!deletingReport.fromSheet || sheet.reportId === deletingReport.target.id) {
              reportFocus.onCloseAutoFocus(event);
              return;
            }
            event.preventDefault();
            requestAnimationFrame(() => reportsHeadingRef.current?.focus());
          }}
        />
      )}
    </AppLayout>
  );
};

export default CellDetail;
