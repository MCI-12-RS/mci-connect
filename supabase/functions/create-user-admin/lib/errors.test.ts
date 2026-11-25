// Vitest (o E2.04 previa Deno; o Deno não é usado nesta máquina).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_ERROR_HINT,
  appErrorToHttp,
  ATTEMPT_ALREADY_USED_MESSAGE,
  attemptAlreadyUsed,
  authErrorToHttp,
  forbidden,
  HttpError,
  INVALID_REQUEST_MESSAGE,
  insertErrorToHttp,
  invalidRequest,
  isMemberIdConflict,
  isWeakPassword,
  SAVE_FAILED_MESSAGE,
  serverError,
  unauthenticated,
  uniqueViolationName,
  valueInUseFromUniqueViolation,
} from './errors.ts'

const appError = (detail: unknown, message = 'Mensagem do banco.') => ({
  code: '22023',
  message,
  details: typeof detail === 'string' ? detail : JSON.stringify(detail),
  hint: APP_ERROR_HINT,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('HttpError.body', () => {
  it('traz a mensagem em error, o code e os campos a mais', () => {
    const error = new HttpError(409, 'Texto.', 'deleted_matches', { matches: [] })
    expect(error.body()).toEqual({ error: 'Texto.', code: 'deleted_matches', matches: [] })
  })

  it('sem code, só a mensagem (respostas que o E2.04 ainda vai codificar)', () => {
    expect(new HttpError(400, 'Função inválida.').body()).toEqual({ error: 'Função inválida.' })
  })
})

describe('respostas com código da tabela do E2.04', () => {
  it('401 unauthenticated, 403 forbidden e 500 server_error, com as mensagens de antes', () => {
    expect([unauthenticated().status, unauthenticated().body()]).toEqual([
      401, { error: 'Não autenticado.', code: 'unauthenticated' },
    ])
    expect([forbidden().status, forbidden().body()]).toEqual([
      403, { error: 'Você não tem permissão para cadastrar membros.', code: 'forbidden' },
    ])
    expect(forbidden('Outra mensagem.').body()).toEqual({ error: 'Outra mensagem.', code: 'forbidden' })
    expect([serverError().status, serverError().body()]).toEqual([
      500, { error: 'Erro inesperado ao cadastrar o membro.', code: 'server_error' },
    ])
  })
})

describe('códigos novos do E2.04', () => {
  it('400 invalid_request, com a mensagem genérica ou a informada', () => {
    expect([invalidRequest().status, invalidRequest().body()]).toEqual([
      400, { error: INVALID_REQUEST_MESSAGE, code: 'invalid_request' },
    ])
    expect(invalidRequest('Informe a senha.').body()).toEqual({ error: 'Informe a senha.', code: 'invalid_request' })
  })

  it('409 attempt_already_used com o texto da DA-10', () => {
    expect(ATTEMPT_ALREADY_USED_MESSAGE).toBe('Este cadastro já foi enviado. Confira na lista de Membros.')
    expect([attemptAlreadyUsed().status, attemptAlreadyUsed().body()]).toEqual([
      409, { error: ATTEMPT_ALREADY_USED_MESSAGE, code: 'attempt_already_used' },
    ])
  })
})

const uniqueViolation = (name: string) => ({
  code: '23505',
  message: `duplicate key value violates unique constraint "${name}"`,
  details: 'Key (public.normalize_digits(cpf))=(39053344705) already exists.',
})

describe('23505 pelo nome do índice', () => {
  it('lê só o nome do índice da mensagem', () => {
    expect(uniqueViolationName(uniqueViolation('members_cpf_key'))).toBe('members_cpf_key')
    expect(uniqueViolationName({ code: '23505' })).toBeNull()
    expect(uniqueViolationName({ code: '23505', message: 'outra coisa' })).toBeNull()
    expect(uniqueViolationName({ code: '23503', message: 'unique constraint "members_cpf_key"' })).toBeNull()
  })

  it('members_pkey é a tentativa repetida', () => {
    expect(isMemberIdConflict(uniqueViolation('members_pkey'))).toBe(true)
    expect(isMemberIdConflict(uniqueViolation('members_email_key'))).toBe(false)
    expect(isMemberIdConflict({ code: '22023', message: 'unique constraint "members_pkey"' })).toBe(false)
  })

  it('índices de identificação → 409 value_in_use com o campo e o texto do trigger, sem o details', () => {
    const cases: Array<[string, string, string]> = [
      ['members_email_key', 'email', 'Este e-mail já está sendo usado por outro cadastro.'],
      ['members_mobile_key', 'mobile', 'Este celular já está sendo usado por outro cadastro.'],
      ['members_cpf_key', 'cpf', 'Este CPF já está sendo usado por outro cadastro.'],
    ]
    for (const [index, field, message] of cases) {
      const http = valueInUseFromUniqueViolation(uniqueViolation(index))
      expect([http?.status, http?.body()]).toEqual([409, { error: message, code: 'value_in_use', fields: [field] }])
      expect(JSON.stringify(http?.body())).not.toContain('39053344705')
      expect(insertErrorToHttp(uniqueViolation(index)).body()).toEqual(http?.body())
    }
    expect(valueInUseFromUniqueViolation(uniqueViolation('members_pkey'))).toBeNull()
    expect(valueInUseFromUniqueViolation(uniqueViolation('members_auth_user_id_key'))).toBeNull()
  })

  it('outro índice → 409 genérico, só o nome do índice no log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const http = insertErrorToHttp(uniqueViolation('members_auth_user_id_key'))
    expect([http.status, http.body()]).toEqual([409, { error: SAVE_FAILED_MESSAGE }])
    expect(JSON.stringify(log.mock.calls)).not.toContain('39053344705')
  })
})

describe('appErrorToHttp', () => {
  it('deleted_member_chosen → 400 com o campo do DETAIL, sem o member_id do excluído', () => {
    const http = appErrorToHttp(appError(
      { code: 'deleted_member_chosen', field: 'leader_id', member_id: '11111111-1111-1111-1111-111111111111' },
      'Este membro foi excluído e não pode ser escolhido.',
    ))
    expect(http?.status).toBe(400)
    expect(http?.body()).toEqual({
      error: 'Este membro foi excluído e não pode ser escolhido.',
      code: 'deleted_member_chosen',
      field: 'leader_id',
    })
    expect(JSON.stringify(http?.body())).not.toContain('11111111')
  })

  it('deleted_member_chosen no cônjuge → field spouse_id', () => {
    expect(appErrorToHttp(appError({ code: 'deleted_member_chosen', field: 'spouse_id' }))?.body())
      .toMatchObject({ code: 'deleted_member_chosen', field: 'spouse_id' })
  })

  it('deleted_account_email → 409 com field email, mesmo sem field no DETAIL', () => {
    const message = 'Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.'
    const http = appErrorToHttp(appError({ code: 'deleted_account_email' }, message))
    expect(http?.status).toBe(409)
    expect(http?.body()).toEqual({ error: message, code: 'deleted_account_email', field: 'email' })
  })

  it('o field do DETAIL vence o campo implícito', () => {
    expect(appErrorToHttp(appError({ code: 'deleted_account_email', field: 'outro' }))?.body())
      .toMatchObject({ field: 'outro' })
  })

  it('value_in_use → 409 com os fields do DETAIL e a mensagem do primeiro', () => {
    const http = appErrorToHttp(appError(
      { code: 'value_in_use', fields: ['email', 'cpf'] },
      'Este e-mail já está sendo usado por outro cadastro.',
    ))
    expect([http?.status, http?.body()]).toEqual([409, {
      error: 'Este e-mail já está sendo usado por outro cadastro.', code: 'value_in_use', fields: ['email', 'cpf'],
    }])
  })

  it('identifier_required → 400 com field e fields', () => {
    const http = appErrorToHttp(appError({
      code: 'identifier_required', field: 'identification', fields: ['mobile_whatsapp', 'email', 'cpf'],
    }))
    expect([http?.status, http?.body()]).toEqual([400, {
      error: 'Mensagem do banco.', code: 'identifier_required', field: 'identification',
      fields: ['mobile_whatsapp', 'email', 'cpf'],
    }])
  })

  it('as recusas de regra do E2.04 → 400 com o campo', () => {
    for (const [code, field] of [
      ['name_invalid', 'name'], ['gender_required', 'gender'], ['email_placeholder', 'email'],
      ['cpf_invalid', 'cpf'], ['mobile_invalid', 'mobile_whatsapp'], ['leader_cycle', 'leader_id'],
    ]) {
      expect(appErrorToHttp(appError({ code, field }))?.body()).toEqual({ error: 'Mensagem do banco.', code, field })
      expect(appErrorToHttp(appError({ code, field }))?.status).toBe(400)
    }
  })

  it('qualquer outro app_error → 400 com o code, e o field ou os fields quando houver', () => {
    const semCampo = appErrorToHttp(appError({ code: 'regra_nova' }))
    expect(semCampo?.status).toBe(400)
    expect(semCampo?.body()).toEqual({ error: 'Mensagem do banco.', code: 'regra_nova' })

    expect(appErrorToHttp(appError({ code: 'regra_nova', fields: ['email', 'cpf'], extra: 'x' }))?.body())
      .toEqual({ error: 'Mensagem do banco.', code: 'regra_nova', fields: ['email', 'cpf'] })
  })

  it('ignora field e fields fora do formato', () => {
    expect(appErrorToHttp(appError({ code: 'regra_nova', field: 1, fields: ['email', 2] }))?.body())
      .toEqual({ error: 'Mensagem do banco.', code: 'regra_nova' })
  })

  it('mensagem vazia → reserva genérica', () => {
    expect(appErrorToHttp(appError({ code: 'regra_nova' }, '  '))?.body().error).toBe(SAVE_FAILED_MESSAGE)
  })

  it('nunca devolve o DETAIL cru', () => {
    const http = appErrorToHttp(appError({ code: 'regra_nova', field: 'cpf', cpf: '39053344705' }))
    const body = http?.body() ?? {}
    expect(Object.keys(body).sort()).toEqual(['code', 'error', 'field'])
    expect(JSON.stringify(body)).not.toContain('39053344705')
  })

  it('não é app_error: outro SQLSTATE, outro hint, DETAIL ilegível ou sem code', () => {
    expect(appErrorToHttp({ code: '23505', message: 'x', details: '{"code":"a"}', hint: APP_ERROR_HINT })).toBeNull()
    expect(appErrorToHttp({ code: '22023', message: 'x', details: '{"code":"a"}', hint: null })).toBeNull()
    expect(appErrorToHttp(appError('não é json'))).toBeNull()
    expect(appErrorToHttp(appError('["code"]'))).toBeNull()
    expect(appErrorToHttp(appError({ field: 'email' }))).toBeNull()
    expect(appErrorToHttp(appError({ code: '' }))).toBeNull()
    expect(appErrorToHttp({ code: '22023', message: 'x', details: null, hint: APP_ERROR_HINT })).toBeNull()
  })
})

describe('insertErrorToHttp', () => {
  it('app_error passa pela tradução com código', () => {
    const http = insertErrorToHttp(appError({ code: 'deleted_member_chosen', field: 'leader_id' }))
    expect([http.status, http.code]).toEqual([400, 'deleted_member_chosen'])
  })

  it('42501 → 403 forbidden, com a mensagem de antes', () => {
    const http = insertErrorToHttp({ code: '42501', message: 'Você não tem permissão para esta ação.' })
    expect([http.status, http.body()]).toEqual([
      403, { error: 'Você não tem permissão para cadastrar membros.', code: 'forbidden' },
    ])
  })

  it('23505 sem índice, 23503, 23514 e formatos: mensagens genéricas, sem code', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect([insertErrorToHttp({ code: '23505' }).status, insertErrorToHttp({ code: '23505' }).body()])
      .toEqual([409, { error: SAVE_FAILED_MESSAGE }])
    expect(insertErrorToHttp({ code: '23503' }).body()).toEqual({ error: 'Líder, cônjuge ou função informados não existem.' })
    expect(insertErrorToHttp({ code: '23514' }).body()).toEqual({ error: 'Algum campo tem um valor inválido.' })
    for (const code of ['22P02', '22007', '22008']) {
      expect(insertErrorToHttp({ code }).body()).toEqual({ error: 'Algum campo tem um formato inválido.' })
    }
  })

  it('22023 que não é app_error e erros desconhecidos → 400 genérico, sem o DETAIL nem no log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const http = insertErrorToHttp({ code: '22023', message: 'x', details: 'cpf=39053344705', hint: null })
    expect([http.status, http.body()]).toEqual([400, { error: SAVE_FAILED_MESSAGE }])
    expect(JSON.stringify(log.mock.calls)).not.toContain('39053344705')
    insertErrorToHttp({ code: '22P05', message: 'valor 52998224725 inválido' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('52998224725')
  })
})

describe('authErrorToHttp', () => {
  it('senha fraca → 400 weak_password no campo password', () => {
    expect(isWeakPassword({ code: 'weak_password' })).toBe(true)
    expect(isWeakPassword({ code: 'email_exists' })).toBe(false)
    const http = authErrorToHttp({ code: 'weak_password' })
    expect([http.status, http.body()]).toEqual([400, {
      error: 'A senha não atende aos requisitos mínimos.', code: 'weak_password', field: 'password',
    }])
  })

  it('o resto é do servidor (e-mail e id da conta são gerados pela função) → 500, sem a mensagem do Auth no log', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const error of [
      { code: 'email_exists', status: 422 },
      { code: 'validation_failed', status: 400 },
      { code: 'unexpected_failure', status: 500, message: 'ana@exemplo.com' },
      {},
    ]) {
      expect([authErrorToHttp(error).status, authErrorToHttp(error).body()]).toEqual([500, serverError().body()])
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('ana@exemplo.com')
  })
})
