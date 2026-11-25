// Vitest (o Deno não é usado nesta máquina).
import { describe, expect, it } from 'vitest'
import { INVALID_REQUEST_MESSAGE, HttpError } from './errors.ts'
import { MEMBER_FIELDS, parseCreateMemberRequest } from './request.ts'

const ATTEMPT = '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f'
const GENERATED = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const newId = () => GENERATED

const body = (extra: Record<string, unknown> = {}) => ({
  attemptId: ATTEMPT,
  password: '123456',
  memberData: { name: 'Lúcia Souza', gender: 'F', mobile_whatsapp: '(51) 99999-0000' },
  ...extra,
})

function refusal(raw: unknown): HttpError {
  try {
    parseCreateMemberRequest(raw, newId)
  } catch (error) {
    if (error instanceof HttpError) return error
    throw error
  }
  throw new Error('esperava recusa')
}

describe('parseCreateMemberRequest', () => {
  it('o pedido completo', () => {
    expect(parseCreateMemberRequest(body({ confirmDeletedMatches: true }), newId)).toEqual({
      attemptId: ATTEMPT,
      attemptIdFromClient: true,
      password: '123456',
      memberRow: { name: 'Lúcia Souza', gender: 'F', mobile_whatsapp: '(51) 99999-0000' },
      confirmDeletedMatches: true,
    })
  })

  it('attemptId em maiúsculas vira minúsculas (o id que o banco devolve)', () => {
    expect(parseCreateMemberRequest(body({ attemptId: ATTEMPT.toUpperCase() }), newId).attemptId).toBe(ATTEMPT)
  })

  it('attemptId ausente ou nulo → gerado, sem idempotência', () => {
    for (const attemptId of [undefined, null]) {
      const parsed = parseCreateMemberRequest(body({ attemptId }), newId)
      expect([parsed.attemptId, parsed.attemptIdFromClient]).toEqual([GENERATED, false])
    }
  })

  it('attemptId fora do UUID v4 → 400 invalid_request', () => {
    for (const attemptId of ['', 'abc', 123, '3f2b8c1e-9a4d-1c7b-8e2f-1a2b3c4d5e6f', `${ATTEMPT} `, '3f2b8c1e-9a4d-4c7b-7e2f-1a2b3c4d5e6f']) {
      const error = refusal(body({ attemptId }))
      expect([error.status, error.body()]).toEqual([400, { error: INVALID_REQUEST_MESSAGE, code: 'invalid_request' }])
    }
  })

  it('corpo ou memberData fora do formato → 400 invalid_request', () => {
    for (const raw of [null, 'x', [], body({ memberData: undefined }), body({ memberData: [] }), body({ memberData: 'x' })]) {
      expect(refusal(raw).code).toBe('invalid_request')
    }
  })

  it('senha ausente ou vazia → 400 invalid_request "Informe a senha."', () => {
    for (const password of [undefined, '', 123456]) {
      expect(refusal(body({ password })).body()).toEqual({ error: 'Informe a senha.', code: 'invalid_request' })
    }
  })

  it('só as colunas da lista branca: id, auth_user_id e colunas do servidor são descartados', () => {
    const parsed = parseCreateMemberRequest(body({
      memberData: {
        name: 'Lúcia Souza', id: '11111111-1111-4111-8111-111111111111', auth_user_id: 'x',
        g12_level: 3, total_cells: 9, deleted_at: '2026-01-01', created_at: 'x',
      },
    }), newId)
    expect(parsed.memberRow).toEqual({ name: 'Lúcia Souza' })
  })

  it('a lista branca não tem id nem auth_user_id', () => {
    expect(MEMBER_FIELDS).not.toContain('id')
    expect(MEMBER_FIELDS).not.toContain('auth_user_id')
  })

  it('o e-mail vem só de memberData, como veio; o do topo é ignorado', () => {
    const parsed = parseCreateMemberRequest(body({
      email: 'topo@exemplo.com',
      memberData: { name: 'Lúcia Souza', email: ' Lucia@Exemplo.com ' },
    }), newId)
    expect(parsed.memberRow).toEqual({ name: 'Lúcia Souza', email: ' Lucia@Exemplo.com ' })
    expect(parseCreateMemberRequest(body({ email: 'topo@exemplo.com' }), newId).memberRow).not.toHaveProperty('email')
  })

  it('has_leadership só vai se veio (o banco resolve a omitida)', () => {
    expect(parseCreateMemberRequest(body(), newId).memberRow).not.toHaveProperty('has_leadership')
    expect(parseCreateMemberRequest(body({ memberData: { name: 'A B', has_leadership: false } }), newId).memberRow)
      .toEqual({ name: 'A B', has_leadership: false })
  })

  it('role_id vazio vira nulo; os outros valores vão como vieram', () => {
    expect(parseCreateMemberRequest(body({ memberData: { name: 'A B', role_id: '' } }), newId).memberRow)
      .toEqual({ name: 'A B', role_id: null })
    expect(parseCreateMemberRequest(body({ memberData: { name: 'A B', role_id: 'r1', cpf: null } }), newId).memberRow)
      .toEqual({ name: 'A B', role_id: 'r1', cpf: null })
  })

  it('confirmDeletedMatches só com true', () => {
    for (const value of [undefined, 'true', 1, false]) {
      expect(parseCreateMemberRequest(body({ confirmDeletedMatches: value }), newId).confirmDeletedMatches).toBe(false)
    }
  })
})
