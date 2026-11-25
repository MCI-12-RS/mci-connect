// E1.04 (PR 1): testes da Edge Function `sign-in` contra a stack local.
// Spec: docs/specs/e1-04-sign-in.md, "Contratos", "A função `sign-in`", "Origem confiável" (DT-06),
// "Tempo igual" (DT-07), RN-07, RN-08, RN-10, RN-13, RN-15 d, DA-1, DA-3, DA-13.
//
// Pré-requisitos: `supabase start` com a função servida (o edge runtime do `supabase start`, ou
// `supabase functions serve sign-in`) e as migrations do PR 1 aplicadas.
//
//   eval "$(supabase status -o env | sed 's/^/export /')"     # ANON_KEY, SERVICE_ROLE_KEY, API_URL
//   SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
//     node --test supabase/tests/edge/sign-in.edge.test.mjs
//
// Opcional, para o teste de logs: EDGE_LOGS_CMD="docker logs --since 2m supabase_edge_runtime_mci-connect 2>&1"
// (ou o arquivo para onde o `supabase functions serve` redireciona a saída: EDGE_LOGS_CMD="cat /tmp/sign-in.log").
import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import {
  ANON, DOMAIN, FAILURE_FLOOR_MS, PW, URL_BASE, cleanupMassa, createMassa, failuresOf, originRowCount, resetThrottle,
  signIn, sql, freshOrigin,
} from './support.mjs'

assert.ok(ANON, 'defina SUPABASE_ANON_KEY (a chave pública da stack local)')
assert.ok(process.env.SUPABASE_SERVICE_ROLE_KEY, 'defina SUPABASE_SERVICE_ROLE_KEY (só para criar as contas de teste)')

const ANA_EMAIL = `ana@${DOMAIN}`
const ANA_CPF = '168.995.350-09'
const ANA_MOBILE = '(51) 90000-2000'
let massa

before(async () => { massa = await createMassa() })
after(async () => { await cleanupMassa() })
beforeEach(() => resetThrottle())

describe('contrato HTTP', () => {
  it('RN-08, DA-3: campos vazios, JSON inválido e campos que não são texto dão 400 empty_fields, sem contar nem registrar', async () => {
    const casos = [
      signIn('', PW), signIn(ANA_EMAIL, ''), signIn('   ', PW),
      signIn(undefined, undefined, { rawBody: 'isto não é json' }),
      signIn(undefined, undefined, { rawBody: JSON.stringify({ identifier: 123, password: true }) }),
      signIn(undefined, undefined, { rawBody: '{}' }),
    ]
    for (const r of await Promise.all(casos)) {
      assert.equal(r.status, 400, r.text)
      assert.deepEqual(r.body, { result: 'empty_fields' })
      assert.equal(r.headers.get('cache-control'), 'no-store')
    }
    assert.equal(sql('SELECT count(*) FROM private.sign_in_throttle;'), '0', 'nada conta')
  })

  it('RN-07: todos os casos (a) a (g) dão 401 com o mesmo corpo, byte a byte, sem dado do cadastro', async () => {
    const casos = {
      'a inválida': ['ana.souza', PW],
      'b não encontrada': [`ninguem@${DOMAIN}`, PW],
      'c ambígua': ['(51) 90000-2001', PW],
      'd excluída': [`excluida@${DOMAIN}`, PW],
      'e sem conta': [`semconta@${DOMAIN}`, PW],
      'f conta indisponível': [`banida@${DOMAIN}`, PW],
      'g senha errada': [ANA_EMAIL, 'senha-errada'],
    }
    const corpos = new Set()
    for (const [nome, [id, pw]] of Object.entries(casos)) {
      const r = await signIn(id, pw)
      assert.equal(r.status, 401, `${nome}: ${r.text}`)
      assert.equal(r.headers.get('cache-control'), 'no-store')
      corpos.add(r.text)
      assert.deepEqual(r.body, { result: 'invalid_credentials' }, nome)
    }
    assert.equal(corpos.size, 1, 'o corpo é idêntico em todos os casos')
  })

  it('RN-07, RN-08, DA-4: identificação com mais de 254 caracteres também dá 401', async () => {
    const r = await signIn('a'.repeat(300), PW)
    assert.equal(r.status, 401)
    assert.deepEqual(r.body, { result: 'invalid_credentials' })
  })

  it('RN-10, RN-12: a 5ª falha dá 429 locked, retry_after_minutes 15 e Retry-After em segundos', async () => {
    for (let i = 1; i <= 4; i++) assert.equal((await signIn(ANA_MOBILE, `errada-${i}`)).status, 401)
    const r = await signIn('+55 (51) 90000-2000', 'errada-5')
    assert.equal(r.status, 429, r.text)
    assert.deepEqual(r.body, { result: 'locked', retry_after_minutes: 15 })
    const retry = Number(r.headers.get('retry-after'))
    assert.ok(retry >= 895 && retry <= 900, `Retry-After = ${retry}`)
    const depois = await signIn(ANA_MOBILE, PW)
    assert.equal(depois.status, 429, 'a senha certa durante o bloqueio também dá 429')
    assert.equal((await signIn(ANA_EMAIL, PW)).status, 200, 'o e-mail de Ana segue livre')
  })

  it('405 e 413: método errado e corpo grande dão server_error', async () => {
    const get = await signIn(undefined, undefined, { method: 'GET' })
    assert.equal(get.status, 405)
    assert.deepEqual(get.body, { result: 'server_error' })
    const grande = await signIn(undefined, undefined, { rawBody: JSON.stringify({ identifier: 'x'.repeat(5000), password: 'y' }) })
    assert.equal(grande.status, 413)
    assert.deepEqual(grande.body, { result: 'server_error' })
  })

  it('CORS: o preflight (OPTIONS) responde e permite POST', async () => {
    const res = await fetch(`${URL_BASE}/functions/v1/sign-in`, { method: 'OPTIONS', headers: { Origin: 'https://exemplo.test', 'Access-Control-Request-Method': 'POST', apikey: ANON } })
    assert.ok(res.status === 200 || res.status === 204, `status ${res.status}`)
    assert.match(res.headers.get('access-control-allow-methods') ?? '', /POST/)
  })
})

