// Cria a conta de acesso (Supabase Auth) e o cadastro do membro.
//
// Corpo (E2.04, "Contratos"):
//   { attemptId?, password, memberData, confirmDeletedMatches? }
// - `attemptId`: UUID v4 gerado pelo formulário ao abrir. É o id do membro e o da
//   conta (DT-01, DT-11), e torna o cadastro idempotente: a mesma tentativa
//   devolve o mesmo cadastro com `replayed: true`. Sem ele, a função gera um.
// - `memberData`: só as colunas de MEMBER_FIELDS (lib/request.ts). O e-mail real,
//   se houver, vem em `memberData.email`; a conta usa sempre o e-mail técnico
//   `member_account_email(id)` (DA-1), gerado só aqui.
//
// Ordem (DT-11): JWT → permissão → entrada → tentativa repetida → ensaio →
// aviso de excluído → conta → cadastro → desfazimento.
// - Permissão: `viewer_has('create_member')` com a sessão de quem chama, antes de
//   ler o corpo (RN-19).
// - Ensaio: `check_member_insert` com a sessão de quem chama confere todas as
//   regras (as do E2.02 e as do E2.04, na ordem da DA-11, inclusive
//   `value_in_use` e `deleted_account_email`) sem gravar nada. Nenhuma conta é
//   criada quando ele recusa.
// - Aviso de cadastro excluído (E2.01, RN-18): `find_deleted_member_matches`,
//   depois do ensaio (RN-10); "Cadastrar mesmo assim" é `confirmDeletedMatches`.
// - O membro é gravado com a sessão de quem chama, então o RLS e os triggers
//   valem e a Auditoria registra o autor.
// - Se a gravação falhar, a conta criada NESTA chamada é desfeita, a não ser que
//   um cadastro com o mesmo id já exista (outra chamada da mesma tentativa ganhou
//   a corrida: a conta é dela).
// - Respostas de erro `{ error, code, field?, fields?, matches? }`, sem o
//   `details` do Postgres nem dado de outro cadastro (lib/errors.ts).
//
// A verificação do JWT é feita aqui dentro (auth.getUser), e não no gateway
// (`verify_jwt` no config.toml), porque ela funciona tanto com as chaves antigas
// quanto com as chaves novas (publishable/secret) do Supabase.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  appErrorToHttp,
  attemptAlreadyUsed,
  authErrorToHttp,
  type DbError,
  forbidden,
  HttpError,
  insertErrorToHttp,
  isMemberIdConflict,
  isWeakPassword,
  serverError,
  unauthenticated,
  valueInUseFromUniqueViolation,
} from './lib/errors.ts'
import { deletedMatchesParams, deletedMatchesRefusal, toDeletedMatches } from './lib/deleted-matches.ts'
import { type CreateMemberRequest, parseCreateMemberRequest } from './lib/request.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })

/** Sucesso: o cadastro criado agora (`replayed: false`) ou numa tentativa anterior (`true`). */
const created = (id: string, replayed: boolean) => json({ member: { id }, replayed }, 200)

/** Cadastro que já tem o id da tentativa: não pode ser desfeito nem gravado de novo. */
class AttemptTaken extends Error {}

/** 1. Quem está chamando (JWT). */
async function authenticate(admin: SupabaseClient, req: Request): Promise<string> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw unauthenticated()
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw unauthenticated()
  return token
}

/** 2. Permissão `create_member`, com a sessão de quem chama, antes de qualquer consulta (RN-19). */
async function assertCanCreate(asCaller: SupabaseClient): Promise<void> {
  const { data, error } = await asCaller.rpc('viewer_has', { _permission: 'create_member' })
  if (error) {
    if (error.code === '42501') throw forbidden()
    console.error('create-user-admin: falha ao conferir a permissão', error.code)
    throw serverError()
  }
  if (data !== true) throw forbidden()
}

/** 3. Entrada. */
async function readInput(req: Request): Promise<CreateMemberRequest> {
  const raw: unknown = await req.json().catch(() => null)
  return parseCreateMemberRequest(raw, () => crypto.randomUUID())
}

/** Existe um cadastro com este id (excluído ou não)? Lido com a service role. */
async function memberExists(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin.from('members').select('id').eq('id', id).maybeSingle()
  if (error) {
    console.error('create-user-admin: falha ao procurar o cadastro da tentativa', error.code)
    throw serverError()
  }
  return data !== null
}

