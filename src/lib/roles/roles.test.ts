import { describe, expect, it } from "vitest";
import { PERMISSION_CATALOG } from "@/lib/access/permissions";
import { ROLE_TEXTS, RULE_TEXTS } from "@/lib/access/texts";
import {
  buildSaveRoleArgs,
  classifyRoleWriteError,
  defaultSwitchWarning,
  deleteBlockMessage,
  deleteConsequences,
  groupRolePermissions,
  initialRoleFormValues,
  isRoleFormDirty,
  orderPermissions,
  roleCountsLine,
  roleNameError,
  rolesFromView,
  saveSuccessText,
  togglePermission,
  type Role,
  type RoleViewRow,
} from "./roles";

function row(overrides: Partial<RoleViewRow>): RoleViewRow {
  return {
    id: "r",
    name: "Função",
    description: null,
    is_protected: false,
    is_default: false,
    permissions: [],
    members_count: 0,
    updated_at: "2026-11-25T12:00:00+00:00",
    ...overrides,
  };
}

function role(overrides: Partial<Role>): Role {
  return {
    id: "r",
    name: "Função",
    description: null,
    isProtected: false,
    isDefault: false,
    permissions: [],
    membersCount: 0,
    updatedAt: "2026-11-25T12:00:00+00:00",
    ...overrides,
  };
}

const admin = role({ id: "adm", name: "Administrador", isProtected: true, membersCount: 1 });
const leader = role({ id: "lid", name: "Líder", membersCount: 6, permissions: ["view_dashboard", "create_member"] });
const member = role({ id: "mem", name: "Membro", isDefault: true, membersCount: 5 });
const support = role({ id: "apo", name: "Apoio", membersCount: 0 });

describe("rolesFromView: ordem e leitura da roles_view (T2)", () => {
  it("põe a Administrador primeiro e as demais em ordem alfabética do português", () => {
    const roles = rolesFromView([
      row({ id: "mem", name: "Membro" }),
      row({ id: "adm", name: "Administrador", is_protected: true }),
      row({ id: "zel", name: "Zelador" }),
      row({ id: "apo", name: "Apoio" }),
      row({ id: "ana", name: "Ánima" }),
    ]);
    expect(roles.map((r) => r.name)).toEqual(["Administrador", "Ánima", "Apoio", "Membro", "Zelador"]);
  });

  it("descarta linhas sem id ou nome e normaliza os nulos", () => {
    const roles = rolesFromView([
      row({ id: null }),
      row({ name: null }),
      row({ id: "x", name: "X", is_default: null, is_protected: null, members_count: null, description: "  " }),
    ]);
    expect(roles).toHaveLength(1);
    expect(roles[0]).toMatchObject({ isDefault: false, isProtected: false, membersCount: null, description: null });
  });

  it("mostra as permissões na ordem dos grupos, sem as aposentadas (UX-01)", () => {
    const [r] = rolesFromView([
      row({ permissions: ["view_audit_log", "view_members", "create_member", "view_own_ministry_dashboard", "view_all_church"] }),
    ]);
    expect(r.permissions).toEqual(["view_all_church", "create_member", "view_audit_log"]);
  });
});

describe("contagens (T2)", () => {
  it("diz permissões e membros, no singular e no plural", () => {
    expect(roleCountsLine(leader)).toBe("2 permissões · 6 membros");
    expect(roleCountsLine(role({ permissions: ["view_dashboard"], membersCount: 1 }))).toBe("1 permissão · 1 membro");
    expect(roleCountsLine(support)).toBe("0 permissões · Nenhum membro");
  });

  it("sem a contagem de membros, mostra só as permissões", () => {
    expect(roleCountsLine(role({ membersCount: null }))).toBe("0 permissões");
  });

  it("na Administrador, só os membros", () => {
    expect(roleCountsLine(admin)).toBe("1 membro");
    expect(roleCountsLine({ ...admin, membersCount: null })).toBe("");
  });
});

describe("groupRolePermissions", () => {
  it("agrupa nos grupos da T3, sem os grupos vazios", () => {
    const groups = groupRolePermissions(["submit_own_cell_report", "view_dashboard", "edit_own_data"]);
    expect(groups.map((g) => g.label)).toEqual(["O que a pessoa vê", "Membros", "Relatórios"]);
    expect(groups[2].permissions.map((p) => p.label)).toEqual(["Enviar Relatório das Próprias Células"]);
  });
});

describe("deleteBlockMessage: bloqueio antecipado (T4, RN-20)", () => {
  it("bloqueia a padrão, a em uso (com quantos) e a Administrador", () => {
    expect(deleteBlockMessage(member)).toBe(RULE_TEXTS.roleIsDefault);
    expect(deleteBlockMessage(leader)).toBe("Esta função é usada por 6 membros. Troque a função deles antes de excluí-la.");
    expect(deleteBlockMessage(role({ membersCount: 1 }))).toBe(
      "Esta função é usada por 1 membro. Troque a função deles antes de excluí-la.",
    );
    expect(deleteBlockMessage(admin)).toBe(RULE_TEXTS.adminRoleProtected.delete);
  });

  it("libera a confirmação sem uso ou sem a contagem", () => {
    expect(deleteBlockMessage(support)).toBeNull();
    expect(deleteBlockMessage(role({ membersCount: null }))).toBeNull();
  });

  it("a confirmação só diz que ninguém usa quando a contagem é zero", () => {
    expect(deleteConsequences(support)).toEqual([ROLE_TEXTS.deleteNoMembers, ROLE_TEXTS.deleteIrreversible]);
    expect(deleteConsequences(role({ membersCount: null }))).toEqual([ROLE_TEXTS.deleteIrreversible]);
  });
});

