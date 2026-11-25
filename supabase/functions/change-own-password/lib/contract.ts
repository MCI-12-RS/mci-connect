// Contrato HTTP da função `change-own-password` (E2.03: "Trocas", "Contratos",
// AQ-4, AQ-5, DA-13, DA-14).
//
// Módulo puro (sem Deno nem import remoto), testado pelo Vitest: leitura do
// corpo, leitura do token já validado, conferência do retorno da RPC
// `change_own_password` e tradução para HTTP. O transporte é o de
// `_shared/http.ts`.
//
// Respostas (sempre com `result` e `Cache-Control: no-store`):
//   200 { result: 'ok', replayed?: true }                       RN-10, RN-11; reenvio (DA-13)
//   400 { result: 'empty_fields' }                              campo vazio ou corpo malformado
//   400 { result: 'invalid', code, field: 'new_password' }      RN-13
//   400 { result: 'invalid', code: 'password_mismatch', field: 'confirmation' }
//   401 { result: 'session_ended' }                             RN-16
//   403 { result: 'not_flagged' }                               RN-10 (DA-14)
//   403 { result: 'forbidden' }                                 conta sem cadastro ou cadastro excluído
//   422 { result: 'current_password_invalid' }                  RN-11
//   429 { result: 'change_blocked', retry_after_minutes } + Retry-After (segundos)   RN-12
//   500 { result: 'server_error' }                              banco, contagem ou origem
//   405, 413 { result: 'server_error' }                         método errado ou corpo acima de 4 KB
import { isRecord, jsonReply } from '../../_shared/http.ts'

export type ChangeMode = 'forced' | 'voluntary'

/** Códigos da senha nova (RN-13 e a regra h). */
export const NEW_PASSWORD_CODES: readonly string[] = [
  'password_too_short',
  'password_too_long',
  'password_weak',
  'password_personal_data',
  'password_same_as_current',
]

export type InvalidBody =
  | { result: 'invalid'; code: string; field: 'new_password' }
  | { result: 'invalid'; code: 'password_mismatch'; field: 'confirmation' }

export type ChangeResponseBody =
  | { result: 'ok'; replayed?: true }
  | { result: 'empty_fields' }
  | InvalidBody
  | { result: 'session_ended' }
  | { result: 'not_flagged' }
  | { result: 'forbidden' }
  | { result: 'current_password_invalid' }
  | { result: 'change_blocked'; retry_after_minutes: number }
  | { result: 'server_error' }

/** O `jsonb` da RPC `change_own_password`. */
export type ChangeResult =
  | { result: 'ok'; replayed?: true }
  | { result: 'empty_fields' }
  | InvalidBody
  | { result: 'session_ended' }
  | { result: 'not_flagged' }
  | { result: 'forbidden' }
  | { result: 'current_password_invalid' }
  | { result: 'change_blocked'; retry_after_seconds: number; retry_after_minutes: number }

/** O pedido já conferido, nos nomes dos parâmetros da RPC. */
export interface ChangeRequest {
  mode: ChangeMode
  /** Só no modo voluntário; no obrigatório, sempre null (P-SEN-10). */
  currentPassword: string | null
  newPassword: string
  confirmation: string
  requestId: string
}

// UUID em qualquer versão (o `crypto.randomUUID` da tela gera v4).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1

/**
 * Corpo `{ mode, current_password?, new_password, confirmation, request_id }`.
 * null quando ele está malformado (400 `empty_fields`, sem contar): modo fora
 * da lista, `request_id` que não é UUID, senha nova ou confirmação que não são
 * texto, ou senha atual presente que não é texto. Os campos vazios seguem para
 * a RPC, que responde `empty_fields` sem contar (item 1 de "Trocas").
 * As senhas vão como foram digitadas (RN-09 do E1.04).
 */
