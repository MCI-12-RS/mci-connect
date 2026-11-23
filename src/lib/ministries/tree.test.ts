import { describe, it, expect } from "vitest";
import { directDisciplesLabel, getLevelLabel, ministryNodeKey, ministryNodeParentIds } from "./tree";

describe("ministryNodeKey (RN-10)", () => {
  it("casal: principal e cônjuge", () => {
    expect(ministryNodeKey({ member_id: "h1", spouse_id: "m1" })).toBe("h1|m1");
  });

  it("sem cônjuge exibido", () => {
    expect(ministryNodeKey({ member_id: "h1", spouse_id: null })).toBe("h1|");
  });

  it("o mesmo membro em dois nós (vínculo de cônjuge assimétrico) gera chaves diferentes", () => {
    const sozinho = ministryNodeKey({ member_id: "h1", spouse_id: null });
    const casado = ministryNodeKey({ member_id: "h1", spouse_id: "m1" });
    expect(sozinho).not.toBe(casado);
  });
});

describe("ministryNodeParentIds (RN-10)", () => {
  it("abrir um casal pede os filhos dos dois", () => {
    expect(ministryNodeParentIds({ member_id: "h1", spouse_id: "m1" })).toEqual(["h1", "m1"]);
  });

  it("sem cônjuge, só o principal (sem nulos)", () => {
    expect(ministryNodeParentIds({ member_id: "h1", spouse_id: null })).toEqual(["h1"]);
  });
});

describe("getLevelLabel", () => {
  it.each([
    [0, "Pastor(a)"],
    [1, "12"],
    [2, "144"],
    [3, "1.728"],
    [4, "Nível 4"],
    [7, "Nível 7"],
  ])("nível %i → %s", (level, label) => {
    expect(getLevelLabel(level)).toBe(label);
  });
});

describe("directDisciplesLabel", () => {
  it("singular", () => {
    expect(directDisciplesLabel(1)).toBe("1 discípulo direto");
  });

  it("plural, com o separador de milhar", () => {
    expect(directDisciplesLabel(2)).toBe("2 discípulos diretos");
    expect(directDisciplesLabel(1234)).toBe("1.234 discípulos diretos");
  });
});
