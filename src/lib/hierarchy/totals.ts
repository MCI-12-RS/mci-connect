// Totais por extenso (E2.06, P42, RN-05, RN-06): "2 discípulos · 3 células".
// Singular só com 1; o zero vai no plural; milhar com o separador do pt-BR.
import { formatCount } from "@/lib/format";
import { TOTALS_TEXTS } from "./texts";

function countText(value: number | null | undefined, singular: string, plural: string): string {
  const count = value ?? 0;
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** "1 discípulo", "0 discípulos", "2.000 discípulos". Sem valor, zero. */
export function disciplesText(count: number | null | undefined): string {
  return countText(count, TOTALS_TEXTS.disciple, TOTALS_TEXTS.disciples);
}

/** "1 célula", "0 células", "1.530 células". Sem valor, zero. */
export function cellsText(count: number | null | undefined): string {
  return countText(count, TOTALS_TEXTS.cell, TOTALS_TEXTS.cells);
}

export interface TotalsInput {
  disciples: number | null | undefined;
  cells: number | null | undefined;
}

/** "2 discípulos · 3 células", numa linha. */
export function totalsText({ disciples, cells }: TotalsInput): string {
  return `${disciplesText(disciples)} ${TOTALS_TEXTS.separator} ${cellsText(cells)}`;
}

/** O que o leitor de tela ouve: "2 discípulos, 3 células". */
export function totalsSpokenText({ disciples, cells }: TotalsInput): string {
  return `${disciplesText(disciples)}${TOTALS_TEXTS.spokenSeparator}${cellsText(cells)}`;
}
