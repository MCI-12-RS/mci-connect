import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useCellReportParticipants } from "@/hooks/use-cell-report-participants";
import { format, setDay, isFuture, subWeeks } from "date-fns";
import Select, { type GroupBase, type StylesConfig } from "react-select";
import AsyncSelect from "react-select/async";
import { CELL_SUMMARY_SELECT, type CellSummary } from "@/lib/cells/fields";
import { formatCellLabel } from "@/lib/cells/labels";
import { cellOfReport, type CellReportRow } from "@/lib/cell-reports/fields";
import { toSelectedParticipantOptions, type MemberOption } from "@/lib/cell-reports/participants";

const reportSchema = z.object({
  cell_id: z.string().min(1, "Selecione uma célula"),
  date: z.string().min(1, "Data é obrigatória"),
  time: z.string().min(1, "Horário é obrigatório"),
  was_held: z.boolean().default(true),
  reason_not_held: z.string().optional(),
  theme: z.string().optional(),
  observations: z.string().optional(),
  visitors: z.string().optional(),
  offering: z.number().min(0).default(0),
  participant_ids: z.array(z.string()).default([]),
});

type ReportFormValues = z.infer<typeof reportSchema>;

interface CellReportFormProps {
  /** Relatório em edição: a linha da cell_reports_view. */
  report?: CellReportRow | null;
  /** Célula já escolhida (botão "Novo Relatório" da tela de Células): a linha da cells_view. */
  initialCell?: CellSummary | null;
  onClose: () => void;
}

interface CellOption {
  value: string;
  label: string;
}

const DAYS_MAP: Record<string, number> = {
  "Domingo": 0,
  "Segunda": 1,
  "Terça": 2,
  "Quarta": 3,
  "Quinta": 4,
  "Sexta": 5,
  "Sábado": 6,
};

const calculateCellDate = (meetingDay: string) => {
  const dayIndex = DAYS_MAP[meetingDay] ?? 6;
  let d = setDay(new Date(), dayIndex, { weekStartsOn: 0 });
  if (isFuture(d)) {
    d = subWeeks(d, 1);
  }
  return format(d, "yyyy-MM-dd");
};

// Cores do tema nos seletores do react-select.
function selectStyles<Option, IsMulti extends boolean>(): StylesConfig<Option, IsMulti, GroupBase<Option>> {
  return {
    control: (base) => ({
      ...base,
      backgroundColor: "transparent",
      borderColor: "hsl(var(--input))",
      minHeight: "40px",
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: "hsl(var(--popover))",
      borderColor: "hsl(var(--border))",
      zIndex: 50,
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused ? "hsl(var(--accent))" : "transparent",
      color: state.isFocused ? "hsl(var(--accent-foreground))" : "hsl(var(--foreground))",
      cursor: "pointer",
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: "hsl(var(--secondary))",
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: "hsl(var(--secondary-foreground))",
    }),
  };
}

const cellSelectStyles = selectStyles<CellOption, false>();
const participantSelectStyles = selectStyles<MemberOption, true>();

