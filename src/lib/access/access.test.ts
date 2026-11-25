import {
  NO_ACCESS,
  accessFingerprint,
  canSeeRoute,
  dashboardDeniedLines,
  dashboardHeader,
  hasPermission,
  listSubtitle,
  memberSearchEmptyLabel,
  menuItems,
  ownDataMode,
  peopleLimitedToMinistry,
  roleDisplayName,
  type Access,
} from "./access";
import { PERMISSION_CATALOG, type PermissionAction } from "./permissions";

// Personas da massa do spec (Critérios de aceite > Massa de exemplo) e da
// tabela de Navegação e rotas.
function persona(overrides: Partial<Access>): Access {
  return { ...NO_ACCESS, member_id: "m-1", role_id: "r-1", role_name: "Função", ...overrides };
}

const LEADER_PERMISSIONS: PermissionAction[] = [
  "view_dashboard",
  "view_own_ministry",
  "edit_own_data",
  "create_member",
  "edit_member",
  "delete_member",
  "create_cell",
  "edit_cell",
  "delete_cell",
  "submit_own_cell_report",
  "edit_cell_report",
  "delete_cell_report",
];
const MEMBER_PERMISSIONS: PermissionAction[] = ["view_dashboard", "view_own_ministry", "edit_own_data", "submit_own_cell_report"];

const rita = persona({
  role_name: "Administrador",
  role_is_protected: true,
  permissions: PERMISSION_CATALOG.map((p) => p.value),
  sees_whole_church: true,
  sees_ministry: true,
  sees_whole_church_reports: true,
  sees_ministry_reports: true,
});
const pedro = persona({ role_name: "Líder", permissions: LEADER_PERMISSIONS, sees_ministry: true, sees_ministry_reports: true });
const caio = persona({ role_name: "Membro", permissions: MEMBER_PERMISSIONS, sees_ministry: true, sees_ministry_reports: true });
const gabriel = persona({ role_name: "Relatórios", permissions: ["view_own_reports"], sees_ministry_reports: true });
const hugo = persona({ role_id: null, role_name: null });
const contaX = NO_ACCESS;

const keys = (access: Access | null) => menuItems(access).map((item) => item.key);

describe("menuItems (RN-22, UX-08)", () => {
  it("Rita (Administrador) vê os 7 itens, na ordem do menu", () => {
    expect(keys(rita)).toEqual(["dashboard", "members", "cells", "reports", "ministries", "roles", "events"]);
    expect(menuItems(rita).map((i) => i.label)).toEqual([
      "Dashboard",
      "Membros",
      "Células",
      "Relatórios",
      "Ministérios",
      "Funções",
      "Auditoria",
    ]);
  });

  it.each([
    ["Líder (Samuel, Pedro)", pedro],
    ["Membro (Caio, Carla)", caio],
  ])("%s vê Dashboard, Membros, Células, Relatórios e Ministérios", (_, access) => {
    expect(keys(access)).toEqual(["dashboard", "members", "cells", "reports", "ministries"]);
  });

  it("Gabriel, só com view_own_reports, vê só Relatórios", () => {
    expect(keys(gabriel)).toEqual(["reports"]);
  });

  it.each<PermissionAction>(["submit_own_cell_report", "submit_any_visible_report", "edit_cell", "view_all_reports"])(
    "uma função só com %s vê Relatórios",
    (permission) => {
      expect(keys(persona({ permissions: [permission] }))).toEqual(["reports"]);
    },
  );

  it("Hugo (sem função) e a conta X (sem cadastro) não veem nenhum item", () => {
    expect(keys(hugo)).toEqual([]);
    expect(keys(contaX)).toEqual([]);
    expect(keys(null)).toEqual([]);
  });

  it("uma função só com view_all_church vê Membros, Células, Relatórios e Ministérios", () => {
    expect(keys(persona({ permissions: ["view_all_church"], sees_whole_church: true }))).toEqual([
      "members",
      "cells",
      "reports",
      "ministries",
    ]);
  });

  it("Funções aparece com view_roles ou manage_roles", () => {
    expect(keys(persona({ permissions: ["view_roles"] }))).toEqual(["roles"]);
    expect(keys(persona({ permissions: ["manage_roles"] }))).toEqual(["roles"]);
  });

  it("as permissões aposentadas não abrem nenhum item", () => {
    expect(keys(persona({ permissions: ["view_members", "view_own_ministry_dashboard"] }))).toEqual([]);
  });
});

