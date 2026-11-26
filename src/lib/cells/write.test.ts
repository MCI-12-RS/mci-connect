import { describe, expect, it } from "vitest";
import type { CellRow } from "./fields";
import { buildCellWrite, cellFormFromRow, EMPTY_CELL_FORM, type CellFormValues } from "./write";

const complete: CellFormValues = {
  ...EMPTY_CELL_FORM,
  leader_id: "andre",
  timothy_id: "caio",
  host_id: "carla",
  meeting_day: "Quarta",
  meeting_time: "20:00",
  street: "Rua das Flores",
};

describe("buildCellWrite (E2.08, PR 2: ajuste mínimo)", () => {
  it("a célula nova vem sem pessoas, sem dia e sem horário, com Evangelística e ativa (P-CEL-02, P-CEL-03, RN-11)", () => {
    expect(EMPTY_CELL_FORM).toMatchObject({
      leader_id: null,
      timothy_id: null,
      host_id: null,
      meeting_day: null,
      meeting_time: null,
      type: "Evangelística",
      is_active: true,
    });
  });

  it.each([
    [{ leader_id: null }, "leader_id", "Escolha o líder da célula."],
    [{ timothy_id: null }, "timothy_id", "Escolha o timóteo da célula."],
    [{ host_id: "" }, "host_id", "Escolha o anfitrião da célula."],
    [{ meeting_day: null }, "meeting_day", "Escolha o dia da semana."],
    [{ meeting_time: "" }, "meeting_time", "Informe o horário."],
    [{ meeting_time: "  " }, "meeting_time", "Informe o horário."],
  ] as const)("sem %j, nada é enviado e o campo é %s", (missing, field, message) => {
    expect(buildCellWrite({ ...complete, ...missing })).toEqual({ ok: false, field, message });
  });

  it("o primeiro que falta, na ordem da tela (RN-14): só o líder preenchido → o timóteo", () => {
    const result = buildCellWrite({ ...EMPTY_CELL_FORM, leader_id: "andre" });
    expect(result).toEqual({ ok: false, field: "timothy_id", message: "Escolha o timóteo da célula." });
  });

  it("completa, monta a gravação sem is_active (a célula nova sempre começa ativa)", () => {
    const result = buildCellWrite({ ...complete, is_active: false });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload).toMatchObject({
      leader_id: "andre",
      timothy_id: "caio",
      host_id: "carla",
      type: "Evangelística",
      meeting_day: "Quarta",
      meeting_time: "20:00",
      street: "Rua das Flores",
    });
    expect(result.payload).not.toHaveProperty("is_active");
  });
});

describe("cellFormFromRow", () => {
  it("lê a linha gravada sem inventar valores", () => {
    const row: CellRow = {
      id: "c1",
      leader_id: "andre",
      timothy_id: null,
      host_id: "carla",
      type: "Discipulado",
      meeting_day: "Quarta",
      meeting_time: "20:00:00",
      street: null,
      number: "10",
      complement: null,
      neighborhood: null,
      city: null,
      state: null,
      zip_code: null,
      is_active: false,
      leader_name: "André",
      leader_g12_level: 2,
      leader_is_pastor: false,
      leader_gender: "M",
      timothy_name: null,
      host_name: "Carla",
      g12_leader_name: "Pedro",
      can_submit_report: false,
    };
    expect(cellFormFromRow(row)).toEqual({
      leader_id: "andre",
      timothy_id: null,
      host_id: "carla",
      type: "Discipulado",
      meeting_day: "Quarta",
      meeting_time: "20:00:00",
      street: "",
      number: "10",
      complement: "",
      neighborhood: "",
      city: "",
      state: "",
      zip_code: "",
      is_active: false,
    });
  });
});
