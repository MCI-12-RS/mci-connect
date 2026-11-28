import { formatCount } from "@/lib/format";
import type { CardNumber, DashboardList } from "./cards";

// Os textos do Dashboard (E2.14: Textos de tela do Negócio e Textos da UX).
// Os badges do gráfico vêm dos módulos das listas, sem repetir texto: "Célula
// realizada" e "Não houve célula" de `cell-reports/filter-texts.ts`, e
// "Pendente" de `cells/report-status.ts`. O cabeçalho, o sem acesso e o atalho
// "Novo relatório" são os do E2.02 (`access/texts.ts`).

/** Os títulos dos cards (RN-16), só com a primeira letra maiúscula. */
export const DASHBOARD_CARD_TITLES = {
  reports_sent: "Relatórios enviados",
  cells_pending: "Células com relatório pendente",
  visitors: "Visitantes em células",
  cells_not_held: "Células não realizadas",
  members_new: "Novos membros",
  cells_new: "Novas células",
  members_total: "Total de membros",
  members_active: "Membros ativos",
  members_inactive: "Membros inativos",
  members_baptized: "Batizados",
  members_not_baptized: "Não batizados",
  members_without_leader: "Sem liderança",
  members_without_cell_link: "Sem vínculo celular",
  cells_evangelistic: "Células evangelísticas",
  cells_discipleship: "Células de discipulado",
  cells_macrocell: "Macrocélulas",
} as const satisfies Record<CardNumber, string>;

/** O nome de cada lista no nome acessível dos links ("ver na lista de Células"). */
export const DASHBOARD_LIST_NAMES = {
  members: "Membros",
  cells: "Células",
  cell_reports: "Relatórios",
} as const satisfies Record<DashboardList, string>;

export const DASHBOARD_PAGE_TEXTS = {
  weekSection: "Esta semana",
  generalSection: "Geral",
  rankingSection: "Células por G12",
  chartTitle: "Relatórios de células",
  chartLegend: "Células que ainda não precisam enviar o relatório desta semana não entram.",
  loading: "Carregando…",
  retry: "Tentar de novo",
  /** RN-17, P-DSH-21. A dos tipos não existe mais: os tipos vêm no resumo (AQ-3). */
  errors: {
    week: "Não foi possível carregar os números desta semana. Verifique a conexão e tente de novo.",
    general: "Não foi possível carregar os números gerais. Verifique a conexão e tente de novo.",
    ranking: "Não foi possível carregar as células por G12. Verifique a conexão e tente de novo.",
  },
  ranking: {
    couple: "G12 (Casal)",
    male: "Homens",
    female: "Mulheres",
    total: "Total",
    caption: "Células ativas por casal G12, do maior total para o menor.",
    /** O "&" visível fica `aria-hidden`; o leitor de tela ouve " e ". */
    coupleSeparator: " & ",
    coupleSeparatorSpoken: " e ",
  },
  /** O separador entre o título e o número, só para o leitor de tela (P110). */
  numberSeparator: ": ",
} as const;

/** ", ver na lista de Células": o destino do link, só para o leitor de tela (P110, T3, T4). */
export function listDestinationText(list: DashboardList): string {
  return `, ver na lista de ${DASHBOARD_LIST_NAMES[list]}`;
}

/**
 * O nome acessível inteiro de um número (T3, T4): "Células com relatório
 * pendente: 1, ver na lista de Células", ou "Total de membros: 1" sem link.
 * Na tela, o ":" e o destino ficam em `sr-only`, na ordem do DOM.
 */
export function numberSpokenName(title: string, value: number, list: DashboardList | null): string {
  const base = `${title}${DASHBOARD_PAGE_TEXTS.numberSeparator}${formatCount(value)}`;
  return list ? `${base}${listDestinationText(list)}` : base;
}

/** "1 célula" ou "2 células". */
export function cellsCountText(count: number): string {
  return count === 1 ? "1 célula" : `${formatCount(count)} células`;
}

/** ": 2 células, ver na lista de Células": o que o link do casal acrescenta ao nome (T5). */
export function rankingLinkSuffix(total: number): string {
  return `${DASHBOARD_PAGE_TEXTS.numberSeparator}${cellsCountText(total)}${listDestinationText("cells")}`;
}

/** O nome acessível do link do casal: "Pedro e Paula: 2 células, ver na lista de Células" (T5). */
export function rankingSpokenName(name: string, spouseName: string | null, total: number): string {
  const couple = spouseName ? `${name}${DASHBOARD_PAGE_TEXTS.ranking.coupleSeparatorSpoken}${spouseName}` : name;
  return `${couple}${rankingLinkSuffix(total)}`;
}
