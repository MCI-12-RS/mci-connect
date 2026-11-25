// E1.04 (AQ-3, UX-10): a leitura da identificação na tela passa pela mesma
// tabela de casos que o pgTAP de private.parse_login_identifier.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkBeforeSubmit,
  classifyIdentifier,
  identifierIndicatorLabel,
  isValidCpf,
  normalizeMobile,
  type IdentifierFormat,
} from "./identifier";

interface IdentifierCase {
  id: string;
  input: string;
  format: IdentifierFormat;
  cpf: string | null;
  mobile: string | null;
}

const casesPath = resolve(__dirname, "../../../supabase/tests/fixtures/login-identifier-cases.json");
const { cases }: { cases: IdentifierCase[] } = JSON.parse(readFileSync(casesPath, "utf8"));

describe("classifyIdentifier (tabela de casos)", () => {
  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(classifyIdentifier(c.input)).toBe(c.format);
  });
});

describe("isValidCpf e normalizeMobile (formas normalizadas da tabela)", () => {
  const numeric = cases.filter((c) => c.format !== "empty" && c.format !== "email" && c.input.length <= 254);
  it.each(numeric.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const digits = c.input.replace(/\D/g, "");
    expect(digits.length === 11 && isValidCpf(digits) ? digits : null).toBe(c.cpf);
    expect(normalizeMobile(c.input)).toBe(c.mobile);
  });
});

describe("isValidCpf", () => {
  it("aceita CPF válido e recusa dígito errado, dígitos iguais e tamanho errado", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("00000000191")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("529.982.247-25")).toBe(false);
  });
});

describe("identifierIndicatorLabel (UX-10)", () => {
  const t1: Array<[string, string | null]> = [
    ["ana.souza@exemplo.com", "E-mail"],
    ["(51) 98888-7777", "Celular"],
    ["+55 (51) 98888-7777", "Celular"],
    ["5551988887777", "Celular"],
    ["051 98888-7777", "Celular"],
    ["(51) 8888-7777", "Celular"],
    ["55999991234", "Celular"],
    ["+55 55 99999-1234", "Celular"],
    ["529.982.247-25", "CPF ou celular"],
    ["52998224725", "CPF ou celular"],
    ["012.345.678-90", "CPF ou celular"],
    ["529.982.247-26", "Celular"],
    ["000.000.001-91", "CPF"],
    ["9888-7777", null],
    ["", null],
    ["   ", null],
  ];
  it.each(t1)("%s → %s", (input, label) => {
    expect(identifierIndicatorLabel(input)).toBe(label);
  });
});

describe("checkBeforeSubmit (RN-08, UX-01, UX-19)", () => {
  it("campos vazios vêm antes do formato; identificação só com espaços é vazia", () => {
    expect(checkBeforeSubmit("", "")).toEqual({ kind: "empty_fields", identifierEmpty: true, passwordEmpty: true });
    expect(checkBeforeSubmit("   ", "x")).toEqual({ kind: "empty_fields", identifierEmpty: true, passwordEmpty: false });
    expect(checkBeforeSubmit("9888-7777", "")).toEqual({
      kind: "empty_fields",
      identifierEmpty: false,
      passwordEmpty: true,
    });
  });

  it("a senha só com espaços não é vazia (RN-09)", () => {
    expect(checkBeforeSubmit("ana@exemplo.com", "   ")).toBeNull();
  });

  it("sem @ e sem forma de CPF nem de celular: formato não reconhecido", () => {
    expect(checkBeforeSubmit("9888-7777", "x")).toEqual({ kind: "invalid_format" });
    expect(checkBeforeSubmit("ana.souza", "x")).toEqual({ kind: "invalid_format" });
  });

  it("com @ sempre envia, mesmo acima de 254 caracteres", () => {
    expect(checkBeforeSubmit("ana@", "x")).toBeNull();
    expect(checkBeforeSubmit(`${"a".repeat(260)}@x.com`, "x")).toBeNull();
  });

  it("celular, CPF e CPF ou celular são enviados", () => {
    expect(checkBeforeSubmit("(51) 98888-7777", "x")).toBeNull();
    expect(checkBeforeSubmit("000.000.001-91", "x")).toBeNull();
    expect(checkBeforeSubmit("529.982.247-25", "x")).toBeNull();
  });
});
