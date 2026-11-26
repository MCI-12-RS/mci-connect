// Regras puras da tela de Funções (E2.02, T2 a T4; RN-17, RN-19, RN-20 e
// RN-22): a linha da `roles_view` pronta para a tela, a ordem da lista, as
// contagens, o bloqueio antecipado da exclusão, o aviso de troca da função
// padrão e o que vai para a `save_role`. Sem React e sem Supabase.

import type { Database } from "@/integrations/supabase/types";
import {
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  type ActivePermission,
  type PermissionGroupId,
  type PermissionInfo,
} from "@/lib/access/permissions";
import { ROLE_TEXTS, RULE_TEXTS } from "@/lib/access/texts";
import { gateCode, isNetworkError, isPermissionDenied, parseAppError } from "@/lib/errors";

export type RoleViewRow = Database["public"]["Views"]["roles_view"]["Row"];

/** Uma função, como a tela a mostra. */
export interface Role {
  id: string;
  name: string;
  description: string | null;
  /** A Administrador (RN-17): só para leitura, sem ações (P12). */
  isProtected: boolean;
  isDefault: boolean;
  /** As permissões efetivas que aparecem na tela, na ordem dos grupos da T3. */
  permissions: ActivePermission[];
  /** Membros não excluídos com a função (AQ-2). `null` sem o dado. */
  membersCount: number | null;
  /** O `updated_at` lido, que volta na gravação (`_expected_updated_at`). */
  updatedAt: string | null;
}

const CATALOG_ORDER: ReadonlyMap<string, number> = new Map(PERMISSION_CATALOG.map((p, index) => [p.value, index]));
const CATALOG_BY_VALUE: ReadonlyMap<string, PermissionInfo> = new Map(PERMISSION_CATALOG.map((p) => [p.value, p]));

function isActivePermission(permission: string): permission is ActivePermission {
  return CATALOG_ORDER.has(permission);
}

/**
 * As permissões que a tela mostra, sem repetição, na ordem dos grupos da T3
 * (UX-01). As aposentadas e as desconhecidas ficam de fora: a tela nunca
 * mostra um identificador técnico (UX-30).
 */
export function orderPermissions(permissions: readonly string[] | null | undefined): ActivePermission[] {
  const unique = new Set((permissions ?? []).filter(isActivePermission));
  return [...unique].sort((a, b) => (CATALOG_ORDER.get(a) ?? 0) - (CATALOG_ORDER.get(b) ?? 0));
}

/** A linha da `roles_view` pronta para a tela. `null` se faltar o id ou o nome. */
export function toRole(row: RoleViewRow): Role | null {
  if (!row.id || !row.name) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description?.trim() ? row.description : null,
    isProtected: row.is_protected === true,
    isDefault: row.is_default === true,
    permissions: orderPermissions(row.permissions),
    membersCount: typeof row.members_count === "number" ? row.members_count : null,
    updatedAt: row.updated_at,
  };
}

const PT_BR = new Intl.Collator("pt-BR");

/** Ordem da lista (T2): a Administrador primeiro e depois as demais, em ordem alfabética. */
export function sortRoles(roles: readonly Role[]): Role[] {
  return [...roles].sort((a, b) => Number(b.isProtected) - Number(a.isProtected) || PT_BR.compare(a.name, b.name));
}

/** As linhas da `roles_view`, prontas e na ordem da lista. */
export function rolesFromView(rows: readonly RoleViewRow[]): Role[] {
  return sortRoles(rows.map(toRole).filter((role): role is Role => role !== null));
}

/**
 * A linha de contagens da função (T2): "12 permissões · 6 membros". Sem a
 * contagem de membros, só as permissões. A Administrador não mostra
 * permissões (a frase do Negócio fica no lugar), só os membros.
 */
export function roleCountsLine(role: Role): string {
  const members = role.membersCount === null ? null : ROLE_TEXTS.memberCount(role.membersCount);
  if (role.isProtected) return members ?? "";
  const permissions = ROLE_TEXTS.permissionCount(role.permissions.length);
  return members ? `${permissions} · ${members}` : permissions;
}

