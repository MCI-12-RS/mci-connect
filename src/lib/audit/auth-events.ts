// Leitura dos eventos de autenticação na Auditoria (E1.04, T2; RN-15, AQ-4) e
// dos eventos de senha (E2.03, T8; RN-17, AQ-7). O banco grava em `metadata`
// chaves estáveis (`reason`, `identifier_type`, `identifier_masked`,
// `block_scope`, `block_minutes`, `change_type`, `valid_until`); a tela só
// traduz o que vem. A identificação já chega mascarada (na inválida, só
// "***"), e a origem e a senha nunca são gravadas (RN-15 d, RN-17).

import { IDENTIFIER_TYPE_LABELS, minutesLabel, type IdentifierType } from "@/lib/auth/session";
import { formatValidUntil } from "@/lib/auth/temporary-password";

/** Rótulos das ações de autenticação e de senha, na ordem do filtro "Ação" (UX-15 do E1.04, UX-33 do E2.03). */
export const AUTH_ACTION_LABELS = {
  login: "Login",
  login_failed: "Login (falha)",
  login_blocked: "Login (bloqueio)",
  logout: "Logout",
  password_reset: "Senha redefinida",
  password_reset_refused: "Senha redefinida (recusa)",
  password_changed: "Senha alterada",
  password_change_failed: "Senha alterada (falha)",
  password_change_blocked: "Senha alterada (bloqueio)",
  password_change_required: "Troca de senha exigida",
} as const;

/** As ações de senha (E2.03), com o painel próprio (T8). */
const PASSWORD_ACTIONS: ReadonlySet<string> = new Set([
  "password_reset",
  "password_reset_refused",
  "password_changed",
  "password_change_failed",
  "password_change_blocked",
  "password_change_required",
]);

/** Os motivos dos eventos de senha (E2.03, "Auditoria: motivos"). */
export type PasswordEventReason =
  | "no_permission"
  | "rate_limited"
  | "out_of_scope"
  | "self"
  | "role_not_covered"
  | "current_password_invalid"
  | "weak_password"
  | "initial_password";

export type LoginFailureReason =
  | "invalid_identifier"
  | "not_found"
  | "ambiguous"
  | "member_deleted"
  | "no_account"
  | "account_unavailable"
  | "wrong_password"
  | "temp_password_expired";

/** Motivos da falha (só para quem audita), da tabela de motivos do spec. */
export const LOGIN_FAILURE_REASON_LABELS: Record<LoginFailureReason, string> = {
  invalid_identifier: "Identificação inválida",
  not_found: "Identificação não encontrada",
  ambiguous: "Identificação ambígua",
  member_deleted: "Cadastro excluído",
  no_account: "Sem conta de acesso",
  account_unavailable: "Conta de acesso indisponível",
  wrong_password: "Senha incorreta",
  temp_password_expired: "Senha temporária vencida",
};

/** Os motivos das recusas, das falhas e da marca de troca (E2.03). Cadastro excluído e sem conta vêm da tabela do login. */
export const PASSWORD_EVENT_REASON_LABELS: Record<PasswordEventReason, string> = {
  no_permission: "Sem permissão",
  rate_limited: "Limite de redefinições",
  out_of_scope: "Fora do que a pessoa vê",
  self: "Própria senha",
  role_not_covered: "Função não coberta",
  current_password_invalid: "Senha atual incorreta",
  weak_password: "Senha fora das regras",
  initial_password: "Senha inicial",
};

export type AuthEventReason = LoginFailureReason | PasswordEventReason;

const REASON_LABELS: Record<AuthEventReason, string> = { ...LOGIN_FAILURE_REASON_LABELS, ...PASSWORD_EVENT_REASON_LABELS };

export type ChangeType = "forced" | "voluntary";

/** O tipo de troca (Negócio, "Auditoria: campos"). */
export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  forced: "Obrigatória",
  voluntary: "Voluntária",
};

export type BlockScope = "identifier" | "origin";

