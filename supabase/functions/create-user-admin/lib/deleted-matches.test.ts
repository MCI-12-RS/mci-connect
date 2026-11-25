// Vitest (o E2.04 previa Deno; o Deno não é usado nesta máquina).
import { describe, expect, it } from 'vitest'
import { HttpError } from './errors.ts'
import {
  DELETED_ACCOUNT_EMAIL_MESSAGE,
  DELETED_MATCHES_MESSAGE,
  type DeletedMemberMatch,
  deletedMatchesParams,
  deletedAccountEmailWithMatches,
  deletedMatchesRefusal,
  isDeletedAccountEmailRefusal,
  isPlaceholderEmail,
  toDeletedMatches,
} from './deleted-matches.ts'

const hidden = (fields: string[], isAccountEmail = false): DeletedMemberMatch => ({
  member_id: null,
  name: null,
  deleted_at: null,
  matched_fields: fields,
  is_account_email: isAccountEmail,
})

const visible = (fields: string[], isAccountEmail = false): DeletedMemberMatch => ({
  member_id: '22222222-2222-2222-2222-222222222222',
  name: 'Bruno Excluído',
  deleted_at: '2026-11-10T13:00:00+00:00',
  matched_fields: fields,
  is_account_email: isAccountEmail,
})

describe('e-mail fictício', () => {
  it('o domínio do formulário é fictício, em qualquer caixa e com espaços', () => {
    expect(isPlaceholderEmail('ana_souza_ab12cd@mci12fakemail.com')).toBe(true)
    expect(isPlaceholderEmail('  ANA_X@MCI12FAKEMAIL.COM ')).toBe(true)
    expect(isPlaceholderEmail('ana@exemplo.com')).toBe(false)
    expect(isPlaceholderEmail('ana@mci12fakemail.com.br')).toBe(false)
  })

  it('não vai para a consulta: _email nulo', () => {
    expect(deletedMatchesParams({ email: 'ana_ab12cd@mci12fakemail.com', mobile_whatsapp: '51988880000' }))
      .toEqual({ _email: null, _mobile: '51988880000', _cpf: null })
  })
})

describe('deletedMatchesParams', () => {
  it('e-mail, celular e CPF como vieram (o banco normaliza)', () => {
    expect(deletedMatchesParams({ email: 'bruno@exemplo.com', mobile_whatsapp: '(51) 98888-0000', cpf: '390.533.447-05' }))
      .toEqual({ _email: 'bruno@exemplo.com', _mobile: '(51) 98888-0000', _cpf: '390.533.447-05' })
  })

  it('ausente, vazio ou fora de texto vira nulo; número vira texto', () => {
    expect(deletedMatchesParams({ email: '', mobile_whatsapp: null, cpf: { x: 1 } }))
      .toEqual({ _email: null, _mobile: null, _cpf: null })
    expect(deletedMatchesParams({})).toEqual({ _email: null, _mobile: null, _cpf: null })
    expect(deletedMatchesParams({ mobile_whatsapp: 51988880000, cpf: Number.NaN }))
      .toEqual({ _email: null, _mobile: '51988880000', _cpf: null })
  })
})

describe('deletedMatchesRefusal', () => {
  it('nenhuma correspondência: segue, com ou sem a confirmação', () => {
    expect(deletedMatchesRefusal([], false)).toBeNull()
    expect(deletedMatchesRefusal([], true)).toBeNull()
  })

  it('correspondência sem a confirmação: 409 deleted_matches com matches como vieram', () => {
    const matches = [hidden(['mobile']), hidden(['cpf'])]
    const refusal = deletedMatchesRefusal(matches, false)
    expect(refusal?.status).toBe(409)
    expect(refusal?.body()).toEqual({ error: DELETED_MATCHES_MESSAGE, code: 'deleted_matches', matches })
  })

  it('correspondência com a confirmação ("Cadastrar mesmo assim"): segue', () => {
    expect(deletedMatchesRefusal([visible(['mobile', 'cpf'])], true)).toBeNull()
  })

  it('e-mail da conta de um excluído: 409 deleted_account_email, com ou sem a confirmação', () => {
    const matches = [hidden(['cpf']), hidden(['email'], true)]
    for (const confirmed of [false, true]) {
      const refusal = deletedMatchesRefusal(matches, confirmed)
      expect(refusal?.status).toBe(409)
      expect(refusal?.body()).toEqual({
        error: DELETED_ACCOUNT_EMAIL_MESSAGE,
        code: 'deleted_account_email',
        field: 'email',
        matches,
      })
    }
  })

  it('e-mail de excluído sem conta é uma correspondência comum', () => {
    expect(deletedMatchesRefusal([hidden(['email'])], false)?.code).toBe('deleted_matches')
    expect(deletedMatchesRefusal([hidden(['email'])], true)).toBeNull()
  })

  it('não acrescenta nada às linhas, nem para o administrador', () => {
    const matches = [visible(['email', 'mobile'])]
    const body = deletedMatchesRefusal(matches, false)?.body()
    expect(body?.matches).toBe(matches)
  })
})

