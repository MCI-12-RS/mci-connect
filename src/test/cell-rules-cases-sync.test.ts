// E2.08 (AQ-4, DT-02, DT-17): o pgTAP das regras do cadastro de célula é gerado a partir da tabela
// única de casos (supabase/tests/fixtures/cell-rules-cases.json). Este teste falha se o SQL gravado
// estiver desatualizado em relação ao JSON ou ao gerador, ou se as listas do JSON divergirem das da
// migration ou do front.
// Para corrigir: node supabase/tests/fixtures/generate-cell-rules-cases.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CELL_TYPES, DEFAULT_CELL_TYPE } from "@/lib/cells/cell-types";
import { WEEKDAYS, weekdayIndex } from "@/lib/cells/weekdays";
import { cellRulesCases as c } from "./cell-rules-cases";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-cell-rules-cases.mjs");
const sqlPath = resolve(root, "supabase/tests/database/e208_02_cases.test.sql");
const migrationsDir = resolve(root, "supabase/migrations");
const migration = readFileSync(
  resolve(migrationsDir, readdirSync(migrationsDir).find((f) => f.endsWith("_e208_02_cell_rules.sql"))!),
  "utf8",
);
const listIn = (fn: string) =>
  [...migration.match(new RegExp(`FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?SELECT ARRAY\\[([^\\]]*)\\]`))![1].matchAll(/'([^']+)'/g)].map(
    (m) => m[1],
  );

describe("E2.08 AQ-4: tabela única de casos das regras do cadastro de célula", () => {
  it("o SQL gerado do pgTAP está em dia com o JSON de casos", () => {
    const expected = execFileSync("node", [generator, "--stdout"], { encoding: "utf8" });
    expect(readFileSync(sqlPath, "utf8"), "rode: node supabase/tests/fixtures/generate-cell-rules-cases.mjs").toBe(expected);
  });

  it("DT-02: as listas do JSON são as da migration (cell_weekdays, cell_types, cell_default_type)", () => {
    expect(c.weekdays).toEqual(listIn("cell_weekdays"));
    expect(c.types).toEqual(listIn("cell_types"));
    expect(migration).toMatch(new RegExp(`FUNCTION public\\.cell_default_type\\(\\)[\\s\\S]*?SELECT '${c.default_type}'::text`));
  });

  it("DT-02: as listas do JSON são as do front (weekdays.ts e cell-types.ts)", () => {
    expect([...WEEKDAYS]).toEqual(c.weekdays);
    expect([...CELL_TYPES]).toEqual(c.types);
    expect(DEFAULT_CELL_TYPE).toBe(c.default_type);
    expect(c.weekday_options.map((o) => o.value).sort()).toEqual([...c.weekdays].sort());
  });

  it("weekdayIndex do front segue os casos de dia do banco", () => {
    for (const x of c.meeting_day) {
      const valid = "stored" in x.db;
      expect(weekdayIndex(x.input) !== null, `${x.id} ${JSON.stringify(x.input)}`).toBe(valid);
    }
  });

  it("ids únicos e os exemplos do spec (RN-05, RN-06, RN-07, DA-12)", () => {
    for (const section of ["meeting_day", "type", "meeting_time"] as const) {
      const ids = c[section].map((x) => x.id);
      expect(new Set(ids).size, section).toBe(ids.length);
    }
    const day = new Map(c.meeting_day.map((x) => [x.input, x.db]));
    for (const bad of ["Segunda-feira", "segunda", "Terca"]) expect(day.get(bad)).toEqual({ code: "meeting_day_invalid" });
    for (const empty of ["", "  ", null]) expect(day.get(empty)).toEqual({ code: "meeting_day_required" });
    const time = new Map(c.meeting_time.map((x) => [x.input, x]));
    expect(time.get("24:00")?.db).toEqual({ code: "meeting_time_invalid" });
    expect(time.get("19:30:45")?.db).toEqual({ stored: "19:30:00" });
    for (const t of ["25:00", "19:60"]) expect(time.get(t)?.db).toEqual({ sqlstate: "22008" });
    for (const [input, blur] of [["20", "20:00"], ["7:30", "07:30"], ["730", "73:0"]] as const) {
      expect(time.get(input)?.blur, input).toBe(blur);
    }
    const types = c.type.filter((x) => x.op === "insert" && !x.omit);
    for (const bad of ["Discipuladora", "evangelistica", ""]) {
      expect(types.find((x) => x.input === bad)?.db).toEqual({ code: "cell_type_invalid" });
    }
  });
});
