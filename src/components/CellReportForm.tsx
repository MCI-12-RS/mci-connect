import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useCellReportParticipants } from "@/hooks/use-cell-report-participants";
import { useCellReportSave, type CellReportSaveResult } from "@/hooks/use-cell-report-save";
import { CELL_OPTIONS_QUERY_KEY, useCellOptions, toCellOption } from "@/hooks/use-cell-options";
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
  hasHiddenParticipants,
  hiddenParticipantIds,
  keptParticipantsLine,
  markDeletedChoice,
  splitSavedParticipants,
  type KeptParticipant,
} from "@/lib/cell-reports/participants";
import { CELL_REPORT_FORM_TEXTS, toReportWrite } from "@/lib/cell-reports/report-form";
import { isCellReportChanged } from "@/lib/cell-reports/changes";
import { AUDIT_SAVE_TEXTS } from "@/lib/audit/texts";
import { CELL_REPORT_DELETION_TEXTS, DELETION_TEXTS } from "@/lib/deletion/texts";
import { onlyItem, type SelectOption } from "@/lib/selectors";
import { useAuth } from "@/contexts/AuthContext";
import { refreshAccess } from "@/hooks/use-access";
import { memberSearchEmptyLabel, peopleLimitedToMinistry } from "@/lib/access/access";
import { REPORT_FORM_TEXTS, SELECT_TEXTS } from "@/lib/access/texts";
import { describedBy, prefersReducedMotion } from "@/lib/a11y";
import { cellInactiveReportMessage } from "@/lib/cells/texts";
import { FieldHint } from "@/components/members/FormFieldParts";

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
  /**
   * Nada no formulário resolve: o relatório não existe mais (DT-19), ou a
   * célula foi excluída e não pode ser trocada (UX-28, UX-30). Salvar fica
   * desabilitado, e "Fechar" volta para a lista.
   */
  | { kind: "final"; message: string }
  /** Regra que o formulário não resolve, mas a pessoa pode mudar a escolha (outra célula). */
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
  const save = useCellReportSave();
  const cellInputId = useId();
  const participantsInputId = useId();
  const keptLineId = useId();
  const scopeHintId = useId();
  const hiddenWarningId = useId();
  const { access, hasPermission } = useAuth();
  // Quem vê só o ministério escolhe participantes só do ministério (T8, P11).
  const showScopeHint = peopleLimitedToMinistry(access);

  // Seletor de célula: células ativas em que a pessoa pode lançar, 20 por vez,
  // buscadas no servidor (E1.08, RN-07; E2.02, RN-13, UXD-9).
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
  // Relatório novo aberto sem célula (Relatórios, Dashboard): quando a pessoa
  // pode lançar numa célula só, ela já vem escolhida, com a data e o horário
  // sugeridos, e o seletor continua editável (UXD-9). Uma vez só, depois da
  // primeira página: uma recusa que desmarca a célula não a escolhe de novo.
  const canAutoPickCell = !report && !initialCell;
  const firstCellsQuery = useCellOptions({ search: "", enabled: canAutoPickCell });
  const cellAutoPickDone = useRef(false);

  const isCellFixed = !!report || !!initialCell;

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
  // Participantes salvos que a pessoa não vê: continuam como chips e no relatório (RN-09, AQ-7).
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  // Participantes de cadastro excluído: fora do seletor e sem mudança (RN-13).
  // `null` enquanto os participantes salvos de um relatório em edição carregam.
  const [kept, setKept] = useState<KeptParticipant[] | null>(report ? null : []);
  // Participantes excluídos entre a escolha e o envio, marcados no chip (UX-30).
  const [flaggedIds, setFlaggedIds] = useState<string[]>([]);

  const [notice, setNotice] = useState<FormNotice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  // Nada foi gravado por falha da Auditoria, do servidor ou da rede (E2.05, T5, RN-14).
  const [connectionFailed, setConnectionFailed] = useState(false);
  const primaryRef = useRef<HTMLButtonElement>(null);

  // O aviso recebe o foco, e a tela rola até ele (E2.01 T8; E2.08 T8).
  useEffect(() => {
    if (!notice) return;
    noticeRef.current?.focus();
    noticeRef.current?.scrollIntoView?.({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [notice]);

  // Os dados entram na montagem (o diálogo monta o formulário a cada abertura).
  const [openingValues] = useState<ReportFormValues>(() => ({
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
  }));
  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportSchema),
    defaultValues: openingValues,
  });
  // A referência do "algo mudou?" na edição (T5): o relatório aberto e, quando
  // carregam, todos os participantes salvos.
  const openingParticipantIds = useRef<string[]>([]);

  // Na edição, os participantes salvos, com o nome e se o cadastro foi excluído.
  const savedParticipantsQuery = useCellReportParticipants(report?.id);
  const savedParticipants = savedParticipantsQuery.data;

  // Uma vez por relatório: uma nova leitura (por exemplo, ao voltar para a
  // janela) não desfaz o que já foi mudado no formulário.
  const loadedParticipantsOf = useRef<string | null>(null);
  useEffect(() => {
    if (!savedParticipants || !report?.id || loadedParticipantsOf.current === report.id) return;
    loadedParticipantsOf.current = report.id;
    openingParticipantIds.current = savedParticipants.map((p) => p.member_id);
    const { editable, kept: keptParticipants } = splitSavedParticipants(savedParticipants);
    setParticipants(editable);
    setKept(keptParticipants);
    setHiddenIds(hiddenParticipantIds(savedParticipants));
    form.setValue("participant_ids", editable.map((p) => p.value));
  }, [savedParticipants, report?.id, form]);

  const firstCellsPage = firstCellsQuery.data?.pages[0];
  useEffect(() => {
    if (!canAutoPickCell || cellAutoPickDone.current || !firstCellsPage) return;
    cellAutoPickDone.current = true;
    const only = onlyItem(firstCellsPage);
    if (!only || form.getValues("cell_id")) return;
    setSelectedCell(only);
    form.setValue("cell_id", only.id);
  }, [canAutoPickCell, firstCellsPage, form]);

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

  const showSaveError = (message: string) => toast({ variant: "destructive", title: message });

  // Depois de uma falha de envio, o foco volta a "Salvar", que serve de "Tentar de novo" (T5).
  useEffect(() => {
    if (connectionFailed && !save.isPending) primaryRef.current?.focus();
  }, [connectionFailed, save.isPending]);

  /** Nada no formulário resolve: as listas recarregam já, para qualquer jeito de fechar voltar a elas atualizadas. */
  const showFinalNotice = (message: string) => {
    setNotice({ kind: "final", message });
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cell_reports", "list"] }),
      queryClient.invalidateQueries({ queryKey: ["cells", "list"] }),
    ]);
  };

  /** Fecha com o toast, ou mostra a falha sem perder o que foi digitado. */
  const handleSaveResult = (result: CellReportSaveResult) => {
    if (result.kind === "saved") {
      // O servidor não mudou nada: o mesmo aviso de quando a tela percebe (E2.05, T5, AQ-7).
      toast({ title: result.changed ? CELL_REPORT_FORM_TEXTS.saved : AUDIT_SAVE_TEXTS.unchanged });
      onClose();
      return;
    }
    const { failure } = result;
    if (failure.kind === "connection") {
      setConnectionFailed(true);
      return;
    }
    if (failure.kind === "gone") {
      showFinalNotice(CELL_REPORT_DELETION_TEXTS.deletedWhileEditing);
      return;
    }
    if (failure.kind === "cellInactive") {
      // A célula foi inativada no meio tempo (E2.08, RN-11 c, T8): a lista e o atalho do Dashboard
      // deixam de oferecê-la; os dados digitados ficam.
      void Promise.all([queryClient.invalidateQueries({ queryKey: ["cells"] }), refreshAccess(queryClient)]);
      const message = cellInactiveReportMessage(hasPermission("edit_cell"));
      if (isCellFixed) {
        // Aberto pela lista: a célula está travada, e só resta fechar.
        showFinalNotice(message);
        return;
      }
      // Aberto por Relatórios: a célula é desmarcada, e o seletor recarrega sem as inativas.
      setSelectedCell(null);
      form.setValue("cell_id", "");
      setNotice({ kind: "blocked", message });
      return;
    }
    if (failure.kind === "refused") {
      // Escopo ou função mudaram (T11): a tela relê o acesso (P13).
      void refreshAccess(queryClient);
      if (failure.clearCell && isCellFixed) {
        // A célula veio escolhida de fora e não pode ser trocada aqui: só resta fechar.
        showFinalNotice(failure.message);
        return;
      }
      if (failure.clearCell) {
        // RN-13: a célula é desmarcada, o seletor recarrega e o resto fica como estava (T8).
        setSelectedCell(null);
        form.setValue("cell_id", "");
        void queryClient.invalidateQueries({ queryKey: CELL_OPTIONS_QUERY_KEY });
      }
      setNotice({ kind: "blocked", message: failure.message });
      return;
    }
    if (failure.kind === "blocked") {
      // Célula excluída: só outra célula resolveria, e só o relatório novo aberto em Relatórios deixa trocá-la.
      if (failure.cellDeleted && isCellFixed) showFinalNotice(failure.message);
      else setNotice({ kind: "blocked", message: failure.message });
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

  const onSubmit = async (values: ReportFormValues) => {
    if (save.isPending) return;
    const reportWrite = toReportWrite(values);
    // Sem reunião, os participantes ficam como estão.
    const participantIds = values.was_held ? finalParticipantIds(values.participant_ids, kept ?? []) : null;
    // Na edição, sem nenhuma mudança, nada vai ao servidor (E2.05, T5, UXD-9).
    if (
      report &&
      !isCellReportChanged(
        { report: toReportWrite(openingValues), participantIds: openingParticipantIds.current },
        { report: reportWrite, participantIds },
      )
    ) {
      toast({ title: AUDIT_SAVE_TEXTS.unchanged });
      onClose();
      return;
    }
    setNotice(null);
    setConnectionFailed(false);
    const result = await save.save({ reportId: report?.id ?? null, report: reportWrite, participantIds });
    if (result) handleSaveResult(result);
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

  /** "Fechar" do aviso: volta para a lista, recarregada. */
  const closeFinal = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ["cell_reports"] }),
      queryClient.invalidateQueries({ queryKey: ["cells"] }),
    ]);
    onClose();
  };

  // Na edição, salvar com os participantes ainda carregando apagaria os que não chegaram.
  const participantsPending = wasHeldValue && kept === null;
  const keptLine = keptParticipantsLine(kept ?? []);
  // O aviso só aparece enquanto algum participante que a pessoa não vê continua escolhido (T8).
  const showHiddenWarning = hasHiddenParticipants(
    participants.map((p) => p.value),
    hiddenIds,
  );

  return (
    <Form {...form}>
      {/* min-w-0: dentro do grid do diálogo, um nome longo não alarga o formulário. */}
      <form onSubmit={form.handleSubmit(onSubmit)} className="min-w-0 space-y-6">
        {notice && (
          <Alert ref={noticeRef} role="alert" tabIndex={-1} variant="destructive" className="focus:outline-none">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3 text-foreground">
              <p>{notice.message}</p>
              {notice.kind === "final" && (
                <Button type="button" variant="outline" className="h-11 md:h-9" onClick={closeFinal}>
                  {DELETION_TEXTS.close}
                </Button>
              )}
            </AlertDescription>
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
                    isDisabled={isCellFixed}
                    placeholder="Buscar por líder, rua ou bairro…"
                    noResultsLabel={cellSearch.term ? "Nenhuma célula encontrada" : SELECT_TEXTS.noCellsToReport}
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
                    noResultsLabel={memberSearchEmptyLabel(access)}
                    aria-describedby={describedBy(
                      keptLine && keptLineId,
                      showScopeHint && scopeHintId,
                      showHiddenWarning && hiddenWarningId,
                    )}
                  />
                  <FormMessage />
                  {keptLine && (
                    <p id={keptLineId} className="text-sm text-muted-foreground">
                      {keptLine}
                    </p>
                  )}
                  {showScopeHint && <FieldHint id={scopeHintId}>{REPORT_FORM_TEXTS.participantsHint}</FieldHint>}
                  {showHiddenWarning && (
                    <FieldHint id={hiddenWarningId}>{REPORT_FORM_TEXTS.hiddenParticipants}</FieldHint>
                  )}
                  {savedParticipantsQuery.isError && kept === null && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" aria-hidden="true" />
                      <AlertDescription className="space-y-3 text-foreground">
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

        {/* Logo acima dos botões: "Salvar" volta a ficar habilitado e serve de "Tentar de novo" (T5). */}
        {connectionFailed && !save.isPending && (
          <Alert role="alert" variant="destructive">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="text-foreground">{CELL_REPORT_FORM_TEXTS.connection}</AlertDescription>
          </Alert>
        )}

        <div className="flex justify-end gap-2 pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button
            ref={primaryRef}
            type="submit"
            disabled={save.isPending || participantsPending || notice?.kind === "final"}
          >
            {save.isPending ? CELL_REPORT_FORM_TEXTS.buttons.saving : CELL_REPORT_FORM_TEXTS.buttons.save}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CellReportForm;
