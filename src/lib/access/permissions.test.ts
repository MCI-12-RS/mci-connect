import { Constants } from "@/integrations/supabase/types";
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  RETIRED_PERMISSIONS,
  isRetiredPermission,
  permissionLabel,
} from "./permissions";

const ALL = Constants.public.Enums.permission_action;

describe("PERMISSION_CATALOG (RN-22, T3, UX-01)", () => {
  it("tem as 22 permissões ativas, cada uma uma vez, sem as aposentadas", () => {
    const values = PERMISSION_CATALOG.map((p) => p.value);
    expect(values).toHaveLength(22);
    expect(new Set(values).size).toBe(22);
    const active = ALL.filter((p) => !isRetiredPermission(p));
    expect([...values].sort()).toEqual([...active].sort());
    for (const retired of RETIRED_PERMISSIONS) expect(values).not.toContain(retired);
  });

  it("segue os 5 grupos da T3, nesta ordem", () => {
    expect(PERMISSION_GROUPS.map((g) => g.label)).toEqual([
      "O que a pessoa vê",
      "Membros",
      "Células",
      "Relatórios",
      "Funções e auditoria",
    ]);
    // Grupos contíguos, na ordem dos grupos.
    const groupOrder = PERMISSION_CATALOG.map((p) => p.group).filter((g, i, list) => g !== list[i - 1]);
    expect(groupOrder).toEqual(PERMISSION_GROUPS.map((g) => g.id));
  });

  it("usa os rótulos novos e nenhum identificador técnico", () => {
    const labels = PERMISSION_CATALOG.map((p) => p.label);
    expect(labels).toContain("Visualizar Toda a Igreja");
    expect(labels).toContain("Visualizar Relatórios de Toda a Igreja");
    expect(labels).toContain("Visualizar Relatórios do Seu Ministério");
    expect(labels).toContain("Visualizar Dashboard");
    expect(labels).toContain("Enviar Relatório das Próprias Células");
    expect(labels).toContain("Enviar Relatório de Qualquer Célula Visível");
    expect(labels).toContain("Visualizar Auditoria");
    expect(labels).not.toContain("Visualizar Membros (legado)");
    expect(labels).not.toContain("Visualizar Dashboard do seu ministério");
    for (const label of labels) expect(label).not.toMatch(/_/);
  });

  it("traz as dicas do Negócio e da UX", () => {
    const hint = (value: string) => PERMISSION_CATALOG.find((p) => p.value === value)?.hint;
    expect(hint("submit_own_cell_report")).toBe("Células em que a pessoa é líder, timóteo ou anfitrião.");
    expect(hint("view_audit_log")).toBe("As alterações feitas em toda a igreja, sem limite de ministério.");
    expect(hint("view_all_reports")).toBe("Só os relatórios. Não abre Membros nem Células.");
    expect(hint("view_own_reports")).toBe("Só os relatórios. Não abre Membros nem Células.");
    expect(hint("create_member")).toBeNull();
  });
});

describe("permissões aposentadas", () => {
  it("são view_members e view_own_ministry_dashboard", () => {
    expect([...RETIRED_PERMISSIONS].sort()).toEqual(["view_members", "view_own_ministry_dashboard"]);
    expect(isRetiredPermission("view_members")).toBe(true);
    expect(isRetiredPermission("view_all_church")).toBe(false);
  });

  it("todas as permissões do banco têm rótulo", () => {
    for (const permission of ALL) expect(permissionLabel(permission)).not.toBe("");
  });
});

describe("E2.03 (T7, RN-01): 'Redefinir Senha de Membros'", () => {
  it("rótulo e dica do Negócio, no grupo Membros; o rótulo antigo não existe mais", async () => {
    const { PERMISSION_CATALOG: catalog, PERMISSION_GROUPS: groups } = await import("./permissions");
    const info = catalog.find((p) => p.value === "change_member_password");
    expect(info?.label).toBe("Redefinir Senha de Membros");
    expect(info?.hint).toBe(
      "Gera uma senha temporária para os membros que a pessoa vê, só de funções com permissões que ela também tem. O membro cria uma nova senha no próximo acesso.",
    );
    expect(groups.find((g) => g.id === "members")?.permissions).toContain("change_member_password");
    expect(JSON.stringify(catalog)).not.toContain("Alterar Senha");
  });
});
