import { useState, useEffect, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Database } from "@/integrations/supabase/types";
import AsyncMemberSelect from "@/components/AsyncMemberSelect";

type Cell = Database["public"]["Tables"]["cells"]["Row"];
type CellInsert = Database["public"]["Tables"]["cells"]["Insert"];

interface CellFormProps {
  cell: Cell | null;
  onClose: () => void;
}

const BRAZILIAN_STATES = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO"
];

const DAYS_OF_WEEK = [
  "Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"
];

const CELL_TYPES = [
  { value: "Evangelística", label: "Evangelística" },
  { value: "Discipulado", label: "Discipulado" },
  { value: "Macrocélula", label: "Macrocélula" }
];

const CellForm = ({ cell, onClose }: CellFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEditing = !!cell;
  
  const [form, setForm] = useState<CellInsert>({
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
  });

  useEffect(() => {
    if (cell) {
      setForm({ ...cell });
    }
  }, [cell]);

  // Auto-load address from Host
  useEffect(() => {
    const loadHostAddress = async () => {
      if (form.host_id) {
        const { data: host } = await supabase
          .from("members")
          .select("street, number, complement, neighborhood, city, state, zip_code")
          .eq("id", form.host_id)
          .maybeSingle();

        if (host) {
          setForm(prev => ({
            ...prev,
            street: host.street || prev.street,
            number: host.number || prev.number,
            complement: host.complement || prev.complement,
            neighborhood: host.neighborhood || prev.neighborhood,
            city: host.city || prev.city,
            state: host.state || prev.state,
            zip_code: host.zip_code || prev.zip_code,
          }));
          
          toast({ 
            title: "Endereço carregado", 
            description: "O endereço foi preenchido com os dados do anfitrião." 
          });
        }
      }
    };

    // Only auto-load if we are creating or if the user just changed the host
    if (form.host_id && (!isEditing || form.host_id !== cell?.host_id)) {
      loadHostAddress();
    }
  }, [form.host_id, isEditing, cell?.host_id, toast]);

  const mutation = useMutation({
    mutationFn: async (data: CellInsert) => {
      if (isEditing && cell) {
        const { error } = await supabase.from("cells").update(data).eq("id", cell.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("cells").insert(data);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cells"] });
      toast({ title: isEditing ? "Célula atualizada" : "Célula criada" });
      onClose();
    },
    onError: (error: any) => {
      toast({ variant: "destructive", title: "Erro", description: error.message });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.leader_id) {
      toast({ variant: "destructive", title: "Erro", description: "O Líder é obrigatório." });
      return;
    }
    mutation.mutate(form);
  };

  const update = (field: keyof CellInsert, value: any) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div className="space-y-2">
          <Label>Líder *</Label>
          <AsyncMemberSelect
            value={form.leader_id}
            onChange={(v) => update("leader_id", v || "")}
            placeholder="Buscar líder..."
          />
        </div>

        <div className="space-y-2">
          <Label>Timóteo (Auxiliar)</Label>
          <AsyncMemberSelect
            value={form.timothy_id || null}
            onChange={(v) => update("timothy_id", v)}
            placeholder="Buscar timóteo..."
          />
        </div>

        <div className="space-y-2">
          <Label>Anfitrião</Label>
          <AsyncMemberSelect
            value={form.host_id || null}
            onChange={(v) => update("host_id", v)}
            placeholder="Buscar anfitrião..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="type">Tipo</Label>
          <Select value={form.type || ""} onValueChange={(v) => update("type", v)}>
            <SelectTrigger><SelectValue placeholder="Selecione o tipo" /></SelectTrigger>
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
            <SelectTrigger><SelectValue placeholder="Selecione o dia" /></SelectTrigger>
            <SelectContent>
              {DAYS_OF_WEEK.map(d => (
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

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Salvando..." : isEditing ? "Salvar" : "Criar Célula"}
        </Button>
      </div>
    </form>
  );
};

export default CellForm;
