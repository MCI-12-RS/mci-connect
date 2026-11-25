import { describe, expect, it } from "vitest";
import {
  initialLeaderId,
  leadershipValues,
  memberRefusalFromCreate,
  memberRefusalFromError,
  memberSaveFailureMessage,
  ministryFieldsView,
  needsRoleOptions,
  parseRoleOptions,
  roleFieldView,
  type RoleFieldInput,
  type RoleOptions,
} from "./member-form";

// Massa do spec (E2.02): Rita vê a igreja toda e atribui funções; Pedro (Líder)
// vê só o ministério e não atribui; Caio é discípulo de Pedro; Samuel é pastor
// e vê só o ministério; Magda é pastora; Ester está sem liderança.

const MEMBRO = { id: "r-membro", name: "Membro" };
const LIDER = { id: "r-lider", name: "Líder" };
const ADMIN = { id: "r-admin", name: "Administrador" };

const options = (overrides: Partial<RoleOptions>): RoleOptions => ({
  current: null,
  editable: false,
  reason: null,
  options: [],
  default_role: MEMBRO,
  ...overrides,
});

const ALL_CHOICES = [
  { ...ADMIN, is_default: false },
  { ...LIDER, is_default: false },
  { ...MEMBRO, is_default: true },
];

const input = (overrides: Partial<RoleFieldInput>): RoleFieldInput => ({
  isNew: false,
  isSelf: false,
  canAssignRoles: false,
  ownRoleName: null,
  ...overrides,
});

describe("parseRoleOptions", () => {
  it("lê o JSON de role_options e descarta opções fora do formato", () => {
    expect(
      parseRoleOptions({
        current: { id: "r-lider", name: "Líder" },
        editable: true,
        reason: null,
        options: [{ id: "r-membro", name: "Membro", is_default: true }, { id: 1 }, null],
        default_role: { id: "r-membro", name: "Membro" },
      }),
    ).toEqual({
      current: LIDER,
      editable: true,
      reason: null,
      options: [{ ...MEMBRO, is_default: true }],
      default_role: MEMBRO,
    });
  });

  it("motivo desconhecido vira null; sem `editable` ou sem lista, null", () => {
    expect(parseRoleOptions({ editable: false, reason: "x", options: [] })?.reason).toBeNull();
    expect(parseRoleOptions({ options: [] })).toBeNull();
    expect(parseRoleOptions({ editable: true })).toBeNull();
    expect(parseRoleOptions([])).toBeNull();
  });
});

