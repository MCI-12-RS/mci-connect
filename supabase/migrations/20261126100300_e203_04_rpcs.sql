-- E2.03 (PR 1, migration 4 de 4) — Redefinição, trocas, senha inicial e
-- leituras para a tela. Ver docs/specs/e2-03-senha.md no repositório apps-mci
-- ("Redefinição", "Trocas", "Senha inicial", "Contratos", "Auditoria",
-- "Bloqueios e concorrência"; RN-01 a RN-08, RN-10 a RN-13, RN-16, RN-17;
-- DA-1 a DA-3, DA-7, DA-8, DA-13, DA-15; DT-03, DT-07, DT-08, DT-12, DT-15).
--
-- Conteúdo (neutro para a tela: nada aqui é chamado pelo front de hoje, e o
-- portão continua desligado até a migration 5):
--   1. private.reset_refused: registra a recusa e devolve o JSON.
--   2. public.reset_member_password(_member_id uuid) → jsonb
--        authenticated. Definer, com a sessão de quem redefine.
--   3. public.change_own_password(_auth_user_id, _session_id, _mode,
--        _current_password, _new_password, _confirmation, _origin, _request_id)
--        → jsonb. Só service_role (a Edge Function change-own-password).
--   4. public.set_initial_password(_auth_user_id, _member_id, _password,
--        _cpf, _mobile, _birth_date, _email) → void. Só service_role
--        (a create-user-admin).
--   5. public.my_password_status() → TABLE (must_change_password boolean).
--        authenticated. Passa só por assert_session_alive.
--   6. members_view.password_reset_status (no fim da view).
--
-- Travas (ordem global no cabeçalho da e203_03_vault):
--   reset_member_password: linha password_reset de quem redefine → alvo
--     FOR KEY SHARE (conflita com o FOR UPDATE da delete_member; deleted_at é
--     relido depois da trava) → cofre (write_password) → sessões e eventos.
--     lock_timeout 5 s (DA-15).
--   change_own_password: origin (só na voluntária) < password_change da conta
--     → cofre FOR UPDATE → sessões e eventos. lock_timeout 3 s.
--   set_initial_password: cofre. lock_timeout 3 s.
--
-- Auditoria (RN-17): o sucesso grava o evento sem engolir erro (se falhar,
-- tudo volta); a recusa, a falha e o bloqueio gravam num sub-bloco que engole
-- o erro (o WARNING traz só o SQLSTATE). Nenhum evento leva senha, hash,
-- origem nem o request_id.
--
-- Senhas como parâmetro (risco 5, DT-19 do E1.04): change_own_password e
-- set_initial_password passam pelo teto de 5 s antes de devolver
-- (private.password_result / sign_in_assert_duration). A senha nunca vai para
-- RAISE nem log. A temporária sai uma vez, na resposta, com
-- Cache-Control: no-store, e nunca entra como parâmetro.
--
-- Grants: nenhuma função nova com EXECUTE para anon; as internas sem EXECUTE
-- para ninguém além do dono. Idempotente: CREATE OR REPLACE e GRANT/REVOKE.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisito: migration 3 deste passo.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('private.account_passwords') IS NULL
     OR to_regprocedure('private.write_password(uuid,uuid,text,uuid)') IS NULL
     OR to_regprocedure('private.throttle_lock(text,text,interval)') IS NULL THEN
    RAISE EXCEPTION 'e203_04_rpcs depende da e203_03_vault.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Recusa da redefinição (RN-02, RN-06, RN-17 b; DA-1, DA-2). Registra num
