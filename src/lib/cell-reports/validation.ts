// A conferência do formulário de relatório ao enviar (E2.11, RN-04 a RN-13,
// RN-16, RN-20, P22, T7): todos os erros de uma vez, na ordem da tela. A regra
// vale no banco; a tela só a replica. Sem React e sem Supabase.
import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { isValidHhmm } from "@/lib/time/hhmm";
import { addDays, editRule, launchRule, momentInSentence, toFullTime, weekStart, type LocalMoment } from "./dates";
import { REPORT_LIMITS } from "./limits";
import { offeringValue } from "./offering";
import { REPORT_RULE_TEXTS } from "./texts";
import { normalizeVisitorName, visitorsToSend } from "./visitors";

/** Os valores do formulário. A data é "aaaa-mm-dd"; o horário, "HH:mm" como digitado; a oferta, o texto do campo. */
export interface ReportFormValues {
  cellId: string;
  held: boolean;
  date: string;
  time: string;
  theme: string;
  reason: string;
  /** Os escolhidos no seletor (sem os fixos e sem os de cadastro excluído). */
  participantIds: string[];
  visitors: string[];
  offering: string;
  observations: string;
}

/** Os campos que recebem erro, na ordem da tela (T1). `date_time` do servidor vai para o Horário. */
export const REPORT_FORM_FIELDS = [
  "cell_id",
  "was_held",
  "date",
  "time",
  "theme",
  "reason_not_held",
  "participant_ids",
  "visitors",
  "offering",
  "observations",
] as const;

export type ReportFormField = (typeof REPORT_FORM_FIELDS)[number];

export function isReportFormField(value: unknown): value is ReportFormField {
  return typeof value === "string" && (REPORT_FORM_FIELDS as readonly string[]).includes(value);
}

export interface ReportFieldError {
  field: ReportFormField;
  code: string;
  message: string;
}

/** As datas contra as quais a tela confere (com o "agora" do servidor). Sem elas, só o preenchimento. */
export type ReportDateRule =
  | { mode: "launch"; now: LocalMoment; meeting: LocalMoment }
  | { mode: "edit"; now: LocalMoment; storedDate: string; storedTime: string };

export interface ReportValidationContext {
  dates: ReportDateRule | null;
  /** O total de participantes, como a tela mostra (RN-11). */
  participantsTotal: number;
}

const blank = (text: string) => text.trim() === "";

/** Ao sair do Horário alterado e preenchido: só o formato (P62). */
export function validateTimeOnBlur(time: string): ReportFieldError | null {
  if (blank(time) || isValidHhmm(time)) return null;
  return { field: "time", code: "report_time_invalid", message: REPORT_RULE_TEXTS.report_time_invalid };
}

function dateErrors(values: ReportFormValues, rule: ReportDateRule): ReportFieldError | null {
  if (rule.mode === "launch") {
    const result = launchRule({
      now: rule.now,
      meeting: rule.meeting,
      held: true,
      date: values.date,
      time: values.time,
      weekHasReport: false,
    });
    if (result.code === "report_in_future")
      return { field: "time", code: result.code, message: REPORT_RULE_TEXTS.report_in_future };
    if (result.code === "report_before_meeting")
      return {
        field: "time",
        code: result.code,
        message: REPORT_RULE_TEXTS.report_before_meeting(momentInSentence(rule.meeting)),
      };
    if (result.code === "report_not_current_week") {
      const start = weekStart(rule.now.slice(0, 10));
      return {
        field: "date",
        code: result.code,
        message: REPORT_RULE_TEXTS.report_not_current_week(formatIsoDateBr(start), formatIsoDateBr(addDays(start, 6))),
      };
    }
    return null;
  }
  const momentChanged = values.date !== rule.storedDate || toFullTime(values.time) !== toFullTime(rule.storedTime);
  const code = editRule({ now: rule.now, storedDate: rule.storedDate, date: values.date, time: values.time, momentChanged });
  if (code === "report_week_locked") {
    const start = weekStart(rule.storedDate);
    return {
      field: "date",
      code,
      message: REPORT_RULE_TEXTS.report_week_locked(formatIsoDateBr(start), formatIsoDateBr(addDays(start, 6))),
    };
  }
  if (code === "report_in_future") return { field: "time", code, message: REPORT_RULE_TEXTS.report_in_future };
  return null;
}

/** Todos os erros de uma vez, na ordem da tela (RN-20, P22). */
export function validateReportForm(values: ReportFormValues, context: ReportValidationContext): ReportFieldError[] {
  const errors: ReportFieldError[] = [];
  const push = (field: ReportFormField, code: keyof typeof REPORT_RULE_TEXTS & string) => {
    const message = REPORT_RULE_TEXTS[code];
    if (typeof message === "string") errors.push({ field, code, message });
  };

  // Sem a célula, os outros campos não estão na tela (UXD-2): só o erro dela.
  if (blank(values.cellId)) {
    push("cell_id", "cell_required");
    return errors;
  }

  if (!values.held) {
    if (blank(values.reason)) push("reason_not_held", "reason_required");
    else if (values.reason.trim().length > REPORT_LIMITS.reason) push("reason_not_held", "reason_too_long");
    return errors;
  }

  let dateOk = true;
  if (blank(values.date)) {
    push("date", "report_date_required");
    dateOk = false;
  }
  let timeOk = true;
  if (blank(values.time)) {
    push("time", "report_time_required");
    timeOk = false;
  } else if (!isValidHhmm(values.time)) {
    push("time", "report_time_invalid");
    timeOk = false;
  }
  if (dateOk && timeOk && context.dates) {
    const error = dateErrors(values, context.dates);
    if (error) errors.push(error);
  }

  if (blank(values.theme)) push("theme", "theme_required");
  else if (values.theme.trim().length > REPORT_LIMITS.theme) push("theme", "theme_too_long");

  if (context.participantsTotal > REPORT_LIMITS.participants) push("participant_ids", "too_many_participants");

  const names = visitorsToSend(values.visitors);
  if (names.length > REPORT_LIMITS.visitors) push("visitors", "too_many_visitors");
  else if (values.visitors.some((name) => normalizeVisitorName(name).length > REPORT_LIMITS.visitorName))
    push("visitors", "visitor_name_too_long");

  const offering = offeringValue(values.offering);
  if (offering === null) push("offering", "offering_required");
  else if (offering > REPORT_LIMITS.offeringMax) push("offering", "offering_too_large");

  if (values.observations.trim().length > REPORT_LIMITS.observations) push("observations", "observations_too_long");

  return errors;
}
