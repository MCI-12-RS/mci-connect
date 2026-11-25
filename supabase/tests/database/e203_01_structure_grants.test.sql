-- E2.03 (PR 1, tarefa 5): estrutura, privilégios e a guarda do Auth (RN-14).
-- Spec: docs/specs/e2-03-senha.md, "Verificações obrigatórias" (Estrutura e grants), RN-13, RN-14, DT-01, DT-02,
-- "Integridade e privilégios" e "Contratos".
--
-- Cobre:
--   - o cofre e a lista de senhas comuns sem privilégio para anon, authenticated e service_role;
--   - reset_member_password e my_password_status só para authenticated; change_own_password, check_password_policy,
--     set_initial_password e sign_in_attempt só para service_role; nenhuma com anon; as internas sem EXECUTE;
--   - chamar fora do papel dá 42501 (e o schema private não abre para a API);
--   - o CHECK do cofre (só bcrypt $2a$), as combinações da marca, os tipos novos do limite e do enum;
--   - a guarda e203_guard_password_write existe, e o postgres grava e limpa a senha sem recusa (RN-14);
--   - depois da migration 3, nenhuma conta com senha em auth.users nem nas suspensões do E2.01;
--   - members_view.password_reset_status é a última coluna.
-- Rodar de novo as migrations sem erro: tests/concurrency/e203_migrations.sh (precisa de um banco para refazer).
-- Autocontido: termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(44);

-- Tenta _sql como o papel _role (sem JWT); devolve o SQLSTATE ('00000' = passou).
CREATE FUNCTION pg_temp.as_role(_role text, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN _role = 'authenticated'
      THEN json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text ELSE '' END, true);
    EXECUTE 'SET LOCAL ROLE ' || _role;
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    RETURN '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN _state;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- O cofre e a lista: nenhum privilégio para ninguém da API.
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(role),
            (VALUES ('private.account_passwords'), ('private.common_passwords')) t(tbl),
            (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
           WHERE has_table_privilege(r.role, t.tbl, p.priv)), 0,
  'cofre e lista de senhas comuns: nenhum privilégio de tabela para anon, authenticated e service_role');
SELECT is((SELECT count(*)::int FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(role),
            (VALUES ('private.account_passwords'), ('private.common_passwords')) t(tbl),
            (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) p(priv)
           WHERE has_any_column_privilege(r.role, t.tbl, p.priv)), 0, 'nenhum privilégio de coluna também');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.account_passwords'::regclass), 'o cofre tem RLS ligado (e nenhuma política)');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private' AND tablename IN ('account_passwords', 'common_passwords')), 0, 'e nenhuma política');
SELECT is(pg_temp.as_role('authenticated', 'SELECT * FROM private.account_passwords'), '42501', 'authenticated não lê o cofre (schema private fechado)');
SELECT is(pg_temp.as_role('service_role', 'SELECT * FROM private.account_passwords'), '42501', 'service_role não lê o cofre');
SELECT is(pg_temp.as_role('anon', 'SELECT * FROM private.common_passwords'), '42501', 'anon não lê a lista de senhas comuns');

-- ---------------------------------------------------------------------------
-- Funções públicas: quem executa.
-- ---------------------------------------------------------------------------
SELECT is((SELECT jsonb_object_agg(f, jsonb_build_object('anon', has_function_privilege('anon', f, 'EXECUTE'),
                                                          'authenticated', has_function_privilege('authenticated', f, 'EXECUTE'),
                                                          'service_role', has_function_privilege('service_role', f, 'EXECUTE')))
            FROM unnest(ARRAY[
              'public.reset_member_password(uuid)',
              'public.my_password_status()',
              'public.change_own_password(uuid,uuid,text,text,text,text,text,uuid)',
              'public.check_password_policy(text,text,text,date,text)',
              'public.set_initial_password(uuid,uuid,text,text,text,date,text)',
              'public.sign_in_attempt(text,text,text)']) f),
  '{"public.reset_member_password(uuid)": {"anon": false, "authenticated": true, "service_role": false},
    "public.my_password_status()": {"anon": false, "authenticated": true, "service_role": false},
    "public.change_own_password(uuid,uuid,text,text,text,text,text,uuid)": {"anon": false, "authenticated": false, "service_role": true},
    "public.check_password_policy(text,text,text,date,text)": {"anon": false, "authenticated": false, "service_role": true},
    "public.set_initial_password(uuid,uuid,text,text,text,date,text)": {"anon": false, "authenticated": false, "service_role": true},
    "public.sign_in_attempt(text,text,text)": {"anon": false, "authenticated": false, "service_role": true}}'::jsonb,
  'EXECUTE: reset e my_password_status só authenticated; as outras quatro só service_role; nenhuma com anon');
SELECT is(pg_temp.as_role('anon', $$SELECT public.reset_member_password(gen_random_uuid())$$), '42501', 'anon chamando reset_member_password: 42501');
SELECT is(pg_temp.as_role('service_role', $$SELECT public.reset_member_password(gen_random_uuid())$$), '42501', 'service_role chamando reset_member_password: 42501');
SELECT is(pg_temp.as_role('authenticated', $$SELECT public.change_own_password(gen_random_uuid(), gen_random_uuid(), 'forced', NULL, 'x', 'x', NULL, gen_random_uuid())$$), '42501',
  'authenticated chamando change_own_password: 42501 (só a Edge Function troca a senha)');
