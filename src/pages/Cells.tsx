import { useRef, useState } from "react";
import { AlertCircle, Info } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import CellForm from "@/components/CellForm";
import { CellReportDialog } from "@/components/cell-reports/CellReportDialog";
import CellDeletionFlow from "@/components/CellDeletionFlow";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import CellCard from "@/components/cells/CellCard";
import CellsTable from "@/components/cells/CellsTable";
import ReportStatusLegend from "@/components/cells/ReportStatusLegend";
import { CellFilters, type CellFiltersHandle } from "@/components/cells/CellFilters";
import { FilterChips } from "@/components/filters/FilterChips";
import { FiltersButton } from "@/components/filters/FiltersButton";
import { FiltersPanel } from "@/components/filters/FiltersPanel";
import { FiltersSheet } from "@/components/filters/FiltersSheet";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Plus, Search, Pencil, Trash2, FilePlus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { CELLS_TABLE_MIN_WIDTH, TABLE_MIN_WIDTH, useMinWidth } from "@/hooks/use-min-width";
import { useCellFilters } from "@/hooks/use-cell-filters";
import { useCellFilterPeople } from "@/hooks/use-cell-filter-options";
import { usePanelOpen } from "@/hooks/use-panel-open";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellsList } from "@/hooks/use-cells-list";
import { useReturnFocus } from "@/hooks/use-return-focus";
import type { CellListRow } from "@/lib/cells/fields";
import { leaderLabel, toCellDeletionTarget, type CellDeletionTarget } from "@/lib/deletion/targets";
import { CELL_DELETION_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";
import { CELLS_PAGE_TEXTS } from "@/lib/cells/texts";
import { listSubtitle } from "@/lib/access/access";
import { cellFilterChips, countActiveCellFilters, EMPTY_CELL_FILTERS, type CellFilters as Filters } from "@/lib/cells/filters";
import { CELL_FILTER_TEXTS as FILTERS } from "@/lib/cells/filter-texts";
import { FILTER_TEXTS } from "@/lib/filters/texts";
import { formatCount } from "@/lib/format";
import type { SelectOption } from "@/lib/selectors";

const FILTERS_PANEL_ID = "cells-filters-panel";

/** Primeira carga nos cartões (T7, UX-14): 5 `Skeleton` no formato deles; a tabela tem os seus. */
function LoadingRows() {
  return (
    <div className="space-y-3 p-4" aria-busy="true" data-testid="cells-loading">
      {Array.from({ length: 5 }, (_, index) => (
        <Skeleton key={index} className="h-36 w-full" />
      ))}
    </div>
  );
}

const Cells = () => {
  const list = useListSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<CellListRow | null>(null);
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [selectedCellForReport, setSelectedCellForReport] = useState<CellListRow | null>(null);
  const [deletingCell, setDeletingCell] = useState<CellDeletionTarget | null>(null);
  const { hasPermission, access } = useAuth();
  const isMobile = useIsMobile();
  // Cartões até 1279 px e tabela a partir de 1280 px, já no primeiro render (E2.09, P74;
  // a tabela com a coluna Relatório não cabe em 1024 px, UXD-5).
  const showTable = useMinWidth(CELLS_TABLE_MIN_WIDTH);

  const cellFilters = useCellFilters();
  const { filters } = cellFilters;
  // O painel de filtros fica a partir de 1024 px (P50, UX-01); a tabela, a partir de 1280 px (P74).
  const showPanel = useMinWidth(TABLE_MIN_WIDTH);

  const listQuery = useCellsList(list.params, filters);
  const { data, isPending, isError, isPlaceholderData, isRefetching } = listQuery;
  // A lista na tela recarrega (troca de página, filtro ou depois de uma gravação): as
  // linhas ficam em `opacity-60` e com `aria-busy` até a resposta (E1.08; E2.06, P44).
  const refreshing = isPlaceholderData || isRefetching;
  const cells = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  // Ao fechar um diálogo, o foco volta a quem o abriu ou, se a célula saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);

  // Filtros (E2.10, T1 a T3; P50): `Sheet` abaixo de 1024 px, painel recolhível a partir daí.
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const filtersFormRef = useRef<CellFiltersHandle>(null);
  const [panelOpen, setPanelOpen] = usePanelOpen("cells");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<Filters>(filters);
  // Muda a cada abertura e a cada "Limpar" do `Sheet`: os campos recomeçam, sem erro antigo.
  const [sheetKey, setSheetKey] = useState(0);
  // Os nomes das pessoas escolhidas agora nos seletores; as da URL vêm só da `cell_filter_names` (RN-06).
  const [pickedNames, setPickedNames] = useState<ReadonlyMap<string, string>>(new Map());
  const leaderNames = useCellFilterPeople("leader", filters.leaders, pickedNames);
  const g12Names = useCellFilterPeople("g12", filters.g12, pickedNames);
  const pickPeople = (options: readonly SelectOption[]) => {
    if (options.length === 0) return;
    setPickedNames((current) => new Map([...current, ...options.map((option): [string, string] => [option.value, option.label])]));
  };

  const filterCount = countActiveCellFilters(filters);
  const hasSearch = list.searchInput.trim() !== "" || list.params.search !== "";
  const hasSearchOrFilters = filterCount > 0 || hasSearch;
  const chips = cellFilterChips(filters, {
    leader: (index) => leaderNames.label(filters.leaders[index]).label,
    g12: (index) => g12Names.label(filters.g12[index]).label,
  });
  const showChips = !showPanel || !panelOpen;
  const appliedUnavailable =
    leaderNames.field(filters.leaders).unavailableCount + g12Names.field(filters.g12).unavailableCount;
  const truncated = cellFilters.leadersTruncated || cellFilters.g12Truncated;

  const clearAll = () => {
    cellFilters.clearAll();
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
    cellFilters.apply(draft);
    setSheetOpen(false);
  };

  const handleEdit = (cell: CellListRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setEditingCell(cell);
    setFormOpen(true);
  };
  const handleClose = () => { setFormOpen(false); setEditingCell(null); };
  const handleOpenReport = (cell: CellListRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setSelectedCellForReport(cell);
    setReportFormOpen(true);
  };
  const handleCloseReport = () => { setReportFormOpen(false); setSelectedCellForReport(null); };

  // "Novo relatório" (RN-13, UX-23; E2.08, RN-11 c): a mesma regra do banco, calculada na
  // cells_view (AQ-4, AQ-7), que já é falsa para a célula inativa.
  const canSubmitReport = (c: CellListRow) => c.can_submit_report === true;

  // "Editar" só com "Editar Célula": ser líder ou timóteo não basta (RN-12).
  const canEditCell = hasPermission("edit_cell");
  const canDeleteCell = hasPermission("delete_cell");

  const cellHasActions = (c: CellListRow) => canSubmitReport(c) || canEditCell || canDeleteCell;

  // "Excluídas": só para quem restaura (E2.01, UX-13). No celular, na linha do título.
  const deletedButton = hasPermission("manage_roles") && (
    <DeletedListButton
      to="/cells/deleted"
      text={DELETED_LIST_TEXTS.cells.button}
      label={DELETED_LIST_TEXTS.cells.buttonLabel}
      isMobile={isMobile}
    />
  );
  const canCreate = hasPermission("create_cell");
  const subtitle = listSubtitle(access, "cells");

  const startDeletion = (c: CellListRow, opener: HTMLElement | null) => {
    returnFocus.setOpener(opener);
    setDeletingCell(toCellDeletionTarget(c));
  };

  // Funções que devolvem JSX, e não componentes: um componente declarado aqui
  // dentro seria recriado a cada render, e o botão que abriu o diálogo perderia o foco.

  /** "Novo relatório" e "Editar": fora do menu "⋯" no celular, com 44×44 px (UXD-4). */
  const renderFrequentActions = (c: CellListRow, buttonClass: string) => (
    <>
      {canSubmitReport(c) && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClass}
          onClick={(e) => handleOpenReport(c, e.currentTarget)}
          aria-label={CELL_DELETION_TEXTS.newReportLabel(leaderLabel(c.leader_name))}
        >
          <FilePlus className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        </Button>
      )}
      {canEditCell && (
        <Button
          variant="ghost"
          size="icon"
          className={buttonClass}
          onClick={(e) => handleEdit(c, e.currentTarget)}
          aria-label={CELL_DELETION_TEXTS.editLabel(leaderLabel(c.leader_name))}
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      )}
    </>
  );

  // Alinhadas pelo fim (P65): "Editar" e "Excluir" ficam na mesma coluna em todas as linhas,
  // com ou sem "Novo relatório".
  const renderDesktopActions = (c: CellListRow) => (
    <div className="flex items-center justify-end gap-1">
      {renderFrequentActions(c, "h-8 w-8")}
      {canDeleteCell && (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={CELL_DELETION_TEXTS.deleteLabel(leaderLabel(c.leader_name))}
          onClick={(e) => startDeletion(c, e.currentTarget)}
        >
          <Trash2 className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      )}
    </div>
  );

  /** No celular, "Excluir célula" fica no menu "⋯" do card (T1, P8). */
  const rowActions = (c: CellListRow): RowAction[] =>
    canDeleteCell
      ? [{ label: CELL_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => startDeletion(c, trigger) }]
      : [];

  const renderMobileActions = (c: CellListRow) => (
    <div className="ml-auto flex items-center gap-2 shrink-0">
      {renderFrequentActions(c, "h-11 w-11")}
      <RowActionsMenu label={CELL_DELETION_TEXTS.actionsLabel(leaderLabel(c.leader_name))} actions={rowActions(c)} />
    </div>
  );

  /** Carregando, erro e vazio (T7, UX-14); `null` com células para mostrar. */
  const renderListState = () => {
    if (isError && !data) {
      return (
        <div className="p-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3 text-foreground">
              <p>{FILTERS.loadFailed}</p>
              <Button type="button" variant="outline" className="h-11 lg:h-9" onClick={() => void listQuery.refetch()}>
                {FILTERS.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      );
    }
    if (isPending) return showTable ? null : <LoadingRows />;
    if (cells.length > 0) return null;
    if (!hasSearchOrFilters) return <p className="py-8 text-center text-sm text-muted-foreground">{FILTERS.empty}</p>;
    return (
      <div className="space-y-3 p-6 text-center text-sm">
        <p>{FILTERS.emptyFiltered}</p>
        <Button type="button" variant="outline" className="h-11" onClick={clearAll}>
          {FILTER_TEXTS.clearAll}
        </Button>
      </div>
    );
  };

  const renderMobileCards = () =>
    renderListState() ?? (
      <ul className={`divide-y divide-border ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing}>
        {cells.map((c) => (
          <CellCard key={c.id} cell={c} actions={cellHasActions(c) ? renderMobileActions(c) : null} />
        ))}
      </ul>
    );

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold break-words">Células</h1>
              {subtitle && <p className="text-muted-foreground text-sm">{subtitle}</p>}
            </div>
            {isMobile && deletedButton}
          </div>
          {(canCreate || (!isMobile && deletedButton)) && (
            <div className="flex flex-col sm:flex-row gap-2">
              {!isMobile && deletedButton}
              {canCreate && (
                <Button
                  onClick={(e) => {
                    returnFocus.setOpener(e.currentTarget);
                    setFormOpen(true);
                  }}
                  className="h-11 w-full sm:w-auto md:h-10"
                >
                  <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
                  {CELLS_PAGE_TEXTS.newCell}
                </Button>
              )}
            </div>
          )}
        </div>

        <Card className="min-w-0">
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <div className="min-w-0 space-y-1 lg:w-full lg:max-w-sm">
                <Label htmlFor="cells-search">{FILTERS.search.label}</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="cells-search"
                    ref={searchRef}
                    type="search"
                    enterKeyHint="search"
                    placeholder={FILTERS.search.placeholder}
                    value={list.searchInput}
                    onChange={(e) => list.setSearchInput(e.target.value)}
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

            {showPanel && (
              <FiltersPanel id={FILTERS_PANEL_ID} open={panelOpen}>
                <CellFilters
                  variant="panel"
                  value={filters}
                  onChange={(changes) => cellFilters.apply({ ...filters, ...changes })}
                  leaders={leaderNames.field(filters.leaders)}
                  g12={g12Names.field(filters.g12)}
                  onPeoplePicked={pickPeople}
                />
              </FiltersPanel>
            )}

            {showChips && (
              <FilterChips chips={chips} onRemove={cellFilters.removeChip} filtersButtonRef={filtersButtonRef} compact />
            )}
            {showChips && appliedUnavailable > 0 && (
              <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{FILTERS.leaders.unavailable(appliedUnavailable)}</span>
              </p>
            )}
            {/* Com o painel aberto, o próprio seletor (Líder ou G12) mostra "Escolha até 10 pessoas." no
                lugar da dica, porque a URL cortada deixa 10 escolhidas (`PersonMultiFilter`): sem repetir. */}
            {showChips && truncated && <p className="text-sm text-muted-foreground">{FILTERS.leaders.limit}</p>}
            {/* Durante a troca de filtro, o total antigo fica atenuado e a região, ocupada: só o novo é anunciado. */}
            <p
              role="status"
              aria-busy={refreshing}
              className={`text-sm text-muted-foreground ${refreshing ? "opacity-60" : ""}`}
            >
              {data ? `${formatCount(total)} ${total === 1 ? FILTERS.count[0] : FILTERS.count[1]}` : ""}
            </p>
            {/* A legenda da situação do relatório (P73), depois dos filtros: some no erro. */}
            {!(isError && !data) && <ReportStatusLegend />}
          </CardHeader>

          {!showTable ? (
            renderMobileCards()
          ) : (
            renderListState() ?? (
              <CardContent className="p-0">
                <CellsTable
                  rows={cells}
                  isLoading={isPending}
                  refreshing={refreshing}
                  caption={FILTERS.tableCaption}
                  renderActions={(c) => (cellHasActions(c) ? renderDesktopActions(c) : null)}
                />
              </CardContent>
            )
          )}

          {data && !(isError && !data) && (
            <ListPagination
              page={list.params.page}
              pageSize={list.params.pageSize}
              total={total}
              itemLabel={FILTERS.count}
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
              setDraft(EMPTY_CELL_FILTERS);
              setSheetKey((key) => key + 1);
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              filtersButtonRef.current?.focus();
            }}
          >
            <CellFilters
              key={sheetKey}
              ref={filtersFormRef}
              variant="sheet"
              value={draft}
              onChange={(changes) => setDraft((current) => ({ ...current, ...changes }))}
              leaders={leaderNames.field(draft.leaders)}
              g12={g12Names.field(draft.g12)}
              onPeoplePicked={pickPeople}
            />
          </FiltersSheet>
        )}

        {/* O formulário traz o próprio diálogo (E2.08, T1 e T6: rodapé com o resumo e o descartar). */}
        {formOpen && <CellForm cell={editingCell} onClose={handleClose} onCloseAutoFocus={returnFocus.onCloseAutoFocus} />}

        {/* O formulário de relatório com a célula fixa (E2.11, T1, T11). */}
        {reportFormOpen && selectedCellForReport && (
          <CellReportDialog
            mode="launch"
            cell={selectedCellForReport}
            onClose={handleCloseReport}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}

        {deletingCell && (
          <CellDeletionFlow
            key={deletingCell.id}
            cell={deletingCell}
            onClose={() => setDeletingCell(null)}
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          />
        )}
      </div>
    </AppLayout>
  );
};

export default Cells;
