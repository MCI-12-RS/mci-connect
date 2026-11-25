-- E2.03 (PR 1, tarefa 5): a marca de troca obrigatória e a senha inicial (RN-07, RN-08 b, RN-08 restauração,
-- RN-16 e RN-04 com a exclusão), a conferência da sign_in_attempt sobre o cofre.
-- Spec: docs/specs/e2-03-senha.md, RN-04, RN-07, RN-08 (b), RN-16 e "Redefinição × exclusão".
--
-- Cobre:
--   - RN-07: set_initial_password (marca "initial" sem validade, só uma vez por conta, a conta que já tem senha);
--   - RN-08 (b): Gabriel entra com abc123 e ganha a marca com um único registro "Troca de senha exigida"
--     ("Senha fora das regras"), sair e entrar de novo não registra outro; Caio com senha boa vai direto;
--     Fábio inativo com a marca entra para a troca; restauração (E2.01) mantém a marca; conta sem linha no cofre
--     (carga com senha aleatória) não tem marca e não entra;
--   - redefinição seguida de exclusão (a senha temporária e a marca ficam e voltam na restauração) e a
--     redefinição de excluído é recusada (not_found);
--   - my_password_status: a marca, a conta sem linha e a sessão apagada.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(39);

-- ---------------------------------------------------------------------------
-- Ids fixos: u = auth, m = membros, s = sessões, role = funções de teste.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2030000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2030000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
-- Sessão k (1 a 9) do usuário n.
CREATE FUNCTION pg_temp.s(_n int, _k int DEFAULT 1) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('5e550000-0000-0000-' || lpad(_k::text, 4, '0') || '-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192030' || lpad(_n::text, 4, '0') $$;

-- Chama _sql (um SELECT que devolve jsonb) como o usuário _n, com a sessão _k nas claims
-- (_k = 0: sem session_id). Devolve o jsonb, ou {"error": SQLSTATE, "message", "hint", "detail"}.
CREATE FUNCTION pg_temp.api(_n int, _sql text, _k int DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _msg text; _detail text; _hint text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated',
                        'session_id', CASE WHEN _k > 0 THEN pg_temp.s(_n, _k) END)::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', _state, 'message', _msg, 'hint', nullif(_hint, ''),
                              'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb END);
  END;
END $$;

-- Como service_role (o papel da Edge Function).
CREATE FUNCTION pg_temp.svc(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _msg text; _detail text; _hint text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state, 'message', _msg, 'hint', nullif(_hint, ''),
                              'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb END);
  END;
END $$;

-- Redefinição como o usuário _n sobre o membro _t.
CREATE FUNCTION pg_temp.rst(_n int, _t int) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.api(_n, format('SELECT public.reset_member_password(%L)', pg_temp.m(_t))) $$;
-- code / result curtos.
CREATE FUNCTION pg_temp.rc(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(_r ->> 'code', _r ->> 'result', 'ERR ' || (_r ->> 'error')) $$;

CREATE TEMP SEQUENCE origin_seq;
CREATE FUNCTION pg_temp.next_origin() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT '198.18.' || ((n / 250) % 250)::text || '.' || ((n % 250) + 1)::text FROM (SELECT nextval('origin_seq') AS n) s
$$;
-- Login pela sign_in_attempt (origem nova a cada chamada, a menos que passe uma).
CREATE FUNCTION pg_temp.login(_identifier text, _password text, _origin text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.svc(format('SELECT public.sign_in_attempt(%L, %L, %L)', _identifier, _password,
                              coalesce(_origin, pg_temp.next_origin()))) $$;
CREATE FUNCTION pg_temp.lres(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(_r ->> 'result', 'ERR ' || (_r ->> 'error')) $$;

-- Eventos de autenticação novos desde a última chamada, por ação (e os marca como vistos).
CREATE TEMP TABLE seen_events (id uuid PRIMARY KEY);
CREATE FUNCTION pg_temp.take(_action text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'occurred_at' - 'changed_fields' ORDER BY e.entity_label, e.id), '[]')
    INTO _out FROM public.events e
   WHERE e.action::text = _action AND e.id NOT IN (SELECT id FROM seen_events);
  INSERT INTO seen_events SELECT e.id FROM public.events e WHERE e.action::text = _action ON CONFLICT DO NOTHING;
  RETURN _out;
END $$;
-- Marca tudo o que já existe como visto.
CREATE FUNCTION pg_temp.see_all() RETURNS void LANGUAGE sql AS
$$ INSERT INTO seen_events SELECT id FROM public.events ON CONFLICT DO NOTHING $$;

-- Cria a conta de acesso do membro _n: sem senha no Auth, com a senha no cofre.
CREATE FUNCTION pg_temp.acct(_n int, _password text DEFAULT 'Forte@2024x') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pg_temp.u(_n), 'e203-' || _n || '@teste.invalid', now());
  PERFORM private.write_password(pg_temp.u(_n), pg_temp.m(_n), _password, NULL);
  INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(_n, 1), pg_temp.u(_n));
END $$;

-- Estado da massa (para "nada muda"): cofre, contas, sessões, limites de redefinição e cadastros.
CREATE FUNCTION pg_temp.snap() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(
    coalesce((SELECT string_agg(concat_ws('|', p.auth_user_id, p.password_hash, p.must_change, p.must_change_reason,
                                          p.temp_expires_at, p.password_set_at, p.last_change_request_id), ';' ORDER BY p.auth_user_id)
                FROM private.account_passwords p WHERE p.auth_user_id::text LIKE 'a2030000%'), '')
 || coalesce((SELECT string_agg(concat_ws('|', id, banned_until, encrypted_password), ';' ORDER BY id)
                FROM auth.users WHERE id::text LIKE 'a2030000%'), '')
 || coalesce((SELECT string_agg(id::text, ';' ORDER BY id) FROM auth.sessions WHERE user_id::text LIKE 'a2030000%'), '')
 || coalesce((SELECT string_agg(concat_ws('|', id, name, role_id, is_active, deleted_at, auth_user_id, leader_id), ';' ORDER BY id)
                FROM public.members WHERE id::text LIKE 'c2030000%'), '')
 || coalesce((SELECT string_agg(concat_ws('|', kind, failures::text), ';' ORDER BY kind, key_hash)
                FROM private.sign_in_throttle WHERE kind IN ('password_reset', 'password_change') AND cardinality(failures) > 0), ''))
$$;

-- ---------------------------------------------------------------------------
-- Massa (E2.02, "Massa de exemplo", mais Olga, Nina, Lauro e os dados de Caio).
--  1 Samuel e 2 Magda (pastores, Líder)         3 Pedro e 4 Paula (G12, Líder)
--  5 Tiago e 6 Tânia (G12, Líder)               7 André (Líder) e 8 Beatriz (Membro): casados
--  9 Caio (Membro) e 10 Fábio (Membro, inativo), discípulos de André; 11 Gabriel (Fábio)
-- 12 Carla (Apoio, discípula de Paula)          13 Diego (Líder) e 14 Hugo (sem função), de Tiago
-- 15 Rita (Administrador, discípula de Tânia)   16 Ester (Membro, sem liderança)
-- 17 Olga (Administrador, discípula de Paula)   18 Nina (Membro, de André, excluída, conta suspensa)
-- 19 Lauro (Membro, de André, sem conta)        20 Débora (Membro, de Beatriz)
-- 21 Gerente (função só com manage_roles, discípulo de Samuel)
-- ---------------------------------------------------------------------------
-- A Líder ganha a permissão só na migration 5 (PR 4): aqui ela entra na massa.
INSERT INTO public.role_permissions (role_id, permission)
VALUES (pg_temp.role('Líder'), 'change_member_password') ON CONFLICT DO NOTHING;
INSERT INTO public.roles (id, name) VALUES
  ('b2030000-0000-0000-0000-000000000001', 'E203 Apoio'), ('b2030000-0000-0000-0000-000000000002', 'E203 Gerente');
INSERT INTO public.role_permissions (role_id, permission)
SELECT 'b2030000-0000-0000-0000-000000000001', permission FROM public.role_permissions WHERE role_id = pg_temp.role('Membro');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('b2030000-0000-0000-0000-000000000001', 'change_member_password'),
  ('b2030000-0000-0000-0000-000000000002', 'manage_roles'), ('b2030000-0000-0000-0000-000000000002', 'view_all_church');

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(1), 'Samuel E203', 'M', true, NULL, false, true, pg_temp.mob(1), pg_temp.role('Líder')),
  (pg_temp.m(2), 'Magda E203', 'F', true, NULL, false, true, pg_temp.mob(2), pg_temp.role('Líder')),
  (pg_temp.m(16), 'Ester E203', 'F', false, NULL, false, true, pg_temp.mob(16), pg_temp.role('Membro'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(3), 'Pedro E203', 'M', pg_temp.m(1), true, true, pg_temp.mob(3), pg_temp.role('Líder')),
  (pg_temp.m(4), 'Paula E203', 'F', pg_temp.m(2), true, true, pg_temp.mob(4), pg_temp.role('Líder')),
  (pg_temp.m(5), 'Tiago E203', 'M', pg_temp.m(1), true, true, pg_temp.mob(5), pg_temp.role('Líder')),
  (pg_temp.m(6), 'Tânia E203', 'F', pg_temp.m(2), true, true, pg_temp.mob(6), pg_temp.role('Líder')),
  (pg_temp.m(21), 'Gerente E203', 'M', pg_temp.m(1), true, true, pg_temp.mob(21), 'b2030000-0000-0000-0000-000000000002');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(7), 'André E203', 'M', pg_temp.m(3), true, true, pg_temp.mob(7), pg_temp.role('Líder')),
  (pg_temp.m(8), 'Beatriz E203', 'F', pg_temp.m(6), true, true, pg_temp.mob(8), pg_temp.role('Membro')),
  (pg_temp.m(12), 'Carla E203', 'F', pg_temp.m(4), true, true, pg_temp.mob(12), 'b2030000-0000-0000-0000-000000000001'),
  (pg_temp.m(13), 'Diego E203', 'M', pg_temp.m(5), true, true, pg_temp.mob(13), pg_temp.role('Líder')),
  (pg_temp.m(14), 'Hugo E203', 'M', pg_temp.m(5), true, true, pg_temp.mob(14), NULL),
  (pg_temp.m(15), 'Rita E203', 'F', pg_temp.m(6), true, true, pg_temp.mob(15), pg_temp.role('Administrador')),
  (pg_temp.m(17), 'Olga E203', 'F', pg_temp.m(4), true, true, pg_temp.mob(17), pg_temp.role('Administrador'));
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id, email, cpf, birth_date) VALUES
  (pg_temp.m(9), 'Caio Lima', 'M', pg_temp.m(7), true, true, '51988887777', pg_temp.role('Membro'),
   'caio.lima@exemplo.com', '52998224725', '1990-03-15');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(10), 'Fábio E203', 'M', pg_temp.m(7), true, false, pg_temp.mob(10), pg_temp.role('Membro')),
  (pg_temp.m(18), 'Nina E203', 'F', pg_temp.m(7), true, true, pg_temp.mob(18), pg_temp.role('Membro')),
  (pg_temp.m(19), 'Lauro E203', 'M', pg_temp.m(7), true, true, pg_temp.mob(19), pg_temp.role('Membro')),
  (pg_temp.m(20), 'Débora E203', 'F', pg_temp.m(8), true, true, pg_temp.mob(20), pg_temp.role('Membro'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(11), 'Gabriel E203', 'M', pg_temp.m(10), true, true, pg_temp.mob(11), pg_temp.role('Membro'));

-- Contas (todas, menos Lauro) e vínculo com os cadastros. Caio tem a senha do critério.
SELECT pg_temp.acct(n, CASE n WHEN 9 THEN 'Caminho2024' ELSE 'Forte@2024x' END)
  FROM generate_series(1, 21) n WHERE n <> 19;
UPDATE public.members SET auth_user_id = pg_temp.u(id_n)
  FROM (SELECT n AS id_n FROM generate_series(1, 21) n WHERE n <> 19) x WHERE id = pg_temp.m(id_n);
-- Caio no celular e no computador.
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(9, 2), pg_temp.u(9));
-- A Líder precisa continuar visível como antes: Hugo (sem função) fica com a conta.
-- Nina é excluída por Rita (E2.01): a conta fica suspensa e a senha guardada.
SELECT pg_temp.api(15, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(18)));
SELECT pg_temp.see_all();

