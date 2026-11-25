-- E1.04 (PR 1b) — Limite por origem 50 e máscara da identificação inválida "***".
-- Ver docs/specs/e1-04-sign-in.md no repositório apps-mci (riscos 16 e 17,
-- RN-11, RN-15 e DT-12). Decisão do usuário em 2026-11-24.
--
--   1. private.parse_login_identifier: na identificação inválida (inclusive a
--      de mais de 254 caracteres, DA-4), masked passa a ser só '***', sem
--      nenhum caractere da entrada. Quem cola a senha no campo de
--      identificação não pode ter caracteres dela na Auditoria (RN-15 d).
--      E-mail e número continuam com a máscara de antes.
--   2. public.sign_in_attempt: o limite por origem (RN-11) sobe de 20 para 50
--      falhas em 15 minutos (risco 16: rede da igreja e CGNAT). O limite por
--      identificação continua 5. O CHECK (cardinality(failures) <= 100) de
--      private.sign_in_throttle continua cobrindo: a linha volta a zero ao
--      chegar a 50.
--
-- Só CREATE OR REPLACE, com a mesma assinatura, volatilidade, SECURITY,
-- search_path, SETs e corpo da migration 20261124214600_e104_02_sign_in, a não
-- ser pelas linhas acima. CREATE OR REPLACE mantém dono, grants e comentários;
-- os REVOKE/GRANT do fim repetem os de antes, por segurança. Idempotente.

-- ---------------------------------------------------------------------------
-- 1. Máscara da identificação inválida
-- ---------------------------------------------------------------------------


-- Leitura da identificação (RN-02 a RN-04, DA-4). Gêmea do classifyIdentifier
-- da tela; as duas passam pela mesma tabela de casos (AQ-3).
--   format: empty | email | cpf | mobile | cpf_or_mobile | invalid
--   masked: sobre a forma normalizada (AQ-5, DT-12): e-mail "a***@dominio";
--           número "***" e os 4 últimos dígitos; inválida: só "***", sem
--           nenhum caractere da entrada nem o tamanho (risco 17, RN-15 d).
CREATE OR REPLACE FUNCTION private.parse_login_identifier(
  _raw text,
  OUT format     text,
  OUT email      text,
  OUT cpf        text,
  OUT mobile     text,
  OUT mobile_key text,
  OUT masked     text
)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _t      text := private.login_identifier_text(_raw);
  _digits text;
BEGIN
  IF _t = '' THEN
    format := 'empty';
    RETURN;
  END IF;

  IF length(_t) > 254 THEN                     -- DA-4
    format := 'invalid';
    masked := '***';
    RETURN;
  END IF;

  IF strpos(_t, '@') > 0 THEN                  -- RN-02: com "@", só e-mail
    format := 'email';
    email  := public.normalize_email(_t);
    masked := left(email, 1) || '***@' || coalesce(substring(email FROM '@([^@]*)$'), '');
    RETURN;
  END IF;

  -- Sem "@": só os dígitos contam (RN-03, RN-04).
  _digits := public.normalize_digits(_t);
  IF length(_digits) = 11 AND public.is_valid_cpf(_digits) THEN
    cpf := _digits;
  END IF;
  mobile     := public.normalize_mobile(_t);
  mobile_key := public.mobile_match_key(_t);

  format := CASE
              WHEN cpf IS NOT NULL AND mobile IS NOT NULL THEN 'cpf_or_mobile'
              WHEN cpf IS NOT NULL THEN 'cpf'
              WHEN mobile IS NOT NULL THEN 'mobile'
              ELSE 'invalid'
            END;
  masked := CASE
              WHEN format = 'invalid' THEN '***'
              ELSE '***' || right(_digits, 4)
            END;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Limite por origem: 50
-- ---------------------------------------------------------------------------

