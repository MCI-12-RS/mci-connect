import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verify the calling user's JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Não autorizado')

    const token = authHeader.replace('Bearer ', '')
    const { data: { user: callingUser }, error: authError } = await supabaseAdmin.auth.getUser(token)
    if (authError || !callingUser) throw new Error('Não autorizado')

    // Check if caller has change_member_password permission
    const { data: hasPerm } = await supabaseAdmin.rpc('user_has_permission', {
      _user_id: callingUser.id,
      _permission: 'change_member_password'
    })

    if (!hasPerm) {
      // Also check if user is admin (manage_roles)
      const { data: isAdm } = await supabaseAdmin.rpc('is_admin', { _user_id: callingUser.id })
      if (!isAdm) throw new Error('Sem permissão para alterar senhas')
    }

    const { member_id, new_password } = await req.json()
    if (!member_id || !new_password) throw new Error('member_id e new_password são obrigatórios')
    if (new_password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres')

    // Get the auth_user_id for this member
    const { data: member, error: memberError } = await supabaseAdmin
      .from('members')
      .select('auth_user_id')
      .eq('id', member_id)
      .single()

    if (memberError || !member) throw new Error('Membro não encontrado')
    if (!member.auth_user_id) throw new Error('Este membro não possui acesso ao sistema')

    // Update the password
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
      member.auth_user_id,
      { password: new_password }
    )

    if (updateError) throw updateError

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido'
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
