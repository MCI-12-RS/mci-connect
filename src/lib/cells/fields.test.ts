import { describe, it, expect } from "vitest";
import { CELL_ROW_SELECT, CELL_SUMMARY_SELECT } from "./fields";

const columns = (select: string) => select.split(",").map((c) => c.trim());

// A cells_view é security_barrier: toda coluna pedida é calculada para todas
// as células visíveis antes do LIMIT. As listas pedem só o que exibem.
describe("colunas lidas da cells_view (risco 6)", () => {
  it("a lista de Células não pede search_text (só filtra por ela) nem last_report_date (E2.09)", () => {
    expect(columns(CELL_ROW_SELECT)).not.toContain("search_text");
    expect(columns(CELL_ROW_SELECT)).not.toContain("last_report_date");
  });

  it("a lista de Células traz os nomes e o G12 da própria view (RN-06), sem embed de members", () => {
    expect(columns(CELL_ROW_SELECT)).toEqual(
      expect.arrayContaining(["leader_name", "timothy_name", "host_name", "g12_leader_name", "leader_g12_level"]),
    );
    expect(CELL_ROW_SELECT).not.toMatch(/members|\(/);
  });

  it("o resumo usado no seletor de células não pede colunas calculadas por subconsulta", () => {
    for (const expensive of ["search_text", "last_report_date", "g12_leader_id", "g12_leader_name"]) {
      expect(columns(CELL_SUMMARY_SELECT)).not.toContain(expensive);
    }
  });
});
