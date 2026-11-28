import { describe, expect, it } from "vitest";
import { CELL_TYPES } from "@/lib/cells/cell-types";
import {
  ALWAYS_VISIBLE,
  CHART_PARTS,
  GENERAL_CARDS,
  WEEK_CARDS,
  cardIcon,
  cardTone,
  chartRows,
  showChart,
  visibleCards,
  type DashboardSummary,
  type SummaryNumber,
} from "./cards";
import { DASHBOARD_CARD_TITLES } from "./texts";

/** Todo número do resumo: o `Record` obriga a listar uma coluna nova do `types.ts`. */
const EVERY_NUMBER: Record<SummaryNumber, true> = {
  reports_sent: true,
  reports_held: true,
  cells_pending: true,
  visitors: true,
  cells_not_held: true,
  members_new: true,
  cells_new: true,
  members_total: true,
  members_active: true,
  members_inactive: true,
  members_baptized: true,
  members_not_baptized: true,
  members_without_leader: true,
  members_without_cell_link: true,
  cells_evangelistic: true,
  cells_discipleship: true,
  cells_macrocell: true,
};

const ZERO_SUMMARY: DashboardSummary = {
  week_start: "2026-11-22",
  week_end: "2026-11-28",
  reports_sent: 0,
  reports_held: 0,
  cells_pending: 0,
  visitors: 0,
  cells_not_held: 0,
  members_new: 0,
  cells_new: 0,
  members_total: 0,
  members_active: 0,
  members_inactive: 0,
  members_baptized: 0,
  members_not_baptized: 0,
  members_without_leader: 0,
  members_without_cell_link: 0,
  cells_evangelistic: 0,
  cells_discipleship: 0,
  cells_macrocell: 0,
};

function summary(values: Partial<Record<SummaryNumber, number>> = {}): DashboardSummary {
  return { ...ZERO_SUMMARY, ...values };
}

describe("catálogo do Dashboard (E2.14, RN-14, RN-16)", () => {
  it("todo número do resumo tem um card ou uma parte do gráfico", () => {
    const placed = new Set<string>([...WEEK_CARDS, ...GENERAL_CARDS].map((card) => card.number));
    for (const part of CHART_PARTS) placed.add(part.number);
    expect(Object.keys(EVERY_NUMBER).filter((key) => !placed.has(key))).toEqual([]);
  });

  it("os três cards de tipo cobrem a lista de tipos de célula (E2.08)", () => {
    const types = GENERAL_CARDS.flatMap((card) => ("cellType" in card ? [card.cellType] : []));
    expect([...types].sort()).toEqual([...CELL_TYPES].sort());
  });

  it("segue a ordem e os títulos da RN-16", () => {
    expect(WEEK_CARDS.map((card) => DASHBOARD_CARD_TITLES[card.number])).toEqual([
      "Relatórios enviados",
      "Células com relatório pendente",
      "Visitantes em células",
      "Células não realizadas",
      "Novos membros",
      "Novas células",
    ]);
    expect(GENERAL_CARDS.map((card) => DASHBOARD_CARD_TITLES[card.number])).toEqual([
      "Total de membros",
      "Membros ativos",
      "Membros inativos",
      "Batizados",
      "Não batizados",
      "Sem liderança",
      "Sem vínculo celular",
      "Células evangelísticas",
      "Células de discipulado",
      "Macrocélulas",
    ]);
  });

  it("deixa à vista três cards na semana e dois em Geral, mesmo com zero (RN-14)", () => {
    expect(visibleCards(WEEK_CARDS, summary()).map((card) => card.number)).toEqual(["reports_sent", "cells_pending", "visitors"]);
    expect(visibleCards(GENERAL_CARDS, summary()).map((card) => card.number)).toEqual(["members_total", "members_active"]);
    expect(ALWAYS_VISIBLE.size).toBe(5);
  });

  it("sem os números, mostra só os sempre à vista (P112)", () => {
    expect(visibleCards(WEEK_CARDS, undefined)).toHaveLength(3);
    expect(visibleCards(GENERAL_CARDS, undefined)).toHaveLength(2);
  });

  it("mostra os cards condicionais maiores que zero, na ordem do catálogo", () => {
    const shown = visibleCards(GENERAL_CARDS, summary({ cells_macrocell: 1, members_inactive: 2 }));
    expect(shown.map((card) => card.number)).toEqual(["members_total", "members_active", "members_inactive", "cells_macrocell"]);
  });
});

describe("tom e ícone (RN-15, P111)", () => {
  it("pendentes: aviso acima de zero, sucesso com zero, neutro carregando", () => {
    expect(cardTone("cells_pending", 3)).toBe("warning");
    expect(cardTone("cells_pending", 0)).toBe("success");
    expect(cardTone("cells_pending", undefined)).toBe("neutral");
  });

  it("Sem liderança e Sem vínculo celular sempre com aviso; os outros neutros, inclusive inativos e não realizadas", () => {
    expect(cardTone("members_without_leader", 1)).toBe("warning");
    expect(cardTone("members_without_cell_link", 1)).toBe("warning");
    for (const number of ["members_inactive", "cells_not_held", "visitors", "reports_sent"] as const) {
      expect(cardTone(number, 0)).toBe("neutral");
      expect(cardTone(number, 5)).toBe("neutral");
    }
  });

  it("o card de pendentes troca o triângulo pelo ✓ com zero e fica sem ícone carregando", () => {
    const pending = WEEK_CARDS[1];
    expect(cardIcon(pending, 2)).toBe("triangle-alert");
    expect(cardIcon(pending, 0)).toBe("check-circle");
    expect(cardIcon(pending, undefined)).toBeNull();
    expect(cardIcon(WEEK_CARDS[0], undefined)).toBe("file-text");
  });
});

describe("gráfico (RN-12, P113)", () => {
  it("três linhas na ordem fixa, com a barra pelo maior número", () => {
    const rows = chartRows(summary({ reports_held: 2, cells_not_held: 0, cells_pending: 1 }));
    expect(rows.map(({ part, value, ratio }) => ({ part, value, ratio }))).toEqual([
      { part: "held", value: 2, ratio: 1 },
      { part: "not_held", value: 0, ratio: 0 },
      { part: "pending", value: 1, ratio: 0.5 },
    ]);
  });

  it("some com as três partes em zero, e aparece com uma maior que zero", () => {
    expect(showChart(summary())).toBe(false);
    expect(showChart(summary({ cells_pending: 1 }))).toBe(true);
    expect(chartRows(summary()).every((row) => row.ratio === 0)).toBe(true);
  });
});