describe('sessão (RN-13, RN-14)', () => {
  it('RN-13: o login com sucesso devolve só a sessão mínima, sem user nem e-mail', async () => {
    const r = await signIn(ANA_EMAIL, PW)
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(Object.keys(r.body).sort(), ['result', 'session'])
    assert.equal(r.body.result, 'ok')
    assert.deepEqual(Object.keys(r.body.session).sort(), ['access_token', 'expires_at', 'expires_in', 'refresh_token', 'token_type'])
    assert.equal(r.body.session.token_type, 'bearer')
    assert.equal(typeof r.body.session.expires_in, 'number')
    assert.equal(typeof r.body.session.expires_at, 'number')
    assert.ok(!/ana@|e104edge|user/i.test(r.text), 'nenhum e-mail nem objeto user na resposta')
    assert.equal(r.headers.get('cache-control'), 'no-store')
  })

  it('RN-01: Ana entra com e-mail, CPF e celular, e a sessão é dela', async () => {
    for (const id of [ANA_EMAIL, ANA_CPF, ANA_MOBILE]) {
      const r = await signIn(id, PW)
      assert.equal(r.status, 200, `${id}: ${r.text}`)
      const u = await fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${r.body.session.access_token}` } })
      assert.equal(u.status, 200)
      assert.equal((await u.json()).id, massa.auth.ana)
    }
  })

  it('RN-14: a sessão emitida renova com refresh_token e sai com logout', async () => {
    const r = await signIn(ANA_EMAIL, PW)
    const ren = await fetch(`${URL_BASE}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: r.body.session.refresh_token }),
    })
    assert.equal(ren.status, 200, await ren.clone().text())
    const nova = await ren.json()
    assert.ok(nova.access_token && nova.refresh_token)
    const out = await fetch(`${URL_BASE}/auth/v1/logout`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${nova.access_token}` } })
    assert.ok(out.status === 204 || out.status === 200, `logout: ${out.status}`)
  })

  it('RN-15 a: o login com sucesso grava "Login realizado" com Ana como autora; a falha não grava login', async () => {
    sql(`DELETE FROM public.events WHERE entity = 'auth' AND (entity_label = 'E104 Edge Ana');`)
    await signIn(ANA_EMAIL, 'errada')
    assert.equal(sql(`SELECT count(*) FROM public.events WHERE entity = 'auth' AND action = 'login' AND entity_label = 'E104 Edge Ana';`), '0')
    const r = await signIn(ANA_CPF, PW)
    assert.equal(r.status, 200)
    const ev = JSON.parse(sql(`SELECT to_jsonb(e) FROM public.events e WHERE entity = 'auth' AND action = 'login' AND entity_label = 'E104 Edge Ana' LIMIT 1;`))
    assert.equal(ev.actor_user_id, massa.auth.ana)
    assert.equal(ev.entity_id, massa.ids.ana)
    assert.equal(ev.description, 'Login realizado')
    assert.deepEqual(ev.metadata, { identifier_type: 'cpf', identifier_masked: '***5009' })
    assert.ok(!JSON.stringify(ev).includes(PW))
  })

  it('RN-15 b, risco 17: a identificação inválida, inclusive a de mais de 254 caracteres, vai para a Auditoria só como "***"', async () => {
    for (const id of ['Senha#Forte1', `Senha#Forte1${'z'.repeat(250)}`, `${'s'.repeat(250)}@x.com`]) {
      const t0 = sql(`SELECT clock_timestamp()::text;`)
      const r = await signIn(id, 'x')
      assert.equal(r.status, 401, r.text)
      const meta = JSON.parse(sql(`SELECT metadata FROM public.events WHERE entity = 'auth' AND action = 'login_failed'
                                     AND occurred_at >= '${t0}'::timestamptz ORDER BY occurred_at DESC LIMIT 1;`))
      assert.deepEqual(meta, { reason: 'invalid_identifier', identifier_masked: '***' }, `${id.length} caracteres`)
    }
  })

  it('DA-13: 6 logins simultâneos da mesma conta dão 200 (nova tentativa com otp_expired) e não deixam link pendente', async () => {
    const rs = await Promise.all(Array.from({ length: 6 }, () => signIn(ANA_EMAIL, PW)))
    for (const r of rs) assert.equal(r.status, 200, r.text)
    assert.equal(new Set(rs.map((r) => r.body.session.refresh_token)).size, 6, 'seis sessões diferentes')
    assert.equal(sql(`SELECT count(*) FROM auth.one_time_tokens WHERE user_id = '${massa.auth.ana}' AND token_type = 'recovery_token';`), '0')
  })
})

