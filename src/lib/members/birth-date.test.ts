// E2.04 (RN-15, DA-13, UX-20): a data de nascimento passa pela mesma tabela
// de casos que o pgTAP de birth_date_problem.
import { describe, expect, it } from "vitest";
import { memberValidationCases as cases } from "@/test/member-validation-cases";
import { ageInYears, ageLabel, birthDateBounds, birthDateProblem } from "./birth-date";

describe("birthDateProblem (tabela de casos)", () => {
  it.each(cases.birthDate.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(birthDateProblem(c.birth, c.today)).toBe(c.problem);
  });

  it("uma data que não existe conta como vazia", () => {
    expect(birthDateProblem("2023-02-29", "2026-11-23")).toBeNull();
  });
});

describe("ageLabel (tabela de casos)", () => {
  it.each(cases.age.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(ageLabel(c.birth, c.today)).toBe(c.text);
  });

  it("UX-20: 14/02/1992 em 23/11/2026 é 34 anos", () => {
    expect(ageLabel("1992-02-14", "2026-11-23")).toBe("34 anos");
  });

  it("sem data aceita, não há idade", () => {
    expect(ageLabel(null, "2026-11-23")).toBeNull();
    expect(ageLabel("2026-11-24", "2026-11-23")).toBeNull();
    expect(ageLabel("1926-11-23", "2026-11-23")).toBeNull();
  });

  it("29/02 faz aniversário em 01/03 nos anos não bissextos (DA-13)", () => {
    expect(ageInYears("2000-02-29", "2027-02-28")).toBe(26);
    expect(ageInYears("2000-02-29", "2027-03-01")).toBe(27);
    expect(ageInYears("2000-02-29", "2028-02-29")).toBe(28);
  });
});

describe("birthDateBounds (UX-20)", () => {
  it("max é hoje e min é o dia seguinte ao de 100 anos atrás", () => {
    expect(birthDateBounds("2026-11-23")).toEqual({ min: "1926-11-24", max: "2026-11-23" });
  });

  it("os limites batem com a regra, inclusive no 29/02", () => {
    for (const today of ["2026-11-23", "2024-02-29", "2100-02-28", "2100-03-01", "2026-12-31"]) {
      const { min, max } = birthDateBounds(today);
      expect(birthDateProblem(min, today), today).toBeNull();
      expect(birthDateProblem(max, today), today).toBeNull();
    }
  });
});
