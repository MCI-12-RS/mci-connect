// Comparação de cada relatório com o relatório visível de célula realizada
// imediatamente anterior (E2.10, RN-17, P82). O servidor manda o sinal
// (`cell_recent_reports.participants_trend`/`visitors_trend`: 1, 0, -1 ou
// nulo); aqui só se traduz. Sem React e sem Supabase.

export type Trend = "up" | "down" | "same";

/** O sentido da comparação; nulo sem relatório anterior de célula realizada (só o número). */
export function trendOf(sign: number | null | undefined): Trend | null {
  if (sign === null || sign === undefined || !Number.isFinite(sign)) return null;
  if (sign > 0) return "up";
  if (sign < 0) return "down";
  return "same";
}

/** O que o leitor de tela ouve logo depois do número: "8, mais que no relatório anterior" (P82). */
export const TREND_SPOKEN: Readonly<Record<Trend, string>> = {
  up: ", mais que no relatório anterior",
  down: ", menos que no relatório anterior",
  same: ", igual ao relatório anterior",
};

/** Algum relatório mostra seta? A frase das setas só aparece nesse caso (T11). */
export function anyTrend(reports: ReadonlyArray<{ participants_trend: number | null; visitors_trend: number | null }>): boolean {
  return reports.some((r) => trendOf(r.participants_trend) !== null || trendOf(r.visitors_trend) !== null);
}
