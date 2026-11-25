// E2.04 (RN-02 a RN-08, RN-11 a RN-17, RN-19; P-VAL-19, P24, UX-09, UX-11,
// UX-15, UX-20 a UX-22): a conferência da tela adianta as regras do banco.
import { describe, expect, it } from "vitest";
import {
  effectiveHasLeadership,
  legacyWarnings,
  validateMemberForm,
  validateOnBlur,
  visibleLegacyWarnings,
  type MemberRuleValues,
  type MemberValidationContext,
} from "./validation";
import { MEMBER_LEGACY_TEXTS, MEMBER_RULE_TEXTS } from "./texts";

const TODAY = "2026-11-23";

const newContext = (overrides: Partial<MemberValidationContext> = {}): MemberValidationContext => ({
  stored: null,
  memberId: null,
  today: TODAY,
  sensitiveVisible: true,
  canEditMinistry: true,
  seesWholeChurch: true,
  ...overrides,
});

const LEADER = "11111111-1111-4111-8111-111111111111";
const SELF = "22222222-2222-4222-8222-222222222222";

const valid: MemberRuleValues = {
  name: "Lúcia Souza",
  gender: "F",
  birth_date: "1992-02-14",
  mobile_whatsapp: "(51) 98888-1234",
  email: "",
  cpf: "",
  is_pastor: false,
  has_leadership: true,
  leader_id: LEADER,
  is_baptized: false,
  baptism_date: "",
};

const codes = (values: MemberRuleValues, context = newContext()) => validateMemberForm(values, context).map((e) => e.code);

/** Fábio, da massa de exemplo (T6): nome de uma palavra, celular sem DDD e nascimento fora do intervalo. */
const fabio: MemberRuleValues = {
  name: "Fábio",
  gender: "M",
  birth_date: "1920-03-10",
  mobile_whatsapp: "98887777",
  email: null,
  cpf: null,
  is_pastor: false,
  has_leadership: true,
  leader_id: LEADER,
  is_baptized: false,
  baptism_date: null,
};
const editContext = (stored: MemberRuleValues, overrides: Partial<MemberValidationContext> = {}) =>
  newContext({ stored, memberId: SELF, ...overrides });