/** Um grupo de permissões marcadas, para "Ver permissões" (T2). */
export interface RolePermissionGroup {
  id: PermissionGroupId;
  label: string;
  permissions: PermissionInfo[];
}

/** As permissões da função nos grupos da T3, sem os grupos vazios. */
export function groupRolePermissions(permissions: readonly ActivePermission[]): RolePermissionGroup[] {
  const marked = new Set<string>(permissions);
  return PERMISSION_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    permissions: group.permissions.filter((p) => marked.has(p)).flatMap((p) => CATALOG_BY_VALUE.get(p) ?? []),
  })).filter((group) => group.permissions.length > 0);
}

/**
 * Bloqueio da exclusão que a lista já conhece (T4, UXD-2 e AQ-2), sem chamar
 * o servidor: a mensagem do Negócio, ou `null` quando a exclusão segue para a
 * confirmação.
 * - Administrador: a ação não existe na tela; a mensagem é a do servidor (RN-17);
 * - função padrão (RN-19);
 * - em uso por membros não excluídos, com quantos (RN-20).
 */
export function deleteBlockMessage(role: Role): string | null {
  if (role.isProtected) return RULE_TEXTS.adminRoleProtected.delete;
  if (role.isDefault) return RULE_TEXTS.roleIsDefault;
  if (role.membersCount !== null && role.membersCount > 0) return RULE_TEXTS.roleInUse(role.membersCount);
  return null;
}

/** O que a confirmação de exclusão diz (T4). Sem a contagem, não afirma que ninguém usa a função. */
export function deleteConsequences(role: Role): string[] {
  return role.membersCount === 0
    ? [ROLE_TEXTS.deleteNoMembers, ROLE_TEXTS.deleteIrreversible]
    : [ROLE_TEXTS.deleteIrreversible];
}

/** A função padrão da lista, se houver. */
export function findDefaultRole(roles: readonly Role[]): Role | null {
  return roles.find((role) => role.isDefault) ?? null;
}

/**
 * O aviso de troca da função padrão (T3, UXD-8, UX-07): aparece ao ligar
 * "Função padrão" numa função que não era a padrão, e diz qual deixa de ser.
 * `null` quando não há troca ou quando a lista não diz qual é a padrão.
 */
export function defaultSwitchWarning(
  editing: Role | null,
  wantsDefault: boolean,
  roles: readonly Role[],
): string | null {
  if (!wantsDefault || editing?.isDefault) return null;
  const current = findDefaultRole(roles);
  if (!current || current.id === editing?.id) return null;
  return ROLE_TEXTS.defaultSwitchWarning(current.name);
}

/** Os campos do formulário de função (T3). */
export interface RoleFormValues {
  name: string;
  description: string;
  permissions: ActivePermission[];
  isDefault: boolean;
}

/** Os valores iniciais do formulário: os da função, ou vazios na nova. */
export function initialRoleFormValues(role: Role | null): RoleFormValues {
  return {
    name: role?.name ?? "",
    description: role?.description ?? "",
    permissions: role ? [...role.permissions] : [],
    isDefault: role?.isDefault ?? false,
  };
}

/** Marca ou desmarca uma permissão, mantendo a ordem dos grupos. */
export function togglePermission(
  permissions: readonly ActivePermission[],
  permission: ActivePermission,
  checked: boolean,
): ActivePermission[] {
  const others = permissions.filter((p) => p !== permission);
  return orderPermissions(checked ? [...others, permission] : others);
}

function samePermissions(a: readonly ActivePermission[], b: readonly ActivePermission[]): boolean {
  const left = orderPermissions(a);
  const right = orderPermissions(b);
  return left.length === right.length && left.every((p, index) => p === right[index]);
}

/** O formulário tem alterações? ("Descartar as alterações?", T3.) */
export function isRoleFormDirty(initial: RoleFormValues, current: RoleFormValues): boolean {
  return (
    initial.name !== current.name ||
    initial.description !== current.description ||
    initial.isDefault !== current.isDefault ||
    !samePermissions(initial.permissions, current.permissions)
  );
}

