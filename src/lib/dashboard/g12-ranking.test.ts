import { describe, it, expect } from "vitest";
import { rankG12Couples, type G12RankingMember } from "./g12-ranking";

const m = (id: string, over: Partial<G12RankingMember> = {}): G12RankingMember => ({
  id,
  name: id,
  gender: "M",
  spouse_id: null,
  g12_level: 2,
  male_cells: 0,
  female_cells: 0,
  ...over,
});

describe("rankG12Couples", () => {
  it("não conta duas vezes as células de discípulos (totais já acumulados)", () => {
    // Cenário de produção: o G12 Eduardo tem um discípulo, Rafael, que lidera 2 células.
    const rows = rankG12Couples([
      m("Samuel", { g12_level: 0, spouse_id: "Magda", male_cells: 2 }),
      m("Magda", { g12_level: 0, gender: "F", spouse_id: "Samuel" }),
      m("Eduardo", { g12_level: 1, spouse_id: "Lea", male_cells: 2 }),
      m("Lea", { g12_level: 1, gender: "F", spouse_id: "Eduardo" }),
      m("Rafael", { g12_level: 2, male_cells: 2 }),
    ]);
    expect(rows).toEqual([{ id: "Eduardo|Lea", name: "Eduardo", spouseName: "Lea", maleCells: 2, femaleCells: 0 }]);
  });

  it("soma os dois cônjuges de nível 1, com o homem primeiro", () => {
    const rows = rankG12Couples([
      m("Ana", { g12_level: 1, gender: "F", spouse_id: "Bruno", male_cells: 1, female_cells: 4 }),
      m("Bruno", { g12_level: 1, spouse_id: "Ana", male_cells: 3 }),
    ]);
    expect(rows).toEqual([{ id: "Ana|Bruno", name: "Bruno", spouseName: "Ana", maleCells: 4, femaleCells: 4 }]);
  });

  it("cônjuge de outro nível só dá o nome; G12 sem cônjuge vira linha própria; ordena pelo total", () => {
    const rows = rankG12Couples([
      m("Carla", { g12_level: 1, gender: "F", spouse_id: "Davi", female_cells: 1 }),
      m("Davi", { g12_level: 3, spouse_id: "Carla", male_cells: 9 }),
      m("Eva", { g12_level: 1, gender: "F", female_cells: 5, male_cells: null }),
    ]);
    expect(rows).toEqual([
      { id: "Eva", name: "Eva", spouseName: undefined, maleCells: 0, femaleCells: 5 },
      { id: "Carla|Davi", name: "Davi", spouseName: "Carla", maleCells: 0, femaleCells: 1 },
    ]);
  });
});
