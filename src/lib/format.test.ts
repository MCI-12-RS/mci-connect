import { describe, it, expect } from "vitest";
import { formatCount } from "./format";

describe("formatCount", () => {
  it("abaixo de mil, sai sem separador", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(7)).toBe("7");
    expect(formatCount(999)).toBe("999");
  });

  it("a partir de mil, separa os milhares com ponto (inclusive com 4 dígitos)", () => {
    expect(formatCount(1000)).toBe("1.000");
    expect(formatCount(1530)).toBe("1.530");
    expect(formatCount(1234567)).toBe("1.234.567");
  });
});
