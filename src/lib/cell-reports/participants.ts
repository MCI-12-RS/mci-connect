// Participantes no formulário de relatório (E1.08, PR 2).
import type { ReportParticipant } from "@/lib/cell-reports/fields";

export interface MemberOption {
  value: string;
  label: string;
}

/**
 * Opções selecionadas do seletor de participantes, na ordem dos ids. O nome
 * dos participantes já salvos vem da `cell_report_participants_view`, então
 * eles aparecem com o nome mesmo fora da lista de opções (inativos, fora do
 * escopo ou além das 1000 linhas). Os demais vêm das opções.
 */
export function toSelectedParticipantOptions(
  ids: readonly string[],
  options: readonly MemberOption[],
  saved: readonly ReportParticipant[],
): MemberOption[] {
  const names = new Map(options.map((o) => [o.value, o.label]));
  for (const p of saved) if (p.member_name) names.set(p.member_id, p.member_name);
  return ids.map((id) => ({ value: id, label: names.get(id) ?? "Membro sem nome" }));
}