--    sub-bloco que engole erro e devolve o JSON de recusa. out_of_scope e
--    member_deleted saem com o mesmo código (not_found) e o mesmo texto; só a
--    Auditoria distingue. O alvo só vai para o evento quando existe.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.reset_refused(
  _reason              text,
  _target_id           uuid,
  _retry_after_minutes integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  _code    text := CASE WHEN _reason IN ('out_of_scope', 'member_deleted') THEN 'not_found' ELSE _reason END;
  _message text;
  _label   text;
  _id      uuid;
BEGIN
  _message := CASE _code
    WHEN 'no_permission'    THEN 'Você não tem permissão para redefinir senhas.'
    WHEN 'rate_limited'     THEN 'Você redefiniu muitas senhas na última hora. Aguarde '
                                 || coalesce(_retry_after_minutes, 1)::text
                                 || CASE WHEN coalesce(_retry_after_minutes, 1) = 1 THEN ' minuto' ELSE ' minutos' END
                                 || ' e tente de novo.'
    WHEN 'not_found'        THEN 'Este cadastro não existe ou já foi excluído.'
    WHEN 'self'             THEN 'Para trocar a sua senha, use "Alterar minha senha".'
    WHEN 'role_not_covered' THEN 'Você não tem permissão para redefinir a senha deste membro.'
    WHEN 'no_account'       THEN 'Este membro não tem acesso ao sistema.'
  END;
  IF _message IS NULL THEN
    RAISE EXCEPTION 'reset_refused: motivo desconhecido.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    SELECT m.id, m.name INTO _id, _label FROM public.members m WHERE m.id = _target_id;
    PERFORM public._log_event(
      _action        => 'password_reset_refused'::public.event_action,
      _entity        => 'auth'::public.event_entity,
      _entity_id     => _id,
      _entity_label  => _label,
      _description   => 'Redefinição de senha recusada',
      _changed_fields => NULL,
      _metadata      => jsonb_build_object('reason', _reason),
      _success       => false,
      _error_reason  => CASE _reason
                          WHEN 'no_permission'    THEN 'Sem permissão'
                          WHEN 'rate_limited'     THEN 'Limite de redefinições'
                          WHEN 'out_of_scope'     THEN 'Fora do que a pessoa vê'
                          WHEN 'member_deleted'   THEN 'Cadastro excluído'
                          WHEN 'self'             THEN 'Própria senha'
                          WHEN 'role_not_covered' THEN 'Função não coberta'
                          WHEN 'no_account'       THEN 'Sem conta de acesso'
                        END,
      _actor_user_id => NULL                                -- auth.uid() de quem tentou
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'reset_member_password: falha ao registrar a recusa (SQLSTATE %).', SQLSTATE;
  END;

  RETURN jsonb_strip_nulls(jsonb_build_object(
    'result', 'refused',
    'code', _code,
    'message', _message,
    'retry_after_minutes', CASE WHEN _code = 'rate_limited' THEN _retry_after_minutes END));
END;
$$;
REVOKE ALL ON FUNCTION private.reset_refused(text, uuid, integer) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Redefinição (RN-01 a RN-06, DT-07). Sempre HTTP 200, com result:
--   {"result":"ok","password":text,"expires_at":timestamptz,"reset_at":timestamptz}
--   {"result":"refused","code":"no_permission"|"rate_limited"|"not_found"|"self"
--     |"role_not_covered"|"no_account","message":text,"retry_after_minutes"?:int}
-- A recusa faz commit (o registro fica; nada mais muda). Erro do banco, trava
-- além de 5 s ou falha da Auditoria do sucesso: exceção, e nada muda.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reset_member_password(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
AS $$
DECLARE
  c_limit  constant integer  := 20;                       -- RN-06
  c_window constant interval := interval '60 minutes';
  c_valid  constant interval := interval '168 hours';     -- RN-05
  _me      uuid := public.viewer_member_id();             -- a partir do PR 4, passa pelo portão
  _row     private.sign_in_throttle;
  _target  public.members;
  _auth    uuid;
  _temp    text;
  _expires timestamptz;
BEGIN
  PERFORM set_config('response.headers', '[{"Cache-Control": "no-store"}]', true);

  -- 1. Permissão (RN-01): sem cadastro, sem função ou sem a permissão.
  IF _me IS NULL OR NOT public.viewer_has('change_member_password'::public.permission_action) THEN
    RETURN private.reset_refused('no_permission', _member_id);
  END IF;

  -- 2. Limite (RN-06): trava a linha de quem redefine e poda a janela.
  --    Aqui, failures guarda as redefinições ACEITAS.
  _row := private.throttle_lock('password_reset', _me::text, c_window);
  IF cardinality(_row.failures) >= c_limit THEN
    RETURN private.reset_refused('rate_limited', _member_id,
             greatest(1, ceil(extract(epoch FROM _row.failures[1] + c_window - clock_timestamp()) / 60)::integer));
  END IF;

  -- 3. Alvo. A trava conflita com o FOR UPDATE da delete_member (E2.01), e
  --    deleted_at é lido depois dela.
  IF _member_id IS NOT NULL THEN
    SELECT * INTO _target FROM public.members WHERE id = _member_id FOR KEY SHARE;
  END IF;
  IF _target.id IS NULL THEN
    RETURN private.reset_refused('out_of_scope', NULL);                    -- DA-1
  END IF;
  IF _target.deleted_at IS NOT NULL THEN
    RETURN private.reset_refused('member_deleted', _target.id);            -- DA-2
  END IF;
  IF NOT public.viewer_sees_member(_target.id) THEN
    RETURN private.reset_refused('out_of_scope', _target.id);
  END IF;
  -- 4 a 6.
  IF _target.id = _me THEN
    RETURN private.reset_refused('self', _target.id);
  END IF;
  IF NOT public.viewer_covers_role(_target.role_id) THEN
    RETURN private.reset_refused('role_not_covered', _target.id);
  END IF;
  _auth := private.usable_account(_target.auth_user_id);                   -- DA-3
  IF _auth IS NULL THEN
    RETURN private.reset_refused('no_account', _target.id);
  END IF;

  -- 7. Gravação, sem engolir erro: se a Auditoria falhar, nada muda (RN-17).
  _temp := private.generate_temporary_password(_target.cpf, _target.mobile_whatsapp,
                                               _target.birth_date, _target.email);
  _expires := now() + c_valid;
  PERFORM private.write_password(_auth, _target.id, _temp, _me);           -- trava a linha do cofre
  PERFORM private.set_must_change(_auth, 'reset', _expires);
  PERFORM private.end_sessions(_auth, NULL);                               -- RN-16: todas as do alvo
  UPDATE private.sign_in_throttle                                          -- só a aceita conta (RN-06)
     SET failures   = failures || clock_timestamp(),
         expires_at = clock_timestamp() + c_window
   WHERE kind = _row.kind
     AND key_hash = _row.key_hash;
  PERFORM public._log_event(
    _action        => 'password_reset'::public.event_action,
    _entity        => 'auth'::public.event_entity,
    _entity_id     => _target.id,
    _entity_label  => _target.name,
    _description   => 'Senha redefinida',
    _changed_fields => NULL,
    _metadata      => jsonb_build_object('valid_until', _expires),
    _success       => true,
    _error_reason  => NULL,
    _actor_user_id => NULL                                                 -- auth.uid() de quem redefiniu
  );

  RETURN jsonb_build_object('result', 'ok', 'password', _temp, 'expires_at', _expires, 'reset_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.reset_member_password(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reset_member_password(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Trocas (RN-10 a RN-13, RN-16, DT-08, DT-16). Chamada só pela
--    change-own-password, com a chave secreta, depois de conferir o token
--    (auth.getUser) e a origem (cabeçalho confiável, DT-06 do E1.04).
-- Retorno (jsonb), traduzido em HTTP pela função:
--   {"result":"ok"} | {"result":"ok","replayed":true}                 200
--   {"result":"empty_fields"}                                           400
--   {"result":"invalid","code":<política>|"password_same_as_current",
--    "field":"new_password"}                                            400
--   {"result":"invalid","code":"password_mismatch","field":"confirmation"} 400
--   {"result":"session_ended"}                                          401
--   {"result":"not_flagged"}                                            403
--   {"result":"forbidden"}                                              403
--   {"result":"current_password_invalid"}                               422
--   {"result":"change_blocked","retry_after_seconds":int,
--    "retry_after_minutes":int}                                         429
-- Entrada malformada (modo, conta, sessão ou request_id nulos; origem
-- ausente ou inválida na voluntária): 22023, sem contar nada (500).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_own_password(
  _auth_user_id     uuid,
  _session_id       uuid,
  _mode             text,
  _current_password text,
  _new_password     text,
  _confirmation     text,
  _origin           text,
  _request_id       uuid
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  -- RN-12. A origem soma no mesmo limite do login (RN-11 do E1.04: 50 desde
  -- a 20261125003300_e104_03, risco 16).
  c_account_limit constant integer  := 5;
  c_origin_limit  constant integer  := 50;
  c_window        constant interval := interval '15 minutes';
  c_block         constant interval := interval '15 minutes';
  _voluntary      boolean;
  _origin_inet    inet;
  _member         record;
  _origin_row     private.sign_in_throttle;
  _account_row    private.sign_in_throttle;
  _vault          private.account_passwords;
  _now            timestamptz;
  _blocked_until  timestamptz;
  _seconds        integer;
  _violation      text;
  _blocked_account boolean := false;
  _blocked_origin  boolean := false;
  _block_minutes  integer := ceil(extract(epoch FROM c_block) / 60)::integer;
BEGIN
  -- 1. Entrada.
  IF _auth_user_id IS NULL OR _session_id IS NULL OR _request_id IS NULL
     OR _mode IS NULL OR _mode NOT IN ('forced', 'voluntary') THEN
    RAISE EXCEPTION 'change_own_password: entrada inválida.' USING ERRCODE = '22023';
  END IF;
  _voluntary := _mode = 'voluntary';
  IF coalesce(_new_password, '') = '' OR coalesce(_confirmation, '') = ''
     OR (_voluntary AND coalesce(_current_password, '') = '') THEN
    RETURN private.password_result(jsonb_build_object('result', 'empty_fields'));
  END IF;
  IF _voluntary THEN                                     -- a mensagem não leva o valor
    BEGIN
      _origin_inet := _origin::inet;
    EXCEPTION WHEN data_exception THEN
      RAISE EXCEPTION 'change_own_password: origem inválida.' USING ERRCODE = '22023';
    END;
    IF _origin_inet IS NULL THEN
      RAISE EXCEPTION 'change_own_password: origem ausente.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 2. Cadastro não excluído da conta.
  SELECT m.id, m.name, m.cpf, m.mobile_whatsapp, m.birth_date, m.email INTO _member
    FROM public.members m
   WHERE m.auth_user_id = _auth_user_id
     AND m.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN private.password_result(jsonb_build_object('result', 'forbidden'));
  END IF;

  -- 3. Travas, nesta ordem: origin < password_change (kind), depois o cofre.
  IF _voluntary THEN
    _origin_row := private.throttle_lock('origin', 'o:' || private.sign_in_origin_key(_origin_inet), c_window);
  END IF;
  _account_row := private.throttle_lock('password_change', _auth_user_id::text, c_window);
  SELECT * INTO _vault
    FROM private.account_passwords p
   WHERE p.auth_user_id = _auth_user_id
     FOR UPDATE;
  _now := clock_timestamp();

  -- 4. Sessão, depois das travas: pega a redefinição ou a troca em outro
  --    aparelho que terminou enquanto esta esperava (RN-16).
  IF NOT EXISTS (SELECT 1 FROM auth.sessions s
                  WHERE s.id = _session_id AND s.user_id = _auth_user_id) THEN
    RETURN private.password_result(jsonb_build_object('result', 'session_ended'));
  END IF;

  -- 5. Reenvio (AQ-5, DA-13): mesma sessão, mesma chave e a mesma senha nova.
  IF _vault.last_change_session_id = _session_id
     AND _vault.last_change_request_id = _request_id
     AND _vault.password_hash IS NOT NULL
     AND octet_length(_new_password) <= 72
     AND extensions.crypt(_new_password, _vault.password_hash) = _vault.password_hash THEN
    RETURN private.password_result(jsonb_build_object('result', 'ok', 'replayed', true));
  END IF;

  IF NOT _voluntary THEN
    -- 6. Obrigatória: só com a marca (RN-10). A senha atual não é pedida.
    IF NOT coalesce(_vault.must_change, false) THEN
      RETURN private.password_result(jsonb_build_object('result', 'not_flagged'));
    END IF;
  ELSE
    -- 7. Voluntária. Bloqueio vigente (conta ou origem): nada é conferido,
    --    contado nem registrado (RN-12).
    _blocked_until := greatest(
      CASE WHEN _account_row.blocked_until > _now THEN _account_row.blocked_until END,
      CASE WHEN _origin_row.blocked_until  > _now THEN _origin_row.blocked_until  END);
    IF _blocked_until IS NOT NULL THEN
      _seconds := greatest(ceil(extract(epoch FROM _blocked_until - _now))::integer, 1);
      RETURN private.password_result(jsonb_build_object(
        'result', 'change_blocked',
        'retry_after_seconds', _seconds,
        'retry_after_minutes', greatest(ceil(_seconds / 60.0)::integer, 1)));
    END IF;

    -- Senha atual: errada acima de 72 bytes (DA-5 do E1.04), sem hash ou
    -- quando o bcrypt não confere.
    IF _vault.password_hash IS NULL
       OR octet_length(_current_password) > 72
       OR extensions.crypt(_current_password, _vault.password_hash) <> _vault.password_hash THEN
      -- Janela deslizante nas duas linhas; a que chega ao limite é bloqueada
      -- por 15 min e volta a zero (o mesmo algoritmo da sign_in_attempt).
      WITH cur AS (
        SELECT t.kind, t.key_hash,
               array(SELECT f FROM unnest(t.failures) AS f WHERE f > _now - c_window ORDER BY f)
                 || _now AS fails,
               CASE t.kind WHEN 'password_change' THEN c_account_limit ELSE c_origin_limit END AS lim
          FROM private.sign_in_throttle t
         WHERE (t.kind, t.key_hash) IN ((_account_row.kind, _account_row.key_hash),
                                        (_origin_row.kind, _origin_row.key_hash))
      ), upd AS (
        UPDATE private.sign_in_throttle t
           SET failures      = CASE WHEN cardinality(c.fails) >= c.lim THEN '{}' ELSE c.fails END,
               blocked_until = CASE WHEN cardinality(c.fails) >= c.lim THEN _now + c_block END,
               expires_at    = _now + CASE WHEN cardinality(c.fails) >= c.lim
                                           THEN greatest(c_window, c_block) ELSE c_window END
          FROM cur c
         WHERE t.kind = c.kind
           AND t.key_hash = c.key_hash
        RETURNING t.kind, t.blocked_until IS NOT NULL AS blocked
      )
      SELECT coalesce(bool_or(blocked) FILTER (WHERE kind = 'password_change'), false),
             coalesce(bool_or(blocked) FILTER (WHERE kind = 'origin'), false)
        INTO _blocked_account, _blocked_origin
        FROM upd;

      -- Auditoria (RN-17 d, e; DA-8). A falha de gravação não muda a resposta.
      BEGIN
        PERFORM public._log_event(
          _action        => 'password_change_failed'::public.event_action,
          _entity        => 'auth'::public.event_entity,
          _entity_id     => _member.id,
          _entity_label  => _member.name,
          _description   => 'Falha na troca de senha',
          _changed_fields => NULL,
          _metadata      => jsonb_build_object('reason', 'current_password_invalid'),
          _success       => false,
          _error_reason  => 'Senha atual incorreta',
          _actor_user_id => _auth_user_id
        );
        IF _blocked_account THEN
          PERFORM public._log_event(
            _action        => 'password_change_blocked'::public.event_action,
            _entity        => 'auth'::public.event_entity,
            _entity_id     => _member.id,
            _entity_label  => _member.name,
            _description   => 'Troca de senha bloqueada por excesso de tentativas',
            _changed_fields => NULL,
            _metadata      => jsonb_build_object('block_minutes', _block_minutes),
            _success       => false,
            _error_reason  => NULL,
            _actor_user_id => _auth_user_id
          );
        END IF;
        IF _blocked_origin THEN                          -- como no E1.04: sem cadastro nem origem
          PERFORM public._log_event(
            _action        => 'login_blocked'::public.event_action,
            _entity        => 'auth'::public.event_entity,
            _entity_id     => NULL,
            _entity_label  => NULL,
            _description   => 'Login bloqueado por excesso de tentativas',
            _changed_fields => NULL,
            _metadata      => jsonb_build_object('block_scope', 'origin', 'block_minutes', _block_minutes),
            _success       => false,
            _error_reason  => NULL,
            _actor_user_id => NULL
          );
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'change_own_password: falha ao registrar a auditoria (SQLSTATE %).', SQLSTATE;
      END;

      IF _blocked_account OR _blocked_origin THEN
        RETURN private.password_result(jsonb_build_object(
          'result', 'change_blocked',
          'retry_after_seconds', ceil(extract(epoch FROM c_block))::integer,
          'retry_after_minutes', _block_minutes));
      END IF;
      RETURN private.password_result(jsonb_build_object('result', 'current_password_invalid'));
    END IF;
  END IF;

  -- 8. Senha nova (DA-7): política com os dados do cadastro, depois (h),
  --    depois a confirmação. Nada muda nem é contado.
  _violation := private.password_policy_violation(_new_password, _member.cpf, _member.mobile_whatsapp,
                                                  _member.birth_date, _member.email);
  IF _violation IS NULL THEN
    IF (_voluntary AND _new_password = _current_password)
       OR (NOT _voluntary AND _vault.password_hash IS NOT NULL
           AND extensions.crypt(_new_password, _vault.password_hash) = _vault.password_hash) THEN
      _violation := 'password_same_as_current';
    END IF;
  END IF;
  IF _violation IS NOT NULL THEN
    RETURN private.password_result(jsonb_build_object(
      'result', 'invalid', 'code', _violation, 'field', 'new_password'));
  END IF;
  IF _new_password <> _confirmation THEN
    RETURN private.password_result(jsonb_build_object(
      'result', 'invalid', 'code', 'password_mismatch', 'field', 'confirmation'));
  END IF;

  -- 9. Sucesso, sem engolir erro: se a Auditoria falhar, nada muda.
  PERFORM private.write_password(_auth_user_id, _member.id, _new_password, _member.id);
  PERFORM private.clear_must_change(_auth_user_id, _session_id, _request_id);
  PERFORM private.end_sessions(_auth_user_id, _session_id);              -- as outras saem (RN-16)
  UPDATE private.sign_in_throttle                                        -- a conta zera; a origem não
     SET failures = '{}', blocked_until = NULL, expires_at = clock_timestamp()
   WHERE kind = _account_row.kind
     AND key_hash = _account_row.key_hash;
  PERFORM public._log_event(
    _action        => 'password_changed'::public.event_action,
    _entity        => 'auth'::public.event_entity,
    _entity_id     => _member.id,
    _entity_label  => _member.name,
    _description   => 'Senha alterada',
    _changed_fields => NULL,
    _metadata      => jsonb_build_object('change_type', _mode),
    _success       => true,
    _error_reason  => NULL,
    _actor_user_id => _auth_user_id
  );

  RETURN private.password_result(jsonb_build_object('result', 'ok'));
END;
$$;

REVOKE ALL ON FUNCTION public.change_own_password(uuid, uuid, text, text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_own_password(uuid, uuid, text, text, text, text, text, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Senha inicial (RN-07, DT-12). Chamada pela create-user-admin, com a chave
--    secreta, depois do createUser SEM senha e antes do INSERT do membro.
--    Vazia, ausente ou exatamente 123456: 123456 (D11), sem a política.
--    Outra: a política com os dados do formulário; violação = 22023 +
--    app_error com o código (password_too_short, password_too_long,
--    password_weak, password_personal_data) e field = password.
--    A conta que já tem senha no cofre é recusada (password_already_set): a
--    senha inicial é só da conta nova (RN-14).
--    Grava no cofre e põe a marca initial, sem validade. Sem evento (RN-17 f).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_initial_password(
  _auth_user_id uuid,
  _member_id    uuid,
  _password     text,
  _cpf          text,
  _mobile       text,
  _birth_date   date,
  _email        text
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  _p         text := coalesce(_password, '');
  _violation text;
  _hash      text;
BEGIN
  IF _auth_user_id IS NULL THEN
    RAISE EXCEPTION 'set_initial_password: conta ausente.' USING ERRCODE = '22023';
  END IF;

  IF _p = '' OR _p = '123456' THEN
    _p := '123456';
  ELSE
    _violation := private.password_policy_violation(_p, _cpf, _mobile, _birth_date, _email);
    IF _violation IS NOT NULL THEN
      PERFORM public._del_raise(
        _violation,
        CASE _violation
          WHEN 'password_too_short'     THEN 'A senha precisa ter pelo menos 8 caracteres.'
          WHEN 'password_too_long'      THEN 'A senha é longa demais.'
          WHEN 'password_weak'          THEN 'Esta senha é fácil de adivinhar. Escolha outra.'
          WHEN 'password_personal_data' THEN 'A senha não pode conter o CPF, o celular ou a data de nascimento do membro, nem ser o e-mail do cadastro.'
        END,
        jsonb_build_object('field', 'password'));
    END IF;
  END IF;

  INSERT INTO private.account_passwords (auth_user_id) VALUES (_auth_user_id)
  ON CONFLICT (auth_user_id) DO NOTHING;
  SELECT p.password_hash INTO _hash
    FROM private.account_passwords p
   WHERE p.auth_user_id = _auth_user_id
     FOR UPDATE;
  IF _hash IS NOT NULL THEN
    PERFORM public._del_raise('password_already_set', 'Esta conta já tem senha.', '{}'::jsonb);
  END IF;

  PERFORM private.write_password(_auth_user_id, _member_id, _p, NULL);
  PERFORM private.set_must_change(_auth_user_id, 'initial', NULL);
  PERFORM private.sign_in_assert_duration(interval '5 seconds');
END;
$$;

REVOKE ALL ON FUNCTION public.set_initial_password(uuid, uuid, text, text, text, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_initial_password(uuid, uuid, text, text, text, date, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. A marca de quem chama (DT-05). Passa pelo assert_session_alive (sessão
--    apagada: 42501 session_ended), e não pela marca: é o que a pessoa
--    marcada ainda lê. Sempre uma linha.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_password_status()
RETURNS TABLE (must_change_password boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.assert_session_alive();
  RETURN QUERY
    SELECT coalesce((SELECT p.must_change
                       FROM private.account_passwords p
                      WHERE p.auth_user_id = auth.uid()), false);
END;
$$;

REVOKE ALL ON FUNCTION public.my_password_status() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_password_status() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. members_view.password_reset_status (AQ-2, DT-15), no fim da view (risco
--    5 do E1.08). Antecipa a recusa previsível, na ordem da RN-02, sem o
--    limite: NULL (sem a permissão) | self | role_not_covered | no_account |
--    allowed. A conta indisponível da DA-3 (banida, não confirmada) só aparece
--    na resposta da redefinição. O resto da view é a da
--    20261125200000_e202_05_close_roles, igual e na mesma ordem. Sem coluna
--    nova em members (nenhum GRANT por coluna muda). Continua security
--    definer de propósito (CLAUDE.md, armadilhas).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.members_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  m.id,
  m.name,
  m.gender,
  m.birth_date,
  m.instagram,
  m.avatar_url,
  m.notes,
  m.neighborhood,
  m.city,
  m.state,
  m.is_pastor,
  m.has_leadership,
  m.leader_id,
  l.name AS leader_name,
  m.spouse_id,
  m.is_baptized,
  m.baptism_date,
  m.is_active,
  m.g12_level,
  m.total_disciples,
  m.total_cells,
  m.male_cells,
  m.female_cells,
  CASE WHEN s.role_visible THEN m.role_id END AS role_id,
  m.auth_user_id,
  m.created_at,
  m.updated_at,
  s.sensitive_visible,
  CASE WHEN s.sensitive_visible THEN m.email END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  CASE WHEN s.sensitive_visible THEN m.phone END AS phone,
  CASE WHEN s.sensitive_visible THEN m.street END AS street,
  CASE WHEN s.sensitive_visible THEN m.number END AS number,
  CASE WHEN s.sensitive_visible THEN m.complement END AS complement,
  CASE WHEN s.sensitive_visible THEN m.zip_code END AS zip_code,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.leader_id = m.id AND c.deleted_at IS NULL) AS is_cell_leader,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.timothy_id = m.id AND c.deleted_at IS NULL) AS is_cell_timothy,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.host_id = m.id AND c.deleted_at IS NULL) AS is_cell_host,
  m.id IN (
    SELECT p.member_id
      FROM public.cell_report_participants p
      JOIN public.cell_reports r ON r.id = p.report_id
     WHERE r.date >= public.sp_today() - 30
       AND r.deleted_at IS NULL
  ) AS attended_last_30_days,
  public.search_normalize(concat_ws(' ',
    m.name,
    CASE WHEN s.sensitive_visible THEN m.email END,
    CASE WHEN s.sensitive_visible THEN m.cpf END,
    CASE WHEN s.sensitive_visible THEN regexp_replace(m.cpf, '\D', '', 'g') END
  )) AS search_text,
  sp.name AS spouse_name,
  -- E2.03 (AQ-2): a recusa previsível da redefinição, na ordem da RN-02.
  CASE WHEN NOT (SELECT public.viewer_has('change_member_password'::public.permission_action)) THEN NULL
       WHEN m.id = (SELECT public.viewer_member_id())                                       THEN 'self'
       WHEN NOT public.viewer_covers_role(m.role_id)                                         THEN 'role_not_covered'
       WHEN m.auth_user_id IS NULL                                                           THEN 'no_account'
       ELSE 'allowed'
  END AS password_reset_status
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.members sp ON sp.id = m.spouse_id
CROSS JOIN LATERAL (
  SELECT coalesce(m.auth_user_id = (SELECT auth.uid()), false)
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action)) AS sensitive_visible,
         m.id = (SELECT public.viewer_member_id())
      OR (SELECT public.viewer_has('assign_role'::public.permission_action))
      OR (SELECT public.viewer_has('manage_roles'::public.permission_action)) AS role_visible
) s
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
  OR m.id = (SELECT public.viewer_member_id())
)
AND m.deleted_at IS NULL;   -- espelhado em "Members view policy"
-- Consolidação: o filtro ou a coluna do consolidado entra aqui.

ALTER VIEW public.members_view OWNER TO postgres;
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;
