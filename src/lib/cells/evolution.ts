// A evolução da célula (E2.10, RN-20, T12, P83): os pontos do gráfico e da
// tabela, a partir dos relatórios de `cell_recent_reports` (do mais recente
// para o mais antigo). Sem React e sem Supabase.
import { formatIsoDateBr } from "@/lib/dates/sao-paulo";
import { CELL_DETAIL_TEXTS } from "./detail-texts";

export interface EvolutionPoint {
  id: string;
  /** "aaaa-mm-dd". */
  date: string;
  /** "dd/mm", no eixo X. */
  shortDate: string;
  /** "dd/mm/aaaa", na tabela e no resumo. */
  fullDate: string;
  held: boolean;
  /** Nulo em "Não houve célula": um intervalo na linha, nunca zero (RN-20). */
  participants: number | null;
  visitors: number | null;
}

interface EvolutionSource {
  id: string;
  date: string;
  was_held: boolean | null;
  participants_count: number | null;
  visitors_count: number | null;
}

/**
 * Os pontos em ordem cronológica (o mais antigo primeiro), um por relatório.
 * Na célula realizada, os dois números (zero quando não vier); em "Não houve
 * célula", os dois nulos.
 */
export function toEvolutionPoints(reports: readonly EvolutionSource[]): EvolutionPoint[] {
  return [...reports].reverse().map((report) => {
    const held = report.was_held !== false;
    const fullDate = formatIsoDateBr(report.date);
    return {
      id: report.id,
      date: report.date,
      shortDate: fullDate.slice(0, 5),
      fullDate,
      held,
      participants: held ? (report.participants_count ?? 0) : null,
      visitors: held ? (report.visitors_count ?? 0) : null,
    };
  });
}

/** Há algum "Não houve célula"? A legenda ganha o item do "×" só nesse caso. */
export function hasNotHeld(points: readonly EvolutionPoint[]): boolean {
  return points.some((point) => !point.held);
}

/** O resumo do `aria-label` da `figure` (T12). Vazio sem pontos. */
export function evolutionSummary(points: readonly EvolutionPoint[]): string {
  if (points.length === 0) return "";
  return CELL_DETAIL_TEXTS.evolution.chartSummary(points.length, points[0].fullDate, points[points.length - 1].fullDate);
}
