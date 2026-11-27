// Vitest. E1.04: Contratos, RN-07 (corpo e piso), RN-08, RN-13, DT-18; E2.03: must_change_password;
// E3: credential (DT-07) e o texto que o banco não guarda (DA-1).
import { describe, expect, it, vi } from 'vitest'
import {
  FAILURE_FLOOR_MS,
  attemptCredential,
  isAttemptResult,
  isOtpExpired,
  isUserCreatedByLink,
  isWellFormedText,
  lockedReply,
  pickSession,
  readCredentials,
  remainingFloorMs,
  reply,
  waitForFloor,
} from './contract.ts'

const okAttempt = {
  result: 'ok',
  member_id: 'c1040000-0000-0000-0000-000000000001',
  auth_user_id: 'a1040000-0000-0000-0000-000000000001',
  auth_email: 'ana@exemplo.com',
  identifier_type: 'cpf',
  identifier_masked: '***4725',
  password_action: null,
  must_change_password: false,
}

describe('reply', () => {
  it('sempre com no-store, CORS e JSON', async () => {
    const res = reply(401, { result: 'invalid_credentials' })
    expect(res.status).toBe(401)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await res.json()).toEqual({ result: 'invalid_credentials' })
  })

  it('429 com os minutos no corpo e os segundos no Retry-After', async () => {
    const res = lockedReply(601, 11)
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('601')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ result: 'locked', retry_after_minutes: 11 })
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
    { ...okAttempt, must_change_password: true },
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
    { ...okAttempt, must_change_password: undefined },
    { ...okAttempt, must_change_password: null },
    { ...okAttempt, must_change_password: 'false' },
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

describe('E3: credential no sucesso (DT-07)', () => {
  it('ausente (RPC anterior ao E3) é aceita e vale como account', () => {
    expect(isAttemptResult(okAttempt)).toBe(true)
    expect(attemptCredential(okAttempt)).toBe('account')
  })
  it('account e legacy são aceitas e passam adiante', () => {
    expect(isAttemptResult({ ...okAttempt, credential: 'account' })).toBe(true)
    expect(isAttemptResult({ ...okAttempt, credential: 'legacy' })).toBe(true)
    expect(attemptCredential({ credential: 'legacy' })).toBe('legacy')
  })
  it('qualquer outro valor é fora do contrato (500)', () => {
    for (const credential of ['', 'LEGACY', 'md5', null, 1, true, {}]) {
      expect(isAttemptResult({ ...okAttempt, credential })).toBe(false)
    }
  })
})

describe('E3: isWellFormedText (DA-1)', () => {
  it('aceita texto comum, acentos compostos e decompostos, emoji e espaços', () => {
    for (const text of ['Graça2024!', 'Grac\u0327a2024!', ' mesa azul ', '🙏 fé', 'x'.repeat(80), '123456']) {
      expect(isWellFormedText(text)).toBe(true)
    }
  })
  it('recusa U+0000 em qualquer posição', () => {
    for (const text of ['\u0000', 'abc\u0000', '\u0000abc', 'a\u0000b']) {
      expect(isWellFormedText(text)).toBe(false)
    }
  })
  it('recusa surrogate isolado (alto ou baixo), no começo, no meio ou no fim', () => {
    for (const text of ['\uD83D', '\uDE4F', 'abc\uD83D', '\uDE4Fabc', 'a\uD83Db', 'a\uDE4F\uD83Db', '\uD83D\uD83D\uDE4F']) {
      expect(isWellFormedText(text)).toBe(false)
    }
  })
  it('o par completo (emoji) é bem formado', () => {
    expect(isWellFormedText('\uD83D\uDE4F')).toBe(true)
  })
})