CREATE FUNCTION pg_temp.status(_n int, _k int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.api(_n, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', _k) $$;

-- ===========================================================================
-- RN-07: senha inicial pela set_initial_password (a Edge Function create-user-admin chama depois do createUser)
-- ===========================================================================
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pg_temp.u(60), 'mateus@teste.invalid', now());
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id = pg_temp.u(60)), 0, 'RN-07: a conta nova nasce sem linha no cofre (o Auth não guarda senha)');
SELECT is(pg_temp.svc(format('SELECT to_jsonb(public.set_initial_password(%L, %L, NULL, NULL, NULL, NULL, NULL))', pg_temp.u(60), pg_temp.m(60))) ->> 'error', NULL,
  'RN-07: sem senha digitada, set_initial_password grava a inicial');
SELECT is((SELECT row(extensions.crypt('123456', password_hash) = password_hash, must_change, must_change_reason, temp_expires_at IS NULL, password_set_by IS NULL)::text
             FROM private.account_passwords WHERE auth_user_id = pg_temp.u(60)),
  '(t,t,initial,t,t)', 'RN-07: a senha é 123456, com a marca "initial", sem validade e sem autor');
SELECT is((pg_temp.svc(format('SELECT to_jsonb(public.set_initial_password(%L, %L, %L, NULL, NULL, NULL, NULL))', pg_temp.u(60), pg_temp.m(60), 'Oliveira#7')) #>> '{detail,code}'),
  'password_already_set', 'RN-07: a conta que já tem senha não recebe outra inicial (password_already_set)');
SELECT is((SELECT extensions.crypt('123456', password_hash) = password_hash FROM private.account_passwords WHERE auth_user_id = pg_temp.u(60)), true, 'RN-07: e a senha continua 123456');
SELECT is(pg_temp.take('password_change_required'), '[]'::jsonb, 'RN-07: a marca "initial" não vira registro de troca exigida (só a de senha fraca, no login)');
SELECT is(pg_temp.svc(format('SELECT public.set_initial_password(%L, %L, %L, NULL, NULL, NULL, NULL)::text::jsonb', NULL, pg_temp.m(60), 'Oliveira#7')) ->> 'error', '22023',
  'RN-07: set_initial_password sem conta dá 22023');

-- ===========================================================================
-- RN-08 (b): a marca no primeiro login com senha fora da política
-- ===========================================================================
SELECT pg_temp.see_all();
UPDATE public.members SET email = 'gabriel.e203@exemplo.com' WHERE id = pg_temp.m(11);
SELECT private.write_password(pg_temp.u(11), pg_temp.m(11), 'abc123', NULL);
SELECT is(pg_temp.status(11), '{"must_change_password": false}'::jsonb, 'RN-08: Gabriel, com abc123 gravada antes, ainda não tem a marca');
SELECT is(pg_temp.login('gabriel.e203@exemplo.com', 'abc123') -> 'must_change_password', 'true'::jsonb, 'RN-08: Gabriel entra com abc123 e vai para a troca obrigatória');
SELECT is((SELECT jsonb_build_object('n', jsonb_array_length(a), 'desc', a -> 0 ->> 'description', 'reason', a #>> '{0,metadata,reason}',
                                     'entity_id', a #>> '{0,entity_id}', 'success', a -> 0 -> 'success')
             FROM (SELECT pg_temp.take('password_change_required') a) x),
  jsonb_build_object('n', 1, 'desc', 'Troca de senha exigida', 'reason', 'weak_password', 'entity_id', pg_temp.m(11)::text, 'success', true),
  'RN-08: a Auditoria registra "Troca de senha exigida", motivo "Senha fora das regras" (weak_password)');
SELECT is((SELECT must_change_reason FROM private.account_passwords WHERE auth_user_id = pg_temp.u(11)), 'weak_password', 'RN-08: o cofre guarda o motivo weak_password');
SELECT is(pg_temp.login('gabriel.e203@exemplo.com', 'abc123') -> 'must_change_password', 'true'::jsonb, 'RN-08: sai sem trocar e entra de novo: volta para a troca obrigatória');
SELECT is(pg_temp.take('password_change_required'), '[]'::jsonb, 'RN-08: e não há um novo registro de troca exigida');
SELECT is(pg_temp.login('51988887777', 'Caminho2024') -> 'must_change_password', 'false'::jsonb, 'RN-08: Caio, com Caminho2024 (atende à política), vai direto para a tela inicial');
SELECT is(pg_temp.take('password_change_required'), '[]'::jsonb, 'RN-08: e nada é registrado');
SELECT is((SELECT must_change FROM private.account_passwords WHERE auth_user_id = pg_temp.u(9)), false, 'RN-08: a conta de Caio segue sem a marca');
SELECT is(pg_temp.status(11), '{"must_change_password": true}'::jsonb, 'RN-08: my_password_status de Gabriel mostra a marca');
-- Fábio (inativo).
UPDATE private.account_passwords SET must_change = true, must_change_reason = 'weak_password', must_change_since = now() WHERE auth_user_id = pg_temp.u(10);
SELECT is(pg_temp.login(pg_temp.mob(10), 'Forte@2024x') -> 'must_change_password', 'true'::jsonb, 'RN-08: Fábio (inativo), com a marca, entra para a troca obrigatória como qualquer membro');
-- Conta sem linha no cofre (carga com senha aleatória, 6.2): sem marca e sem senha utilizável.
DELETE FROM private.account_passwords WHERE auth_user_id = pg_temp.u(20);
SELECT is(pg_temp.status(20), '{"must_change_password": false}'::jsonb, 'RN-08: a conta sem linha no cofre não tem a marca');
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(20), 'Forte@2024x')), 'invalid', 'RN-08: e não entra com senha nenhuma (sem hash)');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id = pg_temp.u(20)), 0, 'RN-08: o login falho não cria linha de marca');

