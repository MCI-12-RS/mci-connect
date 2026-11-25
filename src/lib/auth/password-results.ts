// Leitura das respostas da troca e da redefinição de senha (E2.03,
// "Contratos"; AQ-1 e AQ-4). Qualquer resposta fora do contrato vira
// `server_error`: a tela mostra a mensagem de conexão, e nada do que o
// servidor mandou é exibido como veio.

import { isJsonObject } from "@/lib/errors";
import type { PasswordChangeCode, PasswordChangeField } from "@/lib/auth/password-policy";
import type { ResetRefusalCode } from "@/lib/auth/password-texts";

/** A resposta da `change-own-password`, já tipada. */
export type ChangePasswordResult =
  | { result: "ok"; replayed: boolean }
  | { result: "empty_fields" }
  | { result: "invalid"; code: PasswordChangeCode }
  | { result: "session_ended" }
  | { result: "not_flagged" }
  | { result: "forbidden" }
  | { result: "current_password_invalid" }
  | { result: "change_blocked"; minutes: number }
  | { result: "server_error" };

export const CHANGE_SERVER_ERROR: ChangePasswordResult = { result: "server_error" };

const NEW_PASSWORD_CODES: ReadonlySet<string> = new Set([
  "password_too_short",
  "password_too_long",
  "password_weak",
  "password_personal_data",
  "password_same_as_current",
]);

function isNewPasswordCode(value: unknown): value is Exclude<PasswordChangeCode, "password_mismatch"> {
  return typeof value === "string" && NEW_PASSWORD_CODES.has(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** Em que campo vai a mensagem de cada código (AQ-4). */
export function fieldForCode(code: PasswordChangeCode | "current_password_invalid"): PasswordChangeField {
  if (code === "current_password_invalid") return "current_password";
  if (code === "password_mismatch") return "confirmation";
  return "new_password";
}

/**
 * A resposta tipada a partir do status HTTP e do corpo (já lido como JSON, ou
 * `null`). O status e o `result` precisam bater, como no contrato.
 */
export function parseChangePasswordResponse(status: number, body: unknown): ChangePasswordResult {
  if (!isJsonObject(body)) return CHANGE_SERVER_ERROR;
  const { result } = body;
  switch (status) {
    case 200:
      return result === "ok" ? { result: "ok", replayed: body.replayed === true } : CHANGE_SERVER_ERROR;
    case 400:
      if (result === "empty_fields") return { result: "empty_fields" };
      if (result !== "invalid") return CHANGE_SERVER_ERROR;
      if (body.code === "password_mismatch" && body.field === "confirmation") {
        return { result: "invalid", code: "password_mismatch" };
      }
      return isNewPasswordCode(body.code) && body.field === "new_password"
        ? { result: "invalid", code: body.code }
        : CHANGE_SERVER_ERROR;
    case 401:
      return result === "session_ended" ? { result: "session_ended" } : CHANGE_SERVER_ERROR;
    case 403:
      if (result === "not_flagged") return { result: "not_flagged" };
      return result === "forbidden" ? { result: "forbidden" } : CHANGE_SERVER_ERROR;
    case 422:
      return result === "current_password_invalid" ? { result: "current_password_invalid" } : CHANGE_SERVER_ERROR;
    case 429:
      return result === "change_blocked" && isPositiveInteger(body.retry_after_minutes)
        ? { result: "change_blocked", minutes: body.retry_after_minutes }
        : CHANGE_SERVER_ERROR;
    default:
      return CHANGE_SERVER_ERROR;
  }
}

/** A resposta da `reset_member_password`, já tipada. A senha só existe no `ok`. */
export type ResetResult =
  | { result: "ok"; password: string; expiresAt: string; resetAt: string }
  | { result: "refused"; code: ResetRefusalCode; minutes?: number }
  | { result: "server_error" };

export const RESET_SERVER_ERROR: ResetResult = { result: "server_error" };

const RESET_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "no_permission",
  "rate_limited",
  "not_found",
  "self",
  "role_not_covered",
  "no_account",
]);

function isResetRefusalCode(value: unknown): value is ResetRefusalCode {
  return typeof value === "string" && RESET_REFUSAL_CODES.has(value);
}

function isInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

/** A senha temporária: 8 caracteres do alfabeto da RN-03. */
const TEMPORARY_PASSWORD = /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;

/** O `data` da RPC (`jsonb`), tipado. Fora do contrato, `server_error`. */
export function parseResetResult(data: unknown): ResetResult {
  if (!isJsonObject(data)) return RESET_SERVER_ERROR;
  if (data.result === "ok") {
    const { password, expires_at: expiresAt, reset_at: resetAt } = data;
    return typeof password === "string" && TEMPORARY_PASSWORD.test(password) && isInstant(expiresAt) && isInstant(resetAt)
      ? { result: "ok", password, expiresAt, resetAt }
      : RESET_SERVER_ERROR;
  }
  if (data.result === "refused" && isResetRefusalCode(data.code)) {
    if (data.code !== "rate_limited") return { result: "refused", code: data.code };
    return { result: "refused", code: "rate_limited", minutes: isPositiveInteger(data.retry_after_minutes) ? data.retry_after_minutes : 1 };
  }
  return RESET_SERVER_ERROR;
}
