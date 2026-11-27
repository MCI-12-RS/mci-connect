#!/usr/bin/env node
// E1.04 (PR 1): medição de tempo da RN-07 e da DT-07 (tempo igual).
// Spec: docs/specs/e1-04-sign-in.md, RN-07 ("em 20 tentativas de cada caso, a mediana de cada caso fica
// a menos de 100 ms da mediana de 'senha errada'"), "Tempo igual" (piso de 700 ms, p99 de cada caso abaixo do piso).
//
// Mede, contra a stack local, 20 tentativas de cada caso:
//   a identificação inválida, b não encontrada, c ambígua, d excluída, e sem conta, f conta indisponível,
//   g senha errada (a referência) e h bloqueada (429); E3: i senha errada conferida pela credencial
//   legada e j conta sem senha (no_password, o bcrypt fictício).
// Duas medidas:
//   - banco: o tempo da RPC sign_in_attempt, medido pelo \timing do psql dentro do contêiner (sem rede).
//     É o que o piso precisa absorver: o p99 de cada caso fica abaixo de 700 ms.
//   - http: o tempo total da função (inclui o piso). A mediana de cada caso fica a menos de 100 ms da de "g".
//
// Uso (stack local, ver sign-in.edge.test.mjs para as variáveis):
//   SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/tests/edge/timing.mjs [--n 20] [--db-only | --http-only]
// Imprime uma tabela em Markdown (para anexar ao PR) e sai com código 1 se algum critério falhar.
import { execSync } from 'node:child_process'
import {
  DOMAIN, FAILURE_FLOOR_MS, PSQL, PW, cleanupMassa, createLegacyMember, createMassa, median, percentile, resetThrottle, signIn, sql, freshOrigin,
} from './support.mjs'

const args = process.argv.slice(2)
const N = Number(args[args.indexOf('--n') + 1]) || 20
const doDb = !args.includes('--http-only')
const doHttp = !args.includes('--db-only')
const MAX_MEDIAN_DIFF_MS = 100

