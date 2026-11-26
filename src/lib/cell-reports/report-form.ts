// Gravação do formulário de relatório: os dados enviados e o que a tela faz
// com cada falha (E2.01, T7, T8, DT-19 e "Estados").
import { AUDIT_SAVE_TEXTS } from "@/lib/audit/texts";
import { CELL_INACTIVE } from "@/lib/cells/codes";
import type { Database } from "@/integrations/supabase/types";
import { isJsonObject, isNetworkError, isPermissionDenied, parseAppError, type AppError } from "@/lib/errors";
import { DELETION_TEXTS } from "@/lib/deletion/texts";
import type { DeletionErrorCode } from "@/lib/deletion/codes";

/** Textos do formulário de relatório. */
export const CELL_REPORT_FORM_TEXTS = {
  saved: "Relatório salvo com sucesso",
  buttons: {
    save: "Salvar",
    /** Enquanto envia: desabilitado, sem envio duplo (E2.05, T5). */
    saving: "Salvando…",
  },
  weekTaken: "Já existe um relatório dessa célula nesta semana (domingo a sábado).",
  outsideCurrentWeek: "A data do relatório precisa estar dentro da semana atual (de domingo a sábado).",
  /**
   * Falha da Auditoria, do servidor ou da rede, ou erro que a tela não reconhece: nada foi gravado, e a
   * mensagem fica junto de "Salvar" (E2.05, T5, RN-14 e AQ-8).
   */
  connection: AUDIT_SAVE_TEXTS.connection.report,
  /** Não está no spec: os participantes salvos não carregaram na edição (e Salvar fica desabilitado). */
  participantsLoadFailed: "Não foi possível carregar os participantes. Tente de novo para poder salvar.",
} as const;

/**
 * Campos do formulário que vão para o relatório. Opcionais como no tipo que o
 * zod infere; o esquema do formulário já exige a célula, a data e o horário.
 */
export interface ReportFormInput {
  cell_id?: string;
  date?: string;
  time?: string;
  was_held?: boolean;
  reason_not_held?: string;
  theme?: string;
  observations?: string;
  /** Nomes separados por vírgula. */
  visitors?: string;
  offering?: number;
}

export type CellReportWrite = Pick<
  Database["public"]["Tables"]["cell_reports"]["Insert"],
  "cell_id" | "date" | "time" | "was_held" | "reason_not_held" | "theme" | "observations" | "visitors" | "offering"
>;

