import { describe, it, expect } from "vitest";
import { sortAlphabetically } from "./collation";

describe("sortAlphabetically", () => {
  it("põe as letras acentuadas junto das outras, como no português", () => {
    const names = ["Zuleica Zanetti", "Ana Souza", "Álvaro Dias", "Bruno Lima", "Édson Reis", "Eduardo Lima"];
    // Pelo código do caractere, "Á" e "É" iriam para depois do "Z".
    expect([...names].sort()).toEqual(["Ana Souza", "Bruno Lima", "Eduardo Lima", "Zuleica Zanetti", "Álvaro Dias", "Édson Reis"]);

    expect(sortAlphabetically(names)).toEqual(["Álvaro Dias", "Ana Souza", "Bruno Lima", "Édson Reis", "Eduardo Lima", "Zuleica Zanetti"]);
  });

  it("não muda a lista recebida", () => {
    const names = ["Bruno", "Ana"];
    expect(sortAlphabetically(names)).toEqual(["Ana", "Bruno"]);
    expect(names).toEqual(["Bruno", "Ana"]);
  });
});