/**
 * Resposta da tentativa repetida (AQ-5, DA-10): o cadastro com este id, se quem
 * chama o vê na `members_view`; senão, 409 `attempt_already_used`.
 */
async function replayResponse(asCaller: SupabaseClient, id: string): Promise<Response> {
  const { data, error } = await asCaller.from('members_view').select('id').eq('id', id).maybeSingle()
  if (error) {
    console.error('create-user-admin: falha ao reler o cadastro da tentativa', error.code)
    throw serverError()
  }
  if (data === null) throw attemptAlreadyUsed()
  return created(id, true)
}

/** A linha que vai para `members` (ensaio e INSERT), com o id da tentativa. */
const rowWithId = (input: CreateMemberRequest) => ({ ...input.memberRow, id: input.attemptId })

/**
 * 5. Ensaio do cadastro (E2.02 DT-21, E2.04 DT-12), com a sessão de quem chama:
 * as mesmas regras do INSERT, sem gravar nada. O `23505` da chave primária quer
 * dizer que a mesma tentativa foi gravada entre o passo 4 e aqui.
 */
async function checkMemberInsert(asCaller: SupabaseClient, input: CreateMemberRequest): Promise<void> {
  const { error } = await asCaller.rpc('check_member_insert', { _member: rowWithId(input) })
  if (!error) return
  if (isMemberIdConflict(error)) throw new AttemptTaken()
  throw insertErrorToHttp(error)
}

/**
 * 6. Aviso de cadastro excluído (E2.01, RN-18), com a sessão de quem chama: o
 * banco devolve nome, id e data só para o administrador que veria o excluído
 * (DA-8). Recusa com 409 antes de existir qualquer conta.
 */
async function checkDeletedMatches(asCaller: SupabaseClient, input: CreateMemberRequest): Promise<void> {
  const { data, error } = await asCaller.rpc('find_deleted_member_matches', deletedMatchesParams(input.memberRow))
  if (error) {
    if (error.code === '42501') throw forbidden()
    console.error('create-user-admin: falha ao consultar cadastros excluídos', error.code)
    throw serverError()
  }
  const refusal = deletedMatchesRefusal(toDeletedMatches(data), input.confirmDeletedMatches)
  if (refusal) throw refusal
}

/** Nome para o `user_metadata` da conta (o cadastro guarda o normalizado pelo banco). */
const accountName = (input: CreateMemberRequest): string =>
  typeof input.memberRow.name === 'string' ? input.memberRow.name.trim().replace(/\s+/g, ' ') : ''

/**
 * 7. Conta de acesso com `id` = `attemptId` e o e-mail técnico (DA-1). A conta
 * criada nesta chamada é informada a `onCreated` (só ela pode ser desfeita); a
 * reaproveitada de uma tentativa anterior cujo cadastro falhou (risco 5), não.
 */
async function ensureAccount(admin: SupabaseClient, input: CreateMemberRequest, onCreated: (id: string) => void): Promise<void> {
  const id = input.attemptId
  const { data: email, error: emailError } = await admin.rpc('member_account_email', { _member_id: id })
  if (emailError || typeof email !== 'string' || email === '') {
    console.error('create-user-admin: falha ao gerar o e-mail da conta', emailError?.code)
    throw serverError()
  }

  const { data, error } = await admin.auth.admin.createUser({
    id,
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: accountName(input) },
  })
  if (!error && data.user) {
    onCreated(data.user.id)
    // Risco 4: o Auth precisa aceitar o id. Sem isso, o cadastro e a conta não
    // ficam ligados pelo mesmo id e a tentativa deixa de ser idempotente.
    if (data.user.id !== id) {
      console.error('create-user-admin: o Auth não aceitou o id da conta')
      throw serverError()
    }
    return
  }
  if (error && isWeakPassword(error)) throw authErrorToHttp(error)

  // A conta já existe com este id e o e-mail técnico: uma tentativa anterior a
  // criou e o cadastro falhou (ou outra chamada da mesma tentativa está em curso).
  const { data: existing, error: getError } = await admin.auth.admin.getUserById(id)
  const sameAccount = !getError && existing.user !== null
    && (existing.user.email ?? '').toLowerCase() === email.toLowerCase()
  if (!sameAccount) throw authErrorToHttp(error ?? {})
  // Se o cadastro já foi gravado por outra chamada, a conta é dele: nada a mudar.
  if (await memberExists(admin, id)) throw new AttemptTaken()
  // A senha e o nome passam a ser os deste pedido.
  const { error: updateError } = await admin.auth.admin.updateUserById(id, {
    password: input.password,
    user_metadata: { name: accountName(input) },
  })
  if (updateError) throw authErrorToHttp(updateError)
}

