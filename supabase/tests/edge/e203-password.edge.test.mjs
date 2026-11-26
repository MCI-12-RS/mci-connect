// E2.03 (PR 1, tarefa 5): as Edge Functions `change-own-password`, `create-user-admin` e `sign-in`
// (must_change_password) e o caminho único da senha (RN-14) contra o Auth de verdade da stack local.
// Spec: docs/specs/e2-03-senha.md, "Contratos", RN-07, RN-08, RN-10 a RN-12, RN-14, RN-15, RN-16, RN-17,
// DA-3 (corpo limitado), DA-13, DT-02.
//
// Pré-requisitos: `supabase start` com as funções servidas (o edge runtime do `supabase start`) e as
// migrations do E2.03 aplicadas.
//
//   SUPABASE_URL=http://127.0.0.1:<api> SUPABASE_ANON_KEY=<chave pública> SUPABASE_SERVICE_ROLE_KEY=<service role> \
//   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
//   EDGE_LOGS_CMD="docker logs --since 5m supabase_edge_runtime_<projeto> 2>&1" \
//     node --test supabase/tests/edge/e203-password.edge.test.mjs
//
// O EDGE_LOGS_CMD é opcional (sem ele, o teste de logs é pulado). Usa só dados fictícios (@e203edge.invalid,
// nomes "E203 Edge ...") e apaga tudo no fim. Só a stack local: grava e apaga dados e mexe em
// private.sign_in_throttle.
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { ANON, SERVICE, URL_BASE, freshOrigin, resetThrottle, signIn, sql } from './support.mjs'

assert.ok(ANON, 'defina SUPABASE_ANON_KEY (a chave pública da stack local)')
assert.ok(SERVICE, 'defina SUPABASE_SERVICE_ROLE_KEY (só para criar as contas de teste)')

const DOMAIN = 'e203edge.invalid'
const FN = (name) => `${URL_BASE}/functions/v1/${name}`
const PW = 'Caminho2024'            // a senha de Caio (atende à política)
const CAIO_CPF = '529.982.247-25'
const CAIO_MOBILE = '(51) 98888-7777'
const CAIO_BIRTH = '1990-03-15'
const CAIO_EMAIL = 'caio.lima@exemplo.com'
const NAME = 'E203 Edge'

const ids = {}
const createdAccounts = []

