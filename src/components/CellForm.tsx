import { useState, useEffect, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSlowPending } from "@/hooks/use-slow-pending";
import { useMemberAddress } from "@/hooks/use-member-address";
import { Database } from "@/integrations/supabase/types";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";
import type { PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { applyHostAddress } from "@/lib/cells/host-address";
import type { CellRow } from "@/lib/cells/fields";
import { WEEKDAYS } from "@/lib/cells/weekdays";
import { CELL_DELETION_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";
import { requestSessionCheck } from "@/lib/auth/session-check";
import { useAuth } from "@/contexts/AuthContext";
import { refreshAccess } from "@/hooks/use-access";
import { memberSearchEmptyLabel, peopleLimitedToMinistry } from "@/lib/access/access";
import { cellRefusalFromError, type CellFormRefusal, type CellPersonField } from "@/lib/access/cell-form";
import { CELL_FORM_TEXTS } from "@/lib/access/texts";
import { SAVE_TEXTS } from "@/lib/hierarchy/texts";
import { isRecalcFailure } from "@/lib/errors";
import { refreshAfterCellWrite } from "@/lib/query-refresh";
import { describedBy } from "@/lib/a11y";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";

type CellInsert = Database["public"]["Tables"]["cells"]["Insert"];
type CellField = keyof CellInsert;

/** "gone": a edição não voltou com a linha, porque a célula foi excluída no meio tempo (E2.01, DT-19). */
type SaveResult = "saved" | "gone";

interface CellFormProps {
  /** Célula em edição: a linha da cells_view. */
  cell: CellRow | null;
  onClose: () => void;
  /**
   * A gravação começou ou terminou. Quem abre o diálogo não o deixa fechar
   * durante o envio ("✕", `Esc` e o toque fora; E2.06, T5 e P44).
   */
  onPendingChange?: (pending: boolean) => void;
}

const BRAZILIAN_STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

const CELL_TYPES = [
  { value: "Evangelística", label: "Evangelística" },
  { value: "Discipulado", label: "Discipulado" },
  { value: "Macrocélula", label: "Macrocélula" }
];

const DEFAULT_FORM: CellInsert = {
  leader_id: "",
  timothy_id: null,
  host_id: null,
  type: "Evangelística",
  meeting_day: "Sábado",
  meeting_time: "19:00",
  street: "",
  number: "",
  complement: "",
  neighborhood: "",
  city: "",
  state: "",
  zip_code: "",
  is_active: true,
};

const toCellInsertPayload = (value: Partial<CellInsert>): CellInsert => ({
  leader_id: value.leader_id ?? "",
  timothy_id: value.timothy_id ?? null,
  host_id: value.host_id ?? null,
  type: value.type ?? "Evangelística",
  meeting_day: value.meeting_day ?? "Sábado",
  meeting_time: value.meeting_time ?? "19:00",
  street: value.street ?? "",
  number: value.number ?? "",
  complement: value.complement ?? "",
  neighborhood: value.neighborhood ?? "",
  city: value.city ?? "",
  state: value.state ?? "",
  zip_code: value.zip_code ?? "",
  is_active: value.is_active ?? true,
});

const CellForm = ({ cell, onClose, onPendingChange }: CellFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!cell;
  const { access } = useAuth();
  // Quem vê só o ministério escolhe as três pessoas entre as do ministério (T7, P11).
  const showPeopleHint = peopleLimitedToMinistry(access);
  const searchEmptyLabel = memberSearchEmptyLabel(access);

  // A célula entra já na montagem (o diálogo monta o formulário a cada
  // abertura): o seletor guarda o valor de abertura para mostrar o nome salvo
  // (`savedLabel`, DT-23), e um valor preenchido depois, num efeito, cairia na
  // `member_names`, que não resolve quem está fora do escopo (UX-20).
  const [form, setForm] = useState<CellInsert>(() => (cell ? toCellInsertPayload(cell) : DEFAULT_FORM));
  // A célula foi excluída (ou saiu do escopo) enquanto era editada.
  const [deletedWhileEditing, setDeletedWhileEditing] = useState(false);
  const deletedAlertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (deletedWhileEditing) deletedAlertRef.current?.focus();
  }, [deletedWhileEditing]);

  // Recusas do servidor (T11, UX-22): no topo, com o foco e rolando até ele, ou embaixo do campo.
  const [topRefusal, setTopRefusal] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ field: CellPersonField; message: string } | null>(null);
  const refusalAlertRef = useRef<HTMLDivElement>(null);
  const leaderSelectRef = useRef<PaginatedSelectHandle>(null);
  const timothySelectRef = useRef<PaginatedSelectHandle>(null);
  const hostSelectRef = useRef<PaginatedSelectHandle>(null);

  // O erro embaixo do campo leva o foco a ele.
  useEffect(() => {
    const refs = { leader_id: leaderSelectRef, timothy_id: timothySelectRef, host_id: hostSelectRef };
    if (fieldError) refs[fieldError.field].current?.focus();
  }, [fieldError]);

  useEffect(() => {
    if (!topRefusal) return;
    refusalAlertRef.current?.focus();
    refusalAlertRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [topRefusal]);

  const showRefusal = (refusal: CellFormRefusal) => {
    if (refusal.rereadAccess) void refreshAccess(queryClient);
    if (refusal.field) {
      setTopRefusal(null);
      setFieldError({ field: refusal.field, message: refusal.message });
    } else {
      setFieldError(null);
      setTopRefusal(refusal.message);
    }
  };

  // Falha sem recusa (recálculo da hierarquia, falha transitória ou técnica):
  // num `Alert` acima dos botões, com os dados mantidos e o foco no botão
  // primário, que serve de "Tentar de novo" (E2.06, T5 e RN-08).
  const [saveFailure, setSaveFailure] = useState<string | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  const errorFor = (field: CellPersonField) => (fieldError?.field === field ? fieldError.message : null);

  // Endereço do anfitrião: carregado no cadastro e quando o anfitrião muda na
  // edição. Vem da members_view, que mascara rua, número e CEP para quem não
  // pode vê-los.
  const hostToLoad = form.host_id && (!isEditing || form.host_id !== cell?.host_id) ? form.host_id : null;
  const { data: hostAddress, isError: hostAddressError } = useMemberAddress(hostToLoad);

  useEffect(() => {
    if (!hostAddress) return;
    setForm((prev) => applyHostAddress(prev, hostAddress));
    if (hostAddress.sensitive_visible) {
      toast({ title: "Endereço carregado", description: "O endereço foi preenchido com os dados do anfitrião." });
    } else {
      toast({
        title: "Endereço carregado em parte",
        description: "Rua, número e CEP do anfitrião indisponíveis.",
      });
    }
  }, [hostAddress, toast]);

  useEffect(() => {
    if (hostAddressError) {
      toast({ variant: "destructive", title: "Não foi possível carregar o endereço do anfitrião" });
    }
  }, [hostAddressError, toast]);

  const mutation = useMutation({
    mutationFn: async (data: CellInsert): Promise<SaveResult> => {
      const payload = toCellInsertPayload(data);
      if (isEditing && cell) {
        // Sem linha de volta, a célula não existe mais ou foi excluída (DT-19).
        const { data: saved, error } = await supabase.from("cells").update(payload).eq("id", cell.id).select("id");
        if (error) throw error;
        return saved?.length ? "saved" : "gone";
      }
      const { error } = await supabase.from("cells").insert(payload).select("id");
      if (error) throw error;
      return "saved";
    },
    onSuccess: (result) => {
      if (result === "gone") {
        setDeletedWhileEditing(true);
        // "0 linhas" também é o que um membro excluído recebe (RN-14): confere a própria sessão.
        requestSessionCheck();
        // A lista recarrega já: "Fechar", "Cancelar", o X e o Esc voltam para ela sem a célula.
        queryClient.invalidateQueries({ queryKey: ["cells", "list"] });
        return;
      }
      // Células, Relatórios, Membros, Ministérios e o Dashboard sem os valores de antes (P44).
      void refreshAfterCellWrite(queryClient);
      toast({ title: isEditing ? "Célula atualizada" : "Célula criada" });
      onClose();
    },
    onError: (error) => {
      // As recusas ficam no formulário, com os dados (T11). O resto, também no
      // formulário e nunca com o texto técnico (E2.06, T5 e UX-19).
      const refusal = isRecalcFailure(error) ? null : cellRefusalFromError(error);
      if (refusal) showRefusal(refusal);
      else setSaveFailure(SAVE_TEXTS.recalcFailed);
    },
  });

  const saving = mutation.isPending;
  const slowSaving = useSlowPending(saving);

  useEffect(() => {
    onPendingChange?.(saving);
  }, [saving, onPendingChange]);

  // Depois da falha, o foco volta ao botão primário, já habilitado.
  useEffect(() => {
    if (saveFailure && !saving) primaryRef.current?.focus();
  }, [saveFailure, saving]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTopRefusal(null);
    setFieldError(null);
    setSaveFailure(null);
    if (!form.leader_id) {
      toast({ variant: "destructive", title: "Erro", description: "O Líder é obrigatório." });
      return;
    }
    // Já no envio, e não só no efeito: o host para de aceitar o fechamento antes do próximo quadro.
    onPendingChange?.(true);
    mutation.mutate(form);
  };

  const update = <F extends CellField>(field: F, value: CellInsert[F]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldError?.field === field) setFieldError(null);
  };

  /** "Fechar" do aviso de célula excluída: volta para a lista, recarregada. */
  const closeDeleted = () => {
    queryClient.invalidateQueries({ queryKey: ["cells"] });
    onClose();
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {deletedWhileEditing && (
        <Alert ref={deletedAlertRef} tabIndex={-1} variant="destructive" className="focus:outline-none">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="space-y-3 text-foreground">
            <p>{CELL_DELETION_TEXTS.deletedWhileEditing}</p>
            <Button type="button" variant="outline" className="h-11 md:h-9" onClick={closeDeleted}>
              {DELETION_TEXTS.close}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {topRefusal && (
        <Alert ref={refusalAlertRef} tabIndex={-1} variant="destructive" className="focus:outline-none">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="text-foreground">{topRefusal}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Dica única, acima dos três campos de pessoa, e ligada a cada um (T7, P11). */}
        {showPeopleHint && (
          <div className="md:col-span-2">
            <FieldHint id="cell-people-hint">{CELL_FORM_TEXTS.peopleHint}</FieldHint>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="leader_id">Líder *</Label>
          <AsyncMemberSelect
            inputId="leader_id"
            focusRef={leaderSelectRef}
            value={form.leader_id}
            onChange={(v) => update("leader_id", v || "")}
            placeholder="Buscar líder…"
            savedLabel={cell?.leader_name}
            noResultsLabel={searchEmptyLabel}
            aria-describedby={describedBy(errorFor("leader_id") && "leader_id-error", showPeopleHint && "cell-people-hint")}
          />
          {fieldError?.field === "leader_id" && <FieldError id="leader_id-error">{fieldError.message}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="timothy_id">Timóteo (Auxiliar)</Label>
          <AsyncMemberSelect
            inputId="timothy_id"
            focusRef={timothySelectRef}
            value={form.timothy_id || null}
            onChange={(v) => update("timothy_id", v)}
            placeholder="Buscar timóteo…"
            savedLabel={cell?.timothy_name}
            noResultsLabel={searchEmptyLabel}
            aria-describedby={describedBy(errorFor("timothy_id") && "timothy_id-error", showPeopleHint && "cell-people-hint")}
          />
          {fieldError?.field === "timothy_id" && <FieldError id="timothy_id-error">{fieldError.message}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="host_id">Anfitrião</Label>
          <AsyncMemberSelect
            inputId="host_id"
            focusRef={hostSelectRef}
            value={form.host_id || null}
            onChange={(v) => update("host_id", v)}
            placeholder="Buscar anfitrião…"
            savedLabel={cell?.host_name}
            noResultsLabel={searchEmptyLabel}
            aria-describedby={describedBy(errorFor("host_id") && "host_id-error", showPeopleHint && "cell-people-hint")}
          />
          {fieldError?.field === "host_id" && <FieldError id="host_id-error">{fieldError.message}</FieldError>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Tipo</Label>
          <Select value={form.type || ""} onValueChange={(v) => update("type", v)}>
            <SelectTrigger id="type"><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
            <SelectContent>
              {CELL_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="day">Dia da Semana</Label>
          <Select value={form.meeting_day || ""} onValueChange={(v) => update("meeting_day", v)}>
            <SelectTrigger id="day"><SelectValue placeholder="Selecione o dia" /></SelectTrigger>
            <SelectContent>
              {WEEKDAYS.map(d => (
                <SelectItem key={d} value={d}>{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="time">Horário</Label>
          <Input 
            id="time" 
            type="time" 
            value={form.meeting_time || ""} 
            onChange={(e) => update("meeting_time", e.target.value)} 
          />
        </div>

        <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
          <Label htmlFor="is_active">Célula Ativa</Label>
          <Switch 
            id="is_active" 
            checked={form.is_active !== false} 
            onCheckedChange={(v) => update("is_active", v)} 
          />
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="text-lg font-semibold mb-3">Endereço da Célula</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {saveFailure && (
        <Alert role="alert" variant="destructive">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <AlertDescription className="text-foreground">{saveFailure}</AlertDescription>
        </Alert>
      )}

      {slowSaving && (
        <p role="status" className="text-sm text-muted-foreground">
          {SAVE_TEXTS.stillSaving}
        </p>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
          Cancelar
        </Button>
        <Button ref={primaryRef} type="submit" disabled={saving || deletedWhileEditing}>
          {saving ? "Salvando..." : isEditing ? "Salvar" : "Criar Célula"}
        </Button>
      </div>
    </form>
  );
};

export default CellForm;
