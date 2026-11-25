import { useState, useEffect, useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, CheckCircle2, Info, Key } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import type { PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { toMemberWritePayload, type MemberRow } from "@/lib/members/fields";
import DeletedMatchesDialog, { type RestoredFromWarning } from "@/components/DeletedMatchesDialog";
import { DELETED_MATCHES_TEXTS, DELETION_TEXTS, MEMBER_DELETION_TEXTS } from "@/lib/deletion/texts";
import { memberRestoreNotices } from "@/lib/deletion/restore";
import { readFunctionErrorBody, isJsonObject, isNetworkError } from "@/lib/errors";
import { requestSessionCheck } from "@/lib/auth/session-check";
import { memberSearchEmptyLabel } from "@/lib/access/access";
import { GENDER_LABELS, genderLabel } from "@/lib/members/gender";
import { MEMBER_FORM_TEXTS, OWN_DATA_TEXTS } from "@/lib/access/texts";
import {
  initialLeaderId,
  isLeaderMissing,
  leadershipValues,
  memberRefusalFromCreate,
  memberRefusalFromError,
  memberSaveFailureMessage,
  ministryFieldsView,
  needsRoleOptions,
  roleFieldView,
  type MemberFormField,
  type MemberFormRefusal,
} from "@/lib/access/member-form";
import { ROLE_OPTIONS_QUERY_KEY, useRoleOptions } from "@/hooks/use-role-options";
import { refreshAccess } from "@/hooks/use-access";
import { MemberRoleField } from "@/components/members/MemberRoleField";
import { MemberMinistryFields } from "@/components/members/MemberMinistryFields";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import { describedBy } from "@/lib/a11y";
import {
  deletedMatchesWarning,
  parseCreateMemberRefusal,
  type DeletedMatchesDialogModel,
  type DeletedMatchesWarning,
} from "@/lib/members/deleted-matches";

type Member = MemberRow;
type MemberInsert = Database["public"]["Tables"]["members"]["Insert"];

/**
 * - "gone": a edição não voltou com a linha, porque o cadastro foi excluído no meio tempo (E2.01, DT-19);
 * - "deletedMatches": o cadastro novo tem dados de um membro excluído (E2.01, RN-18);
 * - "refused": a `create-user-admin` recusou pelas regras de escopo ou de função (E2.02, T11).
 */
type SaveResult =
  | { kind: "saved" }
  | { kind: "gone" }
  | { kind: "deletedMatches"; warning: DeletedMatchesWarning }
  /** Recusa de regra ou de permissão da `create-user-admin` (T11). */
  | { kind: "refused"; refusal: MemberFormRefusal }
  /** Falha da `create-user-admin` sem regra (`unauthenticated`, `server_error`…): a mensagem pronta dela, no toast. */
  | { kind: "failed"; message: string };

interface SaveInput {
  data: MemberInsert;
  /** "Cadastrar mesmo assim" (RN-18): segue apesar dos cadastros excluídos com os mesmos dados. */
  confirmDeletedMatches: boolean;
}

interface MemberFormProps {
  member: Member | null;
  onClose: () => void;
  /**
   * "Definir líder" depois de restaurar um cadastro sem líder (E2.01, T5 e
   * UX-22): abre com "Tem Liderança?" ligado e o foco no campo Líder.
   */
  defineLeader?: boolean;
  /**
   * Cadastro novo com dados de um excluído (E2.01, RN-18): o administrador
   * restaurou o excluído pelo aviso, e a tela passa a editá-lo (UX-32).
   */
  onRestored?: (restored: RestoredFromWarning) => void;
  /** Aberto logo depois de restaurar pelo aviso: o `Alert` de restauração, com o foco (UX-32). */
  restoredFrom?: RestoredFromWarning;
  /**
   * "Meus dados" só para leitura (E2.02, UXD-13 e UX-09): para quem não tem
   * "Editar Próprio Cadastro" nem "Editar Membro". Os campos ficam `readOnly`
   * (focáveis e lidos pelo leitor de tela), sem "Salvar", com o aviso no topo
   * e só "Fechar" no rodapé.
   */
  readOnly?: boolean;
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

const MemberForm = ({ member, onClose, defineLeader = false, onRestored, restoredFrom, readOnly = false }: MemberFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission, access, member: ownMember } = useAuth();
  const isEditing = !!member;
  const [cepLoading, setCepLoading] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Na edição, a members_view diz se os dados sensíveis deste membro estão
  // visíveis (o próprio cadastro ou view_sensitive_data). No cadastro, quem
  // tem create_member preenche todos os campos (E1.08, RN-11 e RN-12).
  const canViewSensitive = !isEditing || member?.sensitive_visible === true;
  const canChangePassword = !readOnly && hasPermission("change_member_password");
  // Os dados ministeriais: "Editar Membro" na edição e "Criar Membro" no
  // cadastro, que exige o líder de quem vê só o ministério (RN-10).
  const canEditMinistry = !readOnly && hasPermission(isEditing ? "edit_member" : "create_member");
  // Quem vê o nome e restaura os cadastros excluídos do aviso (RN-15, RN-18).
  const isAdmin = hasPermission("manage_roles");

  // Restaurado pelo aviso (UX-32): as mensagens da RN-16 e, se voltou sem líder, o foco no Líder.
  const restoredNotices = restoredFrom ? memberRestoreNotices(restoredFrom.outcome) : null;
  const focusLeader = defineLeader || (restoredNotices?.withoutLeader === true && canEditMinistry);

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

  // Campo Função (RN-18, UXD-12): a própria função vem do acesso; a de outra
  // pessoa e as opções, de `role_options`. Nunca a `role_id` da linha do membro.
  const isSelf = isEditing && !!access?.member_id && member.id === access.member_id;
  const roleInput = {
    isNew: !isEditing,
    isSelf: readOnly || isSelf,
    canAssignRoles: !readOnly && access?.can_assign_roles === true,
    ownRoleName: access?.role_name ?? null,
  };
  const roleOptions = useRoleOptions(member?.id ?? null, { enabled: !readOnly && needsRoleOptions(roleInput) });
  const roleView = roleFieldView({ ...roleInput, options: roleOptions.data });
  // `undefined` até a pessoa escolher: vale a inicial que veio de `role_options`.
  const [roleChoice, setRoleChoice] = useState<string | undefined>(undefined);
  const roleValue = roleView.kind === "select" ? (roleChoice ?? roleView.initialValue) : null;
  // O cadastro novo espera as opções: sem elas, quem atribui funções criaria o membro sem função.
  const awaitingRoleOptions = !isEditing && roleView.kind === "pending" && !roleOptions.isError;

  // Pastor, sem liderança e Líder (RN-10, UXD-1, UXD-3).
  // Recalculado a cada acesso relido (P13); o cadastro de referência é o da abertura.
  const ministryView = ministryFieldsView({
    seesWholeChurch: access?.sees_whole_church === true,
    isNew: !isEditing,
    saved: member,
  });
  const searchEmptyLabel = memberSearchEmptyLabel(access);

  // Os dados do membro entram já na montagem (o diálogo monta o formulário a
  // cada abertura; quem trocar de membro sem desmontar precisa passar `key`).
  // Preenchidos depois, num efeito, mudariam o valor dos Selects quando as
  // opções ainda não existem, e o Radix apagaria o valor.
  const [form, setForm] = useState<MemberInsert>(() => {
    if (!member) {
      const leaderId = canEditMinistry ? initialLeaderId(ministryView, true, access?.member_id ?? null) : null;
      return leaderId ? { ...EMPTY_FORM, leader_id: leaderId, has_leadership: true } : EMPTY_FORM;
    }
    return focusLeader ? { ...member, has_leadership: true } : { ...member };
  });

  // O acesso chegou depois de o cadastro novo abrir (AQ-1): preenche o Líder uma vez, se ainda vazio.
  const leaderPrefilled = useRef(!!form.leader_id);
  const viewerMemberId = access?.member_id ?? null;
  const prefillLeaderId = !isEditing && canEditMinistry ? initialLeaderId(ministryView, true, viewerMemberId) : null;
  useEffect(() => {
    if (leaderPrefilled.current || !prefillLeaderId) return;
    leaderPrefilled.current = true;
    setForm((prev) => (prev.leader_id ? prev : { ...prev, leader_id: prefillLeaderId, has_leadership: true }));
  }, [prefillLeaderId]);

  // "Definir líder": o foco vai para o campo Líder, que já abre visível.
  const leaderSelectRef = useRef<PaginatedSelectHandle>(null);
  const restoredAlertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusLeader) leaderSelectRef.current?.focus();
    else if (restoredFrom) restoredAlertRef.current?.focus();
  }, [focusLeader, restoredFrom]);

  // RN-18: o aviso de cadastro excluído com os mesmos dados, ou o erro no campo E-mail (UXD-9).
  const [deletedMatches, setDeletedMatches] = useState<DeletedMatchesDialogModel | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!emailError) return;
    // Depois do foco que o Radix devolve ao fechar o aviso, se ele estava aberto.
    const timer = window.setTimeout(() => emailInputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [emailError]);

  const [password, setPassword] = useState("");
  // Identifica o cadastro na `create-user-admin` (E2.04, DT-11): um por abertura
  // do formulário, o mesmo em cada nova tentativa e no "Cadastrar mesmo assim".
  // A repetição devolve o cadastro já criado, sem duplicar.
  const [attemptId] = useState(() => crypto.randomUUID());
  // O cadastro foi excluído (ou saiu do escopo) enquanto era editado.
  const [deletedWhileEditing, setDeletedWhileEditing] = useState(false);
  const deletedAlertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (deletedWhileEditing) deletedAlertRef.current?.focus();
  }, [deletedWhileEditing]);

  // Recusas (T11, UX-22): no `Alert` do topo, com o foco e a rolagem até ele,
  // ou embaixo do campo que o servidor apontou. A validação do Líder (UX-17) e
  // a da Função usam o mesmo lugar.
  const [topRefusal, setTopRefusal] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: MemberFormField; message: string } | null>(null);
  const refusalAlertRef = useRef<HTMLDivElement>(null);
  const spouseSelectRef = useRef<PaginatedSelectHandle>(null);
  const roleTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!topRefusal) return;
    refusalAlertRef.current?.focus();
    refusalAlertRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [topRefusal]);

  useEffect(() => {
    if (fieldError?.field === "leader_id") leaderSelectRef.current?.focus();
    else if (fieldError?.field === "spouse_id") spouseSelectRef.current?.focus();
    else if (fieldError?.field === "role_id") roleTriggerRef.current?.focus();
  }, [fieldError]);

  // O campo apontado precisa estar na tela; senão, a recusa vai para o topo.
  const isFieldShown = (field: MemberFormField): boolean => {
    // Com a Função em texto não há campo para focar: a recusa vai para o topo.
    if (field === "role_id") return roleView.kind === "select";
    if (!canEditMinistry) return false;
    if (field === "spouse_id") return true;
    return ministryView.leader === "toggle" ? form.has_leadership === true : ministryView.leader !== "hidden";
  };

  const showRefusal = (refusal: MemberFormRefusal) => {
    if (refusal.rereadAccess) void refreshAccess(queryClient);
    if (refusal.field && isFieldShown(refusal.field)) {
      setTopRefusal(null);
      setFieldError({ field: refusal.field, message: refusal.message });
    } else {
      setFieldError(null);
      setTopRefusal(refusal.message);
    }
  };

  const errorFor = (field: MemberFormField): string | null => (fieldError?.field === field ? fieldError.message : null);

  const mutation = useMutation({
    mutationFn: async ({ data, confirmDeletedMatches }: SaveInput): Promise<SaveResult> => {
      // Só os campos que o usuário vê e pode editar (lista branca). O banco
      // também ignora os dados sensíveis enviados por quem não os vê. Texto
      // vazio vai como `null`, inclusive o e-mail: o cadastro guarda só o
      // e-mail real (E2.04, DA-1 e RN-05), e o da conta é gerado pelo servidor.
      const leadership = canEditMinistry ? leadershipValues(ministryView, data) : {};
      const payload = toMemberWritePayload(
        { ...data, ...leadership, role_id: roleValue },
        { sensitiveVisible: canViewSensitive, canEditMinistry, includeRole: roleView.kind === "select" },
      );

      if (!isEditing) {
        const finalPassword = password || "123456";
        const { data: result, error } = await supabase.functions.invoke('create-user-admin', {
          body: {
            attemptId,
            password: finalPassword,
            memberData: payload,
            confirmDeletedMatches,
          }
        });
        if (error) {
          // Respostas 4xx/5xx da função trazem a mensagem em { error }.
          const refusal = parseCreateMemberRefusal(await readFunctionErrorBody(error));
          if (refusal?.kind === "deletedMatches") {
            return {
              kind: "deletedMatches",
              warning: deletedMatchesWarning(refusal.matches, { isAdmin, accountEmail: refusal.accountEmail }),
            };
          }
          const formRefusal = refusal ? memberRefusalFromCreate(refusal) : null;
          if (formRefusal) return { kind: "refused", refusal: formRefusal };
          if (refusal) return { kind: "failed", message: refusal.message };
          // Sem corpo legível (queda de conexão, resposta fora do formato): o texto genérico.
          throw error;
        }
        if (isJsonObject(result) && typeof result.error === "string") return { kind: "failed", message: result.error };
        // `replayed: true` (a mesma tentativa repetida) também é sucesso: o cadastro existe.
        return { kind: "saved" };
      }

      // Só o id de volta: pedir coluna sensível no RETURNING dá 42501 (E1.08, PR 5).
      // Sem linha, o cadastro não existe mais, foi excluído ou saiu do que a
      // pessoa vê (DT-19, AQ-6): nunca um sucesso falso. O erro sobe para o
      // `MutationCache` (42501 relê o acesso e confere a sessão).
      const { data: saved, error } = await supabase.from("members").update(payload).eq("id", member.id).select("id");
      if (error) throw error;
      return saved?.length ? { kind: "saved" } : { kind: "gone" };
    },
    onSuccess: (result) => {
      if (result.kind === "deletedMatches") {
        if (result.warning.kind === "emailError") {
          setDeletedMatches(null);
          setEmailError(result.warning.message);
        } else {
          setDeletedMatches(result.warning.dialog);
        }
        return;
      }
      if (result.kind === "refused") {
        showRefusal(result.refusal);
        return;
      }
      if (result.kind === "failed") {
        toast({ variant: "destructive", title: "Erro", description: result.message });
        return;
      }
      if (result.kind === "gone") {
        setDeletedWhileEditing(true);
        // "0 linhas" também é o que um membro excluído recebe (RN-14): confere a própria sessão.
        requestSessionCheck();
        // A lista recarrega já: "Fechar", "Cancelar", o X e o Esc voltam para ela sem o cadastro.
        queryClient.invalidateQueries({ queryKey: ["members", "list"] });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ROLE_OPTIONS_QUERY_KEY });
      toast({ title: isEditing ? "Membro atualizado com sucesso" : "Membro criado com sucesso" });
      onClose();
    },
    onError: (error: unknown) => {
      const refusal = memberRefusalFromError(error);
      if (refusal) showRefusal(refusal);
      // Nunca o texto técnico (40P01, rede, erro inesperado): só "tente de novo".
      else toast({ variant: "destructive", title: "Erro", description: memberSaveFailureMessage(isNetworkError(error)) });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTopRefusal(null);
    // Validações que não vão ao servidor: o Líder obrigatório (UX-17) e a Função.
    if (canEditMinistry && isLeaderMissing(ministryView, form.leader_id)) {
      setFieldError({ field: "leader_id", message: MEMBER_FORM_TEXTS.leaderRequired });
      return;
    }
    if (roleView.kind === "select" && !roleValue) {
      setFieldError({ field: "role_id", message: MEMBER_FORM_TEXTS.roleRequired });
      return;
    }
    setFieldError(null);
    // O erro do e-mail some no reenvio; se voltar, o foco volta para o campo.
    setEmailError(null);
    mutation.mutate({ data: form, confirmDeletedMatches: false });
  };

  /** "Cadastrar mesmo assim" (RN-18, UX-34): o mesmo cadastro, sem nova pergunta. */
  const registerAnyway = () => {
    mutation.mutate({ data: form, confirmDeletedMatches: true });
  };

  /** "Restaurar {Nome}": a tela passa a editar o cadastro restaurado; nada do que foi digitado fica (UX-32). */
  const handleRestored = (restored: RestoredFromWarning) => {
    setDeletedMatches(null);
    if (onRestored) onRestored(restored);
    else onClose();
  };

  const update = (field: keyof MemberInsert, value: string | boolean | null) => {
    if (field === "email") setEmailError(null);
    if (fieldError?.field === field) setFieldError(null);
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

  /** "Fechar" do aviso de cadastro excluído: volta para a lista, recarregada. */
  const closeDeleted = () => {
    queryClient.invalidateQueries({ queryKey: ["members"] });
    onClose();
  };

  return (
    <form onSubmit={readOnly ? (event) => event.preventDefault() : handleSubmit} className="space-y-6">
      {readOnly && (
        <Alert>
          <Info className="h-4 w-4" aria-hidden="true" />
          <AlertDescription>{OWN_DATA_TEXTS.readOnlyNotice}</AlertDescription>
        </Alert>
      )}
      {restoredFrom && (
        <Alert ref={restoredAlertRef} role="status" tabIndex={-1} className="focus:outline-none">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-2">
            <p>{DELETED_MATCHES_TEXTS.restoredFromForm(restoredFrom.name)}</p>
            {restoredNotices?.messages.map((message) => (
              <p key={message}>{message}</p>
            ))}
          </AlertDescription>
        </Alert>
      )}

      {topRefusal && (
        <Alert ref={refusalAlertRef} tabIndex={-1} variant="destructive" className="focus:outline-none">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="text-foreground">{topRefusal}</AlertDescription>
        </Alert>
      )}

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
            <Input id="name" readOnly={readOnly} value={form.name} onChange={(e) => update("name", e.target.value)} required />
          </div>
          {canViewSensitive && (
            <div className="space-y-2">
              <Label htmlFor="email">
                E-mail {isEditing && !form.email && <span className="text-xs text-muted-foreground font-normal ml-2">(Não informado)</span>}
              </Label>
              <Input
                ref={emailInputRef}
                id="email"
                readOnly={readOnly}
                type="email"
                value={form.email || ""}
                onChange={(e) => update("email", e.target.value)}
                placeholder={isEditing && !form.email && !readOnly ? "Adicionar e-mail..." : ""}
                aria-invalid={emailError ? true : undefined}
                aria-describedby={emailError ? "email-error" : undefined}
                className={emailError ? "border-destructive" : undefined}
              />
              {emailError && (
                <p id="email-error" className="flex items-start gap-1.5 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{emailError}</span>
                </p>
              )}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="instagram">Instagram (@)</Label>
            <Input 
              id="instagram" 
              readOnly={readOnly}
              placeholder={readOnly ? undefined : "@usuario"} 
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
              <Input id="cpf" readOnly={readOnly} value={form.cpf || ""} onChange={(e) => handleMaskedChange("cpf", e.target.value, maskCPF)} placeholder={readOnly ? undefined : "000.000.000-00"} />
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
            {readOnly ? (
              <Input id="gender" readOnly value={genderLabel(form.gender)} />
            ) : (
              <Select value={form.gender || ""} onValueChange={(v) => update("gender", v)}>
                <SelectTrigger id="gender"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">{GENDER_LABELS.M}</SelectItem>
                  <SelectItem value="F">{GENDER_LABELS.F}</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="birth_date">Data de Nascimento</Label>
            <Input id="birth_date" readOnly={readOnly} type="date" value={form.birth_date || ""} onChange={(e) => update("birth_date", e.target.value)} />
          </div>
          {canEditMinistry && (
            <div className="space-y-2">
              <Label htmlFor="spouse">Cônjuge</Label>
              <AsyncMemberSelect
                inputId="spouse"
                focusRef={spouseSelectRef}
                value={form.spouse_id || null}
                onChange={(v) => update("spouse_id", v)}
                excludeId={member?.id}
                placeholder="Buscar cônjuge…"
                savedLabel={member?.spouse_name}
                noResultsLabel={searchEmptyLabel}
                aria-describedby={describedBy(errorFor("spouse_id") && "spouse-error", ministryView.spouseHint && "spouse-hint")}
              />
              {errorFor("spouse_id") && <FieldError id="spouse-error">{errorFor("spouse_id") ?? ""}</FieldError>}
              {ministryView.spouseHint && <FieldHint id="spouse-hint">{ministryView.spouseHint}</FieldHint>}
            </div>
          )}
          {canViewSensitive && (
            <>
              <div className="space-y-2">
                <Label htmlFor="mobile">Celular / WhatsApp</Label>
                <Input id="mobile" readOnly={readOnly} value={form.mobile_whatsapp || ""} onChange={(e) => handleMaskedChange("mobile_whatsapp", e.target.value, maskPhone)} placeholder={readOnly ? undefined : "(00)00000-0000"} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefone</Label>
                <Input id="phone" readOnly={readOnly} value={form.phone || ""} onChange={(e) => handleMaskedChange("phone", e.target.value, maskPhone)} placeholder={readOnly ? undefined : "(00)0000-0000"} />
              </div>
            </>
          )}
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Observações</Label>
            <Textarea id="notes" className="text-base md:text-sm" readOnly={readOnly} value={form.notes || ""} onChange={(e) => update("notes", e.target.value)} />
          </div>
        </div>
      </div>

      {canEditMinistry && (
        <>
          <Separator />

          <MemberMinistryFields
            view={ministryView}
            values={form}
            onChange={update}
            memberId={member?.id}
            leaderSavedLabel={isEditing ? member.leader_name : ownMember?.name}
            leaderRef={leaderSelectRef}
            leaderError={errorFor("leader_id")}
            noResultsLabel={searchEmptyLabel}
          />
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
                  readOnly={readOnly}
                  value={form.zip_code || ""}
                  onChange={(e) => {
                    const masked = maskCEP(e.target.value);
                    update("zip_code", masked);
                    if (masked.replace(/\D/g, "").length === 8) {
                      fetchAddressByCEP(masked);
                    }
                  }}
                  placeholder={readOnly ? undefined : "00000-000"}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="street">Rua</Label>
                <Input id="street" readOnly={readOnly} value={form.street || ""} onChange={(e) => update("street", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="number">Número</Label>
                <Input id="number" readOnly={readOnly} value={form.number || ""} onChange={(e) => update("number", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="complement">Complemento</Label>
                <Input id="complement" readOnly={readOnly} value={form.complement || ""} onChange={(e) => update("complement", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="neighborhood">Bairro</Label>
                <Input id="neighborhood" readOnly={readOnly} value={form.neighborhood || ""} onChange={(e) => update("neighborhood", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">Cidade</Label>
                <Input id="city" readOnly={readOnly} value={form.city || ""} onChange={(e) => update("city", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="state">Estado</Label>
                {readOnly ? (
                  <Input id="state" readOnly value={form.state || ""} />
                ) : (
                  <Select value={form.state || ""} onValueChange={(v) => update("state", v)}>
                    <SelectTrigger id="state"><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      {BRAZILIAN_STATES.map((s) => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Acesso: some sem Função (UXD-12) e sem "Alterar Senha". */}
      {(roleView.kind !== "hidden" || (isEditing && canChangePassword)) && (
        <>
          <Separator />
          <div>
            <h3 className="text-lg font-semibold mb-3">Acesso</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <MemberRoleField
                view={roleView}
                loadFailed={roleOptions.isError}
                value={roleValue}
                onChange={(roleId) => {
                  setRoleChoice(roleId);
                  if (fieldError?.field === "role_id") setFieldError(null);
                }}
                error={errorFor("role_id")}
                triggerRef={roleTriggerRef}
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
        </>
      )}

      <div className="flex justify-end gap-3 pt-4">
        {readOnly ? (
          <Button type="button" variant="outline" className="h-11 md:h-10" onClick={onClose}>
            {OWN_DATA_TEXTS.close}
          </Button>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending || deletedWhileEditing || awaitingRoleOptions}>
              {mutation.isPending ? "Salvando..." : isEditing ? "Salvar" : MEMBER_FORM_TEXTS.createMember}
            </Button>
          </>
        )}
      </div>

      {deletedMatches && (
        <DeletedMatchesDialog
          dialog={deletedMatches}
          registering={mutation.isPending}
          onRegisterAnyway={registerAnyway}
          onClose={() => setDeletedMatches(null)}
          onRestored={handleRestored}
        />
      )}

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