SELECT is(pg_temp.as_role('authenticated', $$SELECT public.set_initial_password(gen_random_uuid(), gen_random_uuid(), 'x', NULL, NULL, NULL, NULL)$$), '42501', 'authenticated chamando set_initial_password: 42501');
SELECT is(pg_temp.as_role('authenticated', $$SELECT public.check_password_policy('abc', NULL, NULL, NULL, NULL)$$), '42501', 'authenticated chamando check_password_policy: 42501');
SELECT is(pg_temp.as_role('service_role', $$SELECT * FROM public.my_password_status()$$), '42501', 'service_role chamando my_password_status: 42501');
SELECT is(pg_temp.as_role('anon', $$SELECT * FROM public.my_password_status()$$), '42501', 'anon chamando my_password_status: 42501');

-- As públicas (definer) fixam o search_path; as de troca e a inicial têm lock_timeout.
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.oid IN (
             'public.reset_member_password(uuid)'::regprocedure, 'public.my_password_status()'::regprocedure,
             'public.change_own_password(uuid,uuid,text,text,text,text,text,uuid)'::regprocedure,
             'public.check_password_policy(text,text,text,date,text)'::regprocedure,
             'public.set_initial_password(uuid,uuid,text,text,text,date,text)'::regprocedure)
             AND p.prosecdef AND p.proconfig::text ~ 'search_path'), 5, 'as cinco públicas novas são SECURITY DEFINER com search_path fixo');
SELECT ok((SELECT proconfig::text ~ 'lock_timeout=5s' FROM pg_proc WHERE oid = 'public.reset_member_password(uuid)'::regprocedure), 'a redefinição espera no máximo 5 s pelas travas (DA-15)');
SELECT ok((SELECT proconfig::text ~ 'lock_timeout=3s' FROM pg_proc WHERE oid = 'public.change_own_password(uuid,uuid,text,text,text,text,text,uuid)'::regprocedure), 'a troca espera no máximo 3 s');

-- ---------------------------------------------------------------------------
-- Internas (private): ninguém da API executa.
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) r(role)
           WHERE n.nspname = 'private'
             AND p.proname IN ('write_password', 'set_must_change', 'clear_must_change', 'end_sessions', 'usable_account', 'throttle_lock',
                               'discard_legacy_credential', 'password_result', 'reset_refused', 'raise_gate', 'assert_session_alive',
                               'assert_no_password_mark', 'fold_password', 'is_simple_sequence', 'password_policy_violation',
                               'generate_temporary_password', 'guard_auth_password_write')
             AND has_function_privilege(r.role, p.oid, 'EXECUTE')), 0, 'as funções internas do E2.03 não têm EXECUTE para anon, authenticated nem service_role');
SELECT is((SELECT count(DISTINCT p.proname)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private'
              AND p.proname IN ('write_password', 'set_must_change', 'clear_must_change', 'end_sessions', 'usable_account', 'throttle_lock',
                                'discard_legacy_credential', 'password_result', 'reset_refused', 'raise_gate', 'assert_session_alive',
                                'assert_no_password_mark', 'fold_password', 'is_simple_sequence', 'password_policy_violation',
                                'generate_temporary_password', 'guard_auth_password_write')), 17, 'as 17 internas existem');
SELECT is(pg_temp.as_role('service_role', $$SELECT private.write_password(gen_random_uuid(), gen_random_uuid(), 'Abc12345x', NULL)$$), '42501',
  'service_role não chama private.write_password (nem o schema abre)');
SELECT is(pg_temp.as_role('authenticated', $$SELECT private.password_policy_violation('x', NULL, NULL, NULL, NULL)$$), '42501', 'authenticated não chama a política interna');

-- ---------------------------------------------------------------------------
-- Cofre: formato, marca, tipos novos do limite e do enum.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ('a2030100-0000-0000-0000-000000000001', 'e203-estrutura@teste.invalid', now());
SELECT throws_ok($$INSERT INTO private.account_passwords (auth_user_id, password_hash)
                   VALUES ('a2030100-0000-0000-0000-000000000001', '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234')$$,
  '23514', NULL, 'o cofre recusa hash que não é bcrypt $2a$ (o $2b$ cairia no DES)');
SELECT throws_ok($$INSERT INTO private.account_passwords (auth_user_id, password_hash)
                   VALUES ('a2030100-0000-0000-0000-000000000001', 'e10adc3949ba59abbe56e057f20f883e')$$,
  '23514', NULL, 'o cofre recusa MD5 (a senha do legado nunca entra no cofre)');
SELECT throws_ok($$INSERT INTO private.account_passwords (auth_user_id, must_change) VALUES ('a2030100-0000-0000-0000-000000000001', true)$$,
  '23514', NULL, 'a marca exige motivo e data (must_change sozinho é recusado)');
