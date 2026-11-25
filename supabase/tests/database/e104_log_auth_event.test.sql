-- E1.04 (PR 3, migration 4): log_auth_event só aceita logout.
-- Spec: docs/specs/e1-04-sign-in.md (repositório apps-mci), RN-15 (e), RN-16.
--
-- Cobre, pela API (SET ROLE authenticated com JWT):
--   - 'login' com sessão dá 22023 e não grava nada em events;
--   - outras ações e NULL dão 22023;
--   - 'logout' grava um evento auth/logout, autor = a conta, success = true,
--     descrição "Logout realizado"; a segunda chamada em 30 s não duplica;
--   - sem sessão dá 42501;
--   - membro excluído não grava e não dá erro (DA-9 do E2.01);
--   - EXECUTE: anon não tem, authenticated tem;
--   - continua SECURITY DEFINER com search_path fixo; assinatura de 4 argumentos.
--
-- Autocontido (dados fictícios) e termina com ROLLBACK. Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a1040400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Chama como o usuário _n (NULL = sem sessão) e devolve o SQLSTATE ('00000' = ok).
CREATE FUNCTION pg_temp.call(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END,
      true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RETURN _state;
  END;
END $$;

CREATE FUNCTION pg_temp.n_auth(_n int) RETURNS int LANGUAGE sql AS
$$ SELECT count(*)::int FROM public.events WHERE actor_user_id = pg_temp.u(_n) AND entity = 'auth' $$;

-- Massa: 1 Ana (ativa), 2 Beto (ativo, sem logout antes), 3 Cris (excluída).
INSERT INTO auth.users (id, email, encrypted_password)
SELECT pg_temp.u(n), 'e104-lae-' || n || '@teste.invalid', extensions.crypt('Senha#' || n, extensions.gen_salt('bf', 4))
  FROM generate_series(1, 3) n;
INSERT INTO public.members (id, name, gender, auth_user_id) VALUES
  ('c1040400-0000-0000-0000-000000000001', 'Ana LAE', 'F', pg_temp.u(1)),
  ('c1040400-0000-0000-0000-000000000002', 'Beto LAE', 'M', pg_temp.u(2)),
  ('c1040400-0000-0000-0000-000000000003', 'Cris LAE', 'F', pg_temp.u(3));
UPDATE public.members SET deleted_at = now() WHERE id = 'c1040400-0000-0000-0000-000000000003';

-- Estrutura
SELECT has_function('public', 'log_auth_event', ARRAY['event_action', 'boolean', 'text', 'text'],
  'a assinatura de 4 argumentos continua');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname = 'log_auth_event' AND pronamespace = 'public'::regnamespace), 1,
  'só existe uma versão de log_auth_event');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.log_auth_event(public.event_action, boolean, text, text)'::regprocedure), true,
  'continua SECURITY DEFINER');
SELECT ok(coalesce((SELECT 'search_path=public' = ANY (proconfig) FROM pg_proc
  WHERE oid = 'public.log_auth_event(public.event_action, boolean, text, text)'::regprocedure), false),
  'search_path fixo em public');
SELECT is(has_function_privilege('anon', 'public.log_auth_event(public.event_action, boolean, text, text)', 'EXECUTE'), false,
  'anon não executa');
SELECT is(has_function_privilege('authenticated', 'public.log_auth_event(public.event_action, boolean, text, text)', 'EXECUTE'), true,
  'authenticated executa');

-- login recusado
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event('login', true, 'ana@teste.invalid', NULL)$$), '22023',
  'RN-15 e: login com sessão dá 22023');
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event('login', false, 'ana@teste.invalid', 'x')$$), '22023',
  'RN-15 e: login com sucesso falso também dá 22023');
SELECT is(pg_temp.n_auth(1), 0, 'RN-15 e: o login recusado não grava nada em events');

-- outras ações e NULL
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event('create', true, NULL, NULL)$$), '22023',
  'outra ação (create) dá 22023');
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event('delete', true, NULL, NULL)$$), '22023',
  'outra ação (delete) dá 22023');
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event(NULL, true, NULL, NULL)$$), '22023',
  'ação NULL dá 22023');
SELECT is(pg_temp.n_auth(1), 0, 'as ações recusadas não gravam nada');

-- sem sessão
SELECT is(pg_temp.call(NULL, $$SELECT public.log_auth_event('logout', true, NULL, NULL)$$), '42501',
  'sem sessão, logout dá 42501');
SELECT is(pg_temp.call(NULL, $$SELECT public.log_auth_event('login', true, NULL, NULL)$$), '42501',
  'sem sessão, login dá 42501 (a sessão é checada antes)');

-- logout
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event('logout', true, NULL, NULL)$$), '00000', 'logout com sessão não dá erro');
SELECT is((SELECT count(*)::int FROM public.events
            WHERE actor_user_id = pg_temp.u(1) AND entity = 'auth' AND action = 'logout'
              AND success = true AND description = 'Logout realizado'), 1,
  'logout grava um evento auth/logout, autor = a conta, success = true, "Logout realizado"');
SELECT is(pg_temp.call(1, $$SELECT public.log_auth_event('logout', true, NULL, NULL)$$), '00000', 'a segunda chamada não dá erro');
SELECT is(pg_temp.n_auth(1), 1, 'a segunda chamada em 30 s não duplica');

-- excluído
SELECT is(pg_temp.call(3, $$SELECT public.log_auth_event('logout', true, NULL, NULL)$$), '00000'
  , 'membro excluído: logout não dá erro');
SELECT is(pg_temp.n_auth(3), 0, 'membro excluído: não grava nada (DA-9)');

SELECT * FROM finish();
ROLLBACK;
