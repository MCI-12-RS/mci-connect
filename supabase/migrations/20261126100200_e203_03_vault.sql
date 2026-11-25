-- E2.03 (PR 1, migration 3 de 4) — Cofre de senhas, guarda em auth.users e
-- login sobre o cofre. Ver docs/specs/e2-03-senha.md no repositório apps-mci
-- ("Avaliação da RN-14", "Modelo de dados e migrations", "Login", "O portão",
-- "Bloqueios e concorrência"; DT-01, DT-02, DT-03, DT-05, DT-09, DT-11).
--
-- A senha sai do Auth (DT-01): o hash bcrypt de cada conta passa a morar em
-- private.account_passwords, e auth.users.encrypted_password fica vazio. O
-- login (sign_in_attempt) confere no cofre, e só o banco grava nele
-- (private.write_password). Tudo nesta migration roda numa transação: a
-- sign_in_attempt passa a ler o cofre no mesmo commit em que os hashes mudam
-- de lugar.
--
-- Conteúdo:
--   0. Guarda de pré-requisito (migration 2 deste passo). Falha cedo.
--   1. private.account_passwords (o cofre) e os tipos novos de linha no
--      private.sign_in_throttle (password_change, password_reset).
--   2. Funções internas (private, sem EXECUTE para ninguém além do dono):
--      write_password, set_must_change, clear_must_change, end_sessions,
--      usable_account, discard_legacy_credential, throttle_lock e
--      password_result.
--   3. O portão, criado e AINDA NÃO LIGADO (liga na migration 5, PR 4):
--      raise_gate, assert_session_alive, assert_no_password_mark.
--   4. public.sign_in_attempt recriada sobre o cofre (DT-11): o corpo final
--      do E1.04 (20261125003300_e104_03), com quatro mudanças:
--        a) a conta disponível exige o bcrypt no cofre, no lugar de
--           auth.users.encrypted_password;
--        b) temporária vencida (RN-05): o bcrypt confere, mas
--           temp_expires_at <= agora: falha com o motivo temp_password_expired;
--        c) marca no login (RN-08 b): no sucesso, senha fora da política
--           (a a g) põe a marca weak_password; a Auditoria registra
--           "Troca de senha exigida" só quando a marca é nova;
--        d) o sucesso devolve must_change_password.
--      O resto (limites, travas, lock_timeout de 3 s, teto de 5 s antes de
--      cada RETURN, um bcrypt por tentativa, Auditoria num sub-bloco) não muda.
--   5. Mudança dos hashes para o cofre, com a conferência final:
--        a) auth.users com bcrypt → cofre;
--        b) private.member_access_suspensions com bcrypt → cofre, só se a
--           conta ainda não tem hash lá;
--        c) suspensões sem hash (a restauração do E2.01 devolve vazio);
--        d) auth.users sem hash;
--        e) conferência: nenhuma senha em auth.users nem nas suspensões.
--      Hash não vazio fora do formato $2a$ (o único que o pgcrypto confere)
--      interrompe a migration antes de mudar qualquer coisa.
--   6. A guarda e203_guard_password_write em auth.users (RN-14, DT-02), para
--      o Auth (session_user supabase_auth_admin):
--        - UPDATE que grava senha não vazia: recusado (42501). Pega o PUT
--          /user, o updateUserById e o painel;
--        - INSERT com senha: a conta nasce SEM senha (o valor vira ''). O
--          createUser da Admin API sempre manda uma senha: sem "password", o
--          Auth gera uma aleatória (conferido na stack local). Recusar o INSERT
--          impediria criar qualquer conta (create-user-admin, carga do E4.08).
--      Limpar (nulo ou vazio) continua permitido.
--
-- Ordem global das travas (estende a DT-09 do E2.01; nenhuma função deste
-- passo pega uma trava de nível acima depois de uma de nível abaixo):
--   1. linhas do private.sign_in_throttle, em ordem de (kind, key_hash):
--      identifier < origin < password_change < password_reset;
--   2. relatório → célula → membros (E2.01);
--   3. auth.users (só a suspensão do E2.01 a trava);
--   4. o cofre (private.account_passwords);
--   5. sessões, refresh tokens e eventos.
--
-- A senha nunca vai para RAISE, log ou evento: só entra no crypt(). Nenhuma
-- mensagem de erro desta migration traz senha, hash, identificação ou origem.
--
-- E2.01 sem mudança: _del_suspend_access copia o hash de auth.users (agora
-- vazio) e _del_resume_access devolve vazio. O cofre guarda a senha e a marca
-- durante a exclusão, e a restauração as mantém (RN-08, RN-16 f do E2.01).
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS antes de
-- CREATE TRIGGER e cópias com ON CONFLICT. Rodar de novo não copia nada
-- (auth.users já está vazio).

