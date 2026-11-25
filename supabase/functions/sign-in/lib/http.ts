// Contrato HTTP da função `sign-in` (E1.04: Contratos, DA-3, DT-07, DT-10, DT-18).
//
// Módulo puro (sem Deno nem import remoto), testado pelo Vitest: leitura do
// pedido, respostas da função, piso de tempo das falhas e leitura das respostas
// da RPC `sign_in_attempt` e do Auth.
//
// Respostas (sempre com `result` e `Cache-Control: no-store`):
//   200 { result: 'ok', session }            RN-13 (só a sessão, sem `user`)
//   400 { result: 'empty_fields' }           RN-08, DA-3 (não conta nem registra)
//   401 { result: 'invalid_credentials' }    RN-07 (corpo idêntico em todos os casos)
//   429 { result: 'locked', retry_after_minutes } + Retry-After (segundos)
//   500 { result: 'server_error' }           RN-08, P-LOG-12, DA-1 (não conta)
//   405, 413 { result: 'server_error' }      método errado ou corpo acima de 4 KB

/** Piso das respostas 401 e 429, contado da chegada do pedido (RN-07, DT-07). */
export const FAILURE_FLOOR_MS = 700

/** Tamanho máximo do corpo (DA-3). */
export const MAX_BODY_BYTES = 4096

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** A sessão devolvida à tela: só estes campos (RN-13). */
export interface Session {
  access_token: string
  refresh_token: string
  expires_in: number
  expires_at: number
  token_type: string
}

export type SignInResponseBody =
  | { result: 'ok'; session: Session }
  | { result: 'empty_fields' }
  | { result: 'invalid_credentials' }
  | { result: 'locked'; retry_after_minutes: number }
  | { result: 'server_error' }

export type IdentifierType = 'email' | 'mobile' | 'cpf' | 'cpf_or_mobile'

/** O `jsonb` da RPC `sign_in_attempt`. */
export type AttemptResult =
  | { result: 'empty_fields' }
  | { result: 'invalid' }
  | { result: 'locked'; retry_after_seconds: number; retry_after_minutes: number }
  | {
      result: 'ok'
      member_id: string
      auth_user_id: string
      auth_email: string
      identifier_type: IdentifierType
      identifier_masked: string
      // Ponto do E3.02 ('set' ou 'set_random_and_flag'). Neste passo é sempre
      // null; outro valor é tratado como fora do contrato (500).
      password_action: null
    }

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const IDENTIFIER_TYPES: readonly string[] = ['email', 'mobile', 'cpf', 'cpf_or_mobile']

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1

/** Confere o retorno da RPC. Qualquer coisa fora do contrato vira 500. */
export function isAttemptResult(value: unknown): value is AttemptResult {
  if (!isRecord(value)) return false
  switch (value.result) {
    case 'empty_fields':
    case 'invalid':
      return true
    case 'locked':
      return isPositiveInteger(value.retry_after_seconds) && isPositiveInteger(value.retry_after_minutes)
    case 'ok':
      return (
        isNonEmptyString(value.member_id) &&
        isNonEmptyString(value.auth_user_id) &&
        isNonEmptyString(value.auth_email) &&
        typeof value.identifier_type === 'string' &&
        IDENTIFIER_TYPES.includes(value.identifier_type) &&
        isNonEmptyString(value.identifier_masked) &&
        value.password_action === null
      )
    default:
      return false
  }
}

/** Monta uma resposta da função, sempre com CORS e `Cache-Control: no-store`. */
export function reply(
  status: number,
  body: SignInResponseBody,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  })
}

/** Resposta ao preflight do CORS. */
export function preflight(): Response {
  return new Response('ok', { headers: { ...CORS_HEADERS, 'Cache-Control': 'no-store' } })
}

export type BodyRead = { kind: 'ok'; value: unknown } | { kind: 'too_large' }

/**
 * Lê o corpo como JSON, com teto de bytes (DA-3). Acima do teto: too_large,
 * sem ler o resto. JSON inválido ou corpo vazio: `{ kind: 'ok', value: null }`
 * (a função responde como campos vazios).
 */
export async function readJsonBody(req: Request, maxBytes: number = MAX_BODY_BYTES): Promise<BodyRead> {
  const declared = Number(req.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > maxBytes) return { kind: 'too_large' }
  if (!req.body) return { kind: 'ok', value: null }

  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined)
      return { kind: 'too_large' }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { kind: 'ok', value: JSON.parse(new TextDecoder().decode(bytes)) }
  } catch {
    return { kind: 'ok', value: null }
  }
}

/**
 * A identificação e a senha do corpo, como foram enviadas (RN-09). null quando
 * um dos dois falta, não é texto ou está vazio (RN-08, DA-3, P-LOG-13): a
 * identificação só com espaços conta como vazia; a senha só com espaços, não.
 */
export function readCredentials(body: unknown): { identifier: string; password: string } | null {
  if (!isRecord(body)) return null
  const { identifier, password } = body
  if (typeof identifier !== 'string' || typeof password !== 'string') return null
  if (identifier.trim() === '' || password === '') return null
  return { identifier, password }
}

/** Quanto falta para o piso das falhas (DT-07). */
export function remainingFloorMs(startedAt: number, now: number, floorMs: number = FAILURE_FLOOR_MS): number {
  return Math.max(0, startedAt + floorMs - now)
}

/** Espera até o piso das falhas, contado de `startedAt` (relógio de `performance.now()`). */
export async function waitForFloor(
  startedAt: number,
  now: () => number = () => performance.now(),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  const remaining = remainingFloorMs(startedAt, now())
  if (remaining > 0) await sleep(remaining)
}

/** A resposta 429, com os minutos no corpo e os segundos no `Retry-After`. */
export function lockedReply(retryAfterSeconds: number, retryAfterMinutes: number): Response {
  return reply(
    429,
    { result: 'locked', retry_after_minutes: retryAfterMinutes },
    { 'Retry-After': String(retryAfterSeconds) },
  )
}

/** Só os campos da sessão que a tela usa, da resposta do `/verify` (RN-13); senão null. */
export function pickSession(value: unknown): Session | null {
  if (!isRecord(value)) return null
  const { access_token, refresh_token, expires_in, expires_at, token_type } = value
  if (
    !isNonEmptyString(access_token) ||
    !isNonEmptyString(refresh_token) ||
    typeof expires_in !== 'number' ||
    typeof expires_at !== 'number' ||
    !isNonEmptyString(token_type)
  ) {
    return null
  }
  return { access_token, refresh_token, expires_in, expires_at, token_type }
}

/** O `/verify` recusou porque o código foi trocado por outro login da mesma conta (DT-18). */
export function isOtpExpired(value: unknown): boolean {
  return isRecord(value) && value.error_code === 'otp_expired'
}

/**
 * O usuário que o `generateLink` devolveu foi criado por ele agora (o e-mail
 * da conta mudou no meio do login): nunca confirmado, nunca entrou e criado
 * depois de `sinceMs` (DT-18). Só esse pode ser apagado.
 */
export function isUserCreatedByLink(user: unknown, sinceMs: number): boolean {
  if (!isRecord(user)) return false
  const createdAt = typeof user.created_at === 'string' ? Date.parse(user.created_at) : NaN
  return (
    Number.isFinite(createdAt) &&
    createdAt >= sinceMs &&
    !user.email_confirmed_at &&
    !user.confirmed_at &&
    !user.last_sign_in_at
  )
}
