import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { CellReportDialog } from "@/components/cell-reports/CellReportDialog";
import { CellReportFilters, type CellReportFiltersHandle } from "@/components/cell-reports/CellReportFilters";
import { CellReportSheet } from "@/components/cell-reports/CellReportSheet";
import ReportCard from "@/components/cell-reports/ReportCard";
import { findReportOpenButton } from "@/components/cell-reports/report-open";
import ReportsTable from "@/components/cell-reports/ReportsTable";
import CellReportDeletionFlow from "@/components/CellReportDeletionFlow";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import { FilterChips } from "@/components/filters/FilterChips";
import { FiltersButton } from "@/components/filters/FiltersButton";
import { FiltersPanel } from "@/components/filters/FiltersPanel";
import { FiltersSheet } from "@/components/filters/FiltersSheet";
import { RecordFilterChip } from "@/components/filters/RecordFilterChip";
import { WeekShortcuts } from "@/components/filters/WeekShortcuts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { CELLS_TABLE_MIN_WIDTH, TABLE_MIN_WIDTH, useMinWidth } from "@/hooks/use-min-width";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellReportsList } from "@/hooks/use-cell-reports-list";
import { useCellReportFilters } from "@/hooks/use-cell-report-filters";
import { useCellReportFilterPeople } from "@/hooks/use-cell-report-filter-options";
import { removeReportFromListCache, useCellReportListPreview } from "@/hooks/use-cell-report-list-preview";
import { useCellReportSheet } from "@/hooks/use-cell-report-sheet";
import { useReportEditEntry } from "@/hooks/use-report-edit-entry";
import { cellReportDetailKey } from "@/hooks/use-cell-report";
import { cellReportParticipantsKey } from "@/hooks/use-cell-report-participants";
import { useCellIdentity } from "@/hooks/use-cell-identity";
import { useServerWeeks } from "@/hooks/use-server-weeks";
import { usePanelOpen } from "@/hooks/use-panel-open";
import { useReturnFocus } from "@/hooks/use-return-focus";
import type { CellReportListRow } from "@/lib/cell-reports/fields";
import {
  cellChipState,
  cellReportFilterChips,
  countActiveCellReportFilters,
  EMPTY_CELL_REPORT_FILTERS,
  type CellReportFilters as Filters,
} from "@/lib/cell-reports/filters";
import { CELL_REPORT_FILTER_TEXTS as TEXTS } from "@/lib/cell-reports/filter-texts";
import { toReportRowView, type ReportRowView } from "@/lib/cell-reports/report-row";
import { activeWeekShortcut, toWeekShortcuts, WEEK_SHORTCUT_LABELS } from "@/lib/cell-reports/weeks";
import { toCellReportDeletionTarget, type CellReportDeletionTarget } from "@/lib/deletion/targets";
import { CELL_REPORT_DELETION_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";
import { listSubtitle } from "@/lib/access/access";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { formatCount } from "@/lib/format";
import type { SelectOption } from "@/lib/selectors";

const FILTERS_PANEL_ID = "cell-reports-filters-panel";

/** Primeira carga nos cartões (T9): 5 `Skeleton` no formato deles; a tabela tem os seus. */
function LoadingCards() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" data-testid="cell-reports-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-40 w-full motion-reduce:animate-none" />
      ))}
    </div>
  );
}

type ReportDialog = { mode: "launch" } | { mode: "edit"; reportId: string; fromSheet: boolean };

