// Cria a conta de acesso (Supabase Auth) e o cadastro do membro.
//
// Segurança (passo E1.02 de docs/migracao.md no repositório apps-mci):
// - quem chama precisa estar autenticado e ter a permissão `create_member`;
// - só as colunas de cadastro listadas em MEMBER_FIELDS são aceitas;
// - sem `assign_role` (ou `manage_roles`), o membro só recebe o perfil padrão.
//   Com elas, não é possível atribuir um perfil com permissões que quem chama
//   não tem;
// - erros do banco e do Auth viram mensagens genéricas, sem detalhes internos.
//   As recusas de regra do banco (`app_error`) saem com a mensagem, o `code` e o
//   campo, nunca com o DETAIL cru (lib/errors.ts);
// - o membro é gravado com a sessão de quem chama, então o RLS de `members` vale
//   e a auditoria registra o autor;
// - se a gravação do membro falhar, a conta de acesso recém-criada é removida;
// - a resposta traz só o id do membro criado (`{ member: { id } }`), nunca a
//   linha inteira (E1.08, PR 5).
//
// Cadastro com dados de um membro excluído (E2.01, RN-18): antes de criar a
// conta, a função consulta `find_deleted_member_matches` com a sessão de quem
// chama e responde 409 (`deleted_account_email` ou `deleted_matches`, com
// `matches`). "Cadastrar mesmo assim" é `confirmDeletedMatches: true`, que não
// vale para o e-mail da conta de um excluído (lib/deleted-matches.ts).
//
// Corpo: `{ email, password, memberData, confirmDeletedMatches? }`.
//
// A verificação do JWT é feita aqui dentro (auth.getUser), e não no gateway
// (`verify_jwt` no config.toml), porque ela funciona tanto com as chaves antigas
// quanto com as chaves novas (publishable/secret) do Supabase.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  authErrorToHttp,
  forbidden,
  HttpError,
  insertErrorToHttp,
  isRecord,
  serverError,
  unauthenticated,
} from './lib/errors.ts'
import { deletedMatchesParams, deletedMatchesRefusal, toDeletedMatches } from './lib/deleted-matches.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Colunas de `members` que podem vir do formulário. As demais (auth_user_id,
// g12_level, totais, datas) são controladas pelo servidor.
const MEMBER_FIELDS = [
  'name', 'email', 'cpf', 'gender', 'birth_date', 'mobile_whatsapp', 'phone', 'notes',
  'instagram', 'avatar_url', 'is_pastor', 'has_leadership', 'leader_id', 'spouse_id',
  'is_baptized', 'baptism_date', 'is_active', 'street', 'number', 'complement',
  'neighborhood', 'city', 'state', 'zip_code', 'role_id',
] as const

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })

/** O pedido já conferido: e-mail, senha, linha de `members` e a confirmação do aviso de excluído. */
interface CreateMemberInput {
  email: string
  password: string
  name: string
  memberRow: Record<string, unknown>
  confirmDeletedMatches: boolean
}

async function hasPermission(admin: SupabaseClient, userId: string, permission: string): Promise<boolean> {
  const { data, error } = await admin.rpc('user_has_permission', { _user_id: userId, _permission: permission })
  if (error) throw error
  return data === true
}

async function rolePermissions(admin: SupabaseClient, roleId: string): Promise<Set<string>> {
  const { data, error } = await admin.from('role_permissions').select('permission').eq('role_id', roleId)
  if (error) throw error
  return new Set((data ?? []).map((row: { permission: string }) => row.permission))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ---------------------------------------------------------------------------
// Passos, na ordem em que rodam. O E2.04 (DT-11) acrescenta "tentativa
// repetida" e "ensaio" entre readInput/resolveRole e checkDeletedMatches.
// ---------------------------------------------------------------------------

/** 1. Quem está chamando (JWT). */
async function authenticate(admin: SupabaseClient, req: Request): Promise<{ callerId: string; token: string }> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw unauthenticated()
  const { data: { user }, error } = await admin.auth.getUser(token)
  if (error || !user) throw unauthenticated()
  return { callerId: user.id, token }
}

/** 2. Permissão para cadastrar membros, antes de qualquer outra consulta. */
async function requireCreateMember(admin: SupabaseClient, callerId: string): Promise<void> {
  if (!(await hasPermission(admin, callerId, 'create_member'))) throw forbidden()
}

/** 3. Entrada: corpo, lista branca de colunas e a confirmação do aviso. */
async function readInput(req: Request): Promise<CreateMemberInput> {
  const raw: unknown = await req.json().catch(() => null)
  const body: Record<string, unknown> = isRecord(raw) ? raw : {}
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const input: unknown = body.memberData ?? {}
  if (!isRecord(input)) throw new HttpError(400, 'Dados do membro inválidos.')
  if (!email || !password) throw new HttpError(400, 'E-mail e senha são obrigatórios.')
  if (typeof input.name !== 'string' || !input.name.trim()) throw new HttpError(400, 'O nome é obrigatório.')

  const memberRow: Record<string, unknown> = {}
  for (const field of MEMBER_FIELDS) {
    if (field in input) memberRow[field] = input[field]
  }
  memberRow.email = email
  return {
    email,
    password,
    name: input.name,
    memberRow,
    confirmDeletedMatches: body.confirmDeletedMatches === true,
  }
}

