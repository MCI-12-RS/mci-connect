import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";

type Member = Database["public"]["Tables"]["members"]["Row"];
type MemberInsert = Database["public"]["Tables"]["members"]["Insert"];

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
  const isEditing = !!member;
  const [cepLoading, setCepLoading] = useState(false);

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

  useEffect(() => {
    if (member) {
      setForm({ ...member });
    }
  }, [member]);

  // Auto-fetch Instagram Profile Picture
  useEffect(() => {
    const handle = form.instagram?.trim();
    if (!handle || handle.length < 3) return;

    const timer = setTimeout(() => {
      const avatarUrl = `https://unavatar.io/instagram/${handle.replace("@", "")}`;
      // Just check if it's potentially valid (unavatar always returns something, often a placeholder if not found)
      // but we'll save it as the candidate URL.
      setForm(prev => ({ ...prev, avatar_url: avatarUrl }));
    }, 1000);

    return () => clearTimeout(timer);
  }, [form.instagram]);

  const { data: roles = [] } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data } = await supabase.from("roles").select("*").order("name");
      return data || [];
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: MemberInsert) => {
      if (isEditing && member) {
        const { error } = await supabase.from("members").update(data).eq("id", member.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("members").insert(data);
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
    mutation.mutate(form);
  };

  const update = (field: keyof MemberInsert, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleMaskedChange = (field: keyof MemberInsert, value: string, maskFn: (v: string) => string) => {
    update(field, maskFn(value));
  };

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
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" value={form.email || ""} onChange={(e) => update("email", e.target.value)} />
          </div>
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
          <div className="space-y-2">
            <Label htmlFor="cpf">CPF</Label>
            <Input id="cpf" value={form.cpf || ""} onChange={(e) => handleMaskedChange("cpf", e.target.value, maskCPF)} placeholder="000.000.000-00" />
          </div>
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
          <div className="space-y-2">
            <Label htmlFor="mobile">Celular / WhatsApp</Label>
            <Input id="mobile" value={form.mobile_whatsapp || ""} onChange={(e) => handleMaskedChange("mobile_whatsapp", e.target.value, maskPhone)} placeholder="(00)00000-0000" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input id="phone" value={form.phone || ""} onChange={(e) => handleMaskedChange("phone", e.target.value, maskPhone)} placeholder="(00)0000-0000" />
          </div>
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

      <Separator />

      {/* Access */}
      <div>
        <h3 className="text-lg font-semibold mb-3">Acesso</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="role">Função</Label>
            <Select value={form.role_id || "none"} onValueChange={(v) => update("role_id", v === "none" ? null : v)}>
              <SelectTrigger><SelectValue placeholder="Selecione a função" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma</SelectItem>
                {roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
    </form>
  );
};

export default MemberForm;
