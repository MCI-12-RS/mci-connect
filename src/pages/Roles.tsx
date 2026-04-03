import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import AppLayout from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Star } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const ALL_PERMISSIONS = [
  { value: "view_all_church", label: "Visualizar Toda Igreja" },
  { value: "view_own_ministry", label: "Visualizar Seu Ministério" },
  { value: "edit_own_data", label: "Editar Próprio Cadastro" },
  { value: "view_all_reports", label: "Visualizar Relatórios de Toda Igreja" },
  { value: "view_own_reports", label: "Visualizar Meus Relatórios" },
  { value: "submit_own_cell_report", label: "Enviar Relatório (Células que Lidera)" },
  { value: "submit_any_visible_report", label: "Enviar Relatório (Qualquer Célula Visível)" },
  { value: "create_member", label: "Criar Membro" },
  { value: "view_members", label: "Visualizar Membros (legado)" },
  { value: "edit_member", label: "Editar Membro" },
  { value: "delete_member", label: "Excluir Membro" },
  { value: "manage_roles", label: "Gerenciar Funções" },
  { value: "view_roles", label: "Visualizar Funções" },
  { value: "view_dashboard", label: "Visualizar Painel" },
  { value: "create_cell", label: "Criar Célula" },
  { value: "edit_cell", label: "Editar Célula" },
  { value: "delete_cell", label: "Excluir Célula" },
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
  const isMobile = useIsMobile();

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

  const openEdit = (role: any) => { setEditingRole(role); setRoleName(role.name); setRoleDesc(role.description || ""); setSelectedPerms(role.permissions); setFormOpen(true); };
  const openNew = () => { setEditingRole(null); setRoleName(""); setRoleDesc(""); setSelectedPerms([]); setFormOpen(true); };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingRole) {
        const { error } = await supabase.from("roles").update({ name: roleName, description: roleDesc }).eq("id", editingRole.id);
        if (error) throw error;
        await supabase.from("role_permissions").delete().eq("role_id", editingRole.id);
        if (selectedPerms.length > 0) {
          const { error: permError } = await supabase.from("role_permissions").insert(selectedPerms.map((p) => ({ role_id: editingRole.id, permission: p as any })));
          if (permError) throw permError;
        }
      } else {
        const { data: newRole, error } = await supabase.from("roles").insert({ name: roleName, description: roleDesc }).select().single();
        if (error) throw error;
        if (selectedPerms.length > 0) {
          const { error: permError } = await supabase.from("role_permissions").insert(selectedPerms.map((p) => ({ role_id: newRole.id, permission: p as any })));
          if (permError) throw permError;
        }
      }
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["roles-with-perms"] }); toast({ title: editingRole ? "Função atualizada" : "Função criada" }); setFormOpen(false); },
    onError: (error: any) => { toast({ variant: "destructive", title: "Erro", description: error.message }); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("roles").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["roles-with-perms"] }); toast({ title: "Função excluída" }); },
  });

  const togglePerm = (perm: PermissionAction) => setSelectedPerms((prev) => prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]);
  const getPermLabel = (value: string) => ALL_PERMISSIONS.find((p) => p.value === value)?.label || value;
  const canManage = hasPermission("manage_roles");

  const DeleteRoleButton = ({ role }: { role: any }) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <Trash2 className="w-3.5 h-3.5 text-destructive" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
          <AlertDialogDescription>Tem certeza que deseja excluir a função "{role.name}"?</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => deleteMutation.mutate(role.id)}>Excluir</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  const renderMobileCards = () => {
    if (isLoading) return <p className="text-center py-8 text-muted-foreground">Carregando...</p>;

    return (
      <div className="divide-y divide-border">
        {roles.map((role) => (
          <div key={role.id} className="px-4 py-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-sm">{role.name}</p>
                  {role.is_system && <Badge variant="outline" className="text-[10px] px-1.5 py-0">Sistema</Badge>}
                </div>
                {role.description && <p className="text-xs text-muted-foreground mt-0.5">{role.description}</p>}
              </div>
              {canManage && (
                <div className="flex items-center shrink-0">
                  <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => openEdit(role)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  {!role.is_system && <DeleteRoleButton role={role} />}
                </div>
              )}
            </div>

            {/* Permissions */}
            <div className="flex flex-wrap gap-1.5">
              {role.permissions.map((p: string) => (
                <Badge key={p} variant="secondary" className="text-[11px] font-normal">{getPermLabel(p)}</Badge>
              ))}
              {role.permissions.length === 0 && (
                <span className="text-xs text-muted-foreground italic">Sem permissões</span>
              )}
            </div>
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
            <h1 className="text-2xl md:text-3xl font-bold">Funções</h1>
            <p className="text-muted-foreground text-sm">Gerenciar funções e permissões</p>
          </div>
          {canManage && (
            <Button onClick={openNew} className="w-full sm:w-auto">
              <Plus className="w-4 h-4 mr-2" />
              Nova Função
            </Button>
          )}
        </div>

        <Card>
          {isMobile ? (
            renderMobileCards()
          ) : (
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
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
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
                              {!role.is_system && <DeleteRoleButton role={role} />}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          )}
        </Card>

        <Dialog open={formOpen} onOpenChange={setFormOpen}>
          <DialogContent className="w-[95vw] sm:w-full">
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
                      <Checkbox checked={selectedPerms.includes(perm.value)} onCheckedChange={() => togglePerm(perm.value)} />
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
