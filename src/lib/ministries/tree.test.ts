import { describe, it, expect } from "vitest";
import {
  findCoupleInPath,
  ministryNodeAccessibleName,
  ministryNodeKey,
  ministryNodeParentIds,
  toMinistryTreeItem,
  type MinistryCoupleNode,
  type MinistryTreeRow,
} from "./tree";

function row(overrides: Partial<MinistryTreeRow>): MinistryTreeRow {
  return {
    member_id: "x",
    member_name: "Sem Nome",
    g12_level: 2,
    is_pastor: false,
    spouse_id: null,
    spouse_name: null,
    direct_disciples: 0,
    total_disciples: 0,
    total_cells: 0,
    kind: "node",
    level_gender: "M",
    level_is_pastor: false,
    spouse_is_pastor: false,
    ...overrides,
  };
}

function coupleNode(overrides: Partial<MinistryTreeRow>): MinistryCoupleNode {
  const item = toMinistryTreeItem(row(overrides));
  if (item.kind !== "node") throw new Error("esperava um nó");
  return item;
}

const diegoOlga = row({
  member_id: "diego",
  member_name: "Diego Reis",
  spouse_id: "olga",
  spouse_name: "Olga Reis",
  g12_level: 2,
  direct_disciples: 2,
  total_disciples: 2,
  total_cells: 3,
});

describe("toMinistryTreeItem (RN-09, T3, T4)", () => {
  it("nó: o casal, o nível da posição e os totais", () => {
    expect(toMinistryTreeItem(diegoOlga)).toEqual({
      kind: "node",
      member_id: "diego",
      member_name: "Diego Reis",
      spouse_id: "olga",
      spouse_name: "Olga Reis",
      level: { level: 2, isPastor: false, gender: "M", bothPastors: false },
      direct_disciples: 2,
      total_disciples: 2,
      total_cells: 3,
    });
  });

  it("referência (spouse_above): o nível da própria pessoa, o cônjuge de cima e nenhum total", () => {
    const item = toMinistryTreeItem(
      row({
        kind: "spouse_above",
        member_id: "olga",
        member_name: "Olga Reis",
        spouse_id: "diego",
        spouse_name: "Diego Reis",
        g12_level: 4,
        level_gender: "F",
        direct_disciples: 0,
        total_disciples: null,
        total_cells: null,
      }),
    );
    expect(item).toEqual({
      kind: "spouse_above",
      member_id: "olga",
      member_name: "Olga Reis",
      spouse_id: "diego",
      spouse_name: "Diego Reis",
      level: { level: 4, isPastor: false, gender: "F" },
    });
    expect(item).not.toHaveProperty("total_disciples");
    expect(item).not.toHaveProperty("direct_disciples");
  });

  it("referência sem o cônjuge vira nó, sem esconder a pessoa", () => {
    const item = toMinistryTreeItem(row({ kind: "spouse_above", member_id: "olga", total_disciples: null }));
    expect(item.kind).toBe("node");
    expect(item).toMatchObject({ total_disciples: 0, total_cells: 0, direct_disciples: 0 });
  });

  it("totais nulos no nó viram zero (os totais aparecem sempre, P42)", () => {
    expect(coupleNode({ total_disciples: null, total_cells: null, direct_disciples: null })).toMatchObject({
      total_disciples: 0,
      total_cells: 0,
      direct_disciples: 0,
    });
  });

  it("dois pastores no nó: Pastores", () => {
    const node = coupleNode({
      g12_level: 0,
      is_pastor: true,
      spouse_id: "magda",
      spouse_name: "Magda Colares",
      spouse_is_pastor: true,
      level_is_pastor: true,
    });
    expect(node.level.bothPastors).toBe(true);
  });

  it("um pastor só no nó (cônjuge não pastora): não é Pastores", () => {
    const node = coupleNode({
      g12_level: 0,
      is_pastor: true,
      spouse_id: "s",
      spouse_name: "S",
      spouse_is_pastor: false,
      level_is_pastor: true,
    });
    expect(node.level.bothPastors).toBe(false);
  });

  it("pastor sem cônjuge exibido: não é Pastores, mesmo com spouse_is_pastor", () => {
    expect(coupleNode({ g12_level: 0, is_pastor: true, spouse_is_pastor: true }).level.bothPastors).toBe(false);
  });

  it("cônjuge sem id não leva o nome (o nó é só do principal)", () => {
    expect(coupleNode({ spouse_id: null, spouse_name: "Fantasma" }).spouse_name).toBeNull();
  });
});

