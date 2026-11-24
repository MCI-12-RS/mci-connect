import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useCellReportParticipants } from "@/hooks/use-cell-report-participants";
import { useSaveCellReport, type SaveCellReportResult } from "@/hooks/use-save-cell-report";
import { useCellOptions, toCellOption } from "@/hooks/use-cell-options";
import { useMemberOptions, toMemberOption } from "@/hooks/use-member-options";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import { FormPaginatedSelect } from "@/components/select/FormPaginatedSelect";
import { format, setDay, isFuture, subWeeks } from "date-fns";
import type { CellSummary } from "@/lib/cells/fields";
import { formatCellLabel } from "@/lib/cells/labels";
import { weekdayIndex } from "@/lib/cells/weekdays";
import { cellOfReport, type CellReportRow } from "@/lib/cell-reports/fields";
import {
  finalParticipantIds,
  keptParticipantsLine,
  markDeletedChoice,
  splitSavedParticipants,
  type KeptParticipant,
} from "@/lib/cell-reports/participants";
import { CELL_REPORT_FORM_TEXTS, toReportWrite } from "@/lib/cell-reports/report-form";
import { CELL_REPORT_DELETION_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";
import type { SelectOption } from "@/lib/selectors";

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

/** Aviso no topo do formulário depois de uma gravação recusada. */
type FormNotice =
  /** O relatório não existe mais ou foi excluído (DT-19): "Fechar" recarrega a lista. */
  | { kind: "gone" }
  /** Regra que o formulário não resolve, como a célula excluída (UX-28, UX-30). */
  | { kind: "blocked"; message: string };

interface CellReportFormProps {
  /** Relatório em edição: a linha da cell_reports_view. */
  report?: CellReportRow | null;
  /** Célula já escolhida (botão "Novo Relatório" da tela de Células): a linha da cells_view. */
  initialCell?: CellSummary | null;
  onClose: () => void;
}

const calculateCellDate = (meetingDay: string) => {
  const dayIndex = weekdayIndex(meetingDay) ?? 6;
  let d = setDay(new Date(), dayIndex, { weekStartsOn: 0 });
  if (isFuture(d)) {
    d = subWeeks(d, 1);
  }
  return format(d, "yyyy-MM-dd");
};

const CellReportForm = ({ report, onClose, initialCell }: CellReportFormProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const saveMutation = useSaveCellReport();
  const cellInputId = useId();
  const participantsInputId = useId();

  // Seletor de célula: células visíveis e ativas, 20 por vez, buscadas no
  // servidor (E1.08, RN-07).
  const cellSearch = useSelectSearch();
  const cellOptionsQuery = useCellOptions({ search: cellSearch.term, enabled: cellSearch.isMenuOpen });
  const cellPagination = useOptionsPagination(cellOptionsQuery, toCellOption);
  // A célula escolhida no seletor: dá o rótulo e sugere o dia e o horário.
  const [selectedCell, setSelectedCell] = useState<CellSummary | null>(null);
  const findLoadedCell = (cellId: string | undefined): CellSummary | null =>
    cellOptionsQuery.data?.pages.flatMap((page) => page.items).find((cell) => cell.id === cellId) ?? null;

  // A célula já conhecida: a da tela de Células ou a do relatório em edição.
  // Nos dois casos o seletor fica travado.
  const knownCell = initialCell ?? (report ? cellOfReport(report) : null);

  // Seletor de participantes: membros visíveis e ativos, 20 por vez (RN-07).
  // As opções escolhidas ficam guardadas com o nome, que não depende das
  // páginas carregadas nem do texto da busca.
  const participantSearch = useSelectSearch();
  const memberOptionsQuery = useMemberOptions({
    search: participantSearch.term,
    activeOnly: true,
    enabled: participantSearch.isMenuOpen,
  });
  const participantPagination = useOptionsPagination(memberOptionsQuery, toMemberOption);
  const [participants, setParticipants] = useState<SelectOption[]>([]);
  // Participantes de cadastro excluído: fora do seletor e sem mudança (RN-13).
  // `null` enquanto os participantes salvos de um relatório em edição carregam.
  const [kept, setKept] = useState<KeptParticipant[] | null>(report ? null : []);
  // Participantes excluídos entre a escolha e o envio, marcados no chip (UX-30).
  const [flaggedIds, setFlaggedIds] = useState<string[]>([]);

  // O relatório a atualizar: o da edição ou o criado numa tentativa cujos
  // participantes falharam. Assim, a nova tentativa não cria outro.
  const [savedReportId, setSavedReportId] = useState<string | null>(report?.id ?? null);
  // O relatório foi gravado e os participantes não (são duas chamadas até o E2.11).
  const [participantsUnsaved, setParticipantsUnsaved] = useState(false);
  const [notice, setNotice] = useState<FormNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

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

  // Na edição, os participantes salvos, com o nome e se o cadastro foi excluído.
  const savedParticipantsQuery = useCellReportParticipants(report?.id);
  const savedParticipants = savedParticipantsQuery.data;

  // Uma vez por relatório: uma nova leitura (por exemplo, ao voltar para a
  // janela) não desfaz o que já foi mudado no formulário.
  const loadedParticipantsOf = useRef<string | null>(null);
  useEffect(() => {
    if (!savedParticipants || !report?.id || loadedParticipantsOf.current === report.id) return;
    loadedParticipantsOf.current = report.id;
    const { editable, kept: keptParticipants } = splitSavedParticipants(savedParticipants);
    setParticipants(editable);
    setKept(keptParticipants);
    form.setValue("participant_ids", editable.map((p) => p.value));
  }, [savedParticipants, report?.id, form]);

  const cellIdValue = form.watch("cell_id");
  const wasHeldValue = form.watch("was_held");

  // Novo relatório: dia e horário sugeridos pela célula escolhida.
  const suggestionCell = report ? null : (initialCell ?? selectedCell);
  const suggestedDay = suggestionCell?.meeting_day;
  const suggestedTime = suggestionCell?.meeting_time;

  useEffect(() => {
    if (suggestedDay) form.setValue("date", calculateCellDate(suggestedDay));
    if (suggestedTime) form.setValue("time", suggestedTime.substring(0, 5));
  }, [cellIdValue, suggestedDay, suggestedTime, form]);

  const showSaveError = (message: string) =>
    toast({ variant: "destructive", title: CELL_REPORT_FORM_TEXTS.failedTitle, description: message });

  /** Fecha com o toast, ou mostra a falha sem perder o que foi digitado. */
  const handleSaveResult = (result: SaveCellReportResult) => {
    if (result.kind === "saved") {
      toast({ title: CELL_REPORT_FORM_TEXTS.saved });
      onClose();
      return;
    }
    setSavedReportId(result.reportId);
    if (result.step === "participants") setParticipantsUnsaved(true);
    const { failure } = result;
    if (failure.kind === "gone") {
      setNotice({ kind: "gone" });
      return;
    }
    if (failure.kind === "blocked") {
      setNotice({ kind: "blocked", message: failure.message });
      return;
    }
    if (failure.kind === "participants") {
      // O membro excluído no meio tempo fica marcado e com ✕, para ser retirado (UX-30).
      const { memberId } = failure;
      if (memberId) {
        setParticipants((current) => markDeletedChoice(current, memberId));
        setFlaggedIds((current) => (current.includes(memberId) ? current : [...current, memberId]));
      }
      form.setError("participant_ids", { message: failure.message }, { shouldFocus: true });
    } else {
      showSaveError(failure.message);
    }
  };

  const onSubmit = (values: ReportFormValues) => {
    setNotice(null);
    saveMutation.mutate(
      {
        reportId: savedReportId,
        report: toReportWrite(values),
        // Sem reunião, os participantes ficam como estão.
        participantIds: values.was_held ? finalParticipantIds(values.participant_ids, kept ?? []) : null,
      },
      // O hook não lança; uma falha fora do previsto pede para tentar de novo.
      { onSuccess: handleSaveResult, onError: () => showSaveError(CELL_REPORT_FORM_TEXTS.failed) },
    );
  };

  /** Escolha no seletor: os marcados que saíram levam junto a mensagem do campo. */
  const handleParticipantsChange = (selected: readonly SelectOption[]) => {
    setParticipants([...selected]);
    form.setValue("participant_ids", selected.map((s) => s.value));
    if (flaggedIds.length > 0 && !selected.some((s) => flaggedIds.includes(s.value))) {
      setFlaggedIds([]);
      form.clearErrors("participant_ids");
    }
  };

  /** "Fechar" do aviso de relatório excluído: volta para a lista, recarregada. */
  const closeGone = () => {
    void queryClient.invalidateQueries({ queryKey: ["cell_reports"] });
    onClose();
  };

  // Na edição, salvar com os participantes ainda carregando apagaria os que não chegaram.
  const participantsPending = wasHeldValue && kept === null;
  const keptLine = keptParticipantsLine(kept ?? []);

  return (
    <Form {...form}>
      {/* min-w-0: dentro do grid do diálogo, um nome longo não alarga o formulário. */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-6">
        {notice && (
          <Alert ref={noticeRef} tabIndex={-1} variant="destructive" className="focus:outline-none">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3">
              <p>{notice.kind === "gone" ? CELL_REPORT_DELETION_TEXTS.deletedWhileEditing : notice.message}</p>
              {notice.kind === "gone" && (
                <Button type="button" variant="outline" className="h-11 md:h-9" onClick={closeGone}>
                  {DELETION_TEXTS.close}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        {participantsUnsaved && !notice && (
          <Alert>
            <Info className="h-4 w-4" aria-hidden="true" />
            <AlertDescription>{CELL_REPORT_FORM_TEXTS.participantsNotSaved}</AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="cell_id"
            render={({ field }) => {
              const selected = knownCell ?? selectedCell;
              const selectedOption: SelectOption | null =
                field.value && selected ? { value: field.value, label: formatCellLabel(selected) } : null;
              return (
                <FormItem className="col-span-1 md:col-span-2">
                  <FormLabel htmlFor={cellInputId}>Célula *</FormLabel>
                  <FormPaginatedSelect
                    inputId={cellInputId}
                    focusRef={field.ref}
                    search={cellSearch}
                    pagination={cellPagination}
                    value={selectedOption}
                    onChange={(option) => {
                      setSelectedCell(findLoadedCell(option?.value));
                      field.onChange(option?.value ?? "");
                    }}
                    isDisabled={!!report || !!initialCell}
                    placeholder="Buscar por líder, rua ou bairro…"
                    noResultsLabel="Nenhuma célula encontrada"
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
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor={participantsInputId}>Participantes (Membros)</FormLabel>
                  <FormPaginatedSelect
                    isMulti
                    inputId={participantsInputId}
                    focusRef={field.ref}
                    search={participantSearch}
                    pagination={participantPagination}
                    value={participants}
                    onChange={handleParticipantsChange}
                    placeholder="Buscar membros…"
                    noResultsLabel="Nenhum membro encontrado"
                  />
                  <FormMessage />
                  {keptLine && <p className="text-sm text-muted-foreground">{keptLine}</p>}
                  {savedParticipantsQuery.isError && kept === null && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                      <AlertDescription className="space-y-3">
                        <p>{CELL_REPORT_FORM_TEXTS.participantsLoadFailed}</p>
                        <Button
                          type="button"
                          variant="outline"
                          className="h-11 md:h-9"
                          onClick={() => void savedParticipantsQuery.refetch()}
                        >
                          {DELETION_TEXTS.tryAgain}
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
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
          <Button type="submit" disabled={saveMutation.isPending || participantsPending || notice?.kind === "gone"}>
            {saveMutation.isPending ? "Salvando..." : "Salvar"}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CellReportForm;
