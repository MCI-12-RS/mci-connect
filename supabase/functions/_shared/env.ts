// Ambiente e chave das funções `sign-in` (E1.04: DT-06, DA-1, DT-10, risco 7) e
// `change-own-password` (E2.03, item 5 de "Trocas": a chave secreta nova).
//
// Módulo puro (sem Deno nem import remoto), testado pelo Vitest.
//
// - A função é "local" só se o host de `SUPABASE_URL` for um dos da stack
//   local. Qualquer outro host, ou uma URL ilegível, conta como hospedado
//   (falha fechada).
// - Hospedado, a chave é obrigatoriamente a secreta nova
//   (`JSON.parse(SUPABASE_SECRET_KEYS).default`): o `Sb-Forwarded-For` do
//   `/verify` só vale com ela. Sem ela, a função responde 500.
// - Local, pode cair na `SUPABASE_SERVICE_ROLE_KEY`.

const LOCAL_HOSTS = new Set(['kong', 'localhost', '127.0.0.1', 'host.docker.internal'])

/** true, a não ser que `SUPABASE_URL` aponte para a stack local. */
export function isHostedSupabaseUrl(url: string | null | undefined): boolean {
  if (!url) return true
  try {
    return !LOCAL_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return true
  }
}

/** A chave `default` de `SUPABASE_SECRET_KEYS` (JSON), ou null. */
export function defaultSecretKey(secretKeysJson: string | null | undefined): string | null {
  if (!secretKeysJson) return null
  try {
    const parsed: unknown = JSON.parse(secretKeysJson)
    if (typeof parsed !== 'object' || parsed === null || !('default' in parsed)) return null
    const key = parsed.default
    return typeof key === 'string' && key !== '' ? key : null
  } catch {
    return null
  }
}

/** A chave que a função usa para a RPC, a administração e o `/verify`, ou null. */
export function resolveServiceKey(env: {
  secretKeysJson: string | null | undefined
  serviceRoleKey: string | null | undefined
  hosted: boolean
}): string | null {
  const secret = defaultSecretKey(env.secretKeysJson)
  if (secret) return secret
  if (env.hosted) return null
  return env.serviceRoleKey ? env.serviceRoleKey : null
}
