// Vitest (o E2.04 previa Deno; o Deno não é usado nesta máquina).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_ERROR_HINT,
  appErrorToHttp,
  authErrorToHttp,
  forbidden,
  HttpError,
  insertErrorToHttp,
  SAVE_FAILED_MESSAGE,
  serverError,
  unauthenticated,
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

  it('23505, 23503, 23514 e formatos: as mensagens de antes, sem code', () => {
    expect(insertErrorToHttp({ code: '23505', message: 'duplicate key value violates unique constraint "members_email_key"' }).body())
      .toEqual({ error: 'Já existe um membro com este e-mail, CPF ou celular.' })
    expect(insertErrorToHttp({ code: '23505' }).status).toBe(409)
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
  })
})

describe('authErrorToHttp', () => {
  it('mantém as respostas de antes', () => {
    expect(authErrorToHttp({ code: 'email_exists' }).body()).toEqual({ error: 'Já existe uma conta de acesso com este e-mail.' })
    expect(authErrorToHttp({ code: 'user_already_exists' }).status).toBe(409)
    expect(authErrorToHttp({ code: 'weak_password' }).body()).toEqual({ error: 'A senha não atende aos requisitos mínimos.' })
    expect(authErrorToHttp({ code: 'email_address_invalid' }).body()).toEqual({ error: 'E-mail inválido.' })
    expect(authErrorToHttp({ code: 'validation_failed' }).status).toBe(400)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(authErrorToHttp({ code: 'unexpected_failure', status: 500 }).body()).toEqual({ error: 'Não foi possível criar o acesso.' })
  })
})