describe("validateMemberForm: cadastro novo", () => {
  it("um cadastro completo não tem erros", () => {
    expect(validateMemberForm(valid, newContext())).toEqual([]);
  });

  it("RN-19: todos os erros de uma vez, na ordem da tela, com as mensagens do Negócio", () => {
    const errors = validateMemberForm(
      { ...valid, name: "Lúcia", gender: null, birth_date: "2026-11-24", mobile_whatsapp: "", leader_id: null },
      newContext(),
    );
    expect(errors).toEqual([
      { field: "name", code: "name_invalid", message: MEMBER_RULE_TEXTS.nameInvalid },
      { field: "gender", code: "gender_required", message: MEMBER_RULE_TEXTS.genderRequired },
      { field: "birth_date", code: "birth_date_future", message: MEMBER_RULE_TEXTS.birthDateFuture },
      { field: "identification", code: "identifier_required", message: MEMBER_RULE_TEXTS.identifierRequired },
      { field: "leader_id", code: "leader_required", message: MEMBER_RULE_TEXTS.leaderRequiredWholeChurch },
    ]);
  });

  it("RN-03: só M ou F", () => {
    expect(codes({ ...valid, gender: "Feminino" })).toEqual(["gender_required"]);
  });

  it("RN-15 (UX-20): 23/11/1926 é recusada e 24/11/1926 é aceita", () => {
    expect(codes({ ...valid, birth_date: "1926-11-23" })).toEqual(["birth_date_too_old"]);
    expect(codes({ ...valid, birth_date: "1926-11-24" })).toEqual([]);
    expect(codes({ ...valid, birth_date: "" })).toEqual([]);
  });

  it.each([
    ["mobile_whatsapp", "98888-1234", "mobile_invalid"],
    ["mobile_whatsapp", "abc", "mobile_invalid"],
    ["email", "lucia@mci12fakemail.com", "email_placeholder"],
    ["email", "ana@exemplo", "email_invalid"],
    ["cpf", "111.111.111-11", "cpf_invalid"],
    ["cpf", "1144477735", "cpf_invalid"],
  ] as const)("RN-04 a RN-07: %s = %s → %s", (field, value, code) => {
    expect(codes({ ...valid, mobile_whatsapp: "", email: "", cpf: "", [field]: value })).toEqual([code]);
  });

  it("RN-08 (UX-11): qualquer identificador real basta", () => {
    const none = { ...valid, mobile_whatsapp: "", email: "", cpf: "" };
    expect(codes(none)).toEqual(["identifier_required"]);
    expect(codes({ ...none, email: "ana@exemplo.com" })).toEqual([]);
    expect(codes({ ...none, cpf: "529.982.247-25" })).toEqual([]);
  });

  it("RN-08: com um formato errado no grupo, só o erro do campo aparece", () => {
    expect(codes({ ...valid, mobile_whatsapp: "98888-1234", email: "", cpf: "" })).toEqual(["mobile_invalid"]);
  });

  it("sem os dados sensíveis à vista, o grupo Identificação não é conferido", () => {
    expect(codes({ ...valid, mobile_whatsapp: "x" }, newContext({ sensitiveVisible: false }))).toEqual([]);
  });

  it("DA-2 (UX-15): o texto do líder depende de quem cadastra", () => {
    const withoutLeader = { ...valid, leader_id: null };
    expect(validateMemberForm(withoutLeader, newContext())[0].message).toBe(MEMBER_RULE_TEXTS.leaderRequiredWholeChurch);
    expect(validateMemberForm(withoutLeader, newContext({ seesWholeChurch: false }))[0].message).toBe(
      MEMBER_RULE_TEXTS.leaderRequired,
    );
  });

  it("RN-12: \"Tem Liderança?\" desligado de propósito, ou pastor, dispensa o líder", () => {
    expect(codes({ ...valid, leader_id: null, has_leadership: false })).toEqual([]);
    expect(codes({ ...valid, leader_id: null, has_leadership: false, is_pastor: true })).toEqual([]);
  });

  it("RN-12 e DT-06: \"Tem Liderança?\" omitido no cadastro novo conta como ligado (pastor, desligado)", () => {
    expect(codes({ ...valid, leader_id: null, has_leadership: null })).toEqual(["leader_required"]);
    expect(codes({ ...valid, leader_id: null, has_leadership: null, is_pastor: true })).toEqual([]);
  });

  it("quem vê só o ministério tem o Líder sempre obrigatório (E2.02)", () => {
    const ctx = newContext({ seesWholeChurch: false, leaderAlwaysRequired: true });
    const errors = validateMemberForm({ ...valid, leader_id: null, has_leadership: false }, ctx);
    expect(errors).toEqual([{ field: "leader_id", code: "leader_required", message: MEMBER_RULE_TEXTS.leaderRequired }]);
  });

  it("RN-11: pastor com líder é recusado", () => {
    expect(codes({ ...valid, is_pastor: true, has_leadership: false })).toEqual(["pastor_with_leader"]);
  });

  it("RN-16: data do batismo sem \"Batizado(a)?\" é recusada", () => {
    expect(codes({ ...valid, baptism_date: "2020-05-10" })).toEqual(["baptism_date_without_baptism"]);
    expect(codes({ ...valid, is_baptized: true, baptism_date: "2020-05-10" })).toEqual([]);
  });

  it("sem \"Editar Membro\", os dados ministeriais não são conferidos", () => {
    expect(codes({ ...valid, leader_id: null }, newContext({ canEditMinistry: false }))).toEqual([]);
  });
});

