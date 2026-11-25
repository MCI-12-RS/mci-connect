-- E1.04, migration 4 (PR 3): log_auth_event só aceita logout.
--
-- Desde o E1.04 o login é gravado só pelo servidor (sign_in_record_login, chamada
-- pela Edge Function sign-in). O cliente deixa de poder gravar um login, para que
-- nenhum login possa ser forjado na Auditoria (RN-15, DT-11).
--
-- Muda só a ação aceita: 'login' (e qualquer outra) dá 22023. O resto é igual à
-- versão do E2.01 (20261123233300_e201_03_read): 42501 sem sessão, membro
-- excluído não grava nada (DA-9 do E2.01) e deduplicação de 30 s. A assinatura
-- não muda; o app anterior ao E1.04 ignora o erro do login.
--
-- Idempotente: CREATE OR REPLACE e REVOKE/GRANT podem rodar de novo.

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
  IF _action IS DISTINCT FROM 'logout' THEN
    RAISE EXCEPTION 'Ação inválida para log_auth_event.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.members
     WHERE auth_user_id = _uid
       AND deleted_at IS NOT NULL
  ) THEN
    RETURN;
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
    _description   => 'Logout realizado',
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
