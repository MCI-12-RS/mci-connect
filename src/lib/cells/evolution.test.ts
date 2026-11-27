import { describe, it, expect } from "vitest";
import { evolutionSummary, hasNotHeld, toEvolutionPoints } from "./evolution";

// A evolução (E2.10, RN-20, T12; critério da RN-20: C1 para Pedro).

const report = (id: string, date: string, held: boolean, participants: number | null, visitors: number | null) => ({
  id,
  date,
  was_held: held,
  participants_count: participants,
  visitors_count: visitors,
});

// Do servidor: do mais recente para o mais antigo (R1, R2, R4, R5).
const C1 = [
  report("r1", "2026-11-18", true, 8, 2),
  report("r2", "2026-11-11", false, 0, 0),
  report("r4", "2026-10-28", true, 6, 0),
  report("r5", "2026-10-21", true, 5, 1),
];

describe("toEvolutionPoints", () => {
  it("ordem cronológica, com Não houve célula sem valor (nunca zero)", () => {
    const points = toEvolutionPoints(C1);
    expect(points.map((p) => p.shortDate)).toEqual(["21/10", "28/10", "11/11", "18/11"]);
    expect(points.map((p) => p.participants)).toEqual([5, 6, null, 8]);
    expect(points.map((p) => p.visitors)).toEqual([1, 0, null, 2]);
    expect(points.map((p) => p.fullDate)).toEqual(["21/10/2026", "28/10/2026", "11/11/2026", "18/11/2026"]);
    expect(hasNotHeld(points)).toBe(true);
  });

  it("um relatório só: um ponto", () => {
    const points = toEvolutionPoints([report("r9", "2026-11-25", true, 4, 0)]);
    expect(points).toHaveLength(1);
    expect(hasNotHeld(points)).toBe(false);
  });

  it("número ausente na célula realizada vira zero", () => {
    expect(toEvolutionPoints([report("x", "2026-11-25", true, null, null)])[0]).toMatchObject({ participants: 0, visitors: 0 });
  });
});

describe("evolutionSummary (aria-label da figure)", () => {
  it("o resumo com o número de relatórios e o período", () => {
    expect(evolutionSummary(toEvolutionPoints(C1))).toBe(
      "Gráfico de linhas com participantes e visitantes de 4 relatórios, de 21/10/2026 a 18/11/2026. Os números estão na aba Tabela.",
    );
    expect(evolutionSummary(toEvolutionPoints([report("r9", "2026-11-25", true, 4, 0)]))).toContain("de 1 relatório,");
    expect(evolutionSummary([])).toBe("");
  });
});
