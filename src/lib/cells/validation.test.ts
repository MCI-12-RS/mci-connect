import { describe, expect, it } from "vitest";
import { cellRulesCases } from "@/test/cell-rules-cases";
import { validateCellForm, validateMeetingTimeOnBlur } from "./validation";

const complete = {
  leader_id: "andre",
  timothy_id: "caio",
  host_id: "carla",
  type: "Evangelística",
  meeting_day: "Quarta",
  meeting_time: "20:00",
};

describe("validateCellForm (E2.08, RN-02, RN-05, RN-06, RN-14)", () => {
  it("sem preencher nada: os 5 erros, na ordem da tela (UX-04)", () => {
    const errors = validateCellForm({ ...complete, leader_id: null, timothy_id: null, host_id: null, meeting_day: "", meeting_time: "" });
    expect(errors.map((e) => [e.field, e.message])).toEqual([
      ["leader_id", "Escolha o líder da célula."],
      ["timothy_id", "Escolha o timóteo da célula."],
      ["host_id", "Escolha o anfitrião da célula."],
      ["meeting_day", "Escolha o dia da semana."],
      ["meeting_time", "Informe o horário."],
    ]);
  });

  it("completa: nenhum erro, inclusive com a mesma pessoa nos três papéis (RN-03)", () => {
    expect(validateCellForm(complete)).toEqual([]);
    expect(validateCellForm({ ...complete, timothy_id: "andre", host_id: "andre", leader_id: "andre" })).toEqual([]);
  });

  it("dia e tipo fora da lista seguem os casos do banco", () => {
    for (const c of cellRulesCases.meeting_day) {
      const errors = validateCellForm({ ...complete, meeting_day: c.input ?? "" }).filter((e) => e.field === "meeting_day");
      const code = "code" in c.db ? c.db.code : null;
      expect(errors.map((e) => e.code), c.id).toEqual(code ? [code] : []);
    }
    expect(validateCellForm({ ...complete, type: "Discipuladora" }).map((e) => e.code)).toEqual(["cell_type_invalid"]);
  });

  it("horário: os casos da tabela, como a tela lê (P62)", () => {
    for (const c of cellRulesCases.meeting_time) {
      const errors = validateCellForm({ ...complete, meeting_time: c.typing }).filter((e) => e.field === "meeting_time");
      expect(errors.length === 0, c.id).toBe(c.ui_valid);
    }
  });

  it("ao sair do campo, só o formato: vazio não é erro", () => {
    expect(validateMeetingTimeOnBlur("")).toBeNull();
    expect(validateMeetingTimeOnBlur("19:60")?.message).toBe("Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.");
    expect(validateMeetingTimeOnBlur("20")).toBeNull();
  });
});
