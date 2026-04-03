import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";

type Member = Database["public"]["Tables"]["members"]["Row"] & { instagram?: string; avatar_url?: string };
type MemberInsert = Database["public"]["Tables"]["members"]["Insert"] & { instagram?: string; avatar_url?: string };


interface MemberFormProps {
  member: Member | null;
  onClose: () => void;
}

const BRAZILIAN_STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

// Mask utilities
const maskCPF = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
};

const maskPhone = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 10) {
    return digits
      .replace(/(\d{2})(\d)/, "($1)$2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits
    .replace(/(\d{2})(\d)/, "($1)$2")
    .replace(/(\d{5})(\d)/, "$1-$2");
};

const maskCEP = (value: string) => {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return digits.replace(/(\d{5})(\d)/, "$1-$2");
};

const MemberForm = ({ member, onClose }: MemberFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission, isSystem, member: currentMember } = useAuth();
  const isEditing = !!member;
  const [cepLoading, setCepLoading] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const canAssignRole = isSystem || hasPermission("assign_role", "manage_roles");
  const isOwnData = !!member && !!currentMember && member.id === currentMember.id;
  const canViewSensitive = isOwnData || isSystem || hasPermission("view_sensitive_data");
  const canChangePassword = isSystem || hasPermission("change_member_password");

  const fetchAddressByCEP = useCallback(async (cep: string) => {
    const digits = cep.replace(/\D/g, "");
    if (digits.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      const data = await res.json();
      if (!data.erro) {
        setForm((prev) => ({
          ...prev,
          street: data.logradouro || prev.street,
          neighborhood: data.bairro || prev.neighborhood,
          city: data.localidade || prev.city,
          state: data.uf || prev.state,
          complement: data.complemento || prev.complement,
        }));
      }
    } catch {
      // silently fail
    } finally {
      setCepLoading(false);
    }
  }, []);

  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await supabase.from("roles").select("*").order("name");
      return data || [];
    },
  });

  const defaultRoleId = roles.find((r) => r.is_default)?.id || null;

  const [form, setForm] = useState<MemberInsert>({
    name: "",
    email: "",
    cpf: "",
    gender: null,
    birth_date: null,
    mobile_whatsapp: "",
    phone: "",
    notes: "",
    is_pastor: false,
    has_leadership: false,
    leader_id: null,
    is_baptized: false,
    baptism_date: null,
    is_active: true,
    spouse_id: null,
    street: "",
    number: "",
    complement: "",
    neighborhood: "",
    city: "",
    state: "",
    zip_code: "",
    instagram: "",
    avatar_url: "",
    role_id: null,
  });

  const [password, setPassword] = useState("");

  useEffect(() => {
    if (member) {
      setForm({ ...member });
    }
  }, [member]);

  // Auto-select default role for new members
  useEffect(() => {
    if (!isEditing && !form.role_id && defaultRoleId) {
      setForm((prev) => ({ ...prev, role_id: defaultRoleId }));
    }
  }, [isEditing, defaultRoleId, form.role_id]);

  const mutation = useMutation({
    mutationFn: async (data: MemberInsert) => {
      let email = data.email?.trim();

      if (!email) {
        if (isEditing && member?.email?.endsWith("@mci12fakemail.com")) {
          email = member.email;
        } else if (!isEditing) {
          const normalizedName = (data.name || "membro")
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .trim()
            .replace(/[^a-z0-9]/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_|_$/g, "");
            
          const hash = Math.random().toString(36).substring(2, 8);
          email = `${normalizedName}_${hash}@mci12fakemail.com`;
        }
      }

      const cleanData = {
        ...data,
        email,
        cpf: data.cpf?.replace(/\D/g, ""),
        mobile_whatsapp: data.mobile_whatsapp?.replace(/\D/g, ""),
        phone: data.phone?.replace(/\D/g, ""),
        zip_code: data.zip_code?.replace(/\D/g, ""),
      };

      if (!isEditing) {
        const finalPassword = password || "123456";
        const { data: result, error } = await supabase.functions.invoke('create-user-admin', {
          body: { 
            email: cleanData.email, 
            password: finalPassword, 
            memberData: cleanData 
          }
        });
        if (error) throw error;
        if (result.error) throw new Error(result.error);
        return result;
      }

      if (isEditing && member) {
        const { error } = await supabase.from("members").update(cleanData).eq("id", member.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast({ title: isEditing ? "Membro atualizado com sucesso" : "Membro criado com sucesso" });
      onClose();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.role_id) {
      toast({ variant: "destructive", title: "Erro", description: "Selecione uma função para o membro." });
      return;
    }
    mutation.mutate(form);
  };

  const update = (field: keyof MemberInsert, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleChangePassword = async () => {
    if (!member || !newPassword) return;
    if (newPassword.length < 6) {
      toast({ variant: "destructive", title: "A senha deve ter pelo menos 6 caracteres" });
      return;
    }
    setChangingPassword(true);
    try {
      const { data, error } = await supabase.functions.invoke("change-member-password", {
        body: { member_id: member.id, new_password: newPassword },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Senha alterada com sucesso" });
      setPasswordDialogOpen(false);
      setNewPassword("");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Erro", description: err.message });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleMaskedChange = (field: keyof MemberInsert, value: string, maskFn: (v: string) => string) => {
    update(field, maskFn(value));
  };

  const isFakeEmail = form.email?.endsWith("@mci12fakemail.com");

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Personal Data */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Dados Pessoais</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome *</Label>
            <Input id="name" value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </div>
          {canViewSensitive && (
            <div className="space-y-2">
              <Label htmlFor="email">
                E-mail {isFakeEmail && <span className="text-xs text-muted-foreground font-normal ml-2">(Não informado)</span>}
              </Label>
              <Input 
                id="email" 
                type="email" 
                value={isFakeEmail ? "" : (form.email || "")} 
                onChange={(e) => update("email", e.target.value)} 
                placeholder={isFakeEmail ? "Adicionar e-mail..." : ""} 
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram (@)</Label>
            <Input 
              id="instagram" 
              placeholder="@usuario" 
              value={form.instagram || ""} 
              onChange={(e) => {
                let v = e.target.value;
                if (v && !v.startsWith("@")) v = "@" + v;
                update("instagram", v);
              }} 
            />
          </div>
          {canViewSensitive && (
            <div className="space-y-2">
              <Label htmlFor="cpf">CPF</Label>
              <Input id="cpf" value={form.cpf || ""} onChange={(e) => handleMaskedChange("cpf", e.target.value, maskCPF)} placeholder="000.000.000-00" />
            </div>
          )}
          {!isEditing && (
            <div className="space-y-2">
              <Label htmlFor="password">Senha para Acesso</Label>
              <Input 
                id="password" 
                type="password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                placeholder="Padrão: 123456"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="gender">Gênero</Label>
            <Select value={form.gender || ""} onValueChange={(v) => update("gender", v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="M">Masculino</SelectItem>
                <SelectItem value="F">Feminino</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="birth_date">Data de Nascimento</Label>
            <Input id="birth_date" type="date" value={form.birth_date || ""} onChange={(e) => update("birth_date", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="spouse">Cônjuge</Label>
            <AsyncMemberSelect
              value={form.spouse_id || null}
              onChange={(v) => update("spouse_id", v)}
              excludeId={member?.id}
              placeholder="Buscar cônjuge..."
            />
          </div>
          {canViewSensitive && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mobile">Celular / WhatsApp</Label>
                <Input id="mobile" value={form.mobile_whatsapp || ""} onChange={(e) => handleMaskedChange("mobile_whatsapp", e.target.value, maskPhone)} placeholder="(00)00000-0000" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" value={form.phone || ""} onChange={(e) => handleMaskedChange("phone", e.target.value, maskPhone)} placeholder="(00)0000-0000" />
              </div>
            </>
          )}
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea id="notes" value={form.notes || ""} onChange={(e) => update("notes", e.target.value)} />
          </div>
        </div>
      </div>

      <Separator />

      {/* Ministry Data */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Dados Ministeriais</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="is_pastor">É Pastor(a)?</Label>
            <Switch id="is_pastor" checked={form.is_pastor || false} onCheckedChange={(v) => update("is_pastor", v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="is_active">Ativo</Label>
            <Switch id="is_active" checked={form.is_active !== false} onCheckedChange={(v) => update("is_active", v)} />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="has_leadership">Tem Liderança?</Label>
            <Switch id="has_leadership" checked={form.has_leadership || false} onCheckedChange={(v) => update("has_leadership", v)} />
          </div>
          {form.has_leadership && (
            <div className="space-y-2">
              <Label htmlFor="leader">Líder</Label>
              <AsyncMemberSelect
                value={form.leader_id || null}
                onChange={(v) => update("leader_id", v)}
                excludeId={member?.id}
                placeholder="Buscar líder..."
              />
            </div>
          )}
          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="is_baptized">Batizado(a)?</Label>
            <Switch id="is_baptized" checked={form.is_baptized || false} onCheckedChange={(v) => update("is_baptized", v)} />
          </div>
          {form.is_baptized && (
            <div className="space-y-2">
              <Label htmlFor="baptism_date">Data do Batismo</Label>
              <Input id="baptism_date" type="date" value={form.baptism_date || ""} onChange={(e) => update("baptism_date", e.target.value)} />
            </div>
          )}
        </div>
      </div>

      {canViewSensitive && (
        <>
          <Separator />
          {/* Address */}
          <div>
            <h3 className="text-lg font-semibold mb-3">Endereço</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="zip_code">CEP {cepLoading && <span className="text-xs text-muted-foreground ml-1">Buscando...</span>}</Label>
                <Input
                  id="zip_code"
                  value={form.zip_code || ""}
                  onChange={(e) => {
                    const masked = maskCEP(e.target.value);
                    update("zip_code", masked);
                    if (masked.replace(/\D/g, "").length === 8) {
                      fetchAddressByCEP(masked);
                    }
                  }}
                  placeholder="00000-000"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="street">Rua</Label>
                <Input id="street" value={form.street || ""} onChange={(e) => update("street", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="number">Número</Label>
                <Input id="number" value={form.number || ""} onChange={(e) => update("number", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="complement">Complemento</Label>
                <Input id="complement" value={form.complement || ""} onChange={(e) => update("complement", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="neighborhood">Bairro</Label>
                <Input id="neighborhood" value={form.neighborhood || ""} onChange={(e) => update("neighborhood", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input id="city" value={form.city || ""} onChange={(e) => update("city", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">Estado</Label>
                <Select value={form.state || ""} onValueChange={(v) => update("state", v)}>
                  <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                  <SelectContent>
                    {BRAZILIAN_STATES.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </>
      )}

      <Separator />

      {/* Access */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Acesso</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {canAssignRole ? (
            <div className="space-y-2">
              <Label htmlFor="role">Função *</Label>
              <Select value={form.role_id || ""} onValueChange={(v) => update("role_id", v)}>
                <SelectTrigger><SelectValue placeholder="Selecione a função" /></SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.name}{r.is_default ? " (Padrão)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label>Função</Label>
              <Input 
                value={roles.find((r) => r.id === form.role_id)?.name || "—"} 
                disabled 
                className="bg-muted"
              />
            </div>
          )}
          {isEditing && canChangePassword && (
            <div className="space-y-2">
              <Label>Senha</Label>
              <Button type="button" variant="outline" className="w-full" onClick={() => setPasswordDialogOpen(true)}>
                <Key className="w-4 h-4 mr-2" />
                Alterar Senha
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando..." : isEditing ? "Salvar" : "Criar Membro"}
        </Button>
      </div>

      {/* Password Change Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="w-[95vw] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alterar Senha - {member?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new_password">Nova Senha</Label>
              <Input
                id="new_password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>Cancelar</Button>
              <Button type="button" onClick={handleChangePassword} disabled={changingPassword || newPassword.length < 6}>
                {changingPassword ? "Alterando..." : "Alterar Senha"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </form>
  );
};

export default MemberForm;