/**
 * 9. A gravação do cadastro falhou e nenhum cadastro tem o id da tentativa.
 * O `23505` de um índice de identificação (gravação sem trava) repete o ensaio,
 * que cita todos os campos em uso; sem recusa no ensaio, vale o campo do índice.
 */
async function insertFailure(asCaller: SupabaseClient, input: CreateMemberRequest, error: DbError): Promise<HttpError> {
  if (valueInUseFromUniqueViolation(error)) {
    const { error: again } = await asCaller.rpc('check_member_insert', { _member: rowWithId(input) })
    const refusal = again ? appErrorToHttp(again) : null
    if (refusal) return refusal
  }
  return insertErrorToHttp(error)
}

/**
 * Desfaz a conta criada nesta chamada. Nunca lança: a resposta de erro original
 * precisa sair, e a conta órfã fica no log (risco 5: tem o e-mail técnico e
 * nenhum cadastro, e a mesma tentativa a reaproveita).
 */
async function undoAccount(admin: SupabaseClient, authUserId: string): Promise<void> {
  try {
    const { error } = await admin.auth.admin.deleteUser(authUserId)
    if (error) {
      console.error('create-user-admin: rollback falhou, conta de acesso órfã', authUserId, error.code, error.status)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'unknown'
    console.error('create-user-admin: rollback falhou, conta de acesso órfã', authUserId, reason)
  }
}

/** Resposta de erro: a do HttpError, ou 500 genérico (só o tipo do erro no log). */
function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json(error.body(), error.status)
  console.error('create-user-admin: erro inesperado', error instanceof Error ? error.name : 'unknown')
  const unexpected = serverError()
  return json(unexpected.body(), unexpected.status)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  })
  // Conta criada nesta chamada e ainda sem cadastro: é desfeita se a chamada falhar.
  let accountToUndo: string | null = null
  let attemptId: string | null = null
  let asCaller: SupabaseClient | null = null

  try {
    const token = await authenticate(admin, req)
    asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })

    await assertCanCreate(asCaller)
    const input = await readInput(req)
    attemptId = input.attemptId

    if (input.attemptIdFromClient && await memberExists(admin, input.attemptId)) throw new AttemptTaken()
    await checkMemberInsert(asCaller, input)
    await checkDeletedMatches(asCaller, input)

    await ensureAccount(admin, input, (id) => { accountToUndo = id })

    const { error } = await asCaller.from('members').insert({
      ...rowWithId(input),
      auth_user_id: input.attemptId,
    })
    if (!error) {
      accountToUndo = null
      return created(input.attemptId, false)
    }
    // Outra chamada da mesma tentativa gravou antes (23505 da chave primária, ou
    // uma recusa que veio depois do commit dela): a conta é do cadastro dela.
    // Na dúvida (a procura falhou), a conta também fica: uma órfã é
    // reaproveitada pela mesma tentativa (risco 5); um cadastro sem conta, não.
    let taken = isMemberIdConflict(error)
    try {
      taken ||= await memberExists(admin, input.attemptId)
    } catch (lookupError) {
      accountToUndo = null
      throw lookupError
    }
    if (taken) {
      accountToUndo = null
      throw new AttemptTaken()
    }
    throw await insertFailure(asCaller, input, error)
  } catch (error) {
    if (accountToUndo) await undoAccount(admin, accountToUndo)
    if (!(error instanceof AttemptTaken)) return errorResponse(error)
    // A tentativa já virou cadastro: a resposta é a do passo 4.
    try {
      if (!asCaller || !attemptId) throw serverError()
      return await replayResponse(asCaller, attemptId)
    } catch (replayError) {
      return errorResponse(replayError)
    }
  }
})
