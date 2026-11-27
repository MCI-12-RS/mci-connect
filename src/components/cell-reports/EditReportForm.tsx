import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { RecordAuthorship } from "@/components/RecordAuthorship";
import { useAuth } from "@/contexts/AuthContext";
import { refreshAccess } from "@/hooks/use-access";
import { useCellReportEdit, type CellReportEditData } from "@/hooks/use-cell-report-edit";
import { useCellReportParticipants } from "@/hooks/use-cell-report-participants";
import { useCellReportSave } from "@/hooks/use-cell-report-save";
import { useMemberStatuses } from "@/hooks/use-member-statuses";
import { useReportFormState } from "@/hooks/use-report-form-state";
import { useToast } from "@/hooks/use-toast";
import { memberSearchEmptyLabel, peopleLimitedToMinistry } from "@/lib/access/access";
import { REPORT_FORM_TEXTS as ACCESS_REPORT_TEXTS } from "@/lib/access/texts";
import { prefersReducedMotion } from "@/lib/a11y";
import type { ReportRefusal } from "@/lib/cell-reports/codes";
import { deviceClock, editDates, meetingInSentence, serverClock, spLocalMoment, momentDate } from "@/lib/cell-reports/dates";
import type { FormParticipant } from "@/lib/cell-reports/fields";
import { offeringValue } from "@/lib/cell-reports/offering";
import {
  automaticParticipants,
  hasHiddenParticipants,
  hiddenParticipantIds,
  keptParticipantsLine,
  markDeletedChoice,
  participantsTotal,
  splitEditParticipants,
} from "@/lib/cell-reports/participants";
import { editFormValues, editPayload, isReportFormDirty, type StoredReport } from "@/lib/cell-reports/payload";
import { editSwitchNotice } from "@/lib/cell-reports/situation-switch";
import { cellBlockFromReport, type StatusOf } from "@/lib/cell-reports/snapshot";
import {
  MEETING_TEXTS,
  PARTICIPANTS_TEXTS,
  REPORT_CELL_TEXTS,
  REPORT_FORM_TEXTS,
  REPORT_RULE_TEXTS,
} from "@/lib/cell-reports/texts";
import { visitorsCount } from "@/lib/cell-reports/visitors";
import { formatIsoDateBr, parseIsoDate } from "@/lib/dates/sao-paulo";
import { personLabel } from "@/lib/members/labels";
import { refreshAfterReportWrite } from "@/lib/query-refresh";
import type { SelectOption } from "@/lib/selectors";
import { CellSnapshotBlock } from "./CellSnapshotBlock";
import { HeldFields } from "./HeldFields";
import { MeetingFieldset } from "./MeetingFieldset";
import { useReportShell } from "./report-shell";
import { ReportNotice } from "./LaunchNotice";

interface EditReportFormProps {
  reportId: string;
  onClose: () => void;
}

/**
 * A edição do relatório (E2.11, T9, AQ-10): lê a linha da `cell_reports_view`
 * (com o retrato), os participantes e as datas da semana do relatório antes de
 * mostrar os campos, e grava pela `save_cell_report` só o que mudou.
 */
export function EditReportForm({ reportId, onClose }: EditReportFormProps) {
  const queryClient = useQueryClient();
  const data = useCellReportEdit(reportId);
  const participants = useCellReportParticipants(reportId);

  const closeAndRefresh = () => {
    void refreshAfterReportWrite(queryClient);
    onClose();
  };

  if (data.data && participants.data) {
    return <EditReportBody data={data.data} saved={participants.data} onClose={onClose} onCloseAndRefresh={closeAndRefresh} />;
  }

  let body;
  if (data.data === null) {
    body = <ReportNotice tone="error" lines={[REPORT_RULE_TEXTS.report_gone]} />;
  } else if (data.isError || participants.isError) {
    body = (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        <AlertDescription className="space-y-3 text-foreground">
          <p>{data.isError ? REPORT_FORM_TEXTS.editLoadFailed : REPORT_FORM_TEXTS.participantsLoadFailed}</p>
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => void Promise.all([data.refetch(), participants.refetch()])}
          >
            {REPORT_FORM_TEXTS.buttons.tryAgain}
          </Button>
        </AlertDescription>
      </Alert>
    );
  } else {
    body = (
      <div aria-busy="true" className="space-y-4">
        <Skeleton className="h-5 w-56 motion-reduce:animate-none" />
        <Skeleton className="h-36 w-full motion-reduce:animate-none" />
        <Skeleton className="h-11 w-full motion-reduce:animate-none" />
        <Skeleton className="h-11 w-full motion-reduce:animate-none" />
      </div>
    );
  }
  return <EditLoading onClose={data.data === null ? closeAndRefresh : onClose}>{body}</EditLoading>;
}

