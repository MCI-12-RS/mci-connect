// E1.04: apoio dos testes da Edge Function `sign-in` e da medição de tempo (stack local).
//
// Variáveis de ambiente:
//   SUPABASE_URL               padrão http://127.0.0.1:54321
//   SUPABASE_ANON_KEY          a chave pública (sb_publishable_... ou a anon key da stack local)
//   SUPABASE_SERVICE_ROLE_KEY  só para criar e apagar as contas de teste pela Admin API
//   PSQL                       padrão "docker exec -i supabase_db_mci-connect psql -U postgres"
//   EDGE_LOGS_CMD              opcional: comando que imprime os logs da função (ver sign-in.edge.test.mjs)
//
// Use SÓ a stack local: o script grava e apaga dados (fictícios) e mexe em private.sign_in_throttle.
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

export const URL_BASE = (process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').replace(/\/$/, '')
export const ANON = process.env.SUPABASE_ANON_KEY ?? ''
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
export const PSQL = process.env.PSQL ?? 'docker exec -i supabase_db_mci-connect psql -U postgres'
export const FUNCTION_URL = `${URL_BASE}/functions/v1/sign-in`
export const FAILURE_FLOOR_MS = 700

if (!/^https?:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal|kong)(:\d+)?$/.test(URL_BASE)) {
  throw new Error(`SUPABASE_URL (${URL_BASE}) não é a stack local: estes testes gravam e apagam dados.`)
}

export function sql(text) {
  return execSync(`${PSQL} -X -q -At -v ON_ERROR_STOP=1`, { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
}

export const resetThrottle = () => sql('DELETE FROM private.sign_in_throttle;')

/** Linha de controle (nº de falhas guardadas) de uma chave, ou null se não existir. */
export function failuresOf(kind, key) {
  const out = sql(`SELECT coalesce((SELECT cardinality(failures)::text FROM private.sign_in_throttle
                      WHERE kind = '${kind}' AND key_hash = private.sign_in_key('${kind}', '${key.replace(/'/g, "''")}')), '');`)
  return out === '' ? null : Number(out)
}

export function originRowCount() {
  return Number(sql(`SELECT count(*) FROM private.sign_in_throttle WHERE kind = 'origin';`))
}

async function admin(method, path, body) {
  const res = await fetch(`${URL_BASE}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Admin API ${method} ${path}: ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
}

export const DOMAIN = 'e104edge.invalid'
export const PW = 'Senha#Edge1'

/**
 * Massa fictícia (commitada): Ana (e-mail, CPF e celular), duas pessoas com o mesmo número (ambíguo: o
 * celular de uma é o CPF da outra; o mesmo celular em dois cadastros não excluídos o E2.04 não aceita),
 * uma excluída, uma sem conta e uma com conta banida.
 */
export async function createMassa() {
  await cleanupMassa()
  const ids = { pastor: randomUUID(), ana: randomUUID(), ouro: randomUUID(), prata: randomUUID(), excluida: randomUUID(), semConta: randomUUID(), banida: randomUUID() }
  const mkUser = async (email) => (await admin('POST', 'users', { email, password: PW, email_confirm: true })).id
  const auth = { ana: await mkUser(`ana@${DOMAIN}`), banida: await mkUser(`banida@${DOMAIN}`) }
  sql(`BEGIN;
UPDATE auth.users SET banned_until = now() + interval '10 years' WHERE id = '${auth.banida}';
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES ('${ids.pastor}', 'E104 Edge Pastor', 'M', true, false, 'pastor@${DOMAIN}');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, email, cpf, mobile_whatsapp) VALUES
  ('${ids.ana}', 'E104 Edge Ana', 'F', '${ids.pastor}', true, '${auth.ana}', 'ana@${DOMAIN}', '168.995.350-09', '(51) 90000-2000'),
  ('${ids.ouro}', 'E104 Edge Ouro', 'M', '${ids.pastor}', true, NULL, 'ouro@${DOMAIN}', NULL, '(51) 90000-2060'),
  ('${ids.prata}', 'E104 Edge Prata', 'M', '${ids.pastor}', true, NULL, 'prata@${DOMAIN}', '519.000.020-60', NULL),
  ('${ids.excluida}', 'E104 Edge Excluida', 'F', '${ids.pastor}', true, NULL, 'excluida@${DOMAIN}', NULL, NULL),
  ('${ids.semConta}', 'E104 Edge Sem Conta', 'F', '${ids.pastor}', true, NULL, 'semconta@${DOMAIN}', NULL, NULL),
  ('${ids.banida}', 'E104 Edge Banida', 'F', '${ids.pastor}', true, '${auth.banida}', 'banida@${DOMAIN}', NULL, NULL);
UPDATE public.members SET deleted_at = now() WHERE id = '${ids.excluida}';
COMMIT;`)
  resetThrottle()
  return { ids, auth }
}

export async function cleanupMassa() {
  const users = sql(`SELECT id FROM auth.users WHERE email LIKE '%@${DOMAIN}';`).split('\n').filter(Boolean)
  sql(`BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.events WHERE entity_label LIKE 'E104 Edge%' OR actor_label LIKE 'E104 Edge%';
UPDATE public.members SET leader_id = NULL WHERE name LIKE 'E104 Edge%';
DELETE FROM public.members WHERE name LIKE 'E104 Edge%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM private.sign_in_throttle;
COMMIT;`)
  for (const id of users) await admin('DELETE', `users/${id}`).catch(() => {})
}

let originSeq = 0
/** Origem nova a cada chamada (198.18.100.x), para o limite por origem não interferir. */
export const freshOrigin = () => `198.18.${100 + Math.floor(originSeq / 250) % 100}.${(originSeq++ % 250) + 1}`

/** POST na função. `ip`: valor de CF-Connecting-IP (undefined = sem o cabeçalho). */
export async function signIn(identifier, password, { ip = freshOrigin(), headers = {}, rawBody, method = 'POST' } = {}) {
  const h = { apikey: ANON, 'Content-Type': 'application/json', ...headers }
  if (ip !== null) h['CF-Connecting-IP'] = ip
  const t0 = performance.now()
  const res = await fetch(FUNCTION_URL, {
    method,
    headers: h,
    body: method === 'POST' ? (rawBody ?? JSON.stringify({ identifier, password })) : undefined,
  })
  const text = await res.text()
  const ms = performance.now() - t0
  let body = null
  try { body = JSON.parse(text) } catch { /* corpo que não é JSON */ }
  return { status: res.status, headers: res.headers, text, body, ms }
}

export const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
export const percentile = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] }
