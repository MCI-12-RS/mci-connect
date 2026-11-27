import { describe, it, expect } from "vitest";
import { CELL_REPORT_ROW_SELECT, cellOfReport, withParticipantCounts, type CellReportPageRow } from "./fields";
import { reportRowLeaderColumns, reportSnapshotColumns } from "@/test/report-snapshot-fixture";

const row = (id: string, visitors_count = 0): CellReportPageRow => ({
  id,
  cell_id: `cell-${id}`,
  date: "2026-11-22",
  time: "20:00:00",
  theme: null,
  observations: null,
  visitors: [],
  offering: 0,
  was_held: true,
  reason_not_held: null,
  visitors_count,
  ...reportRowLeaderColumns,
  snapshot_leader_name: "Ana",
  cell_street: "Rua A",
  cell_number: "10",
  cell_complement: null,
  cell_neighborhood: "Centro",
  cell_deleted: false,
});

describe("lista de relatórios", () => {
  it("a página não pede colunas calculadas para todas as linhas", () => {
    const columns = CELL_REPORT_ROW_SELECT.split(",").map((c) => c.trim());
    expect(columns).not.toContain("search_text");
    expect(columns).not.toContain("participants_count");
  });

  it("junta o número de participantes de cada linha, na ordem da página", () => {
    const rows = withParticipantCounts(
      [row("r1", 2), row("r2"), row("r3")],
      [
        { id: "r2", participants_count: 7 },
        { id: "r1", participants_count: 3 },
        { id: "r3", participants_count: null },
      ],
    );
    expect(rows.map((r) => [r.id, r.participants_count, r.visitors_count])).toEqual([
      ["r1", 3, 2],
      ["r2", 7, 0],
      ["r3", 0, 0],
    ]);
  });

  it("linha sem contagem fica com 0", () => {
    expect(withParticipantCounts([row("r1")], [])[0].participants_count).toBe(0);
  });
});

describe("cellOfReport", () => {
  it("leva as colunas cell_* para o formato dos rótulos de célula", () => {
    expect(cellOfReport(row("r1"))).toEqual({
      id: "cell-r1",
      street: "Rua A",
      number: "10",
      complement: null,
      neighborhood: "Centro",
    });
  });
});
