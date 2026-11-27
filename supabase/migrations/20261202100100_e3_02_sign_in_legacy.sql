-- E3 (PR 1, migration 2 de 2) — Login com a senha do legado (E3.02) e o
-- número do card "Primeiro acesso". Ver docs/specs/e3-login-legado.md no
-- repositório apps-mci ("Conferência na sign_in_attempt", "Card Primeiro
-- acesso"; DT-03 a DT-09, DA-2 a DA-4; RN-02 a RN-08, RN-11 a RN-14).
--
-- Conteúdo:
--   0. Guarda de pré-requisito (migration 1 deste passo). Falha cedo.
--   1. public.sign_in_attempt recriada a partir do corpo da e203_03_vault.
--      Limites, travas, lock_timeout de 3 s, teto de 5 s antes de cada RETURN,
--      um bcrypt por tentativa e a ordem dos motivos do E1.04 não mudam. Muda
--      o passo 6 (busca, conta, credencial e bcrypt):
--        a) conta: as condições do Auth sem o hash (account_ok); falhou,
--           account_unavailable;
--        b) credencial com hash (leitura sem trava). Se há: cria a linha do
--           cofre se faltar, trava o cofre e RELÊ a credencial (DT-05). Ainda
--           com hash: confere bcrypt(md5(senha)) contra ela (credential =
--           'legacy'); senão, segue o cofre;
--        c) cofre: bcrypt(senha); sem hash, no_password (RN-08, DT-06) com o
--           bcrypt fictício;
--        d) sucesso com a credencial: até 72 bytes, write_password (grava a
--           senha como digitada e descarta a credencial) e used_at; acima,
--           só used_at (DA-2). A política (a a g) põe a marca legacy_weak,
--           com "Troca de senha exigida" só quando a marca é nova (RN-05);
--        e) falha com a credencial: wrong_password com metadata.credential =
--           'legacy' (RN-13 c); no_password: "Sem senha definida" (RN-13 d);
--        f) ok: credential ('account' ou 'legacy'); password_action continua
--           null (DT-07).
--   2. public.sign_in_record_login com _credential (DT-07): a de 4
--      parâmetros sai; a chamada antiga resolve pelo padrão 'account'.
--   3. DROP private.sign_in_check_legacy (DT-08).
--   4. public.dashboard_first_access() (DT-09, RN-14).
--
-- MD5 (DT-03): md5(text) do Postgres, sobre os bytes UTF-8 (o banco é UTF8),
-- hexadecimal minúsculo, sem normalizar. A guarda abaixo confere o encoding.
--
-- A senha e o MD5 nunca vão para RAISE, log ou evento: só entram no md5() e
-- no crypt().

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('private.legacy_credentials') IS NULL
     OR to_regprocedure('private.add_legacy_credential(uuid,text)') IS NULL
     OR to_regprocedure('public.sign_in_record_login(uuid,uuid,text,text)') IS NULL
       AND to_regprocedure('public.sign_in_record_login(uuid,uuid,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'e3_02_sign_in_legacy depende da e3_01_legacy_credentials e do E1.04.';
  END IF;
  -- DT-03: o MD5 da senha é calculado sobre os bytes UTF-8.
  IF current_setting('server_encoding') <> 'UTF8' THEN
    RAISE EXCEPTION 'e3_02_sign_in_legacy: o banco precisa estar em UTF8 (DT-03).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. sign_in_attempt. Retorno (jsonb):
--   {"result":"empty_fields"}
--   {"result":"locked","retry_after_seconds":int,"retry_after_minutes":int}
--   {"result":"invalid"}
--   {"result":"ok","member_id":uuid,"auth_user_id":uuid,"auth_email":text,
--    "identifier_type":text,"identifier_masked":text,"password_action":null,
--    "must_change_password":boolean,"credential":"account"|"legacy"}
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sign_in_attempt(_identifier text, _password text, _origin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  -- Limites (RN-10, RN-11, DT-07, DT-19 do E1.04). Mudar um deles é uma linha.
  c_identifier_limit constant integer  := 5;
  c_origin_limit     constant integer  := 50;
  c_window           constant interval := interval '15 minutes';
  c_block            constant interval := interval '15 minutes';
  c_max_duration     constant interval := interval '5 seconds';
  -- Hash fictício com o custo de produção ($2a$, custo 10): o bcrypt das
  -- tentativas sem conta disponível ou sem senha (RN-07 do E1.04, RN-08).
  c_dummy_hash       constant text     := '$2a$10$q5HyGs.zwdS5e.tU/XYZwO';
  -- Único formato de hash que o pgcrypto confere (o $2b$ cairia no DES).
  c_bcrypt_format    constant text     := '^\$2a\$[0-9]{2}\$[./A-Za-z0-9]{53}$';

  _p              record;
  _origin_inet    inet;
  _kinds          text[]  := '{}';
  _hashes         bytea[] := '{}';
  _k              record;
  _now            timestamptz;
  _blocked_until  timestamptz;
  _seconds        integer;
  _lookup         record;
  _reason         text;
  _linked_id      uuid;
  _linked_name    text;
  _identifier_type text;
  _auth_user_id   uuid;
  _acct_email     text;
  _account_ok     boolean := false;
  _vault          record;                                -- linha do cofre (pode não existir)
  _legacy_hash    text;                                  -- E3: a credencial, depois da trava
  _credential     text;                                  -- E3: 'account' | 'legacy'
  _hash           text;                                  -- o hash conferido (nulo: sem senha)
  _input          text;                                  -- a senha ou o md5 dela
  _temp_expires   timestamptz;
  _marked         boolean := false;
  _mark_reason    text;
  _member         record;
  _calc           text;
  _ok             boolean := false;
  _blocked_identifier boolean := false;
  _blocked_origin     boolean := false;
  _block_minutes  integer := ceil(extract(epoch FROM c_block) / 60)::integer;
BEGIN
  -- 1. Campos vazios (RN-08 do E1.04): nada é tocado.
  SELECT * INTO _p FROM private.parse_login_identifier(_identifier);
  IF _p.format = 'empty' OR _password IS NULL OR _password = '' THEN
    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object('result', 'empty_fields');
  END IF;

  -- 2. Origem (DT-06 do E1.04): a mensagem de erro não leva o valor.
  BEGIN
    _origin_inet := _origin::inet;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'sign_in_attempt: origem inválida.' USING ERRCODE = '22023';
  END;
  IF _origin_inet IS NULL THEN
    RAISE EXCEPTION 'sign_in_attempt: origem ausente.' USING ERRCODE = '22023';
  END IF;

  -- 3. Chaves (DT-05 do E1.04): e:, c:, m:, x: e o:.
  IF _p.format = 'email' THEN
    _kinds := array_append(_kinds, 'identifier');
    _hashes := array_append(_hashes, private.sign_in_key('identifier', 'e:' || _p.email));
  ELSIF _p.format = 'invalid' THEN
    _kinds := array_append(_kinds, 'identifier');
    _hashes := array_append(_hashes, private.sign_in_key('identifier', 'x:' || lower(private.login_identifier_text(_identifier))));
  ELSE
    IF _p.cpf IS NOT NULL THEN
      _kinds := array_append(_kinds, 'identifier');
      _hashes := array_append(_hashes, private.sign_in_key('identifier', 'c:' || _p.cpf));
    END IF;
    IF _p.mobile_key IS NOT NULL THEN
      _kinds := array_append(_kinds, 'identifier');
      _hashes := array_append(_hashes, private.sign_in_key('identifier', 'm:' || _p.mobile_key));
    END IF;
  END IF;
  _kinds := array_append(_kinds, 'origin');
  _hashes := array_append(_hashes, private.sign_in_key('origin', 'o:' || private.sign_in_origin_key(_origin_inet)));

  -- 4. Travas, na ordem (kind, key_hash), antes de qualquer conferência.
  FOR _k IN
    SELECT u.kind, u.key_hash
      FROM unnest(_kinds, _hashes) AS u(kind, key_hash)
     ORDER BY u.kind, u.key_hash
  LOOP
    INSERT INTO private.sign_in_throttle AS t (kind, key_hash, expires_at)
    VALUES (_k.kind, _k.key_hash, clock_timestamp() + c_window)
    ON CONFLICT (kind, key_hash) DO UPDATE SET kind = EXCLUDED.kind;
  END LOOP;

  _now := clock_timestamp();

  -- 5. Bloqueio vigente: o maior prazo; nada é gravado.
  SELECT max(t.blocked_until) INTO _blocked_until
    FROM private.sign_in_throttle t
    JOIN unnest(_kinds, _hashes) AS u(kind, key_hash)
      ON t.kind = u.kind AND t.key_hash = u.key_hash
   WHERE t.blocked_until > _now;

  IF _blocked_until IS NOT NULL THEN
    _seconds := greatest(ceil(extract(epoch FROM _blocked_until - _now))::integer, 1);
    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object(
      'result', 'locked',
      'retry_after_seconds', _seconds,
      'retry_after_minutes', greatest(ceil(_seconds / 60.0)::integer, 1)
    );
  END IF;

  -- 6. Busca, conta, credencial ou cofre, e um bcrypt.
  IF _p.format = 'invalid' THEN
    _reason := 'invalid_identifier';                       -- sem tipo, sem ligação
  ELSE
    SELECT * INTO _lookup
      FROM private.sign_in_lookup(_p.format, _p.email, _p.cpf, _p.mobile, _p.mobile_key);
    _identifier_type := _lookup.identifier_type;

    IF _lookup.outcome = 'not_found' THEN
      _reason := 'not_found';
    ELSIF _lookup.outcome = 'ambiguous' THEN
      _reason := 'ambiguous';
    ELSIF _lookup.outcome = 'member_deleted' THEN
      _reason := 'member_deleted';
      _linked_id := _lookup.member_id;                       -- nulo se mais de um (DA-6 do E1.04)
      _linked_name := _lookup.member_name;
    ELSE                                                     -- found
      _linked_id := _lookup.member_id;
      _linked_name := _lookup.member_name;

      SELECT m.auth_user_id INTO _auth_user_id FROM public.members m WHERE m.id = _linked_id;
      IF _auth_user_id IS NULL THEN
        _reason := 'no_account';
      ELSE
        -- 6a. A conta (RN-06 b do E1.04), sem o hash: não apagada, não banida,
        --     confirmada, com e-mail, sem SSO nem anônima. Sem trava.
        SELECT u.email,
               u.deleted_at IS NULL
                 AND (u.banned_until IS NULL OR u.banned_until <= _now)
                 AND u.email_confirmed_at IS NOT NULL
                 AND coalesce(u.email, '') <> ''
                 AND NOT coalesce(u.is_sso_user, false)
                 AND NOT coalesce(u.is_anonymous, false)
          INTO _acct_email, _account_ok
          FROM auth.users u
         WHERE u.id = _auth_user_id;
        _account_ok := coalesce(_account_ok, false);
        IF NOT _account_ok THEN
          _reason := 'account_unavailable';
        END IF;
      END IF;
    END IF;
  END IF;

  IF _account_ok THEN
    -- 6b. Credencial legada com hash? Leitura sem trava; se há, trava o cofre
    --     (criando a linha) e relê a credencial depois da trava (DT-05): uma
    --     entrada simultânea que já gravou a senha a terá descartado.
    IF EXISTS (SELECT 1 FROM private.legacy_credentials c
                WHERE c.member_id = _linked_id AND c.legacy_hash IS NOT NULL) THEN
      INSERT INTO private.account_passwords (auth_user_id) VALUES (_auth_user_id)
      ON CONFLICT (auth_user_id) DO NOTHING;
      SELECT pw.password_hash, pw.temp_expires_at, pw.must_change INTO _vault
        FROM private.account_passwords pw
       WHERE pw.auth_user_id = _auth_user_id
         FOR UPDATE;
      SELECT c.legacy_hash INTO _legacy_hash
        FROM private.legacy_credentials c
       WHERE c.member_id = _linked_id
         FOR UPDATE;
    ELSE
      SELECT pw.password_hash, pw.temp_expires_at, pw.must_change INTO _vault
        FROM private.account_passwords pw
       WHERE pw.auth_user_id = _auth_user_id;
    END IF;
    _marked := coalesce(_vault.must_change, false);

    IF _legacy_hash IS NOT NULL THEN
      -- RN-02, DT-03: o md5 da senha como veio; sem limite de 72 bytes (o
      -- md5 tem 32). RN-03: enquanto há credencial, só ela é conferida.
      _credential := 'legacy';
      _hash := _legacy_hash;
      _input := md5(_password);
    ELSE
      -- 6c. O cofre. Sem hash: no_password (RN-08, DT-06), bcrypt fictício.
      _credential := 'account';
      _input := _password;
      IF coalesce(_vault.password_hash ~ c_bcrypt_format, false) THEN
        _hash := _vault.password_hash;
        _temp_expires := _vault.temp_expires_at;
      ELSE
        _reason := 'no_password';
      END IF;
    END IF;
  END IF;

  -- Exatamente um bcrypt, do mesmo custo, em toda tentativa não bloqueada.
  _calc := extensions.crypt(coalesce(_input, _password), coalesce(_hash, c_dummy_hash));
  _ok := _hash IS NOT NULL
         AND _calc = _hash
         AND (_credential = 'legacy' OR octet_length(_password) <= 72);   -- DA-5 do E1.04
  IF _hash IS NOT NULL AND NOT _ok THEN
    _reason := 'wrong_password';
  END IF;
  -- E2.03 (RN-05): a temporária vencida confere, mas não entra.
  IF _ok AND _temp_expires IS NOT NULL AND _temp_expires <= _now THEN
    _ok := false;
    _reason := 'temp_password_expired';
  END IF;

  -- 7a. Sucesso: zera as linhas de identificação; a de origem não muda.
  IF _ok THEN
    UPDATE private.sign_in_throttle t
       SET failures = '{}', blocked_until = NULL, expires_at = _now
      FROM unnest(_kinds, _hashes) AS u(kind, key_hash)
     WHERE t.kind = 'identifier'
       AND t.kind = u.kind
       AND t.key_hash = u.key_hash;

    -- E3 (RN-04, DA-2): a senha certa da credencial vira a senha do cofre,
    -- como foi digitada, e a credencial some (write_password → discard). Acima
    -- de 72 bytes o cofre não guarda: a credencial fica, marcada como usada.
    -- Uma falha aqui desfaz tudo (não entra e a credencial continua).
    IF _credential = 'legacy' THEN
      IF octet_length(_password) <= 72 THEN
        PERFORM private.write_password(_auth_user_id, _linked_id, _password, NULL);
      END IF;
      UPDATE private.legacy_credentials
         SET used_at = coalesce(used_at, now())
       WHERE member_id = _linked_id;
    END IF;

    -- Senha fora da política (a a g) põe a marca: weak_password (E2.03, RN-08
    -- b) ou legacy_weak (E3, RN-05). Ninguém é recusado por ela. A Auditoria
    -- registra só a marca nova, num sub-bloco.
    IF NOT _marked THEN
      SELECT m.cpf, m.mobile_whatsapp, m.birth_date, m.email INTO _member
        FROM public.members m
       WHERE m.id = _linked_id;
      IF private.password_policy_violation(_password, _member.cpf, _member.mobile_whatsapp,
                                           _member.birth_date, _member.email) IS NOT NULL THEN
        _marked := true;
        _mark_reason := CASE _credential WHEN 'legacy' THEN 'legacy_weak' ELSE 'weak_password' END;
        IF private.set_must_change(_auth_user_id, _mark_reason, NULL) THEN
          BEGIN
            PERFORM public._log_event(
              _action        => 'password_change_required'::public.event_action,
              _entity        => 'auth'::public.event_entity,
              _entity_id     => _linked_id,
              _entity_label  => _linked_name,
              _description   => 'Troca de senha exigida',
              _changed_fields => NULL,
              _metadata      => jsonb_build_object('reason', _mark_reason),
              _success       => true,
              _error_reason  => NULL,
              _actor_user_id => _auth_user_id
            );
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'sign_in_attempt: falha ao registrar a auditoria (SQLSTATE %).', SQLSTATE;
          END;
        END IF;
      END IF;
    END IF;

    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object(
      'result', 'ok',
      'member_id', _linked_id,
      'auth_user_id', _auth_user_id,
      'auth_email', _acct_email,
      'identifier_type', _identifier_type,
      'identifier_masked', _p.masked,
      'password_action', NULL,                               -- DT-07: continua null
      'must_change_password', _marked,
      'credential', _credential                              -- E3 (DT-07, DA-4)
    );
  END IF;

  -- 7b. Falha: janela deslizante, soma em todas as linhas e bloqueio no limite.
  WITH cur AS (
    SELECT t.kind, t.key_hash,
           array(SELECT f FROM unnest(t.failures) AS f WHERE f > _now - c_window ORDER BY f)
             || _now AS fails,
           CASE t.kind WHEN 'identifier' THEN c_identifier_limit ELSE c_origin_limit END AS lim
      FROM private.sign_in_throttle t
      JOIN unnest(_kinds, _hashes) AS u(kind, key_hash)
        ON t.kind = u.kind AND t.key_hash = u.key_hash
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
  SELECT coalesce(bool_or(blocked) FILTER (WHERE kind = 'identifier'), false),
         coalesce(bool_or(blocked) FILTER (WHERE kind = 'origin'), false)
    INTO _blocked_identifier, _blocked_origin
    FROM upd;

  -- 8. Auditoria (RN-15 b, c do E1.04; RN-13 c, d). A falha de gravação não
  --    muda a resposta. metadata.credential só quando a credencial legada foi
  --    conferida.
  BEGIN
    PERFORM public._log_event(
      _action        => 'login_failed'::public.event_action,
      _entity        => 'auth'::public.event_entity,
      _entity_id     => _linked_id,
      _entity_label  => _linked_name,
      _description   => 'Falha no login',
      _changed_fields => NULL,
      _metadata      => jsonb_strip_nulls(jsonb_build_object(
                          'identifier_type',   _identifier_type,
                          'identifier_masked', _p.masked,
                          'reason',            _reason,
                          'credential',        CASE WHEN _credential = 'legacy' THEN 'legacy' END)),
      _success       => false,
      _error_reason  => CASE _reason
                          WHEN 'invalid_identifier'  THEN 'Identificação inválida'
                          WHEN 'not_found'           THEN 'Identificação não encontrada'
                          WHEN 'ambiguous'           THEN 'Identificação ambígua'
                          WHEN 'member_deleted'      THEN 'Cadastro excluído'
                          WHEN 'no_account'          THEN 'Sem conta de acesso'
                          WHEN 'account_unavailable' THEN 'Conta de acesso indisponível'
                          WHEN 'no_password'         THEN 'Sem senha definida'
                          WHEN 'wrong_password'      THEN 'Senha incorreta'
                          WHEN 'temp_password_expired' THEN 'Senha temporária vencida'
                        END,
      _actor_user_id => NULL
    );

    IF _blocked_identifier THEN
      PERFORM public._log_event(
        _action        => 'login_blocked'::public.event_action,
        _entity        => 'auth'::public.event_entity,
        _entity_id     => _linked_id,
        _entity_label  => _linked_name,
        _description   => 'Login bloqueado por excesso de tentativas',
        _changed_fields => NULL,
        _metadata      => jsonb_strip_nulls(jsonb_build_object(
                            'block_scope',       'identifier',
                            'block_minutes',     _block_minutes,
                            'identifier_type',   _identifier_type,
                            'identifier_masked', _p.masked)),
        _success       => false,
        _error_reason  => NULL,
        _actor_user_id => NULL
      );
    END IF;

    IF _blocked_origin THEN
      PERFORM public._log_event(
        _action        => 'login_blocked'::public.event_action,
        _entity        => 'auth'::public.event_entity,
        _entity_id     => NULL,
        _entity_label  => NULL,
        _description   => 'Login bloqueado por excesso de tentativas',
        _changed_fields => NULL,
        _metadata      => jsonb_build_object(
                            'block_scope',   'origin',
                            'block_minutes', _block_minutes),
        _success       => false,
        _error_reason  => NULL,
        _actor_user_id => NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'sign_in_attempt: falha ao registrar a auditoria (SQLSTATE %).', SQLSTATE;
  END;

  PERFORM private.sign_in_assert_duration(c_max_duration);
  IF _blocked_identifier OR _blocked_origin THEN
    RETURN jsonb_build_object(
      'result', 'locked',
      'retry_after_seconds', ceil(extract(epoch FROM c_block))::integer,
      'retry_after_minutes', _block_minutes
    );
  END IF;
  RETURN jsonb_build_object('result', 'invalid');
END;
$$;

REVOKE ALL ON FUNCTION public.sign_in_attempt(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_in_attempt(text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. "Login realizado" com a credencial (DT-07, RN-13 a, DA-4). A de 4
--    parâmetros sai; a chamada antiga (sem _credential) resolve pelo padrão.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sign_in_record_login(uuid, uuid, text, text);

CREATE OR REPLACE FUNCTION public.sign_in_record_login(
  _member_id uuid,
  _auth_user_id uuid,
  _identifier_type text,
  _identifier_masked text,
  _credential text DEFAULT 'account'
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
BEGIN
  IF _identifier_type IS NULL OR _identifier_type NOT IN ('email', 'mobile', 'cpf', 'cpf_or_mobile') THEN
    RAISE EXCEPTION 'sign_in_record_login: tipo de identificação inválido.' USING ERRCODE = '22023';
  END IF;
  IF _credential IS NULL OR _credential NOT IN ('account', 'legacy') THEN
    RAISE EXCEPTION 'sign_in_record_login: credencial inválida.' USING ERRCODE = '22023';
  END IF;

  SELECT m.name INTO _name
    FROM public.members m
   WHERE m.id = _member_id
     AND m.auth_user_id = _auth_user_id
     AND m.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sign_in_record_login: o cadastro não pertence a essa conta.' USING ERRCODE = '22023';
  END IF;

  PERFORM public._log_event(
    _action        => 'login'::public.event_action,
    _entity        => 'auth'::public.event_entity,
    _entity_id     => _member_id,
    _entity_label  => _name,
    _description   => 'Login realizado',
    _changed_fields => NULL,
    _metadata      => jsonb_strip_nulls(jsonb_build_object(
                        'identifier_type',   _identifier_type,
                        'identifier_masked', _identifier_masked,
                        'credential',        CASE WHEN _credential = 'legacy' THEN 'legacy' END)),
    _success       => true,
    _error_reason  => NULL,
    _actor_user_id => _auth_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sign_in_record_login(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_in_record_login(uuid, uuid, text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. O ponto vazio do E1.04 sai (DT-08): virou o passo 6b.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS private.sign_in_check_legacy(uuid, text);

-- ---------------------------------------------------------------------------
-- 4. Card "Primeiro acesso" (DT-09, RN-14). Só para quem vê a igreja toda
--    (viewer_has passa pelo portão do E2.03); senão 42501. Só os dois
--    números, dos cadastros não excluídos: nada de hash, nome ou id.
--      total   = credenciais recebidas na carga (a linha fica, DT-01)
--      pending = as que ainda têm hash e não foram usadas
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.dashboard_first_access()
RETURNS TABLE (pending integer, total integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce(public.viewer_has('view_all_church'::public.permission_action), false) THEN
    RAISE EXCEPTION 'Você não tem permissão para ver o primeiro acesso.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT (count(*) FILTER (WHERE c.legacy_hash IS NOT NULL AND c.used_at IS NULL))::integer,
         count(*)::integer
    FROM private.legacy_credentials c
    JOIN public.members m ON m.id = c.member_id
   WHERE m.deleted_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.dashboard_first_access() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_first_access() TO authenticated;
