import { useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ActionsCell, ActionsHead } from "@/components/ActionsColumn";
import AppLayout from "@/components/AppLayout";
import CellForm from "@/components/CellForm";
import CellReportForm from "@/components/CellReportForm";
import CellDeletionFlow from "@/components/CellDeletionFlow";
import RowActionsMenu, { type RowAction } from "@/components/RowActionsMenu";
import ListPagination from "@/components/ListPagination";
import DeletedListButton from "@/components/DeletedListButton";
import { CellStatusBadge } from "@/components/StatusBadges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Search, Pencil, Trash2, FilePlus } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellsList } from "@/hooks/use-cells-list";
import { useReturnFocus } from "@/hooks/use-return-focus";
import { formatG12Label } from "@/lib/cells/labels";
import type { CellRow } from "@/lib/cells/fields";
import { leaderLabel, toCellDeletionTarget, type CellDeletionTarget } from "@/lib/deletion/targets";
import { CELL_DELETION_TEXTS, DELETED_LIST_TEXTS } from "@/lib/deletion/texts";
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

  const { data, isLoading, isError, isPlaceholderData } = useCellsList(list.params);
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

  // "Novo relatório" (RN-13, UX-23): a mesma regra do banco, calculada na cells_view (AQ-4).
  const canSubmitReport = (c: CellRow) => c.can_submit_report === true;

  // "Editar" só com "Editar Célula": ser líder ou timóteo não basta (RN-12).
  const canEditCell = hasPermission("edit_cell");
  const canDeleteCell = hasPermission("delete_cell");

  const cellHasActions = (c: CellRow) => canSubmitReport(c) || canEditCell || canDeleteCell;

  const anyCellHasActions = cells.some(cellHasActions);
  const columnCount = anyCellHasActions ? 7 : 6;

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
          title="Novo Relatório"
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

  const renderDesktopActions = (c: CellRow) => (
    <div className="flex items-center gap-1">
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
    <div className="flex items-center gap-2 shrink-0">
      {renderFrequentActions(c, "h-11 w-11")}
      <RowActionsMenu label={CELL_DELETION_TEXTS.actionsLabel(leaderLabel(c.leader_name))} actions={rowActions(c)} />
    </div>
  );

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;
    if (isError) return <p className="text-center py-8 text-destructive">Erro ao carregar as células</p>;
    if (cells.length === 0) return <p className="text-center py-8 text-muted-foreground">Nenhuma célula encontrada</p>;

    return (
      <div className={`divide-y divide-border ${isPlaceholderData ? "opacity-60" : ""}`}>
        {cells.map((c) => (
          <div key={c.id} className="px-4 py-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">{c.leader_name || "Sem líder"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">G12: {formatG12Label(c)}</p>
              </div>
              {cellHasActions(c) && renderMobileActions(c)}
            </div>

            {/* Team */}
            <div className="flex gap-4 text-xs text-muted-foreground">
              {c.timothy_name && (
                <span>Timóteo: <span className="font-medium text-foreground">{c.timothy_name}</span></span>
              )}
              {c.host_name && (
                <span>Anfitrião: <span className="font-medium text-foreground">{c.host_name}</span></span>
              )}
            </div>

            {/* Footer: badges + schedule */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{c.type}</Badge>
                <CellStatusBadge active={c.is_active === true} />
              </div>
              <span className="text-xs text-muted-foreground">
                {c.meeting_day} · {c.meeting_time?.substring(0, 5) || "—"}
              </span>
            </div>

            {/* Address */}
            {c.street && (
              <p className="text-xs text-muted-foreground">
                {c.street}, {c.number || "s/n"} — {c.neighborhood || ""}
              </p>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="text-2xl md:text-3xl font-bold">Células</h1>
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
                  className="w-full sm:w-auto"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Nova Célula
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

          {isMobile ? (
            renderMobileCards()
          ) : (
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Líder</TableHead>
                    <TableHead>G12</TableHead>
                    <TableHead>Endereço</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Dia / Hora</TableHead>
                    <TableHead>Status</TableHead>
                    {anyCellHasActions && <ActionsHead>Ações</ActionsHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : isError ? (
                    <TableRow><TableCell colSpan={columnCount} className="text-center py-8 text-destructive">Erro ao carregar as células</TableCell></TableRow>
                  ) : cells.length === 0 ? (
                    <TableRow><TableCell colSpan={columnCount} className="text-center py-8 text-muted-foreground">Nenhuma célula encontrada</TableCell></TableRow>
                  ) : (
                    cells.map((c) => (
                      <TableRow key={c.id} className={isPlaceholderData ? "opacity-60" : undefined}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">{c.leader_name}</span>
                            <div className="flex flex-col text-xs text-muted-foreground italic">
                              {c.timothy_name && <span>Timóteo: {c.timothy_name}</span>}
                              {c.host_name && <span>Anfitrião: {c.host_name}</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{formatG12Label(c)}</TableCell>
                        <TableCell className="text-sm">
                          <div className="flex flex-col">
                            <span className="font-medium">{c.street ? `${c.street}, ${c.number || "s/n"}` : "—"}</span>
                            <span className="text-xs text-muted-foreground">{c.neighborhood || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell><Badge variant="outline">{c.type}</Badge></TableCell>
                        <TableCell className="text-sm">{c.meeting_day} às {c.meeting_time?.substring(0, 5) || "—"}</TableCell>
                        <TableCell>
                          <CellStatusBadge active={c.is_active === true} />
                        </TableCell>
                        {anyCellHasActions && <ActionsCell>{cellHasActions(c) && renderDesktopActions(c)}</ActionsCell>}
                      </TableRow>
                    ))
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
              itemLabel={["célula", "células"]}
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
              <DialogTitle>{editingCell ? "Editar Célula" : "Nova Célula"}</DialogTitle>
            </DialogHeader>
            <CellForm cell={editingCell} onClose={handleClose} />
          </DialogContent>
        </Dialog>

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
