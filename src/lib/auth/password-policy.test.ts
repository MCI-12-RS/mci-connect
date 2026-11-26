// E2.03 (RN-13, RN-07, UX-08, DA-4 a DA-7, AQ-6): a gêmea da política na tela,
// sobre a mesma tabela de casos do pgTAP. Os casos `server_only` (a lista de
// senhas comuns, regra e) e a regra (h) da troca obrigatória (bcrypt da senha
// com que a pessoa entrou) são só do servidor.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkPasswordChange,
  foldPassword,
  initialPasswordViolation,
  isSimpleSequence,
  meetsMinLength,
  passwordPolicyViolation,
  type PasswordChangeCheck,
  type PasswordPersonalData,
} from "./password-policy";

interface PolicyCase {
  id: string;
  context: "policy" | "login" | "initial" | "change_voluntary" | "change_forced";
  password: string;
  personal: PasswordPersonalData;
  current_password?: string;
  confirmation?: string;
  expected: string | null;
  server_only?: boolean;
}

const casesPath = resolve(__dirname, "../../../supabase/tests/fixtures/password-policy-cases.json");
const { cases }: { cases: PolicyCase[] } = JSON.parse(readFileSync(casesPath, "utf8"));

function codeOf(check: PasswordChangeCheck): string | null {
  if (!check) return null;
  return check.kind === "empty" ? "empty_fields" : check.code;
}

function screenResult(c: PolicyCase): string | null {
  switch (c.context) {
    case "policy":
    case "login":
      return passwordPolicyViolation(c.password, c.personal);
    case "initial":
      return initialPasswordViolation(c.password, c.personal);
    case "change_voluntary":
    case "change_forced":
      return codeOf(
        checkPasswordChange({
          mode: c.context === "change_voluntary" ? "voluntary" : "forced",
          currentPassword: c.current_password ?? "",
          newPassword: c.password,
          confirmation: c.confirmation ?? c.password,
          personal: c.context === "change_voluntary" ? c.personal : null,
        }),
      );
  }
}

// A (h) da obrigatória é conferida pelo bcrypt no servidor: a tela não tem a senha com que a pessoa entrou.
const screenCases = cases.filter(
  (c) => !c.server_only && !(c.context === "change_forced" && c.expected === "password_same_as_current"),
);

describe("passwordPolicyViolation: a tabela de casos (sem os server_only)", () => {
  it("cobre a maior parte dos casos", () => {
    expect(screenCases.length).toBeGreaterThan(60);
  });

  it.each(screenCases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(screenResult(c)).toBe(c.expected);
  });
});

describe("regras de apoio", () => {
  it("foldPassword: acentos compostos e decompostos, só ASCII em minúsculas (DA-4)", () => {
    expect(foldPassword("Ígreja")).toBe("igreja");
    expect(foldPassword("Ígreja")).toBe("igreja");
    expect(foldPassword("ÇÃO")).toBe("cao");
    expect(foldPassword("🙂A")).toBe("🙂a");
  });

  it("isSimpleSequence: dígitos com volta, letras sem volta (DA-5)", () => {
    expect(isSimpleSequence("90123456")).toBe(true);
    expect(isSimpleSequence("21098765")).toBe(true);
    expect(isSimpleSequence("zyxwvuts")).toBe(true);
    expect(isSimpleSequence("xyzabcde")).toBe(false);
    expect(isSimpleSequence("45454545")).toBe(false);
  });

  it("meetsMinLength conta pontos de código, não bytes nem unidades UTF-16 (UX-07)", () => {
    expect(meetsMinLength("Abc1234")).toBe(false);
    expect(meetsMinLength("Abc12345")).toBe(true);
    expect(meetsMinLength("🙂🎉🙂🎉🙂🎉🙂")).toBe(false);
  });

  it("checkPasswordChange: os vazios, todos de uma vez, na ordem da tela (UX-08)", () => {
    expect(
      checkPasswordChange({ mode: "voluntary", currentPassword: "", newPassword: "", confirmation: "", personal: null }),
    ).toEqual({ kind: "empty", fields: ["current_password", "new_password", "confirmation"] });
    expect(checkPasswordChange({ mode: "forced", currentPassword: "", newPassword: "x", confirmation: "", personal: null })).toEqual({
      kind: "empty",
      fields: ["confirmation"],
    });
  });

  it("checkPasswordChange: a política vem antes da confirmação (DA-7)", () => {
    expect(
      checkPasswordChange({ mode: "forced", currentPassword: "", newPassword: "Abc1234", confirmation: "Xyz", personal: null }),
    ).toEqual({ kind: "invalid", field: "new_password", code: "password_too_short" });
  });
});
