// Respostas de erro da create-user-admin e a tradução dos erros do banco e do
// Auth. Código puro: sem imports de URL nem globais do Deno, para ser testado
// com Vitest (lib/errors.test.ts).
//
// Toda resposta de erro tem `{ error, code?, … }`, e `error` é a mensagem pronta
// para a tela. Os códigos seguem a tabela de respostas do E2.04 ("Fluxo da
// `create-user-admin`"). Nenhuma resposta traz o `details` do Postgres nem dado
// de outro cadastro (DT-10).

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

/** Texto genérico do `invalid_request`: só um cliente fora do contrato chega aqui. */
export const INVALID_REQUEST_MESSAGE = 'Não foi possível ler o cadastro enviado. Recarregue a página e tente de novo.'

/** Corpo, `attemptId`, `memberData` ou senha fora do formato. */
export const invalidRequest = (message = INVALID_REQUEST_MESSAGE): HttpError =>
  new HttpError(400, message, 'invalid_request')

/** Texto do spec (DA-10). */
export const ATTEMPT_ALREADY_USED_MESSAGE = 'Este cadastro já foi enviado. Confira na lista de Membros.'

/** O `attemptId` já é de um cadastro que quem chama não vê (DA-10). */
export const attemptAlreadyUsed = (): HttpError =>
  new HttpError(409, ATTEMPT_ALREADY_USED_MESSAGE, 'attempt_already_used')

// Status de cada recusa de regra que não é 400 (tabela de respostas do E2.04).
const APP_ERROR_STATUS: ReadonlyMap<string, number> = new Map([
  ['value_in_use', 409],
  ['deleted_account_email', 409],
])

// Campo de cada recusa quando o DETAIL não o informa (o banco do E2.01 não
// mandava `field` no `deleted_account_email`). O DETAIL vence.
const APP_ERROR_FIELD: ReadonlyMap<string, string> = new Map([
  ['deleted_account_email', 'email'],
])

/** Chave primária de `members`: o `attemptId` já virou cadastro (tentativa repetida). */
export const MEMBER_PKEY = 'members_pkey'

// Índices únicos de identificação (E2.04, migration 1) → campo do `value_in_use`,
// no vocabulário do banco (`email`, `mobile`, `cpf`), com o texto do trigger.
const UNIQUE_INDEX_FIELD: ReadonlyMap<string, string> = new Map([
  ['members_email_key', 'email'],
  ['members_mobile_key', 'mobile'],
  ['members_cpf_key', 'cpf'],
])
const VALUE_IN_USE_MESSAGE: ReadonlyMap<string, string> = new Map([
  ['email', 'Este e-mail já está sendo usado por outro cadastro.'],
  ['mobile', 'Este celular já está sendo usado por outro cadastro.'],
  ['cpf', 'Este CPF já está sendo usado por outro cadastro.'],
])

/**
 * Nome do índice de um `23505`, lido da mensagem do Postgres
 * (`duplicate key value violates unique constraint "<nome>"`). Só o nome: o
 * `details` traz o valor duplicado e nunca é lido.
 */
export function uniqueViolationName(error: DbError): string | null {
  if (error.code !== '23505' || typeof error.message !== 'string') return null
  return /unique constraint "([^"]+)"/.exec(error.message)?.[1] ?? null
}

/** O `23505` é da chave primária de `members`: outra chamada com o mesmo `attemptId` gravou antes. */
export function isMemberIdConflict(error: DbError): boolean {
  return uniqueViolationName(error) === MEMBER_PKEY
}

/**
 * `23505` de um índice de identificação → 409 `value_in_use` com aquele campo
 * (reserva para a gravação sem trava; o caminho normal é a recusa do trigger).
 * `null` para outro erro ou outro índice.
 */
export function valueInUseFromUniqueViolation(error: DbError): HttpError | null {
  const name = uniqueViolationName(error)
  const field = name ? UNIQUE_INDEX_FIELD.get(name) : undefined
  if (!field) return null
  return new HttpError(409, VALUE_IN_USE_MESSAGE.get(field) ?? SAVE_FAILED_MESSAGE, 'value_in_use', { fields: [field] })
}

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
 * Códigos do portão (E2.03, DT-04 e AQ-3): 42501 com `HINT app_error` e o
 * código no DETAIL. Ligado no PR 4 em `viewer_member_id`, `viewer_has` e
 * `default_role_id`, então pode vir de qualquer chamada com a sessão de quem
 * chama.
 */
export const GATE_CODES: readonly string[] = ['session_ended', 'password_change_required']

