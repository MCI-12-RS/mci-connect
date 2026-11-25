// Troca da própria senha: obrigatória (com a marca) e voluntária (com a senha
// atual). Passo E2.03 de docs/migracao.md; spec docs/specs/e2-03-senha.md no
// repositório apps-mci ("Trocas", "Contratos", DT-08).
//
// Fluxo:
// 1. `OPTIONS`, método e corpo até 4 KB (_shared/http.ts).
// 2. `Authorization: Bearer <token>`, conferido por `auth.getUser(token)`: sem
//    token, token inválido ou sessão apagada → 401 `session_ended` (RN-16).
// 3. O `session_id` sai do payload do token que o `getUser` validou, com o `sub`
//    igual ao da conta.
// 4. Corpo `{ mode, current_password?, new_password, confirmation, request_id }`
//    (lib/contract.ts). Malformado: 400 `empty_fields`, sem contar.
// 5. Origem: só o `CF-Connecting-IP` (_shared/client-ip.ts, DT-06 do E1.04).
//    Obrigatória no modo voluntário: hospedado sem ela, 500 sem contar (DA-1 do
//    E1.04). Na stack local, `127.0.0.1`, como na `sign-in`.
// 6. RPC `change_own_password` (só service_role) com a chave secreta nova: a
//    marca, as travas, a contagem, a gravação, as sessões e a Auditoria numa
//    transação. O `result` vira HTTP (lib/contract.ts).
//
// Chave: em produção, só a secreta nova (`SUPABASE_SECRET_KEYS`); sem ela, 500.
// Na stack local, pode ser a `SUPABASE_SERVICE_ROLE_KEY` (_shared/env.ts).
//
// Logs: só o `result`, o tempo e um código interno. Nunca as senhas, o token, o
// e-mail, a origem nem a mensagem de erro do banco ou do Auth.
//
// `verify_jwt = false` no config.toml, como a `create-user-admin`: o JWT é
// conferido aqui dentro, com as chaves antigas e as novas.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { clientIpFrom } from '../_shared/client-ip.ts'
import { isHostedSupabaseUrl, resolveServiceKey } from '../_shared/env.ts'
import { bearerToken, preflight, readJsonBody } from '../_shared/http.ts'
import {
  isAuthServerFailure,
  isChangeResult,
  readChangeRequest,
  reply,
  resultReply,
  sessionIdFromToken,
} from './lib/contract.ts'

/** Tempo-limite de cada chamada ao banco e ao Auth: um Auth travado vira 500, sem prender a função. */
const UPSTREAM_TIMEOUT_MS = 10_000

const fetchWithTimeout: typeof fetch = (input, init) =>
  fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) })

function log(result: string, startedAt: number, code?: string): void {
  const entry: Record<string, string | number> = {
    fn: 'change-own-password',
    result,
    ms: Math.round(performance.now() - startedAt),
  }
  if (code) entry.code = code
  console.log(JSON.stringify(entry))
}

serve(async (req) => {
  const startedAt = performance.now()

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

    const admin = createClient(supabaseUrl, apiKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout },
    })

    // 2 e 3. Sessão viva e o session_id do token.
    const token = bearerToken(req.headers)
    if (!token) {
      log('session_ended', startedAt, 'no_token')
      return reply(401, { result: 'session_ended' })
    }
    const { data: userData, error: userError } = await admin.auth.getUser(token)
    if (userError || !userData?.user) {
      if (userError && isAuthServerFailure(userError)) {
        log('server_error', startedAt, `get_user_${userError.status ?? 'network'}`)
        return reply(500, { result: 'server_error' })
      }
      log('session_ended', startedAt, userError?.code ?? 'no_user')
      return reply(401, { result: 'session_ended' })
    }
    const authUserId = userData.user.id
    const sessionId = sessionIdFromToken(token, authUserId)
    if (!sessionId) {
      log('session_ended', startedAt, 'no_session_id')
      return reply(401, { result: 'session_ended' })
    }

    // 4. Corpo.
    const request = readChangeRequest(body.value)
    if (!request) {
      log('empty_fields', startedAt, 'malformed')
      return reply(400, { result: 'empty_fields' })
    }

    // 5. Origem: obrigatória só no modo voluntário (a RPC soma as falhas nela).
    const origin = clientIpFrom(req.headers, { hosted })
    if (request.mode === 'voluntary' && !origin) {
      log('server_error', startedAt, 'origin')
      return reply(500, { result: 'server_error' })
    }

    // 6. RPC.
    const { data, error } = await admin.rpc('change_own_password', {
      _auth_user_id: authUserId,
      _session_id: sessionId,
      _mode: request.mode,
      _current_password: request.currentPassword,
      _new_password: request.newPassword,
      _confirmation: request.confirmation,
      _origin: origin,
      _request_id: request.requestId,
    })
    if (error || !isChangeResult(data)) {
      log('server_error', startedAt, error ? `rpc_${error.code ?? 'error'}` : 'rpc_contract')
      return reply(500, { result: 'server_error' })
    }

    log(data.result, startedAt, data.result === 'ok' && data.replayed ? 'replayed' : undefined)
    return resultReply(data)
  } catch {
    log('server_error', startedAt, 'exception')
    return reply(500, { result: 'server_error' })
  }
})