async function adminCall(method, path, body) {
  const res = await fetch(`${URL_BASE}/auth/v1/admin/${path}`, {
    method,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

/** Conta no Auth (a guarda descarta a senha do createUser) e senha no cofre. */
async function account(email, password) {
  const r = await adminCall('POST', 'users', { email, password, email_confirm: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  sql(`SELECT private.write_password('${r.body.id}'::uuid, NULL, '${password}', NULL);`)
  createdAccounts.push(r.body.id)
  return r.body.id
}

const vault = (userId) => sql(`SELECT coalesce(password_hash, '-') || '|' || must_change || '|' || coalesce(must_change_reason, '-') FROM private.account_passwords WHERE auth_user_id = '${userId}'`)
const matches = (userId, password) => sql(`SELECT coalesce(extensions.crypt('${password.replace(/'/g, "''")}', password_hash) = password_hash, false) FROM private.account_passwords WHERE auth_user_id = '${userId}'`) === 't'
const authPassword = (userId) => sql(`SELECT coalesce(encrypted_password, '<null>') FROM auth.users WHERE id = '${userId}'`)
const mark = (userId) => sql(`UPDATE private.account_passwords SET must_change = true, must_change_reason = 'reset', must_change_since = now(), temp_expires_at = now() + interval '7 days' WHERE auth_user_id = '${userId}'`)
const unmark = (userId) => sql(`UPDATE private.account_passwords SET must_change = false, must_change_reason = NULL, must_change_since = NULL, temp_expires_at = NULL WHERE auth_user_id = '${userId}'`)
const eventsOf = (action, memberId) => sql(`SELECT count(*) FROM public.events WHERE action = '${action}' AND entity_id = '${memberId}'`)

/** Entra pela `sign-in` e devolve a sessão. */
async function session(identifier, password) {
  const r = await signIn(identifier, password)
  assert.equal(r.status, 200, r.text)
  return { ...r.body.session, mustChange: r.body.must_change_password, id: JSON.parse(Buffer.from(r.body.session.access_token.split('.')[1], 'base64url').toString()).session_id }
}

/** POST na change-own-password. `headers`: extras (origem forjada). */
async function change(token, payload, { headers = {}, rawBody, method = 'POST' } = {}) {
  const h = { apikey: ANON, 'Content-Type': 'application/json', ...headers }
  if (token) h.Authorization = `Bearer ${token}`
  const res = await fetch(FN('change-own-password'), {
    method, headers: h, body: method === 'POST' ? (rawBody ?? JSON.stringify(payload)) : undefined,
  })
  const text = await res.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* não é JSON */ }
  return { status: res.status, headers: res.headers, text, body }
}
const req = (extra = {}) => ({ mode: 'voluntary', current_password: PW, new_password: 'Abacate77', confirmation: 'Abacate77', request_id: randomUUID(), ...extra })

function cleanup() {
  sql(`BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.events WHERE entity_label LIKE '${NAME}%' OR actor_label LIKE '${NAME}%' OR (entity = 'auth' AND occurred_at > now() - interval '1 hour');
UPDATE public.members SET leader_id = NULL, has_leadership = false, deleted_by = NULL, deleted_by_kind = NULL WHERE name LIKE '${NAME}%';
DELETE FROM public.members WHERE name LIKE '${NAME}%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM private.sign_in_throttle;
COMMIT;`)
}

async function removeAccounts() {
  const users = sql(`SELECT id FROM auth.users WHERE email LIKE '%@${DOMAIN}' OR email LIKE '%@mci12fakemail.com' AND id IN (SELECT id FROM public.members WHERE name LIKE '${NAME}%')
                      UNION SELECT id FROM auth.users WHERE id IN (SELECT auth_user_id FROM public.members WHERE name LIKE '${NAME}%')`).split('\n').filter(Boolean)
  for (const id of new Set([...users, ...createdAccounts])) await adminCall('DELETE', `users/${id}`).catch(() => {})
}

before(async () => {
  cleanup()
  await removeAccounts()
  const lider = randomUUID(); const caio = randomUUID(); const admin = randomUUID(); const hugo = randomUUID()
  Object.assign(ids, { lider, caio, admin, hugo })
  ids.authCaio = await account(`caio@${DOMAIN}`, PW)
  ids.authAdmin = await account(`admin@${DOMAIN}`, 'Admin#Senha2026')
  ids.authHugo = await account(`hugo@${DOMAIN}`, 'Forte@2024x')
  sql(`BEGIN;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES ('${lider}', '${NAME} Líder', 'M', true, false, 'lider@${DOMAIN}');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, email, cpf, mobile_whatsapp, birth_date) VALUES
  ('${caio}', '${NAME} Caio', 'M', '${lider}', true, '${ids.authCaio}', (SELECT id FROM public.roles WHERE name = 'Membro'), '${CAIO_EMAIL}', '${CAIO_CPF}', '${CAIO_MOBILE}', '${CAIO_BIRTH}'),
  ('${admin}', '${NAME} Admin', 'F', '${lider}', true, '${ids.authAdmin}', (SELECT id FROM public.roles WHERE name = 'Administrador'), 'admin@${DOMAIN}', NULL, '(51) 90000-0203', NULL),
  ('${hugo}', '${NAME} Hugo', 'M', '${lider}', true, '${ids.authHugo}', NULL, 'hugo@${DOMAIN}', NULL, '(51) 90000-0204', NULL);
COMMIT;`)
  resetThrottle()
})
after(async () => { cleanup(); await removeAccounts() })
beforeEach(() => resetThrottle())

describe('change-own-password: contrato HTTP', () => {
  it('RN-10: sem token, ou com token que não é de sessão, 401 session_ended', async () => {
    for (const token of [null, 'lixo', ANON]) {
      const r = await change(token, req())
      assert.equal(r.status, 401, r.text)
      assert.deepEqual(r.body, { result: 'session_ended' })
    }
  })

  it('métodos e corpo: GET dá 405 com Allow, OPTIONS responde ao CORS, corpo acima de 4 KB dá 413', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const get = await change(s.access_token, null, { method: 'GET' })
    assert.equal(get.status, 405)
    assert.match(get.headers.get('allow') ?? '', /POST/)
    const opt = await fetch(FN('change-own-password'), { method: 'OPTIONS', headers: { apikey: ANON, Origin: 'http://localhost', 'Access-Control-Request-Method': 'POST' } })
    assert.ok([200, 204].includes(opt.status), `OPTIONS ${opt.status}`)
    await opt.text()
    const big = await change(s.access_token, req({ new_password: 'x'.repeat(5000), confirmation: 'x'.repeat(5000) }))
    assert.equal(big.status, 413, big.text)
    assert.ok(matches(ids.authCaio, PW), 'a senha não mudou')
  })

  it('RN-10: corpo malformado, campos vazios e modo desconhecido dão 400 empty_fields, sem contar nem registrar', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const cases = [
      change(s.access_token, null, { rawBody: 'isto não é json' }),
      change(s.access_token, {}),
      change(s.access_token, req({ mode: 'outro' })),
      change(s.access_token, req({ new_password: '', confirmation: '' })),
      change(s.access_token, req({ current_password: '' })),
      change(s.access_token, req({ request_id: 'não-é-uuid' })),
      change(s.access_token, req({ new_password: 123 })),
    ]
    for (const r of await Promise.all(cases)) {
      assert.equal(r.status, 400, r.text)
      assert.deepEqual(r.body, { result: 'empty_fields' })
    }
    assert.equal(sql(`SELECT count(*) FROM private.sign_in_throttle WHERE cardinality(failures) > 0 AND kind IN ('password_change')`), '0')
    assert.equal(eventsOf('password_change_failed', ids.caio), '0')
    assert.ok(matches(ids.authCaio, PW))
  })

  it('RN-13: 400 invalid com code e field (política, igual à atual, confirmação), e a senha não muda nem conta', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const casos = [
      [{ new_password: 'Abc1234', confirmation: 'Abc1234' }, 'password_too_short', 'new_password'],
      [{ new_password: '12345678', confirmation: '12345678' }, 'password_weak', 'new_password'],
      [{ new_password: '52998224725', confirmation: '52998224725' }, 'password_personal_data', 'new_password'],
      [{ new_password: PW, confirmation: PW }, 'password_same_as_current', 'new_password'],
      [{ new_password: 'Abacate77', confirmation: 'Abacate78' }, 'password_mismatch', 'confirmation'],
    ]
    for (const [extra, code, field] of casos) {
      const r = await change(s.access_token, req(extra))
      assert.equal(r.status, 400, r.text)
      assert.deepEqual(r.body, { result: 'invalid', code, field })
    }
    assert.ok(matches(ids.authCaio, PW))
    assert.equal(sql(`SELECT coalesce(max(cardinality(failures)), 0) FROM private.sign_in_throttle WHERE kind = 'password_change'`), '0', 'a política não conta para o limite')
  })

  it('RN-11, RN-12: senha atual errada dá 422; a 5ª dá 429 com Retry-After e 15 minutos; o login continua livre', async () => {
    const s = await session(CAIO_EMAIL, PW)
    for (let i = 1; i <= 4; i++) {
      const r = await change(s.access_token, req({ current_password: `errada-${i}` }))
      assert.equal(r.status, 422, r.text)
      assert.deepEqual(r.body, { result: 'current_password_invalid' })
    }
    const quinta = await change(s.access_token, req({ current_password: 'errada-5' }))
    assert.equal(quinta.status, 429, quinta.text)
    assert.deepEqual(quinta.body, { result: 'change_blocked', retry_after_minutes: 15 })
    assert.equal(quinta.headers.get('retry-after'), '900')
    const durante = await change(s.access_token, req())
    assert.equal(durante.status, 429, 'a senha certa durante o bloqueio também recebe 429')
    assert.ok(matches(ids.authCaio, PW), 'a senha não mudou')
    assert.equal(eventsOf('password_change_failed', ids.caio), '5')
    assert.equal(eventsOf('password_change_blocked', ids.caio), '1')
    const login = await signIn(CAIO_EMAIL, PW)
    assert.equal(login.status, 200, 'o bloqueio da troca não bloqueia o login')
  })

  it('RN-10, RN-16: sem a marca, a troca obrigatória dá 403 not_flagged; com a marca troca (200), encerra as outras sessões e o reenvio volta ok replayed', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const outra = await session(CAIO_EMAIL, PW)
    const semMarca = await change(s.access_token, { mode: 'forced', new_password: 'Abacate77', confirmation: 'Abacate77', request_id: randomUUID() })
    assert.equal(semMarca.status, 403, semMarca.text)
    assert.deepEqual(semMarca.body, { result: 'not_flagged' })
    assert.ok(matches(ids.authCaio, PW))

    mark(ids.authCaio)
    const request_id = randomUUID()
    const body = { mode: 'forced', new_password: 'Abacate77', confirmation: 'Abacate77', request_id }
    const ok = await change(s.access_token, body)
    assert.equal(ok.status, 200, ok.text)
    assert.deepEqual(ok.body, { result: 'ok' })
    assert.equal(ok.headers.get('cache-control'), 'no-store')
    assert.ok(matches(ids.authCaio, 'Abacate77'))
    assert.equal(vault(ids.authCaio).split('|')[1], 'false', 'a marca saiu')
    assert.equal(sql(`SELECT count(*) FROM auth.sessions WHERE id = '${outra.id}'`), '0', 'a outra sessão foi encerrada')
    assert.equal(sql(`SELECT count(*) FROM auth.sessions WHERE id = '${s.id}'`), '1', 'a sessão que trocou continua')

    const replay = await change(s.access_token, body)
    assert.equal(replay.status, 200, replay.text)
    assert.deepEqual(replay.body, { result: 'ok', replayed: true })
    const outraSenha = await change(s.access_token, { ...body, new_password: 'Outra#Senha2026', confirmation: 'Outra#Senha2026' })
    assert.equal(outraSenha.status, 403, 'DA-13: reenvio com outra senha não vale como sucesso')
    assert.equal(eventsOf('password_changed', ids.caio), '1')
    // volta ao estado do grupo
    sql(`SELECT private.write_password('${ids.authCaio}'::uuid, NULL, '${PW}', NULL)`)
  })

  it('RN-16: sessão apagada devolve 401 session_ended, e o token antigo não troca nada', async () => {
    const s = await session(CAIO_EMAIL, PW)
    sql(`DELETE FROM auth.sessions WHERE id = '${s.id}'`)
    const r = await change(s.access_token, req())
    assert.equal(r.status, 401, r.text)
    assert.deepEqual(r.body, { result: 'session_ended' })
    assert.ok(matches(ids.authCaio, PW))
  })

  it('RN-10: cadastro excluído com a sessão aberta dá 403 forbidden', async () => {
    const s = await session(`hugo@${DOMAIN}`, 'Forte@2024x')
    sql(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.members SET deleted_at = now() WHERE id = '${ids.hugo}'; COMMIT;`)
    const r = await change(s.access_token, req({ current_password: 'Forte@2024x' }))
    sql(`BEGIN; SET LOCAL session_replication_role = replica; UPDATE public.members SET deleted_at = NULL WHERE id = '${ids.hugo}'; COMMIT;`)
    assert.equal(r.status, 403, r.text)
    assert.deepEqual(r.body, { result: 'forbidden' })
    assert.ok(matches(ids.authHugo, 'Forte@2024x'))
  })

  it('RN-12: cabeçalhos de origem forjados (X-Forwarded-For, X-Real-IP, Forwarded) não mudam a contagem: tudo conta numa origem só', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const forjados = [
      { 'X-Forwarded-For': '203.0.113.1' }, { 'X-Forwarded-For': '203.0.113.2, 10.0.0.1' }, { 'X-Real-IP': '203.0.113.3' }, { Forwarded: 'for=203.0.113.4' },
    ]
    sql('DELETE FROM private.sign_in_throttle')
    for (const [i, headers] of forjados.entries()) {
      const r = await change(s.access_token, req({ current_password: `errada-${i}` }), { headers })
      assert.equal(r.status, 422, r.text)
    }
    assert.equal(sql(`SELECT count(*) FROM private.sign_in_throttle WHERE kind = 'origin'`), '1', 'uma única linha de origem, não uma por cabeçalho')
    assert.equal(sql(`SELECT max(cardinality(failures)) FROM private.sign_in_throttle WHERE kind = 'origin'`), '4', 'as 4 falhas contaram na mesma origem')
  })

  it('RN-17: os logs da função não têm senha, token, e-mail, identificação nem origem', async (t) => {
    const cmd = process.env.EDGE_LOGS_CMD
    if (!cmd) return t.skip('defina EDGE_LOGS_CMD (ver o cabeçalho deste arquivo)')
    const senhaUnica = 'Sen-ha-Atual-9931'
    const novaUnica = 'Nov-a-Senha-7742'
    const s = await session(CAIO_EMAIL, PW)
    await change(s.access_token, req({ current_password: senhaUnica, new_password: novaUnica, confirmation: novaUnica }), { headers: { 'X-Forwarded-For': '203.0.113.99' } })
    await change(s.access_token, req({ new_password: novaUnica, confirmation: 'outra' }))
    await change(s.access_token, null, { rawBody: 'não é json' })
    await new Promise((r) => setTimeout(r, 1500))
    const logs = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: '/bin/bash' })
    const doFn = logs.split('\n').filter((l) => l.includes('"fn":"change-own-password"'))
    assert.ok(doFn.length >= 3, 'a função registrou as chamadas')
    for (const proibido of [senhaUnica, novaUnica, PW, 'Abacate77', s.access_token, s.refresh_token, `caio@${DOMAIN}`, CAIO_EMAIL, CAIO_CPF, '52998224725', '203.0.113.99', ids.authCaio, ids.caio]) {
      assert.ok(!logs.includes(proibido), `o log contém "${proibido.slice(0, 12)}..."`)
    }
    for (const linha of doFn) {
      const m = /\{.*\}/.exec(linha)
      assert.ok(m, `linha sem JSON: ${linha.slice(0, 80)}`)
      const o = JSON.parse(m[0])
      assert.deepEqual(Object.keys(o).filter((k) => !['fn', 'result', 'ms', 'code'].includes(k)), [], `chaves a mais no log: ${m[0]}`)
    }
  })
})

describe('sign-in: must_change_password (RN-08 b, RN-03)', () => {
  it('conta com senha boa entra sem a marca; senha fora da política ganha a marca na primeira entrada; senha temporária entra com a marca', async () => {
    const forte = await signIn(CAIO_EMAIL, PW)
    assert.equal(forte.status, 200, forte.text)
    assert.equal(forte.body.must_change_password, false)
    sql(`SELECT private.write_password('${ids.authHugo}'::uuid, NULL, 'abc123', NULL)`)
    const fraca = await signIn(`hugo@${DOMAIN}`, 'abc123')
    assert.equal(fraca.status, 200, fraca.text)
    assert.equal(fraca.body.must_change_password, true)
    assert.equal(eventsOf('password_change_required', ids.hugo), '1')
    const de_novo = await signIn(`hugo@${DOMAIN}`, 'abc123')
    assert.equal(de_novo.body.must_change_password, true)
    assert.equal(eventsOf('password_change_required', ids.hugo), '1', 'não há um novo registro de troca exigida')
    sql(`SELECT private.write_password('${ids.authHugo}'::uuid, NULL, 'Forte@2024x', NULL); UPDATE private.account_passwords SET must_change = false, must_change_reason = NULL, must_change_since = NULL WHERE auth_user_id = '${ids.authHugo}'`)
    mark(ids.authCaio)
    const marcada = await signIn(CAIO_EMAIL, PW)
    assert.equal(marcada.body.must_change_password, true)
    unmark(ids.authCaio)
  })

  it('senha temporária vencida: 401 (mensagem única) e, com a marca, o corpo nunca traz must_change_password', async () => {
    sql(`UPDATE private.account_passwords SET must_change = true, must_change_reason = 'reset', must_change_since = now(), temp_expires_at = now() - interval '1 minute' WHERE auth_user_id = '${ids.authCaio}'`)
    const r = await signIn(CAIO_EMAIL, PW)
    unmark(ids.authCaio)
    assert.equal(r.status, 401, r.text)
    assert.ok(!('must_change_password' in r.body))
  })
})

describe('create-user-admin: senha inicial (RN-07, RN-13, RN-14)', () => {
  let token
  before(async () => { token = (await session(`admin@${DOMAIN}`, 'Admin#Senha2026')).access_token })

  async function create(password, extra = {}, memberExtra = {}) {
    const unique = randomUUID().slice(0, 8)
    const body = {
      ...(password === undefined ? {} : { password }),
      attemptId: randomUUID(),
      memberData: {
        name: `${NAME} Novo ${unique}`, gender: 'M', is_active: true, leader_id: ids.lider,
        mobile_whatsapp: `5192${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`,
        ...memberExtra,
      },
      ...extra,
    }
    const res = await fetch(FN('create-user-admin'), {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* não é JSON */ }
    return { status: res.status, text, body: json, name: body.memberData.name }
  }
  const accountOf = (name) => sql(`SELECT auth_user_id FROM public.members WHERE name = '${name}'`)

  it('RN-13: senha fora da política dá 400 com code e field "password", antes de criar a conta e o cadastro', async () => {
    const antes = sql(`SELECT count(*) FROM auth.users`)
    const casos = [['abc12', 'password_too_short'], ['12345678', 'password_weak'], ['x'.repeat(73), 'password_too_long'], [' 123456', 'password_too_short']]
    for (const [senha, code] of casos) {
      const r = await create(senha)
      assert.equal(r.status, 400, r.text)
      assert.equal(r.body.code, code)
      assert.equal(r.body.field, 'password')
      assert.equal(typeof r.body.error, 'string')
      assert.ok(!r.text.includes(senha) || senha.length < 3, 'a resposta não devolve a senha')
      assert.equal(sql(`SELECT count(*) FROM public.members WHERE name = '${r.name}'`), '0')
    }
    const pessoal = await create('mat39053344705', {}, { cpf: '39053344705' })
    assert.equal(pessoal.status, 400, pessoal.text)
    assert.equal(pessoal.body.code, 'password_personal_data')
    assert.equal(sql(`SELECT count(*) FROM auth.users`), antes, 'nenhuma conta foi criada nas recusas')
  })

  it('RN-07, RN-14: sem senha (ou vazia, ou 123456) a conta nasce com 123456 no cofre, marca initial sem validade, e nada em auth.users', async () => {
    for (const senha of [undefined, '', '123456']) {
      const r = await create(senha)
      assert.equal(r.status, 200, r.text)
      assert.deepEqual(Object.keys(r.body).sort(), ['member', 'replayed'])
      const userId = accountOf(r.name)
      assert.ok(userId, 'a conta existe')
      assert.ok(matches(userId, '123456'), `senha ${JSON.stringify(senha)}: o cofre tem 123456`)
      assert.equal(vault(userId).split('|').slice(1).join('|'), 'true|initial')
      assert.equal(sql(`SELECT temp_expires_at IS NULL FROM private.account_passwords WHERE auth_user_id = '${userId}'`), 't')
      assert.equal(authPassword(userId), '', 'auth.users não guarda senha')
      createdAccounts.push(userId)
    }
  })

  it('RN-07: a senha digitada (Oliveira#7) vai para o cofre, entra no primeiro acesso e leva à troca obrigatória; o replay não regrava', async () => {
    const r = await create('Oliveira#7')
    assert.equal(r.status, 200, r.text)
    const userId = accountOf(r.name)
    createdAccounts.push(userId)
    assert.ok(matches(userId, 'Oliveira#7'))
    assert.equal(authPassword(userId), '')
    const mobile = sql(`SELECT mobile_whatsapp FROM public.members WHERE name = '${r.name}'`)
    const login = await signIn(mobile, 'Oliveira#7')
    assert.equal(login.status, 200, login.text)
    assert.equal(login.body.must_change_password, true)
    assert.equal(sql(`SELECT count(*) FROM auth.users WHERE coalesce(encrypted_password, '') <> ''`), '0', 'nenhuma conta da stack tem senha em auth.users')
  })
})

describe('caminho único da senha, contra o Auth de verdade (RN-14, DT-02, RN-15)', () => {
  async function authRaw(method, path, { token, body, key = ANON } = {}) {
    const res = await fetch(`${URL_BASE}/auth/v1/${path}`, {
      method,
      headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* não é JSON */ }
    return { status: res.status, text, body: json }
  }

  it('PUT /auth/v1/user com senha, com a sessão da própria conta, falha: cofre e auth.users não mudam e a sessão continua', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const antes = vault(ids.authCaio)
    const r = await authRaw('PUT', 'user', { token: s.access_token, body: { password: 'Nova#Senha2025' } })
    assert.ok(r.status >= 400, `o Auth aceitou a troca: ${r.status} ${r.text.slice(0, 120)}`)
    assert.ok(!r.text.includes('Nova#Senha2025'), 'a resposta não devolve a senha')
    assert.equal(vault(ids.authCaio), antes, 'o cofre não mudou')
    assert.equal(authPassword(ids.authCaio), '', 'auth.users continua sem senha')
    const me = await authRaw('GET', 'user', { token: s.access_token })
    assert.equal(me.status, 200, 'a sessão continua valendo')
    assert.ok(matches(ids.authCaio, PW))
  })

  it('updateUserById (Admin API) com senha falha, e o cofre fica como estava', async () => {
    const antes = vault(ids.authCaio)
    const r = await adminCall('PUT', `users/${ids.authCaio}`, { password: 'Nova#Senha2025' })
    assert.ok(r.status >= 400, `a Admin API aceitou a senha: ${r.status}`)
    assert.equal(vault(ids.authCaio), antes)
    assert.equal(authPassword(ids.authCaio), '')
    const semSenha = await adminCall('PUT', `users/${ids.authCaio}`, { user_metadata: { e203: 'ok' } })
    assert.equal(semSenha.status, 200, 'a Admin API continua mudando o que não é senha')
  })

  it('createUser (Admin API), com ou sem senha, passa e a conta nasce sem senha no Auth; a exclusão pelo Auth passa e a linha do cofre sai', async () => {
    const com = await adminCall('POST', 'users', { email: `com-senha@${DOMAIN}`, password: 'Qualquer#Senha1', email_confirm: true })
    assert.equal(com.status, 200, JSON.stringify(com.body))
    const sem = await adminCall('POST', 'users', { email: `sem-senha@${DOMAIN}`, email_confirm: true })
    assert.equal(sem.status, 200, JSON.stringify(sem.body))
    for (const u of [com.body, sem.body]) {
      createdAccounts.push(u.id)
      assert.equal(authPassword(u.id), '', 'a conta nasce sem senha (DT-02)')
    }
    const login = await authRaw('POST', 'token?grant_type=password', { body: { email: `com-senha@${DOMAIN}`, password: 'Qualquer#Senha1' } })
    assert.ok(login.status >= 400, 'sem senha no Auth, a senha digitada não entra')
    sql(`SELECT private.write_password('${com.body.id}'::uuid, NULL, 'Qualquer#Senha1', NULL)`)
    assert.equal(sql(`SELECT count(*) FROM private.account_passwords WHERE auth_user_id = '${com.body.id}'`), '1')
    const del = await adminCall('DELETE', `users/${com.body.id}`)
    assert.equal(del.status, 200, JSON.stringify(del.body))
    assert.equal(sql(`SELECT count(*) FROM private.account_passwords WHERE auth_user_id = '${com.body.id}'`), '0', 'a linha do cofre saiu junto da conta')
    await adminCall('DELETE', `users/${sem.body.id}`)
  })

  it('login por senha direto no Auth (/token?grant_type=password) falha, com a senha certa do cofre', async () => {
    const r = await authRaw('POST', 'token?grant_type=password', { body: { email: `caio@${DOMAIN}`, password: PW } })
    assert.ok(r.status >= 400, `o Auth deixou entrar: ${r.status}`)
    assert.ok(!r.body?.access_token)
  })

  it('a renovação da sessão (refresh_token) continua funcionando', async () => {
    const s = await session(CAIO_EMAIL, PW)
    const r = await authRaw('POST', 'token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } })
    assert.equal(r.status, 200, r.text.slice(0, 200))
    assert.ok(r.body.access_token && r.body.refresh_token)
  })

  it('RN-15: a recuperação padrão do Auth (/recover) não troca a senha e não manda nada', async () => {
    const antes = vault(ids.authCaio)
    const r = await authRaw('POST', 'recover', { body: { email: `caio@${DOMAIN}` } })
    assert.ok(r.status >= 400 || r.status === 200)   // o provedor de e-mail está desligado: o corpo pode ser erro
    assert.equal(vault(ids.authCaio), antes)
    assert.ok(matches(ids.authCaio, PW))
    assert.equal(authPassword(ids.authCaio), '')
  })
})