/** Texto de reserva do 403 do portão, se o banco não mandar mensagem. */
export const GATE_MESSAGE = 'Não foi possível concluir com a sua sessão. Entre de novo.'

/**
 * Recusa do portão → 403 com o `code` (`session_ended`, `password_change_required`),
 * para a tela levar à troca de senha ou ao login. `null` para outro erro.
 */
export function gateErrorToHttp(error: DbError): HttpError | null {
  if (error.code !== '42501' || error.hint !== APP_ERROR_HINT) return null
  const detail = parseDetail(error.details)
  const code = detail?.code
  if (typeof code !== 'string' || !GATE_CODES.includes(code)) return null
  const message = typeof error.message === 'string' && error.message.trim() !== '' ? error.message : GATE_MESSAGE
  return new HttpError(403, message, code)
}

/** 42501 com a sessão de quem chama: o do portão leva o código; o resto é falta de permissão. */
export const permissionErrorToHttp = (error: DbError): HttpError => gateErrorToHttp(error) ?? forbidden()

// Mensagens da política na senha inicial (E2.03, RN-07 e P-SEN-21: falam do
// membro que está sendo cadastrado). As mesmas da `set_initial_password`.
const PASSWORD_POLICY_MESSAGE: ReadonlyMap<string, string> = new Map([
  ['password_too_short', 'A senha precisa ter pelo menos 8 caracteres.'],
  ['password_too_long', 'A senha é longa demais.'],
  ['password_weak', 'Esta senha é fácil de adivinhar. Escolha outra.'],
  ['password_personal_data', 'A senha não pode conter o CPF, o celular ou a data de nascimento do membro, nem ser o e-mail do cadastro.'],
])

/** Senha inicial que vale `123456` sem passar pela política (D11): vazia ou exatamente `123456`. */
export const isDefaultInitialPassword = (password: string): boolean => password === '' || password === '123456'

/**
 * Código de `check_password_policy` → 400 `{ error, code, field: 'password' }`
 * (AQ-8). Código fora da lista: 500 (o banco mudou sem a função).
 */
export function passwordPolicyRefusal(code: string): HttpError {
  const message = PASSWORD_POLICY_MESSAGE.get(code)
  if (!message) {
    console.error('create-user-admin: código de política desconhecido', code)
    return serverError()
  }
  return new HttpError(400, message, code, { field: 'password' })
}

/**
 * Erro do INSERT (ou do ensaio) de `members` → resposta. As recusas de regra
 * (`app_error`) levam o código e o campo, e o `23505` de um índice de
 * identificação vira `value_in_use`; os demais erros viram mensagens genéricas,
 * sem nomes de constraints nem valores digitados.
 */
export function insertErrorToHttp(error: DbError): HttpError {
  const appError = appErrorToHttp(error) ?? valueInUseFromUniqueViolation(error)
  if (appError) return appError
  switch (error.code) {
    case '23505':
      // Outro índice (a chave primária é tratada antes, no index.ts): só o nome no log.
      console.error('create-user-admin: valor duplicado', uniqueViolationName(error))
      return new HttpError(409, SAVE_FAILED_MESSAGE)
    case '23503': return new HttpError(400, 'Líder, cônjuge ou função informados não existem.')
    case '23514': return new HttpError(400, 'Algum campo tem um valor inválido.')
    case '22P02':
    case '22007':
    case '22008': return new HttpError(400, 'Algum campo tem um formato inválido.')
    case '42501': return permissionErrorToHttp(error)
    default:
      // Só o código: `details` e algumas mensagens trazem valores digitados (e-mail, CPF).
      console.error('create-user-admin: falha ao inserir membro', error.code)
      return new HttpError(400, SAVE_FAILED_MESSAGE)
  }
}

/** A senha recusada pelo Auth: a única falha da criação da conta que a pessoa resolve na tela. */
export function isWeakPassword(error: AuthApiError): boolean {
  return error.code === 'weak_password'
}

/**
 * Erro da criação da conta de acesso (Admin API) → resposta. O e-mail e o id da
 * conta são gerados pela função (DA-1), então, fora a senha fraca, toda falha é
 * do servidor. A conta já existente (tentativa anterior) é tratada antes, no
 * index.ts, e só chega aqui se não pôde ser reaproveitada.
 */
export function authErrorToHttp(error: AuthApiError): HttpError {
  if (isWeakPassword(error)) {
    return new HttpError(400, 'A senha não atende aos requisitos mínimos.', 'weak_password', { field: 'password' })
  }
  // Sem a mensagem: o Auth repete nela o e-mail informado.
  console.error('create-user-admin: falha ao criar a conta de acesso', error.code, error.status)
  return serverError()
}
