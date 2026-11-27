// O acesso de quem está logado (E2.02, RN-07, RN-08, RN-22 e RN-23): a linha
// de `my_access()` e o que a tela deriva dela (menu, rotas, subtítulos,
// cabeçalho do Dashboard e "Meus dados"). Sem React e sem Supabase.
//
// Estas funções só mostram ou escondem: quem protege é o banco (RLS, triggers
// e RPCs). O atalho da função Administrador já vem nas permissões efetivas de
// `my_access`, então nada aqui olha o nome nem a marca da função.

import type { Database } from "@/integrations/supabase/types";
import { isRetiredPermission, type PermissionAction } from "./permissions";
import { DASHBOARD_TEXTS, LIST_SUBTITLES, MENU_TEXTS, SELECT_TEXTS } from "./texts";

type MyAccessRow = Database["public"]["Functions"]["my_access"]["Returns"][number];

/**
 * A linha de `my_access()`. O gerador de tipos não marca as colunas que podem
 * vir nulas: sem cadastro (ou com o cadastro excluído), `member_id` vem nulo;
 * sem função, `role_id` e `role_name` vêm nulos.
 */
export type Access = Omit<MyAccessRow, "member_id" | "role_id" | "role_name"> & {
  member_id: string | null;
  role_id: string | null;
  role_name: string | null;
};

/** O acesso de quem não tem cadastro: nada liberado (RN-07). */
export const NO_ACCESS: Access = {
  member_id: null,
  role_id: null,
  role_name: null,
  role_is_protected: false,
  permissions: [],
  sees_whole_church: false,
  sees_ministry: false,
  sees_whole_church_reports: false,
  sees_ministry_reports: false,
  can_create_member: false,
  can_assign_roles: false,
  can_submit_some_report: false,
};

/**
 * A pessoa tem pelo menos uma das permissões? Sem acesso lido, `false`. As
 * permissões aposentadas (RN-22) não liberam nada, mesmo se vierem.
 */
export function hasPermission(access: Access | null | undefined, ...permissions: PermissionAction[]): boolean {
  if (!access) return false;
  return permissions.some((permission) => !isRetiredPermission(permission) && access.permissions.includes(permission));
}

// --- Menu e rotas (Navegação e rotas, RN-22, UX-08) ---

export type MenuItemKey = "dashboard" | "members" | "cells" | "reports" | "ministries" | "roles" | "events";

export interface MenuItem {
  key: MenuItemKey;
  label: string;
  path: string;
}

const SEES_PEOPLE: readonly PermissionAction[] = ["view_all_church", "view_own_ministry"];

/** O que libera cada item do menu (e a rota dele), na ordem do menu. */
const MENU_RULES: readonly (MenuItem & { anyOf: readonly PermissionAction[] })[] = [
  { key: "dashboard", label: MENU_TEXTS.dashboard, path: "/", anyOf: ["view_dashboard"] },
  { key: "members", label: MENU_TEXTS.members, path: "/members", anyOf: SEES_PEOPLE },
  { key: "cells", label: MENU_TEXTS.cells, path: "/cells", anyOf: SEES_PEOPLE },
  {
    key: "reports",
    label: MENU_TEXTS.reports,
    path: "/cell-reports",
    // Quem vê relatórios e quem pode enviar algum (PO-UX-10, P-PER-26).
    anyOf: [
      ...SEES_PEOPLE,
      "view_all_reports",
      "view_own_reports",
      "submit_own_cell_report",
      "submit_any_visible_report",
      "edit_cell",
    ],
  },
  { key: "ministries", label: MENU_TEXTS.ministries, path: "/ministries", anyOf: SEES_PEOPLE },
  { key: "roles", label: MENU_TEXTS.roles, path: "/roles", anyOf: ["view_roles", "manage_roles"] },
  { key: "events", label: MENU_TEXTS.events, path: "/events", anyOf: ["view_audit_log"] },
];

/** Os itens do menu de quem está logado, na ordem do menu. Sem acesso lido, nenhum. */
export function menuItems(access: Access | null | undefined): MenuItem[] {
  return MENU_RULES.filter((rule) => hasPermission(access, ...rule.anyOf)).map(({ key, label, path }) => ({
    key,
    label,
    path,
  }));
}

/** Sufixo das listas de excluídos do E2.01 (`/members/deleted`…). */
const DELETED_SUFFIX = "/deleted";

/** O detalhe da célula, `/cells/:id` (a lista de excluídas, `/cells/deleted`, já saiu acima). */
const CELL_DETAIL_PREFIX = "/cells/";

/** Listas que têm a sub-rota de excluídos. */
const LISTS_WITH_DELETED: readonly string[] = ["/members", "/cells", "/cell-reports"];

/**
 * A pessoa pode abrir a rota (T12)? As rotas do menu seguem o item; as listas
 * de excluídos seguem o item da lista e ainda exigem "Gerenciar Funções"
 * (E2.01). O detalhe da célula passa para quem está logado (E2.10). Uma rota
 * que o menu não governa (desconhecida) devolve `false`.
 * Aceita o endereço com busca ou barra no fim.
 */