describe('origem confiável (DT-06, RN-11)', () => {
  const origemUsada = (ip) => failuresOf('origin', `o:${ip}`)

  it('conta só o CF-Connecting-IP: XFF, True-Client-IP, Forwarded e X-Real-IP diferentes não contam', async () => {
    const r = await signIn('ninguem@e104edge.invalid', 'x', {
      ip: '198.18.9.1',
      headers: { 'X-Forwarded-For': '198.18.9.2, 198.18.9.3', 'True-Client-IP': '198.18.9.4', Forwarded: 'for=198.18.9.5', 'X-Real-IP': '198.18.9.6' },
    })
    assert.equal(r.status, 401)
    assert.equal(origemUsada('198.18.9.1'), 1)
    for (const outro of ['198.18.9.2', '198.18.9.3', '198.18.9.4', '198.18.9.5', '198.18.9.6']) assert.equal(origemUsada(outro), null, outro)
    assert.equal(originRowCount(), 1, 'uma única linha de origem')
  })

  it('XFF que muda a cada pedido não muda a origem: 3 falhas com o mesmo CF-Connecting-IP somam na mesma linha', async () => {
    for (let i = 1; i <= 3; i++) await signIn(`ninguem${i}@e104edge.invalid`, 'x', { ip: '198.18.9.10', headers: { 'X-Forwarded-For': `203.0.113.${i}` } })
    assert.equal(origemUsada('198.18.9.10'), 3)
    assert.equal(originRowCount(), 1)
  })

  it('duas origens diferentes contam em linhas diferentes', async () => {
    await signIn('ninguem@e104edge.invalid', 'x', { ip: '198.18.9.20' })
    await signIn('ninguem@e104edge.invalid', 'x', { ip: '198.18.9.21' })
    assert.equal(origemUsada('198.18.9.20'), 1)
    assert.equal(origemUsada('198.18.9.21'), 1)
  })

  it('IPv4 mapeado conta como o IPv4; IPv6 conta pelo /64', async () => {
    await signIn('ninguem@e104edge.invalid', 'x', { ip: '::ffff:198.18.9.30' })
    await signIn('ninguem@e104edge.invalid', 'x', { ip: '198.18.9.30' })
    assert.equal(origemUsada('198.18.9.30'), 2)
    await signIn('ninguem@e104edge.invalid', 'x', { ip: '2001:db8:abcd:12::1' })
    await signIn('ninguem@e104edge.invalid', 'x', { ip: '2001:db8:abcd:12:ffff::2' })
    assert.equal(origemUsada('2001:db8:abcd:12::/64'), 2)
  })

  it('stack local, sem CF-Connecting-IP (ou com valor inválido): a origem é 127.0.0.1', async () => {
    await signIn('ninguem@e104edge.invalid', 'x', { ip: null })
    await signIn('ninguem@e104edge.invalid', 'x', { ip: 'isto-nao-e-um-ip' })
    assert.equal(origemUsada('127.0.0.1'), 2)
  })

  it('RN-11: 50 falhas da mesma origem, com identificações diferentes, bloqueiam a origem (429) e Ana não entra daquela origem', async () => {
    const ip = '198.18.9.40'
    sql(`DELETE FROM private.sign_in_throttle;`)
    // As 45 primeiras falhas são gravadas direto (50 pedidos em série levariam 35 s pelo piso);
    // as 5 últimas passam pela função: a 46ª a 49ª dão 401 (o limite antigo, 20, já ficou para trás)
    // e a 50ª bloqueia.
    sql(`INSERT INTO private.sign_in_throttle (kind, key_hash, failures, expires_at)
         SELECT 'origin', private.sign_in_key('origin', 'o:${ip}'),
                array_agg(clock_timestamp() - interval '5 minutes' + (i || ' seconds')::interval ORDER BY i), now() + interval '15 minutes'
           FROM generate_series(1, 45) i;`)
    assert.equal(failuresOf('origin', `o:${ip}`), 45)
    const rs = []
    for (let i = 46; i <= 50; i++) rs.push(await signIn(`ninguem${i}@e104edge.invalid`, 'x', { ip }))
    assert.deepEqual(rs.slice(0, 4).map((r) => r.status), Array(4).fill(401))
    assert.equal(rs[4].status, 429)
    assert.equal((await signIn(ANA_EMAIL, PW, { ip })).status, 429)
    assert.equal((await signIn(ANA_EMAIL, PW, { ip: '198.18.9.41' })).status, 200, 'de outra origem, entra')
  })
})

