// E2.11 (DT-17): o pgTAP das regras do relatório é gerado a partir da tabela única de casos
// (supabase/tests/fixtures/report-rules-cases.json). Este teste falha se o SQL gravado estiver
// desatualizado em relação ao JSON ou ao gerador, ou se os limites do JSON divergirem da migration.
// Para corrigir: node supabase/tests/fixtures/generate-report-rules-cases.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-report-rules-cases.mjs");
const sqlPath = resolve(root, "supabase/tests/database/e211_02_cases.test.sql");
const migrationsDir = resolve(root, "supabase/migrations");
const migration = readFileSync(
  resolve(migrationsDir, readdirSync(migrationsDir).find((f) => f.endsWith("_e211_02_rules.sql"))!),
  "utf8",
);

interface Limits {
  theme: number;
  reason: number;
  observations: number;
  visitor_name: number;
  visitors: number;
  participants: number;
  offering_max: number;
}
interface Cases {
  limits: Limits;
  launch: { id: string; expected: { code: string | null; status: string } }[];
  edit: { id: string }[];
  offering: { id: string }[];
  visitors: { id: string }[];
  api_input: { id: string }[];
}
const cases: Cases = JSON.parse(readFileSync(resolve(root, "supabase/tests/fixtures/report-rules-cases.json"), "utf8"));

describe("E2.11 DT-17: tabela única de casos das regras do relatório", () => {
  it("o SQL gerado do pgTAP está em dia com o JSON de casos", () => {
    const expected = execFileSync("node", [generator, "--stdout"], { encoding: "utf8" });
    expect(readFileSync(sqlPath, "utf8"), "rode: node supabase/tests/fixtures/generate-report-rules-cases.mjs").toBe(expected);
  });

  it("DA-4/DA-5: os limites do JSON são os de private.report_limits() na migration", () => {
    const body = migration.match(/FUNCTION private\.report_limits\([\s\S]*?\$\$ SELECT ([^$]*)\$\$/)![1];
    const values = body.split(",").map((v) => Number.parseFloat(v.replace("::numeric", "").trim()));
    const l = cases.limits;
    expect(values).toEqual([l.theme, l.reason, l.observations, l.visitor_name, l.visitors, l.participants, l.offering_max]);
  });

  it("ids únicos e os exemplos do spec (RN-05, RN-06, RN-07)", () => {
    for (const section of ["launch", "edit", "offering", "visitors", "api_input"] as const) {
      const ids = cases[section].map((x) => x.id);
      expect(new Set(ids).size, section).toBe(ids.length);
    }
    const byId = new Map(cases.launch.map((x) => [x.id, x.expected]));
    expect(byId.get("L02")?.code).toBeNull();
    expect(byId.get("L03")?.code).toBe("report_in_future");
    expect(byId.get("L09")).toMatchObject({ status: "not_yet", code: "meeting_not_yet" });
    expect(byId.get("L10")?.code).toBeNull();
    expect(byId.get("L15")).toMatchObject({ status: "already_sent", code: "report_week_taken" });
  });
});
