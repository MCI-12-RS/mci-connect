// Respostas de erro da create-user-admin e a tradução dos erros do banco e do
// Auth. Código puro: sem imports de URL nem globais do Deno, para ser testado
// com Vitest (lib/errors.test.ts).
//
// Toda resposta de erro tem `{ error, code?, … }`, e `error` é a mensagem pronta
// para a tela. Os códigos seguem a tabela de respostas do E2.04 ("Fluxo da
// `create-user-admin`"); o E2.04 acrescenta aqui os que faltam (`invalid_request`,
// `value_in_use` e o `23505` pelo nome do índice, `attempt_already_used`).

/** `HINT` dos erros de regra do banco (E2.01, "Formato dos erros"). */
export const APP_ERROR_HINT = 'app_error'

/** Reserva quando o banco recusa sem uma mensagem que possa ir para a tela. */
export const SAVE_FAILED_MESSAGE = 'Não foi possível salvar o cadastro.'

/** Erro do PostgREST (INSERT ou RPC), só com o que a tradução lê. */
export interface DbError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

/** Erro do Auth (Admin API), só com o que a tradução lê. */
export interface AuthApiError {
  code?: string
  message?: string
  status?: number
}

/** Campos da resposta além de `error` e `code` (`field`, `fields`, `matches`). */
export type ErrorExtra = Readonly<Record<string, unknown>>

/** Erro que vira a resposta HTTP: `{ error: message, code?, ...extra }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly extra: ErrorExtra = {},
  ) {
    super(message)
  }

  /** Corpo da resposta. `extra` é montado só pela própria função, nunca vem da entrada. */
  body(): Record<string, unknown> {
    return { error: this.message, ...(this.code ? { code: this.code } : {}), ...this.extra }
  }
}

export const unauthenticated = (): HttpError => new HttpError(401, 'Não autenticado.', 'unauthenticated')

export const forbidden = (message = 'Você não tem permissão para cadastrar membros.'): HttpError =>
  new HttpError(403, message, 'forbidden')

export const serverError = (): HttpError =>
  new HttpError(500, 'Erro inesperado ao cadastrar o membro.', 'server_error')

// Status de cada recusa de regra que não é 400 (tabela de respostas do E2.04).
const APP_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  // Só numa corrida: o aviso de excluído já recusa antes de criar a conta.
  ['deleted_account_email', 409],
])

// Campo de cada recusa que o banco ainda não informa no DETAIL. O E2.04 passa a
// mandar `field: "email"` no `deleted_account_email`; o DETAIL vence.
const APP_ERROR_FIELD: ReadonlyMap<string, string> = new Map([
  ['deleted_account_email', 'email'],
])

/** Objeto JSON (não nulo e não lista), sem asserção de tipo. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDetail(details: unknown): Record<string, unknown> | null {
  if (typeof details !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(details)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Recusa de regra do banco (`22023` + `hint: "app_error"` + DETAIL em JSON com
 * `code`) → `{ error: <message do banco>, code, field?, fields? }`.
 *
 * Do DETAIL saem só `code`, `field` e `fields`: o resto (por exemplo o
 * `member_id` de um excluído) nunca vai para a resposta. `null` para qualquer
 * outro erro, ou se o DETAIL não tiver `code`.
 */
export function appErrorToHttp(error: DbError): HttpError | null {
  if (error.code !== '22023' || error.hint !== APP_ERROR_HINT) return null
  const detail = parseDetail(error.details)
  if (!detail || typeof detail.code !== 'string' || detail.code === '') return null
  const code = detail.code

  const message = typeof error.message === 'string' && error.message.trim() !== ''
    ? error.message
    : SAVE_FAILED_MESSAGE
  const field = typeof detail.field === 'string' ? detail.field : APP_ERROR_FIELD.get(code)
  const rawFields = detail.fields
  const fields = Array.isArray(rawFields) && rawFields.every((f): f is string => typeof f === 'string')
    ? rawFields
    : undefined

  return new HttpError(APP_ERROR_STATUS.get(code) ?? 400, message, code, {
    ...(field ? { field } : {}),
    ...(fields ? { fields } : {}),
  })
}

/**
 * Erro do INSERT de `members` → resposta. As recusas de regra (`app_error`)
 * levam o código e o campo; os demais erros viram mensagens genéricas, sem
 * nomes de constraints nem valores digitados.
 */
export function insertErrorToHttp(error: DbError): HttpError {
  const appError = appErrorToHttp(error)
  if (appError) return appError
  switch (error.code) {
    case '23505': return new HttpError(409, 'Já existe um membro com este e-mail, CPF ou celular.')
    case '23503': return new HttpError(400, 'Líder, cônjuge ou função informados não existem.')
    case '23514': return new HttpError(400, 'Algum campo tem um valor inválido.')
    case '22P02':
    case '22007':
    case '22008': return new HttpError(400, 'Algum campo tem um formato inválido.')
    case '42501': return forbidden()
    default:
      // Sem `details`: ele pode trazer valores digitados (e-mail, CPF).
      console.error('create-user-admin: falha ao inserir membro', error.code, error.message)
      return new HttpError(400, SAVE_FAILED_MESSAGE)
  }
}

/** Erro da criação da conta de acesso (Admin API) → resposta. */
export function authErrorToHttp(error: AuthApiError): HttpError {
  if (error.code === 'email_exists' || error.code === 'user_already_exists') {
    return new HttpError(409, 'Já existe uma conta de acesso com este e-mail.')
  }
  if (error.code === 'weak_password') return new HttpError(400, 'A senha não atende aos requisitos mínimos.')
  if (error.code === 'email_address_invalid' || error.code === 'validation_failed') {
    return new HttpError(400, 'E-mail inválido.')
  }
  console.error('create-user-admin: falha ao criar a conta de acesso', error.code, error.status, error.message)
  return new HttpError(400, 'Não foi possível criar o acesso.')
}