/** O erro do nome antes de enviar (T3): "Informe o nome da função.", ou `null`. */
export function roleNameError(name: string): string | null {
  return name.trim() ? null : ROLE_TEXTS.nameRequired;
}

export type SaveRoleArgs = Database["public"]["Functions"]["save_role"]["Args"];

/**
 * Os argumentos da `save_role` (RN-19, AQ-2): uma chamada só grava nome,
 * descrição, permissões e a troca da padrão. Na edição, leva o `updated_at`
 * lido, para a recusa `role_changed` quando a função mudou em outra tela.
 */
export function buildSaveRoleArgs(role: Role | null, values: RoleFormValues): SaveRoleArgs {
  const description = values.description.trim();
  return {
    _role_id: role?.id ?? null,
    _name: values.name.trim(),
    _description: description || null,
    _permissions: orderPermissions(values.permissions),
    _is_default: values.isDefault,
    _expected_updated_at: role?.updatedAt ?? null,
  };
}

/** O toast do sucesso (T2, "Estados"): criada, atualizada, ou criada/atualizada e agora a padrão. */
export function saveSuccessText(role: Role | null, values: RoleFormValues): string {
  if (!role) return values.isDefault ? ROLE_TEXTS.createdAsDefault(values.name.trim()) : ROLE_TEXTS.created;
  if (values.isDefault && !role.isDefault) return ROLE_TEXTS.updatedAsDefault(values.name.trim());
  return ROLE_TEXTS.updated;
}

/** Recusas da `save_role` e da `delete_role` que dizem que a função mudou ou sumiu em outra tela. */
const ROLE_GONE_CODES: ReadonlySet<string> = new Set(["role_changed", "role_not_found"]);

/** Recusas que a tela mostra embaixo do campo Nome (T3). */
const NAME_FIELD_CODES: ReadonlySet<string> = new Set(["role_name_required", "role_name_taken"]);

/** A recusa da RN-17 (Administrador): só vem do servidor, num toast de erro (T4). */
const ADMIN_PROTECTED_CODE = "admin_role_protected";

/** O que a tela faz com a falha de uma gravação de função (`save_role` ou `delete_role`). */
export type RoleWriteFailure =
  /** Portão da senha (E2.03, AQ-3): o `MutationCache` já o avisou; o diálogo fecha sem toast. */
  | { kind: "gate" }
  /** 42501: o toast "Você não tem permissão para esta ação." e o diálogo fecha (UX-30). */
  | { kind: "forbidden" }
  /** A função mudou ou sumiu em outra tela: toast informativo, o diálogo fecha e a lista recarrega ("Estados"). */
  | { kind: "gone"; message: string }
  /** Administrador (RN-17): toast de erro e o diálogo fecha (T4). */
  | { kind: "protected"; message: string }
  /** Recusa do campo Nome (T3). */
  | { kind: "name"; message: string }
  /** Outra recusa de regra: no formulário, o `Alert` do topo; na exclusão, o bloqueio (T4). */
  | { kind: "refused"; message: string }
  /** Queda de conexão: o diálogo continua aberto, com o aviso de conexão. */
  | { kind: "network" }
  /** Falha técnica: o diálogo continua aberto e pede para tentar de novo. */
  | { kind: "unexpected" };

/** Classifica o erro de `save_role` ou `delete_role` para a tela. */
export function classifyRoleWriteError(error: unknown): RoleWriteFailure {
  // O portão também vem com 42501: vai antes da recusa de permissão.
  if (gateCode(error)) return { kind: "gate" };
  if (isPermissionDenied(error)) return { kind: "forbidden" };
  const refusal = parseAppError(error);
  if (refusal) {
    const { code, message } = refusal;
    if (ROLE_GONE_CODES.has(code)) return { kind: "gone", message };
    if (code === ADMIN_PROTECTED_CODE) return { kind: "protected", message };
    if (NAME_FIELD_CODES.has(code)) return { kind: "name", message };
    return { kind: "refused", message };
  }
  if (isNetworkError(error)) return { kind: "network" };
  return { kind: "unexpected" };
}
