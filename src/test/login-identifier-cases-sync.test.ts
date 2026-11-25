// E1.04 (AQ-3): o pgTAP de private.parse_login_identifier é gerado a partir da tabela única
// de casos (supabase/tests/fixtures/login-identifier-cases.json). Este teste falha se o SQL
// gravado estiver desatualizado em relação ao JSON ou ao gerador.
// Para corrigir: node supabase/tests/fixtures/generate-login-identifier-cases.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-login-identifier-cases.mjs");
const sqlPath = resolve(root, "supabase/tests/database/e104_02_parse_identifier.test.sql");
const casesPath = resolve(root, "supabase/tests/fixtures/login-identifier-cases.json");

describe("E1.04 AQ-3: tabela única de casos do identificador de login", () => {
  it("o SQL gerado do pgTAP está em dia com o JSON de casos", () => {
    const expected = execFileSync("node", [generator, "--stdout"], { encoding: "utf8" });
    const actual = readFileSync(sqlPath, "utf8");
    expect(actual, "rode: node supabase/tests/fixtures/generate-login-identifier-cases.mjs").toBe(expected);
  });

  it("todo caso tem os campos que o Vitest da tela e o pgTAP leem", () => {
    const { cases } = JSON.parse(readFileSync(casesPath, "utf8")) as {
      cases: Array<Record<string, unknown>>;
    };
    const ids = new Set<string>();
    for (const c of cases) {
      expect(typeof c.id).toBe("string");
      expect(ids.has(c.id as string), `id duplicado: ${String(c.id)}`).toBe(false);
      ids.add(c.id as string);
      expect(typeof c.input).toBe("string");
      expect(["empty", "email", "mobile", "cpf", "cpf_or_mobile", "unknown"]).toContain(c.format);
      for (const k of ["email", "cpf", "mobile", "mobileKey"]) expect(c).toHaveProperty(k);
    }
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  it("cobre os exemplos da tabela da T1 (UX-10) e os critérios das RN-02 a RN-04", () => {
    const { cases } = JSON.parse(readFileSync(casesPath, "utf8")) as { cases: Array<{ input: string; format: string }> };
    const byInput = new Map(cases.map((c) => [c.input, c.format]));
    const t1: Array<[string, string]> = [
      ["ana.souza@exemplo.com", "email"],
      ["(51) 98888-7777", "mobile"],
      ["+55 (51) 98888-7777", "mobile"],
      ["5551988887777", "mobile"],
      ["051 98888-7777", "mobile"],
      ["(51) 8888-7777", "mobile"],
      ["55999991234", "mobile"],
      ["+55 55 99999-1234", "mobile"],
      ["529.982.247-25", "cpf_or_mobile"],
      ["52998224725", "cpf_or_mobile"],
      ["012.345.678-90", "cpf_or_mobile"],
      ["529.982.247-26", "mobile"],
      ["000.000.001-91", "cpf"],
      ["9888-7777", "unknown"],
    ];
    for (const [input, format] of t1) expect(byInput.get(input), input).toBe(format);
  });
});
