// Transporte HTTP comum das funções chamadas pela tela sem o gateway conferir o
// JWT: `sign-in` (E1.04) e `change-own-password` (E2.03, DT-18).
//
// Módulo puro (sem Deno nem import remoto), testado pelo Vitest: CORS, resposta
// JSON com `Cache-Control: no-store`, preflight e leitura do corpo com teto de
// bytes (DA-3 do E1.04). O contrato de cada função (corpos, códigos e a leitura
// da RPC) fica na pasta dela.

/** Tamanho máximo do corpo (DA-3 do E1.04). */
export const MAX_BODY_BYTES = 4096

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Objeto JSON (não nulo e não lista), sem asserção de tipo. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Resposta JSON, sempre com CORS e `Cache-Control: no-store`. Cada função tipa o corpo. */
export function jsonReply(status: number, body: object, extraHeaders: Record<string, string> = {}): Response {
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
 * O token do cabeçalho `Authorization: Bearer <token>`, ou null. Só o esquema
 * Bearer, sem diferenciar maiúsculas; espaços nas pontas são ignorados.
 */
export function bearerToken(headers: { get(name: string): string | null }): string | null {
  const match = /^\s*Bearer\s+(\S+)\s*$/i.exec(headers.get('authorization') ?? '')
  return match ? match[1] : null
}
