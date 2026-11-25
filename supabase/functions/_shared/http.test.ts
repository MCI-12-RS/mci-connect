// Vitest. Transporte comum (E1.04: DA-3; E2.03: DT-18).
import { describe, expect, it } from 'vitest'
import { bearerToken, jsonReply, MAX_BODY_BYTES, preflight, readJsonBody } from './http.ts'

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/functions/v1/sign-in', { method: 'POST', body, headers })

describe('jsonReply', () => {
  it('sempre com no-store, CORS e JSON', async () => {
    const res = jsonReply(401, { result: 'invalid_credentials' })
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(await res.json()).toEqual({ result: 'invalid_credentials' })
  })

  it('cabeçalhos a mais não tiram o no-store', () => {
    const res = jsonReply(429, { result: 'change_blocked' }, { 'Retry-After': '900' })
    expect(res.headers.get('Retry-After')).toBe('900')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('preflight com CORS e no-store', () => {
    const res = preflight()
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('apikey')
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})

describe('readJsonBody', () => {
  it('lê o JSON', async () => {
    expect(await readJsonBody(post(JSON.stringify({ identifier: 'a', password: 'b' })))).toEqual({
      kind: 'ok',
      value: { identifier: 'a', password: 'b' },
    })
  })

  it('JSON inválido ou corpo vazio viram null (DA-3)', async () => {
    expect(await readJsonBody(post('{nao-e-json'))).toEqual({ kind: 'ok', value: null })
    expect(await readJsonBody(post(''))).toEqual({ kind: 'ok', value: null })
    expect(await readJsonBody(post(null))).toEqual({ kind: 'ok', value: null })
  })

  it('acima de 4 KB: too_large, pelo tamanho real', async () => {
    const big = JSON.stringify({ identifier: 'a', password: 'x'.repeat(MAX_BODY_BYTES) })
    expect(await readJsonBody(post(big))).toEqual({ kind: 'too_large' })
  })

  it('acima de 4 KB: too_large, pelo Content-Length, sem ler', async () => {
    expect(await readJsonBody(post('{}', { 'Content-Length': String(MAX_BODY_BYTES + 1) }))).toEqual({
      kind: 'too_large',
    })
  })

  it('exatamente 4 KB passa', async () => {
    const filler = 'x'.repeat(MAX_BODY_BYTES - JSON.stringify({ identifier: 'a', password: '' }).length)
    const body = JSON.stringify({ identifier: 'a', password: filler })
    expect(new TextEncoder().encode(body).byteLength).toBe(MAX_BODY_BYTES)
    expect((await readJsonBody(post(body))).kind).toBe('ok')
  })

  it('conta bytes, não caracteres', async () => {
    const body = JSON.stringify({ identifier: 'a', password: 'é'.repeat(MAX_BODY_BYTES / 2) })
    expect(await readJsonBody(post(body))).toEqual({ kind: 'too_large' })
  })
})

describe('bearerToken', () => {
  it.each([
    ['Bearer abc.def.ghi', 'abc.def.ghi'],
    ['bearer abc', 'abc'],
    ['  Bearer   abc  ', 'abc'],
  ])('%j → %j', (value, expected) => {
    expect(bearerToken(new Headers({ Authorization: value }))).toBe(expected)
  })

  it.each(['', 'Bearer', 'Bearer ', 'Basic abc', 'abc', 'Bearer a b'])('%j → null', (value) => {
    expect(bearerToken(new Headers({ Authorization: value }))).toBeNull()
  })

  it('sem o cabeçalho → null', () => {
    expect(bearerToken(new Headers())).toBeNull()
  })
})
