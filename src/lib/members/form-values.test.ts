import { describe, expect, it } from "vitest";
import { ministryFieldsView } from "@/lib/access/member-form";
import type { MemberRow } from "./fields";
import {
  initialMemberFormFields,
  isMemberFormDirty,
  memberRuleValues,
  memberWriteValues,
  storedMemberValues,
  switchFields,
  switchesOf,
} from "./form-values";
import { changedMemberFields } from "./changes";
import { setBaptized, setHasLeadership, setPastor } from "./leadership";

const andre: MemberRow = {
  id: "andre",
  name: "André Lima",
  gender: "M",
  birth_date: "1990-01-02",
  instagram: null,
  avatar_url: null,
  notes: null,
  neighborhood: null,
  city: null,
  state: null,
  is_pastor: false,
  has_leadership: true,
  leader_id: "pedro",
  leader_name: "Pedro Alves",
  spouse_id: null,
  spouse_name: null,
  is_baptized: true,
  baptism_date: "2020-05-10",
  is_active: true,
  g12_level: 2,
  g12_name: null,
  total_disciples: 0,
  total_cells: 0,
  auth_user_id: "u1",
  sensitive_visible: true,
  email: "andre_ab12@mci12fakemail.com",
  cpf: "52998224725",
  mobile_whatsapp: "51988887777",
  phone: null,
  street: null,
  number: null,
  complement: null,
  zip_code: "90010100",
};

const church = ministryFieldsView({ seesWholeChurch: true, isNew: false });
const options = { sensitiveVisible: true, canEditMinistry: true, includeRole: false };

describe("initialMemberFormFields", () => {
  it("cadastro novo: Sexo sem escolha, Ativo e 'Tem Liderança?' ligados, sem líder (RN-03, RN-12)", () => {
    const fields = initialMemberFormFields(null);
    expect(fields.gender).toBe("");
    expect(fields.is_active).toBe(true);
    expect(fields.has_leadership).toBe(true);
    expect(fields.leader_id).toBeNull();
  });

  it("cadastro novo de quem vê só o ministério: o Líder já vem com quem cadastra (E2.02)", () => {
    const fields = initialMemberFormFields(null, { prefilledLeader: { id: "pedro", name: "Pedro Alves" } });
    expect(fields.leader_id).toBe("pedro");
    expect(fields.leader_name).toBe("Pedro Alves");
  });

  it("edição: celular e CPF na máscara, sem o e-mail fictício, CEP na máscara (P23, UX-24)", () => {
    const fields = initialMemberFormFields(andre);
    expect(fields.mobile_whatsapp).toBe("(51) 98888-7777");
    expect(fields.cpf).toBe("529.982.247-25");
    expect(fields.email).toBe("");
    expect(fields.zip_code).toBe("90010-100");
  });

  it("edição: o celular ilegível aparece como está (T6)", () => {
    expect(initialMemberFormFields({ ...andre, mobile_whatsapp: "98887777" }).mobile_whatsapp).toBe("98887777");
  });

  it("'Definir líder': 'Tem Liderança?' ligado", () => {
    const fields = initialMemberFormFields({ ...andre, has_leadership: false, leader_id: null }, { defineLeader: true });
    expect(fields.has_leadership).toBe(true);
  });
});

describe("switchesOf e switchFields", () => {
  it("vão e voltam sem perder nada", () => {
    const fields = initialMemberFormFields(andre);
    expect(switchFields(switchesOf(fields))).toEqual({
      is_pastor: false,
      has_leadership: true,
      leader_id: "pedro",
      leader_name: "Pedro Alves",
      is_baptized: true,
      baptism_date: "2020-05-10",
      ministry_memory: { leader: null, hasLeadershipBeforePastor: null, baptismDate: null },
    });
  });
});

describe("memberWriteValues", () => {
  it("com 'É Pastor(a)?' ligado, o líder vai vazio (P20)", () => {
    const fields = initialMemberFormFields(andre);
    const pastor = { ...fields, ...switchFields(setPastor(switchesOf(fields), true)) };
    expect(memberWriteValues(pastor, church, null)).toMatchObject({ is_pastor: true, has_leadership: false, leader_id: null });
  });

  it("com 'Tem Liderança?' desligado e 'Batizado(a)?' desligado, o líder e a data vão vazios (P20, RN-16)", () => {
    const fields = initialMemberFormFields(andre);
    let switches = setHasLeadership(switchesOf(fields), false);
    switches = setBaptized(switches, false);
    const values = memberWriteValues({ ...fields, ...switchFields(switches) }, church, null);
    expect(values).toMatchObject({ has_leadership: false, leader_id: null, is_baptized: false, baptism_date: null });
  });

  it("quem vê só o ministério: a marca segue o líder escolhido (PO-UX-7 do E2.02)", () => {
    const view = ministryFieldsView({ seesWholeChurch: false, isNew: false, saved: { is_pastor: false, leader_id: null } });
    const fields = { ...initialMemberFormFields({ ...andre, has_leadership: false, leader_id: null }), leader_id: "pedro" };
    expect(memberWriteValues(fields, view, null)).toMatchObject({ has_leadership: true, leader_id: "pedro" });
  });
});

describe("edição sem mudança (DT-19, DA-9)", () => {
  it("abrir e salvar não muda nada, nem o celular com máscara nem o e-mail fictício escondido", () => {
    const fields = initialMemberFormFields(andre);
    const patch = changedMemberFields(storedMemberValues(andre, null), memberWriteValues(fields, church, null), options);
    expect(patch).toEqual({});
  });

  it("só o que mudou vai no PATCH", () => {
    const fields = { ...initialMemberFormFields(andre), notes: "Nova" };
    const patch = changedMemberFields(storedMemberValues(andre, null), memberWriteValues(fields, church, null), options);
    expect(patch).toEqual({ notes: "Nova" });
  });
});

describe("memberRuleValues", () => {
  it("lê os textos e os interruptores", () => {
    const values = memberRuleValues(memberWriteValues(initialMemberFormFields(andre), church, null));
    expect(values).toMatchObject({ name: "André Lima", gender: "M", is_pastor: false, leader_id: "pedro", email: "" });
  });
});

describe("isMemberFormDirty (UX-26)", () => {
  it("digitar e voltar ao valor de abertura não conta; mudar conta; a senha conta", () => {
    const initial = initialMemberFormFields(andre);
    expect(isMemberFormDirty(initial, { ...initial, name: " André  Lima " }, church, options)).toBe(false);
    expect(isMemberFormDirty(initial, { ...initial, name: "André Souza" }, church, options)).toBe(true);
    expect(isMemberFormDirty(initial, { ...initial, password: "x" }, church, options)).toBe(true);
  });

  it("ligar e desligar um interruptor sem salvar não conta", () => {
    const initial = initialMemberFormFields(andre);
    const back = switchFields(setPastor(setPastor(switchesOf(initial), true), false));
    expect(isMemberFormDirty(initial, { ...initial, ...back }, church, options)).toBe(false);
  });
});
