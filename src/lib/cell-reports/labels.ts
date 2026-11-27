// Rótulos de relatório exibidos nas listas e nos diálogos.
import { format, parseISO } from "date-fns";
import { formatCurrency } from "@/lib/format";

/** Data do relatório no padrão da tela: "2026-11-19" → "19/11/2026". */
export function formatReportDate(date: string): string {
  return format(parseISO(date), "dd/MM/yyyy");
}

/** O texto da oferta sem valor registrado (legado; RN-17, PO-UX-10): nunca "R$ 0,00". */
export const OFFERING_NOT_INFORMED = "Não informada";

/** A oferta em reais (RN-17): "R$ 50,00", "R$ 0,00" ou "Não informada" quando não há valor. */
export function formatOffering(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return OFFERING_NOT_INFORMED;
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? formatCurrency(amount) : OFFERING_NOT_INFORMED;
}
