import { describe, expect, it } from "vitest";
import { changedCellFields, isCellFormDirty } from "./changes";
import { EMPTY_CELL_FORM, type CellFormValues } from "./write";

const stored: CellFormValues = {
  ...EMPTY_CELL_FORM,
  leader_id: "andre",
  timothy_id: "caio",
  host_id: "carla",
  meeting_day: "Quarta",
  meeting_time: "20:00",
  street: "Rua das Flores",
  number: "100",
  zip_code: "90010-000",
  is_active: true,
};

describe("changedCellFields (E2.08, T6; E2.05)", () => {
  it("sem mudança, nada vai ao servidor", () => {
    expect(changedCellFields(stored, { ...stored })).toEqual({});
    expect(isCellFormDirty(stored, { ...stored })).toBe(false);
  });

  it("o horário '20' (lido como 20:00) não é alteração; o CEP é comparado pelos dígitos", () => {
    expect(changedCellFields(stored, { ...stored, meeting_time: "20", zip_code: "90010000" })).toEqual({});
  });

  it("só o horário: o PATCH leva só o horário (AQ-9: o anfitrião fora do escopo continua)", () => {
    expect(changedCellFields(stored, { ...stored, meeting_time: "19:30" })).toEqual({ meeting_time: "19:30" });
  });

  it("endereço aparado; vazio vai como nulo; o desfeito à mão até ficar igual não conta", () => {
    expect(changedCellFields(stored, { ...stored, number: "" })).toEqual({ number: null });
    expect(changedCellFields(stored, { ...stored, street: " Rua das Flores " })).toEqual({});
  });

  it("trocar o anfitrião e inativar", () => {
    expect(changedCellFields(stored, { ...stored, host_id: "fabio", is_active: false })).toEqual({ host_id: "fabio", is_active: false });
  });
});
