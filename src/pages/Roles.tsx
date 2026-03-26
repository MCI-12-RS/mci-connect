import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const ALL_PERMISSIONS = [
  { value: "create_member", label: "Criar Membro" },
  { value: "view_members", label: "Visualizar Membros" },
  { value: "edit_member", label: "Editar Membro" },
  { value: "delete_member", label: "Excluir Membro" },
  { value: "manage_roles", label: "Gerenciar Funções" },
  { value: "view_roles", label: "Visualizar Funções" },
  { value: "view_dashboard", label: "Visualizar Painel" },
] as const;

type PermissionAction = typeof ALL_PERMISSIONS[number]["value"];

const Roles = () => {
  const [formOpen, setFormOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<any>(null);
  const [roleName, setRoleName] = useState("");
  const [roleDesc, setRoleDesc] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<PermissionAction[]>([]);
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: roles = [], isLoading } = useQuery({
    queryKey: ["roles-with-perms"],
    queryFn: async () => {
      const { data: rolesData } = await supabase.from("roles").select("*").order("name");
      const { data: permsData } = await supabase.from("role_permissions").select("*");
      return (rolesData || []).map((role) => ({
        ...role,
        permissions: (permsData || []).filter((p) => p.role_id === role.id).map((p) => p.permission),
      }));
    },
  });

  const openEdit = (role: any) => {
    setEditingRole(role);
    setRoleName(role.name);
    setRoleDesc(role.description || "");
    setSelectedPerms(role.permissions);
    setFormOpen(true);
  };

  const openNew = () => {
    setEditingRole(null);
    setRoleName("");
    setRoleDesc("");
    setSelectedPerms([]);
    setFormOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingRole) {
        const { error } = await supabase.from("roles").update({ name: roleName, description: roleDesc }).eq("id", editingRole.id);
        if (error) throw error;
        // Delete existing permissions and re-insert
        await supabase.from("role_permissions").delete().eq("role_id", editingRole.id);
        if (selectedPerms.length > 0) {
          const { error: permError } = await supabase.from("role_permissions").insert(
            selectedPerms.map((p) => ({ role_id: editingRole.id, permission: p as any }))
          );
          if (permError) throw permError;
        }
      } else {
        const { data: newRole, error } = await supabase.from("roles").insert({ name: roleName, description: roleDesc }).select().single();
        if (error) throw error;
        if (selectedPerms.length > 0) {
          const { error: permError } = await supabase.from("role_permissions").insert(
            selectedPerms.map((p) => ({ role_id: newRole.id, permission: p as any }))
          );
          if (permError) throw permError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles-with-perms"] });
      toast({ title: editingRole ? "Função atualizada" : "Função criada" });
      setFormOpen(false);
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("roles").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles-with-perms"] });
      toast({ title: "Função excluída" });
    },
  });

  const togglePerm = (perm: PermissionAction) => {
    setSelectedPerms((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  };

  const getPermLabel = (value: string) => ALL_PERMISSIONS.find((p) => p.value === value)?.label || value;

  const canManage = hasPermission("manage_roles");

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Funções</h1>
            <p className="text-muted-foreground">Gerenciar funções e permissões</p>
          </div>
          {canManage && (
            <Button onClick={openNew}>
              <Plus className="w-4 h-4 mr-2" />
              Nova Função
            </Button>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead>Permissões</TableHead>
                  {canManage && <TableHead className="w-24">Ações</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell>
                  </TableRow>
                ) : (
                  roles.map((role) => (
                    <TableRow key={role.id}>
                      <TableCell className="font-medium">
                        {role.name}
                        {role.is_system && <Badge variant="outline" className="ml-2 text-xs">Sistema</Badge>}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{role.description}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {role.permissions.map((p: string) => (
                            <Badge key={p} variant="secondary" className="text-xs">{getPermLabel(p)}</Badge>
                          ))}
                        </div>
                      </TableCell>
                      {canManage && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(role)}>
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {!role.is_system && (
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
                                      Tem certeza que deseja excluir a função "{role.name}"?
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteMutation.mutate(role.id)}>
                                      Excluir
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingRole ? "Editar Função" : "Nova Função"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Nome</Label>
                <Input value={roleName} onChange={(e) => setRoleName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Descrição</Label>
                <Input value={roleDesc} onChange={(e) => setRoleDesc(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Permissões</Label>
                <div className="grid grid-cols-1 gap-2 border rounded-md p-3">
                  {ALL_PERMISSIONS.map((perm) => (
                    <div key={perm.value} className="flex items-center gap-2">
                      <Checkbox
                        checked={selectedPerms.includes(perm.value)}
                        onCheckedChange={() => togglePerm(perm.value)}
                      />
                      <span className="text-sm">{perm.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setFormOpen(false)}>Cancelar</Button>
                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !roleName}>
                  {saveMutation.isPending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
};

export default Roles;