-- ---------------------------------------------------------------------------
-- 0. Pré-requisito: migration 2 deste passo (e, por ela, E1.04, E2.01, E2.02).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.password_policy_violation(text,text,text,date,text)') IS NULL
     OR to_regprocedure('private.sign_in_assert_duration(interval)') IS NULL
     OR to_regprocedure('public._log_event(public.event_action,public.event_entity,uuid,text,text,text[],jsonb,boolean,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'e203_03_vault depende da e203_02_policy (e do E1.04, E2.01 e E2.02).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. O cofre (DT-01, DA-11). Uma linha por conta de acesso. Nada disso sai
--    pela API: schema private, RLS sem políticas e nenhum privilégio, nem para
--    service_role. Só as funções donas (postgres) usam.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.account_passwords (
  auth_user_id           uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Só bcrypt $2a$ (o único formato que o pgcrypto confere; o $2b$ cairia no
  -- DES). O mesmo formato que a sign_in_attempt exige.
  password_hash          text CHECK (password_hash IS NULL
                                     OR password_hash ~ '^\$2a\$[0-9]{2}\$[./A-Za-z0-9]{53}$'),
  password_set_at        timestamptz,
  password_set_by        uuid REFERENCES public.members (id),  -- nulo: migração, carga ou o próprio sistema
  must_change            boolean NOT NULL DEFAULT false,       -- a marca (RN-08)
  must_change_reason     text CHECK (must_change_reason IN ('initial', 'reset', 'weak_password', 'legacy_weak')),
  must_change_since      timestamptz,
  temp_expires_at        timestamptz,                          -- só da redefinição (RN-05)
  last_change_session_id uuid,                                 -- reenvio da troca (AQ-5, DA-13)
  last_change_request_id uuid,
  CONSTRAINT account_passwords_mark_reason CHECK (must_change = (must_change_reason IS NOT NULL)),
  CONSTRAINT account_passwords_mark_since  CHECK (must_change = (must_change_since IS NOT NULL)),
  CONSTRAINT account_passwords_temp_reset  CHECK (temp_expires_at IS NULL OR must_change_reason = 'reset')
);
CREATE INDEX IF NOT EXISTS account_passwords_set_by_idx
  ON private.account_passwords (password_set_by) WHERE password_set_by IS NOT NULL;
ALTER TABLE private.account_passwords ENABLE ROW LEVEL SECURITY;   -- sem políticas
REVOKE ALL ON TABLE private.account_passwords FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.account_passwords IS
  'E2.03 (DT-01): o cofre de senhas. password_hash é o único lugar da senha (bcrypt $2a$); '
  'auth.users.encrypted_password fica vazio (guarda e203_guard_password_write). Gravado só por '
  'private.write_password; marca e validade por set_must_change e clear_must_change. '
  'Emergência de operação (DA-12): no editor SQL, como postgres, private.write_password.';

-- Limites (DT-09): dois tipos novos de linha na tabela do E1.04.
--   password_change: por conta (chave = id da conta), RN-12;
--   password_reset:  por quem redefine (chave = id do cadastro), RN-06. Ali,
--                    failures guarda as redefinições ACEITAS da última hora.
ALTER TABLE private.sign_in_throttle DROP CONSTRAINT IF EXISTS sign_in_throttle_kind_check;
ALTER TABLE private.sign_in_throttle ADD CONSTRAINT sign_in_throttle_kind_check
  CHECK (kind IN ('identifier', 'origin', 'password_change', 'password_reset'));

-- ---------------------------------------------------------------------------
-- 2. Funções internas (private, SECURITY INVOKER, sem grants). Rodam dentro
--    das RPCs definer, com os privilégios do dono (postgres).
-- ---------------------------------------------------------------------------

-- Ponto do E3.01 e do E3.02 (RN-04): apaga a credencial legada pendente do
-- membro. Neste passo não faz nada; o E3.01 a recria.
CREATE OR REPLACE FUNCTION private.discard_legacy_credential(_member_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  NULL;
END;
$$;

-- O ÚNICO lugar que grava password_hash. bcrypt de custo 10 ($2a$10$, o mesmo
-- do Auth). Uma senha nova invalida a validade da temporária anterior (a
-- redefinição põe a nova logo em seguida). Recusa senha vazia ou acima de 72
-- bytes (o bcrypt ignoraria o resto). Trava a linha da conta no cofre.
CREATE OR REPLACE FUNCTION private.write_password(
  _auth_user_id uuid,
  _member_id    uuid,
  _password     text,
  _set_by       uuid
) RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  IF _auth_user_id IS NULL THEN
    RAISE EXCEPTION 'write_password: conta ausente.' USING ERRCODE = '22023';
  END IF;
  IF _password IS NULL OR _password = '' OR octet_length(_password) > 72 THEN
    RAISE EXCEPTION 'write_password: senha vazia ou acima de 72 bytes.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.account_passwords AS p
         (auth_user_id, password_hash, password_set_at, password_set_by)
  VALUES (_auth_user_id, extensions.crypt(_password, extensions.gen_salt('bf', 10)), now(), _set_by)
  ON CONFLICT (auth_user_id) DO UPDATE
     SET password_hash   = EXCLUDED.password_hash,
         password_set_at = EXCLUDED.password_set_at,
         password_set_by = EXCLUDED.password_set_by,
         temp_expires_at = NULL;

  PERFORM private.discard_legacy_credential(_member_id);
END;
$$;

-- Põe a marca (RN-08). Devolve true só quando a conta ainda não tinha a marca
-- (a Auditoria registra uma vez). Com _reason = 'reset', sempre regrava o
-- motivo, o must_change_since e a validade; com outro motivo, a marca que já
-- existe fica como está. Trava a linha da conta no cofre.
CREATE OR REPLACE FUNCTION private.set_must_change(
  _auth_user_id    uuid,
  _reason          text,
  _temp_expires_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  _was boolean;
BEGIN
  IF _reason IS NULL OR _reason NOT IN ('initial', 'reset', 'weak_password', 'legacy_weak') THEN
    RAISE EXCEPTION 'set_must_change: motivo inválido.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO private.account_passwords (auth_user_id) VALUES (_auth_user_id)
  ON CONFLICT (auth_user_id) DO NOTHING;

  SELECT p.must_change INTO _was
    FROM private.account_passwords p
   WHERE p.auth_user_id = _auth_user_id
     FOR UPDATE;

  IF _was AND _reason <> 'reset' THEN
    RETURN false;
  END IF;

  UPDATE private.account_passwords
     SET must_change        = true,
         must_change_reason = _reason,
         must_change_since  = now(),
         temp_expires_at    = CASE WHEN _reason = 'reset' THEN _temp_expires_at END
   WHERE auth_user_id = _auth_user_id;

  RETURN NOT _was;
END;
$$;

-- Tira a marca e a validade (só numa troca concluída, RN-08) e guarda a
-- sessão e a chave do envio, para o reenvio (DA-13).
CREATE OR REPLACE FUNCTION private.clear_must_change(
  _auth_user_id uuid,
  _session_id   uuid,
  _request_id   uuid
) RETURNS void
LANGUAGE sql
VOLATILE
SET search_path = ''
AS $$
  UPDATE private.account_passwords
     SET must_change            = false,
         must_change_reason     = NULL,
         must_change_since      = NULL,
         temp_expires_at        = NULL,
         last_change_session_id = _session_id,
         last_change_request_id = _request_id
   WHERE auth_user_id = _auth_user_id
$$;

-- Encerra as sessões da conta (RN-16), menos a _keep_session_id quando ela
-- vem, com os refresh tokens delas e os antigos sem sessão (como a
-- _del_suspend_access do E2.01).
CREATE OR REPLACE FUNCTION private.end_sessions(_auth_user_id uuid, _keep_session_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  DELETE FROM auth.sessions s
   WHERE s.user_id = _auth_user_id
     AND (_keep_session_id IS NULL OR s.id <> _keep_session_id);
  DELETE FROM auth.refresh_tokens r
   WHERE r.user_id = _auth_user_id::text
     AND (_keep_session_id IS NULL OR r.session_id IS DISTINCT FROM _keep_session_id);
END;
$$;

-- A conta, quando existe nas condições da DA-3 (as mesmas da conta disponível
-- da sign_in_attempt, sem a senha): não apagada, não banida, e-mail confirmado
-- e não vazio, sem SSO, não anônima. Senão, NULL. Sem trava.
CREATE OR REPLACE FUNCTION private.usable_account(_auth_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT u.id
    FROM auth.users u
   WHERE u.id = _auth_user_id
     AND u.deleted_at IS NULL
     AND (u.banned_until IS NULL OR u.banned_until <= now())
     AND u.email_confirmed_at IS NOT NULL
     AND coalesce(u.email, '') <> ''
     AND NOT coalesce(u.is_sso_user, false)
     AND NOT coalesce(u.is_anonymous, false)
$$;

-- Cria a linha do limite ou trava a que existe (como o passo 4 da
-- sign_in_attempt, DT-03 do E1.04) e, já com a trava, poda de failures os
-- horários fora da janela. key_hash = sign_in_key(_kind, _value): para a
-- origem, _value é 'o:' || sign_in_origin_key(...), a mesma chave do login.
CREATE OR REPLACE FUNCTION private.throttle_lock(_kind text, _value text, _window interval)
RETURNS private.sign_in_throttle
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  _hash bytea := private.sign_in_key(_kind, _value);
  _row  private.sign_in_throttle;
BEGIN
  INSERT INTO private.sign_in_throttle AS t (kind, key_hash, expires_at)
  VALUES (_kind, _hash, clock_timestamp() + _window)
  ON CONFLICT (kind, key_hash) DO UPDATE SET kind = EXCLUDED.kind;

  UPDATE private.sign_in_throttle t
     SET failures = ARRAY(SELECT f FROM unnest(t.failures) AS f
                           WHERE f > clock_timestamp() - _window ORDER BY f)
   WHERE t.kind = _kind
     AND t.key_hash = _hash
  RETURNING t.* INTO _row;

  RETURN _row;
END;
$$;

-- Resultado das RPCs que recebem senha como parâmetro: o teto de 5 s da DT-19
-- do E1.04 antes de devolver (o auto_explain de produção registra, com os
-- parâmetros, só o comando concluído em 10 s ou mais).
CREATE OR REPLACE FUNCTION private.password_result(_result jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
BEGIN
  PERFORM private.sign_in_assert_duration(interval '5 seconds');
  RETURN _result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. O portão (RN-09, RN-16, DT-04). Criado aqui e AINDA NÃO LIGADO: a
--    migration 5 (PR 4) o põe em viewer_member_id, viewer_has e
--    default_role_id. Neste PR, só my_password_status usa assert_session_alive.
-- ---------------------------------------------------------------------------

-- 42501 com app_error: a API responde com erro de permissão (RN-09 b), e a
-- tela distingue pelo código (AQ-3).
CREATE OR REPLACE FUNCTION private.raise_gate(_code text, _message text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '42501',
    MESSAGE = _message,
    DETAIL  = jsonb_build_object('code', _code)::text,
    HINT    = 'app_error';
END;
$$;

-- RN-16: a sessão do token ainda existe? Sem usuário (service role,
-- migrations) ou sem session_id na claim (DA-9): verdadeiro.
CREATE OR REPLACE FUNCTION private.assert_session_alive()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sid text := auth.jwt() ->> 'session_id';
BEGIN
  IF _uid IS NOT NULL AND _sid IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM auth.sessions s WHERE s.id = _sid::uuid AND s.user_id = _uid) THEN
    PERFORM private.raise_gate('session_ended', 'Sua sessão terminou. Entre de novo para continuar.');
  END IF;
  RETURN true;
END;
$$;

-- RN-09: a conta tem a marca?
CREATE OR REPLACE FUNCTION private.assert_no_password_mark()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND EXISTS (
       SELECT 1 FROM private.account_passwords p
        WHERE p.auth_user_id = auth.uid() AND p.must_change) THEN
    PERFORM private.raise_gate('password_change_required', 'Para continuar, crie uma nova senha.');
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION private.discard_legacy_credential(uuid)                FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.write_password(uuid, uuid, text, uuid)         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.set_must_change(uuid, text, timestamptz)       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.clear_must_change(uuid, uuid, uuid)            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.end_sessions(uuid, uuid)                       FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.usable_account(uuid)                           FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.throttle_lock(text, text, interval)            FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.password_result(jsonb)                         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.raise_gate(text, text)                         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_session_alive()                         FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.assert_no_password_mark()                      FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. sign_in_attempt sobre o cofre (DT-11). Retorno (jsonb):
--   {"result":"empty_fields"}
--   {"result":"locked","retry_after_seconds":int,"retry_after_minutes":int}
--   {"result":"invalid"}
--   {"result":"ok","member_id":uuid,"auth_user_id":uuid,"auth_email":text,
--    "identifier_type":text,"identifier_masked":text,"password_action":null,
--    "must_change_password":boolean}
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
  _temp_expires   timestamptz;                           -- E2.03: validade da temporária
  _marked         boolean := false;                      -- E2.03: a marca da conta
  _member         record;                                -- E2.03: dados para a política
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
        -- E2.03 (DT-11): a senha vem do cofre, não de auth.users.
        SELECT u.email,
               pw.password_hash,
               pw.temp_expires_at,
               coalesce(pw.must_change, false),
               u.deleted_at IS NULL
                 AND (u.banned_until IS NULL OR u.banned_until <= _now)
                 AND u.email_confirmed_at IS NOT NULL
                 AND coalesce(u.email, '') <> ''
                 AND NOT coalesce(u.is_sso_user, false)
                 AND NOT coalesce(u.is_anonymous, false)
                 AND coalesce(pw.password_hash ~ c_bcrypt_format, false)
          INTO _acct_email, _acct_hash, _temp_expires, _marked, _account_ok
          FROM auth.users u
          LEFT JOIN private.account_passwords pw ON pw.auth_user_id = u.id
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
  -- E2.03 (RN-05): a temporária vencida confere, mas não entra. Conta nos
  -- limites como qualquer falha, com o motivo próprio.
  IF _ok AND _temp_expires IS NOT NULL AND _temp_expires <= _now THEN
    _ok := false;
    _reason := 'temp_password_expired';
  END IF;

  -- 7a. Sucesso: zera as linhas de identificação; a de origem não muda (RN-11).
  IF _ok THEN
    UPDATE private.sign_in_throttle t
       SET failures = '{}', blocked_until = NULL, expires_at = _now
      FROM unnest(_kinds, _hashes) AS u(kind, key_hash)
     WHERE t.kind = 'identifier'
       AND t.kind = u.kind
       AND t.key_hash = u.key_hash;

    -- E2.03 (RN-08 b): senha fora da política (a a g) põe a marca. Ninguém é
    -- recusado por ela. A Auditoria registra só a marca nova, num sub-bloco.
    IF NOT _marked THEN
      SELECT m.cpf, m.mobile_whatsapp, m.birth_date, m.email INTO _member
        FROM public.members m
       WHERE m.id = _linked_id;
      IF private.password_policy_violation(_password, _member.cpf, _member.mobile_whatsapp,
                                           _member.birth_date, _member.email) IS NOT NULL THEN
        _marked := true;
        IF private.set_must_change(_auth_user_id, 'weak_password', NULL) THEN
          BEGIN
            PERFORM public._log_event(
              _action        => 'password_change_required'::public.event_action,
              _entity        => 'auth'::public.event_entity,
              _entity_id     => _linked_id,
              _entity_label  => _linked_name,
              _description   => 'Troca de senha exigida',
              _changed_fields => NULL,
              _metadata      => jsonb_build_object('reason', 'weak_password'),
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
      'password_action', NULL,                               -- ponto do E3.02
      'must_change_password', _marked                        -- E2.03 (DT-11)
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

REVOKE ALL ON FUNCTION public.sign_in_attempt(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sign_in_attempt(text, text, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Mudança dos hashes para o cofre (DT-01), na mesma transação da nova
--    sign_in_attempt. Nada é impresso: só contagens nas mensagens de erro.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  c_bcrypt constant text := '^\$2a\$[0-9]{2}\$[./A-Za-z0-9]{53}$';
  _bad integer;
BEGIN
  -- Antes de tudo: hash não vazio fora do formato $2a$ não tem para onde ir
  -- (o login não o confere). Interrompe sem mudar nada (tarefa 1, item 4).
  SELECT (SELECT count(*) FROM auth.users u
           WHERE coalesce(u.encrypted_password, '') <> ''
             AND u.encrypted_password !~ c_bcrypt)
       + (SELECT count(*) FROM private.member_access_suspensions s
           WHERE coalesce(s.encrypted_password, '') <> ''
             AND s.encrypted_password !~ c_bcrypt)
    INTO _bad;
  IF _bad > 0 THEN
    RAISE EXCEPTION 'e203_03_vault: % senha(s) fora do formato bcrypt $2a$. Nada foi mudado.', _bad;
  END IF;

  -- a) auth.users → cofre. A conta que já tem hash no cofre fica com o dele.
  INSERT INTO private.account_passwords (auth_user_id, password_hash, password_set_at)
  SELECT u.id, u.encrypted_password, coalesce(u.updated_at, u.created_at, now())
    FROM auth.users u
   WHERE u.encrypted_password ~ c_bcrypt
  ON CONFLICT (auth_user_id) DO NOTHING;

  -- b) suspensões (E2.01) → cofre, só se a conta ainda não tem hash lá. A
  --    conta suspensa tem senha vazia em auth.users, então o hash dela só
  --    existe aqui. Conta que já não existe no Auth fica de fora (o hash não
  --    serviria para nada).
  INSERT INTO private.account_passwords AS p (auth_user_id, password_hash, password_set_at)
  SELECT DISTINCT ON (s.auth_user_id) s.auth_user_id, s.encrypted_password, s.suspended_at
    FROM private.member_access_suspensions s
   WHERE s.encrypted_password ~ c_bcrypt
     AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = s.auth_user_id)
   ORDER BY s.auth_user_id, s.suspended_at DESC
  ON CONFLICT (auth_user_id) DO UPDATE
     SET password_hash   = EXCLUDED.password_hash,
         password_set_at = EXCLUDED.password_set_at
   WHERE p.password_hash IS NULL;

  -- c) as suspensões ficam sem hash: a restauração do E2.01 devolve vazio a
  --    auth.users, e a senha continua no cofre.
  UPDATE private.member_access_suspensions
     SET encrypted_password = NULL
   WHERE encrypted_password IS NOT NULL;

  -- d) auth.users sem senha. O vazio ('') das contas suspensas fica como está.
  UPDATE auth.users
     SET encrypted_password = NULL
   WHERE coalesce(encrypted_password, '') <> '';

  -- e) conferência final: nenhuma senha fora do cofre. Senão, nada muda.
  IF EXISTS (SELECT 1 FROM auth.users WHERE coalesce(encrypted_password, '') <> '')
     OR EXISTS (SELECT 1 FROM private.member_access_suspensions
                 WHERE coalesce(encrypted_password, '') <> '') THEN
    RAISE EXCEPTION 'e203_03_vault: ainda há senha fora do cofre. Nada foi mudado.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. O Auth não grava senha (RN-14, DT-02). session_user é o papel com que o
--    Auth se conecta (supabase_auth_admin):
--      - UPDATE para uma senha não vazia é recusado: pega o PUT /user (a troca
--        pela sessão do próprio usuário), o updateUserById da Admin API e o
--        painel. Sem hash no Auth, o Auth não tem senha nenhuma para conferir;
--      - INSERT com senha não é recusado: a senha é descartada (''), e a conta
--        nasce sem senha. O createUser da Admin API sempre grava uma senha (sem
--        "password", o Auth gera uma aleatória), então recusar o INSERT
--        impediria criar qualquer conta. A senha inicial vai para o cofre por
--        set_initial_password (RN-07).
--    Limpar (nulo ou vazio) continua permitido: é o que fazem a exclusão do
--    próprio Auth e a _del_suspend_access. O postgres (migrations, RPCs, editor
--    SQL) e o authenticator (PostgREST) não são barrados. A mensagem nunca traz
--    o valor.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.guard_auth_password_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF session_user = 'supabase_auth_admin' AND coalesce(NEW.encrypted_password, '') <> '' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.encrypted_password := '';
    ELSIF NEW.encrypted_password IS DISTINCT FROM OLD.encrypted_password THEN
      RAISE EXCEPTION 'A senha não é gravada no Auth. Use as funções do app (E2.03, RN-14).'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_auth_password_write() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS e203_guard_password_write ON auth.users;
CREATE TRIGGER e203_guard_password_write
  BEFORE INSERT OR UPDATE OF encrypted_password ON auth.users
  FOR EACH ROW EXECUTE FUNCTION private.guard_auth_password_write();
