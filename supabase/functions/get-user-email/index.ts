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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { identifier } = await req.json()

    if (!identifier) {
      throw new Error('Identifier is required.')
    }

    const cleanIdentifier = identifier.replace(/\D/g, '')

    // Search for the member by CPF or Mobile
    // With data cleaned in DB, we only need to search the clean identifier
    const { data: member, error } = await supabaseClient
      .from('members')
      .select('email')
      .or(`cpf.eq."${cleanIdentifier}",mobile_whatsapp.eq."${cleanIdentifier}"`)
      .limit(1)
      .maybeSingle()

    if (error) throw error

    return new Response(JSON.stringify({ email: member?.email || null }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})