-- A decisão inteira de um login, numa transação (DT-02, DT-03, DT-07). Ver o
-- algoritmo no cabeçalho da 20261124214600_e104_02_sign_in (no passo 7, o
-- limite por origem agora é 50). Retorno (jsonb):
--   {"result":"empty_fields"}
--   {"result":"locked","retry_after_seconds":int,"retry_after_minutes":int}
--   {"result":"invalid"}
--   {"result":"ok","member_id":uuid,"auth_user_id":uuid,"auth_email":text,
--    "identifier_type":text,"identifier_masked":text,"password_action":null}
CREATE OR REPLACE FUNCTION public.sign_in_attempt(_identifier text, _password text, _origin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '3s'
AS $$
DECLARE
  -- Limites (RN-10, RN-11, DT-07, DT-19). Mudar um deles é uma linha (risco 16).
  c_identifier_limit constant integer  := 5;
  c_origin_limit     constant integer  := 50;            -- era 20 (risco 16)
  c_window           constant interval := interval '15 minutes';
  c_block            constant interval := interval '15 minutes';
  c_max_duration     constant interval := interval '5 seconds';
  -- Hash fictício com o custo de produção ($2a$, custo 10): o bcrypt das
  -- tentativas sem conta disponível (RN-07, tempo igual).
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
  _acct_hash      text;
  _account_ok     boolean := false;
  _calc           text;
  _ok             boolean := false;
  _legacy         text;
  _blocked_identifier boolean := false;
  _blocked_origin     boolean := false;
  _block_minutes  integer := ceil(extract(epoch FROM c_block) / 60)::integer;
BEGIN
  -- 1. Campos vazios (RN-08): nada é tocado.
  SELECT * INTO _p FROM private.parse_login_identifier(_identifier);
  IF _p.format = 'empty' OR _password IS NULL OR _password = '' THEN
    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object('result', 'empty_fields');
  END IF;

  -- 2. Origem (DT-06): a mensagem de erro não leva o valor.
  BEGIN
    _origin_inet := _origin::inet;
  EXCEPTION WHEN data_exception THEN
    RAISE EXCEPTION 'sign_in_attempt: origem inválida.' USING ERRCODE = '22023';
  END;
  IF _origin_inet IS NULL THEN
    RAISE EXCEPTION 'sign_in_attempt: origem ausente.' USING ERRCODE = '22023';
  END IF;

  -- 3. Chaves (DT-05): e:, c:, m:, x: e o:.
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

  -- 5. Bloqueio vigente (RN-10 a RN-12): o maior prazo; nada é gravado.
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

  -- 6. Busca, conta, ponto do E3.02 e um bcrypt.
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
      _linked_id := _lookup.member_id;                       -- nulo se mais de um (DA-6)
      _linked_name := _lookup.member_name;
    ELSE                                                     -- found
      _linked_id := _lookup.member_id;
      _linked_name := _lookup.member_name;

      _legacy := private.sign_in_check_legacy(_linked_id, _password);
      IF _legacy IS NOT NULL THEN
        RAISE EXCEPTION 'sign_in_attempt: credencial legada não suportada neste passo.'
          USING ERRCODE = '0A000';
      END IF;

      SELECT m.auth_user_id INTO _auth_user_id FROM public.members m WHERE m.id = _linked_id;
      IF _auth_user_id IS NULL THEN
        _reason := 'no_account';
      ELSE
        -- RN-06 b: existe, não apagada, não banida, confirmada, com e-mail,
        -- sem SSO nem anônima e com senha bcrypt (DA-9). Sem trava.
        SELECT u.email,
               u.encrypted_password,
               u.deleted_at IS NULL
                 AND (u.banned_until IS NULL OR u.banned_until <= _now)
                 AND u.email_confirmed_at IS NOT NULL
                 AND coalesce(u.email, '') <> ''
                 AND NOT coalesce(u.is_sso_user, false)
                 AND NOT coalesce(u.is_anonymous, false)
                 AND coalesce(u.encrypted_password ~ c_bcrypt_format, false)
          INTO _acct_email, _acct_hash, _account_ok
          FROM auth.users u
         WHERE u.id = _auth_user_id;
        _account_ok := coalesce(_account_ok, false);
        IF NOT _account_ok THEN
          _reason := 'account_unavailable';                  -- DA-9
        END IF;
      END IF;
    END IF;
  END IF;

  -- Exatamente um bcrypt, do mesmo custo, em toda tentativa não bloqueada.
  _calc := extensions.crypt(_password, CASE WHEN _account_ok THEN _acct_hash ELSE c_dummy_hash END);
  _ok := _account_ok
         AND _calc = _acct_hash
         AND octet_length(_password) <= 72;                  -- DA-5
  IF _account_ok AND NOT _ok THEN
    _reason := 'wrong_password';
  END IF;

  -- 7a. Sucesso: zera as linhas de identificação; a de origem não muda (RN-11).
  IF _ok THEN
    UPDATE private.sign_in_throttle t
       SET failures = '{}', blocked_until = NULL, expires_at = _now
      FROM unnest(_kinds, _hashes) AS u(kind, key_hash)
     WHERE t.kind = 'identifier'
       AND t.kind = u.kind
       AND t.key_hash = u.key_hash;

    PERFORM private.sign_in_assert_duration(c_max_duration);
    RETURN jsonb_build_object(
      'result', 'ok',
      'member_id', _linked_id,
      'auth_user_id', _auth_user_id,
      'auth_email', _acct_email,
      'identifier_type', _identifier_type,
      'identifier_masked', _p.masked,
      'password_action', NULL                                -- ponto do E3.02
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

  -- 8. Auditoria (RN-15 b, c; DA-8). A falha de gravação não muda a resposta.
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
                          'reason',            _reason)),
      _success       => false,
      _error_reason  => CASE _reason
                          WHEN 'invalid_identifier'  THEN 'Identificação inválida'
                          WHEN 'not_found'           THEN 'Identificação não encontrada'
                          WHEN 'ambiguous'           THEN 'Identificação ambígua'
                          WHEN 'member_deleted'      THEN 'Cadastro excluído'
                          WHEN 'no_account'          THEN 'Sem conta de acesso'
                          WHEN 'account_unavailable' THEN 'Conta de acesso indisponível'
                          WHEN 'wrong_password'      THEN 'Senha incorreta'
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

    IF _blocked_origin THEN                                  -- nunca ligado nem com a origem
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

REVOKE ALL ON FUNCTION private.parse_login_identifier(text)     FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.sign_in_attempt(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_in_attempt(text, text, text) TO service_role;
