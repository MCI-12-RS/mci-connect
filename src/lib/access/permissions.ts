// Catálogo das permissões (E2.02, RN-22 e T3): o rótulo, a dica e o grupo de
// cada permissão, na ordem em que a tela de Funções as mostra. Sem React e sem
// Supabase. A tela de Funções, o menu e os testes leem daqui.

import type { Database } from "@/integrations/supabase/types";

export type PermissionAction = Database["public"]["Enums"]["permission_action"];

/**
 * Permissões que saíram da tela e não liberam mais nada (RN-22): nenhuma
 * função as tem depois da migration 1 do E2.02.
 */
export const RETIRED_PERMISSIONS = ["view_members", "view_own_ministry_dashboard"] as const satisfies readonly PermissionAction[];

export type RetiredPermission = (typeof RETIRED_PERMISSIONS)[number];
export type ActivePermission = Exclude<PermissionAction, RetiredPermission>;

const RETIRED: ReadonlySet<string> = new Set(RETIRED_PERMISSIONS);

/** A permissão foi aposentada (RN-22)? */
export function isRetiredPermission(permission: string): permission is RetiredPermission {
  return RETIRED.has(permission);
}

interface PermissionText {
  label: string;
  /** Dica embaixo do rótulo (P14). `null` quando o rótulo basta. */
  hint: string | null;
}

/**
 * Rótulo e dica de cada permissão (tabela "Rótulos e descrições" do Negócio e
 * "Dicas das permissões" da UX). O `satisfies` faz a compilação falhar quando
 * o banco ganhar uma permissão sem rótulo aqui.
 */
const PERMISSION_TEXTS = {
  view_all_church: { label: "Visualizar Toda a Igreja", hint: "Todos os membros, células e relatórios." },
  view_own_ministry: {
    label: "Visualizar Seu Ministério",
    hint: "A pessoa, o cônjuge, o casal G12 e os discípulos de todos eles, com as células e os relatórios.",
  },
  view_sensitive_data: { label: "Ver Dados Sensíveis", hint: "CPF, e-mail, telefones e endereço das pessoas que ela vê." },
  view_dashboard: { label: "Visualizar Dashboard", hint: "Os números do que a pessoa vê." },
  create_member: { label: "Criar Membro", hint: null },
  edit_member: { label: "Editar Membro", hint: null },
  delete_member: { label: "Excluir Membro", hint: null },
  edit_own_data: {
    label: "Editar Próprio Cadastro",
    hint: "Só os dados pessoais. Líder, cônjuge, batismo, situação e função ficam de fora.",
  },
  change_member_password: {
    label: "Redefinir Senha de Membros",
    hint: "Gera uma senha temporária para os membros que a pessoa vê, só de funções com permissões que ela também tem. O membro cria uma nova senha no próximo acesso.",
  },
  create_cell: { label: "Criar Célula", hint: null },
  edit_cell: { label: "Editar Célula", hint: "Também envia o relatório das células que a pessoa vê." },
  delete_cell: { label: "Excluir Célula", hint: null },
  view_all_reports: {
    label: "Visualizar Relatórios de Toda a Igreja",
    hint: "Só os relatórios. Não abre Membros nem Células.",
  },
  view_own_reports: {
    label: "Visualizar Relatórios do Seu Ministério",
    hint: "Só os relatórios. Não abre Membros nem Células.",
  },
  export_cell_reports: {
    label: "Exportar Relatórios de Células",
    hint: "Baixa a planilha dos relatórios, com as células sem relatório, só do que a pessoa vê.",
  },
  submit_own_cell_report: {
    label: "Enviar Relatório das Próprias Células",
    hint: "Células em que a pessoa é líder, timóteo ou anfitrião.",
  },
  submit_any_visible_report: { label: "Enviar Relatório de Qualquer Célula Visível", hint: null },
  edit_cell_report: { label: "Editar Relatórios de Células", hint: null },
  delete_cell_report: { label: "Excluir Relatórios de Células", hint: null },
  view_roles: { label: "Visualizar Funções", hint: null },
  manage_roles: { label: "Gerenciar Funções", hint: "Também vê e restaura o que foi excluído." },
  assign_role: { label: "Atribuir Função aos Membros", hint: "Só funções com permissões que a pessoa também tem." },
  view_audit_log: {
    label: "Visualizar Auditoria",
    hint: "As alterações feitas em toda a igreja, sem limite de ministério.",
  },
  // Aposentadas (RN-22): não aparecem na tela. O rótulo antigo fica só para referência.
  view_members: { label: "Visualizar Membros (legado)", hint: null },
  view_own_ministry_dashboard: { label: "Visualizar Dashboard do seu ministério", hint: null },
} as const satisfies Record<PermissionAction, PermissionText>;

/** Os grupos da tela de Funções (UXD-7 e P14), nesta ordem, com as permissões de cada um, também na ordem da T3. */
export const PERMISSION_GROUPS = [
  {
    id: "visibility",
    label: "O que a pessoa vê",
    permissions: ["view_all_church", "view_own_ministry", "view_sensitive_data", "view_dashboard"],
  },
  {
    id: "members",
    label: "Membros",
    permissions: ["create_member", "edit_member", "delete_member", "edit_own_data", "change_member_password"],
  },
  {
    id: "cells",
    label: "Células",
    permissions: ["create_cell", "edit_cell", "delete_cell"],
  },
  {
    id: "reports",
    label: "Relatórios",
    permissions: [
      "view_all_reports",
      "view_own_reports",
      "export_cell_reports",
      "submit_own_cell_report",
      "submit_any_visible_report",
      "edit_cell_report",
      "delete_cell_report",
    ],
  },
  {
    id: "roles_audit",
    label: "Funções e auditoria",
    permissions: ["view_roles", "manage_roles", "assign_role", "view_audit_log"],
  },
] as const satisfies readonly { id: string; label: string; permissions: readonly ActivePermission[] }[];

export type PermissionGroupId = (typeof PERMISSION_GROUPS)[number]["id"];

export interface PermissionInfo {
  value: ActivePermission;
  label: string;
  hint: string | null;
  group: PermissionGroupId;
}

/** As permissões que aparecem na tela de Funções, na ordem dos grupos (UX-01). */
export const PERMISSION_CATALOG: readonly PermissionInfo[] = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((value) => ({ value, group: group.id, ...PERMISSION_TEXTS[value] })),
);

/** O rótulo de uma permissão, para a tela. Nunca devolve o identificador técnico (UX-30). */
export function permissionLabel(permission: PermissionAction): string {
  return PERMISSION_TEXTS[permission].label;
}

/**
 * O rótulo de uma permissão gravada como texto (os eventos de função da Auditoria, E2.05 RN-15);
 * `null` para um valor que não é uma permissão, para a tela nunca mostrar o identificador.
 */
export function permissionLabelOf(value: string): string | null {
  return isPermissionAction(value) ? PERMISSION_TEXTS[value].label : null;
}

function isPermissionAction(value: string): value is PermissionAction {
  return Object.prototype.hasOwnProperty.call(PERMISSION_TEXTS, value);
}
