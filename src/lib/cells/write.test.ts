import { describe, expect, it } from "vitest";
import type { CellRow } from "./fields";
import { EMPTY_CELL_FORM, cellFormFromRow, toCellInsert } from "./write";

const row: CellRow = {
  id: "c1",
  leader_id: "l1",
  timothy_id: "t1",
  host_id: "h1",
  type: "Discipulado",
  meeting_day: "Quarta",
  meeting_time: "20:00:00",
  street: "Rua das Flores",
  number: null,
  complement: null,
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  zip_code: "90010000",
  is_active: false,
  leader_name: "André Souza",
  leader_g12_level: 2,
  leader_is_pastor: false,
  leader_gender: "M",
  timothy_name: "Caio Lima",
  host_name: "Carla Dias",
  g12_leader_name: "Pedro Alves",
  can_submit_report: false,
};

describe("valores do formulário de célula (E2.08)", () => {
  it("a célula nova vem sem pessoas, sem dia e sem horário, com Evangelística e ativa (P-CEL-02, P-CEL-03, RN-11)", () => {
    expect(EMPTY_CELL_FORM).toMatchObject({
      leader_id: null,
      timothy_id: null,
      host_id: null,
      type: "Evangelística",
      meeting_day: "",
      meeting_time: "",
      is_active: true,
    });
  });

  it("cellFormFromRow: o horário sem segundos (UX-08), o CEP com máscara e a situação gravada", () => {
    const values = cellFormFromRow(row);
    expect(values.meeting_time).toBe("20:00");
    expect(values.zip_code).toBe("90010-000");
    expect(values.number).toBe("");
    expect(values.is_active).toBe(false);
    expect(values.meeting_day).toBe("Quarta");
  });

  it("toCellInsert: o id da abertura, sem is_active (RN-11), horário lido e endereço vazio como nulo (DT-09)", () => {
    const insert = toCellInsert(
      { ...EMPTY_CELL_FORM, leader_id: "l1", timothy_id: "t1", host_id: "h1", meeting_day: "Quarta", meeting_time: "20", street: "  Rua A ", city: "" },
      "attempt-1",
    );
    expect(insert).toEqual({
      id: "attempt-1",
      leader_id: "l1",
      timothy_id: "t1",
      host_id: "h1",
      type: "Evangelística",
      meeting_day: "Quarta",
      meeting_time: "20:00",
      zip_code: null,
      street: "Rua A",
      number: null,
      complement: null,
      neighborhood: null,
      city: null,
      state: null,
    });
    expect(insert).not.toHaveProperty("is_active");
  });
});
