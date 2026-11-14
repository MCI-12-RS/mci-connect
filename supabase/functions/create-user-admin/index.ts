// Cria a conta de acesso (Supabase Auth) e o cadastro do membro.
//
// Segurança (passo E1.02 de docs/migracao.md no repositório apps-mci):
// - quem chama precisa estar autenticado e ter a permissão `create_member`;
// - só as colunas de cadastro listadas em MEMBER_FIELDS são aceitas;
// - sem `assign_role`, o membro só recebe o perfil padrão. Com `assign_role`,
//   não é possível atribuir um perfil com permissões que quem chama não tem;
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

async function resolveRole(
  admin: SupabaseClient,
  callerId: string,
  requestedRoleId: string | null | undefined,
): Promise<string | null> {
  const { data: defaultRole, error } = await admin.from('roles').select('id').eq('is_default', true).maybeSingle()
  if (error) throw error

  const roleId = requestedRoleId ?? defaultRole?.id ?? null
  if (!roleId || roleId === defaultRole?.id) return roleId

  if (!(await hasPermission(admin, callerId, 'assign_role'))) {
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
    const input = (body?.memberData ?? {}) as Record<string, unknown>
    if (!email || !password) throw new HttpError(400, 'E-mail e senha são obrigatórios.')
    if (typeof input.name !== 'string' || !input.name.trim()) throw new HttpError(400, 'O nome é obrigatório.')

    const memberRow: Record<string, unknown> = {}
    for (const field of MEMBER_FIELDS) {
      if (field in input) memberRow[field] = input[field]
    }
    memberRow.email = email
    memberRow.role_id = await resolveRole(admin, caller.id, memberRow.role_id as string | null | undefined)

    // 4. Conta de acesso
    const { data: authData, error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: input.name },
    })
    if (authError || !authData.user) {
      throw new HttpError(400, authError?.message ?? 'Não foi possível criar o acesso.')
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
    if (insertError) throw new HttpError(400, insertError.message)

    const { data: member, error: readError } = await admin
      .from('members').select('*').eq('auth_user_id', createdUserId).single()
    if (readError) throw readError

    createdUserId = null // deu certo: nada a desfazer
    return json({ member }, 200)
  } catch (error) {
    if (createdUserId) {
      await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined)
    }
    const status = error instanceof HttpError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Erro inesperado.'
    return json({ error: message }, status)
  }
})
