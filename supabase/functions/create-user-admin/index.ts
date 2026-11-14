// Cria a conta de acesso (Supabase Auth) e o cadastro do membro.
//
// Segurança (passo E1.02 de docs/migracao.md no repositório apps-mci):
// - quem chama precisa estar autenticado e ter a permissão `create_member`;
// - só as colunas de cadastro listadas em MEMBER_FIELDS são aceitas;
// - sem `assign_role` (ou `manage_roles`), o membro só recebe o perfil padrão.
//   Com elas, não é possível atribuir um perfil com permissões que quem chama
//   não tem;
// - erros do banco e do Auth viram mensagens genéricas, sem detalhes internos;
// - o membro é gravado com a sessão de quem chama, então o RLS de `members` vale
//   e a auditoria registra o autor;
// - se a gravação do membro falhar, a conta de acesso recém-criada é removida.
//
// A verificação do JWT é feita aqui dentro (auth.getUser), e não no gateway
// (`verify_jwt` no config.toml), porque ela funciona tanto com as chaves antigas
// quanto com as chaves novas (publishable/secret) do Supabase.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

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

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// Traduz erros do Postgres/PostgREST sem expor nomes de constraints ou valores.
function insertErrorToHttp(error: { code?: string; message?: string }): HttpError {
  switch (error.code) {
    case '23505': return new HttpError(409, 'Já existe um membro com este e-mail, CPF ou celular.')
    case '23503': return new HttpError(400, 'Líder, cônjuge ou função informados não existem.')
    case '23514': return new HttpError(400, 'Algum campo tem um valor inválido.')
    case '22P02':
    case '22007':
    case '22008': return new HttpError(400, 'Algum campo tem um formato inválido.')
    case '42501': return new HttpError(403, 'Você não tem permissão para cadastrar membros.')
    default:
      console.error('create-user-admin: falha ao inserir membro', error)
      return new HttpError(400, 'Não foi possível salvar o cadastro.')
  }
}

function authErrorToHttp(error: { code?: string; message?: string; status?: number }): HttpError {
  if (error.code === 'email_exists' || error.code === 'user_already_exists') {
    return new HttpError(409, 'Já existe uma conta de acesso com este e-mail.')
  }
  if (error.code === 'weak_password') return new HttpError(400, 'A senha não atende aos requisitos mínimos.')
  if (error.code === 'email_address_invalid' || error.code === 'validation_failed') {
    return new HttpError(400, 'E-mail inválido.')
  }
  console.error('create-user-admin: falha ao criar a conta de acesso', error)
  return new HttpError(400, 'Não foi possível criar o acesso.')
}

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  })

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
    throw new HttpError(403, 'Você não tem permissão para definir a função do membro.')
  }

  const { data: callerMember, error: callerError } = await admin
    .from('members').select('role_id').eq('auth_user_id', callerId).maybeSingle()
  if (callerError) throw callerError

  const [target, own] = await Promise.all([
    rolePermissions(admin, roleId),
    callerMember?.role_id ? rolePermissions(admin, callerMember.role_id) : Promise.resolve(new Set<string>()),
  ])
  if ([...target].some((permission) => !own.has(permission))) {
    throw new HttpError(403, 'Você não pode atribuir uma função com mais permissões do que a sua.')
  }
  return roleId
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
    // 1. Quem está chamando
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    if (!token) throw new HttpError(401, 'Não autenticado.')
    const { data: { user: caller }, error: callerError } = await admin.auth.getUser(token)
    if (callerError || !caller) throw new HttpError(401, 'Não autenticado.')

    // 2. Permissão para cadastrar membros
    if (!(await hasPermission(admin, caller.id, 'create_member'))) {
      throw new HttpError(403, 'Você não tem permissão para cadastrar membros.')
    }

    // 3. Entrada
    const body = await req.json().catch(() => null)
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body?.password === 'string' ? body.password : ''
    const rawInput = body?.memberData ?? {}
    if (typeof rawInput !== 'object' || Array.isArray(rawInput)) {
      throw new HttpError(400, 'Dados do membro inválidos.')
    }
    const input = rawInput as Record<string, unknown>
    if (!email || !password) throw new HttpError(400, 'E-mail e senha são obrigatórios.')
    if (typeof input.name !== 'string' || !input.name.trim()) throw new HttpError(400, 'O nome é obrigatório.')

    const memberRow: Record<string, unknown> = {}
    for (const field of MEMBER_FIELDS) {
      if (field in input) memberRow[field] = input[field]
    }
    memberRow.email = email
    memberRow.role_id = await resolveRole(admin, caller.id, memberRow.role_id)

    // 4. Conta de acesso
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: input.name },
    })
    if (authError || !authData.user) {
      throw authError ? authErrorToHttp(authError) : new HttpError(400, 'Não foi possível criar o acesso.')
    }
    createdUserId = authData.user.id

    // 5. Cadastro do membro com a sessão de quem chamou (RLS + autor na auditoria)
    const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    })
    const { error: insertError } = await asCaller
      .from('members')
      .insert({ ...memberRow, auth_user_id: createdUserId })
    if (insertError) throw insertErrorToHttp(insertError)

    // O membro foi gravado: a partir daqui a conta de acesso não deve ser desfeita.
    const authUserId = createdUserId
    createdUserId = null

    const { data: member, error: readError } = await admin
      .from('members').select('*').eq('auth_user_id', authUserId).maybeSingle()
    if (readError) console.error('create-user-admin: membro gravado, mas a releitura falhou', readError)
    return json({ member: member ?? null }, 200)
  } catch (error) {
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined)
    }
    if (error instanceof HttpError) return json({ error: error.message }, error.status)
    console.error('create-user-admin: erro inesperado', error)
    return json({ error: 'Erro inesperado ao cadastrar o membro.' }, 500)
  }
})
