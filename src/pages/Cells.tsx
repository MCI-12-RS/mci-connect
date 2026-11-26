import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import CellForm from "@/components/CellForm";
import CellReportForm from "@/components/CellReportForm";
import CellDeletionFlow from "@/components/CellDeletionFlow";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import CellCard from "@/components/cells/CellCard";
import CellsTable from "@/components/cells/CellsTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, FilePlus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { TABLE_MIN_WIDTH, useMinWidth } from "@/hooks/use-min-width";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellsList } from "@/hooks/use-cells-list";
import { useReturnFocus } from "@/hooks/use-return-focus";
import type { CellRow } from "@/lib/cells/fields";
import { leaderLabel, toCellDeletionTarget, type CellDeletionTarget } from "@/lib/deletion/targets";
import { CELL_DELETION_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";
import { CELLS_PAGE_TEXTS } from "@/lib/cells/texts";
import { listSubtitle } from "@/lib/access/access";

const Cells = () => {
  const list = useListSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<CellRow | null>(null);
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [selectedCellForReport, setSelectedCellForReport] = useState<CellRow | null>(null);
  const [deletingCell, setDeletingCell] = useState<CellDeletionTarget | null>(null);
  const { hasPermission, access } = useAuth();
  const isMobile = useIsMobile();
  // Cartões até 1023 px e tabela a partir de 1024 px, já no primeiro render (P45).
  const showTable = useMinWidth(TABLE_MIN_WIDTH);

  const { data, isLoading, isError, isPlaceholderData, isRefetching } = useCellsList(list.params);
  // A lista na tela recarrega (troca de página ou depois de uma gravação): as
  // linhas ficam em `opacity-60` e com `aria-busy` até a resposta (E1.08; E2.06, P44).
  const refreshing = isPlaceholderData || isRefetching;
  const cells = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  // Ao fechar um diálogo, o foco volta a quem o abriu ou, se a célula saiu da lista, à busca.
  const searchRef = useRef<HTMLInputElement>(null);
  const returnFocus = useReturnFocus(searchRef, data);

  const handleEdit = (cell: CellRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setEditingCell(cell);
    setFormOpen(true);
  };
  const handleClose = () => { setFormOpen(false); setEditingCell(null); };
  const handleOpenReport = (cell: CellRow, opener: HTMLElement) => {
    returnFocus.setOpener(opener);
    setSelectedCellForReport(cell);
    setReportFormOpen(true);
  };
  const handleCloseReport = () => { setReportFormOpen(false); setSelectedCellForReport(null); };

  // "Novo relatório" (RN-13, UX-23; E2.08, RN-11 c): a mesma regra do banco, calculada na
  // cells_view (AQ-4, AQ-7), que já é falsa para a célula inativa.
  const canSubmitReport = (c: CellRow) => c.can_submit_report === true;

  // "Editar" só com "Editar Célula": ser líder ou timóteo não basta (RN-12).
  const canEditCell = hasPermission("edit_cell");
  const canDeleteCell = hasPermission("delete_cell");

  const cellHasActions = (c: CellRow) => canSubmitReport(c) || canEditCell || canDeleteCell;

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

  const startDeletion = (c: CellRow, opener: HTMLElement | null) => {
    returnFocus.setOpener(opener);
    setDeletingCell(toCellDeletionTarget(c));
  };

  // Funções que devolvem JSX, e não componentes: um componente declarado aqui
  // dentro seria recriado a cada render, e o botão que abriu o diálogo perderia o foco.

  /** "Novo relatório" e "Editar": fora do menu "⋯" no celular, com 44×44 px (UXD-4). */
  const renderFrequentActions = (c: CellRow, buttonClass: string) => (
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
  const renderDesktopActions = (c: CellRow) => (
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
  const rowActions = (c: CellRow): RowAction[] =>
    canDeleteCell
      ? [{ label: CELL_DELETION_TEXTS.deleteAction, icon: Trash2, onSelect: (trigger) => startDeletion(c, trigger) }]
      : [];

  const renderMobileActions = (c: CellRow) => (
    <div className="ml-auto flex items-center gap-2 shrink-0">
      {renderFrequentActions(c, "h-11 w-11")}
      <RowActionsMenu label={CELL_DELETION_TEXTS.actionsLabel(leaderLabel(c.leader_name))} actions={rowActions(c)} />
    </div>
  );

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;
    if (isError) return <p className="text-center py-8 text-destructive">Erro ao carregar as células</p>;
    if (cells.length === 0) return <p className="text-center py-8 text-muted-foreground">Nenhuma célula encontrada</p>;

    return (
      <div className={`divide-y divide-border ${refreshing ? "opacity-60" : ""}`} aria-busy={refreshing}>
        {cells.map((c) => (
          <CellCard key={c.id} cell={c} actions={cellHasActions(c) ? renderMobileActions(c) : null} />
        ))}
      </div>
    );
  };

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

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchRef}
                placeholder="Líder, timóteo, anfitrião, rua ou bairro..."
                aria-label="Buscar células"
                value={list.searchInput}
                onChange={(e) => list.setSearchInput(e.target.value)}
                maxLength={100}
                className="pl-10"
              />
            </div>
          </CardHeader>

          {!showTable ? (
            renderMobileCards()
          ) : (
            <CardContent className="p-0">
              <CellsTable
                rows={cells}
                isLoading={isLoading}
                isError={isError}
                refreshing={refreshing}
                renderActions={(c) => (cellHasActions(c) ? renderDesktopActions(c) : null)}
              />
            </CardContent>
          )}

          {!isLoading && !isError && (
            <ListPagination
              page={list.params.page}
              pageSize={list.params.pageSize}
              total={total}
              itemLabel={["célula", "células"]}
              onPageChange={list.setPage}
              onPageSizeChange={list.setPageSize}
            />
          )}
        </Card>

        {/* O formulário traz o próprio diálogo (E2.08, T1 e T6: rodapé com o resumo e o descartar). */}
        {formOpen && <CellForm cell={editingCell} onClose={handleClose} onCloseAutoFocus={returnFocus.onCloseAutoFocus} />}

        <Dialog open={reportFormOpen} onOpenChange={handleCloseReport}>
          <DialogContent
            className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full"
            onCloseAutoFocus={returnFocus.onCloseAutoFocus}
          >
            <DialogHeader>
              <DialogTitle>Novo Relatório de Célula</DialogTitle>
            </DialogHeader>
            {reportFormOpen && <CellReportForm initialCell={selectedCellForReport} onClose={handleCloseReport} />}
          </DialogContent>
        </Dialog>

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
