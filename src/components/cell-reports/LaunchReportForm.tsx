import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DiscardChangesDialog } from "@/components/form/DiscardChangesDialog";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import { PaginatedSelect, type PaginatedSelectHandle } from "@/components/select/PaginatedSelect";
import { useAuth } from "@/contexts/AuthContext";
import { refreshAccess } from "@/hooks/use-access";
import { CELL_OPTIONS_QUERY_KEY, toCellOption, useCellOptions } from "@/hooks/use-cell-options";
import { useCellReportLaunchCheck } from "@/hooks/use-cell-report-launch-check";
import { useCellReportSubmit } from "@/hooks/use-cell-report-submit";
import { useMemberStatuses } from "@/hooks/use-member-statuses";
import { useOptionsPagination, useSelectSearch } from "@/hooks/use-paginated-select";
import { useReportFormState } from "@/hooks/use-report-form-state";
import { useToast } from "@/hooks/use-toast";
import { memberSearchEmptyLabel, peopleLimitedToMinistry } from "@/lib/access/access";
import { REPORT_FORM_TEXTS as ACCESS_REPORT_TEXTS, SELECT_TEXTS } from "@/lib/access/texts";
import { prefersReducedMotion } from "@/lib/a11y";
import {
  deviceClock,
  launchDatesAt,
  meetingInSentence,
  momentDate,
  momentInSentence,
  momentTime,
  serverClock,
  spLocalMoment,
  type Clock,
  type LaunchDates,
} from "@/lib/cell-reports/dates";
import type { ReportRefusal } from "@/lib/cell-reports/codes";
import {
  launchNoticeLines,
  noticeClearsCell,
  noticeHidesCell,
  type ExistingReport,
  type LaunchNotice,
} from "@/lib/cell-reports/launch-check";
import { offeringValue } from "@/lib/cell-reports/offering";
import { automaticParticipants, markDeletedChoice, participantsTotal } from "@/lib/cell-reports/participants";
import { isReportFormDirty, toSubmitParticipants, toSubmitReport } from "@/lib/cell-reports/payload";
import { launchLeavingNotice } from "@/lib/cell-reports/situation-switch";
import { cellBlockFromCell, type StatusOf } from "@/lib/cell-reports/snapshot";
import {
  LAUNCH_CHECK_TEXTS,
  MEETING_TEXTS,
  PARTICIPANTS_TEXTS,
  REPORT_CELL_TEXTS,
  REPORT_FORM_TEXTS,
} from "@/lib/cell-reports/texts";
import type { ReportFormValues } from "@/lib/cell-reports/validation";
import { visitorsCount } from "@/lib/cell-reports/visitors";
import { cellInactiveReportMessage } from "@/lib/cells/texts";
import type { CellSummary } from "@/lib/cells/fields";
import { personLabel } from "@/lib/members/labels";
import { refreshAfterReportWrite } from "@/lib/query-refresh";
import { onlyItem, type SelectOption } from "@/lib/selectors";
import { CellSnapshotBlock } from "./CellSnapshotBlock";
import { HeldFields } from "./HeldFields";
import { MeetingFieldset } from "./MeetingFieldset";
import { useReportShell } from "./report-shell";
import { ReportNotice, type NoticeTone } from "./LaunchNotice";

interface LaunchReportFormProps {
  /** A célula fixa (lista de Células, detalhe); sem ela, o seletor (Relatórios, Dashboard). */
  cell: CellSummary | null;
  onEditReport: (reportId: string) => void;
  onClose: () => void;
}

/** O aviso no topo: da conferência (T3) ou de uma recusa do envio (T7). */
interface TopNotice {
  tone: NoticeTone;
  lines: string[];
  /** "Editar relatório", para quem edita o relatório da semana. */
  editReportId?: string | null;
  /** Os campos somem: o aviso antes de preencher (UXD-3). */
  hidesFields: boolean;
  /** O rodapé fica só com "Fechar" (a célula fixa que não recebe; a repetição depois de uma queda). */
  final: boolean;
}

