import { canSeeRoute, type Access } from "@/lib/access/access";
import { cellReportListHref } from "@/lib/cell-reports/filters";
import { cellListHref } from "@/lib/cells/filters";
import { memberListHref } from "@/lib/members/filters";
import {
  GENERAL_CARDS,
  type CardNumber,
  type ChartPart,
  type ChartRow,
  type DashboardCard,
  type DashboardG12Couple,
  type DashboardList,
  type DashboardSection,
  type DashboardSummary,
} from "./cards";

// Os links de cada número do Dashboard (E2.14, RN-13, tabela "Links de cada
// número"). Os endereços vêm só dos módulos das listas (`memberListHref`,
// `cellListHref`, `cellReportListHref`); nada de montar query string aqui. A
// semana é sempre a da resposta que está na tela (AQ-5).

/** A rota de cada lista, para conferir o acesso pelo menu (RN-22 do E2.02, AQ-1). */
export const LIST_ROUTES = {
  members: "/members",
  cells: "/cells",
  cell_reports: "/cell-reports",
} as const satisfies Record<DashboardList, string>;

interface Week {
  start: string;
  end: string;
}

function weekOf(summary: DashboardSummary): Week {
  return { start: summary.week_start, end: summary.week_end };
}

function canOpen(list: DashboardList, value: number, access: Access | null | undefined): boolean {
  return value > 0 && !!access && canSeeRoute(access, LIST_ROUTES[list]);
}

/** O endereço equivalente a cada card (sem conferir o valor nem o acesso). */
function cardTarget(number: CardNumber, week: Week): string {
  switch (number) {
    case "reports_sent":
    case "visitors":
      return cellReportListHref({ from: week.start, to: week.end });
    case "cells_not_held":
      return cellReportListHref({ from: week.start, to: week.end, held: "no" });
    case "cells_pending":
      return cellListHref({ kind: "pending" });
    case "cells_new":
      return cellListHref({ kind: "new_this_week", week });
    case "members_new":
      return memberListHref("new_this_week", week);
    case "members_total":
      return memberListHref("total");
    case "members_active":
      return memberListHref("active");
    case "members_inactive":
      return memberListHref("inactive");
    case "members_baptized":
      return memberListHref("baptized");
    case "members_not_baptized":
      return memberListHref("not_baptized");
    case "members_without_leader":
      return memberListHref("no_leadership");
    case "members_without_cell_link":
      return memberListHref("no_cell_link");
    case "cells_evangelistic":
      return cellListHref({ kind: "type", type: "Evangelística", activeOnly: true });
    case "cells_discipleship":
      return cellListHref({ kind: "type", type: "Discipulado", activeOnly: true });
    case "cells_macrocell":
      return cellListHref({ kind: "type", type: "Macrocélula", activeOnly: true });
  }
}

/** O link de um card; `null` com zero (P-DSH-05), sem o acesso ou sem a lista no menu. */
export function numberHref(card: DashboardCard, summary: DashboardSummary, access: Access | null | undefined): string | null {
  if (!canOpen(card.list, summary[card.number], access)) return null;
  return cardTarget(card.number, weekOf(summary));
}

function chartTarget(part: ChartPart, week: Week): string {
  switch (part) {
    case "held":
      return cellReportListHref({ from: week.start, to: week.end, held: "yes" });
    case "not_held":
      return cellReportListHref({ from: week.start, to: week.end, held: "no" });
    case "pending":
      return cellListHref({ kind: "pending" });
  }
}

/** O link de uma parte do gráfico (RN-12); `null` com zero ou sem acesso. */
export function chartPartHref(row: ChartRow, summary: DashboardSummary, access: Access | null | undefined): string | null {
  if (!canOpen(row.list, row.value, access)) return null;
  return chartTarget(row.part, weekOf(summary));
}

/** O link de um casal do ranking (RN-11): as células ativas do casal; `null` com Total 0, sem ids ou sem acesso. */
export function rankingRowHref(row: DashboardG12Couple, access: Access | null | undefined): string | null {
  if (row.g12_ids.length === 0 || !canOpen("cells", row.total_cells, access)) return null;
  return cellListHref({ kind: "g12_couple", ids: row.g12_ids });
}

// --- A volta na mesma posição (DA-4) ---

/** A tela no `return-position.ts`. */
export const DASHBOARD_RETURN_SCOPE = "dashboard";

const CHART_PREFIX = "chart:";
const RANKING_PREFIX = "g12:";

export function cardReturnKey(card: DashboardCard): string {
  return card.number;
}

export function chartReturnKey(row: ChartRow): string {
  return `${CHART_PREFIX}${row.part}`;
}

export function rankingReturnKey(row: DashboardG12Couple): string {
  return `${RANKING_PREFIX}${row.couple_key}`;
}

/** A seção de uma chave guardada: o `h2` que recebe o foco quando o item não está mais na tela. */
export function returnKeySection(key: string): DashboardSection {
  if (key.startsWith(RANKING_PREFIX)) return "ranking";
  return GENERAL_CARDS.some((card) => card.number === key) ? "general" : "week";
}