-- Restauração (E2.01): Carla, com a marca, é excluída e restaurada e mantém a marca e a senha.
UPDATE private.account_passwords SET must_change = true, must_change_reason = 'weak_password', must_change_since = now() WHERE auth_user_id = pg_temp.u(12);
CREATE TEMP TABLE hash0 AS SELECT password_hash FROM private.account_passwords WHERE auth_user_id = pg_temp.u(12);
SELECT pg_temp.api(15, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(12)));
SELECT is((SELECT must_change FROM private.account_passwords WHERE auth_user_id = pg_temp.u(12)), true, 'RN-08: a exclusão mantém a marca no cofre');
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(12), 'Forte@2024x')), 'invalid', 'RN-08: excluída, Carla não entra');
SELECT pg_temp.api(15, format('SELECT to_jsonb(public.restore_member(%L))', pg_temp.m(12)));
SELECT is(pg_temp.login(pg_temp.mob(12), 'Forte@2024x') -> 'must_change_password', 'true'::jsonb, 'RN-08: restaurada, entra com a mesma senha e vai para a troca obrigatória');
SELECT is((SELECT password_hash FROM private.account_passwords WHERE auth_user_id = pg_temp.u(12)), (SELECT password_hash FROM hash0), 'RN-08: o hash do cofre é o mesmo de antes da exclusão');
SELECT is((SELECT coalesce(encrypted_password, '') FROM auth.users WHERE id = pg_temp.u(12)), '', 'RN-08: a restauração devolve a conta sem senha em auth.users (o cofre é o único lugar)');