/** O carregando da edição: o rodapé só com "Fechar". */
function EditLoading({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useReportShell({ title: REPORT_FORM_TEXTS.titles.edit, onClose });
  return <>{children}</>;
}

interface EditReportBodyProps {
  data: CellReportEditData;
  saved: FormParticipant[];
  onClose: () => void;
  onCloseAndRefresh: () => void;
}

function EditReportBody({ data, saved, onClose, onCloseAndRefresh }: EditReportBodyProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { access } = useAuth();
  const { report } = data;
  const reportId = report.id ?? "";

  const stored: StoredReport = useMemo(
    () => ({
      date: report.date ?? "",
      time: report.time ?? "",
      was_held: report.was_held !== false,
      theme: report.theme,
      reason_not_held: report.reason_not_held,
      observations: report.observations,
      visitors: report.visitors,
      offering: report.offering,
    }),
    [report],
  );

  // A marca "(inativo)" das pessoas que quem edita vê (P63, AQ-5).
  const labelOf = (p: FormParticipant) =>
    p.member_visible === false
      ? p.member_name || ""
      : personLabel({
          name: p.member_name,
          is_active: p.member_is_active,
          gender: p.member_gender,
        });
  const [split] = useState(() => splitEditParticipants(saved, labelOf));
  const [hiddenIds] = useState(() => hiddenParticipantIds(saved));
  const storedParticipantIds = useMemo(() => saved.map((p) => p.member_id), [saved]);
  const hasDeletedParticipant = saved.some((p) => p.member_deleted === true);

  const statuses = useMemberStatuses([report.snapshot_leader_id, report.snapshot_timothy_id, report.snapshot_host_id]);
  const statusOf: StatusOf = (id) => (id && statuses.data ? (statuses.data.get(id) ?? null) : null);

  // O relógio da edição: o "agora" do servidor; sem o contexto, o do aparelho (em Brasília).
  const clock = useMemo(() => (data.dates ? serverClock(data.dates.serverNow) : deviceClock), [data.dates]);
  const allowedDates =
    data.dates?.allowedDates ?? (parseIsoDate(stored.date) ? editDates(spLocalMoment(deviceClock()), stored.date) : []);
  const today = data.dates?.today ?? momentDate(spLocalMoment(deviceClock()));

  const [opening] = useState(() =>
    editFormValues(
      report.cell_id ?? "",
      stored,
      split.editable.map((o) => o.value),
    ),
  );
  const participantsTotalRef = useRef(0);
  const form = useReportFormState(opening, () => ({
    dates: {
      mode: "edit",
      now: spLocalMoment(clock()),
      storedDate: stored.date,
      storedTime: stored.time,
    },
    participantsTotal: participantsTotalRef.current,
  }));
  const { values, update, errors, registerFocus } = form;
  const [chosen, setChosen] = useState<SelectOption[]>(split.editable);

  // Os fixos: as pessoas registradas que são participantes; na troca de "Não houve célula" para a
  // realizada, as três do retrato, que entram (RN-09, T9).
  const fixed = stored.was_held
    ? split.fixed
    : automaticParticipants({
        leader_id: report.snapshot_leader_id,
        leader_name: report.snapshot_leader_name,
        timothy_id: report.snapshot_timothy_id,
        timothy_name: report.snapshot_timothy_name,
        host_id: report.snapshot_host_id,
        host_name: report.snapshot_host_name,
      }).map((p) => {
        const status = statusOf(p.id);
        return status ? { ...p, name: personLabel({ name: p.name, ...status }) } : p;
      });
  const fixedIds = fixed.map((p) => p.id);
  const keptIds = split.kept.map((p) => p.id);
  const total = participantsTotal(fixedIds, values.participantIds, keptIds);
  participantsTotalRef.current = total;

  const isDirty = useCallback(() => isReportFormDirty(opening, form.valuesRef.current), [opening, form.valuesRef]);

  const save = useCellReportSave();
  const busy = save.isPending;
  const [topMessage, setTopMessage] = useState<string | null>(null);
  const [gone, setGone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!topMessage && !gone) return;
    noticeRef.current?.focus();
    noticeRef.current?.scrollIntoView?.({
      block: "start",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [topMessage, gone]);
  useEffect(() => {
    if (failure && !busy) primaryRef.current?.focus();
  }, [failure, busy]);

  const showRefusal = (refusal: ReportRefusal) => {
    switch (refusal.kind) {
      case "connection":
        setFailure(REPORT_FORM_TEXTS.connection.save);
        return;
      case "field":
        if (refusal.field === "participant_ids" && refusal.memberId && refusal.code === "deleted_member_chosen") {
          setChosen((current) => markDeletedChoice(current, refusal.memberId ?? ""));
        }
        form.showServerError(refusal.field, refusal.message);
        return;
      case "report_gone":
        setGone(refusal.message);
        return;
      case "permission":
        void refreshAccess(queryClient);
        setTopMessage(refusal.message);
        return;
      case "week_taken":
      case "gate":
        return;
      default:
        setTopMessage(refusal.message);
    }
  };

  const onSubmit = async () => {
    if (busy || gone) return;
    if (!form.validateAll()) return;
    setTopMessage(null);
    setFailure(null);
    const current = form.valuesRef.current;
    const finalParticipants = [...fixedIds, ...current.participantIds, ...keptIds];
    const payload = editPayload(stored, storedParticipantIds, current, finalParticipants);
    // Sem nenhuma mudança, nada vai ao servidor (E2.05, T5).
    if (!payload) {
      toast({ title: REPORT_FORM_TEXTS.toasts.unchanged });
      onClose();
      return;
    }
    const result = await save.save({
      reportId,
      report: payload.report,
      participantIds: payload.participantIds,
    });
    if (!result) return;
    if (result.kind === "saved") {
      toast({
        title: result.changed ? REPORT_FORM_TEXTS.toasts.updated : REPORT_FORM_TEXTS.toasts.unchanged,
      });
      onClose();
      return;
    }
    showRefusal(result.refusal);
  };

  const showHiddenWarning = hasHiddenParticipants(values.participantIds, hiddenIds);
  const switchNotice = editSwitchNotice(stored.was_held, values.held, {
    theme: values.theme,
    participants: total,
    visitors: visitorsCount(values.visitors),
    offering: offeringValue(values.offering),
    observations: values.observations,
  });
  const weekStart = data.dates?.weekStart ?? allowedDates[0] ?? stored.date;
  const weekEnd = data.dates?.weekEnd ?? stored.date;

  useReportShell({
    title: REPORT_FORM_TEXTS.titles.edit,
    onClose: gone ? onCloseAndRefresh : onClose,
    actions: gone
      ? undefined
      : {
          formId: `report-edit-${reportId}`,
          primaryLabel: REPORT_FORM_TEXTS.buttons.save,
          busyLabel: REPORT_FORM_TEXTS.buttons.saving,
          busy,
          disabled: false,
          errorCount: Object.keys(errors).length,
          failure: busy ? null : failure,
          primaryRef,
          isDirty,
          slowText: REPORT_FORM_TEXTS.slow.save,
        },
  });

  return (
    <form
      id={`report-edit-${reportId}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
      className="min-w-0 space-y-6"
    >
      {(gone || topMessage) && (
        <ReportNotice
          ref={noticeRef}
          tone="error"
          lines={[gone ?? topMessage ?? ""]}
          onClose={gone ? onCloseAndRefresh : undefined}
        />
      )}

      <div className="space-y-4">
        <RecordAuthorship entity="cell_report" recordId={reportId} recordName={formatIsoDateBr(stored.date)} isDirty={isDirty} />
        <Separator />
      </div>

      <p className="text-sm text-muted-foreground">{REPORT_FORM_TEXTS.requiredNote}</p>

      <div className="min-w-0 space-y-2">
        <p className="text-sm font-medium">{REPORT_CELL_TEXTS.label}</p>
        <CellSnapshotBlock block={cellBlockFromReport(report, statusOf)} />
      </div>

      <MeetingFieldset
        values={values}
        errors={errors}
        dates={allowedDates}
        today={today}
        dateHint={MEETING_TEXTS.editHint(formatIsoDateBr(weekStart), formatIsoDateBr(weekEnd))}
        planned={MEETING_TEXTS.planned(meetingInSentence(stored.date, stored.time))}
        notHeldDisabledReason={
          stored.was_held && hasDeletedParticipant ? REPORT_RULE_TEXTS.not_held_with_deleted_participant : null
        }
        switchNotice={switchNotice}
        onHeldChange={(held) => update({ held }, ["was_held"])}
        onDateChange={(date) => update({ date }, ["date", "time"])}
        onTimeChange={(time) => update({ time }, ["date", "time"])}
        onTimeBlur={() => form.checkTimeOnBlur(form.valuesRef.current.time !== opening.time)}
        onThemeChange={(theme) => update({ theme }, ["theme"])}
        onReasonChange={(reason) => update({ reason }, ["reason_not_held"])}
        registerFocus={registerFocus}
      />

      {values.held && (
        <HeldFields
          values={values}
          errors={errors}
          participants={{
            fixed,
            fixedHint: PARTICIPANTS_TEXTS.editHint,
            chosen,
            onChosenChange: (options) => {
              setChosen(options);
              update({ participantIds: options.map((o) => o.value) }, ["participant_ids"]);
            },
            keptLine: keptParticipantsLine(split.kept),
            scopeHint: peopleLimitedToMinistry(access) ? ACCESS_REPORT_TEXTS.participantsHint : null,
            hiddenWarning: showHiddenWarning ? ACCESS_REPORT_TEXTS.hiddenParticipants : null,
            noResultsLabel: memberSearchEmptyLabel(access),
            total,
          }}
          onVisitorsChange={(visitors) => update({ visitors }, ["visitors"])}
          onOfferingChange={(offering) => update({ offering }, ["offering"])}
          onObservationsChange={(observations) => update({ observations }, ["observations"])}
          registerFocus={registerFocus}
        />
      )}
    </form>
  );
}
