import { describe, expect, it } from "vitest";
import {
  isMemberRuleCode,
  memberRefusalFields,
  memberRefusalFromCheckViolation,
  memberRefusalMessages,
  valueInUseFromUniqueViolation,
} from "./codes";

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

describe("memberRefusalFields e memberRefusalMessages (AQ-1)", () => {
  const appError = (code: string, message: string, detail: Record<string, unknown>) => ({ code, message, detail: { code, ...detail } });

  it("value_in_use cita todos os campos, cada um com a sua mensagem, na ordem da tela", () => {
    const error = appError("value_in_use", "Este e-mail já está sendo usado por outro cadastro.", { fields: ["email", "cpf", "mobile"] });
    expect(memberRefusalFields(error)).toEqual(["mobile_whatsapp", "email", "cpf"]);
    expect(memberRefusalMessages(error)).toEqual({
      mobile_whatsapp: "Este celular já está sendo usado por outro cadastro.",
      email: "Este e-mail já está sendo usado por outro cadastro.",
      cpf: "Este CPF já está sendo usado por outro cadastro.",
    });
  });

  it.each([
    ["identifier_required", "identification", "identification"],
    ["mobile_invalid", "mobile_whatsapp", "mobile_whatsapp"],
    ["leader_cycle", "leader_id", "leader_id"],
    ["pastor_with_leader", "is_pastor", "is_pastor"],
    ["deleted_account_email", "email", "email"],
  ])("%s com field %s aparece em %s", (code, field, screenField) => {
    const error = appError(code, "Mensagem do banco.", { field });
    expect(memberRefusalFields(error)).toEqual([screenField]);
    expect(memberRefusalMessages(error)).toEqual({ [screenField]: "Mensagem do banco." });
  });

  it("sem campo conhecido, nenhum: a recusa vai para o topo", () => {
    expect(memberRefusalFields(appError("attempt_already_used", "x", {}))).toEqual([]);
    expect(memberRefusalFields(appError("person_not_visible", "x", { field: "timothy_id" }))).toEqual([]);
  });

  it("isMemberRuleCode reconhece só os códigos do E2.04", () => {
    expect(isMemberRuleCode("leader_cycle")).toBe(true);
    expect(isMemberRuleCode("person_not_visible")).toBe(false);
  });
});

describe("memberRefusalFromCheckViolation (reserva do 23514)", () => {
  const checkViolation = (constraint: string) => ({
    code: "23514",
    message: `new row for relation "members" violates check constraint "${constraint}"`,
    details: "Failing row contains (...)",
    hint: null,
  });

  it.each([
    ["members_email_check", "email_invalid", "email", "E-mail inválido. Confira o endereço digitado."],
    ["members_email_not_placeholder_check", "email_placeholder", "email", "Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco."],
    ["members_cpf_check", "cpf_invalid", "cpf", "CPF inválido. Se a pessoa não tem CPF, deixe o campo em branco."],
    ["members_leadership_check", "leader_required", "leader_id", "Escolha o líder."],
    ["members_leader_not_self_check", "leader_self", "leader_id", "Uma pessoa não pode ser líder de si mesma."],
    ["members_spouse_not_self_check", "spouse_self", "spouse_id", "Uma pessoa não pode ser cônjuge de si mesma."],
    ["members_baptism_check", "baptism_date_without_baptism", "baptism_date", "A data do batismo só pode ser informada para quem é batizado(a)."],
  ])("%s vira %s em %s, sem o texto técnico", (constraint, code, field, message) => {
    expect(memberRefusalFromCheckViolation(checkViolation(constraint))).toEqual({ code, message, detail: { code, field } });
  });

  it("outro CHECK, outro SQLSTATE ou outro formato: null", () => {
    expect(memberRefusalFromCheckViolation(checkViolation("cells_type_check"))).toBeNull();
    expect(memberRefusalFromCheckViolation({ code: "23505", message: 'violates "members_cpf_check"' })).toBeNull();
    expect(memberRefusalFromCheckViolation(null)).toBeNull();
  });
});
