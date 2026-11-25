import { describe, expect, it } from "vitest";
import { cellsText, disciplesText, totalsSpokenText, totalsText } from "./totals";

// P42 do E2.06: totais por extenso (UX-04).

describe("totais por extenso", () => {
  it("singular só com 1; o zero vai no plural", () => {
    expect(disciplesText(1)).toBe("1 discípulo");
    expect(disciplesText(0)).toBe("0 discípulos");
    expect(cellsText(1)).toBe("1 célula");
    expect(cellsText(0)).toBe("0 células");
    expect(cellsText(3)).toBe("3 células");
  });

  it("milhar com o separador do pt-BR", () => {
    expect(disciplesText(2000)).toBe("2.000 discípulos");
    expect(cellsText(1530)).toBe("1.530 células");
  });

  it("sem valor, zero", () => {
    expect(disciplesText(null)).toBe("0 discípulos");
    expect(cellsText(undefined)).toBe("0 células");
  });

  it("na linha, com o '·'; para o leitor de tela, com a vírgula", () => {
    expect(totalsText({ disciples: 2, cells: 3 })).toBe("2 discípulos · 3 células");
    expect(totalsText({ disciples: 1, cells: 1 })).toBe("1 discípulo · 1 célula");
    expect(totalsSpokenText({ disciples: 2, cells: 3 })).toBe("2 discípulos, 3 células");
  });

  it("nunca abrevia", () => {
    const text = totalsText({ disciples: 5, cells: 5 });
    expect(text).not.toMatch(/disc\.|cél\./);
  });
});
