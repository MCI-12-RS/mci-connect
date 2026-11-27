import { describe, expect, it } from "vitest";
import {
  cellChipState,
  cellIdentityChipText,
  clearCellReportFilters,
  parseCellReportFilter,
  removeCellReportFilter,
} from "./cell-filter";

const CELL = "e2e210c1-0000-0000-0000-000000000001";

describe("filtro Célula em Relatórios (E2.10, RN-19, T15)", () => {
  it("lê o `cell` com formato de UUID; sem formato sai da URL (P84)", () => {
    expect(parseCellReportFilter(new URLSearchParams(`cell=${CELL}&page=2`))).toEqual({ cellId: CELL, cleanParams: null });
    const parsed = parseCellReportFilter(new URLSearchParams("cell=xyz&q=fé&report=r1"));
    expect(parsed.cellId).toBeNull();
    expect(parsed.cleanParams?.toString()).toBe("q=f%C3%A9&report=r1");
    expect(parseCellReportFilter(new URLSearchParams("q=a"))).toEqual({ cellId: null, cleanParams: null });
  });

  it("o chip tira a célula e a página; a busca, o tamanho e o `report` ficam", () => {
    const params = new URLSearchParams(`cell=${CELL}&q=fe&page=2&size=50&report=r1`);
    expect(removeCellReportFilter(params).toString()).toBe("q=fe&size=50&report=r1");
  });

  it("Limpar filtros tira `cell`, `q` e `page`; mantém `size` e `report`", () => {
    const params = new URLSearchParams(`cell=${CELL}&q=fe&page=2&size=50&report=r1`);
    expect(clearCellReportFilters(params).toString()).toBe("size=50&report=r1");
  });

  it("o texto do chip: líder, dia curto e horário sem segundos", () => {
    expect(cellIdentityChipText({ leader_name: "André Souza", meeting_day: "Quarta", meeting_time: "20:00:00" })).toBe(
      "Célula de André Souza · Quarta · 20:00",
    );
    expect(cellIdentityChipText({ leader_name: null, meeting_day: null, meeting_time: null })).toBe("Célula de Membro sem nome");
  });

  it("o estado do chip: carregando, não carregada, indisponível e a célula (UX-30: nada técnico)", () => {
    expect(cellChipState({ data: undefined, isError: false })).toEqual({ kind: "loading" });
    expect(cellChipState({ data: undefined, isError: true })).toEqual({ kind: "failed" });
    expect(cellChipState({ data: null, isError: false })).toEqual({ kind: "unavailable" });
    expect(cellChipState({ data: { leader_name: "Jonas Prado", meeting_day: "Sexta", meeting_time: "20:00:00" }, isError: false })).toEqual({
      kind: "ready",
      text: "Célula de Jonas Prado · Sexta · 20:00",
    });
  });
});