export const BLOCK_SCOPE_LABELS: Record<BlockScope, string> = {
  identifier: "Por identificação",
  origin: "Por origem",
};

/** Nomes dos campos do painel de detalhes de um evento de autenticação (UXD-8). */
export const AUTH_EVENT_FIELD_LABELS = {
  member: "Cadastro",
  reason: "Motivo",
  identifierType: "Tipo de identificação",
  identifier: "Identificação",
  blockScope: "Tipo de bloqueio",
  duration: "Duração",
  changeType: "Tipo de troca",
  validUntil: "Validade",
} as const;

/** As chaves conhecidas do `metadata`; o que não tem o tipo esperado fica de fora. */
export interface AuthEventMetadata {
  reason?: AuthEventReason;
  identifier_type?: IdentifierType;
  identifier_masked?: string;
  block_scope?: BlockScope;
  block_minutes?: number;
  change_type?: ChangeType;
  /** A validade da senha temporária, em UTC. */
  valid_until?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAuthEventReason(value: unknown): value is AuthEventReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REASON_LABELS, value);
}

function isChangeType(value: unknown): value is ChangeType {
  return value === "forced" || value === "voluntary";
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && value !== "" && !Number.isNaN(new Date(value).getTime());
}

function isIdentifierType(value: unknown): value is IdentifierType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(IDENTIFIER_TYPE_LABELS, value);
}

function isBlockScope(value: unknown): value is BlockScope {
  return value === "identifier" || value === "origin";
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** O `metadata` tem só chaves conhecidas com valores do tipo esperado? */
export function isAuthEventMetadata(value: unknown): value is AuthEventMetadata {
  if (!isRecord(value)) return false;
  return (
    (value.reason === undefined || isAuthEventReason(value.reason)) &&
    (value.identifier_type === undefined || isIdentifierType(value.identifier_type)) &&
    (value.identifier_masked === undefined || typeof value.identifier_masked === "string") &&
    (value.block_scope === undefined || isBlockScope(value.block_scope)) &&
    (value.block_minutes === undefined || isPositiveInteger(value.block_minutes)) &&
    (value.change_type === undefined || isChangeType(value.change_type)) &&
    (value.valid_until === undefined || isInstant(value.valid_until))
  );
}

/** As chaves conhecidas do `metadata`, cada uma só se tiver o tipo esperado. */
export function readAuthEventMetadata(value: unknown): AuthEventMetadata {
  if (!isRecord(value)) return {};
  const metadata: AuthEventMetadata = {};
  if (isAuthEventReason(value.reason)) metadata.reason = value.reason;
  if (isIdentifierType(value.identifier_type)) metadata.identifier_type = value.identifier_type;
  if (typeof value.identifier_masked === "string" && value.identifier_masked !== "") {
    metadata.identifier_masked = value.identifier_masked;
  }
  if (isBlockScope(value.block_scope)) metadata.block_scope = value.block_scope;
  if (isPositiveInteger(value.block_minutes)) metadata.block_minutes = value.block_minutes;
  if (isChangeType(value.change_type)) metadata.change_type = value.change_type;
  if (isInstant(value.valid_until)) metadata.valid_until = value.valid_until;
  return metadata;
}

/** O que a tela lê de um evento para montar a segunda linha e o painel. */
export interface AuthEventLike {
  action: string;
  entity: string;
  entity_label: string | null;
  error_reason: string | null;
  metadata: unknown;
}

export function isAuthEvent(event: Pick<AuthEventLike, "entity">): boolean {
  return event.entity === "auth";
}

function failureReasonLabel(event: AuthEventLike, metadata: AuthEventMetadata): string | null {
  if (metadata.reason) return REASON_LABELS[metadata.reason];
  return event.error_reason || null;
}

/** "válida até 30/11/2026 às 21:50" (segunda linha da senha redefinida, T8). */
function validUntilLine(metadata: AuthEventMetadata): string | null {
  return metadata.valid_until ? `válida até ${formatValidUntil(metadata.valid_until)}` : null;
}

/** A segunda linha dos eventos de senha (T8); `null` para os outros. */
function passwordEventSecondLine(event: AuthEventLike, metadata: AuthEventMetadata): string | null {
  switch (event.action) {
    case "password_reset":
      return joinParts([event.entity_label, validUntilLine(metadata)]);
    case "password_reset_refused":
    case "password_change_required":
      return joinParts([failureReasonLabel(event, metadata), event.entity_label]);
    case "password_changed":
      return joinParts([metadata.change_type ? CHANGE_TYPE_LABELS[metadata.change_type] : null]);
    case "password_change_failed":
      return joinParts([failureReasonLabel(event, metadata)]);
    case "password_change_blocked":
      return joinParts([metadata.block_minutes ? minutesLabel(metadata.block_minutes) : null]);
    default:
      return null;
  }
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => typeof part === "string" && part !== "");
  return present.length > 0 ? present.join(" · ") : null;
}

