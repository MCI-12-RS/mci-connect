// Vitest. E1.04: Contratos, DA-3, RN-07 (corpo e piso), RN-08, RN-13, DT-18.
import { describe, expect, it, vi } from 'vitest'
import {
  FAILURE_FLOOR_MS,
  isAttemptResult,
  isOtpExpired,
  isUserCreatedByLink,
  lockedReply,
  MAX_BODY_BYTES,
  pickSession,
  preflight,
  readCredentials,
  readJsonBody,
  remainingFloorMs,
  reply,
  waitForFloor,
} from './http.ts'

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('http://localhost/functions/v1/sign-in', { method: 'POST', body, headers })

const okAttempt = {
  result: 'ok',
  member_id: 'c1040000-0000-0000-0000-000000000001',
  auth_user_id: 'a1040000-0000-0000-0000-000000000001',
  auth_email: 'ana@exemplo.com',
  identifier_type: 'cpf',
  identifier_masked: '***4725',
  password_action: null,
}

describe('reply', () => {
  it('sempre com no-store, CORS e JSON', async () => {
    const res = reply(401, { result: 'invalid_credentials' })
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(res.headers.get('Access-Control-Allow-Methods')).toBe('POST, OPTIONS')
    expect(res.headers.get('Content-Type')).toBe('application/json')
    expect(await res.json()).toEqual({ result: 'invalid_credentials' })
  })

  it('429 com os minutos no corpo e os segundos no Retry-After', async () => {
    const res = lockedReply(601, 11)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('601')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ result: 'locked', retry_after_minutes: 11 })
  })

  it('preflight com CORS e no-store', () => {
    const res = preflight()
    expect(res.status).toBe(200)
    expect(res.headers.get('Access-Control-Allow-Headers')).toContain('apikey')
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

describe('readCredentials', () => {
  it('devolve a identificação e a senha como vieram (RN-09)', () => {
    expect(readCredentials({ identifier: '  Ana@X.com ', password: ' Fé 2024' })).toEqual({
      identifier: '  Ana@X.com ',
      password: ' Fé 2024',
    })
  })

  it('a senha só com espaços não é vazia (P-LOG-13)', () => {
    expect(readCredentials({ identifier: 'ana@x.com', password: '   ' })).not.toBeNull()
  })

  it.each([
    null,
    'texto',
    [],
    {},
    { identifier: 'ana@x.com' },
    { password: 'x' },
    { identifier: '', password: 'x' },
    { identifier: '   ', password: 'x' },
    { identifier: '\t\n', password: 'x' },
    { identifier: 'ana@x.com', password: '' },
    { identifier: 123, password: 'x' },
    { identifier: 'ana@x.com', password: 123 },
    { identifier: ['ana@x.com'], password: 'x' },
    { identifier: 'ana@x.com', password: null },
  ])('%j conta como campos vazios (RN-08, DA-3)', (body) => {
    expect(readCredentials(body)).toBeNull()
  })
})

describe('piso das falhas (RN-07, DT-07)', () => {
  it('é de 700 ms', () => {
    expect(FAILURE_FLOOR_MS).toBe(700)
  })

  it('remainingFloorMs', () => {
    expect(remainingFloorMs(1000, 1000)).toBe(700)
    expect(remainingFloorMs(1000, 1500)).toBe(200)
    expect(remainingFloorMs(1000, 1700)).toBe(0)
    expect(remainingFloorMs(1000, 2500)).toBe(0)
  })

  it('waitForFloor espera só o que falta', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    await waitForFloor(1000, () => 1250, sleep)
    expect(sleep).toHaveBeenCalledWith(450)
  })

  it('waitForFloor não espera depois do piso', async () => {
    const sleep = vi.fn(() => Promise.resolve())
    await waitForFloor(1000, () => 1800, sleep)
    expect(sleep).not.toHaveBeenCalled()
  })
})

describe('isAttemptResult', () => {
  it.each([
    { result: 'empty_fields' },
    { result: 'invalid' },
    { result: 'locked', retry_after_seconds: 900, retry_after_minutes: 15 },
    { result: 'locked', retry_after_seconds: 1, retry_after_minutes: 1 },
    okAttempt,
    { ...okAttempt, identifier_type: 'email' },
    { ...okAttempt, identifier_type: 'mobile' },
    { ...okAttempt, identifier_type: 'cpf_or_mobile' },
  ])('aceita %j', (value) => {
    expect(isAttemptResult(value)).toBe(true)
  })

  it.each([
    null,
    'ok',
    [],
    {},
    { result: 'outro' },
    { result: 'locked' },
    { result: 'locked', retry_after_seconds: 0, retry_after_minutes: 1 },
    { result: 'locked', retry_after_seconds: 900, retry_after_minutes: 0.5 },
    { result: 'locked', retry_after_seconds: '900', retry_after_minutes: 15 },
    { ...okAttempt, member_id: '' },
    { ...okAttempt, auth_user_id: null },
    { ...okAttempt, auth_email: undefined },
    { ...okAttempt, identifier_type: 'telefone' },
    { ...okAttempt, identifier_masked: '' },
    { ...okAttempt, password_action: 'set' },
    { ...okAttempt, password_action: undefined },
  ])('recusa %j (fora do contrato: 500)', (value) => {
    expect(isAttemptResult(value)).toBe(false)
  })
})

describe('pickSession (RN-13)', () => {
  const verifyBody = {
    access_token: 'eyJ.a.b',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_800_000_000,
    refresh_token: 'r3fr3sh',
    user: { id: 'a1', email: 'ana@exemplo.com', phone: '' },
    weak_password: null,
  }

  it('devolve só os cinco campos, sem o user', () => {
    expect(pickSession(verifyBody)).toEqual({
      access_token: 'eyJ.a.b',
      refresh_token: 'r3fr3sh',
      expires_in: 3600,
      expires_at: 1_800_000_000,
      token_type: 'bearer',
    })
  })

  it.each([
    null,
    {},
    { ...verifyBody, access_token: '' },
    { ...verifyBody, refresh_token: undefined },
    { ...verifyBody, expires_in: '3600' },
    { ...verifyBody, expires_at: undefined },
    { ...verifyBody, token_type: '' },
  ])('recusa %j', (value) => {
    expect(pickSession(value)).toBeNull()
  })
})

describe('respostas do Auth (DT-18)', () => {
  it('isOtpExpired', () => {
    expect(isOtpExpired({ code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' })).toBe(true)
    expect(isOtpExpired({ code: 429, error_code: 'over_request_rate_limit' })).toBe(false)
    expect(isOtpExpired(null)).toBe(false)
  })

  it('isUserCreatedByLink: só o usuário recém-criado, nunca confirmado e que nunca entrou', () => {
    const since = Date.parse('2026-11-24T12:00:00Z')
    const fresh = { created_at: '2026-11-24T12:00:30Z', email_confirmed_at: null, confirmed_at: null, last_sign_in_at: null }
    expect(isUserCreatedByLink(fresh, since)).toBe(true)
    expect(isUserCreatedByLink({ ...fresh, created_at: '2026-11-24T11:59:00Z' }, since)).toBe(false)
    expect(isUserCreatedByLink({ ...fresh, email_confirmed_at: '2026-11-24T12:00:31Z' }, since)).toBe(false)
    expect(isUserCreatedByLink({ ...fresh, confirmed_at: '2026-11-24T12:00:31Z' }, since)).toBe(false)
    expect(isUserCreatedByLink({ ...fresh, last_sign_in_at: '2026-11-24T12:00:31Z' }, since)).toBe(false)
    expect(isUserCreatedByLink({ ...fresh, created_at: 'nao-e-data' }, since)).toBe(false)
    expect(isUserCreatedByLink(null, since)).toBe(false)
  })
})