describe("campo Função (T6, UX-21)", () => {
  it("Rita editando Caio: seletor só com as funções que ela atribui, com (padrão), e a atual escolhida", () => {
    const rita = input({ canAssignRoles: true, ownRoleName: "Administrador" });
    expect(needsRoleOptions(rita)).toBe(true);
    expect(roleFieldView({ ...rita, options: options({ current: MEMBRO, editable: true, options: ALL_CHOICES }) })).toEqual({
      kind: "select",
      options: [
        { value: "r-admin", label: "Administrador" },
        { value: "r-lider", label: "Líder" },
        { value: "r-membro", label: "Membro (padrão)" },
      ],
      initialValue: "r-membro",
    });
  });

  it("Rita no próprio cadastro: texto 'Administrador' com 'Ninguém pode alterar a própria função.', sem ler role_options", () => {
    const self = input({ isSelf: true, canAssignRoles: true, ownRoleName: "Administrador" });
    expect(needsRoleOptions(self)).toBe(false);
    expect(roleFieldView(self)).toEqual({
      kind: "text",
      value: "Administrador",
      note: "Ninguém pode alterar a própria função.",
    });
  });

  it("no próprio cadastro sem função: 'Sem função'", () => {
    expect(roleFieldView(input({ isSelf: true }))).toMatchObject({ kind: "text", value: "Sem função" });
  });

  it("quem atribui, diante da Administrador: texto com 'Você não tem permissão para alterar a função deste membro.'", () => {
    const view = roleFieldView(
      input({ canAssignRoles: true, options: options({ current: ADMIN, reason: "role_above", options: ALL_CHOICES.slice(1) }) }),
    );
    expect(view).toEqual({
      kind: "text",
      value: "Administrador",
      note: "Você não tem permissão para alterar a função deste membro.",
    });
  });

  it("o servidor diz `self` (corrida): texto com a própria função", () => {
    expect(roleFieldView(input({ canAssignRoles: true, options: options({ current: LIDER, reason: "self" }) }))).toMatchObject({
      kind: "text",
      value: "Líder",
      note: "Ninguém pode alterar a própria função.",
    });
  });

  it("Pedro cadastrando (não atribui): texto 'Membro (padrão)' com a dica", () => {
    const pedro = input({ isNew: true, ownRoleName: "Líder" });
    expect(needsRoleOptions(pedro)).toBe(true);
    expect(roleFieldView({ ...pedro, options: options({ reason: "no_permission" }) })).toEqual({
      kind: "text",
      value: "Membro (padrão)",
      note: "Novos membros recebem a função padrão.",
    });
  });

  it("Pedro editando Caio: o campo não aparece e não há leitura de role_options", () => {
    const pedro = input({ ownRoleName: "Líder" });
    expect(needsRoleOptions(pedro)).toBe(false);
    expect(roleFieldView(pedro)).toEqual({ kind: "hidden" });
  });

  it("cadastro novo por quem atribui: seletor com a padrão já escolhida", () => {
    const view = roleFieldView(
      input({ isNew: true, canAssignRoles: true, options: options({ editable: true, options: ALL_CHOICES }) }),
    );
    expect(view).toMatchObject({ kind: "select", initialValue: "r-membro" });
  });

  it("a padrão que quem atribui não cobre não vem escolhida", () => {
    const view = roleFieldView(
      input({ isNew: true, canAssignRoles: true, options: options({ editable: true, options: [{ ...LIDER, is_default: false }] }) }),
    );
    expect(view).toMatchObject({ kind: "select", initialValue: null });
  });

  it("enquanto role_options não chega: pendente", () => {
    expect(roleFieldView(input({ isNew: true }))).toEqual({ kind: "pending" });
  });

  it("membro que quem atribui não vê (`not_found`): o campo não aparece", () => {
    expect(roleFieldView(input({ canAssignRoles: true, options: options({ reason: "not_found" }) }))).toEqual({
      kind: "hidden",
    });
  });
});

describe("dados ministeriais (T6, RN-10)", () => {
  it("UX-18: Rita (igreja toda) vê 'É Pastor(a)?', 'Tem Liderança?' e o Líder como hoje, sem dicas", () => {
    for (const isNew of [true, false]) {
      expect(ministryFieldsView({ seesWholeChurch: true, isNew, saved: { is_pastor: false, leader_id: "x" } })).toEqual({
        pastor: "switch",
        leadership: "switch",
        leader: "toggle",
        leaderHint: null,
        spouseHint: null,
      });
    }
  });

  it("UX-17: Pedro cadastrando: sem os interruptores, Líder obrigatório com a dica, preenchido com Pedro", () => {
    const view = ministryFieldsView({ seesWholeChurch: false, isNew: true });
    expect(view).toEqual({
      pastor: "hidden",
      leadership: "hidden",
      leader: "required",
      leaderHint: "O líder é obrigatório e é escolhido entre as pessoas do seu ministério.",
      spouseHint: "Escolha entre as pessoas do seu ministério. Se o cônjuge é de outro ministério, peça a um administrador.",
    });
    expect(initialLeaderId(view, true, "pedro")).toBe("pedro");
  });

  it("Rita cadastrando: o Líder não vem preenchido (a MEM-15 para todos é do E2.07)", () => {
    const view = ministryFieldsView({ seesWholeChurch: true, isNew: true });
    expect(initialLeaderId(view, true, "rita")).toBeNull();
  });

  it("Pedro editando Caio: Líder obrigatório, sem preencher de novo", () => {
    const view = ministryFieldsView({ seesWholeChurch: false, isNew: false, saved: { is_pastor: false, leader_id: "pedro" } });
    expect(view.leader).toBe("required");
    expect(initialLeaderId(view, false, "pedro")).toBeNull();
  });

  it("UX-19: Samuel editando Magda (pastora): 'Pastor(a)' como texto, sem interruptor e sem o Líder", () => {
    const view = ministryFieldsView({ seesWholeChurch: false, isNew: false, saved: { is_pastor: true, leader_id: null } });
    expect(view).toMatchObject({ pastor: "text", leadership: "hidden", leader: "hidden" });
  });

  it("Diego editando Ester (sem liderança): 'Sem liderança' como texto e o Líder opcional (PO-UX-7)", () => {
    const view = ministryFieldsView({ seesWholeChurch: false, isNew: false, saved: { is_pastor: false, leader_id: null } });
    expect(view).toMatchObject({ pastor: "hidden", leadership: "text", leader: "optional", leaderHint: null });
  });
});

