// Participantes no formulário de relatório (E1.08, PR 2 e PR 4).
import type { ReportParticipant } from "@/lib/cell-reports/fields";
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
