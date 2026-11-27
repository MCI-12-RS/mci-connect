// Participantes no formulário de relatório (E1.08, PR 2 e PR 4; E2.01, RN-13).
import type { FormParticipant, ReportParticipant } from "@/lib/cell-reports/fields";
import { CELL_REPORT_DELETION_TEXTS } from "@/lib/deletion/texts";
import { formatList } from "@/lib/format";
import { UNNAMED_MEMBER_LABEL } from "@/lib/members/fields";
import type { SelectOption } from "@/lib/selectors";

/**
 * Participantes já salvos como opções selecionadas do seletor, na ordem em que
 * vieram. O nome vem da `cell_report_participants_view` (RN-06), então eles
 * aparecem com o nome mesmo que não estejam entre as opções carregadas
 * (inativos, fora do escopo ou numa página ainda não carregada).
 */
export function toParticipantOptions(saved: readonly ReportParticipant[]): SelectOption[] {
  return saved.map((p) => ({ value: p.member_id, label: p.member_name || UNNAMED_MEMBER_LABEL }));
}

/** Participante de cadastro excluído que continua no relatório (RN-13). */
export interface KeptParticipant {
  id: string;
  name: string;
}

export interface SavedParticipants {
  /** Os que o formulário mostra no seletor e deixa retirar: cadastros não excluídos. */
  editable: SelectOption[];
  /** Os de cadastro excluído: ficam fora do seletor, sem ✕, e continuam no relatório (UXD-8). */
  kept: KeptParticipant[];
}

/**
 * Separa os participantes salvos de um relatório: os de cadastro excluído
 * (`member_deleted`) não voltam ao seletor, porque não podem ser escolhidos de
 * novo (RN-06) nem retirados (RN-13). Mantém a ordem em que vieram.
 */
export function splitSavedParticipants(saved: readonly ReportParticipant[]): SavedParticipants {
  const editable = toParticipantOptions(saved.filter((p) => p.member_deleted !== true));
  const kept = saved
    .filter((p) => p.member_deleted === true)
    .map((p) => ({ id: p.member_id, name: p.member_name || UNNAMED_MEMBER_LABEL }));
  return { editable, kept };
}

/**
 * O conjunto final de participantes para a `save_cell_report` (que absorveu a
 * `set_cell_report_participants` no E2.11): os escolhidos no seletor mais os de
 * cadastro excluído, sem mudança e sem repetição (RN-13, DT-15). Quem falta na
 * lista é retirado do relatório (o banco recusa retirar as pessoas registradas
 * numa célula realizada, RN-11 do E2.11).
 */
export function finalParticipantIds(chosenIds: readonly string[], kept: readonly KeptParticipant[]): string[] {
  return [...new Set([...chosenIds, ...kept.map((p) => p.id)])];
}

/** "Continuam no relatório (cadastros excluídos): {nomes}."; `null` sem nenhum. */
export function keptParticipantsLine(kept: readonly KeptParticipant[]): string | null {
  if (kept.length === 0) return null;
  return CELL_REPORT_DELETION_TEXTS.deletedParticipants(formatList(kept.map((p) => p.name)));
}

/**
 * Marca "(cadastro excluído)" no participante que foi excluído entre a escolha
 * e o envio (UX-30). Ele continua escolhido, com ✕, para ser retirado. Marcar
 * de novo não repete a marca.
 */
export function markDeletedChoice(options: readonly SelectOption[], memberId: string): SelectOption[] {
  const mark = CELL_REPORT_DELETION_TEXTS.chosenDeletedMark;
  return options.map((option) =>
    option.value === memberId && !option.label.endsWith(mark) ? { ...option, label: `${option.label} ${mark}` } : option,
  );
}

/**
 * Os participantes salvos que quem edita não vê (E2.02, RN-09, AQ-7): ficam
 * no relatório e como chips, mas o seletor não os oferece de volta. Os de
 * cadastro excluído ficam de fora: eles já têm a linha própria (RN-13 do E2.01).
 */
export function hiddenParticipantIds(saved: readonly FormParticipant[]): string[] {
  return saved.filter((p) => p.member_visible === false && p.member_deleted !== true).map((p) => p.member_id);
}

/** Algum dos participantes escolhidos é de quem a pessoa não vê? Dá o aviso da T8, só enquanto houver algum. */
export function hasHiddenParticipants(chosenIds: readonly string[], hiddenIds: readonly string[]): boolean {
  return chosenIds.some((id) => hiddenIds.includes(id));
}