describe("validateMemberForm: edição (RN-17)", () => {
  it("UX-21: Fábio salvo sem mexer nos campos antigos não tem erros", () => {
    expect(validateMemberForm(fabio, editContext(fabio))).toEqual([]);
  });

  it("o celular gravado com a máscara da tela não conta como alterado (UX-22)", () => {
    const caio = { ...valid, mobile_whatsapp: "51988887777" };
    expect(validateMemberForm({ ...caio, mobile_whatsapp: "(51) 98888-7777" }, editContext(caio))).toEqual([]);
  });

  it("o campo alterado passa a seguir a regra (UX-22)", () => {
    expect(codes({ ...fabio, mobile_whatsapp: "9888-7770" }, editContext(fabio))).toEqual(["mobile_invalid"]);
    expect(codes({ ...fabio, mobile_whatsapp: "(51) 98887-7770" }, editContext(fabio))).toEqual([]);
    expect(codes({ ...fabio, name: "Fábio Lima" }, editContext(fabio))).toEqual([]);
    expect(codes({ ...fabio, name: "Fabio" }, editContext(fabio))).toEqual(["name_invalid"]);
    expect(codes({ ...fabio, birth_date: "1920-03-11" }, editContext(fabio))).toEqual(["birth_date_too_old"]);
  });

  it("RN-08 (UX-11): tirar o último identificador é recusado; o cadastro que já não tinha continua editável", () => {
    const caio = { ...valid, email: "caio@exemplo.com", mobile_whatsapp: "51988887777" };
    expect(codes({ ...caio, email: "" }, editContext(caio))).toEqual([]);
    const onlyMobile = { ...caio, email: null };
    expect(codes({ ...onlyMobile, mobile_whatsapp: "" }, editContext(onlyMobile))).toEqual(["identifier_required"]);
    const none = { ...fabio, mobile_whatsapp: null };
    expect(codes({ ...none, name: "Fábio Lima" }, editContext(none))).toEqual([]);
  });

  it("RN-13 e RN-14: líder e cônjuge de si mesmo", () => {
    expect(codes({ ...valid, leader_id: SELF }, editContext(valid))).toEqual(["leader_self"]);
    expect(codes({ ...valid, spouse_id: SELF }, editContext(valid))).toEqual(["spouse_self"]);
  });

  it("líder, pastor e chave sem mudança não são conferidos de novo", () => {
    const withoutLeadership = { ...valid, has_leadership: false, leader_id: null };
    expect(codes(withoutLeadership, editContext(withoutLeadership))).toEqual([]);
  });

  it("P-VAL-22: desmarcar pastor sem mandar a chave nem o líder deixa a pessoa sem liderança", () => {
    const samuel = { ...valid, is_pastor: true, has_leadership: false, leader_id: null };
    expect(codes({ ...samuel, is_pastor: false, has_leadership: null }, editContext(samuel))).toEqual([]);
    expect(codes({ ...samuel, is_pastor: false, has_leadership: true }, editContext(samuel))).toEqual(["leader_required"]);
  });

  it("RN-16: desligar \"Batizado(a)?\" sem mexer na data a apaga (como o a0_)", () => {
    const baptized = { ...valid, is_baptized: true, baptism_date: "2020-05-10" };
    expect(codes({ ...baptized, is_baptized: false }, editContext(baptized))).toEqual([]);
    expect(codes({ ...baptized, is_baptized: false, baptism_date: "2021-01-01" }, editContext(baptized))).toEqual([
      "baptism_date_without_baptism",
    ]);
  });
});

describe("effectiveHasLeadership (DT-06)", () => {
  it("resolve como o a0_normalize_member", () => {
    expect(effectiveHasLeadership({ is_pastor: false, has_leadership: null }, null)).toBe(true);
    expect(effectiveHasLeadership({ is_pastor: true, has_leadership: null }, null)).toBe(false);
    expect(effectiveHasLeadership({ has_leadership: false, leader_id: LEADER }, null)).toBe(true);
    const andre = { is_pastor: false, has_leadership: true, leader_id: LEADER };
    expect(effectiveHasLeadership({ is_pastor: true, has_leadership: true, leader_id: null }, andre)).toBe(false);
    expect(effectiveHasLeadership({ is_pastor: false, has_leadership: null }, { has_leadership: false })).toBe(false);
  });
});