describe("RN-07: sem cadastro ou sem função, nada liberado", () => {
  it.each([
    ["conta X (sem cadastro)", contaX],
    ["Hugo (sem função)", hugo],
  ])("%s: nenhum item e nenhuma rota", (_, access) => {
    expect(menuItems(access)).toEqual([]);
    for (const path of ["/", "/members", "/cells", "/cell-reports", "/ministries", "/roles", "/events"]) {
      expect(canSeeRoute(access, path)).toBe(false);
    }
  });
});

describe("RN-22: catálogo e permissões aposentadas", () => {
  it("o catálogo não oferece view_members nem view_own_ministry_dashboard", () => {
    const values: string[] = PERMISSION_CATALOG.map((p) => p.value);
    expect(values).not.toContain("view_members");
    expect(values).not.toContain("view_own_ministry_dashboard");
  });

  it("view_members e view_own_ministry_dashboard sozinhas não abrem item nem rota", () => {
    const legacy = persona({ permissions: ["view_members", "view_own_ministry_dashboard"] });
    expect(menuItems(legacy)).toEqual([]);
    expect(canSeeRoute(legacy, "/members")).toBe(false);
    expect(canSeeRoute(legacy, "/")).toBe(false);
  });
});

describe("hasPermission", () => {
  it("responde se há pelo menos uma das permissões", () => {
    expect(hasPermission(caio, "edit_member", "edit_own_data")).toBe(true);
    expect(hasPermission(caio, "edit_member")).toBe(false);
  });

  it("sem acesso lido, nada", () => {
    expect(hasPermission(null, "view_dashboard")).toBe(false);
    expect(hasPermission(undefined, "view_dashboard")).toBe(false);
  });

  it("permissão aposentada nunca libera", () => {
    expect(hasPermission(persona({ permissions: ["view_members"] }), "view_members")).toBe(false);
  });
});

describe("canSeeRoute (T12, UX-11)", () => {
  it("segue o item do menu", () => {
    expect(canSeeRoute(pedro, "/roles")).toBe(false);
    expect(canSeeRoute(rita, "/roles")).toBe(true);
    expect(canSeeRoute(gabriel, "/members")).toBe(false);
    expect(canSeeRoute(gabriel, "/cell-reports")).toBe(true);
    expect(canSeeRoute(caio, "/events")).toBe(false);
    expect(canSeeRoute(rita, "/events")).toBe(true);
    expect(canSeeRoute(caio, "/ministries")).toBe(true);
    expect(canSeeRoute(hugo, "/cells")).toBe(false);
  });

  it("aceita busca e barra no fim", () => {
    expect(canSeeRoute(caio, "/members?q=ana&page=2")).toBe(true);
    expect(canSeeRoute(caio, "/members/")).toBe(true);
  });

  it("as listas de excluídos exigem o item da lista e Gerenciar Funções", () => {
    expect(canSeeRoute(rita, "/members/deleted")).toBe(true);
    expect(canSeeRoute(rita, "/cells/deleted")).toBe(true);
    expect(canSeeRoute(rita, "/cell-reports/deleted")).toBe(true);
    expect(canSeeRoute(pedro, "/members/deleted")).toBe(false);
    // Gerenciar Funções sem ver a lista principal.
    expect(canSeeRoute(persona({ permissions: ["manage_roles"] }), "/members/deleted")).toBe(false);
    expect(canSeeRoute(persona({ permissions: ["manage_roles", "view_own_reports"] }), "/cell-reports/deleted")).toBe(true);
  });

  it("rota que o menu não governa: não", () => {
    expect(canSeeRoute(rita, "/qualquer")).toBe(false);
    expect(canSeeRoute(rita, "/roles/deleted")).toBe(false);
  });
});

describe("accessFingerprint (UXD-11)", () => {
  it("não muda com a ordem das permissões", () => {
    const reversed = { ...caio, permissions: [...caio.permissions].reverse() };
    expect(accessFingerprint(reversed)).toBe(accessFingerprint(caio));
  });

  it("muda com as permissões, a função e 'vê a igreja toda'", () => {
    const base = accessFingerprint(caio);
    expect(accessFingerprint({ ...caio, permissions: [...caio.permissions, "create_member"] })).not.toBe(base);
    expect(accessFingerprint({ ...caio, role_id: "r-2" })).not.toBe(base);
    expect(accessFingerprint({ ...caio, sees_whole_church: true })).not.toBe(base);
  });

  it("não muda com o que não é acesso (o nome da função)", () => {
    expect(accessFingerprint({ ...caio, role_name: "Outro nome" })).toBe(accessFingerprint(caio));
  });
});

