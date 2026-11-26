import { describe, expect, it } from "vitest";
import { inactiveMark, personLabel } from "./labels";

describe("marca de situação da pessoa (E2.08, P63)", () => {
  it("(inativa) para mulher e (inativo) para os demais, inclusive sem o sexo", () => {
    expect(inactiveMark("F")).toBe("(inativa)");
    expect(inactiveMark("M")).toBe("(inativo)");
    expect(inactiveMark(null)).toBe("(inativo)");
  });

  it("o nome com a marca só para quem está inativo", () => {
    expect(personLabel({ name: "Fábio Lima", is_active: false, gender: "M" })).toBe("Fábio Lima (inativo)");
    expect(personLabel({ name: "Rita Reis", is_active: false, gender: "F" })).toBe("Rita Reis (inativa)");
    expect(personLabel({ name: "Carla Dias", is_active: true, gender: "F" })).toBe("Carla Dias");
    expect(personLabel({ name: "Beatriz", is_active: null })).toBe("Beatriz");
  });
});