const CellReportForm = ({ report, onClose, initialCell }: CellReportFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Células ativas visíveis para o seletor. O PR 4 (tarefa 9) troca por busca
  // e paginação no servidor.
  const { data: cells = [] } = useQuery({
    queryKey: ["cells", "active-summaries"],
    queryFn: async (): Promise<CellSummary[]> => {
      const { data, error } = await supabase.from("cells_view").select(CELL_SUMMARY_SELECT).eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  // A célula já conhecida: a da tela de Células ou a do relatório em edição.
  // Nos dois casos o seletor fica travado.
  const knownCell = initialCell ?? (report ? cellOfReport(report) : null);

  const loadCellOptions = async (input: string): Promise<CellOption[]> => {
    const term = (input || "").toLowerCase();
    return cells
      .map((c) => ({ value: c.id, label: formatCellLabel(c) }))
      .filter((option) => !term || option.label.toLowerCase().includes(term));
  };

  const { data: members = [] } = useQuery({
    queryKey: ["members-basic"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("members")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: {
      cell_id: report?.cell_id || initialCell?.id || "",
      date: report?.date || format(new Date(), "yyyy-MM-dd"),
      time: report?.time?.substring(0, 5) || "19:00",
      was_held: report ? report.was_held : true,
      reason_not_held: report?.reason_not_held || "",
      theme: report?.theme || "",
      observations: report?.observations || "",
      visitors: (report?.visitors || []).join(", "),
      offering: report?.offering || 0,
      participant_ids: [],
    },
  });

  // Na edição, os participantes salvos, com o nome.
  const { data: savedParticipants } = useCellReportParticipants(report?.id);

  useEffect(() => {
    if (savedParticipants) form.setValue("participant_ids", savedParticipants.map((p) => p.member_id));
  }, [savedParticipants, form]);

  const cellIdValue = form.watch("cell_id");
  const wasHeldValue = form.watch("was_held");

  // Novo relatório: dia e horário sugeridos pela célula escolhida.
  const suggestionCell = report ? null : (initialCell ?? cells.find((c) => c.id === cellIdValue) ?? null);
  const suggestedDay = suggestionCell?.meeting_day;
  const suggestedTime = suggestionCell?.meeting_time;

  useEffect(() => {
    if (suggestedDay) form.setValue("date", calculateCellDate(suggestedDay));
    if (suggestedTime) form.setValue("time", suggestedTime.substring(0, 5));
  }, [cellIdValue, suggestedDay, suggestedTime, form]);

  const saveMutation = useMutation({
    mutationFn: async (values: ReportFormValues) => {
      const visitorsArray = values.visitors
        ? values.visitors.split(",").map((v) => v.trim()).filter((v) => v.length > 0)
        : [];

      const reportData = {
        cell_id: values.cell_id,
        date: values.date,
        time: values.time,
        was_held: values.was_held,
        reason_not_held: values.was_held ? null : values.reason_not_held,
        theme: values.was_held ? values.theme : null,
        observations: values.was_held ? values.observations : null,
        visitors: values.was_held ? visitorsArray : [],
        offering: values.was_held ? values.offering : 0,
      };

      let newReportId = report?.id;

      if (report?.id) {
        const { error } = await supabase
          .from("cell_reports")
          .update(reportData)
          .eq("id", report.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("cell_reports")
          .insert([reportData])
          .select("id")
          .single();
        if (error) throw error;
        newReportId = data.id;
      }

      // Sync participants
      if (values.was_held) {
        if (report?.id) {
          await supabase.from("cell_report_participants").delete().eq("report_id", report.id);
        }
        if (values.participant_ids.length > 0) {
          const participantsToInsert = values.participant_ids.map((memberId) => ({
            report_id: newReportId,
            member_id: memberId,
          }));
          const { error: pError } = await supabase
            .from("cell_report_participants")
            .insert(participantsToInsert);
          if (pError) throw pError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] });
      toast({ title: "Relatório salvo com sucesso" });
      onClose();
    },
    onError: (error) => {
      const msg = error?.message || "";
      let friendly = msg;
      if (msg.includes("Já existe um relatório para esta célula nesta semana")) {
        friendly = "Já existe um relatório dessa célula nesta semana (domingo a sábado).";
      } else if (msg.includes("dentro da semana atual")) {
        friendly = "A data do relatório precisa estar dentro da semana atual (de domingo a sábado).";
      }
      toast({
        variant: "destructive",
        title: "Erro ao salvar",
        description: friendly,
      });
    },
  });

  const onSubmit = (values: ReportFormValues) => {
    saveMutation.mutate(values);
  };

  const memberOptions: MemberOption[] = members.map((m) => ({
    value: m.id,
    label: m.name,
  }));

  const selectedParticipantOptions = toSelectedParticipantOptions(
    form.watch("participant_ids"),
    memberOptions,
    savedParticipants ?? [],
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="cell_id"
            render={({ field }) => {
              const selected = knownCell ?? cells.find((c) => c.id === field.value);
              const selectedOption: CellOption | null =
                field.value && selected ? { value: field.value, label: formatCellLabel(selected) } : null;
              return (
                <FormItem className="col-span-1 md:col-span-2">
                  <FormLabel>Célula *</FormLabel>
                  <AsyncSelect<CellOption, false>
                    cacheOptions
                    defaultOptions
                    loadOptions={loadCellOptions}
                    value={selectedOption}
                    onChange={(opt) => field.onChange(opt?.value || "")}
                    isDisabled={!!report || !!initialCell}
                    placeholder="Buscar célula por líder, endereço ou bairro..."
                    noOptionsMessage={() => "Nenhuma célula encontrada"}
                    loadingMessage={() => "Carregando..."}
                    styles={cellSelectStyles}
                    className="text-sm"
                  />
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <FormField
            control={form.control}
            name="was_held"
            render={({ field }) => (
              <FormItem className="flex flex-row items-center space-x-3 space-y-0 rounded-md border p-4 col-span-1 md:col-span-2">
                <FormControl>
                  <Checkbox checked={!field.value} onCheckedChange={(checked) => field.onChange(!checked)} />
                </FormControl>
                <div className="space-y-1 leading-none">
                  <FormLabel>Não houve célula</FormLabel>
                </div>
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="date"
            render={({ field }) => {
              const today = new Date();
              const weekStart = setDay(today, 0, { weekStartsOn: 0 });
              const weekEnd = setDay(today, 6, { weekStartsOn: 0 });
              return (
                <FormItem>
                  <FormLabel>Data *</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      min={format(weekStart, "yyyy-MM-dd")}
                      max={format(weekEnd, "yyyy-MM-dd")}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              );
            }}
          />

          <FormField
            control={form.control}
            name="time"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Horário *</FormLabel>
                <FormControl>
                  <Input type="time" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {!wasHeldValue ? (
          <FormField
            control={form.control}
            name="reason_not_held"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Motivo do Cancelamento *</FormLabel>
                <FormControl>
                  <Textarea placeholder="Qual o motivo para não ter tido célula?" {...field} required={!wasHeldValue} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : (
          <div className="space-y-4 border-t pt-4">
            <h3 className="text-lg font-medium">Detalhes do Encontro</h3>
            <FormField
              control={form.control}
              name="theme"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Tema da Palavra</FormLabel>
                  <FormControl>
                    <Input placeholder="Qual foi a ministração?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="participant_ids"
              render={() => (
                <FormItem>
                  <FormLabel>Participantes (Membros)</FormLabel>
                  <FormControl>
                    <Select<MemberOption, true>
                      isMulti
                      options={memberOptions}
                      value={selectedParticipantOptions}
                      onChange={(selected) => form.setValue("participant_ids", selected.map((s) => s.value))}
                      placeholder="Selecione os membros..."
                      noOptionsMessage={() => "Nenhum membro encontrado"}
                      styles={participantSelectStyles}
                      className="text-sm"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="visitors"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Visitantes</FormLabel>
                  <FormControl>
                    <Input placeholder="Nome dos visitantes separados por vírgula" {...field} />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">Ex: João Silva, Maria Souza</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="offering"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Oferta (R$)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        {...field}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="observations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Observações Gerais</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Algo a pontuar sobre o encontro?" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
            Cancelar
          </Button>
          <Button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CellReportForm;