describe('erros, piso e logs', () => {
  it('P-LOG-12, RN-08: sem a chave do Vault a RPC dá erro e a função responde 500 server_error, sem contar', async () => {
    const id = sql(`SELECT id FROM vault.decrypted_secrets WHERE name = 'sign_in_throttle_key';`)
    assert.ok(id, 'a chave do Vault existe')
    sql(`SELECT vault.update_secret('${id}', new_name => 'sign_in_throttle_key_ausente');`)
    try {
      const r = await signIn(ANA_EMAIL, 'errada')
      assert.equal(r.status, 500, r.text)
      assert.deepEqual(r.body, { result: 'server_error' })
      assert.equal(sql('SELECT count(*) FROM private.sign_in_throttle;'), '0', 'nada foi contado')
    } finally {
      sql(`SELECT vault.update_secret('${id}', new_name => 'sign_in_throttle_key');`)
    }
    assert.equal((await signIn(ANA_EMAIL, 'errada')).status, 401, 'com a chave de volta, volta ao normal')
  })

  it(`RN-07, DT-07: as respostas 401 e 429 levam pelo menos o piso de ${FAILURE_FLOOR_MS} ms`, async () => {
    const invalida = await signIn('ana.souza', 'x')
    assert.ok(invalida.ms >= FAILURE_FLOOR_MS - 30, `401 levou ${invalida.ms.toFixed(0)} ms`)
    const errada = await signIn(ANA_EMAIL, 'errada')
    assert.ok(errada.ms >= FAILURE_FLOOR_MS - 30, `401 (senha errada) levou ${errada.ms.toFixed(0)} ms`)
    sql(`INSERT INTO private.sign_in_throttle (kind, key_hash, failures, blocked_until, expires_at)
         VALUES ('identifier', private.sign_in_key('identifier', 'e:${ANA_EMAIL}'), '{}', now() + interval '10 minutes', now() + interval '10 minutes')
         ON CONFLICT (kind, key_hash) DO UPDATE SET failures = '{}', blocked_until = excluded.blocked_until, expires_at = excluded.expires_at;`)
    const bloqueada = await signIn(ANA_EMAIL, PW)
    assert.equal(bloqueada.status, 429)
    assert.ok(bloqueada.ms >= FAILURE_FLOOR_MS - 30, `429 levou ${bloqueada.ms.toFixed(0)} ms`)
  })

  it('RN-09, RN-15 d: os logs da função não têm identificação, senha, e-mail da conta, token nem origem', async (t) => {
    const cmd = process.env.EDGE_LOGS_CMD
    if (!cmd) return t.skip('defina EDGE_LOGS_CMD (ver o cabeçalho deste arquivo)')
    const senhaUnica = 'Sen-ha-Unica-8472'
    const idUnico = 'logcheck-unico@e104edge.invalid'
    const ipUnico = '198.18.9.77'
    await signIn(idUnico, senhaUnica, { ip: ipUnico })
    await signIn(ANA_EMAIL, senhaUnica, { ip: ipUnico })
    const ok = await signIn(ANA_EMAIL, PW, { ip: ipUnico })
    await signIn(undefined, undefined, { rawBody: 'não é json', ip: ipUnico })
    await new Promise((r) => setTimeout(r, 1500))
    const logs = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: '/bin/bash' })
    for (const proibido of [senhaUnica, PW, idUnico, ANA_EMAIL, ANA_CPF, '168.995.350', '16899535009', ipUnico, ok.body.session.access_token, ok.body.session.refresh_token]) {
      assert.ok(!logs.includes(proibido), `o log contém "${proibido.slice(0, 12)}..."`)
    }
  })
})
