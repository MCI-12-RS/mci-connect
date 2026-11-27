// As recusas do servidor no formulário de relatório (E2.11, "Formato dos
// erros", AQ-2, T7): com `field`, a mensagem vai para o campo (`date_time` vai
// para o par Data e Horário; `participant_ids` marca o chip do `member_id`);
// sem `field`, para o `Alert` do topo. Saem os SQLSTATE dos triggers antigos
// (23514, P0001). Sem React e sem Supabase.
import { gateCode, isJsonObject, isNetworkError, isPermissionDenied, parseAppError, type JsonObject } from "@/lib/errors";
import type { ExistingReport } from "./launch-check";
import { REPORT_RULE_TEXTS } from "./texts";
import { isReportFormField, type ReportFormField } from "./validation";

export type ReportRefusal =
  /** No campo, com o foco; some quando a pessoa muda o campo. */
  | { kind: "field"; field: ReportFormField; code: string; message: string; memberId: string | null }
  /** Um por semana (RN-07): o `Alert` como o aviso (a), com a identificação para quem vê. */
  | { kind: "week_taken"; report: ExistingReport | null }
  /** A reunião ainda não aconteceu ou a semana virou com o formulário aberto: o `Alert` do topo, os campos ficam. */
  | { kind: "top"; message: string }
  /** Célula inativa, excluída, que não se vê ou em que não se pode lançar: a célula livre é desmarcada (T3 c). */
  | { kind: "cell"; reason: "inactive" | "deleted" | "not_found" | "not_allowed"; message: string }
  /** Sem permissão (RN-02, RN-03): o `Alert` do topo, e a tela relê o acesso (P13). */
  | { kind: "permission"; message: string }
  /** Na edição: o relatório sumiu, ou a célula dele foi excluída. `Alert` com "Fechar" (E2.01). */
  | { kind: "report_gone"; message: string }
  /** O portão da senha (E2.03): quem chama trata antes (troca obrigatória ou login). */
  | { kind: "gate" }
  /** Erro não reconhecido, 5xx ou rede: a mensagem de conexão no rodapé. */
  | { kind: "connection" };

const UNIQUE_VIOLATION = "23505";

const TOP_CODES = new Set(["meeting_not_yet", "report_not_current_week", "report_cell_immutable"]);

function weekTakenReport(detail: JsonObject): ExistingReport | null {
  const report = detail.report;
  if (!isJsonObject(report) || typeof report.id !== "string" || typeof report.date !== "string") return null;
  return {
    id: report.id,
    date: report.date,
    time: typeof report.time === "string" ? report.time : "",
    held: report.was_held !== false,
    canEdit: report.can_edit === true,
  };
}

/** O campo da tela para o `field` do servidor: `date_time` é o par Data e Horário, com a mensagem no Horário. */
function screenField(field: unknown): ReportFormField | null {
  if (field === "date_time") return "time";
  return isReportFormField(field) ? field : null;
}

/** Classifica a recusa de `submit_cell_report` ou de `save_cell_report`. */
export function classifyReportError(error: unknown): ReportRefusal {
  if (gateCode(error)) return { kind: "gate" };
  if (isPermissionDenied(error)) return { kind: "permission", message: REPORT_RULE_TEXTS.permission_denied };
  const refusal = parseAppError(error);
  if (refusal) {
    const { code, message, detail } = refusal;
    if (code === "report_week_taken") return { kind: "week_taken", report: weekTakenReport(detail) };
    if (code === "cell_inactive") return { kind: "cell", reason: "inactive", message };
    if (code === "cell_deleted") return { kind: "cell", reason: "deleted", message };
    if (code === "report_submit_not_allowed") return { kind: "cell", reason: "not_allowed", message };
    if (code === "not_found_or_deleted")
      return detail.entity === "cell_report"
        ? { kind: "report_gone", message: REPORT_RULE_TEXTS.report_gone }
        : { kind: "cell", reason: "not_found", message };
    if (code === "report_cell_deleted") return { kind: "report_gone", message };
    const field = screenField(detail.field);
    if (field) {
      const memberId = typeof detail.member_id === "string" ? detail.member_id : null;
      return { kind: "field", field, code, message, memberId };
    }
    // Sem campo: o texto do Negócio vai para o topo (AQ-2). Os códigos técnicos viram a mensagem de conexão.
    if (TOP_CODES.has(code) || (code === "" && message)) return { kind: "top", message };
    return { kind: "connection" };
  }
  if (isNetworkError(error)) return { kind: "connection" };
  // A corrida que escapou da trava: o índice único da semana (reserva da AQ-2).
  if (isJsonObject(error) && error.code === UNIQUE_VIOLATION) return { kind: "week_taken", report: null };
  return { kind: "connection" };
}