export function canSeeRoute(access: Access | null | undefined, path: string): boolean {
  const pathname = normalizePath(path);
  if (pathname.endsWith(DELETED_SUFFIX)) {
    const listPath = pathname.slice(0, -DELETED_SUFFIX.length);
    return LISTS_WITH_DELETED.includes(listPath) && canSeeRoute(access, listPath) && hasPermission(access, "manage_roles");
  }
  // O detalhe da célula (E2.10, AQ-7): quem abre é decidido pela visibilidade da célula na
  // `cells_view` (RN-14), e não pela lista; "Célula não encontrada." para quem não a vê.
  if (pathname.startsWith(CELL_DETAIL_PREFIX)) return !!access;
  const rule = MENU_RULES.find((item) => item.path === pathname);
  return !!rule && hasPermission(access, ...rule.anyOf);
}

function normalizePath(path: string): string {
  const [pathname] = path.split(/[?#]/);
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

// --- Impressão digital (UXD-11) ---

/**
 * O que, mudando, faz a tela avisar "Seu acesso foi atualizado." e recarregar
 * as listas: as permissões, a função e "vê a igreja toda". A ordem das
 * permissões não conta.
 */
export function accessFingerprint(access: Access): string {
  const permissions = [...access.permissions].sort().join(",");
  return `${access.role_id ?? ""}|${access.sees_whole_church ? 1 : 0}|${permissions}`;
}

// --- Subtítulos das listas e cabeçalho do Dashboard (P10, T9) ---

export type ListEntity = "members" | "cells" | "cellReports";

/**
 * O alcance no subtítulo da lista (P10): "… de toda a igreja" com a
 * permissão que libera a igreja toda para a entidade, "… do seu ministério"
 * com a do ministério, e nada sem nenhuma das duas (PO-UX-13).
 */
export function listSubtitle(access: Access | null | undefined, entity: ListEntity): string | null {
  if (!access) return null;
  const texts = LIST_SUBTITLES[entity];
  const church = entity === "cellReports" ? access.sees_whole_church_reports : access.sees_whole_church;
  const ministry = entity === "cellReports" ? access.sees_ministry_reports : access.sees_ministry;
  if (church) return texts.church;
  if (ministry) return texts.ministry;
  return null;
}

export interface DashboardHeader {
  subtitle: string | null;
  /** O selo "Meu Ministério", só para quem vê só o ministério. */
  badge: string | null;
}

/** Subtítulo e selo do Dashboard (RN-22, T9, UX-12). */
export function dashboardHeader(access: Access | null | undefined): DashboardHeader {
  if (access?.sees_whole_church) return { subtitle: DASHBOARD_TEXTS.churchSubtitle, badge: null };
  if (access?.sees_ministry) return { subtitle: DASHBOARD_TEXTS.ministrySubtitle, badge: DASHBOARD_TEXTS.ministryBadge };
  return { subtitle: null, badge: null };
}

/**
 * As linhas do Dashboard sem acesso (RN-07, T9): a do Negócio e, sem cadastro
 * ou sem função, a orientação. `null` com "Visualizar Dashboard".
 */
export function dashboardDeniedLines(access: Access | null | undefined): string[] | null {
  if (hasPermission(access, "view_dashboard")) return null;
  if (!access?.member_id) return [DASHBOARD_TEXTS.noAccess, DASHBOARD_TEXTS.noMember];
  if (!access.role_id) return [DASHBOARD_TEXTS.noAccess, DASHBOARD_TEXTS.noRole];
  return [DASHBOARD_TEXTS.noAccess];
}

// --- Rodapé do menu e seletores ---

/**
 * "Meus dados" no rodapé do menu (T1, UXD-13): "edit" com "Editar Próprio
 * Cadastro" ou "Editar Membro"; "view" (só para leitura) nos demais casos;
 * `null` para quem não tem cadastro (conta X).
 */
export function ownDataMode(access: Access | null | undefined): "edit" | "view" | null {
  if (!access?.member_id) return null;
  return hasPermission(access, "edit_own_data", "edit_member") ? "edit" : "view";
}

/** O nome da própria função embaixo do nome, no menu (RN-23, UXD-14). */
export function roleDisplayName(access: Access): string {
  return access.role_name ?? MENU_TEXTS.noRole;
}

/**
 * Os seletores de pessoa de quem está logado ficam limitados ao ministério
 * (P11): a dica de alcance aparece e a busca vazia diz "do seu ministério".
 * Sem acesso lido, `false` (nada de dica antes de saber).
 */
export function peopleLimitedToMinistry(access: Access | null | undefined): boolean {
  return !!access && !access.sees_whole_church;
}

/** A busca sem resultado nos seletores de pessoa (P11, UXD-4). */
export function memberSearchEmptyLabel(access: Access | null | undefined): string {
  return peopleLimitedToMinistry(access) ? SELECT_TEXTS.noMembersInMinistry : SELECT_TEXTS.noMembers;
}