/** Nomes dos visitantes, sem os vazios: "João, , Maria " → ["João", "Maria"]. */
export function parseVisitors(text: string | undefined): string[] {
  return (text ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Texto opcional: vazio ou só espaços vira nulo. O banco compara o valor gravado
 * antes e depois (E2.05, RN-04): sem isso, o campo vazio que abriu como nulo
 * contaria como alterado em qualquer edição.
 */
function optionalText(text: string | undefined): string | null {
  return text && text.trim() !== "" ? text : null;
}

/** O relatório a gravar. "Não houve célula" grava só o motivo, sem tema, visitantes nem oferta. */
export function toReportWrite(values: ReportFormInput): CellReportWrite {
  const held = values.was_held !== false;
  return {
    cell_id: values.cell_id,
    date: values.date,
    time: values.time,
    was_held: held,
    reason_not_held: held ? null : optionalText(values.reason_not_held),
    theme: held ? optionalText(values.theme) : null,
    observations: held ? optionalText(values.observations) : null,
    visitors: held ? parseVisitors(values.visitors) : [],
    offering: held ? (values.offering ?? 0) : 0,
  };
}

export type ReportSaveFailure =
  /** O relatório não existe mais ou foi excluído (DT-19): `Alert` no topo, com "Fechar". */
  | { kind: "gone" }
  /**
   * Regra que o formulário não resolve (célula excluída, RN-06 e RN-11): `Alert` no topo; o formulário fica
   * (UX-28, UX-30). `cellDeleted`: a célula do relatório foi excluída; só outra célula resolveria.
   */
  | { kind: "blocked"; message: string; cellDeleted: boolean }
  /**
   * Problema nos participantes escolhidos: mensagem embaixo do campo e, se houver, o membro excluído (UX-30).
   * Um participante que a pessoa não vê (RN-09 b do E2.02) vem sem membro: não é cadastro excluído.
   */
  | { kind: "participants"; message: string; memberId: string | null }
  /**
   * Recusa por escopo ou por função (E2.02, T8 e T11): `Alert` no topo, com o formulário como estava, e a
   * tela relê o acesso (P13). `clearCell`: a pessoa não pode lançar nesta célula (RN-13); a célula é
   * desmarcada e o seletor recarrega.
   */
  | { kind: "refused"; message: string; clearCell: boolean }
  /**
   * A célula foi inativada enquanto o formulário estava aberto (E2.08, RN-11 c, T8): `Alert` no topo, com
   * a orientação conforme quem lê pode editar a célula (`cellInactiveReportMessage`). A tela desatualiza
   * a lista de células e o acesso.
   */
  | { kind: "cellInactive" }
  /** Regra da semana (REL-02, REL-03) ou texto de trigger: o toast com a mensagem, e o formulário como estava. */
  | { kind: "error"; message: string }
  /**
   * Nada foi gravado por falha da Auditoria, do servidor ou da rede, ou por um erro sem regra conhecida
   * (E2.05, T5, RN-14): a mensagem de conexão junto de "Salvar", com os dados mantidos.
   */
  | { kind: "connection" };

const PARTICIPANT_CODES: ReadonlySet<string> = new Set<DeletionErrorCode>(["deleted_member_chosen", "too_many_participants"]);
const CELL_DELETED_CODES: ReadonlySet<string> = new Set<DeletionErrorCode>(["cell_deleted", "report_cell_deleted"]);

function fromRefusal(refusal: AppError): ReportSaveFailure {
  if (refusal.code === CELL_INACTIVE) return { kind: "cellInactive" };
  if (refusal.code === "not_found_or_deleted") {
    // No lançamento, a célula que a pessoa não vê é tratada como inexistente (E2.02, RN-09 a, AQ-5).
    if (refusal.detail.entity === "cell") return { kind: "blocked", message: refusal.message, cellDeleted: true };
    return { kind: "gone" };
  }
  if (refusal.code === "report_submit_not_allowed") return { kind: "refused", message: refusal.message, clearCell: true };
  if (refusal.code === "person_not_visible") return { kind: "participants", message: refusal.message, memberId: null };
  if (PARTICIPANT_CODES.has(refusal.code)) {
    const memberId = refusal.detail.member_id;
    return { kind: "participants", message: refusal.message, memberId: typeof memberId === "string" ? memberId : null };
  }
  // cell_deleted, report_cell_deleted, deleted_participant_removal, would_leave_scope e regras futuras: a mensagem do Negócio.
  return { kind: "blocked", message: refusal.message, cellDeleted: CELL_DELETED_CODES.has(refusal.code) };
}

/** SQLSTATE das regras de semana (triggers de `cell_reports` e o índice único da semana). */
const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
/** Erro levantado por um trigger com texto próprio (`RAISE EXCEPTION '…'`). */
const RAISED_BY_TRIGGER = "P0001";

/** O texto de um erro, se ele tiver um. */
function errorMessage(error: unknown): string | null {
  return isJsonObject(error) && typeof error.message === "string" && error.message ? error.message : null;
}

/**
 * Um `CHECK` de tabela recusou (a mensagem do Postgres cita a constraint), e
 * não o trigger da semana, que levanta o 23514 com o texto dele. Não é regra
 * que a tela conheça: por exemplo, a falha da Auditoria (E2.05, DT-18).
 */
function isTableCheckViolation(error: unknown): boolean {
  return /violates check constraint/i.test(errorMessage(error) ?? "");
}

/** Classifica a falha ao gravar o relatório com os participantes. */
export function classifyReportSaveError(error: unknown): ReportSaveFailure {
  if (isPermissionDenied(error)) return { kind: "refused", message: DELETION_TEXTS.permissionDenied, clearCell: false };
  const refusal = parseAppError(error);
  if (refusal) return fromRefusal(refusal);
  if (isNetworkError(error)) return { kind: "connection" };
  switch (isJsonObject(error) ? error.code : null) {
    // Um relatório por célula por semana (REL-03): o trigger e, na corrida, o índice único.
    case UNIQUE_VIOLATION:
      return { kind: "error", message: CELL_REPORT_FORM_TEXTS.weekTaken };
    // Só a semana atual (REL-02).
    case CHECK_VIOLATION:
      return isTableCheckViolation(error)
        ? { kind: "connection" }
        : { kind: "error", message: CELL_REPORT_FORM_TEXTS.outsideCurrentWeek };
    case RAISED_BY_TRIGGER: {
      const message = errorMessage(error);
      return message ? { kind: "error", message } : { kind: "connection" };
    }
    default:
      return { kind: "connection" };
  }
}
