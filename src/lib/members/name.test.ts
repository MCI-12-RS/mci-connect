// E2.04 (RN-02, DA-12): o nome passa pela mesma tabela de casos que o pgTAP
// de normalize_person_name e is_valid_person_name.
import { describe, expect, it } from "vitest";
import { memberValidationCases as cases } from "@/test/member-validation-cases";
import { isValidPersonName, normalizePersonName } from "./name";

describe("nome (tabela de casos)", () => {
  it.each(cases.name.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(normalizePersonName(c.input)).toBe(c.normalized);
    expect(isValidPersonName(c.input)).toBe(c.valid);
  });

  it("maiúsculas e acentos ficam como foram digitados", () => {
    expect(normalizePersonName("  JOÃO   da silva ")).toBe("JOÃO da silva");
  });
});