/** 4. Função do membro novo: a padrão, ou uma que quem chama pode atribuir. */
async function resolveRole(
  admin: SupabaseClient,
  callerId: string,
  requested: unknown,
): Promise<string | null> {
  // Vazio ou ausente = sem pedido de perfil (usa o padrão).
  let requestedRoleId: string | null = null
  if (requested !== undefined && requested !== null && requested !== '') {
    if (typeof requested !== 'string' || !UUID_RE.test(requested)) {
      throw new HttpError(400, 'Função inválida.')
    }
    requestedRoleId = requested
  }

  const { data: defaultRole, error } = await admin.from('roles').select('id').eq('is_default', true).maybeSingle()
  if (error) throw error

  const roleId = requestedRoleId ?? defaultRole?.id ?? null
  if (!roleId || roleId === defaultRole?.id) return roleId

  const { data: role, error: roleError } = await admin.from('roles').select('id').eq('id', roleId).maybeSingle()
  if (roleError) throw roleError
  if (!role) throw new HttpError(400, 'Função inválida.')

  // O formulário libera a escolha de função para assign_role ou manage_roles.
  const canAssign = (await hasPermission(admin, callerId, 'assign_role'))
    || (await hasPermission(admin, callerId, 'manage_roles'))
  if (!canAssign) {
    throw forbidden('Você não tem permissão para definir a função do membro.')
  }

  const { data: callerMember, error: callerError } = await admin
    .from('members').select('role_id').eq('auth_user_id', callerId).maybeSingle()
  if (callerError) throw callerError

  const [target, own] = await Promise.all([
    rolePermissions(admin, roleId),
    callerMember?.role_id ? rolePermissions(admin, callerMember.role_id) : Promise.resolve(new Set<string>()),
  ])
  if ([...target].some((permission) => !own.has(permission))) {
    throw forbidden('Você não pode atribuir uma função com mais permissões do que a sua.')
  }
  return roleId
}

/**
 * 5. Aviso de cadastro excluído (E2.01, RN-18), com a sessão de quem chama: o
 * banco devolve nome, id e data só para o administrador que veria o excluído
 * (DA-8). Recusa com 409 antes de existir qualquer conta.
 */
async function checkDeletedMatches(asCaller: SupabaseClient, input: CreateMemberInput): Promise<void> {
  const { data, error } = await asCaller.rpc('find_deleted_member_matches', deletedMatchesParams(input.memberRow))
  if (error) {
    if (error.code === '42501') throw forbidden()
    console.error('create-user-admin: falha ao consultar cadastros excluídos', error.code)
    throw serverError()
  }
  const refusal = deletedMatchesRefusal(toDeletedMatches(data), input.confirmDeletedMatches)
  if (refusal) throw refusal
}

/** 6. Conta de acesso. Devolve o id da conta criada. */
async function createAccount(admin: SupabaseClient, input: CreateMemberInput): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { name: input.name },
  })
  if (error || !data.user) {
    throw error ? authErrorToHttp(error) : new HttpError(400, 'Não foi possível criar o acesso.')
  }
  return data.user.id
}

/** 7. Cadastro do membro com a sessão de quem chamou (RLS, triggers e autor na Auditoria). */
async function insertMember(asCaller: SupabaseClient, memberRow: Record<string, unknown>, authUserId: string): Promise<void> {
  const { error } = await asCaller.from('members').insert({ ...memberRow, auth_user_id: authUserId })
  if (error) throw insertErrorToHttp(error)
}

/** 8. Desfaz a conta criada nesta chamada quando o cadastro falha. */
async function undoAccount(admin: SupabaseClient, authUserId: string): Promise<void> {
  const { error } = await admin.auth.admin.deleteUser(authUserId)
  if (error) {
    console.error('create-user-admin: rollback falhou, conta de acesso órfã', authUserId, error.message)
  }
}

/** Id do membro gravado. Os dados são lidos pela members_view, com a máscara (E1.08, PR 5). */
async function createdMemberId(admin: SupabaseClient, authUserId: string): Promise<string | null> {
  const { data, error } = await admin.from('members').select('id').eq('auth_user_id', authUserId).maybeSingle()
  if (error) console.error('create-user-admin: membro gravado, mas a releitura falhou', error.code)
  return data?.id ?? null
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false },
  })
  let createdUserId: string | null = null

  try {
    const { callerId, token } = await authenticate(admin, req)
    await requireCreateMember(admin, callerId)
    const input = await readInput(req)
    input.memberRow.role_id = await resolveRole(admin, callerId, input.memberRow.role_id)

    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    await checkDeletedMatches(asCaller, input)

    createdUserId = await createAccount(admin, input)
    await insertMember(asCaller, input.memberRow, createdUserId)

    // O membro foi gravado: a partir daqui a conta de acesso não deve ser desfeita.
    const authUserId = createdUserId
    createdUserId = null

    const memberId = await createdMemberId(admin, authUserId)
    return json({ member: memberId ? { id: memberId } : null }, 200)
  } catch (error) {
    if (createdUserId) await undoAccount(admin, createdUserId)
    if (error instanceof HttpError) return json(error.body(), error.status)
    console.error('create-user-admin: erro inesperado', error)
    const unexpected = serverError()
    return json(unexpected.body(), unexpected.status)
  }
})