describe("validateOnBlur (P-VAL-19, UX-09)", () => {
  const ctx = { stored: null, today: TODAY };

  it("campo vazio não mostra erro", () => {
    for (const field of ["name", "birth_date", "mobile_whatsapp", "email", "cpf"] as const) {
      expect(validateOnBlur(field, "  ", ctx), field).toBeNull();
    }
  });

  it("só o formato do campo", () => {
    expect(validateOnBlur("name", "Lúcia", ctx)?.code).toBe("name_invalid");
    expect(validateOnBlur("mobile_whatsapp", "98888-1234", ctx)?.code).toBe("mobile_invalid");
    expect(validateOnBlur("email", "lucia@mci12fakemail.com", ctx)?.message).toBe(MEMBER_RULE_TEXTS.emailPlaceholder);
    expect(validateOnBlur("cpf", "529.982.247-26", ctx)?.code).toBe("cpf_invalid");
    expect(validateOnBlur("birth_date", "2026-11-24", ctx)?.code).toBe("birth_date_future");
    expect(validateOnBlur("email", "ana@exemplo.com", ctx)).toBeNull();
  });

  it("voltar ao valor gravado (lido pela regra) tira o erro (UX-22)", () => {
    expect(validateOnBlur("mobile_whatsapp", "98887777", { stored: fabio, today: TODAY })).toBeNull();
    expect(validateOnBlur("mobile_whatsapp", "9888-7770", { stored: fabio, today: TODAY })?.code).toBe("mobile_invalid");
  });
});

describe("legacyWarnings e visibleLegacyWarnings (RN-17, P24, T6)", () => {
  const all = { sensitiveVisible: true, readOnly: false, today: TODAY };

  it("UX-21: Fábio tem os avisos do Nome, da Data de nascimento, do Celular e da Identificação", () => {
    expect(legacyWarnings(fabio, all)).toEqual({
      name: MEMBER_LEGACY_TEXTS.name,
      birth_date: MEMBER_LEGACY_TEXTS.birthDate,
      identification: MEMBER_LEGACY_TEXTS.identification,
      mobile_whatsapp: MEMBER_LEGACY_TEXTS.mobile,
    });
  });

  it("UX-21: quem não vê os dados sensíveis só vê os avisos do Nome e da Data", () => {
    expect(Object.keys(legacyWarnings(fabio, { ...all, sensitiveVisible: false }))).toEqual(["name", "birth_date"]);
  });

  it("UX-23: só para leitura, nenhum aviso", () => {
    expect(legacyWarnings(fabio, { ...all, readOnly: true })).toEqual({});
  });

  it("um cadastro dentro das regras não tem avisos", () => {
    expect(legacyWarnings(valid, all)).toEqual({});
  });

  it("P24: o aviso some quando o campo muda e volta com o valor gravado", () => {
    const warnings = legacyWarnings(fabio, all);
    const changed = visibleLegacyWarnings(warnings, fabio, { ...fabio, mobile_whatsapp: "9888-7770", name: "Fábio " });
    expect(changed.mobile_whatsapp).toBeUndefined();
    expect(changed.name).toBe(MEMBER_LEGACY_TEXTS.name);
    expect(changed.identification).toBe(MEMBER_LEGACY_TEXTS.identification);
    const fixed = visibleLegacyWarnings(warnings, fabio, { ...fabio, email: "fabio@exemplo.com" });
    expect(fixed.identification).toBeUndefined();
    expect(visibleLegacyWarnings(warnings, fabio, fabio)).toEqual(warnings);
  });
});