const EMPTY: ReportFormValues = {
  cellId: "",
  held: true,
  date: "",
  time: "",
  theme: "",
  reason: "",
  participantIds: [],
  visitors: [""],
  offering: "",
  observations: "",
};

/** As datas e o relógio do lançamento: do servidor, ou do aparelho quando a conferência falhou (UXD-4). */
interface LaunchClock {
  dates: LaunchDates;
  clock: Clock;
}

function weekTakenLines(report: ExistingReport | null, first: string): string[] {
  return report ? [first, LAUNCH_CHECK_TEXTS.weekTakenDetail(meetingInSentence(report.date, report.time), report.held)] : [first];
}

/**
 * O lançamento do relatório (E2.11, T1 a T8): a célula (fixa ou no seletor), a
 * conferência antes de preencher (P100), os campos e o envio idempotente pela
 * `submit_cell_report`, com o `attemptId` gerado ao abrir e a cada troca de célula.
 */
export function LaunchReportForm({ cell: fixedCell, onEditReport, onClose }: LaunchReportFormProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { access, hasPermission } = useAuth();
  // O id do envio (idempotente pela `submit_cell_report`): um por célula. Trocar de célula gera outro, a
  // não ser depois de uma queda, quando o seletor fica travado (P107: a tentativa pode ter gravado).
  const [attemptId, setAttemptId] = useState(() => crypto.randomUUID());
  const [formId] = useState(() => `report-form-${attemptId}`);
  const isCellFixed = fixedCell !== null;
  const [cell, setCell] = useState<CellSummary | null>(fixedCell);

  // A célula livre: as em que a pessoa pode lançar, e a única já escolhida (UXD-9 do E2.02).
  const cellSearch = useSelectSearch();
  const cellOptionsQuery = useCellOptions({
    search: cellSearch.term,
    enabled: !isCellFixed && cellSearch.isMenuOpen,
  });
  const cellPagination = useOptionsPagination(cellOptionsQuery, toCellOption);
  const firstCells = useCellOptions({ search: "", enabled: !isCellFixed });
  const autoPicked = useRef(false);
  const firstPage = firstCells.data?.pages[0];
  useEffect(() => {
    if (isCellFixed || autoPicked.current || !firstPage) return;
    autoPicked.current = true;
    const only = onlyItem(firstPage);
    if (only && !cell) setCell(only);
  }, [isCellFixed, firstPage, cell]);

  const check = useCellReportLaunchCheck(cell?.id ?? null);
  const statuses = useMemberStatuses(cell ? [cell.leader_id, cell.timothy_id, cell.host_id] : []);
  const statusOf: StatusOf = (id) => (id && statuses.data ? (statuses.data.get(id) ?? null) : null);

  // O relógio do lançamento: o "agora" do servidor mais o tempo passado (AQ-6); o do aparelho na falha.
  const checkState = check.data;
  const checkedClock: LaunchClock | null = useMemo(() => {
    if (!cell) return null;
    const context = checkState?.kind === "ready" || checkState?.kind === "notice" ? checkState.context : null;
    if (context) {
      const { today, weekStart, weekEnd, meeting, allowedDates } = context;
      return { dates: { today, weekStart, weekEnd, meeting, allowedDates }, clock: serverClock(context.serverNow) };
    }
    if (check.isError || checkState?.kind === "failed") {
      const dates =
        cell.meeting_day && cell.meeting_time ? launchDatesAt(deviceClock(), cell.meeting_day, cell.meeting_time) : null;
      return dates ? { dates, clock: deviceClock } : null;
    }
    return null;
  }, [cell, checkState, check.isError]);
  // Depois que os campos apareceram, uma nova conferência sem a reunião (a célula inativada no meio
  // tempo) não os esconde: as datas da última conferência continuam (T7, os dados ficam).
  const fieldsUnlocked = useRef(false);
  const lastClock = useRef<{ cellId: string; value: LaunchClock } | null>(null);
  if (checkedClock && cell) lastClock.current = { cellId: cell.id, value: checkedClock };
  const launchClock =
    checkedClock ?? (cell && fieldsUnlocked.current && lastClock.current?.cellId === cell.id ? lastClock.current.value : null);

  const launchClockRef = useRef(launchClock);
  launchClockRef.current = launchClock;
  const participantsTotalRef = useRef(0);

  const form = useReportFormState(EMPTY, () => {
    const current = launchClockRef.current;
    return {
      dates: current
        ? {
            mode: "launch",
            now: spLocalMoment(current.clock()),
            meeting: current.dates.meeting,
          }
        : null,
      participantsTotal: participantsTotalRef.current,
    };
  });
  const { values, update, errors, registerFocus } = form;

  // A base do "algo mudou?": a sugestão de data e horário não conta, nem a célula escolhida (T8).
  const [baseline, setBaseline] = useState<ReportFormValues>(EMPTY);
  const isDirty = useCallback(
    () => isReportFormDirty({ ...baseline, cellId: form.valuesRef.current.cellId }, form.valuesRef.current),
    [baseline, form.valuesRef],
  );

  // A sugestão pela reunião da semana (RN-18), a cada célula conferida. Trocar de célula troca a data e o
  // horário, mesmo que a pessoa os tenha mudado, com o aviso (T2).
  const suggestedFor = useRef<string | null>(null);
  const [cellSwitched, setCellSwitched] = useState(false);
  useEffect(() => {
    if (!cell || !launchClock || suggestedFor.current === cell.id) return;
    const date = momentDate(launchClock.dates.meeting);
    const time = momentTime(launchClock.dates.meeting);
    const current = form.valuesRef.current;
    const hadSuggestion = suggestedFor.current !== null;
    const changedByHand = hadSuggestion && (current.date !== baseline.date || current.time !== baseline.time);
    suggestedFor.current = cell.id;
    setCellSwitched(changedByHand && (current.date !== date || current.time !== time));
    update({ cellId: cell.id, date, time }, ["cell_id", "date", "time"]);
    setBaseline((b) => ({ ...b, cellId: cell.id, date, time }));
  }, [cell, launchClock, baseline.date, baseline.time, form.valuesRef, update]);

  // Avisos e falhas.
  const [refusalNotice, setRefusalNotice] = useState<TopNotice | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [hadConnectionFailure, setHadConnectionFailure] = useState(false);
  const submit = useCellReportSubmit();
  const busy = submit.isPending;
  const primaryRef = useRef<HTMLButtonElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const cellSelectRef = useRef<PaginatedSelectHandle>(null);
  const [confirmEdit, setConfirmEdit] = useState<string | null>(null);

  useEffect(() => {
    registerFocus("cell_id", () => cellSelectRef.current?.focus());
  }, [registerFocus]);

  // O estado da conferência como aviso (T3). Depois que algo foi digitado, um aviso não esconde os campos.
  const typed = isDirty();
  const checkNotice: TopNotice | null = useMemo(() => {
    if (!cell || checkState?.kind !== "notice") return null;
    const notice: LaunchNotice = checkState.notice;
    const lines = launchNoticeLines(notice, hasPermission("edit_cell"));
    const tone: NoticeTone = notice.kind === "already_sent" ? "info" : notice.kind === "not_yet" ? "waiting" : "error";
    const editReportId = notice.kind === "already_sent" && notice.report?.canEdit ? notice.report.id : null;
    return {
      tone,
      lines,
      editReportId,
      hidesFields: true,
      final: isCellFixed && noticeClearsCell(notice),
    };
  }, [cell, checkState, hasPermission, isCellFixed]);

  // A célula livre que não recebe: desmarcada, e o seletor recarrega sem ela (T3 c). O aviso fica.
  const [clearedNotice, setClearedNotice] = useState<TopNotice | null>(null);
  useEffect(() => {
    if (isCellFixed || checkState?.kind !== "notice" || !noticeClearsCell(checkState.notice) || !checkNotice) return;
    setClearedNotice({ ...checkNotice, final: false });
    setCell(null);
    suggestedFor.current = null;
    update({ cellId: "" }, ["cell_id"]);
    void queryClient.invalidateQueries({ queryKey: CELL_OPTIONS_QUERY_KEY });
    void refreshAccess(queryClient);
  }, [isCellFixed, checkState, checkNotice, update, queryClient]);

  const checking = !!cell && check.isPending;
  const checkFailed = !!cell && (check.isError || checkState?.kind === "failed");
  const noticeHides = !!checkNotice && (!typed || !fieldsUnlocked.current);
  const showFields =
    !!cell && !checking && !!launchClock && (checkState?.kind === "ready" || checkFailed || (!!checkNotice && !noticeHides));
  if (showFields) fieldsUnlocked.current = true;
  const topNotice = refusalNotice ?? (checkNotice ? { ...checkNotice, hidesFields: noticeHides } : clearedNotice);
  const blockHidden = checkState?.kind === "notice" && noticeHidesCell(checkState.notice);

  // O aviso recebe o foco quando aparece, a não ser que a pessoa esteja num campo (T3, T7).
  const noticeKey = topNotice ? topNotice.lines.join("|") : null;
  useEffect(() => {
    if (!noticeKey) return;
    const active = document.activeElement;
    if (active && formRef.current?.contains(active) && ["INPUT", "TEXTAREA"].includes(active.tagName)) return;
    noticeRef.current?.focus();
    noticeRef.current?.scrollIntoView?.({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [noticeKey]);

  useEffect(() => {
    if (failure && !busy) primaryRef.current?.focus();
  }, [failure, busy]);

  // Participantes (RN-10, RN-11).
  const automatic = cell
    ? automaticParticipants(cell).map((p) => {
        const status = statusOf(p.id);
        return status ? { ...p, name: personLabel({ name: p.name, ...status }) } : p;
      })
    : [];
  const [chosen, setChosen] = useState<SelectOption[]>([]);
  const total = participantsTotal(
    automatic.map((p) => p.id),
    values.participantIds,
  );
  participantsTotalRef.current = total;

  const chooseCell = (option: SelectOption | null) => {
    const found = cellOptionsQuery.data?.pages.flatMap((page) => page.items).find((c) => c.id === option?.value) ?? null;
    if (hadConnectionFailure || found?.id === cell?.id) return;
    setClearedNotice(null);
    setRefusalNotice(null);
    setAttemptId(crypto.randomUUID());
    // A nova célula passa pela própria conferência: um aviso dela esconde os campos de novo (T3).
    fieldsUnlocked.current = false;
    setCell(found);
    if (!found) update({ cellId: "" }, ["cell_id"]);
  };

  const closeAndRefresh = () => {
    void refreshAfterReportWrite(queryClient);
    onClose();
  };

  const showRefusal = (refusal: ReportRefusal) => {
    switch (refusal.kind) {
      case "connection":
        setHadConnectionFailure(true);
        setFailure(REPORT_FORM_TEXTS.connection.send);
        return;
      case "field":
        if (refusal.field === "participant_ids" && refusal.memberId && refusal.code === "deleted_member_chosen") {
          setChosen((current) => markDeletedChoice(current, refusal.memberId ?? ""));
        }
        form.showServerError(refusal.field, refusal.message);
        return;
      case "week_taken":
        if (hadConnectionFailure) {
          // P107: a primeira tentativa provavelmente gravou.
          setRefusalNotice({
            tone: "info",
            lines: weekTakenLines(refusal.report, REPORT_FORM_TEXTS.replayAfterDrop),
            hidesFields: false,
            final: true,
          });
        } else {
          setRefusalNotice({
            tone: "info",
            lines: weekTakenLines(refusal.report, LAUNCH_CHECK_TEXTS.weekTaken),
            editReportId: refusal.report?.canEdit ? refusal.report.id : null,
            hidesFields: false,
            final: false,
          });
        }
        return;
      case "cell": {
        const message = refusal.reason === "inactive" ? cellInactiveReportMessage(hasPermission("edit_cell")) : refusal.message;
        if (isCellFixed) {
          setRefusalNotice({
            tone: "error",
            lines: [message],
            hidesFields: false,
            final: true,
          });
          return;
        }
        // A célula não recebe: a tentativa não gravou nada, e outra célula recebe um id novo.
        setHadConnectionFailure(false);
        setAttemptId(crypto.randomUUID());
        fieldsUnlocked.current = false;
        setCell(null);
        suggestedFor.current = null;
        update({ cellId: "" }, ["cell_id"]);
        void queryClient.invalidateQueries({
          queryKey: CELL_OPTIONS_QUERY_KEY,
        });
        setRefusalNotice({
          tone: "error",
          lines: [message],
          hidesFields: false,
          final: false,
        });
        return;
      }
      case "permission":
        void refreshAccess(queryClient);
        setRefusalNotice({
          tone: "error",
          lines: [refusal.message],
          hidesFields: false,
          final: false,
        });
        return;
      case "top":
      case "report_gone":
        setRefusalNotice({
          tone: "error",
          lines: [refusal.message],
          hidesFields: false,
          final: false,
        });
        return;
      case "gate":
        return;
    }
  };

  const onSubmit = async () => {
    if (busy) return;
    if (!form.validateAll()) return;
    setRefusalNotice(null);
    setFailure(null);
    const current = form.valuesRef.current;
    const result = await submit.submit({
      attemptId,
      report: toSubmitReport(current),
      participantIds: toSubmitParticipants(current),
    });
    if (!result) return;
    if (result.kind === "sent") {
      toast({
        title: result.sameContent ? REPORT_FORM_TEXTS.toasts.sent : REPORT_FORM_TEXTS.replayedDifferent,
      });
      onClose();
      return;
    }
    showRefusal(result.refusal);
  };

  const requestEditReport = (reportId: string) => {
    if (isDirty()) setConfirmEdit(reportId);
    else onEditReport(reportId);
  };

  const errorCount = Object.keys(errors).length;
  const isFinal = topNotice?.final === true;
  const hasFormActions = !isFinal && !(topNotice?.hidesFields && !showFields);
  const meeting = launchClock?.dates.meeting;
  const switchNotice = values.held
    ? null
    : launchLeavingNotice({
        theme: values.theme,
        participants: values.participantIds.length,
        visitors: visitorsCount(values.visitors),
        offering: offeringValue(values.offering),
        observations: values.observations,
      });
  const block = cell && !blockHidden ? cellBlockFromCell(cell, statusOf) : null;
  const cellOption: SelectOption | null = cell ? toCellOption(cell) : null;

  useReportShell({
    title: REPORT_FORM_TEXTS.titles.create,
    onClose: isFinal || (topNotice?.hidesFields && !showFields) ? closeAndRefresh : onClose,
    actions: hasFormActions
      ? {
          formId,
          primaryLabel: REPORT_FORM_TEXTS.buttons.send,
          busyLabel: REPORT_FORM_TEXTS.buttons.sending,
          busy,
          disabled: false,
          errorCount,
          failure: busy ? null : failure,
          primaryRef,
          isDirty,
          slowText: REPORT_FORM_TEXTS.slow.send,
        }
      : undefined,
  });

  return (
    <>
      <form
        id={formId}
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void onSubmit();
        }}
        className="min-w-0 space-y-6"
      >
        {topNotice && (
          <ReportNotice
            ref={noticeRef}
            tone={topNotice.tone}
            lines={topNotice.lines}
            onEditReport={topNotice.editReportId ? () => requestEditReport(topNotice.editReportId ?? "") : undefined}
          />
        )}

        {checkFailed && showFields && (
          <Alert role="status">
            <TriangleAlert className="h-4 w-4" aria-hidden="true" />
            <AlertDescription className="space-y-3 text-foreground">
              <p>{LAUNCH_CHECK_TEXTS.failed}</p>
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={() => void check.refetch()}>
                {REPORT_FORM_TEXTS.buttons.tryAgain}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {(showFields || (!isCellFixed && !topNotice?.final)) && (
          <p className="text-sm text-muted-foreground">{REPORT_FORM_TEXTS.requiredNote}</p>
        )}

        <div className="min-w-0 space-y-2">
          {isCellFixed ? (
            block && <p className="text-sm font-medium">{REPORT_CELL_TEXTS.label}</p>
          ) : (
            <>
              <Label htmlFor="report-cell">
                {REPORT_CELL_TEXTS.label}
                {REPORT_FORM_TEXTS.required}
              </Label>
              <PaginatedSelect
                inputId="report-cell"
                focusRef={cellSelectRef}
                search={cellSearch}
                pagination={cellPagination}
                value={cellOption}
                onChange={chooseCell}
                placeholder={REPORT_CELL_TEXTS.placeholder}
                noResultsLabel={cellSearch.term ? REPORT_CELL_TEXTS.noResults : SELECT_TEXTS.noCellsToReport}
                isDisabled={busy || hadConnectionFailure}
                aria-required
                aria-invalid={!!errors.cell_id}
                aria-errormessage={errors.cell_id ? "report-cell-error" : undefined}
                aria-describedby={errors.cell_id ? "report-cell-error" : !cell ? "report-cell-hint" : undefined}
              />
              {errors.cell_id && <FieldError id="report-cell-error">{errors.cell_id}</FieldError>}
              {!cell && <FieldHint id="report-cell-hint">{REPORT_CELL_TEXTS.chooseHint}</FieldHint>}
            </>
          )}
          {block && <CellSnapshotBlock block={block} />}
        </div>

        {checking && (
          <div className="space-y-3">
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {LAUNCH_CHECK_TEXTS.checking}
            </p>
            <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-11 w-full motion-reduce:animate-none" />
            <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
            <Skeleton className="h-11 w-full motion-reduce:animate-none" />
          </div>
        )}

        {showFields && launchClock && meeting && (
          <>
            <MeetingFieldset
              values={values}
              errors={errors}
              dates={launchClock.dates.allowedDates.length > 0 ? launchClock.dates.allowedDates : [momentDate(meeting)]}
              today={launchClock.dates.today}
              dateHint={MEETING_TEXTS.launchHint(momentInSentence(meeting))}
              planned={MEETING_TEXTS.planned(momentInSentence(meeting))}
              switchNotice={switchNotice}
              cellSwitched={cellSwitched}
              onHeldChange={(held) => update({ held }, ["was_held"])}
              onDateChange={(date) => {
                setCellSwitched(false);
                update({ date }, ["date", "time"]);
              }}
              onTimeChange={(time) => {
                setCellSwitched(false);
                update({ time }, ["date", "time"]);
              }}
              onTimeBlur={() => form.checkTimeOnBlur(form.valuesRef.current.time !== baseline.time)}
              onThemeChange={(theme) => update({ theme }, ["theme"])}
              onReasonChange={(reason) => update({ reason }, ["reason_not_held"])}
              registerFocus={registerFocus}
            />
            {values.held && (
              <HeldFields
                values={values}
                errors={errors}
                participants={{
                  fixed: automatic,
                  fixedHint: PARTICIPANTS_TEXTS.autoHint,
                  chosen,
                  onChosenChange: (options) => {
                    setChosen(options);
                    update({ participantIds: options.map((o) => o.value) }, ["participant_ids"]);
                  },
                  keptLine: null,
                  scopeHint: peopleLimitedToMinistry(access) ? ACCESS_REPORT_TEXTS.participantsHint : null,
                  hiddenWarning: null,
                  noResultsLabel: memberSearchEmptyLabel(access),
                  total,
                }}
                onVisitorsChange={(visitors) => update({ visitors }, ["visitors"])}
                onOfferingChange={(offering) => update({ offering }, ["offering"])}
                onObservationsChange={(observations) => update({ observations }, ["observations"])}
                registerFocus={registerFocus}
              />
            )}
          </>
        )}
      </form>

      <DiscardChangesDialog
        open={confirmEdit !== null}
        onOpenChange={(open) => !open && setConfirmEdit(null)}
        onDiscard={() => {
          const id = confirmEdit;
          setConfirmEdit(null);
          if (id) onEditReport(id);
        }}
      />
    </>
  );
}
