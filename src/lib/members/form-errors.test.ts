import { describe, expect, it } from "vitest";
import {
  errorFieldsOfChange,
  firstErrorField,
  isMemberFormFieldShown,
  refusalFieldsShown,
  reconcileShownErrors,
  shownErrorCount,
  type MemberFormFieldError,
} from "./form-errors";

const nameError: MemberFormFieldError = { field: "name", code: "name_invalid", message: "Informe o nome e o sobrenome." };

describe("errorFieldsOfChange", () => {
  it("Celular, E-mail e CPF também mexem no grupo Identificação", () => {
    expect(errorFieldsOfChange("email")).toEqual(["email", "identification"]);
    expect(errorFieldsOfChange("mobile_whatsapp")).toEqual(["mobile_whatsapp", "identification"]);
  });

  it("interruptores: o pastor e o Líder; batismo: a data", () => {
    expect(errorFieldsOfChange("has_leadership")).toEqual(["is_pastor", "leader_id"]);
    expect(errorFieldsOfChange("is_baptized")).toEqual(["baptism_date"]);
  });

  it("campos sem erro próprio não tiram nada", () => {
    expect(errorFieldsOfChange("notes")).toEqual([]);
    expect(errorFieldsOfChange("ministry_memory")).toEqual([]);
    expect(errorFieldsOfChange("role_id")).toEqual(["role_id"]);
  });
});

describe("reconcileShownErrors (P22, UX-09)", () => {
  it("o erro da tela some quando a conferência não o acusa mais", () => {
    const current = { name: { message: nameError.message, server: false } };
    expect(reconcileShownErrors(current, [], ["name"])).toEqual({});
    expect(reconcileShownErrors(current, [nameError], ["name"])).toEqual(current);
  });

  it("nenhum erro novo aparece enquanto a pessoa digita", () => {
    const cpf: MemberFormFieldError = { field: "cpf", code: "cpf_invalid", message: "CPF inválido." };
    expect(reconcileShownErrors({}, [nameError, cpf], ["cpf"])).toEqual({});
  });

  it("o texto do erro acompanha a conferência atual", () => {
    const current = { birth_date: { message: "futura", server: false } };
    const fresh: MemberFormFieldError[] = [{ field: "birth_date", code: "birth_date_too_old", message: "100 anos" }];
    expect(reconcileShownErrors(current, fresh, ["birth_date"])).toEqual({ birth_date: { message: "100 anos", server: false } });
  });

  it("a recusa do servidor sai só quando o campo dela muda", () => {
    const current = {
      email: { message: "Este e-mail já está sendo usado por outro cadastro.", server: true },
      cpf: { message: "Este CPF já está sendo usado por outro cadastro.", server: true },
    };
    expect(reconcileShownErrors(current, [], errorFieldsOfChange("email"))).toEqual({ cpf: current.cpf });
  });
});

describe("resumo e foco", () => {
  it("conta os campos com erro e acha o primeiro na ordem da tela", () => {
    const errors = {
      role_id: { message: "r", server: false },
      cpf: { message: "c", server: true },
      gender: { message: "g", server: false },
    };
    expect(shownErrorCount(errors)).toBe(3);
    expect(firstErrorField(errors)).toBe("gender");
    expect(firstErrorField({})).toBeNull();
  });
});

describe("isMemberFormFieldShown (T5)", () => {
  const all = {
    sensitiveVisible: true,
    canEditMinistry: true,
    pastorSwitch: true,
    leaderShown: true,
    baptismDateShown: true,
    roleSelect: true,
  };

  it("sem os dados sensíveis, a Identificação não está na tela", () => {
    const hidden = { ...all, sensitiveVisible: false };
    expect(isMemberFormFieldShown("email", hidden)).toBe(false);
    expect(isMemberFormFieldShown("identification", hidden)).toBe(false);
    expect(isMemberFormFieldShown("name", hidden)).toBe(true);
  });

  it("sem 'Editar Membro', os dados ministeriais não estão na tela", () => {
    const hidden = { ...all, canEditMinistry: false };
    expect(isMemberFormFieldShown("leader_id", hidden)).toBe(false);
    expect(isMemberFormFieldShown("spouse_id", hidden)).toBe(false);
  });

  it("o Líder escondido, o pastor como texto e a Função como texto não recebem a recusa", () => {
    expect(isMemberFormFieldShown("leader_id", { ...all, leaderShown: false })).toBe(false);
    expect(isMemberFormFieldShown("is_pastor", { ...all, pastorSwitch: false })).toBe(false);
    expect(isMemberFormFieldShown("role_id", { ...all, roleSelect: false })).toBe(false);
    expect(isMemberFormFieldShown("baptism_date", { ...all, baptismDateShown: false })).toBe(false);
  });
});

describe("refusalFieldsShown (T5)", () => {
  it("só os campos à vista recebem a recusa", () => {
    const visibility = {
      sensitiveVisible: true,
      canEditMinistry: true,
      pastorSwitch: false,
      leaderShown: false,
      baptismDateShown: false,
      roleSelect: false,
    };
    expect(refusalFieldsShown({ email: "e", leader_id: "l" }, visibility)).toEqual({ email: "e" });
    expect(refusalFieldsShown({ leader_id: "l" }, visibility)).toEqual({});
  });
});
