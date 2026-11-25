// Leitura dos eventos de autenticação na Auditoria (E1.04, T2; RN-15, AQ-4).
// O banco grava em `metadata` chaves estáveis (`reason`, `identifier_type`,
// `identifier_masked`, `block_scope`, `block_minutes`); a tela só traduz o que
// vem. A identificação já chega mascarada (na inválida, só "***") e a origem
// nunca é gravada (RN-15 d).

import { IDENTIFIER_TYPE_LABELS, minutesLabel, type IdentifierType } from "@/lib/auth/session";

/** Rótulos das ações de autenticação, na ordem do filtro "Ação" (UX-15). */
export const AUTH_ACTION_LABELS = {
  login: "Login",
  login_failed: "Login (falha)",
  login_blocked: "Login (bloqueio)",
  logout: "Logout",
} as const;

export type LoginFailureReason =
  | "invalid_identifier"
  | "not_found"
  | "ambiguous"
  | "member_deleted"
  | "no_account"
  | "account_unavailable"
  | "wrong_password";

/** Motivos da falha (só para quem audita), da tabela de motivos do spec. */
export const LOGIN_FAILURE_REASON_LABELS: Record<LoginFailureReason, string> = {
  invalid_identifier: "Identificação inválida",
  not_found: "Identificação não encontrada",
  ambiguous: "Identificação ambígua",
  member_deleted: "Cadastro excluído",
  no_account: "Sem conta de acesso",
  account_unavailable: "Conta de acesso indisponível",
  wrong_password: "Senha incorreta",
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
} as const;

/** As chaves conhecidas do `metadata`; o que não tem o tipo esperado fica de fora. */
export interface AuthEventMetadata {
  reason?: LoginFailureReason;
  identifier_type?: IdentifierType;
  identifier_masked?: string;
  block_scope?: BlockScope;
  block_minutes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLoginFailureReason(value: unknown): value is LoginFailureReason {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(LOGIN_FAILURE_REASON_LABELS, value);
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
    (value.reason === undefined || isLoginFailureReason(value.reason)) &&
    (value.identifier_type === undefined || isIdentifierType(value.identifier_type)) &&
    (value.identifier_masked === undefined || typeof value.identifier_masked === "string") &&
    (value.block_scope === undefined || isBlockScope(value.block_scope)) &&
    (value.block_minutes === undefined || isPositiveInteger(value.block_minutes))
  );
}

/** As chaves conhecidas do `metadata`, cada uma só se tiver o tipo esperado. */
export function readAuthEventMetadata(value: unknown): AuthEventMetadata {
  if (!isRecord(value)) return {};
  const metadata: AuthEventMetadata = {};
  if (isLoginFailureReason(value.reason)) metadata.reason = value.reason;
  if (isIdentifierType(value.identifier_type)) metadata.identifier_type = value.identifier_type;
  if (typeof value.identifier_masked === "string" && value.identifier_masked !== "") {
    metadata.identifier_masked = value.identifier_masked;
  }
  if (isBlockScope(value.block_scope)) metadata.block_scope = value.block_scope;
  if (isPositiveInteger(value.block_minutes)) metadata.block_minutes = value.block_minutes;
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
  if (metadata.reason) return LOGIN_FAILURE_REASON_LABELS[metadata.reason];
  return event.error_reason || null;
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const present = parts.filter((part): part is string => typeof part === "string" && part !== "");
  return present.length > 0 ? present.join(" · ") : null;
}

/**
 * A segunda linha da descrição na tabela (UX-16):
 * - falha: "{Motivo} · {Cadastro}", o cadastro só quando ligado;
 * - bloqueio: "{Tipo de bloqueio} · {N} minutos · {Cadastro}", o cadastro só quando ligado;
 * - os outros eventos: nada.
 */
export function authEventSecondLine(event: AuthEventLike): string | null {
  if (!isAuthEvent(event)) return null;
  const metadata = readAuthEventMetadata(event.metadata);
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
 * "Erro" (que vira "Motivo") e o JSON de "Metadados".
 */
export function authEventDetailFields(event: AuthEventLike): AuthEventField[] {
  const metadata = readAuthEventMetadata(event.metadata);
  const candidates: Array<[AuthEventField["key"], string | null | undefined]> = [
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