describe("leadershipValues", () => {
  const church = ministryFieldsView({ seesWholeChurch: true, isNew: false });
  const ministry = ministryFieldsView({ seesWholeChurch: false, isNew: false, saved: { is_pastor: false, leader_id: null } });

  it("igreja toda: 'Tem Liderança?' desligado apaga o líder (senão o banco religaria a marca, DA-11)", () => {
    expect(leadershipValues(church, { has_leadership: false, leader_id: "x" })).toEqual({ has_leadership: false, leader_id: null });
    expect(leadershipValues(church, { has_leadership: true, leader_id: "x" })).toEqual({ has_leadership: true, leader_id: "x" });
  });

  it("só o ministério: escolher um líder liga a marca; sem líder, a marca fica como estava", () => {
    expect(leadershipValues(ministry, { has_leadership: false, leader_id: "rita" })).toEqual({ has_leadership: true, leader_id: "rita" });
    expect(leadershipValues(ministry, { has_leadership: false, leader_id: null })).toEqual({ has_leadership: false, leader_id: null });
  });
});

const appError = (detail: Record<string, unknown>, message: string) => ({
  code: "22023",
  message,
  details: JSON.stringify(detail),
  hint: "app_error",
});

describe("recusas do servidor (T11 do E2.02; T5 do E2.04)", () => {
  it("pessoa fora do que se vê (RN-09 b): embaixo do campo que o servidor apontou", () => {
    const msg = "Você só pode escolher pessoas que você vê.";
    expect(memberRefusalFromError(appError({ code: "person_not_visible", field: "spouse_id" }, msg))).toEqual({
      message: msg,
      fields: { spouse_id: msg },
      rereadAccess: false,
    });
    expect(memberRefusalFromError(appError({ code: "person_not_visible", field: "member_id" }, msg))?.fields).toEqual({});
  });

  it("RN-10: no topo, e a tela relê o acesso", () => {
    const msg = "Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.";
    expect(
      memberRefusalFromError(appError({ code: "pastor_or_no_leadership_requires_church", field: "leader_id" }, msg)),
    ).toEqual({ message: msg, fields: {}, rereadAccess: true });
  });

  it("RN-09 c e RN-11: no topo, como vieram", () => {
    const msg = "Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.";
    expect(memberRefusalFromError(appError({ code: "would_leave_scope", entity: "member" }, msg))).toEqual({
      message: msg,
      fields: {},
      rereadAccess: false,
    });
  });

  it("função (RN-18): embaixo do campo Função", () => {
    for (const code of ["own_role", "role_change_not_allowed", "role_not_assignable"]) {
      expect(memberRefusalFromError(appError({ code }, "x"))?.fields).toEqual({ role_id: "x" });
    }
  });

  it("42501: 'Você não tem permissão para esta ação.', e relê o acesso", () => {
    expect(memberRefusalFromError({ code: "42501", message: "permission denied for table members" })).toEqual({
      message: "Você não tem permissão para esta ação.",
      fields: {},
      rereadAccess: true,
    });
  });

  it("23505 cru do índice único (E2.04): a mensagem de value_in_use no Celular, nunca o texto técnico", () => {
    const refusal = memberRefusalFromError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "members_mobile_key"',
      details: "Key (mobile_whatsapp)=(51988887777) already exists.",
      hint: null,
    });
    const msg = "Este celular já está sendo usado por outro cadastro.";
    expect(refusal).toEqual({ message: msg, fields: { mobile_whatsapp: msg }, rereadAccess: false });
  });

  it("23514 cru (E2.04): o CHECK vira a recusa do campo", () => {
    const refusal = memberRefusalFromError({
      code: "23514",
      message: 'new row for relation "members" violates check constraint "members_cpf_check"',
    });
    const msg = "CPF inválido. Se a pessoa não tem CPF, deixe o campo em branco.";
    expect(refusal).toEqual({ message: msg, fields: { cpf: msg }, rereadAccess: false });
  });

  it("regra do E2.04 pelo trigger: no campo que o servidor apontou", () => {
    const msg = "Informe o e-mail, o celular ou o CPF. A pessoa usa um deles para entrar no sistema.";
    expect(
      memberRefusalFromError(appError({ code: "identifier_required", field: "identification", fields: ["mobile_whatsapp", "email", "cpf"] }, msg)),
    ).toEqual({ message: msg, fields: { identification: msg }, rereadAccess: false });
  });

  it("value_in_use com dois campos (RN-10): cada campo com a sua mensagem", () => {
    const refusal = memberRefusalFromError(appError({ code: "value_in_use", fields: ["email", "cpf"] }, "Este e-mail já está sendo usado por outro cadastro."));
    expect(refusal?.fields).toEqual({
      email: "Este e-mail já está sendo usado por outro cadastro.",
      cpf: "Este CPF já está sendo usado por outro cadastro.",
    });
  });

  it("falha sem recusa: só 'tente de novo', com o aviso de conexão na queda de rede", () => {
    expect(memberSaveFailureMessage(false)).toBe("Não foi possível salvar o cadastro. Tente de novo.");
    expect(memberSaveFailureMessage(true)).toBe("Não foi possível salvar o cadastro. Verifique a conexão e tente de novo.");
  });

  it("erro técnico, 40P01 ou de rede: null (a tela usa o aviso genérico)", () => {
    expect(memberRefusalFromError({ code: "", message: "TypeError: Failed to fetch" })).toBeNull();
    expect(memberRefusalFromError({ code: "40P01", message: "deadlock detected" })).toBeNull();
    expect(memberRefusalFromError(new Error("x"))).toBeNull();
  });

  it("create-user-admin: 403 é permissão; regras com o campo; sem código ou técnico, null", () => {
    expect(memberRefusalFromCreate({ message: "Você não tem permissão para cadastrar membros.", code: "forbidden", field: null })).toEqual({
      message: "Você não tem permissão para esta ação.",
      fields: {},
      rereadAccess: true,
    });
    expect(
      memberRefusalFromCreate({ message: "Você só pode escolher pessoas que você vê.", code: "person_not_visible", field: "leader_id" }),
    ).toEqual({ message: "Você só pode escolher pessoas que você vê.", fields: { leader_id: "Você só pode escolher pessoas que você vê." }, rereadAccess: false });
    const rn19 = "A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.";
    expect(memberRefusalFromCreate({ message: rn19, code: "default_role_not_covered", field: null })).toEqual({
      message: rn19,
      fields: {},
      rereadAccess: false,
    });
    expect(
      memberRefusalFromCreate({ message: "Este e-mail já está sendo usado por outro cadastro.", code: "value_in_use", field: null, fields: ["email", "mobile"] })?.fields,
    ).toEqual({
      mobile_whatsapp: "Este celular já está sendo usado por outro cadastro.",
      email: "Este e-mail já está sendo usado por outro cadastro.",
    });
    expect(memberRefusalFromCreate({ message: "Já existe…", code: null, field: null })).toBeNull();
    expect(memberRefusalFromCreate({ message: "Erro inesperado", code: "server_error", field: null })).toBeNull();
  });
});
