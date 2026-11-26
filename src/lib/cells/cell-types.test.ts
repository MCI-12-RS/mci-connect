import { describe, expect, it } from "vitest";
import { cellRulesCases } from "@/test/cell-rules-cases";
import { CELL_TYPES, DEFAULT_CELL_TYPE, isCellType } from "./cell-types";

describe("cell-types (E2.08, RN-07)", () => {
  it("a lista e o padrão são os da tabela de casos (espelho de cell_types e cell_default_type)", () => {
    expect([...CELL_TYPES]).toEqual(cellRulesCases.types);
    expect(DEFAULT_CELL_TYPE).toBe(cellRulesCases.default_type);
  });

  it("isCellType compara exatamente, como o CHECK do banco", () => {
    for (const x of cellRulesCases.type.filter((t) => t.op === "insert" && !t.omit && t.input !== null)) {
      expect(isCellType(x.input), `${x.id} ${JSON.stringify(x.input)}`).toBe("stored" in x.db);
    }
    expect(isCellType(null)).toBe(false);
  });
});
