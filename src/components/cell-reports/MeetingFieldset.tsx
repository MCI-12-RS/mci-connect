import { useEffect, useRef } from "react";
import { Info } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { TimeInput } from "@/components/form/TimeInput";
import { FieldError, FieldHint } from "@/components/members/FormFieldParts";
import type { FocusTarget, ShownReportErrors } from "@/hooks/use-report-form-state";
import { describedBy, fieldA11yProps } from "@/lib/a11y";
import type { ReportFormField, ReportFormValues } from "@/lib/cell-reports/validation";
import { MEETING_TEXTS, REPORT_FORM_TEXTS } from "@/lib/cell-reports/texts";
import { cn } from "@/lib/utils";
import { DateSelect } from "./DateSelect";

export interface MeetingFieldsetProps {
  values: Pick<ReportFormValues, "held" | "date" | "time" | "theme" | "reason">;
  errors: ShownReportErrors;
  dates: string[];
  today: string;
  /** "Entre quarta, 25/11/2026, às 20:00, e agora." ou a semana do relatório. */
  dateHint: string;
  /** "Reunião prevista: …", em "Não houve célula". */
  planned: string;
  /** "Não houve célula" desabilitada, com o motivo (P5, T9). */
  notHeldDisabledReason?: string | null;
  /** O que sai na troca de situação (P20). */
  switchNotice?: string | null;
  /** "Data e horário trocados pela reunião desta célula." (T2). */
  cellSwitched?: boolean;
  disabled?: boolean;
  onHeldChange: (held: boolean) => void;
  onDateChange: (date: string) => void;
  onTimeChange: (time: string) => void;
  onTimeBlur: () => void;
  onThemeChange: (theme: string) => void;
  onReasonChange: (reason: string) => void;
  registerFocus: (field: ReportFormField, target: FocusTarget | null) => void;
}

const OPTION = "flex min-h-11 cursor-pointer items-start gap-2 rounded-md border p-3 text-sm leading-snug";

/**
 * O grupo "Reunião" (E2.11, T4): a situação em duas opções lado a lado
 * (P106), a data (P104), o horário digitado (P62) e o tema; em "Não houve
 * célula", a reunião prevista e o Motivo.
 */
