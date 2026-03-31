import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import CellForm from "@/components/CellForm";
import CellReportForm from "@/components/CellReportForm";
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
import { Database } from "@/integrations/supabase/types";

type Cell = Database["public"]["Tables"]["cells"]["Row"];

const Cells = () => {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingCell, setEditingCell] = useState<Cell | null>(null);
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [selectedCellForReport, setSelectedCellForReport] = useState<string | null>(null);
  const { hasPermission, member: currentMember } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  const { data: members = [] } = useQuery({
    queryKey: ["members-lookup"],
    queryFn: async () => {
      const { data, error } = await supabase.from("members").select("id, name, leader_id, g12_level");
      if (error) throw error;
      return data || [];
    },
  });

  const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));

  const { data: cells = [], isLoading } = useQuery({
    queryKey: ["cells"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cells")
        .select(`*, leader:members!cells_leader_id_fkey(name), timothy:members!cells_timothy_id_fkey(name), host:members!cells_host_id_fkey(name)`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const findG12 = (memberId: string | null): string => {
    if (!memberId || !memberMap[memberId]) return "—";
    let current = memberMap[memberId];
    let safety = 0;
    while (current && current.g12_level > 1 && current.leader_id && safety < 10) {
      current = memberMap[current.leader_id];
      safety++;
    }
    return current?.g12_level === 1 ? current.name : current?.g12_level === 0 ? "Pastores" : "—";
  };

  const filteredCells = cells.filter((c: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const getLeaderName = (id: string | null) =>
      id && memberMap[id]?.leader_id ? memberMap[memberMap[id].leader_id]?.name?.toLowerCase() || "" : "";
    return (
      (c.leader?.name?.toLowerCase() || "").includes(s) ||
      (c.timothy?.name?.toLowerCase() || "").includes(s) ||
      (c.host?.name?.toLowerCase() || "").includes(s) ||
      getLeaderName(c.leader_id).includes(s) ||
      getLeaderName(c.timothy_id).includes(s) ||
      getLeaderName(c.host_id).includes(s)
    );
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cells").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cells"] });
      toast({ title: "Célula excluída com sucesso" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao excluir célula" });
    },
  });

  const handleEdit = (cell: Cell) => { setEditingCell(cell); setFormOpen(true); };
  const handleClose = () => { setFormOpen(false); setEditingCell(null); };
  const handleOpenReport = (cellId: string) => { setSelectedCellForReport(cellId); setReportFormOpen(true); };
  const handleCloseReport = () => { setReportFormOpen(false); setSelectedCellForReport(null); };

  const isOwnCell = (c: any) => currentMember && (c.leader_id === currentMember.id || c.timothy_id === currentMember.id);

  const ActionButtons = ({ c }: { c: any }) => (
    <div className="flex items-center gap-1">
      {(hasPermission("create_cell") || hasPermission("edit_cell") || (hasPermission("edit_own_data") && isOwnCell(c))) && (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenReport(c.id)} title="Novo Relatório">
          <FilePlus className="w-3.5 h-3.5 text-primary" />
        </Button>
      )}
      {(hasPermission("edit_cell") || (hasPermission("edit_own_data") && isOwnCell(c))) && (
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(c)}>
          <Pencil className="w-3.5 h-3.5" />
        </Button>
      )}
      {hasPermission("delete_cell") && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
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
    if (filteredCells.length === 0) return <p className="text-center py-8 text-muted-foreground">Nenhuma célula encontrada</p>;

    return (
      <div className="divide-y divide-border">
        {filteredCells.map((c: any) => (
          <div key={c.id} className="px-4 py-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm">{c.leader?.name || "Sem líder"}</p>
                <p className="text-xs text-muted-foreground mt-0.5">G12: {findG12(c.leader_id)}</p>
              </div>
              <ActionButtons c={c} />
            </div>

            {/* Team */}
            <div className="flex gap-4 text-xs text-muted-foreground">
              {c.timothy?.name && (
                <span>Timóteo: <span className="font-medium text-foreground">{c.timothy.name}</span></span>
              )}
              {c.host?.name && (
                <span>Anfitrião: <span className="font-medium text-foreground">{c.host.name}</span></span>
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
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input placeholder="Líder, Timóteo, Anfitrião..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
              </div>
              <Badge variant="secondary">{filteredCells.length}</Badge>
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
                    <TableHead className="w-24">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                  ) : filteredCells.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Nenhuma célula encontrada</TableCell></TableRow>
                  ) : (
                    filteredCells.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-sm font-medium">{c.leader?.name}</span>
                            <div className="flex flex-col text-xs text-muted-foreground italic">
                              {c.timothy?.name && <span>Timóteo: {c.timothy.name}</span>}
                              {c.host?.name && <span>Anfitrião: {c.host.name}</span>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{findG12(c.leader_id)}</TableCell>
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
                        <TableCell><ActionButtons c={c} /></TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
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
            {reportFormOpen && <CellReportForm initialCellId={selectedCellForReport || undefined} onClose={handleCloseReport} />}
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Cells;