SELECT throws_ok($$INSERT INTO private.account_passwords (auth_user_id, must_change, must_change_reason, must_change_since, temp_expires_at)
                   VALUES ('a2030100-0000-0000-0000-000000000001', true, 'initial', now(), now())$$,
  '23514', NULL, 'a validade só existe para a marca "reset"');
SELECT throws_ok($$SELECT private.write_password('a2030100-0000-0000-0000-000000000001', NULL, repeat('x', 73), NULL)$$,
  '22023', NULL, 'write_password recusa senha acima de 72 bytes');
SELECT throws_ok($$SELECT private.write_password('a2030100-0000-0000-0000-000000000001', NULL, '', NULL)$$, '22023', NULL, 'write_password recusa senha vazia');
SELECT throws_ok($$SELECT private.set_must_change('a2030100-0000-0000-0000-000000000001', 'qualquer', NULL)$$, '22023', NULL, 'set_must_change recusa motivo desconhecido');
SELECT lives_ok($$INSERT INTO private.sign_in_throttle (kind, key_hash, expires_at) VALUES ('password_change', '\x01', now()), ('password_reset', '\x02', now())$$,
  'o controle de limites aceita os tipos password_change e password_reset');
SELECT throws_ok($$INSERT INTO private.sign_in_throttle (kind, key_hash, expires_at) VALUES ('outro', '\x03', now())$$, '23514', NULL, 'e recusa tipos desconhecidos');
SELECT is((SELECT array_agg(e::text ORDER BY e::text) FROM unnest(enum_range(NULL::public.event_action)) e
            WHERE e::text IN ('password_reset', 'password_reset_refused', 'password_change_failed', 'password_change_blocked', 'password_change_required', 'password_changed')),
  ARRAY['password_change_blocked', 'password_change_failed', 'password_change_required', 'password_changed', 'password_reset', 'password_reset_refused'],
  'event_action tem os cinco valores novos (e o password_changed que já existia)');

-- ---------------------------------------------------------------------------
-- RN-14: a guarda do Auth.
-- ---------------------------------------------------------------------------
SELECT is((SELECT jsonb_build_object('timing', (t.tgtype & 2) <> 0, 'insert', (t.tgtype & 4) <> 0, 'update', (t.tgtype & 16) <> 0,
                                      'row', (t.tgtype & 1) <> 0, 'enabled', t.tgenabled)
             FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'e203_guard_password_write' AND NOT t.tgisinternal),
  '{"timing": true, "insert": true, "update": true, "row": true, "enabled": "O"}'::jsonb,
  'RN-14: o trigger e203_guard_password_write existe em auth.users (BEFORE INSERT OR UPDATE, por linha, ligado)');
SELECT matches(pg_get_functiondef('private.guard_auth_password_write()'::regprocedure), 'supabase_auth_admin',
  'RN-14: a guarda age sobre o papel do Auth (supabase_auth_admin)');
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = 'qualquer-coisa' WHERE id = 'a2030100-0000-0000-0000-000000000001'$$,
  'RN-14: o postgres (migrations, RPCs, editor SQL) grava senha em auth.users sem recusa');
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = NULL WHERE id = 'a2030100-0000-0000-0000-000000000001'$$, 'RN-14: e limpa sem recusa');
SELECT lives_ok($$UPDATE auth.users SET encrypted_password = '' WHERE id = 'a2030100-0000-0000-0000-000000000001'$$, 'RN-14: e limpa com vazio');

-- ---------------------------------------------------------------------------
-- Depois da migration 3: nenhuma senha fora do cofre.
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM auth.users WHERE coalesce(encrypted_password, '') <> ''), 0, 'nenhuma conta com senha em auth.users');
SELECT is((SELECT count(*)::int FROM private.member_access_suspensions WHERE coalesce(encrypted_password, '') <> ''), 0, 'nenhuma senha nas suspensões do E2.01');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE password_hash IS NOT NULL AND password_hash !~ '^\$2a\$[0-9]{2}\$[./A-Za-z0-9]{53}$'), 0,
  'nenhuma linha do cofre tem outra coisa além de bcrypt $2a$');
SELECT is((SELECT count(*)::int FROM private.account_passwords p WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p.auth_user_id)), 0, 'toda linha do cofre tem conta (FK com cascata)');

-- ---------------------------------------------------------------------------
-- members_view: a coluna nova no fim.
-- ---------------------------------------------------------------------------
SELECT is((SELECT column_name::text FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'members_view' ORDER BY ordinal_position DESC LIMIT 1),
  'password_reset_status', 'members_view.password_reset_status é a última coluna');
SELECT ok(pg_get_viewdef('public.members_view'::regclass) ~ 'viewer_covers_role', 'a coluna usa viewer_covers_role (a mesma regra da RN-02)');
SELECT is((SELECT count(*)::int FROM pg_class c WHERE c.oid = 'public.members_view'::regclass AND c.reloptions::text ~ 'security_invoker=(true|on)'), 0,
  'a members_view continua security definer (a máscara e o escopo dependem disso)');

SELECT * FROM finish();

ROLLBACK;