describe("listSubtitle (P10, UX-15)", () => {
  it("diz o alcance de cada lista", () => {
    expect(listSubtitle(pedro, "members")).toBe("Membros do seu ministério");
    expect(listSubtitle(rita, "members")).toBe("Membros de toda a igreja");
    expect(listSubtitle(pedro, "cells")).toBe("Células do seu ministério");
    expect(listSubtitle(rita, "cells")).toBe("Células de toda a igreja");
    expect(listSubtitle(pedro, "cellReports")).toBe("Relatórios das células do seu ministério");
    expect(listSubtitle(rita, "cellReports")).toBe("Relatórios das células de toda a igreja");
  });

  it("relatórios de toda a igreja vêm de sees_whole_church_reports", () => {
    const reportsOnly = persona({ permissions: ["view_all_reports"], sees_whole_church_reports: true });
    expect(listSubtitle(reportsOnly, "cellReports")).toBe("Relatórios das células de toda a igreja");
    expect(listSubtitle(reportsOnly, "members")).toBeNull();
  });

  it("sem permissão de visibilidade, sem subtítulo (PO-UX-13)", () => {
    expect(listSubtitle(hugo, "members")).toBeNull();
    expect(listSubtitle(persona({ permissions: ["submit_own_cell_report"] }), "cellReports")).toBeNull();
    expect(listSubtitle(null, "cells")).toBeNull();
  });
});

describe("dashboardHeader e dashboardDeniedLines (T9, UX-12, UX-13)", () => {
  it("Rita: visão geral, sem selo; Pedro: visão do ministério, com selo", () => {
    expect(dashboardHeader(rita)).toEqual({ subtitle: "Visão geral da igreja", badge: null });
    expect(dashboardHeader(pedro)).toEqual({ subtitle: "Visão do seu ministério", badge: "Meu Ministério" });
  });

  it("com Visualizar Dashboard e sem visibilidade: nem subtítulo nem selo", () => {
    expect(dashboardHeader(persona({ permissions: ["view_dashboard"] }))).toEqual({ subtitle: null, badge: null });
  });

  it("sem acesso: a linha do Negócio e a orientação de quem não tem cadastro ou função", () => {
    expect(dashboardDeniedLines(contaX)).toEqual([
      "Você não tem acesso ao dashboard.",
      "Seu acesso ainda não está ligado a um cadastro de membro. Fale com um administrador.",
    ]);
    expect(dashboardDeniedLines(hugo)).toEqual([
      "Você não tem acesso ao dashboard.",
      "Sua conta ainda não tem uma função. Fale com um administrador.",
    ]);
    expect(dashboardDeniedLines(gabriel)).toEqual(["Você não tem acesso ao dashboard."]);
    expect(dashboardDeniedLines(caio)).toBeNull();
  });
});

describe("rodapé do menu (T1, UX-09)", () => {
  it("Editar com edit_own_data ou edit_member; Ver nos demais; nada sem cadastro", () => {
    expect(ownDataMode(caio)).toBe("edit");
    expect(ownDataMode(persona({ permissions: ["edit_member"] }))).toBe("edit");
    expect(ownDataMode(hugo)).toBe("view");
    expect(ownDataMode(gabriel)).toBe("view");
    expect(ownDataMode(contaX)).toBeNull();
    expect(ownDataMode(null)).toBeNull();
  });

  it("a função embaixo do nome, ou Sem função", () => {
    expect(roleDisplayName(caio)).toBe("Membro");
    expect(roleDisplayName(hugo)).toBe("Sem função");
  });
});

describe("memberSearchEmptyLabel (P11)", () => {
  it("diz 'do seu ministério' só para quem não vê a igreja toda", () => {
    expect(memberSearchEmptyLabel(pedro)).toBe("Nenhum membro do seu ministério encontrado.");
    expect(memberSearchEmptyLabel(rita)).toBe("Nenhum membro encontrado");
    expect(memberSearchEmptyLabel(null)).toBe("Nenhum membro encontrado");
  });
});

describe("peopleLimitedToMinistry (P11, T7, T8)", () => {
  it("é verdadeiro só para quem não vê a igreja toda, e falso sem acesso lido", () => {
    expect(peopleLimitedToMinistry(pedro)).toBe(true);
    expect(peopleLimitedToMinistry(rita)).toBe(false);
    expect(peopleLimitedToMinistry(null)).toBe(false);
  });
});
