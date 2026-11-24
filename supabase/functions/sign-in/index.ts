// Login por e-mail, celular ou CPF (passo E1.04 de docs/migracao.md; spec
// docs/specs/e1-04-sign-in.md no repositório apps-mci).
//
// Fluxo:
// 1. Corpo `{ identifier, password }`. Campos vazios, JSON inválido ou campos
//    que não são texto: 400, sem contar nem registrar (RN-08, DA-3). Acima de
//    4 KB: 413.
// 2. Origem: só o `CF-Connecting-IP` (lib/client-ip.ts, DT-06). Hospedado sem
//    ele: 500, sem contar (DA-1).
// 3. RPC `sign_in_attempt` (só service_role): busca, contagem, bloqueio, um
//    bcrypt e Auditoria das falhas, numa transação (DT-02, DT-03).
// 4. Falha: 401 com corpo único; bloqueio: 429. Os dois esperam o piso de
//    700 ms (RN-07, DT-07).
// 5. Sucesso: `generateLink(magiclink)` + `POST /auth/v1/verify` com a chave
//    secreta e `Sb-Forwarded-For` (DT-01, DT-10). Com `otp_expired`, uma nova
//    tentativa; se falhar, o código pendente é descartado e a resposta é 500
//    (DA-13, DT-18). Depois, `sign_in_record_login` (erro ignorado, DA-12) e
//    200 só com a sessão (RN-13).
//
// Chave: em produção, só a secreta nova (`SUPABASE_SECRET_KEYS`); sem ela, 500.
// Na stack local, pode ser a `SUPABASE_SERVICE_ROLE_KEY` (lib/env.ts).
//
// Logs: só o `result`, o tempo e um código interno. Nunca a identificação, a
// senha, o e-mail, o token, a origem nem a mensagem de erro do banco ou do
// Auth (RN-09, RN-15 d).
//
// `verify_jwt = false` no config.toml: a tela chama esta função antes do login,
// só com a chave pública, que não é um JWT.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { clientIpFrom } from './lib/client-ip.ts'
import { isHostedSupabaseUrl, resolveServiceKey } from './lib/env.ts'
import {
  type AttemptResult,
  isAttemptResult,
  isOtpExpired,
  isUserCreatedByLink,
  lockedReply,
  pickSession,
  preflight,
  readCredentials,
  readJsonBody,
  reply,
  type Session,
  waitForFloor,
} from './lib/http.ts'

type OkAttempt = Extract<AttemptResult, { result: 'ok' }>

/** Folga para a diferença de relógio entre a função e o Auth (DT-18). */
const CLOCK_SKEW_MS = 60_000

function log(result: string, startedAt: number, code?: string): void {
  const entry: Record<string, string | number> = {
    fn: 'sign-in',
    result,
    ms: Math.round(performance.now() - startedAt),
  }
  if (code) entry.code = code
  console.log(JSON.stringify(entry))
}

type MintStep = { kind: 'ok'; session: Session } | { kind: 'otp_expired' } | { kind: 'failed'; code: string }

/** Um par generateLink + /verify. Nada do que volta do Auth é registrado. */
async function mintOnce(
  admin: SupabaseClient,
  supabaseUrl: string,
  apiKey: string,
  attempt: OkAttempt,
  origin: string,
  sinceMs: number,
): Promise<MintStep> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: attempt.auth_email })
  if (error || !data?.user || !data.properties?.hashed_token) return { kind: 'failed', code: 'generate_link' }

  if (data.user.id !== attempt.auth_user_id) {
    // O e-mail da conta mudou no meio do login e o generateLink criou um
    // usuário novo: apaga esse usuário (e só ele).
    if (isUserCreatedByLink(data.user, sinceMs)) {
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined)
    }
    return { kind: 'failed', code: 'link_user_mismatch' }
  }
  if (data.properties.verification_type !== 'magiclink') return { kind: 'failed', code: 'link_type' }

  const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      'Content-Type': 'application/json',
      'Sb-Forwarded-For': origin,
    },
    body: JSON.stringify({ type: 'email', token_hash: data.properties.hashed_token }),
  })
  const body: unknown = await response.json().catch(() => null)
  if (response.ok) {
    const session = pickSession(body)
    return session ? { kind: 'ok', session } : { kind: 'failed', code: 'session_shape' }
  }
  return isOtpExpired(body) ? { kind: 'otp_expired' } : { kind: 'failed', code: `verify_${response.status}` }
}

