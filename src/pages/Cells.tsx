import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import CellForm from "@/components/CellForm";
import CellReportForm from "@/components/CellReportForm";
import ListPagination from "@/components/ListPagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Search, Pencil, Trash2, FilePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useClampPage, useListSearchParams } from "@/hooks/use-list-search-params";
import { useCellsList } from "@/hooks/use-cells-list";
import { formatG12Label } from "@/lib/cells/labels";
import type { CellRow } from "@/lib/cells/fields";

const Cells = () => {
  const list = useListSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<CellRow | null>(null);
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [selectedCellForReport, setSelectedCellForReport] = useState<CellRow | null>(null);
  const { hasPermission, member: currentMember } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data, isLoading, isError, isPlaceholderData } = useCellsList(list.params);
  const cells = data?.rows ?? [];
  const total = data?.total ?? 0;

  useClampPage(list, { data, isPlaceholderData });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cells").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cells"] });
      // Os relatórios da célula são excluídos junto.
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] });
      toast({ title: "Célula excluída com sucesso" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao excluir célula" });
    },
  });

  const handleEdit = (cell: CellRow) => { setEditingCell(cell); setFormOpen(true); };
  const handleClose = () => { setFormOpen(false); setEditingCell(null); };
  const handleOpenReport = (cell: CellRow) => { setSelectedCellForReport(cell); setReportFormOpen(true); };
  const handleCloseReport = () => { setReportFormOpen(false); setSelectedCellForReport(null); };

  const isOwnCell = (c: CellRow) => !!currentMember && (c.leader_id === currentMember.id || c.timothy_id === currentMember.id);

  const canSubmitReport = (c: CellRow) =>
    hasPermission("submit_any_visible_report") || (hasPermission("submit_own_cell_report") && isOwnCell(c));

  const cellHasActions = (c: CellRow) => canSubmitReport(c) || hasPermission("edit_cell") || hasPermission("delete_cell");

  const anyCellHasActions = cells.some(cellHasActions);
  const columnCount = anyCellHasActions ? 7 : 6;

  const ActionButtons = ({ c }: { c: CellRow }) => (
    <div className="flex items-center gap-1">
      {canSubmitReport(c) && (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenReport(c)} title="Novo Relatório" aria-label="Novo relatório">
          <FilePlus className="w-3.5 h-3.5 text-primary" />
        </Button>
      )}
      {hasPermission("edit_cell") && (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(c)} aria-label="Editar célula">
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      )}
      {hasPermission("delete_cell") && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Excluir célula">
              <Trash2 className="w-3.5 h-3.5 text-destructive" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
              <AlertDialogDescription>Tem certeza que deseja excluir esta célula?</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={() => deleteMutation.mutate(c.id)}>Excluir</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
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
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">{c.leader_name || "Sem líder"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">G12: {formatG12Label(c)}</p>
              </div>
              {cellHasActions(c) && <ActionButtons c={c} />}
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
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{c.type}</Badge>
                <Badge variant={c.is_active ? "default" : "secondary"}>
                  {c.is_active ? "Ativa" : "Inativa"}
                </Badge>
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
          <div>
            <h1 className="text-2xl md:text-3xl font-bold">Células</h1>
            <p className="text-muted-foreground text-sm">Gerenciar células</p>
          </div>
          {hasPermission("create_cell") && (
            <Button onClick={() => setFormOpen(true)} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Nova Célula
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
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
                    {anyCellHasActions && <TableHead className="w-24">Ações</TableHead>}
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
                          <Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Ativa" : "Inativa"}</Badge>
                        </TableCell>
                        {anyCellHasActions && <TableCell>{cellHasActions(c) && <ActionButtons c={c} />}</TableCell>}
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
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
            <DialogHeader>
              <DialogTitle>{editingCell ? "Editar Célula" : "Nova Célula"}</DialogTitle>
            </DialogHeader>
            <CellForm cell={editingCell} onClose={handleClose} />
          </DialogContent>
        </Dialog>

        <Dialog open={reportFormOpen} onOpenChange={handleCloseReport}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto w-[95vw] sm:w-full">
            <DialogHeader>
              <DialogTitle>Novo Relatório de Célula</DialogTitle>
            </DialogHeader>
            {reportFormOpen && <CellReportForm initialCell={selectedCellForReport} onClose={handleCloseReport} />}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Cells;