export function readChangeRequest(body: unknown): ChangeRequest | null {
  if (!isRecord(body)) return null
  const { mode, current_password, new_password, confirmation, request_id } = body
  if (mode !== 'forced' && mode !== 'voluntary') return null
  if (!isUuid(request_id)) return null
  if (typeof new_password !== 'string' || typeof confirmation !== 'string') return null
  if (current_password !== undefined && current_password !== null && typeof current_password !== 'string') return null
  return {
    mode,
    currentPassword: mode === 'voluntary' && typeof current_password === 'string' ? current_password : null,
    newPassword: new_password,
    confirmation,
    requestId: request_id.toLowerCase(),
  }
}

function decodeBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/**
 * O `session_id` do *payload* de um token que o `auth.getUser` já validou
 * (item 3 de "Trocas"), quando o `sub` é o da conta que o Auth devolveu.
 * null se o token não tiver as duas coisas (a função responde `session_ended`).
 */
export function sessionIdFromToken(token: string, authUserId: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const json = decodeBase64Url(parts[1])
  if (json === null) return null
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(payload)) return null
  if (typeof payload.sub !== 'string' || payload.sub.toLowerCase() !== authUserId.toLowerCase()) return null
  return isUuid(payload.session_id) ? payload.session_id.toLowerCase() : null
}

/** Confere o retorno da RPC. Qualquer coisa fora do contrato vira 500. */
export function isChangeResult(value: unknown): value is ChangeResult {
  if (!isRecord(value)) return false
  switch (value.result) {
    case 'ok':
      return value.replayed === undefined || value.replayed === true
    case 'empty_fields':
    case 'session_ended':
    case 'not_flagged':
    case 'forbidden':
    case 'current_password_invalid':
      return true
    case 'invalid':
      return (
        (value.field === 'new_password' && typeof value.code === 'string' && NEW_PASSWORD_CODES.includes(value.code)) ||
        (value.field === 'confirmation' && value.code === 'password_mismatch')
      )
    case 'change_blocked':
      return isPositiveInteger(value.retry_after_seconds) && isPositiveInteger(value.retry_after_minutes)
    default:
      return false
  }
}

/** Monta uma resposta da função, sempre com CORS e `Cache-Control: no-store`. */
export function reply(
  status: number,
  body: ChangeResponseBody,
  extraHeaders: Record<string, string> = {},
): Response {
  return jsonReply(status, body, extraHeaders)
}

/** O resultado da RPC em HTTP ("Contratos"). Só os campos do contrato saem. */
export function resultReply(result: ChangeResult): Response {
  switch (result.result) {
    case 'ok':
      return reply(200, result.replayed ? { result: 'ok', replayed: true } : { result: 'ok' })
    case 'empty_fields':
      return reply(400, { result: 'empty_fields' })
    case 'invalid':
      return reply(400, result.field === 'confirmation'
        ? { result: 'invalid', code: 'password_mismatch', field: 'confirmation' }
        : { result: 'invalid', code: result.code, field: 'new_password' })
    case 'session_ended':
      return reply(401, { result: 'session_ended' })
    case 'not_flagged':
      return reply(403, { result: 'not_flagged' })
    case 'forbidden':
      return reply(403, { result: 'forbidden' })
    case 'current_password_invalid':
      return reply(422, { result: 'current_password_invalid' })
    case 'change_blocked':
      return reply(
        429,
        { result: 'change_blocked', retry_after_minutes: result.retry_after_minutes },
        { 'Retry-After': String(result.retry_after_seconds) },
      )
  }
}

/**
 * Erro do `auth.getUser`: a sessão não vale mais (token vencido, assinatura
 * errada, sessão apagada) ou o Auth falhou. Sem status, ou com 5xx, é falha do
 * Auth (500); 4xx é sessão encerrada (401).
 */
export function isAuthServerFailure(error: { status?: number }): boolean {
  return typeof error.status !== 'number' || error.status === 0 || error.status >= 500
}
