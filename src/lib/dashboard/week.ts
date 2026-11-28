// Rótulo da semana do dashboard (E1.08, RN-08). A semana vem pronta do banco
// (`dashboard_summary.week_start` e `week_end`, no horário de Brasília); aqui
// só se formata o texto.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-11-22" → "22/11". Lê a string direto, sem `new Date(string)`, que
 * interpreta a data como meia-noite UTC e mostraria o dia anterior no Brasil.
 * Um valor fora do formato sai como veio.
 */
function toDayMonth(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate);
  return match ? `${match[3]}/${match[2]}` : isoDate;
}

/** "22/11 - 28/11", a partir das datas `YYYY-MM-DD` do início e do fim da semana. */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  return `${toDayMonth(weekStart)} - ${toDayMonth(weekEnd)}`;
}

/** "de 22/11 a 28/11": a semana para o leitor de tela (Textos da UX), sem `Date`. */
export function formatWeekRangeSpoken(weekStart: string, weekEnd: string): string {
  return `de ${toDayMonth(weekStart)} a ${toDayMonth(weekEnd)}`;
}
