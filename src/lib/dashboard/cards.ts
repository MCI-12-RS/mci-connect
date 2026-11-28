import type { Database } from "@/integrations/supabase/types";
import type { CellType } from "@/lib/cells/cell-types";

// O catálogo dos números do Dashboard (E2.14, DT-06), num lugar só: quais
// cards existem, em que ordem (RN-16), para que lista abrem, que ícone e que
// tom usam (RN-14, RN-15, P111) e as partes do gráfico (RN-12, P113). Os
// números vêm prontos do `dashboard_summary`; aqui só se escolhe o que mostrar.
// Sem React e sem Supabase (o `Database` é só tipo).

type DashboardFunctions = Database["public"]["Functions"];

/** Uma linha do `dashboard_summary`: os números e a semana (`YYYY-MM-DD`, Brasília). */
export type DashboardSummary = DashboardFunctions["dashboard_summary"]["Returns"][number];

/** Um casal G12 do ranking, com os ids do link (`g12_ids`, AQ-4). */
export type DashboardG12Couple = DashboardFunctions["dashboard_g12_ranking"]["Returns"][number];

/** Todo número do resumo. Uma coluna nova sem lugar na tela quebra o teste do catálogo. */
export type SummaryNumber = Exclude<keyof DashboardSummary, "week_start" | "week_end">;

/** As listas que um número abre (RN-13). */
export type DashboardList = "members" | "cells" | "cell_reports";

/** As chaves dos ícones dos cards (T3); o mapa para o `lucide-react` fica no `DashboardIcon`. */
export type DashboardIconKey =
  | "file-text"
  | "triangle-alert"
  | "check-circle"
  | "handshake"
  | "calendar-x"
  | "user-plus"
  | "house-plus"
  | "users"
  | "user-check"
  | "user-x"
  | "church"
  | "droplets"
  | "shield"
  | "link-off"
  | "house";

/** O tom de um card (P111). */
export type CardTone = "neutral" | "warning" | "success";

/** As seções do Dashboard que têm cards ou linhas com link. */
export type DashboardSection = "week" | "general" | "ranking";

interface CardSpec<N extends SummaryNumber> {
  number: N;
  list: DashboardList;
  /** O ícone fixo; o card de pendentes troca o dele pelo número (`cardIcon`). */
  icon: DashboardIconKey;
  /** O tipo de célula do card (RN-10): só nos três cards de tipo. */
  cellType?: CellType;
}

/** "Esta semana", na ordem da RN-16. */
export const WEEK_CARDS = [
  { number: "reports_sent", list: "cell_reports", icon: "file-text" },
  { number: "cells_pending", list: "cells", icon: "triangle-alert" },
  { number: "visitors", list: "cell_reports", icon: "handshake" },
  { number: "cells_not_held", list: "cell_reports", icon: "calendar-x" },
  { number: "members_new", list: "members", icon: "user-plus" },
  { number: "cells_new", list: "cells", icon: "house-plus" },
] as const satisfies readonly CardSpec<SummaryNumber>[];

/** "Geral", na ordem da RN-16. */
export const GENERAL_CARDS = [
  { number: "members_total", list: "members", icon: "users" },
  { number: "members_active", list: "members", icon: "user-check" },
  { number: "members_inactive", list: "members", icon: "user-x" },
  { number: "members_baptized", list: "members", icon: "church" },
  { number: "members_not_baptized", list: "members", icon: "droplets" },
  { number: "members_without_leader", list: "members", icon: "shield" },
  { number: "members_without_cell_link", list: "members", icon: "link-off" },
  { number: "cells_evangelistic", list: "cells", icon: "house", cellType: "Evangelística" },
  { number: "cells_discipleship", list: "cells", icon: "house", cellType: "Discipulado" },
  { number: "cells_macrocell", list: "cells", icon: "house", cellType: "Macrocélula" },
] as const satisfies readonly CardSpec<SummaryNumber>[];

/** Um card do catálogo. */
export type DashboardCard = (typeof WEEK_CARDS)[number] | (typeof GENERAL_CARDS)[number];

/** Os números que têm card (o `reports_held` só aparece no gráfico). */
export type CardNumber = DashboardCard["number"];

/** RN-14: os cards que ficam à vista mesmo com zero; "Esta semana" tem três, e "Geral", dois. */
export const ALWAYS_VISIBLE: ReadonlySet<SummaryNumber> = new Set<SummaryNumber>([
  "reports_sent",
  "cells_pending",
  "visitors",
  "members_total",
  "members_active",
]);

/**
 * Os cards que a seção mostra, na ordem do catálogo (RN-14, P112): sem os
 * números (carregando), só os sempre à vista; com eles, também os maiores que zero.
 */
export function visibleCards<C extends DashboardCard>(cards: readonly C[], summary: DashboardSummary | undefined): C[] {
  return cards.filter((card) => ALWAYS_VISIBLE.has(card.number) || (summary !== undefined && summary[card.number] > 0));
}

/** Os cards com o tom de aviso fixo (RN-15). */
const WARNING_NUMBERS: ReadonlySet<SummaryNumber> = new Set<SummaryNumber>(["members_without_leader", "members_without_cell_link"]);

/**
 * O tom do card (RN-15, P111): aviso em "Sem liderança" e "Sem vínculo
 * celular"; no de pendentes, aviso acima de zero e sucesso com zero; neutro
 * nos outros e enquanto o número não chegou.
 */
export function cardTone(number: SummaryNumber, value: number | undefined): CardTone {
  if (WARNING_NUMBERS.has(number)) return "warning";
  if (number === "cells_pending" && value !== undefined) return value > 0 ? "warning" : "success";
  return "neutral";
}

/** O ícone do card; o de pendentes troca o triângulo pelo ✓ com zero e fica sem ícone enquanto carrega (T3, T7). */
export function cardIcon(card: DashboardCard, value: number | undefined): DashboardIconKey | null {
  if (card.number !== "cells_pending") return card.icon;
  if (value === undefined) return null;
  return value > 0 ? "triangle-alert" : "check-circle";
}

/** As partes do gráfico "Relatórios de células", na ordem fixa da RN-12. */
export const CHART_PARTS = [
  { part: "held", number: "reports_held", list: "cell_reports" },
  { part: "not_held", number: "cells_not_held", list: "cell_reports" },
  { part: "pending", number: "cells_pending", list: "cells" },
] as const satisfies readonly { part: string; number: SummaryNumber; list: DashboardList }[];

export type ChartPart = (typeof CHART_PARTS)[number]["part"];

export interface ChartRow {
  part: ChartPart;
  number: (typeof CHART_PARTS)[number]["number"];
  list: DashboardList;
  value: number;
  /** A largura da barra: o valor dividido pelo maior das três partes; 0 sem barra. */
  ratio: number;
}

/** As três linhas do gráfico, com a razão de cada barra (P113). É a única conta do front, e é de apresentação. */
export function chartRows(summary: DashboardSummary): ChartRow[] {
  const values = CHART_PARTS.map((part) => summary[part.number]);
  const max = Math.max(...values);
  return CHART_PARTS.map((part, index) => ({
    part: part.part,
    number: part.number,
    list: part.list,
    value: values[index],
    ratio: max > 0 ? values[index] / max : 0,
  }));
}

/** RN-12: o gráfico aparece quando pelo menos uma parte é maior que zero. */
export function showChart(summary: DashboardSummary): boolean {
  return CHART_PARTS.some((part) => summary[part.number] > 0);
}
