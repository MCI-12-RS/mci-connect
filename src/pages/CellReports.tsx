import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import AppLayout from "@/components/AppLayout";
import { CellReportDialog } from "@/components/cell-reports/CellReportDialog";
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
import { Plus, Search, Pencil, Trash2, ClipboardList, Eye, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellReportsList } from "@/hooks/use-cell-reports-list";
import { useCellIdentity } from "@/hooks/use-cell-identity";
import { useCellReportFilter } from "@/hooks/use-cell-report-filter";
import { RecordFilterChip } from "@/components/filters/RecordFilterChip";
import { cellChipState } from "@/lib/cell-reports/cell-filter";
import { useCellReport } from "@/hooks/use-cell-report";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { useSearchParam } from "@/hooks/use-search-param";
import { formatStreetLine } from "@/lib/cells/labels";
import { cellOfReport, type CellReportRow } from "@/lib/cell-reports/fields";
import { formatReportDate } from "@/lib/cell-reports/labels";
import { reportLeaderLines } from "@/lib/cell-reports/snapshot";
import { CELL_BLOCK_TEXTS, CELL_REPORT_FILTER_TEXTS, REPORT_LIST_TEXTS } from "@/lib/cell-reports/texts";
import { REPORT_PARAM, reportIdToRead, reportSheetState } from "@/lib/cell-reports/report-sheet";
import { toCellReportDeletionTarget, type CellReportDeletionTarget } from "@/lib/deletion/targets";
import { CELL_REPORT_DELETION_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";
import { listSubtitle } from "@/lib/access/access";
import { Skeleton } from "@/components/ui/skeleton";

/** O "Ver relatório" (card ou ícone) da linha do relatório, se ela está na página. */
function findViewReportButton(reportId: string): HTMLElement | null {
  const buttons = document.querySelectorAll<HTMLElement>("[data-report-id]");
  return Array.from(buttons).find((button) => button.dataset.reportId === reportId) ?? null;
}

const CellReports = () => {
  const list = useListSearchParams();
  // O formulário de relatório (E2.11, T1): lançamento com a célula livre, ou a edição pelo id.
  const [reportDialog, setReportDialog] = useState<{ mode: "launch" } | { mode: "edit"; reportId: string } | null>(null);
  const [deletingReport, setDeletingReport] = useState<CellReportDeletionTarget | null>(null);
  const { hasPermission, permissionsLoaded, access } = useAuth();
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  // O filtro Célula (E2.10, RN-19, T15): `?cell=<id>`, com o chip da `cell_identity`.
  const cellFilter = useCellReportFilter();
  const cellIdentity = useCellIdentity(cellFilter.cellId);
  const { data, isLoading, isError, isPlaceholderData } = useCellReportsList(list.params, cellFilter.cellId);
  const reports = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  // Ao fechar um diálogo, o foco volta a quem o abriu ou, se o relatório saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);

  const hasSearch = list.searchInput.trim() !== "" || list.params.search !== "";
  const hasFilters = cellFilter.cellId !== null || hasSearch;
  const focusSearch = () => requestAnimationFrame(() => searchRef.current?.focus());
  // O chip tira só a célula; "Limpar filtros" tira a célula, a busca e a página (o foco vai para a busca).
  const removeCellFilter = () => {
    cellFilter.removeCell();
    focusSearch();
  };
  const clearFilters = () => {
    cellFilter.clearAll();
    list.setSearchInput("");
    focusSearch();
  };

  const handleEdit = (report: CellReportRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setReportDialog({ mode: "edit", reportId: report.id });
  };
  const handleClose = () => setReportDialog(null);

  const canEditReport = hasPermission("edit_cell_report");
  // "Ver relatório" fica no lugar do "Editar", para quem edita relatórios (P-DEL-19).
  const canViewReport = canEditReport;
  const canDeleteReport = hasPermission("delete_cell_report");
  // Só para quem pode lançar o relatório de pelo menos uma célula (RN-13, UX-25).
  const canSubmitNewReport = access?.can_submit_some_report === true;
  // Enquanto o acesso carrega, o lugar do botão fica reservado, para a lista não pular (Estados).
  const submitButtonPending = !permissionsLoaded;
  const subtitle = listSubtitle(access, "cellReports");
  const showActions = canEditReport || canDeleteReport;
  const columnCount = showActions ? 6 : 5;

  const attendance = (r: CellReportRow) => r.participants_count + r.visitors_count;

  // O relatório de célula excluída não é editado (RN-11): sem "Editar"; "Excluir relatório" continua.
  const canEditRow = (r: CellReportRow) => canEditReport && r.cell_deleted !== true;
  // Em vez dele, a consulta "Ver relatório" (T7). As demais linhas não mudam (PO-UX-3).
  const canViewRow = (r: CellReportRow) => canViewReport && r.cell_deleted === true;

  // A consulta abre por `?report=<id>`, que fica na URL ao recarregar (UX-27). O
  // parâmetro só vale para relatório de célula excluída, para quem pode
  // consultar e com um id bem formado; nos demais casos, sai da URL.
  const [reportParam, setReportParam] = useSearchParam(REPORT_PARAM);
  // O painel lê o relatório junto com a página (a mesma consulta, uma vez só) e
  // só aparece quando a página decide.
  const reportToRead = reportIdToRead({ reportId: reportParam, permissionsLoaded, canView: canViewReport });
  const reportQuery = useCellReport(reportToRead);
  // O relatório para o qual o painel está aberto: ao ler de novo ("Tentar de
  // novo"), a consulta volta a carregar sem o erro, e num link direto nada
  // mais manteria o painel aberto (QA-E201-PR4-1).
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const sheetState = reportSheetState({
    reportId: reportParam,
    permissionsLoaded,
    canView: canViewReport,
    detail: reportQuery.data,
    knownCellDeleted: reports.some((r) => r.id === reportParam && r.cell_deleted === true),
    failed: reportQuery.isError,
    alreadyOpen: reportParam !== null && reportParam === openReportId,
  });
  const nextOpenReportId = sheetState === "open" ? reportParam : null;
  if (nextOpenReportId !== openReportId) setOpenReportId(nextOpenReportId);
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

  // Ao fechar o painel, o foco volta ao "Ver relatório" da linha, se ela está
  // na página: ninguém o abriu (link direto, recarregar), ou quem abriu trocou
  // (o ícone vira card ao estreitar a tela). Senão, vai para a busca.
  const onSheetCloseAutoFocus = (event: Event, reportId: string | null) => {
    const viewButton = reportId ? findViewReportButton(reportId) : null;
    if (viewButton) returnFocus.setOpener(viewButton);
    returnFocus.onCloseAutoFocus(event);
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
          data-report-id={r.id}
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

  /** O líder registrado no relatório e o G12 atual dele embaixo (E2.11, RN-14 d, T10). */
  const renderLeader = (r: CellReportRow, className: string) => {
    const { leader, g12, g12None } = reportLeaderLines(r);
    return (
      <>
        <span className={className || "block"}>{leader || REPORT_LIST_TEXTS.noLeader}</span>
        <span className="block text-xs font-normal text-muted-foreground">
          {g12None ? (
            <>
              {REPORT_LIST_TEXTS.g12("")}
              <span aria-hidden="true">{g12}</span>
              <span className="sr-only">{CELL_BLOCK_TEXTS.noneSr}</span>
            </>
          ) : (
            REPORT_LIST_TEXTS.g12(g12)
          )}
        </span>
      </>
    );
  };

  const renderCardSummary = (r: CellReportRow) => {
    const streetLine = formatStreetLine(cellOfReport(r));
    return (
      <>
        {renderLeader(r, "block font-semibold text-sm")}
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

  /** Situação e presenças. Em tela estreita ou com fonte grande, as presenças descem inteiras para a linha de baixo. */
  const renderCardStatus = (r: CellReportRow) => (
    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {renderHeldBadge(r)}
      {r.was_held && (
        <span className="whitespace-nowrap text-sm font-medium text-foreground">
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

  /** Card de célula excluída, para quem consulta: o corpo é o botão "Ver relatório" (T7). */
  const renderViewCard = (r: CellReportRow) => {
    // O `aria-label` vira o nome do botão e esconde o conteúdo do leitor de
    // tela: o conteúdo do card entra como descrição (UX-25, WCAG 1.3.1).
    const summaryId = `report-card-${r.id}`;
    return (
      // O "⋯" fica ao lado do botão, nunca dentro dele.
      <div key={r.id} className="flex items-start gap-2 px-4 py-4">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={CELL_REPORT_DELETION_TEXTS.viewReportLabel(...rowLabel(r))}
          aria-describedby={summaryId}
          data-report-id={r.id}
          onClick={(e) => openReport(r, e.currentTarget)}
        >
          <span id={summaryId} className="min-w-0 flex-1 space-y-3">
            <span className="block">{renderCardSummary(r)}</span>
            {renderCardStatus(r)}
            {renderCardTheme(r)}
          </span>
          <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
        {rowActions(r).length > 0 && renderMobileActions(r)}
      </div>
    );
  };

  const renderPlainCard = (r: CellReportRow) => (
    <div key={r.id} className="px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">{renderCardSummary(r)}</div>
        {showActions && renderMobileActions(r)}
      </div>
      {renderCardStatus(r)}
      {renderCardTheme(r)}
    </div>
  );

  /** Sem resultado: com o filtro Célula ou a busca, o vazio com filtros e "Limpar filtros" (T15). */
  const renderEmpty = () =>
    hasFilters ? (
      <div className="space-y-3 p-6 text-center text-sm">
        <p>{CELL_REPORT_FILTER_TEXTS.emptyFiltered}</p>
        <Button type="button" variant="outline" className="h-11" onClick={clearFilters}>
          {CELL_REPORT_FILTER_TEXTS.clearAll}
        </Button>
      </div>
    ) : (
      <p className="text-center py-8 text-muted-foreground">Nenhum relatório encontrado</p>
    );

  const clearFiltersButton = (
    <Button type="button" variant="ghost" className="h-11" onClick={clearFilters}>
      {CELL_REPORT_FILTER_TEXTS.clearAll}
    </Button>
  );

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;
    if (isError) return <p className="text-center py-8 text-destructive">Erro ao carregar os relatórios</p>;
    if (reports.length === 0) return renderEmpty();

    return (
      <div className={`divide-y divide-border ${isPlaceholderData ? "opacity-60" : ""}`}>
        {reports.map((r) => (canViewRow(r) ? renderViewCard(r) : renderPlainCard(r)))}
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
              {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
            </div>
            {isMobile && deletedButton}
          </div>
          {(canSubmitNewReport || submitButtonPending || (!isMobile && deletedButton)) && (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isMobile && deletedButton}
              {submitButtonPending && <Skeleton className="h-11 w-full sm:h-10 sm:w-40" aria-hidden="true" />}
              {canSubmitNewReport && (
                <Button
                  onClick={(e) => {
                    returnFocus.setOpener(e.currentTarget);
                    setReportDialog({ mode: "launch" });
                  }}
                  className="h-11 w-full sm:h-10 sm:w-auto"
                >
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  {REPORT_LIST_TEXTS.newReport}
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
            {cellFilter.cellId !== null ? (
              <RecordFilterChip
                state={cellChipState(cellIdentity)}
                texts={CELL_REPORT_FILTER_TEXTS.chip}
                onRemove={removeCellFilter}
                trailing={clearFiltersButton}
              />
            ) : (
              hasSearch && <div>{clearFiltersButton}</div>
            )}
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
                    <TableRow><TableCell colSpan={columnCount} className="p-0">{renderEmpty()}</TableCell></TableRow>
                  ) : (
                    reports.map((r) => {
                      const streetLine = formatStreetLine(cellOfReport(r));
                      return (
                        <TableRow key={r.id} className={isPlaceholderData ? "opacity-60" : undefined}>
                          <TableCell className="font-medium">
                            <div className="flex flex-col leading-tight">
                              {renderLeader(r, "")}
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

        {/* O formulário traz o próprio diálogo responsivo (E2.11, T1, UXD-1). */}
        {reportDialog && (
          <CellReportDialog
            {...(reportDialog.mode === "edit" ? { mode: "edit", reportId: reportDialog.reportId } : { mode: "launch" })}
            onClose={handleClose}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}

        <CellReportSheet
          reportId={reportToRead}
          open={sheetState === "open"}
          onClose={() => setReportParam(null)}
          onCloseAutoFocus={onSheetCloseAutoFocus}
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
