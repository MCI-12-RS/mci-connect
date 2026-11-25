import { genderLabel } from "./gender";

describe("genderLabel", () => {
  it("traduz M e F e deixa vazio o resto", () => {
    expect(genderLabel("M")).toBe("Masculino");
    expect(genderLabel("F")).toBe("Feminino");
    expect(genderLabel(null)).toBe("");
    expect(genderLabel("X")).toBe("");
    expect(genderLabel("toString")).toBe("");
  });
});