const ANA = `ana@${DOMAIN}`
const casos = [
  { id: 'a', nome: 'identificação inválida', ident: () => 'ana.souza', pw: 'errada' },
  { id: 'b', nome: 'não encontrada', ident: (i) => `ninguem${i}@${DOMAIN}`, pw: 'errada' },
  { id: 'c', nome: 'ambígua', ident: () => '51900002060', pw: PW },
  { id: 'd', nome: 'cadastro excluído', ident: () => `excluida@${DOMAIN}`, pw: PW },
  { id: 'e', nome: 'sem conta de acesso', ident: () => `semconta@${DOMAIN}`, pw: PW },
  { id: 'f', nome: 'conta indisponível', ident: () => `banida@${DOMAIN}`, pw: PW },
  { id: 'g', nome: 'senha errada (referência)', ident: () => ANA, pw: 'errada' },
  { id: 'h', nome: 'bloqueada (429)', ident: () => ANA, pw: PW, blocked: true },
  { id: 'i', nome: 'senha errada, credencial legada (E3)', ident: () => `legado@${DOMAIN}`, pw: 'errada' },
  { id: 'j', nome: 'sem senha definida (E3)', ident: () => `semsenha@${DOMAIN}`, pw: PW },
]
const esc = (s) => s.replace(/'/g, "''")
const blockSql = `INSERT INTO private.sign_in_throttle (kind, key_hash, failures, blocked_until, expires_at)
  VALUES ('identifier', private.sign_in_key('identifier', 'e:${ANA}'), '{}', now() + interval '10 minutes', now() + interval '10 minutes');`

function medirBanco(caso) {
  const linhas = []
  for (let i = 1; i <= N; i++) {
    linhas.push('\\timing off', 'RESET ROLE;', 'DELETE FROM private.sign_in_throttle;')
    if (caso.blocked) linhas.push(blockSql)
    linhas.push('SET ROLE service_role;', '\\timing on',
      `SELECT public.sign_in_attempt('${esc(caso.ident(i))}', '${esc(caso.pw)}', '${freshOrigin()}') AS r \\g /dev/null`)
  }
  const out = execSync(`${PSQL} -X -At -v ON_ERROR_STOP=1`, { input: linhas.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const tempos = [...out.matchAll(/^Time: ([\d.]+) ms/gm)].map((m) => Number(m[1]))
  if (tempos.length !== N) throw new Error(`caso ${caso.id}: ${tempos.length} tempos lidos, esperava ${N}\n${out.slice(0, 500)}`)
  return tempos
}

async function medirHttp(caso) {
  const tempos = []
  for (let i = 1; i <= N; i++) {
    resetThrottle()
    if (caso.blocked) sql(blockSql)
    const r = await signIn(caso.ident(i), caso.pw)
    const esperado = caso.blocked ? 429 : 401
    if (r.status !== esperado) throw new Error(`caso ${caso.id}: status ${r.status} (esperava ${esperado}): ${r.text}`)
    tempos.push(r.ms)
  }
  return tempos
}

const fmt = (x) => x.toFixed(0).padStart(5)
function relatorio(titulo, resultados, limiteP99) {
  const ref = median(resultados.g)
  let falhou = false
  const linhas = [`### ${titulo}`, '', '| Caso | n | mediana (ms) | dif. da mediana de "g" (ms) | p99 (ms) | critério |', '|---|---|---|---|---|---|']
  for (const c of casos) {
    const t = resultados[c.id]
    const med = median(t)
    const dif = med - ref
    const p99 = percentile(t, 0.99)
    const okDif = Math.abs(dif) < MAX_MEDIAN_DIFF_MS
    const okP99 = limiteP99 === null || p99 < limiteP99
    if (!okDif || !okP99) falhou = true
    linhas.push(`| ${c.id} ${c.nome} | ${t.length} | ${fmt(med)} | ${dif >= 0 ? '+' : ''}${dif.toFixed(0)} | ${fmt(p99)} | ${okDif && okP99 ? 'ok' : 'FALHOU'} |`)
  }
  console.log(linhas.join('\n') + '\n')
  return !falhou
}

await createMassa()
await createLegacyMember('E104 Edge Legado', `legado@${DOMAIN}`, 'Legado#Edge1')
const semSenha = await createLegacyMember('E104 Edge Sem Senha', `semsenha@${DOMAIN}`, 'qualquer')
sql(`UPDATE private.legacy_credentials SET legacy_hash = NULL, discarded_at = now() WHERE member_id = '${semSenha.memberId}';`)
let tudoOk = true
try {
  if (doDb) {
    const r = {}
    for (const c of casos) r[c.id] = medirBanco(c)
    tudoOk = relatorio(`Banco: sign_in_attempt (piso de ${FAILURE_FLOOR_MS} ms; p99 abaixo do piso)`, r, FAILURE_FLOOR_MS) && tudoOk
  }
  if (doHttp) {
    const r = {}
    for (const c of casos) r[c.id] = await medirHttp(c)
    const menor = Math.min(...Object.values(r).flat())
    console.log(`Menor tempo HTTP observado: ${menor.toFixed(0)} ms (o piso é ${FAILURE_FLOOR_MS} ms)\n`)
    tudoOk = relatorio('HTTP: função sign-in (inclui o piso)', r, null) && tudoOk
    if (menor < FAILURE_FLOOR_MS - 30) { console.log('FALHOU: alguma resposta 401/429 saiu antes do piso'); tudoOk = false }
  }
} finally {
  await cleanupMassa()
}
console.log(tudoOk ? 'RESULTADO: RN-07 cumprida (medianas a menos de 100 ms da de "senha errada"; p99 abaixo do piso)' : 'RESULTADO: RN-07 NÃO cumprida')
process.exit(tudoOk ? 0 : 1)
