/** O atributo do botão que abre a consulta de um relatório (P91): a volta do foco o procura (T9, T14). */
export const REPORT_OPEN_ATTRIBUTE = "data-report-id";

/** O botão que abre a consulta de um relatório, se ele está na tela (a linha da lista, o relatório do detalhe). */
export function findReportOpenButton(reportId: string | null): HTMLElement | null {
  if (!reportId) return null;
  const buttons = document.querySelectorAll<HTMLElement>(`[${REPORT_OPEN_ATTRIBUTE}]`);
  return Array.from(buttons).find((button) => button.getAttribute(REPORT_OPEN_ATTRIBUTE) === reportId) ?? null;
}
