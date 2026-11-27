import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_FIELDS, auditField, formatAuditValue, isAuditFieldEntity, type AuditFieldEntity } from "./fields";

// E2.05 (DT-06, RN-20): os rótulos da tela conferidos contra a lista única de campos
// (supabase/tests/fixtures/audit-fields.json, a mesma de private.audit_fields).

interface FixtureField {
  field: string;
  show_values: boolean;
  value_type: string;
}
const fixture: { entities: Record<string, FixtureField[]> } = JSON.parse(
  readFileSync(resolve(__dirname, "../../../supabase/tests/fixtures/audit-fields.json"), "utf8"),
);

describe("DT-06: src/lib/audit/fields.ts × audit-fields.json", () => {
  it("as mesmas entidades", () => {
    expect(Object.keys(AUDIT_FIELDS).sort()).toEqual(Object.keys(fixture.entities).sort());
  });

  it.each(Object.keys(fixture.entities))("%s: os mesmos campos, na mesma ordem, com o mesmo 'mostra valor' e tipo", (entity) => {
    if (!isAuditFieldEntity(entity)) throw new Error(`entidade desconhecida: ${entity}`);
    const screen = AUDIT_FIELDS[entity].map((f) => ({ field: f.field, show_values: f.showValues, value_type: f.valueType }));
    expect(screen).toEqual(fixture.entities[entity]);
  });

  it("todo rótulo é texto de tela, sem nome técnico", () => {
    for (const fields of Object.values(AUDIT_FIELDS)) {
      for (const info of fields) {
        expect(info.label).not.toMatch(/_/);
        expect(info.label).not.toBe(info.field);
      }
    }
  });
});

describe("RN-20 (c): valores legíveis", () => {
  const value = (entity: AuditFieldEntity, field: string, raw: unknown) => {
    const info = auditField(entity, field);
    if (!info) throw new Error(`sem o campo ${field}`);
    return formatAuditValue(entity, info, raw);
  };

  it.each<[AuditFieldEntity, string, unknown, string]>([
    ["member", "leader_id", "Pedro Alves", "Pedro Alves"],
    ["member", "leader_id", null, "(vazio)"],
    ["member", "is_active", true, "Ativo"],
    ["member", "is_active", false, "Inativo"],
    ["cell", "is_active", false, "Inativa"],
    ["cell", "is_active", true, "Ativa"],
    ["member", "is_baptized", true, "Sim"],
    ["member", "has_leadership", false, "Não"],
    ["member", "gender", "M", "Masculino"],
    ["member", "gender", "F", "Feminino"],
    // "Não houve célula" é o inverso do valor gravado (AQ-4).
    ["cell_report", "was_held", false, "Sim"],
    ["cell_report", "was_held", true, "Não"],
    ["cell_report", "date", "2026-11-25", "25/11/2026"],
    ["cell_report", "time", "20:00:00", "20:00"],
    ["cell", "meeting_time", "19:30:00", "19:30"],
    ["cell_report", "offering", 50, "R$ 50,00"],
    ["cell_report", "offering", 80.5, "R$ 80,50"],
    ["cell_report", "offering", "80", "R$ 80,00"],
    ["cell_report", "cell_id", "célula de Carla Dias", "célula de Carla Dias"],
    ["cell", "meeting_day", "Quarta", "Quarta"],
    ["cell_report", "theme", "", "(vazio)"],
    ["member", "role_id", "Secretaria", "Secretaria"],
  ])("%s.%s = %j → %s", (entity, field, raw, expected) => {
    expect(value(entity, field, raw)).toBe(expected);
  });

  it("um campo fora da lista não tem rótulo (a tela não mostra o nome técnico)", () => {
    expect(auditField("member", "auth_user_id")).toBeNull();
  });
});