const CellReports = () => {
  const list = useListSearchParams();
  const queryClient = useQueryClient();
  const [reportDialog, setReportDialog] = useState<ReportDialog | null>(null);
  const [deleting, setDeleting] = useState<{ target: CellReportDeletionTarget; fromSheet: boolean } | null>(null);
  const { hasPermission, permissionsLoaded, access } = useAuth();
  const isMobile = useIsMobile();
  // Cartões até 1279 px e tabela a partir de 1280 px (UXD-5, P74); o painel a partir de 1024 px (P50).
  const showTable = useMinWidth(CELLS_TABLE_MIN_WIDTH);
  const showPanel = useMinWidth(TABLE_MIN_WIDTH);

  const reportFilters = useCellReportFilters();
  const { filters } = reportFilters;
  const listQuery = useCellReportsList(list.params, filters);
  const { data, isPending, isError, isPlaceholderData, isRefetching } = listQuery;
  const refreshing = isPlaceholderData || isRefetching;
  const total = data?.total ?? 0;
  useClampPage(list, { data, isPlaceholderData });

  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);
  const focusHeading = () => requestAnimationFrame(() => headingRef.current?.focus());

  // Atalhos de semana (P90): só com a data do servidor (UXD-4).
  const weeksQuery = useServerWeeks();
  const shortcuts = weeksQuery.data ? toWeekShortcuts(weeksQuery.data) : null;
  const activeWeek = shortcuts ? activeWeekShortcut(filters, shortcuts) : null;

  // A Célula vinda de link (P84, P93).
  const cellIdentity = useCellIdentity(filters.cellId);
  const cellChip = cellChipState(cellIdentity);

  // Filtros (T4, T5; P50): `Sheet` abaixo de 1024 px, painel recolhível a partir daí.
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const filtersFormRef = useRef<CellReportFiltersHandle>(null);
  const [panelOpen, setPanelOpen] = usePanelOpen("cell-reports");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  const [sheetKey, setSheetKey] = useState(0);
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<string, string>>(new Map());
  const leaderNames = useCellReportFilterPeople("leader", filters.leaderIds, pickedNames);
  const g12Names = useCellReportFilterPeople("g12", filters.g12Ids, pickedNames);
  const pickPeople = (options: readonly SelectOption[]) => {
    if (options.length === 0) return;
    setPickedNames((current) => new Map([...current, ...options.map((option): [string, string] => [option.value, option.label])]));
  };

  const filterCount = countActiveCellReportFilters(filters);
  const hasSearch = list.searchInput.trim() !== "" || list.params.search !== "";
  const hasSearchOrFilters = filterCount > 0 || hasSearch;
  const chips = cellReportFilterChips(filters, {
    leader: (index) => leaderNames.label(filters.leaderIds[index]).label,
    g12: (index) => g12Names.label(filters.g12Ids[index]).label,
  });
  const showChips = !showPanel || !panelOpen;
  const appliedUnavailable =
    leaderNames.field(filters.leaderIds).unavailableCount + g12Names.field(filters.g12Ids).unavailableCount;
  const truncated = reportFilters.leadersTruncated || reportFilters.g12Truncated;

  const clearAll = () => {
    reportFilters.clearAll();
    list.setSearchInput("");
    requestAnimationFrame(() => filtersButtonRef.current?.focus());
  };
  const openFilters = () => {
    if (showPanel) {
      setPanelOpen(!panelOpen);
      return;
    }
    setDraft(filters);
    setSheetKey((key) => key + 1);
    setSheetOpen(true);
  };
  const applyDraft = () => {
    if (filtersFormRef.current && !filtersFormRef.current.validateDates()) return;
    reportFilters.apply(draft);
    setSheetOpen(false);
  };
  const removeCellChip = () => {
    reportFilters.removeCell();
    requestAnimationFrame(() => filtersButtonRef.current?.focus());
  };

  // A consulta "Ver relatório" (T10 a T13; AQ-8).
  const sheet = useCellReportSheet();
  const preview = useCellReportListPreview(sheet.reportId);
  // Aberta pela linha, o foco volta ao botão dela; por link, ao `h1` (Acessibilidade).
  const sheetFromList = useRef(false);
  if (sheet.reportId) sheetFromList.current = sheet.fromList;
  const onSheetCloseAutoFocus = (event: Event, reportId: string | null) => {
    event.preventDefault();
    const opener = sheetFromList.current ? findReportOpenButton(reportId) : null;
    if (opener) opener.focus();
    else headingRef.current?.focus();
  };

  const canEditReport = hasPermission("edit_cell_report");
  const canDeleteReport = hasPermission("delete_cell_report");
  const showActions = canEditReport || canDeleteReport;
  // Só para quem pode lançar o relatório de pelo menos uma célula (E2.02, T8).
  const canSubmitNewReport = access?.can_submit_some_report === true;
  const submitButtonPending = !permissionsLoaded;
  const subtitle = listSubtitle(access, "cellReports");

  const rows: { row: CellReportListRow; view: ReportRowView }[] = (data?.rows ?? []).map((row) => ({
    row,
    view: toReportRowView(row, { canEditReports: canEditReport }),
  }));

  const startEdit = (reportId: string, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setReportDialog({ mode: "edit", reportId, fromSheet: false });
  };
  // Pela consulta, o formulário ganha uma entrada no histórico: o voltar fecha só ele (DA-11).
  const editEntry = useReportEditEntry();
  const startEditFromSheet = (reportId: string, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setReportDialog({ mode: "edit", reportId, fromSheet: true });
    editEntry.start();
  };
  const closeReportDialog = () => {
    if (reportDialog?.mode === "edit" && reportDialog.fromSheet) editEntry.closed();
    setReportDialog(null);
  };
  const startDeletion = (target: CellReportDeletionTarget, opener: HTMLElement | null, fromSheet: boolean) => {
    returnFocus.setOpener(opener);
    setDeleting({ target, fromSheet });
  };
  const deletionTarget = (row: CellReportListRow) =>
    toCellReportDeletionTarget({ id: row.id ?? "", date: row.date ?? "", snapshot_leader_name: row.snapshot_leader_name });

  // Excluir pela consulta (DA-12): fecha, tira o relatório do cache das listas e só então recarrega.
  const onDeletedFromSheet = (reportId: string) => {
    sheet.close();
    removeReportFromListCache(queryClient, reportId);
    queryClient.removeQueries({ queryKey: cellReportDetailKey(reportId) });
    queryClient.removeQueries({ queryKey: cellReportParticipantsKey(reportId) });
  };

  // "Excluídos": só para quem restaura (E2.01, UX-13). No celular, na linha do título.
  const deletedButton = hasPermission("manage_roles") && (
    <DeletedListButton
      to="/cell-reports/deleted"
      text={DELETED_LIST_TEXTS.cellReports.button}
      label={DELETED_LIST_TEXTS.cellReports.buttonLabel}
      isMobile={isMobile}
    />
  );

  const rowLabel = (row: CellReportListRow) => {
    const { date, leaderName } = deletionTarget(row);
    return [date, leaderName] as const;
  };

  // Funções que devolvem JSX, e não componentes: um componente declarado aqui dentro seria recriado
  // a cada render, e o botão que abriu o diálogo perderia o foco.

  /** "Editar" no mesmo lugar em todas as linhas (P65): some na célula excluída sem deslocar o resto. */
  const renderEditButton = (row: CellReportListRow, view: ReportRowView, buttonClass: string) =>
    canEditReport &&
    (view.canEdit ? (
      <Button
        variant="ghost"
        size="icon"
        className={buttonClass}
        onClick={(event) => startEdit(view.id, event.currentTarget)}
        aria-label={CELL_REPORT_DELETION_TEXTS.editLabel(...rowLabel(row))}
      >
        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    ) : (
      <span className={`inline-block shrink-0 ${buttonClass}`} aria-hidden="true" />
    ));

  const renderDesktopActions = (row: CellReportListRow, view: ReportRowView) => (
    <div className="flex items-center justify-end gap-1">
      {renderEditButton(row, view, "h-8 w-8")}
      {canDeleteReport && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={CELL_REPORT_DELETION_TEXTS.deleteLabel(...rowLabel(row))}
          onClick={(event) => startDeletion(deletionTarget(row), event.currentTarget, false)}
        >
          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      )}
    </div>
  );

  /** No cartão, "Excluir relatório" fica no "⋯" (P8). */
  const rowActions = (row: CellReportListRow): RowAction[] =>
    canDeleteReport
      ? [{ label: CELL_REPORT_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => startDeletion(deletionTarget(row), trigger, false) }]
      : [];

  const renderCardActions = (row: CellReportListRow, view: ReportRowView) =>
    showActions ? (
      <div className="flex items-center gap-2">
        {renderEditButton(row, view, "h-11 w-11")}
        {canDeleteReport && <RowActionsMenu label={CELL_REPORT_DELETION_TEXTS.actionsLabel(...rowLabel(row))} actions={rowActions(row)} />}
      </div>
    ) : null;

  /** Erro, carregando e vazio (T9); `null` com relatórios para mostrar. */
  const renderListState = () => {
    if (isError && !data) {
      return (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3 text-foreground">
              <p>{TEXTS.loadFailed}</p>
              <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => void listQuery.refetch()}>
                {TEXTS.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    if (isPending) return showTable ? null : <LoadingCards />;
    if (rows.length > 0) return null;
    if (!hasSearchOrFilters) return <p className="py-8 text-center text-sm text-muted-foreground">{TEXTS.empty}</p>;
    return (
      <div className="space-y-3 p-6 text-center text-sm">
        <p>{TEXTS.emptyFiltered}</p>
        <Button type="button" variant="outline" className="h-11" onClick={clearAll}>
          {FILTER_TEXTS.clearAll}
        </Button>
      </div>
    );
  };

  const renderCards = () =>
    renderListState() ?? (
      <ul className={`divide-y divide-border ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing}>
        {rows.map(({ row, view }) => (
          <ReportCard key={view.id} row={view} actions={renderCardActions(row, view)} onOpen={() => sheet.open(view.id)} />
        ))}
      </ul>
    );

  const weekItems = shortcuts ?? WEEK_SHORTCUT_LABELS.map((item) => ({ ...item, spokenLabel: item.label }));

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 ref={headingRef} tabIndex={-1} className="break-words text-2xl font-bold outline-none md:text-3xl">
                {TEXTS.title}
              </h1>
              {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
            </div>
            {isMobile && deletedButton}
          </div>
          {(canSubmitNewReport || submitButtonPending || (!isMobile && deletedButton)) && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {!isMobile && deletedButton}
              {submitButtonPending && <Skeleton className="h-11 w-full sm:h-10 sm:w-40" aria-hidden="true" />}
              {canSubmitNewReport && (
                <Button
                  onClick={(event) => {
                    returnFocus.setOpener(event.currentTarget);
                    setReportDialog({ mode: "launch" });
                  }}
                  className="h-11 w-full sm:h-10 sm:w-auto"
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  {TEXTS.newReport}
                </Button>
              )}
            </div>
          )}
        </div>

        <Card className="min-w-0">
          <CardHeader className="space-y-3 px-4 sm:px-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 space-y-1 lg:w-full lg:max-w-sm">
                <Label htmlFor="cell-reports-search">{TEXTS.search.label}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="cell-reports-search"
                    ref={searchRef}
                    type="search"
                    enterKeyHint="search"
                    placeholder={TEXTS.search.placeholder}
                    value={list.searchInput}
                    onChange={(event) => list.setSearchInput(event.target.value)}
                    maxLength={100}
                    className="h-11 pl-10 lg:h-10"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                <FiltersButton
                  ref={filtersButtonRef}
                  count={filterCount}
                  mode={showPanel ? "panel" : "sheet"}
                  expanded={showPanel ? panelOpen : sheetOpen}
                  controlsId={FILTERS_PANEL_ID}
                  onClick={openFilters}
                />
                {hasSearchOrFilters && (
                  <Button type="button" variant="ghost" className="h-11 lg:h-10" onClick={clearAll}>
                    {FILTER_TEXTS.clearAll}
                  </Button>
                )}
              </div>
            </div>

            <WeekShortcuts
              groupLabel={TEXTS.weeks.groupLabel}
              items={weekItems}
              value={activeWeek}
              disabled={!shortcuts}
              onSelect={(key) => {
                const week = shortcuts?.find((item) => item.key === key);
                if (week) reportFilters.applyWeek(week);
              }}
            />

            {showPanel && (
              <FiltersPanel id={FILTERS_PANEL_ID} open={panelOpen}>
                <CellReportFilters
                  variant="panel"
                  value={filters}
                  onChange={(changes) => reportFilters.apply({ ...filters, ...changes })}
                  cellChip={cellChip}
                  leaders={leaderNames.field(filters.leaderIds)}
                  g12={g12Names.field(filters.g12Ids)}
                  onPeoplePicked={pickPeople}
                />
              </FiltersPanel>
            )}

            {showChips && filters.cellId !== null && (
              <RecordFilterChip state={cellChip} texts={TEXTS.cell} onRemove={removeCellChip} />
            )}
            {showChips && (
              <FilterChips chips={chips} onRemove={reportFilters.removeChip} filtersButtonRef={filtersButtonRef} compact />
            )}
            {showChips && appliedUnavailable > 0 && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{TEXTS.leaders.unavailable(appliedUnavailable)}</span>
              </p>
            )}
            {showChips && truncated && <p className="text-sm text-muted-foreground">{TEXTS.leaders.limit}</p>}
            <p role="status" aria-busy={refreshing} className={`text-sm text-muted-foreground ${refreshing ? "opacity-60" : ""}`}>
              {data ? `${formatCount(total)} ${total === 1 ? TEXTS.count[0] : TEXTS.count[1]}` : ""}
            </p>
          </CardHeader>

          {!showTable ? (
            renderCards()
          ) : (
            renderListState() ?? (
              <CardContent className="p-0">
                <ReportsTable
                  rows={rows.map(({ view }) => view)}
                  isLoading={isPending}
                  refreshing={refreshing}
                  showActions={showActions}
                  renderActions={(view) => {
                    const entry = rows.find((item) => item.view.id === view.id);
                    return entry ? renderDesktopActions(entry.row, entry.view) : null;
                  }}
                  onOpen={(view) => sheet.open(view.id)}
                />
              </CardContent>
            )
          )}

          {data && !(isError && !data) && (
            <ListPagination
              page={list.params.page}
              pageSize={list.params.pageSize}
              total={total}
              itemLabel={TEXTS.count}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </Card>

        {!showPanel && (
          <FiltersSheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            onApply={applyDraft}
            onClear={() => {
              setDraft(EMPTY_CELL_REPORT_FILTERS);
              setSheetKey((key) => key + 1);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              filtersButtonRef.current?.focus();
            }}
          >
            <CellReportFilters
              key={sheetKey}
              ref={filtersFormRef}
              variant="sheet"
              value={draft}
              onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
              cellChip={cellChip}
              leaders={leaderNames.field(draft.leaderIds)}
              g12={g12Names.field(draft.g12Ids)}
              onPeoplePicked={pickPeople}
            />
          </FiltersSheet>
        )}

        {/* A consulta fica ao lado do formulário, e não dentro dele (T13). */}
        <CellReportSheet
          reportId={sheet.reportId}
          preview={preview}
          onClose={sheet.close}
          onCloseAutoFocus={onSheetCloseAutoFocus}
          onEdit={startEditFromSheet}
          onDelete={(target, opener) => startDeletion(target, opener, true)}
        />

        {/* O formulário traz o próprio diálogo responsivo (E2.11, T1, UXD-1); pela consulta, abre por cima dela (UXD-10). */}
        {reportDialog && (
          <CellReportDialog
            {...(reportDialog.mode === "edit" ? { mode: "edit", reportId: reportDialog.reportId } : { mode: "launch" })}
            onClose={closeReportDialog}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
            {...(reportDialog.mode === "edit" && reportDialog.fromSheet
              ? { closeRequest: editEntry.closeRequest, onCloseRequestDeclined: editEntry.declined }
              : {})}
          />
        )}

        {deleting && (
          <CellReportDeletionFlow
            key={deleting.target.id}
            report={deleting.target}
            onClose={() => setDeleting(null)}
            onDeleted={deleting.fromSheet ? () => onDeletedFromSheet(deleting.target.id) : undefined}
            onCloseAutoFocus={(event) => {
              if (!deleting.fromSheet) {
                returnFocus.onCloseAutoFocus(event);
                return;
              }
              // Excluído pela consulta, o foco vai para o `h1` (T13); recusado, volta à consulta.
              if (sheet.reportId === deleting.target.id) {
                returnFocus.onCloseAutoFocus(event);
                return;
              }
              event.preventDefault();
              focusHeading();
            }}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default CellReports;