describe('toDeletedMatches', () => {
  it('aceita as linhas da RPC e a resposta vazia', () => {
    expect(toDeletedMatches([visible(['cpf']), hidden(['mobile'])])).toHaveLength(2)
    expect(toDeletedMatches([])).toEqual([])
    expect(toDeletedMatches(null)).toEqual([])
  })

  it('formato inesperado é erro, e não "nenhuma correspondência"', () => {
    expect(() => toDeletedMatches({})).toThrow()
    expect(() => toDeletedMatches([{ matched_fields: ['cpf'] }])).toThrow()
    expect(() => toDeletedMatches([{ ...hidden(['cpf']), is_account_email: 'false' }])).toThrow()
  })
})

describe('deletedAccountEmailWithMatches (recusa do ensaio ou do INSERT, E2.04)', () => {
  // A recusa como appErrorToHttp a monta a partir do trigger: só `field`.
  const dbRefusal = () => new HttpError(409, DELETED_ACCOUNT_EMAIL_MESSAGE, 'deleted_account_email', { field: 'email' })

  it('reconhece só a recusa deleted_account_email', () => {
    expect(isDeletedAccountEmailRefusal(dbRefusal())).toBe(true)
    expect(isDeletedAccountEmailRefusal(new HttpError(409, 'x', 'value_in_use', { fields: ['email'] }))).toBe(false)
    expect(isDeletedAccountEmailRefusal(new HttpError(400, 'x'))).toBe(false)
  })

  it('com a linha is_account_email: 409 deleted_account_email com field e matches, como no E2.01', () => {
    const matches = [visible(['email'], true), hidden(['cpf'])]
    const refusal = deletedAccountEmailWithMatches(dbRefusal(), matches)
    expect(refusal.status).toBe(409)
    expect(refusal.body()).toEqual({
      error: DELETED_ACCOUNT_EMAIL_MESSAGE,
      code: 'deleted_account_email',
      field: 'email',
      matches,
    })
  })

  it('para quem não vê o excluído, matches vêm como a RPC devolveu (sem nome nem id)', () => {
    const matches = [hidden(['email'], true)]
    expect(deletedAccountEmailWithMatches(dbRefusal(), matches).body().matches).toBe(matches)
  })

  it('sem a linha is_account_email (corrida): a recusa do banco, só com field', () => {
    const refusal = dbRefusal()
    expect(deletedAccountEmailWithMatches(refusal, [])).toBe(refusal)
    expect(deletedAccountEmailWithMatches(refusal, [hidden(['email']), visible(['mobile'])])).toBe(refusal)
    expect(refusal.body()).toEqual({ error: DELETED_ACCOUNT_EMAIL_MESSAGE, code: 'deleted_account_email', field: 'email' })
  })

  it('consulta que falhou (null): a recusa do banco, só com field', () => {
    const refusal = dbRefusal()
    expect(deletedAccountEmailWithMatches(refusal, null)).toBe(refusal)
  })

  it('outra recusa segue como está, mesmo com correspondências', () => {
    const other = new HttpError(409, 'Este CPF já está sendo usado por outro cadastro.', 'value_in_use', { fields: ['cpf'] })
    expect(deletedAccountEmailWithMatches(other, [visible(['email'], true)])).toBe(other)
  })
})
