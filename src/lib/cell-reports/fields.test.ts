import { describe, it, expect } from "vitest";
import { CELL_REPORT_DETAIL_SELECT, CELL_REPORT_LIST_SELECT } from "./fields";

const columns = (select: string) => select.split(",").map((c) => c.trim());

describe("colunas da lista e da consulta de Relatórios (E2.12, risco 8)", () => {
  it("a lista nunca pede search_text nem cell_visible, e traz o número de participantes na linha (DT-03)", () => {
    const list = columns(CELL_REPORT_LIST_SELECT);
    expect(list).not.toContain("search_text");
    expect(list).not.toContain("cell_visible");
    expect(list).not.toContain("*");
    expect(list).toContain("participants_count");
  });

  it("a consulta pede tudo o que a lista pede, mais as pessoas registradas, o endereço completo, cell_visible e a autoria", () => {
    const detail = columns(CELL_REPORT_DETAIL_SELECT);
    for (const column of columns(CELL_REPORT_LIST_SELECT)) expect(detail).toContain(column);
    for (const column of ["snapshot_timothy_name", "snapshot_host_name", "snapshot_cell_type", "cell_city", "cell_state", "cell_zip_code", "cell_visible", "created_at", "updated_by_name"])
      expect(detail).toContain(column);
    expect(detail).not.toContain("search_text");
  });
});