-- ===========================================================================
-- Redefinição × exclusão (em sequência; a concorrência está em e203_concurrency.sh). Hugo não tem discípulos nem células.
-- ===========================================================================
SELECT pg_temp.see_all();
CREATE TEMP TABLE tmp AS SELECT pg_temp.api(15, format('SELECT public.reset_member_password(%L)', pg_temp.m(14))) ->> 'password' AS p;
SELECT ok((SELECT p IS NOT NULL FROM tmp), 'redefinição × exclusão: Rita redefine Hugo');
SELECT is(pg_temp.api(15, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(14))) ->> 'error', NULL, 'redefinição × exclusão: Rita exclui Hugo');
SELECT is((SELECT deleted_at IS NOT NULL FROM public.members WHERE id = pg_temp.m(14)), true, 'redefinição × exclusão: Hugo está excluído');
SELECT is((SELECT row(must_change, must_change_reason, temp_expires_at IS NOT NULL)::text FROM private.account_passwords WHERE auth_user_id = pg_temp.u(14)), '(t,reset,t)',
  'redefinição × exclusão: a senha temporária e a marca ficam no cofre');
SELECT is(pg_temp.rst(15, 14) ->> 'code', 'not_found', 'redefinição × exclusão: com o cadastro excluído, a redefinição é recusada (not_found)');
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(14), (SELECT p FROM tmp))), 'invalid', 'redefinição × exclusão: excluído, não entra nem com a temporária');
SELECT pg_temp.api(15, format('SELECT to_jsonb(public.restore_member(%L))', pg_temp.m(14)));
SELECT is(pg_temp.login(pg_temp.mob(14), (SELECT p FROM tmp)) -> 'must_change_password', 'true'::jsonb, 'redefinição × exclusão: restaurado, Hugo entra com a senha temporária e vai para a troca obrigatória');

-- ===========================================================================
-- my_password_status e a sessão apagada
-- ===========================================================================
SELECT is(pg_temp.status(9), '{"must_change_password": false}'::jsonb, 'RN-16: com a sessão viva e sem a marca: false');
SELECT is(pg_temp.status(9, 5) ->> 'error', '42501', 'RN-16: com uma sessão que não existe nas claims: 42501');
SELECT is(pg_temp.status(9, 5) #>> '{detail,code}', 'session_ended', 'RN-16: o código é session_ended');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', 0), '{"must_change_password": false}'::jsonb,
  'RN-16: sem session_id nas claims o estado responde (o portão só age quando há sessão)');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', 1) ->> 'must_change_password', 'false', 'RN-16: e com a sessão de Caio viva');
-- A sessão de outra pessoa nas claims não vale.
SELECT is(pg_temp.api(9, format($q$SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t$q$), 3) ->> 'error', '42501', 'RN-16: a sessão que não é dele (inexistente) nas claims também dá 42501');

SELECT * FROM finish();

ROLLBACK;
