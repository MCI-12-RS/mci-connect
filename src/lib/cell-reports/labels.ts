// Rótulos de relatório exibidos nas listas e nos diálogos.
import { format, parseISO } from "date-fns";

/** Data do relatório no padrão da tela: "2026-11-19" → "19/11/2026". */
export function formatReportDate(date: string): string {
  return format(parseISO(date), "dd/MM/yyyy");
}