describe("ministryNodeAccessibleName (UX-12, P40, P42)", () => {
  it("Diego e Olga: os nomes, o nível sem o prefixo e os totais", () => {
    expect(ministryNodeAccessibleName(coupleNode(diegoOlga))).toBe("Diego Reis e Olga Reis, 144, 2 discípulos, 3 células");
  });

  it("dois pastores: Pastores, com milhar nos totais", () => {
    const node = coupleNode({
      member_name: "Samuel Colares",
      spouse_id: "magda",
      spouse_name: "Magda Colares",
      g12_level: 0,
      is_pastor: true,
      level_is_pastor: true,
      spouse_is_pastor: true,
      total_disciples: 2000,
      total_cells: 1,
    });
    expect(ministryNodeAccessibleName(node)).toBe("Samuel Colares e Magda Colares, Pastores, 2.000 discípulos, 1 célula");
  });

  it("uma pessoa só, com o nível pelo sexo de quem dá o nível", () => {
    const node = coupleNode({ member_name: "Magda Colares", g12_level: 0, level_is_pastor: true, level_gender: "F" });
    expect(ministryNodeAccessibleName(node)).toBe("Magda Colares, Pastora, 0 discípulos, 0 células");
  });

  it("raiz sem liderança (nível nulo e não pastor): Sem liderança, e não 'Nível null'", () => {
    const node = coupleNode({ member_name: "Ester Ramos", g12_level: null, level_gender: "F", total_disciples: 1 });
    expect(ministryNodeAccessibleName(node)).toBe("Ester Ramos, Sem liderança, 1 discípulo, 0 células");
  });

  it.each([
    [1, "G12"],
    [3, "1.728"],
    [4, "20.736"],
    [5, "Nível 5"],
  ])("nível %i → %s (nunca '12' sozinho)", (level, label) => {
    expect(ministryNodeAccessibleName(coupleNode({ member_name: "A", g12_level: level }))).toBe(
      `A, ${label}, 0 discípulos, 0 células`,
    );
  });
});

describe("ministryNodeKey (RN-10)", () => {
  it("casal: principal e cônjuge", () => {
    expect(ministryNodeKey(coupleNode({ member_id: "h1", spouse_id: "m1", spouse_name: "M" }))).toBe("h1|m1");
  });

  it("sem cônjuge exibido", () => {
    expect(ministryNodeKey(coupleNode({ member_id: "h1" }))).toBe("h1|");
  });

  it("o mesmo membro em dois nós (vínculo de cônjuge assimétrico) gera chaves diferentes", () => {
    const sozinho = ministryNodeKey(coupleNode({ member_id: "h1" }));
    const casado = ministryNodeKey(coupleNode({ member_id: "h1", spouse_id: "m1", spouse_name: "M" }));
    expect(sozinho).not.toBe(casado);
  });

  it("a referência não colide com um nó dos mesmos ids", () => {
    const reference = toMinistryTreeItem(
      row({ kind: "spouse_above", member_id: "h1", spouse_id: "m1", spouse_name: "M" }),
    );
    expect(ministryNodeKey(reference)).not.toBe(
      ministryNodeKey(coupleNode({ member_id: "h1", spouse_id: "m1", spouse_name: "M" })),
    );
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

describe("findCoupleInPath (T4, AQ-3)", () => {
  const samuel = { node: coupleNode({ member_id: "samuel", spouse_id: "magda", spouse_name: "Magda" }), id: "a" };
  const tiago = { node: coupleNode({ member_id: "tiago", spouse_id: "tania", spouse_name: "Tânia" }), id: "b" };
  const diego = { node: coupleNode(diegoOlga), id: "c" };
  const lauro = { node: coupleNode({ member_id: "lauro" }), id: "d" };
  const path = [samuel, tiago, diego, lauro];

  it("acha o casal pelo cônjuge como principal", () => {
    expect(findCoupleInPath(path, "diego")).toBe(diego);
  });

  it("acha o casal pelo cônjuge como cônjuge do nó", () => {
    expect(findCoupleInPath(path, "olga")).toBe(diego);
  });

  it("sobe a partir do nó mais próximo (devolve a entrada do caminho, não outra cópia do casal)", () => {
    const diegoAgain = { node: diego.node, id: "e" };
    expect(findCoupleInPath([samuel, diego, tiago, diegoAgain, lauro], "olga")).toBe(diegoAgain);
  });

  it("fora do caminho: nenhum", () => {
    expect(findCoupleInPath(path, "ninguem")).toBeUndefined();
    expect(findCoupleInPath([], "diego")).toBeUndefined();
  });
});