/**
 * A segunda linha da descrição na tabela (UX-16):
 * - falha: "{Motivo} · {Cadastro}", o cadastro só quando ligado;
 * - bloqueio: "{Tipo de bloqueio} · {N} minutos · {Cadastro}", o cadastro só quando ligado;
 * - os eventos de senha (E2.03, T8): o cadastro, a validade, o motivo, o tipo de troca ou a duração;
 * - os outros eventos: nada.
 */
export function authEventSecondLine(event: AuthEventLike): string | null {
  if (!isAuthEvent(event)) return null;
  const metadata = readAuthEventMetadata(event.metadata);
  if (PASSWORD_ACTIONS.has(event.action)) return passwordEventSecondLine(event, metadata);
  if (event.action === "login_failed") {
    return joinParts([failureReasonLabel(event, metadata), event.entity_label]);
  }
  if (event.action === "login_blocked") {
    return joinParts([
      metadata.block_scope ? BLOCK_SCOPE_LABELS[metadata.block_scope] : null,
      metadata.block_minutes ? minutesLabel(metadata.block_minutes) : null,
      event.entity_label,
    ]);
  }
  return null;
}

export interface AuthEventField {
  key: keyof typeof AUTH_EVENT_FIELD_LABELS;
  label: string;
  value: string;
}

/**
 * Os campos do painel de um evento de autenticação (UX-17), só os que têm
 * valor. Substituem o "Identificação" (`entity_label`, que vira "Cadastro"), o
 * "Erro" (que vira "Motivo") e o JSON de "Metadados". Nos eventos de senha
 * (E2.03, UX-34): Cadastro, Motivo, Tipo de troca, Validade e Duração.
 */
export function authEventDetailFields(event: AuthEventLike): AuthEventField[] {
  const metadata = readAuthEventMetadata(event.metadata);
  const candidates: Array<[AuthEventField["key"], string | null | undefined]> = PASSWORD_ACTIONS.has(event.action)
    ? [
        ["member", event.entity_label],
        ["reason", failureReasonLabel(event, metadata)],
        ["changeType", metadata.change_type ? CHANGE_TYPE_LABELS[metadata.change_type] : null],
        ["validUntil", metadata.valid_until ? formatValidUntil(metadata.valid_until) : null],
        ["duration", metadata.block_minutes ? minutesLabel(metadata.block_minutes) : null],
      ]
    : [
        ["blockScope", metadata.block_scope ? BLOCK_SCOPE_LABELS[metadata.block_scope] : null],
        ["duration", metadata.block_minutes ? minutesLabel(metadata.block_minutes) : null],
        ["reason", failureReasonLabel(event, metadata)],
        ["member", event.entity_label],
        ["identifierType", metadata.identifier_type ? IDENTIFIER_TYPE_LABELS[metadata.identifier_type] : null],
        ["identifier", metadata.identifier_masked],
      ];
  return candidates.flatMap(([key, value]) =>
    typeof value === "string" && value !== "" ? [{ key, label: AUTH_EVENT_FIELD_LABELS[key], value }] : [],
  );
}
