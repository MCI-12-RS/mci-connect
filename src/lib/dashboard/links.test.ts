import { describe, expect, it } from "vitest";
import { NO_ACCESS, type Access } from "@/lib/access/access";
import { CHART_PARTS, GENERAL_CARDS, WEEK_CARDS, chartRows, type DashboardG12Couple, type DashboardSummary } from "./cards";
import { LIST_ROUTES, chartPartHref, numberHref, rankingRowHref, returnKeySection } from "./links";

const CHURCH: Access = {
  ...NO_ACCESS,
  member_id: "m-rita",
  permissions: ["view_dashboard", "view_all_church", "view_all_reports"],
  sees_whole_church: true,
  sees_whole_church_reports: true,
};
/** A variação "Painel" de Carla (T6): vê relatórios, mas não Membros nem Células. */
const REPORTS_ONLY: Access = { ...NO_ACCESS, member_id: "m-carla", permissions: ["view_dashboard", "view_own_reports"] };

const SUMMARY: DashboardSummary = {
  week_start: "2026-11-22",
  week_end: "2026-11-28",
  reports_sent: 2,
  reports_held: 2,
  cells_pending: 1,
  visitors: 8,
  cells_not_held: 1,
  members_new: 1,
  cells_new: 1,
  members_total: 22,
  members_active: 21,
  members_inactive: 1,
  members_baptized: 3,
  members_not_baptized: 4,
  members_without_leader: 1,
  members_without_cell_link: 2,
  cells_evangelistic: 3,
  cells_discipleship: 2,
  cells_macrocell: 1,
};

const card = (number: string) => {
  const found = [...WEEK_CARDS, ...GENERAL_CARDS].find((item) => item.number === number);
  if (!found) throw new Error(number);
  return found;
};

describe("numberHref (RN-13, Links de cada número)", () => {
  it.each([
    ["reports_sent", "/cell-reports?from=2026-11-22&to=2026-11-28"],
    ["visitors", "/cell-reports?from=2026-11-22&to=2026-11-28"],
    ["cells_not_held", "/cell-reports?from=2026-11-22&to=2026-11-28&held=no"],
    ["cells_pending", "/cells?report_status=pending"],
    ["cells_new", "/cells?from=2026-11-22&to=2026-11-28"],
    ["members_new", "/members?from=2026-11-22&to=2026-11-28"],
    ["members_total", "/members"],
    ["members_active", "/members?status=active"],
    ["members_inactive", "/members?status=inactive"],
    ["members_baptized", "/members?baptized=yes"],
    ["members_not_baptized", "/members?baptized=no"],
    ["members_without_leader", "/members?status=active&leadership=no_leadership"],
    ["members_without_cell_link", "/members?status=active&cell_link=none"],
  ])("%s → %s", (number, href) => {
    expect(numberHref(card(number), SUMMARY, CHURCH)).toBe(href);
  });

  it("os tipos abrem as células ativas do tipo", () => {
    for (const number of ["cells_evangelistic", "cells_discipleship", "cells_macrocell"]) {
      const href = numberHref(card(number), SUMMARY, CHURCH) ?? "";
      expect(href.startsWith("/cells?")).toBe(true);
      expect(new URLSearchParams(href.split("?")[1]).get("status")).toBe("active");
      expect(new URLSearchParams(href.split("?")[1]).get("type")).toBeTruthy();
    }
  });

  it("cada card abre a lista do catálogo", () => {
    for (const item of [...WEEK_CARDS, ...GENERAL_CARDS]) {
      expect(numberHref(item, SUMMARY, CHURCH)?.startsWith(LIST_ROUTES[item.list])).toBe(true);
    }
  });

  it("zero não abre nada (P-DSH-05)", () => {
    expect(numberHref(card("cells_pending"), { ...SUMMARY, cells_pending: 0 }, CHURCH)).toBeNull();
  });

  it("sem o acesso lido, ou sem a lista no menu, o número fica sem link (AQ-1, T6)", () => {
    expect(numberHref(card("reports_sent"), SUMMARY, null)).toBeNull();
    expect(numberHref(card("members_total"), SUMMARY, REPORTS_ONLY)).toBeNull();
    expect(numberHref(card("cells_pending"), SUMMARY, REPORTS_ONLY)).toBeNull();
    expect(numberHref(card("reports_sent"), SUMMARY, REPORTS_ONLY)).toBe("/cell-reports?from=2026-11-22&to=2026-11-28");
  });
});

describe("chartPartHref (RN-12, RN-13)", () => {
  it("as três partes, pela semana da resposta", () => {
    const rows = chartRows(SUMMARY);
    expect(rows.map((row) => chartPartHref(row, SUMMARY, CHURCH))).toEqual([
      "/cell-reports?from=2026-11-22&to=2026-11-28&held=yes",
      "/cell-reports?from=2026-11-22&to=2026-11-28&held=no",
      "/cells?report_status=pending",
    ]);
    expect(CHART_PARTS).toHaveLength(3);
  });

  it("a parte com zero fica sem link", () => {
    const rows = chartRows({ ...SUMMARY, cells_not_held: 0 });
    expect(chartPartHref(rows[1], SUMMARY, CHURCH)).toBeNull();
  });
});

describe("rankingRowHref (RN-11)", () => {
  const row: DashboardG12Couple = {
    couple_key: "p|q",
    name: "Pedro",
    spouse_name: "Paula",
    male_cells: 1,
    female_cells: 1,
    total_cells: 2,
    g12_ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  };

  it("abre as células ativas do casal, com os dois ids na ordem do servidor", () => {
    const href = rankingRowHref(row, CHURCH) ?? "";
    const params = new URLSearchParams(href.split("?")[1]);
    expect(href.startsWith("/cells?")).toBe(true);
    expect(params.get("status")).toBe("active");
    expect(params.get("g12")).toBe(row.g12_ids.join(","));
  });

  it("Total 0, sem ids ou sem acesso a Células: sem link", () => {
    expect(rankingRowHref({ ...row, total_cells: 0 }, CHURCH)).toBeNull();
    expect(rankingRowHref({ ...row, g12_ids: [] }, CHURCH)).toBeNull();
    expect(rankingRowHref(row, REPORTS_ONLY)).toBeNull();
  });
});

describe("returnKeySection (DA-4)", () => {
  it("a seção de cada chave guardada", () => {
    expect(returnKeySection("reports_sent")).toBe("week");
    expect(returnKeySection("chart:pending")).toBe("week");
    expect(returnKeySection("members_total")).toBe("general");
    expect(returnKeySection("g12:p|q")).toBe("ranking");
  });
});