describe("defaultSwitchWarning (UXD-8, UX-07)", () => {
  const roles = [admin, leader, member, support];

  it("ao ligar em outra função, diz qual deixa de ser a padrão", () => {
    expect(defaultSwitchWarning(leader, true, roles)).toBe(ROLE_TEXTS.defaultSwitchWarning("Membro"));
    expect(defaultSwitchWarning(null, true, roles)).toBe(ROLE_TEXTS.defaultSwitchWarning("Membro"));
  });

  it("sem aviso com o interruptor desligado, na própria padrão ou sem padrão conhecida", () => {
    expect(defaultSwitchWarning(leader, false, roles)).toBeNull();
    expect(defaultSwitchWarning(member, true, roles)).toBeNull();
    expect(defaultSwitchWarning(leader, true, [admin, leader])).toBeNull();
  });
});

describe("formulário (T3)", () => {
  it("começa com os dados da função ou vazio", () => {
    expect(initialRoleFormValues(null)).toEqual({ name: "", description: "", permissions: [], isDefault: false });
    expect(initialRoleFormValues(member)).toMatchObject({ name: "Membro", isDefault: true });
  });

  it("marca e desmarca mantendo a ordem dos grupos", () => {
    const marked = togglePermission(["view_audit_log"], "view_all_church", true);
    expect(marked).toEqual(["view_all_church", "view_audit_log"]);
    expect(togglePermission(marked, "view_audit_log", false)).toEqual(["view_all_church"]);
  });

  it("detecta alterações, sem contar a ordem das permissões", () => {
    const initial = initialRoleFormValues(leader);
    expect(isRoleFormDirty(initial, { ...initial, permissions: ["create_member", "view_dashboard"] })).toBe(false);
    expect(isRoleFormDirty(initial, { ...initial, name: "Líderes" })).toBe(true);
    expect(isRoleFormDirty(initial, { ...initial, isDefault: true })).toBe(true);
    expect(isRoleFormDirty(initial, { ...initial, permissions: ["view_dashboard"] })).toBe(true);
  });

  it("exige o nome", () => {
    expect(roleNameError("   ")).toBe(ROLE_TEXTS.nameRequired);
    expect(roleNameError("Apoio")).toBeNull();
  });
});

describe("buildSaveRoleArgs: uma chamada só (RN-19, critério 7)", () => {
  it("na edição, leva o id, a troca da padrão e o updated_at lido", () => {
    const args = buildSaveRoleArgs(leader, {
      name: "  Líder ",
      description: "  ",
      permissions: ["view_audit_log", "view_dashboard"],
      isDefault: true,
    });
    expect(args).toEqual({
      _role_id: "lid",
      _name: "Líder",
      _description: null,
      _permissions: ["view_dashboard", "view_audit_log"],
      _is_default: true,
      _expected_updated_at: leader.updatedAt,
    });
  });

  it("na nova, sem id e sem updated_at", () => {
    const args = buildSaveRoleArgs(null, { name: "Apoio", description: "Ajuda", permissions: [], isDefault: false });
    expect(args).toMatchObject({ _role_id: null, _expected_updated_at: null, _description: "Ajuda", _is_default: false });
  });
});

describe("saveSuccessText", () => {
  const values = initialRoleFormValues(leader);
  it("criada, atualizada ou atualizada e agora a padrão", () => {
    expect(saveSuccessText(null, values)).toBe(ROLE_TEXTS.created);
    expect(saveSuccessText(leader, values)).toBe(ROLE_TEXTS.updated);
    expect(saveSuccessText(leader, { ...values, isDefault: true })).toBe(ROLE_TEXTS.updatedAsDefault("Líder"));
    expect(saveSuccessText(member, initialRoleFormValues(member))).toBe(ROLE_TEXTS.updated);
  });
});

describe("classifyRoleWriteError", () => {
  const appError = (code: string, message = "Mensagem do banco.") => ({
    code: "22023",
    message,
    details: JSON.stringify({ code }),
    hint: "app_error",
  });

  it("separa permissão, função mudada, Administrador, nome e as demais regras", () => {
    expect(classifyRoleWriteError({ code: "42501", message: "x" })).toEqual({ kind: "forbidden" });
    expect(classifyRoleWriteError(appError("role_changed", RULE_TEXTS.roleChanged))).toEqual({
      kind: "gone",
      message: RULE_TEXTS.roleChanged,
    });
    expect(classifyRoleWriteError(appError("role_not_found")).kind).toBe("gone");
    expect(classifyRoleWriteError(appError("admin_role_protected")).kind).toBe("protected");
    expect(classifyRoleWriteError(appError("role_name_taken")).kind).toBe("name");
    expect(classifyRoleWriteError(appError("role_name_required")).kind).toBe("name");
    for (const code of ["role_in_use", "role_is_default", "role_default_required", "permission_not_covered", "permission_retired"]) {
      expect(classifyRoleWriteError(appError(code)).kind).toBe("refused");
    }
  });

  it("separa a queda de conexão da falha técnica", () => {
    expect(classifyRoleWriteError({ code: "", message: "TypeError: Failed to fetch" })).toEqual({ kind: "network" });
    expect(classifyRoleWriteError({ code: "XX000", message: "boom" })).toEqual({ kind: "unexpected" });
  });
});

describe("catálogo", () => {
  it("orderPermissions descarta valores fora do catálogo", () => {
    expect(orderPermissions(["nao_existe", "view_dashboard"])).toEqual(["view_dashboard"]);
    expect(orderPermissions(null)).toEqual([]);
    expect(PERMISSION_CATALOG).toHaveLength(22);
  });
});
