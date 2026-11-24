import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import type { PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { toMemberWritePayload, type MemberRow } from "@/lib/members/fields";
import { DELETION_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";

type Member = MemberRow;
type MemberInsert = Database["public"]["Tables"]["members"]["Insert"];

/** "gone": a edição não voltou com a linha, porque o cadastro foi excluído no meio tempo (E2.01, DT-19). */
type SaveResult = "saved" | "gone";

const FAKE_EMAIL_DOMAIN = "@mci12fakemail.com";

interface MemberFormProps {
  member: Member | null;
  onClose: () => void;
  /**
   * "Definir líder" depois de restaurar um cadastro sem líder (E2.01, T5 e
   * UX-22): abre com "Tem Liderança?" ligado e o foco no campo Líder.
   */
  defineLeader?: boolean;
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

const EMPTY_FORM: MemberInsert = {
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
};

type RoleOption = Pick<Database["public"]["Tables"]["roles"]["Row"], "id" | "name" | "is_default">;

interface RoleFieldProps {
  /** `undefined` enquanto as funções carregam. */
  roles: RoleOption[] | undefined;
  loadError: boolean;
  value: string | null | undefined;
  canAssign: boolean;
  onChange: (roleId: string) => void;
}

/**
 * Campo Função. O Select só é montado com as funções já carregadas: dentro de
 * um <form>, o Select do Radix mantém um <select> nativo oculto, e um valor
 * sem a <option> correspondente vira "" nesse <select>, que avisa a mudança e
 * apaga a função escolhida.
 */
const RoleField = ({ roles, loadError, value, canAssign, onChange }: RoleFieldProps) => {
  let field: ReactNode;
  if (!roles) {
    const status = loadError ? "Não foi possível carregar as funções" : "Carregando funções…";
    field = <Input id="role" value={status} disabled className="bg-muted" />;
  } else if (!canAssign) {
    field = <Input id="role" value={roles.find((r) => r.id === value)?.name ?? "—"} disabled className="bg-muted" />;
  } else {
    field = (
      <Select value={value || ""} onValueChange={onChange}>
        <SelectTrigger id="role"><SelectValue placeholder="Selecione a função" /></SelectTrigger>
        <SelectContent>
          {roles.map((r) => (
            <SelectItem key={r.id} value={r.id}>{r.name}{r.is_default ? " (Padrão)" : ""}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <div className="space-y-2">
      <Label htmlFor="role">{canAssign ? "Função *" : "Função"}</Label>
      {field}
    </div>
  );
};

const MemberForm = ({ member, onClose, defineLeader = false }: MemberFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission, isSystem } = useAuth();
  const isEditing = !!member;
  const [cepLoading, setCepLoading] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const canAssignRole = isSystem || hasPermission("assign_role", "manage_roles");
  // Na edição, a members_view diz se os dados sensíveis deste membro estão
  // visíveis (o próprio cadastro ou view_sensitive_data). No cadastro, quem
  // tem create_member preenche todos os campos (E1.08, RN-11 e RN-12).
  const canViewSensitive = !isEditing || member?.sensitive_visible === true;
  const canChangePassword = isSystem || hasPermission("change_member_password");
  const canEditMinistry = isSystem || hasPermission("edit_member");

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

  const { data: roles, isError: rolesError } = useQuery({
    queryKey: ["roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("roles").select("id, name, is_default").order("name");
      if (error) throw error;
      return data;
    },
  });

  const defaultRoleId = roles?.find((r) => r.is_default)?.id || null;

  // Os dados do membro entram já na montagem (o diálogo monta o formulário a
  // cada abertura; quem trocar de membro sem desmontar precisa passar `key`).
  // Preenchidos depois, num efeito, mudariam o valor dos Selects quando as
  // opções ainda não existem, e o Radix apagaria o valor.
  const [form, setForm] = useState<MemberInsert>(() => {
    if (!member) return EMPTY_FORM;
    return defineLeader ? { ...member, has_leadership: true } : { ...member };
  });

  // "Definir líder": o foco vai para o campo Líder, que já abre visível.
  const leaderSelectRef = useRef<PaginatedSelectHandle>(null);
  useEffect(() => {
    if (defineLeader) leaderSelectRef.current?.focus();
  }, [defineLeader]);

  const [password, setPassword] = useState("");
  // O cadastro foi excluído (ou saiu do escopo) enquanto era editado.
  const [deletedWhileEditing, setDeletedWhileEditing] = useState(false);
  const deletedAlertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (deletedWhileEditing) deletedAlertRef.current?.focus();
  }, [deletedWhileEditing]);

  // Auto-select default role for new members
  useEffect(() => {
    if (!isEditing && !form.role_id && defaultRoleId) {
      setForm((prev) => ({ ...prev, role_id: defaultRoleId }));
    }
  }, [isEditing, defaultRoleId, form.role_id]);

  const mutation = useMutation({
    mutationFn: async (data: MemberInsert): Promise<SaveResult> => {
      // E-mail em branco: na edição, mantém o atual (o fictício, se for o caso);
      // no cadastro, gera um fictício, porque o Auth exige e-mail.
      let email: string | undefined = data.email?.trim() || undefined;

      if (!email) {
        if (isEditing && member?.email?.endsWith(FAKE_EMAIL_DOMAIN)) {
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
          email = `${normalizedName}_${hash}${FAKE_EMAIL_DOMAIN}`;
        }
      }

      // Só os campos que o usuário vê e pode editar (lista branca). O banco
      // também ignora os dados sensíveis enviados por quem não os vê.
      const payload = toMemberWritePayload(
        { ...data, email },
        { sensitiveVisible: canViewSensitive, canEditMinistry, includeRole: !isEditing || canAssignRole },
      );

      if (!isEditing) {
        const finalPassword = password || "123456";
        const { data: result, error } = await supabase.functions.invoke('create-user-admin', {
          body: {
            email: payload.email,
            password: finalPassword,
            memberData: payload,
          }
        });
        if (error) {
          // Respostas 4xx/5xx da função trazem a mensagem em { error }.
          const detail = await error.context?.json?.().catch(() => null);
          throw new Error(detail?.error ?? error.message);
        }
        if (result.error) throw new Error(result.error);
        return "saved";
      }

      // Só o id de volta: pedir coluna sensível no RETURNING dá 42501 (E1.08, PR 5).
      // Sem linha, o cadastro não existe mais ou foi excluído (DT-19).
      const { data: saved, error } = await supabase.from("members").update(payload).eq("id", member.id).select("id");
      if (error) throw error;
      return saved?.length ? "saved" : "gone";
    },
    onSuccess: (result) => {
      if (result === "gone") {
        setDeletedWhileEditing(true);
        // A lista recarrega já: "Fechar", "Cancelar", o X e o Esc voltam para ela sem o cadastro.
        queryClient.invalidateQueries({ queryKey: ["members", "list"] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast({ title: isEditing ? "Membro atualizado com sucesso" : "Membro criado com sucesso" });
      onClose();
    },
    onError: (error: Error) => {
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

  const update = (field: keyof MemberInsert, value: string | boolean | null) => {
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
    } catch (err) {
      toast({ variant: "destructive", title: "Erro", description: err instanceof Error ? err.message : String(err) });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleMaskedChange = (field: keyof MemberInsert, value: string, maskFn: (v: string) => string) => {
    update(field, maskFn(value));
  };

  const isFakeEmail = form.email?.endsWith(FAKE_EMAIL_DOMAIN);

  /** "Fechar" do aviso de cadastro excluído: volta para a lista, recarregada. */
  const closeDeleted = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {deletedWhileEditing && (
        <Alert ref={deletedAlertRef} tabIndex={-1} variant="destructive" className="focus:outline-none">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3 text-foreground">
            <p>{MEMBER_DELETION_TEXTS.deletedWhileEditing}</p>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={closeDeleted}>
              {DELETION_TEXTS.close}
            </Button>
          </AlertDescription>
        </Alert>
      )}

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
              <SelectTrigger id="gender"><SelectValue placeholder="Selecione" /></SelectTrigger>
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
          {canEditMinistry && (
            <div className="space-y-2">
              <Label htmlFor="spouse">Cônjuge</Label>
              <AsyncMemberSelect
                inputId="spouse"
                value={form.spouse_id || null}
                onChange={(v) => update("spouse_id", v)}
                excludeId={member?.id}
                placeholder="Buscar cônjuge…"
              />
            </div>
          )}
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

      {canEditMinistry && (
        <>
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
                    inputId="leader"
                    focusRef={leaderSelectRef}
                    value={form.leader_id || null}
                    onChange={(v) => update("leader_id", v)}
                    excludeId={member?.id}
                    placeholder="Buscar líder…"
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
        </>
      )}

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
                  <SelectTrigger id="state"><SelectValue placeholder="UF" /></SelectTrigger>
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
          <RoleField
            roles={roles}
            loadError={rolesError}
            value={form.role_id}
            canAssign={canAssignRole}
            onChange={(v) => update("role_id", v)}
          />
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
        <Button type="submit" disabled={mutation.isPending || deletedWhileEditing}>
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
