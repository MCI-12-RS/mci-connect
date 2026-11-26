// E2.05 (DT-06): a lista única de campos da Auditoria vive em três lugares que precisam ser iguais:
// a carga de private.audit_fields (migration e205_02_schema), o JSON compartilhado
// (supabase/tests/fixtures/audit-fields.json) e o pgTAP gerado dele (e205_02_audit_fields). O PR 4
// acrescenta os rótulos da tela (src/lib/audit/fields.ts), conferidos contra o mesmo JSON.
// Para corrigir: node supabase/tests/fixtures/generate-audit-fields.mjs
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const generator = resolve(root, "supabase/tests/fixtures/generate-audit-fields.mjs");
const sqlPath = resolve(root, "supabase/tests/database/e205_02_audit_fields.test.sql");
const migrationsDir = resolve(root, "supabase/migrations");
const migrationFile = readdirSync(migrationsDir).find((f) => f.endsWith("_e205_02_schema.sql"));

interface AuditField {
  field: string;
  show_values: boolean;
  value_type: string;
}
interface AuditFieldsFixture {
  entities: Record<string, AuditField[]>;
}

const fixture: AuditFieldsFixture = JSON.parse(
  readFileSync(resolve(root, "supabase/tests/fixtures/audit-fields.json"), "utf8"),
);

describe("E2.05 DT-06: lista única de campos da Auditoria", () => {
  it("o SQL gerado do pgTAP está em dia com o JSON", () => {
    const expected = execFileSync("node", [generator, "--stdout"], { encoding: "utf8" });
    expect(readFileSync(sqlPath, "utf8"), "rode: node supabase/tests/fixtures/generate-audit-fields.mjs").toBe(expected);
  });

  it("o JSON é igual à carga de private.audit_fields na migration (campo, valor, tipo e ordem)", () => {
    expect(migrationFile, "migration *_e205_02_schema.sql").toBeDefined();
    const migration = readFileSync(resolve(migrationsDir, migrationFile ?? ""), "utf8");
    const rows = [...migration.matchAll(/\('(\w+)', '(\w+)',\s+(true|false),\s+'(\w+)',\s+(\d+)\)/g)].map((m) => ({
      entity: m[1],
      field: m[2],
      show_values: m[3] === "true",
      value_type: m[4],
      position: Number(m[5]),
    }));
    const fromJson = Object.entries(fixture.entities).flatMap(([entity, fields]) =>
      fields.map((f, i) => ({ entity, field: f.field, show_values: f.show_values, value_type: f.value_type, position: i + 1 })),
    );
    expect(rows).toEqual(fromJson);
  });
});
