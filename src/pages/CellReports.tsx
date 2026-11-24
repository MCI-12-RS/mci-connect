import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import AppLayout from "@/components/AppLayout";
import CellReportForm from "@/components/CellReportForm";
import CellReportDeletionFlow from "@/components/CellReportDeletionFlow";
import CellReportSheet from "@/components/CellReportSheet";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import { CellDeletedBadge, HeldStatusBadge } from "@/components/StatusBadges";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, ClipboardList, Eye, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellReportsList } from "@/hooks/use-cell-reports-list";
import { useCellReport } from "@/hooks/use-cell-report";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useSearchParam } from "@/hooks/use-search-param";
import { formatStreetLine } from "@/lib/cells/labels";
import { cellOfReport, type CellReportRow } from "@/lib/cell-reports/fields";
import { formatReportDate } from "@/lib/cell-reports/labels";
import { REPORT_PARAM, reportSheetState } from "@/lib/cell-reports/report-sheet";
import { toCellReportDeletionTarget, type CellReportDeletionTarget } from "@/lib/deletion/targets";
import { CELL_REPORT_DELETION_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";

const CellReports = () => {
  const list = useListSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<CellReportRow | null>(null);
  const [deletingReport, setDeletingReport] = useState<CellReportDeletionTarget | null>(null);
  const { hasPermission, permissionsLoaded } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, isPlaceholderData } = useCellReportsList(list.params);
  const reports = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  // Ao fechar um diálogo, o foco volta a quem o abriu ou, se o relatório saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);

  const handleEdit = (report: CellReportRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setEditingReport(report);
    setFormOpen(true);
  };
  const handleClose = () => { setFormOpen(false); setEditingReport(null); };

  const canEditReport = hasPermission("edit_cell_report");
  // "Ver relatório" fica no lugar do "Editar", para quem edita relatórios (P-DEL-19).
  const canViewReport = canEditReport;
  const canDeleteReport = hasPermission("delete_cell_report");
  const canSubmitNewReport =
    hasPermission("edit_cell") || hasPermission("submit_own_cell_report") || hasPermission("submit_any_visible_report") || hasPermission("edit_own_data");
  const showActions = canEditReport || canDeleteReport;
  const columnCount = showActions ? 6 : 5;

  const attendance = (r: CellReportRow) => r.participants_count + r.visitors_count;

  // O relatório de célula excluída não é editado (RN-11): sem "Editar"; "Excluir relatório" continua.
  const canEditRow = (r: CellReportRow) => canEditReport && r.cell_deleted !== true;
  // Em vez dele, a consulta "Ver relatório" (T7). As demais linhas não mudam (PO-UX-3).
  const canViewRow = (r: CellReportRow) => canViewReport && r.cell_deleted === true;

  // A consulta abre por `?report=<id>`, que fica na URL ao recarregar (UX-27). O
  // parâmetro só vale para relatório de célula excluída e para quem pode
  // consultar; nos demais casos, sai da URL.
  const [reportParam, setReportParam] = useSearchParam(REPORT_PARAM);
  // O painel lê o relatório junto com a página (a mesma consulta, uma vez só) e
  // só aparece quando a página decide.
  const reportToRead = permissionsLoaded && canViewReport ? reportParam : null;
  const reportQuery = useCellReport(reportToRead);
  const sheetState = reportSheetState({
    reportId: reportParam,
    permissionsLoaded,
    canView: canViewReport,
    detail: reportQuery.data,
    knownCellDeleted: reports.some((r) => r.id === reportParam && r.cell_deleted === true),
    failed: reportQuery.isError,
  });
  useEffect(() => {
    if (sheetState === "dismiss") setReportParam(null);
  }, [sheetState, setReportParam]);
  // O relatório sumiu (excluído no meio tempo): a lista recarrega sem ele.
  const reportMissing = reportQuery.data === null;
  useEffect(() => {
    if (reportMissing) void queryClient.invalidateQueries({ queryKey: ["cell_reports", "list"] });
  }, [reportMissing, queryClient]);

  const openReport = (r: CellReportRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setReportParam(r.id);
  };

  const startDeletion = (r: CellReportRow, opener: HTMLElement | null) => {
    returnFocus.setOpener(opener);
    setDeletingReport(toCellReportDeletionTarget(r));
  };

  /** A data e o líder nos rótulos da linha: muitas células se reúnem no mesmo dia. */
  const rowLabel = (r: CellReportRow) => {
    const { date, leaderName } = toCellReportDeletionTarget(r);
    return [date, leaderName] as const;
  };

  // Funções que devolvem JSX, e não componentes: um componente declarado aqui
  // dentro seria recriado a cada render, e o botão que abriu o diálogo perderia o foco.

  const renderEditButton = (r: CellReportRow, buttonClass: string) =>
    canEditRow(r) && (
      <Button
        variant="ghost"
        size="icon"
        className={buttonClass}
        onClick={(e) => handleEdit(r, e.currentTarget)}
        aria-label={CELL_REPORT_DELETION_TEXTS.editLabel(...rowLabel(r))}
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
      </Button>
    );

  const renderDesktopActions = (r: CellReportRow) => (
    <div className="flex items-center gap-1">
      {renderEditButton(r, "h-8 w-8")}
      {canViewRow(r) && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={CELL_REPORT_DELETION_TEXTS.viewReportLabel(...rowLabel(r))}
          onClick={(e) => openReport(r, e.currentTarget)}
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      )}
      {canDeleteReport && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={CELL_REPORT_DELETION_TEXTS.deleteLabel(...rowLabel(r))}
          onClick={(e) => startDeletion(r, e.currentTarget)}
        >
          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      )}
    </div>
  );

  /** No celular, "Excluir relatório" fica no menu "⋯" do card (T1, P8). */
  const rowActions = (r: CellReportRow): RowAction[] =>
    canDeleteReport
      ? [{ label: CELL_REPORT_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => startDeletion(r, trigger) }]
      : [];

  const renderMobileActions = (r: CellReportRow) => (
    <div className="flex items-center gap-2 shrink-0">
      {renderEditButton(r, "h-11 w-11")}
      <RowActionsMenu label={CELL_REPORT_DELETION_TEXTS.actionsLabel(...rowLabel(r))} actions={rowActions(r)} />
    </div>
  );

  /** "Célula excluída" (T7, P6): ícone e texto, nunca só a cor (UX-25). */
  const cellDeletedBadge = <CellDeletedBadge />;

  const renderHeldBadge = (r: CellReportRow) => <HeldStatusBadge held={r.was_held === true} reason={r.reason_not_held} />;

  // "Excluídos": só para quem restaura (E2.01, UX-13). No celular, na linha do título.
  const deletedButton = hasPermission("manage_roles") && (
    <DeletedListButton
      to="/cell-reports/deleted"
      text={DELETED_LIST_TEXTS.cellReports.button}
      label={DELETED_LIST_TEXTS.cellReports.buttonLabel}
      isMobile={isMobile}
    />
  );

  // As partes do card do celular, só com `span`: no card de célula excluída,
  // elas ficam dentro do botão "Ver relatório" (T7), que não aceita `div` nem `p`.

  const renderCardSummary = (r: CellReportRow) => {
    const streetLine = formatStreetLine(cellOfReport(r));
    return (
      <>
        <span className="block font-semibold text-sm">{r.cell_leader_name || "Célula sem líder"}</span>
        {r.cell_deleted === true && <span className="mt-1 block">{cellDeletedBadge}</span>}
        {(streetLine || r.cell_neighborhood) && (
          <span className="block text-xs text-muted-foreground mt-0.5 leading-tight">
            {streetLine && <span className="block">{streetLine}</span>}
            {r.cell_neighborhood && <span className="block">{r.cell_neighborhood}</span>}
          </span>
        )}
        <span className="block text-xs text-muted-foreground mt-0.5">
          {formatReportDate(r.date)} · {r.time?.substring(0, 5) || "—"}
        </span>
      </>
    );
  };

  /** Situação e presenças. */
  const renderCardStatus = (r: CellReportRow) => (
    <span className="flex items-center justify-between">
      {renderHeldBadge(r)}
      {r.was_held && (
        <span className="text-sm font-medium text-foreground">
          {attendance(r)} <span className="text-xs font-normal text-muted-foreground">presenças</span>
        </span>
      )}
    </span>
  );

  const renderCardTheme = (r: CellReportRow) =>
    r.theme && (
      <span className="block text-xs text-muted-foreground">
        Tema: <span className="text-foreground">{r.theme}</span>
      </span>
    );

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;
    if (isError) return <p className="text-center py-8 text-destructive">Erro ao carregar os relatórios</p>;
    if (reports.length === 0) return <p className="text-center py-8 text-muted-foreground">Nenhum relatório encontrado</p>;

    return (
      <div className={`divide-y divide-border ${isPlaceholderData ? "opacity-60" : ""}`}>
        {reports.map((r) =>
          canViewRow(r) ? (
            // O corpo do card abre a consulta (T7); o "⋯" fica ao lado, nunca dentro dele.
            <div key={r.id} className="flex items-start gap-2 px-4 py-4">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={CELL_REPORT_DELETION_TEXTS.viewReportLabel(...rowLabel(r))}
                onClick={(e) => openReport(r, e.currentTarget)}
              >
                <span className="min-w-0 flex-1 space-y-3">
                  <span className="block">{renderCardSummary(r)}</span>
                  {renderCardStatus(r)}
                  {renderCardTheme(r)}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
              {rowActions(r).length > 0 && renderMobileActions(r)}
            </div>
          ) : (
            <div key={r.id} className="px-4 py-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 flex-1">{renderCardSummary(r)}</div>
                {showActions && renderMobileActions(r)}
              </div>
              {renderCardStatus(r)}
              {renderCardTheme(r)}
            </div>
          ),
        )}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <ClipboardList className="w-7 h-7 md:w-8 md:h-8 text-primary shrink-0" />
                Relatórios de Células
              </h1>
              <p className="text-muted-foreground text-sm">Gerenciar relatórios de encontros das células</p>
            </div>
            {isMobile && deletedButton}
          </div>
          {(canSubmitNewReport || (!isMobile && deletedButton)) && (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isMobile && deletedButton}
              {canSubmitNewReport && (
                <Button
                  onClick={(e) => {
                    returnFocus.setOpener(e.currentTarget);
                    setFormOpen(true);
                  }}
                  className="w-full sm:w-auto"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Novo Relatório
                </Button>
              )}
            </div>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Buscar por líder ou tema..."
                aria-label="Buscar relatórios"
                value={list.searchInput}
                onChange={(e) => list.setSearchInput(e.target.value)}
                maxLength={100}
                className="pl-10"
              />
            </div>
          </CardHeader>

          {isMobile ? (
            renderMobileCards()
          ) : (
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Célula (Líder)</TableHead>
                    <TableHead>Data / Hora</TableHead>
                    <TableHead>Tema</TableHead>
                    <TableHead className="text-center">Presenças</TableHead>
                    <TableHead>Status</TableHead>
                    {showActions && <ActionsHead>Ações</ActionsHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : isError ? (
                    <TableRow><TableCell colSpan={columnCount} className="text-center py-8 text-destructive">Erro ao carregar os relatórios</TableCell></TableRow>
                  ) : reports.length === 0 ? (
                    <TableRow><TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">Nenhum relatório encontrado</TableCell></TableRow>
                  ) : (
                    reports.map((r) => {
                      const streetLine = formatStreetLine(cellOfReport(r));
                      return (
                        <TableRow key={r.id} className={isPlaceholderData ? "opacity-60" : undefined}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col leading-tight">
                              <span>{r.cell_leader_name || "Célula sem líder"}</span>
                              {r.cell_deleted === true && <div className="my-1">{cellDeletedBadge}</div>}
                              {streetLine && <span className="text-xs font-normal text-muted-foreground">{streetLine}</span>}
                              {r.cell_neighborhood && (
                                <span className="text-xs font-normal text-muted-foreground">{r.cell_neighborhood}</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-col">
                              <span>{formatReportDate(r.date)}</span>
                              <span className="text-xs text-muted-foreground">{r.time?.substring(0, 5) || "—"}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="truncate max-w-[200px] block" title={r.theme ?? undefined}>{r.theme || "—"}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            {r.was_held ? (
                              <div className="flex flex-col items-center justify-center text-xs">
                                <span className="font-medium text-sm">{attendance(r)}</span>
                                <span className="text-muted-foreground text-[10px]">Total</span>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </TableCell>
                          <TableCell>{renderHeldBadge(r)}</TableCell>
                          {showActions && <ActionsCell>{renderDesktopActions(r)}</ActionsCell>}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          )}

          {!isLoading && !isError && (
            <ListPagination
              page={list.params.page}
              pageSize={list.params.pageSize}
              total={total}
              itemLabel={["relatório", "relatórios"]}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </Card>

        <Dialog open={formOpen} onOpenChange={handleClose}>
          <DialogContent
            className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full"
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <DialogHeader>
              <DialogTitle>{editingReport ? "Editar Relatório" : "Novo Relatório de Célula"}</DialogTitle>
            </DialogHeader>
            <CellReportForm report={editingReport} onClose={handleClose} />
          </DialogContent>
        </Dialog>

        <CellReportSheet
          reportId={reportToRead}
          open={sheetState === "open"}
          onClose={() => setReportParam(null)}
          onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          canSeeDeletedCells={hasPermission("manage_roles")}
        />

        {deletingReport && (
          <CellReportDeletionFlow
            key={deletingReport.id}
            report={deletingReport}
            onClose={() => setDeletingReport(null)}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default CellReports;
