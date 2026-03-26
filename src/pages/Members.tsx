import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import MemberForm from "@/components/MemberForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";

type Member = Database["public"]["Tables"]["members"]["Row"];

const Members = () => {
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members", search],
    queryFn: async () => {
      let query = supabase
        .from("members")
        .select("*")
        .order("name");

      if (search) {
        query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,cpf.ilike.%${search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast({ title: "Membro excluído com sucesso" });
    },
    onError: () => {
      toast({ variant: "destructive", title: "Erro ao excluir membro" });
    },
  });

  const handleEdit = (member: Member) => {
    setEditingMember(member);
    setFormOpen(true);
  };

  const handleClose = () => {
    setFormOpen(false);
    setEditingMember(null);
  };

  const getLevelLabel = (level: number) => {
    if (level === 0) return "Pastor";
    if (level === 1) return "12";
    if (level === 2) return "144";
    if (level === 3) return "1.728";
    return `Nível ${level}`;
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Membros</h1>
            <p className="text-muted-foreground">Gerenciar membros da igreja</p>
          </div>
          {hasPermission("create_member") && (
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Novo Membro
            </Button>
          )}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome, e-mail ou CPF..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Badge variant="secondary">{members.length} membros</Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Celular</TableHead>
                  <TableHead>Nível G12</TableHead>
                  <TableHead>Líder</TableHead>
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
                ) : members.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                      Nenhum membro encontrado
                    </TableCell>
                  </TableRow>
                ) : (
                  members.map((m: any) => (
                    <TableRow key={m.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{m.name}</span>
                          {m.email && <p className="text-xs text-muted-foreground">{m.email}</p>}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{m.mobile_whatsapp || "—"}</TableCell>
                      <TableCell>
                        <Badge variant={m.is_pastor ? "default" : "outline"}>
                          {m.is_pastor ? "Pastor" : getLevelLabel(m.g12_level)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {m.leader_id
                          ? members.find((l: any) => l.id === m.leader_id)?.name || "—"
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={m.is_active ? "default" : "secondary"} className={m.is_active ? "bg-success" : ""}>
                          {m.is_active ? "Ativo" : "Inativo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {hasPermission("edit_member") && (
                            <Button variant="ghost" size="icon" onClick={() => handleEdit(m)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                          )}
                          {hasPermission("delete_member") && (
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
                                    Tem certeza que deseja excluir {m.name}? Esta ação não pode ser desfeita.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(m.id)}>
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
              <DialogTitle>{editingMember ? "Editar Membro" : "Novo Membro"}</DialogTitle>
            </DialogHeader>
            <MemberForm member={editingMember} onClose={handleClose} />
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Members;
