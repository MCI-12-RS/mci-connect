// E2.03 (tarefa 5): o pgTAP da política de senha é gerado a partir da tabela única de casos
// (supabase/tests/fixtures/password-policy-cases.json). Este teste falha se o SQL gravado
// estiver desatualizado em relação ao JSON ou ao gerador.
// Para corrigir: node supabase/tests/fixtures/generate-password-policy-cases.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-password-policy-cases.mjs");
const sqlPath = resolve(root, "supabase/tests/database/e203_02_policy.test.sql");
const casesPath = resolve(root, "supabase/tests/fixtures/password-policy-cases.json");

const CONTEXTS = ["policy", "login", "initial", "change_voluntary", "change_forced"];

describe("E2.03: tabela única de casos da política de senha", () => {
  it("o SQL gerado do pgTAP está em dia com o JSON de casos", () => {
    const expected = execFileSync("node", [generator, "--stdout"], { encoding: "utf8" });
    const actual = readFileSync(sqlPath, "utf8");
    expect(actual, "rode: node supabase/tests/fixtures/generate-password-policy-cases.mjs").toBe(expected);
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
      expect(CONTEXTS).toContain(c.context);
      expect(typeof c.password).toBe("string");
      expect(c.personal, `${String(c.id)} sem personal`).toBeTypeOf("object");
      expect("expected" in c, `${String(c.id)} sem expected`).toBe(true);
      if (c.expected !== null) {
        expect(["password_too_short", "password_too_long", "password_weak", "password_personal_data",
          "password_same_as_current", "password_mismatch", "empty_fields"]).toContain(c.expected);
      }
    }
    expect(ids.size).toBe(75);
  });
});
