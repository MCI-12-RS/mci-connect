// E2.04 (RN-04 a RN-09, DT-17, DT-18): as regras de e-mail, celular e CPF da
// tela passam pela mesma tabela de casos que o pgTAP das funções do banco.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { memberValidationCases as cases } from "@/test/member-validation-cases";
import {
  PLACEHOLDER_EMAIL_DOMAINS,
  formatCpf,
  formatMobile,
  hasLoginIdentifier,
  isPlaceholderEmail,
  isValidCpf,
  isValidEmail,
  mobileMatchKey,
  normalizeCpf,
  normalizeEmail,
  normalizeMobile,
} from "./identifiers";

const rows = <T extends { id: string }>(list: T[]) => list.map((c) => [c.id, c] as const);

describe("PLACEHOLDER_EMAIL_DOMAINS (DT-18)", () => {
  it("é a lista da tabela de casos (a mesma de placeholder_email_domains())", () => {
    expect([...PLACEHOLDER_EMAIL_DOMAINS]).toEqual(cases.placeholderEmailDomains);
  });
});

describe("e-mail (RN-04, RN-05; tabela de casos)", () => {
  it.each(rows(cases.email))("%s", (_id, c) => {
    const normalized = normalizeEmail(c.input);
    expect(normalized).toBe(c.normalized);
    expect(isValidEmail(normalized)).toBe(c.valid);
    expect(isPlaceholderEmail(c.input)).toBe(c.placeholder);
  });

  it("DA-3: conta caracteres, não unidades UTF-16", () => {
    const local = "á".repeat(240);
    expect(isValidEmail(`${local}@exemplo.com`)).toBe(true);
  });
});

describe("celular (RN-06, RN-09; tabela de casos)", () => {
  it.each(rows(cases.mobile))("%s", (_id, c) => {
    expect(normalizeMobile(c.input)).toBe(c.normalized);
    expect(mobileMatchKey(c.input)).toBe(c.matchKey);
  });

  it("formatMobile mostra a forma lida e devolve o resto como veio", () => {
    expect(formatMobile("51988887777")).toBe("(51) 98888-7777");
    expect(formatMobile("5133334444")).toBe("(51) 3333-4444");
    expect(formatMobile("55999991111")).toBe("(55) 99999-1111");
    expect(formatMobile("98887777")).toBe("98887777");
  });
});

describe("celular do login (E1.04): a mesma leitura", () => {
  const loginPath = resolve(__dirname, "../../../supabase/tests/fixtures/login-identifier-cases.json");
  const { cases: login }: { cases: Array<{ id: string; input: string; format: string; mobile: string | null; mobileKey: string | null }> } =
    JSON.parse(readFileSync(loginPath, "utf8"));
  const numeric = login.filter((c) => c.format !== "empty" && c.format !== "email" && c.input.length <= 254);
  it.each(numeric.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(normalizeMobile(c.input)).toBe(c.mobile);
    expect(mobileMatchKey(c.input)).toBe(c.mobileKey);
  });
});

describe("CPF (RN-07; tabela de casos)", () => {
  it.each(rows(cases.cpf))("%s", (_id, c) => {
    const digits = normalizeCpf(c.input);
    expect(digits).toBe(c.digits);
    expect(isValidCpf(digits)).toBe(c.valid);
  });

  it("formatCpf põe a máscara nos 11 dígitos e devolve o resto como veio", () => {
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
    expect(formatCpf("01234567890")).toBe("012.345.678-90");
    expect(formatCpf("123")).toBe("123");
  });
});

describe("identificador de login (RN-08; tabela de casos)", () => {
  it.each(rows(cases.identifier))("%s", (_id, c) => {
    expect(hasLoginIdentifier({ email: c.email, mobile: c.mobile, cpf: c.cpf })).toBe(c.hasIdentifier);
  });
});
