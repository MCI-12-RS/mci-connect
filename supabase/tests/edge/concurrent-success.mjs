#!/usr/bin/env node
// E1.04 (PR 1): N logins com senha certa, simultâneos, da mesma origem (stack local).
// Mostra quando o lock_timeout de 3 s da linha da origem começa a virar 500. Só medição: não falha.
// Uso: (variáveis de sign-in.edge.test.mjs) node supabase/tests/edge/concurrent-success.mjs [10 30 50]
import { DOMAIN, PW, cleanupMassa, createMassa, resetThrottle, signIn } from './support.mjs'

const ns = process.argv.slice(2).map(Number).filter(Boolean)
const tamanhos = ns.length ? ns : [10, 30, 50]
await createMassa()
try {
  console.log('| N | 200 | 429 | 500 | outros | tempo do último (ms) | mediana (ms) |')
  console.log('|---|---|---|---|---|---|---|')
  for (const n of tamanhos) {
    resetThrottle()
    const t0 = performance.now()
    const rs = await Promise.all(Array.from({ length: n }, () => signIn(`ana@${DOMAIN}`, PW, { ip: '198.18.77.7' })))
    const last = performance.now() - t0
    const c = (s) => rs.filter((r) => r.status === s).length
    const outros = rs.filter((r) => ![200, 429, 500].includes(r.status)).length
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b)
    console.log(`| ${n} | ${c(200)} | ${c(429)} | ${c(500)} | ${outros} | ${last.toFixed(0)} | ${ms[ms.length >> 1].toFixed(0)} |`)
  }
} finally {
  await cleanupMassa()
}