/** Emite a sessão da conta (DT-01, DT-18, DA-13). null quando não foi possível. */
async function mintSession(
  admin: SupabaseClient,
  supabaseUrl: string,
  apiKey: string,
  attempt: OkAttempt,
  origin: string,
  sinceMs: number,
): Promise<{ session: Session } | { code: string }> {
  let code = 'otp_expired'
  for (let round = 0; round < 2; round++) {
    const step = await mintOnce(admin, supabaseUrl, apiKey, attempt, origin, sinceMs)
    if (step.kind === 'ok') return { session: step.session }
    if (step.kind === 'failed') {
      code = step.code
      break
    }
  }
  // Não deixar um código de uso único válido por 1 hora (risco 9).
  const { error } = await admin.rpc('sign_in_discard_link', { _auth_user_id: attempt.auth_user_id })
  return { code: error ? `${code}+discard_failed` : code }
}

serve(async (req) => {
  const startedAt = performance.now()
  const sinceMs = Date.now() - CLOCK_SKEW_MS

  if (req.method === 'OPTIONS') return preflight()
  if (req.method !== 'POST') {
    log('server_error', startedAt, 'method')
    return reply(405, { result: 'server_error' }, { Allow: 'POST, OPTIONS' })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const hosted = isHostedSupabaseUrl(supabaseUrl)
    const apiKey = resolveServiceKey({
      secretKeysJson: Deno.env.get('SUPABASE_SECRET_KEYS'),
      serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      hosted,
    })
    if (!supabaseUrl || !apiKey) {
      log('server_error', startedAt, 'config')
      return reply(500, { result: 'server_error' })
    }

    const body = await readJsonBody(req)
    if (body.kind === 'too_large') {
      log('server_error', startedAt, 'body_too_large')
      return reply(413, { result: 'server_error' })
    }
    const credentials = readCredentials(body.value)
    if (!credentials) {
      log('empty_fields', startedAt)
      return reply(400, { result: 'empty_fields' })
    }

    const origin = clientIpFrom(req.headers, { hosted })
    if (!origin) {
      log('server_error', startedAt, 'origin')
      return reply(500, { result: 'server_error' })
    }

    const admin = createClient(supabaseUrl, apiKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const { data, error } = await admin.rpc('sign_in_attempt', {
      _identifier: credentials.identifier,
      _password: credentials.password,
      _origin: origin,
    })
    if (error || !isAttemptResult(data)) {
      log('server_error', startedAt, error ? `rpc_${error.code ?? 'error'}` : 'rpc_contract')
      return reply(500, { result: 'server_error' })
    }

    switch (data.result) {
      case 'empty_fields':
        log('empty_fields', startedAt)
        return reply(400, { result: 'empty_fields' })
      case 'invalid':
        await waitForFloor(startedAt)
        log('invalid_credentials', startedAt)
        return reply(401, { result: 'invalid_credentials' })
      case 'locked':
        await waitForFloor(startedAt)
        log('locked', startedAt)
        return lockedReply(data.retry_after_seconds, data.retry_after_minutes)
      case 'ok': {
        const minted = await mintSession(admin, supabaseUrl, apiKey, data, origin, sinceMs)
        if (!('session' in minted)) {
          log('server_error', startedAt, minted.code)
          return reply(500, { result: 'server_error' })
        }
        const { error: recordError } = await admin.rpc('sign_in_record_login', {
          _member_id: data.member_id,
          _auth_user_id: data.auth_user_id,
          _identifier_type: data.identifier_type,
          _identifier_masked: data.identifier_masked,
        })
        log('ok', startedAt, recordError ? `record_${recordError.code ?? 'error'}` : undefined)
        return reply(200, { result: 'ok', session: minted.session })
      }
    }
  } catch {
    log('server_error', startedAt, 'exception')
    return reply(500, { result: 'server_error' })
  }
})
