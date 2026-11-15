-- E1.13 — Auditoria confiável e visibilidade de membros.
-- Ver docs/migracao.md (passo E1.13) no repositório apps-mci.
--
-- 1. Funções internas fechadas para a API. No Supabase, as funções do schema
--    public recebem EXECUTE direto para anon e authenticated, então o
--    "REVOKE ... FROM PUBLIC" original não bastava. Os triggers continuam
--    funcionando, porque rodam como o dono da função (postgres).
-- 2. log_auth_event: só para usuário autenticado, só login/logout, autor sempre
--    vindo da sessão e no máximo um evento igual a cada 30 segundos. As falhas
--    de login passam a ser registradas no servidor (passo E1.04).
-- 3. A política de SELECT de members deixa de expor a linha inteira (CPF,
--    e-mail, telefone, endereço) dos líderes de membros visíveis. Para exibir
--    o nome deles há a função member_names, que devolve só id e nome.
-- 4. As funções auxiliares usadas pelo RLS deixam de ser chamáveis por anon
--    (todas as políticas são TO authenticated).

-- ---------------------------------------------------------------------------
-- 1. Funções internas de auditoria
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public._log_event(
  public.event_action, public.event_entity, uuid, text, text,
  text[], jsonb, boolean, text, uuid
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public._mask_identifier(text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. log_auth_event
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_auth_event(
  _action public.event_action,
  _success boolean,
  _identifier text DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN ('login', 'logout') THEN
    RAISE EXCEPTION 'Ação inválida para log_auth_event.' USING ERRCODE = '22023';
  END IF;

  -- Evita enxurrada de eventos repetidos vindos do cliente.
  IF EXISTS (
    SELECT 1 FROM public.events
     WHERE actor_user_id = _uid
       AND entity = 'auth'
       AND action = _action
       AND occurred_at > now() - interval '30 seconds'
  ) THEN
    RETURN;
  END IF;

  PERFORM public._log_event(
    _action        => _action,
    _entity        => 'auth'::public.event_entity,
    _entity_id     => _uid,
    _entity_label  => NULL,
    _description   => CASE _action WHEN 'login' THEN 'Login realizado' ELSE 'Logout realizado' END,
    _metadata      => jsonb_strip_nulls(jsonb_build_object(
                        'identifier_masked', public._mask_identifier(_identifier)
                      )),
    _success       => true,
    _error_reason  => NULL,
    _actor_user_id => _uid
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_auth_event(public.event_action, boolean, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_auth_event(public.event_action, boolean, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Visibilidade de membros
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members view policy" ON public.members;

CREATE POLICY "Members view policy"
ON public.members
FOR SELECT
TO authenticated
USING (
  user_has_permission(auth.uid(), 'view_all_church'::permission_action)
  OR user_has_permission(auth.uid(), 'view_members'::permission_action)
  OR (
    user_has_permission(auth.uid(), 'view_own_ministry'::permission_action)
    AND is_in_same_ministry(auth.uid(), id)
  )
  OR (auth_user_id = auth.uid())
);

-- Nomes de membros para exibição (ex.: líder de um membro visível que está
-- fora do ministério de quem consulta). Devolve só id e nome, e só para quem a
-- pessoa poderia ver ou para líderes de membros que ela vê. No máximo 500 ids.
CREATE OR REPLACE FUNCTION public.member_names(_ids uuid[])
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.name
    FROM public.members m
   WHERE auth.uid() IS NOT NULL
     AND coalesce(cardinality(_ids), 0) <= 500
     AND m.id = ANY (_ids)
     AND (
       public.user_has_permission(auth.uid(), 'view_all_church'::permission_action)
       OR public.user_has_permission(auth.uid(), 'view_members'::permission_action)
       OR m.auth_user_id = auth.uid()
       OR (
         public.user_has_permission(auth.uid(), 'view_own_ministry'::permission_action)
         AND (
           public.is_in_same_ministry(auth.uid(), m.id)
           OR public.is_leader_of_visible_member(auth.uid(), m.id)
         )
       )
     )
$$;

REVOKE EXECUTE ON FUNCTION public.member_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_names(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Funções auxiliares do RLS: só para authenticated
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, public.permission_action) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_in_same_ministry(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_ministry_root(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_manage_own_cell(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_leader_of_visible_member(uuid, uuid) FROM PUBLIC, anon;

-- As políticas de RLS (TO authenticated) e o trigger de escrita em members
-- precisam executar estas funções como authenticated.
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, public.permission_action) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_in_same_ministry(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ministry_root(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_own_cell(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_leader_of_visible_member(uuid, uuid) TO authenticated;
