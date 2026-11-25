import { describe, expect, it } from "vitest";
import { valueInUseFromUniqueViolation } from "./codes";

const uniqueViolation = (index: string) => ({
  code: "23505",
  message: `duplicate key value violates unique constraint "${index}"`,
  details: "Key (cpf)=(52998224725) already exists.",
  hint: null,
});

describe("valueInUseFromUniqueViolation (E2.04, reserva do 23505)", () => {
  it.each([
    ["members_email_key", "email", "Este e-mail já está sendo usado por outro cadastro."],
    ["members_mobile_key", "mobile", "Este celular já está sendo usado por outro cadastro."],
    ["members_cpf_key", "cpf", "Este CPF já está sendo usado por outro cadastro."],
  ])("%s vira value_in_use em %s, sem o texto técnico", (index, field, message) => {
    expect(valueInUseFromUniqueViolation(uniqueViolation(index))).toEqual({
      code: "value_in_use",
      message,
      detail: { code: "value_in_use", fields: [field] },
    });
  });

  it("outro índice, outro SQLSTATE ou outro formato: null", () => {
    expect(valueInUseFromUniqueViolation(uniqueViolation("cells_pkey"))).toBeNull();
    expect(valueInUseFromUniqueViolation({ code: "23514", message: 'violates check constraint "members_cpf_key"' })).toBeNull();
    expect(valueInUseFromUniqueViolation(new Error("members_cpf_key"))).toBeNull();
    expect(valueInUseFromUniqueViolation(null)).toBeNull();
  });
});