export function MeetingFieldset(props: MeetingFieldsetProps) {
  const { values, errors, registerFocus } = props;
  const dateRef = useRef<HTMLButtonElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const themeRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const heldRef = useRef<HTMLButtonElement>(null);
  const notHeldRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    registerFocus("was_held", () => (values.held ? heldRef : notHeldRef).current?.focus());
    registerFocus("date", () => (dateRef.current ?? timeRef.current)?.focus());
    registerFocus("time", () => (timeRef.current ?? dateRef.current)?.focus());
    registerFocus("theme", () => themeRef.current?.focus());
    registerFocus("reason_not_held", () => reasonRef.current?.focus());
  }, [registerFocus, values.held]);

  const pairError = errors.time;
  const situationIds = describedBy(
    errors.was_held && "was_held-error",
    props.notHeldDisabledReason && "was_held-reason",
    props.switchNotice && "was_held-notice",
  );

  return (
    <fieldset className="min-w-0 space-y-4">
      <legend id="meeting-legend" className="mb-3 text-base font-semibold">
        {MEETING_TEXTS.legend}
      </legend>

      <div className="space-y-2">
        <RadioGroup
          value={values.held ? "held" : "not_held"}
          onValueChange={(value) => props.onHeldChange(value === "held")}
          aria-labelledby="meeting-legend"
          aria-required="true"
          aria-describedby={situationIds}
          className="grid grid-cols-2 gap-2 md:flex md:flex-wrap"
          disabled={props.disabled}
        >
          <Label htmlFor="was_held-held" className={cn(OPTION, values.held && "border-primary")}>
            <RadioGroupItem ref={heldRef} id="was_held-held" value="held" className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">{MEETING_TEXTS.held}</span>
          </Label>
          <Label
            htmlFor="was_held-not_held"
            className={cn(
              OPTION,
              !values.held && "border-primary",
              props.notHeldDisabledReason && "cursor-not-allowed opacity-60",
            )}
          >
            <RadioGroupItem
              ref={notHeldRef}
              id="was_held-not_held"
              value="not_held"
              className="mt-0.5 shrink-0"
              disabled={!!props.notHeldDisabledReason}
            />
            <span className="min-w-0 break-words">{MEETING_TEXTS.notHeld}</span>
          </Label>
        </RadioGroup>
        {errors.was_held && <FieldError id="was_held-error">{errors.was_held}</FieldError>}
        {props.notHeldDisabledReason && <FieldHint id="was_held-reason">{props.notHeldDisabledReason}</FieldHint>}
        <p id="was_held-notice" role="status" className="flex items-start gap-1.5 text-sm text-foreground empty:hidden">
          {props.switchNotice && (
            <>
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{props.switchNotice}</span>
            </>
          )}
        </p>
      </div>

      {values.held ? (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <DateSelect
                id="report-date"
                ref={dateRef}
                value={values.date}
                dates={props.dates}
                today={props.today}
                error={errors.date}
                describedBy={describedBy(pairError && "report-time-error", "report-date-hint")}
                onChange={props.onDateChange}
                disabled={props.disabled}
              />
              {errors.date && <FieldError id="report-date-error">{errors.date}</FieldError>}
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="report-time">
                {MEETING_TEXTS.time}
                {REPORT_FORM_TEXTS.required}
              </Label>
              <TimeInput
                id="report-time"
                ref={timeRef}
                value={values.time}
                onValueChange={props.onTimeChange}
                onBlur={props.onTimeBlur}
                required
                enterKeyHint="next"
                disabled={props.disabled}
                className={cn(pairError && "border-destructive")}
                aria-invalid={pairError ? true : undefined}
                aria-describedby={describedBy(
                  pairError && "report-time-error",
                  "report-date-hint",
                  props.cellSwitched && "report-cell-switched",
                )}
              />
            </div>
          </div>
          <div className="space-y-2">
            {pairError && <FieldError id="report-time-error">{pairError}</FieldError>}
            <FieldHint id="report-date-hint">{props.dateHint}</FieldHint>
            <p id="report-cell-switched" role="status" className="flex items-start gap-1.5 text-sm text-foreground empty:hidden">
              {props.cellSwitched && (
                <>
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{MEETING_TEXTS.cellSwitched}</span>
                </>
              )}
            </p>
          </div>

          <div className="min-w-0 space-y-2">
            <Label htmlFor="report-theme">
              {MEETING_TEXTS.theme}
              {REPORT_FORM_TEXTS.required}
            </Label>
            <Input
              id="report-theme"
              ref={themeRef}
              value={values.theme}
              onChange={(event) => props.onThemeChange(event.target.value)}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="next"
              required
              disabled={props.disabled}
              className={cn(errors.theme && "border-destructive")}
              {...fieldA11yProps("report-theme", { error: errors.theme })}
            />
            {errors.theme && <FieldError id="report-theme-error">{errors.theme}</FieldError>}
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-foreground">{props.planned}</p>
          <div className="min-w-0 space-y-2">
            <Label htmlFor="report-reason">
              {MEETING_TEXTS.reason}
              {REPORT_FORM_TEXTS.required}
            </Label>
            <FieldHint id="report-reason-hint">{MEETING_TEXTS.reasonHint}</FieldHint>
            <Textarea
              id="report-reason"
              ref={reasonRef}
              rows={3}
              value={values.reason}
              onChange={(event) => props.onReasonChange(event.target.value)}
              autoCapitalize="sentences"
              required
              disabled={props.disabled}
              className={cn("min-h-0 text-base md:text-sm", errors.reason_not_held && "border-destructive")}
              aria-invalid={errors.reason_not_held ? true : undefined}
              aria-describedby={describedBy(errors.reason_not_held && "report-reason-error", "report-reason-hint")}
            />
            {errors.reason_not_held && <FieldError id="report-reason-error">{errors.reason_not_held}</FieldError>}
          </div>
        </>
      )}
    </fieldset>
  );
}
