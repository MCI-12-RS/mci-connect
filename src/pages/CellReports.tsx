import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import CellReportForm from "@/components/CellReportForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Search, Pencil, Trash2, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

const CellReports = () => {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingReport, setEditingReport] = useState<any | null>(null);
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["cell_reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cell_reports")
        .select(`
          *,
          cells (
            id,
            leader:members!cells_leader_id_fkey(name),
            meeting_day,
            meeting_time
          ),
          cell_report_participants(count)
        `)
        .order("date", { ascending: false });

      if (error) throw error;
      return data;
    },
  });

  const filteredReports = reports.filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    const leaderName = r.cells?.leader?.name?.toLowerCase() || "";
    const theme = r.theme?.toLowerCase() || "";
    return leaderName.includes(s) || theme.includes(s);
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cell_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] });
      toast({ title: "Relatório excluído com sucesso" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao excluir relatório" });
    },
  });

  const handleEdit = (report: any) => {
    setEditingReport(report);
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
    setEditingReport(null);
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <ClipboardList className="w-7 h-7 md:w-8 md:h-8 text-primary" />
              Relatórios de Células
            </h1>
            <p className="text-muted-foreground text-sm">Gerenciar relatórios de encontros das células</p>
          </div>
          {(hasPermission("create_cell") || hasPermission("edit_cell")) && (
            <Button onClick={() => setFormOpen(true)} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Novo Relatório
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por líder ou tema..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Badge variant="secondary">{filteredReports.length} relatórios</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Célula (Líder)</TableHead>
                  <TableHead>Data / Hora</TableHead>
                  <TableHead>Tema</TableHead>
                  <TableHead className="text-center">Presenças</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Carregando...
                    </TableCell>
                  </TableRow>
                ) : filteredReports.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhum relatório encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredReports.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        {r.cells?.leader?.name || "Célula sem líder"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>{format(parseISO(r.date), "dd/MM/yyyy", { locale: ptBR })}</span>
                          <span className="text-xs text-muted-foreground">{r.time?.substring(0, 5) || "—"}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="truncate max-w-[200px] block" title={r.theme}>
                          {r.theme || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        {r.was_held ? (
                          <div className="flex flex-col items-center justify-center text-xs">
                            <span className="font-medium text-sm">
                              {(r.cell_report_participants?.[0]?.count || 0) + (r.visitors?.length || 0)}
                            </span>
                            <span className="text-muted-foreground text-[10px]">Total</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.was_held ? (
                          <Badge className="bg-green-500 hover:bg-green-600">Realizada</Badge>
                        ) : (
                          <Badge variant="destructive" title={r.reason_not_held}>Não Realizada</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {(hasPermission("edit_cell") || hasPermission("create_cell")) && (
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
                          {hasPermission("delete_cell") && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Tem certeza que deseja excluir este relatório? Esta ação não pode ser desfeita.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(r.id)}>
                                    Excluir
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={formOpen} onOpenChange={handleClose}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingReport ? "Editar Relatório" : "Novo Relatório de Célula"}</DialogTitle>
            </DialogHeader>
            <CellReportForm report={editingReport} onClose={handleClose} />
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default CellReports;
