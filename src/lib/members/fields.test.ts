import { describe, it, expect } from "vitest";
import { MINISTRY_MEMBER_FIELDS, SENSITIVE_MEMBER_FIELDS, toMemberWritePayload } from "./fields";

const form = {
  name: " Maria Souza ",
  gender: "F",
  birth_date: "",
  notes: "",
  neighborhood: "Centro",
  city: "Porto Alegre",
  state: "RS",
  email: "maria@mci.org",
  cpf: "123.456.789-09",
  mobile_whatsapp: "(51)99999-0000",
  phone: "",
  street: "Rua A",
  number: "10",
  complement: "",
  zip_code: "90000-000",
  is_pastor: false,
  has_leadership: true,
  leader_id: "leader-1",
  spouse_id: null,
  is_baptized: true,
  baptism_date: "",
  is_active: true,
  role_id: "role-1",
};

describe("toMemberWritePayload (RN-12)", () => {
  it("sem acesso aos dados sensíveis, não envia nenhum deles", () => {
    const payload = toMemberWritePayload(form, { sensitiveVisible: false, canEditMinistry: true, includeRole: false });
    for (const field of SENSITIVE_MEMBER_FIELDS) expect(payload).not.toHaveProperty(field);
    expect(payload.neighborhood).toBe("Centro");
    expect(payload.city).toBe("Porto Alegre");
  });

  it("sem edit_member, não envia os dados ministeriais", () => {
    const payload = toMemberWritePayload(form, { sensitiveVisible: true, canEditMinistry: false, includeRole: false });
    for (const field of MINISTRY_MEMBER_FIELDS) expect(payload).not.toHaveProperty(field);
    expect(payload.cpf).toBe("12345678909");
  });

  it("envia a função só quando pedido", () => {
    expect(toMemberWritePayload(form, { sensitiveVisible: true, canEditMinistry: true, includeRole: false })).not.toHaveProperty("role_id");
    expect(toMemberWritePayload(form, { sensitiveVisible: true, canEditMinistry: true, includeRole: true }).role_id).toBe("role-1");
  });

  it("converte texto vazio em null, apara espaços e deixa só dígitos em CPF, telefones e CEP", () => {
    const payload = toMemberWritePayload(form, { sensitiveVisible: true, canEditMinistry: true, includeRole: true });
    expect(payload.name).toBe("Maria Souza");
    expect(payload.birth_date).toBeNull();
    expect(payload.baptism_date).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.phone).toBeNull();
    expect(payload.mobile_whatsapp).toBe("51999990000");
    expect(payload.zip_code).toBe("90000000");
    expect(payload.is_pastor).toBe(false);
    expect(payload.spouse_id).toBeNull();
  });

  it("não envia colunas fora da lista branca nem campos indefinidos", () => {
    const payload = toMemberWritePayload(
      { ...form, email: undefined, total_cells: 99, auth_user_id: "x", sensitive_visible: true, leader_name: "y" } as typeof form,
      { sensitiveVisible: true, canEditMinistry: true, includeRole: true },
    );
    expect(payload).not.toHaveProperty("email");
    expect(payload).not.toHaveProperty("total_cells");
    expect(payload).not.toHaveProperty("auth_user_id");
    expect(payload).not.toHaveProperty("sensitive_visible");
    expect(payload).not.toHaveProperty("leader_name");
  });
});

describe("SENSITIVE_MEMBER_FIELDS (RN-11)", () => {
  it("são as 8 colunas que o banco mascara na members_view, preserva na regra 6 e trava na tabela (E1.08, PR 5)", () => {
    // Mesma lista do pgTAP e108_pr5_members_column_lock.test.sql, que amarra as três listas do banco.
    expect([...SENSITIVE_MEMBER_FIELDS].sort()).toEqual([
      "complement",
      "cpf",
      "email",
      "mobile_whatsapp",
      "number",
      "phone",
      "street",
      "zip_code",
    ]);
  });
});
