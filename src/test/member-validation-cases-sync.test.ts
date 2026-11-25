// E2.04 (AQ-2, DT-17, DT-18): o pgTAP das funções de regra é gerado a partir da tabela única de
// casos (supabase/tests/fixtures/member-validation-cases.json). Este teste falha se o SQL gravado
// estiver desatualizado em relação ao JSON ou ao gerador.
// Para corrigir: node supabase/tests/fixtures/generate-member-validation-cases.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-member-validation-cases.mjs");
const sqlPath = resolve(root, "supabase/tests/database/e204_01_functions_cases.test.sql");
const casesPath = resolve(root, "supabase/tests/fixtures/member-validation-cases.json");
const migrationPath = resolve(root, "supabase/migrations/20261125210000_e204_01_rule_functions.sql");
const guardTestPath = resolve(root, "supabase/tests/database/e204_01_duplicates_guard.test.sql");

type Cases = {
  placeholderEmailDomains: string[];
  generationDomain: string;
  name: Array<{ id: string; input: string | null; normalized: string | null; valid: boolean }>;
  email: Array<{ id: string; input: string | null; normalized: string | null; valid: boolean; placeholder: boolean }>;
  mobile: Array<{ id: string; input: string | null; normalized: string | null; matchKey: string | null }>;
  cpf: Array<{ id: string; input: string | null; digits: string | null; valid: boolean }>;
  birthDate: Array<{ id: string; today: string; birth: string | null; problem: string | null }>;
  age: Array<{ id: string; today: string; birth: string; text: string }>;
  identifier: Array<{ id: string; hasIdentifier: boolean }>;
};
const load = () => JSON.parse(readFileSync(casesPath, "utf8")) as Cases;

describe("E2.04 AQ-2: tabela única de casos das regras do cadastro de membro", () => {
  it("o SQL gerado do pgTAP está em dia com o JSON de casos", () => {
    const expected = execFileSync("node", [generator, "--stdout"], { encoding: "utf8" });
    const actual = readFileSync(sqlPath, "utf8");
    expect(actual, "rode: node supabase/tests/fixtures/generate-member-validation-cases.mjs").toBe(expected);
  });

  it("DT-18: a lista de domínios fictícios do JSON é a da migration, e o de geração está nela", () => {
    const c = load();
    const migration = readFileSync(migrationPath, "utf8");
    const listed = [...migration.match(/placeholder_email_domains\(\)[\s\S]*?SELECT ARRAY\[([^\]]*)\]/)![1].matchAll(/'([^']+)'/g)].map(
      (m) => m[1],
    );
    expect(c.placeholderEmailDomains).toEqual(listed);
    expect(c.placeholderEmailDomains).toContain(c.generationDomain);
  });

  it("ids únicos por seção e campos que a tela e o pgTAP leem", () => {
    const c = load();
    for (const section of ["name", "email", "mobile", "cpf", "birthDate", "age", "identifier"] as const) {
      const ids = c[section].map((x) => x.id);
      expect(new Set(ids).size, `ids repetidos em ${section}`).toBe(ids.length);
      expect(ids.length, section).toBeGreaterThan(3);
    }
    for (const x of c.name) expect(x).toHaveProperty("normalized");
    for (const x of c.email) expect(typeof x.placeholder).toBe("boolean");
    for (const x of c.birthDate) expect(x.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("cobre os exemplos das RN-02, RN-04, RN-15 e DA-13 do spec", () => {
    const c = load();
    const nameValid = new Map(c.name.map((x) => [x.input, x.valid]));
    for (const [input, valid] of [["Ana B.", true], ["Ana", false], ["Ana 2", false], ["Ana .", false]] as const) {
      expect(nameValid.get(input), input).toBe(valid);
    }
    const emailValid = new Map(c.email.map((x) => [x.input, x.valid]));
    for (const ok of ["ana@exemplo.com", "ana.souza@igreja.org.br"]) expect(emailValid.get(ok), ok).toBe(true);
    for (const bad of ["ana@exemplo", "ana@.com", "ana @exemplo.com", "ana@@exemplo.com", "ana@exemplo..com"]) {
      expect(emailValid.get(bad), bad).toBe(false);
    }
    const birth = new Map(c.birthDate.filter((x) => x.today === "2026-11-23").map((x) => [x.birth, x.problem]));
    expect(birth.get("1926-11-24")).toBeNull();
    expect(birth.get("1926-11-23")).toBe("birth_date_too_old");
    expect(birth.get("2026-11-24")).toBe("birth_date_future");
    expect(birth.get("2000-02-29")).toBeNull();
    expect(c.birthDate.some((x) => x.birth === "2000-02-29" && x.today !== "2026-11-23")).toBe(true);
  });
});

describe("E2.04 PR 1: a guarda de repetidos do pgTAP é a da migration", () => {
  it("o bloco DO da guarda de repetidos está copiado sem mudança no teste", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const start = migration.indexOf("DO $$\nDECLARE\n  _dups jsonb;");
    const end = migration.indexOf("END $$;", start) + "END $$;".length;
    expect(start).toBeGreaterThan(0);
    const block = migration.slice(start, end);
    expect(readFileSync(guardTestPath, "utf8")).toContain(block);
  });
});
