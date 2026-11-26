// O que mudou no formulário de relatório (E2.05, T5 e UXD-9), no molde do
// `changedMemberFields` do E2.04 e do `changedCellFields` do E2.08. Sem React
// e sem Supabase.
import type { CellReportWrite } from "./report-form";

/** O relatório como o formulário o gravaria, e o conjunto de participantes. */
export interface CellReportSnapshot {
  report: CellReportWrite;
  /**
   * Os participantes. No gravado, todos os salvos (inclusive os que a pessoa
   * não vê e os de cadastro excluído). No formulário, o conjunto final que iria
   * para o servidor, ou `null` quando ele não mexe nos participantes ("Não
   * houve célula").
   */
  participantIds: readonly string[] | null;
}

const TEXT_FIELDS = ["cell_id", "date", "reason_not_held", "theme", "observations"] as const;

/** O vazio e o nulo são iguais; o resto é comparado como foi digitado (o banco não apara). */
const sameText = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");

/** "19:00:00" gravado e "19:00" no campo são o mesmo horário. */
const sameTime = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").slice(0, 5) === (b ?? "").slice(0, 5);

const sameList = (a: readonly string[] | null | undefined, b: readonly string[] | null | undefined) => {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((value, index) => value === right[index]);
};

/** Os participantes como conjunto: a ordem de escolha não muda o relatório. */
const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/**
 * Algo mudou entre o relatório aberto (`stored`) e o formulário (`current`)?
 * "Mudou" é o valor final diferente do carregado: digitar e voltar ao valor
 * original não conta. Os participantes contam (RN-04 a), a não ser quando o
 * formulário não os envia.
 */
export function isCellReportChanged(stored: CellReportSnapshot, current: CellReportSnapshot): boolean {
  const before = stored.report;
  const after = current.report;
  if (TEXT_FIELDS.some((field) => !sameText(before[field], after[field]))) return true;
  if (!sameTime(before.time, after.time)) return true;
  if ((before.was_held ?? true) !== (after.was_held ?? true)) return true;
  if ((before.offering ?? 0) !== (after.offering ?? 0)) return true;
  if (!sameList(before.visitors, after.visitors)) return true;
  if (current.participantIds === null) return false;
  return !sameSet(stored.participantIds ?? [], current.participantIds);
}
