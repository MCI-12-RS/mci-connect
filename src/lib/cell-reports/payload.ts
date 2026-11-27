// O que vai ao servidor (E2.11, "Chamada pelo front"): a chamada do
// lançamento (`submit_cell_report`) e o PATCH da edição (`save_cell_report`),
// só com o que mudou (E2.05, T5). Sem React e sem Supabase.
import type { Json } from "@/integrations/supabase/types";
import { toHhmm } from "@/lib/time/hhmm";
import { formatOffering, offeringValue } from "./offering";
import type { ReportFormValues } from "./validation";
import { visitorFields, visitorsToSend } from "./visitors";

const optional = (text: string): string | null => (text.trim() === "" ? null : text.trim());

/** O relatório do lançamento: em "Não houve célula", só a célula, a situação e o motivo (RN-09). */
export function toSubmitReport(values: ReportFormValues): { [key: string]: Json } {
  if (!values.held) return { cell_id: values.cellId, was_held: false, reason_not_held: values.reason.trim() };
  return {
    cell_id: values.cellId,
    was_held: true,
    date: values.date,
    time: values.time,
    theme: values.theme.trim(),
    observations: optional(values.observations),
    visitors: visitorsToSend(values.visitors),
    offering: offeringValue(values.offering),
  };
}

/** Os escolhidos do lançamento: os automáticos entram pelo servidor; em "Não houve célula", nenhum. */
export const toSubmitParticipants = (values: ReportFormValues): string[] => (values.held ? [...values.participantIds] : []);

/** O relatório gravado, como a edição o compara. */
export interface StoredReport {
  date: string;
  time: string;
  was_held: boolean;
  theme: string | null;
  reason_not_held: string | null;
  observations: string | null;
  visitors: string[] | null;
  offering: number | null;
}

/** Os valores de abertura da edição a partir do gravado. */
export function editFormValues(cellId: string, stored: StoredReport, participantIds: string[]): ReportFormValues {
  return {
    cellId,
    held: stored.was_held,
    date: stored.date,
    time: toHhmm(stored.time),
    theme: stored.theme ?? "",
    reason: stored.reason_not_held ?? "",
    participantIds,
    visitors: visitorFields(stored.visitors),
    // Em "Não houve célula", o 0 gravado não é uma resposta (P-REL-11): só a oferta maior que zero aparece.
    offering: stored.was_held || (stored.offering ?? 0) > 0 ? formatOffering(stored.offering) : "",
    observations: stored.observations ?? "",
  };
}

const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();
const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

export interface EditPayload {
  /** Só as chaves que mudam. */
  report: { [key: string]: Json };
  /** O conjunto final de participantes, ou `null` para não mexer. */
  participantIds: string[] | null;
}

/**
 * O PATCH da edição: só o que ficou diferente do gravado. Em "Não houve
 * célula", vão só a situação e o motivo (o servidor apaga o resto na troca e
 * ignora na que continua, DA-3). `finalParticipants` é o conjunto que a tela
 * mostra (fixos, escolhidos e excluídos). `null` quando nada mudou.
 */
export function editPayload(
  stored: StoredReport,
  storedParticipants: readonly string[],
  values: ReportFormValues,
  finalParticipants: readonly string[],
): EditPayload | null {
  const report: { [key: string]: Json } = {};
  if (stored.was_held !== values.held) report.was_held = values.held;
  if (!values.held) {
    if (!sameText(stored.reason_not_held, values.reason)) report.reason_not_held = values.reason.trim();
    return Object.keys(report).length > 0 ? { report, participantIds: null } : null;
  }
  if (stored.date !== values.date) report.date = values.date;
  if (toHhmm(stored.time) !== values.time) report.time = values.time;
  if (!sameText(stored.theme, values.theme)) report.theme = values.theme.trim();
  if (!sameText(stored.observations, values.observations)) report.observations = optional(values.observations);
  const visitors = visitorsToSend(values.visitors);
  if (!sameList(stored.visitors ?? [], visitors)) report.visitors = visitors;
  const offering = offeringValue(values.offering);
  // Na troca para a célula realizada, a oferta vai sempre: ela passa a ser obrigatória (RN-13).
  if (!stored.was_held || stored.offering !== offering) report.offering = offering;
  const participantsChanged = !stored.was_held || !sameSet(storedParticipants, finalParticipants);
  const participantIds = participantsChanged ? [...new Set(finalParticipants)] : null;
  if (Object.keys(report).length === 0 && participantIds === null) return null;
  return { report, participantIds };
}

/** Alguma diferença em relação à abertura (fechar pede a confirmação; UXD-14 do E2.04). */
export function isReportFormDirty(opening: ReportFormValues, current: ReportFormValues): boolean {
  return (
    opening.cellId !== current.cellId ||
    opening.held !== current.held ||
    opening.date !== current.date ||
    opening.time !== current.time ||
    !sameText(opening.theme, current.theme) ||
    !sameText(opening.reason, current.reason) ||
    !sameSet(opening.participantIds, current.participantIds) ||
    !sameList(visitorsToSend(opening.visitors), visitorsToSend(current.visitors)) ||
    opening.offering !== current.offering ||
    !sameText(opening.observations, current.observations)
  );
}
