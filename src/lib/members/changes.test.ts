// E2.04 (RN-17, DT-05, DT-19, DA-9, UX-21, UX-22): o PATCH leva só o que
// mudou, lido pela regra de cada campo.
import { describe, expect, it } from "vitest";
import { changedMemberFields, hasMemberChanges, memberFieldChanged, readByRule } from "./changes";
import type { MemberFormValues, MemberWriteOptions } from "./fields";

const ALL: MemberWriteOptions = { sensitiveVisible: true, canEditMinistry: true, includeRole: false };

const stored: MemberFormValues = {
  name: "Fábio",
  gender: "M",
  birth_date: "1920-03-10",
  mobile_whatsapp: "98887777",
  email: "fabio@exemplo.com",
  cpf: "52998224725",
  phone: null,
  notes: null,
  city: "Porto Alegre",
  is_pastor: false,
  has_leadership: true,
  leader_id: "l1",
  spouse_id: null,
  is_baptized: true,
  baptism_date: "2020-05-10",
  is_active: true,
};

describe("readByRule e memberFieldChanged (DT-05)", () => {
  it.each([
    ["name", "  Ana   Souza ", "Ana Souza"],
    ["email", " ANA@Exemplo.com ", "ana@exemplo.com"],
    ["mobile_whatsapp", "+55 (51) 98888-7777", "51988887777"],
    ["mobile_whatsapp", "9888-7777", "98887777"],
    ["cpf", "529.982.247-25", "52998224725"],
    ["phone", "(51) 3333-4444", "5133334444"],
    ["city", "  Canoas ", "Canoas"],
    ["notes", "   ", null],
  ] as const)("%s: %j → %j", (field, value, expected) => {
    expect(readByRule(field, value)).toBe(expected);
  });

  it("vazio e nulo dizem o mesmo (DT-24)", () => {
    expect(memberFieldChanged("notes", null, "")).toBe(false);
    expect(memberFieldChanged("email", "", null)).toBe(false);
  });
});

describe("changedMemberFields (DT-19)", () => {
  it("DA-9: abrir e salvar sem mexer não manda nada, mesmo com valores antigos fora da regra (UX-21)", () => {
    const values: MemberFormValues = {
      ...stored,
      mobile_whatsapp: "98887777",
      cpf: "529.982.247-25",
      email: "Fabio@Exemplo.com ",
      name: " Fábio ",
    };
    const patch = changedMemberFields(stored, values, ALL);
    expect(patch).toEqual({});
    expect(hasMemberChanges(patch)).toBe(false);
  });

  it("UX-22: o celular gravado mostrado com a máscara não conta como alterado", () => {
    const caio = { ...stored, mobile_whatsapp: "51988887777" };
    expect(changedMemberFields(caio, { ...caio, mobile_whatsapp: "(51) 98888-7777" }, ALL)).toEqual({});
  });

  it("leva só o que mudou, já limpo como no toMemberWritePayload", () => {
    const patch = changedMemberFields(stored, { ...stored, notes: " Nova observação ", mobile_whatsapp: "(51) 98887-7770" }, ALL);
    expect(patch).toEqual({ notes: "Nova observação", mobile_whatsapp: "51988877770" });
    expect(hasMemberChanges(patch)).toBe(true);
  });

  it("apagar um campo manda nulo", () => {
    expect(changedMemberFields(stored, { ...stored, email: "" }, ALL)).toEqual({ email: null });
  });

  it("os interruptores mandam o que mudou junto (pastor sem líder)", () => {
    const patch = changedMemberFields(stored, { ...stored, is_pastor: true, has_leadership: false, leader_id: null }, ALL);
    expect(patch).toEqual({ is_pastor: true, has_leadership: false, leader_id: null });
  });

  it("respeita a lista branca: sem os dados sensíveis nem os ministeriais, eles não vão", () => {
    const values = { ...stored, email: "outro@exemplo.com", leader_id: "l2", name: "Fábio Lima" };
    expect(changedMemberFields(stored, values, { sensitiveVisible: false, canEditMinistry: false, includeRole: false })).toEqual({
      name: "Fábio Lima",
    });
  });
});
