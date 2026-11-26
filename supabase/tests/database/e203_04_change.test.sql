-- E2.03 (PR 1, tarefa 5): as trocas da própria senha, pela RPC change_own_password (RN-10 a RN-12, RN-16, RN-17,
-- DA-8, DA-13). Spec: docs/specs/e2-03-senha.md, RN-10 a RN-13, RN-16, RN-17, DA-8, DA-13, "Contratos".
--
-- Cobre, como service_role (o papel da Edge Function):
--   - RN-10: a troca obrigatória (confirmação, igual à atual, sucesso, a temporária para de valer, tipo "Obrigatória"),
--     sem a marca é not_flagged, sem cadastro ou excluído é forbidden, sessão apagada é session_ended;
--   - RN-11: troca voluntária de Hugo, Fábio, Samuel e Ester; sessões de Caio; senha atual errada; política que não
--     conta; a marca sai na troca voluntária;
--   - RN-12: 5 erros, a 5ª já bloqueia (5 falhas e 1 bloqueio na Auditoria), tentativas durante o bloqueio não
--     registram, o login não é bloqueado, o sucesso zera a conta e não a origem, 45 falhas de login + 5 erros
--     bloqueiam a origem (DA-8, limite 50), a contagem não zera na virada da semana (janela de 15 minutos);
--   - DA-13: reenvio com a mesma sessão e o mesmo request_id; outra senha nova não vale como sucesso;
--   - entrada malformada (22023) e o contrato de cada resposta;
--   - RN-16: a troca apaga as outras sessões e mantém a que trocou;
--   - RN-17: o conteúdo dos eventos, nenhuma senha, hash ou origem em events, falha da Auditoria.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(77);

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
  SELECT coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'occurred_at' - 'changed_fields' - 'seq' - 'tx_id' - 'changes' - 'search_text' - 'actor_kind' ORDER BY e.entity_label, e.id), '[]')
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

-- Troca como o service_role: usuário _n, sessão _k, modo, atual, nova, confirmação, origem, request_id.
CREATE FUNCTION pg_temp.chg(_n int, _mode text, _cur text, _new text, _conf text,
                            _origin text DEFAULT '203.0.113.9', _req uuid DEFAULT NULL, _k int DEFAULT 1) RETURNS jsonb
LANGUAGE sql AS $$
  SELECT pg_temp.svc(format('SELECT public.change_own_password(%L, %L, %L, %L, %L, %L, %L, %L)',
    pg_temp.u(_n), pg_temp.s(_n, _k), _mode, _cur, _new, _conf, _origin, coalesce(_req, gen_random_uuid())))
$$;
CREATE FUNCTION pg_temp.cr(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(_r ->> 'result', 'ERR ' || (_r ->> 'error')) || coalesce('|' || (_r ->> 'code'), '') || coalesce('|' || (_r ->> 'field'), '') $$;
CREATE TEMP TABLE secrets (s text);
INSERT INTO secrets VALUES ('Abacate77'), ('Abacate78'), ('Caminho2024'), ('Forte@2024x'), ('Nova#Senha2025'), ('Outra#Senha2026'), ('12345678');
SELECT pg_temp.see_all();

-- ===========================================================================
-- Contrato e entrada malformada (22023, nunca conta)
-- ===========================================================================
SELECT is(pg_temp.chg(9, 'voluntary', 'Caminho2024', 'Nova#Senha2025', 'Nova#Senha2025', 'não-é-ip') ->> 'error', '22023', 'entrada: origem inválida dá 22023 (e a mensagem não leva o valor)');
SELECT is(pg_temp.svc(format('SELECT public.change_own_password(%L, %L, %L, %L, %L, %L, NULL, %L)', pg_temp.u(9), pg_temp.s(9), 'voluntary', 'Caminho2024', 'Nova#Senha2025', 'Nova#Senha2025', gen_random_uuid())) ->> 'error', '22023', 'entrada: origem ausente na voluntária dá 22023');
SELECT is(pg_temp.chg(9, 'outro', NULL, 'Nova#Senha2025', 'Nova#Senha2025') ->> 'error', '22023', 'entrada: modo desconhecido dá 22023');
SELECT is(pg_temp.svc(format('SELECT public.change_own_password(%L, %L, %L, %L, %L, %L, %L, NULL)', pg_temp.u(9), pg_temp.s(9), 'voluntary', 'Caminho2024', 'Nova#Senha2025', 'Nova#Senha2025', '203.0.113.9')) ->> 'error', '22023', 'entrada: request_id ausente dá 22023');
SELECT is(pg_temp.svc(format('SELECT public.change_own_password(NULL, %L, %L, %L, %L, %L, %L, %L)', pg_temp.s(9), 'voluntary', 'Caminho2024', 'Nova#Senha2025', 'Nova#Senha2025', '203.0.113.9', gen_random_uuid())) ->> 'error', '22023', 'entrada: conta ausente dá 22023');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', '', 'Nova#Senha2025', 'Nova#Senha2025')), 'empty_fields', 'RN-10: senha atual vazia na voluntária: empty_fields');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Caminho2024', '', '')), 'empty_fields', 'RN-10: nova e confirmação vazias: empty_fields');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'forced', NULL, 'Nova#Senha2025', '')), 'empty_fields', 'RN-10: confirmação vazia: empty_fields');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle WHERE kind IN ('password_change') AND cardinality(failures) > 0), 0, 'entrada: nada disso conta');
CREATE TEMP TABLE s0 AS SELECT pg_temp.snap() AS v;
SELECT is(pg_temp.snap(), (SELECT v FROM s0), 'entrada: nada mudou');

-- ===========================================================================
-- RN-10: a troca obrigatória de Caio, com a senha temporária
-- ===========================================================================
CREATE TEMP TABLE tmp AS SELECT pg_temp.api(7, format('SELECT public.reset_member_password(%L)', pg_temp.m(9))) ->> 'password' AS p;
INSERT INTO secrets SELECT p FROM tmp;
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(9, 1), pg_temp.u(9)), (pg_temp.s(9, 2), pg_temp.u(9));   -- a redefinição apagou as dele
SELECT pg_temp.see_all();
CREATE TEMP TABLE s1 AS SELECT pg_temp.snap() AS v;
SELECT is(pg_temp.chg(9, 'forced', NULL, 'Abacate77', 'Abacate78'), '{"result": "invalid", "code": "password_mismatch", "field": "confirmation"}'::jsonb,
  'RN-10: Abacate77 com Abacate78 na confirmação: password_mismatch no campo confirmation');
SELECT is(pg_temp.chg(9, 'forced', NULL, (SELECT p FROM tmp), (SELECT p FROM tmp)), '{"result": "invalid", "code": "password_same_as_current", "field": "new_password"}'::jsonb,
  'RN-10: a própria temporária como nova senha: password_same_as_current');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'forced', NULL, '12345678', '12345678')), 'invalid|password_weak|new_password', 'RN-13: política na troca obrigatória (12345678)');
SELECT is(pg_temp.snap(), (SELECT v FROM s1), 'RN-10: as três recusas não mudam nada (a marca, a senha, as sessões)');

-- Sessão apagada e conta sem cadastro: antes do sucesso.
SELECT is(pg_temp.cr(pg_temp.chg(9, 'forced', NULL, 'Abacate77', 'Abacate77', '203.0.113.9', NULL, 7)), 'session_ended', 'RN-16: sessão que não existe: session_ended');
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pg_temp.u(50), 'orfa@teste.invalid', now());
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(50, 1), pg_temp.u(50));
SELECT is(pg_temp.cr(pg_temp.chg(50, 'forced', NULL, 'Abacate77', 'Abacate77')), 'forbidden', 'RN-10: conta sem cadastro: forbidden');
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(18, 1), pg_temp.u(18)) ON CONFLICT DO NOTHING;
SELECT is(pg_temp.cr(pg_temp.chg(18, 'voluntary', 'Forte@2024x', 'Abacate77', 'Abacate77')), 'forbidden', 'RN-10: cadastro excluído (Nina): forbidden');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'forced', NULL, 'Abacate77', 'Abacate77', '203.0.113.9', NULL, 3)), 'session_ended',
  'RN-16: sessão de outra conta ou apagada: session_ended mesmo com a marca');

-- O sucesso.
CREATE TEMP TABLE req AS SELECT gen_random_uuid() AS id;
SELECT is(pg_temp.chg(9, 'forced', NULL, 'Abacate77', 'Abacate77', '203.0.113.9', (SELECT id FROM req)), '{"result": "ok"}'::jsonb, 'RN-10: Abacate77 nos dois campos: a senha muda');
SELECT is((SELECT must_change FROM private.account_passwords WHERE auth_user_id = pg_temp.u(9)), false, 'RN-10: a marca sai');
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(9), (SELECT p FROM tmp))), 'invalid', 'RN-10: a senha temporária deixa de funcionar');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', 'Caminho2024')), 'invalid', 'RN-10: a senha antiga também');
SELECT is(pg_temp.login('caio.lima@exemplo.com', 'Abacate77') -> 'must_change_password', 'false'::jsonb, 'RN-10: a nova entra e não tem a marca');
SELECT is((SELECT array_agg(id) FROM auth.sessions WHERE user_id = pg_temp.u(9)), ARRAY[pg_temp.s(9, 1)], 'RN-16: a sessão que trocou continua e a outra foi encerrada');
SELECT is(pg_temp.chg(9, 'forced', NULL, 'Outra#Senha2026', 'Outra#Senha2026') ->> 'result', 'not_flagged', 'RN-10: sem a marca, a troca obrigatória (sem a atual) dá not_flagged');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', 'Outra#Senha2026')), 'invalid', 'RN-10: e a senha não mudou');
-- DA-13: reenvio.
SELECT is(pg_temp.chg(9, 'forced', NULL, 'Abacate77', 'Abacate77', '203.0.113.9', (SELECT id FROM req)), '{"result": "ok", "replayed": true}'::jsonb,
  'DA-13: o mesmo reenvio (mesma sessão, mesmo request_id, mesma senha) volta ok com replayed');
SELECT is(pg_temp.chg(9, 'forced', NULL, 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.9', (SELECT id FROM req)) ->> 'result', 'not_flagged',
  'DA-13: o reenvio com outra senha nova não vale como sucesso');
SELECT is(pg_temp.chg(9, 'forced', NULL, 'Abacate77', 'Abacate77', '203.0.113.9') ->> 'result', 'not_flagged', 'DA-13: com outro request_id, o reenvio não vale');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(pg_temp.take('password_changed')) e), 1, 'DA-13: o reenvio não gera outro evento de senha alterada');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', 'Abacate77')), 'ok', 'DA-13: a senha continua a primeira');

-- ===========================================================================
-- RN-11: troca voluntária
-- ===========================================================================
SELECT pg_temp.see_all();
SELECT is(pg_temp.cr(pg_temp.chg(14, 'voluntary', 'Forte@2024x', 'Nova#Senha2025', 'Nova#Senha2025')), 'ok', 'RN-11: Hugo (sem função) troca informando a atual');
SELECT is(pg_temp.cr(pg_temp.chg(10, 'voluntary', 'Forte@2024x', 'Nova#Senha2025', 'Nova#Senha2025')), 'ok', 'RN-11: Fábio (inativo) troca');
SELECT is(pg_temp.cr(pg_temp.chg(1, 'voluntary', 'Forte@2024x', 'Nova#Senha2025', 'Nova#Senha2025')), 'ok', 'RN-11: Samuel (pastor) troca');
SELECT is(pg_temp.cr(pg_temp.chg(16, 'voluntary', 'Forte@2024x', 'Nova#Senha2025', 'Nova#Senha2025')), 'ok', 'RN-11: Ester (sem liderança) troca');
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(14), 'Nova#Senha2025')), 'ok', 'RN-11: Hugo entra com a nova');
SELECT is((SELECT array_agg(e #>> '{metadata,change_type}' ORDER BY e ->> 'entity_label') FROM jsonb_array_elements(pg_temp.take('password_changed')) e),
  ARRAY['voluntary', 'voluntary', 'voluntary', 'voluntary'], 'RN-17: eventos de senha alterada do tipo voluntary');

-- Caio com duas sessões: a do aparelho que trocou continua, a outra sai.
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(9, 2), pg_temp.u(9)) ON CONFLICT DO NOTHING;
INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked) VALUES
  ('e203-chg-1', pg_temp.u(9)::text, pg_temp.s(9, 1), false), ('e203-chg-2', pg_temp.u(9)::text, pg_temp.s(9, 2), false);
SELECT pg_temp.see_all();
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Abacate77', 'Nova#Senha2025', 'Nova#Senha2025')), 'ok', 'RN-11: Caio troca no celular informando a atual');
SELECT is((SELECT array_agg(id) FROM auth.sessions WHERE user_id = pg_temp.u(9)), ARRAY[pg_temp.s(9, 1)], 'RN-16: a sessão do celular continua, a do computador é encerrada');
SELECT is((SELECT array_agg(token::text) FROM auth.refresh_tokens WHERE user_id = pg_temp.u(9)::text), ARRAY['e203-chg-1'], 'RN-16: o refresh token da outra sessão também sai');
SELECT is((pg_temp.take('password_changed') -> 0) - 'actor_label' - 'id',
  jsonb_build_object('actor_user_id', pg_temp.u(9), 'action', 'password_changed', 'entity', 'auth', 'entity_id', pg_temp.m(9),
                     'entity_label', 'Caio Lima', 'description', 'Senha alterada', 'metadata', '{"change_type": "voluntary"}'::jsonb,
                     'success', true, 'error_reason', NULL),
  'RN-11, RN-17: "Senha alterada", autor Caio, tipo voluntary');
SELECT is(pg_temp.take('password_change_failed'), '[]'::jsonb, 'RN-11: nenhuma falha registrada nas trocas certas');

-- Atual errada, política (não conta) e mesma senha.
CREATE TEMP TABLE s2 AS SELECT pg_temp.snap() AS v;
SELECT is(pg_temp.chg(9, 'voluntary', 'errada-demais', 'Outra#Senha2026', 'Outra#Senha2026'), '{"result": "current_password_invalid"}'::jsonb,
  'RN-11: senha atual errada: current_password_invalid');
SELECT is((SELECT jsonb_build_object('reason', e #>> '{metadata,reason}', 'error_reason', e ->> 'error_reason', 'success', e -> 'success')
             FROM jsonb_array_elements(pg_temp.take('password_change_failed')) e),
  '{"reason": "current_password_invalid", "error_reason": "Senha atual incorreta", "success": false}'::jsonb,
  'RN-11, RN-17: a Auditoria registra "Falha na troca de senha" com o motivo "Senha atual incorreta"');
SELECT is((SELECT cardinality(failures) FROM private.sign_in_throttle WHERE kind = 'password_change' AND key_hash = private.sign_in_key('password_change', pg_temp.u(9)::text)),
  1, 'RN-12: o erro conta 1 na conta');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Nova#Senha2025', '12345678', '12345678')), 'invalid|password_weak|new_password', 'RN-11: 12345678 como nova: password_weak');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Nova#Senha2025', 'Nova#Senha2025', 'Nova#Senha2025')), 'invalid|password_same_as_current|new_password', 'RN-13: igual à atual');
SELECT is((SELECT cardinality(failures) FROM private.sign_in_throttle WHERE kind = 'password_change' AND key_hash = private.sign_in_key('password_change', pg_temp.u(9)::text)),
  1, 'RN-11: a política e "igual à atual" não contam para o limite (continua 1)');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', 'Nova#Senha2025')), 'ok', 'RN-11: a senha de Caio não mudou nas recusas');

-- A troca voluntária também tira a marca.
UPDATE private.account_passwords SET must_change = true, must_change_reason = 'weak_password', must_change_since = now() WHERE auth_user_id = pg_temp.u(15);
SELECT is(pg_temp.cr(pg_temp.chg(15, 'voluntary', 'Forte@2024x', 'Outra#Senha2026', 'Outra#Senha2026')), 'ok', 'RN-11: Rita (com a marca) usa a troca voluntária pela API com a atual: ok');
SELECT is((SELECT must_change FROM private.account_passwords WHERE auth_user_id = pg_temp.u(15)), false, 'RN-11: a marca sai também na troca voluntária');
SELECT is(pg_temp.take('password_changed') #>> '{0,metadata,change_type}', 'voluntary', 'RN-11: o tipo continua voluntary');

-- ===========================================================================
-- RN-12: 5 erros bloqueiam a troca (por conta), sem bloquear o login
-- ===========================================================================
DELETE FROM private.sign_in_throttle;
SELECT pg_temp.see_all();
SELECT is((SELECT array_agg(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'errada-' || n, 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.20')) ORDER BY n) FROM generate_series(1, 4) n),
  ARRAY['current_password_invalid', 'current_password_invalid', 'current_password_invalid', 'current_password_invalid'],
  'RN-12: os 4 primeiros erros recebem current_password_invalid');
SELECT is(pg_temp.chg(9, 'voluntary', 'errada-5', 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.20'),
  '{"result": "change_blocked", "retry_after_seconds": 900, "retry_after_minutes": 15}'::jsonb, 'RN-12: a 5ª já devolve change_blocked, com 15 minutos');
SELECT is((SELECT array_agg(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'errada-' || n, 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.20'))) FROM generate_series(1, 3) n),
  ARRAY['change_blocked', 'change_blocked', 'change_blocked'], 'RN-12: três tentativas durante o bloqueio recebem change_blocked');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(pg_temp.take('password_change_failed'))), 5, 'RN-17: 5 registros de "Falha na troca de senha"');
SELECT is((SELECT count(*)::int FROM public.events e WHERE e.action = 'password_change_blocked' AND e.id NOT IN (SELECT id FROM seen_events)), 1,
  'RN-17: um único "Troca de senha bloqueada por excesso de tentativas"');
SELECT is((SELECT e.metadata FROM public.events e WHERE e.action = 'password_change_blocked' AND e.id NOT IN (SELECT id FROM seen_events)),
  '{"block_minutes": 15}'::jsonb, 'RN-17: com a duração de 15 minutos');
-- 5 minutos depois (simulado): a senha certa continua barrada, com 10 minutos.
UPDATE private.sign_in_throttle SET blocked_until = now() + interval '10 minutes' WHERE kind = 'password_change';
SELECT is(pg_temp.chg(9, 'voluntary', 'Nova#Senha2025', 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.20') ->> 'retry_after_minutes', '10',
  'RN-12: 5 minutos depois, mesmo com a senha certa, "Aguarde 10 minutos" e a senha não muda');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', 'Nova#Senha2025')), 'ok', 'RN-12: o bloqueio da troca não bloqueia o login');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t'), '{"must_change_password": false}'::jsonb,
  'RN-12: a sessão continua funcionando nas outras telas (my_password_status responde)');
-- Passado o bloqueio, o sucesso zera a conta e não a origem.
UPDATE private.sign_in_throttle SET blocked_until = NULL WHERE kind = 'password_change';
UPDATE private.sign_in_throttle SET failures = ARRAY[now() - interval '2 minutes'] WHERE kind = 'origin'
   AND key_hash = private.sign_in_key('origin', 'o:' || private.sign_in_origin_key('203.0.113.20'::inet));
SELECT pg_temp.chg(9, 'voluntary', 'errada-9', 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.20');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Nova#Senha2025', 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.20')), 'ok', 'RN-12: passado o bloqueio, a senha certa troca');
SELECT is((SELECT cardinality(failures) FROM private.sign_in_throttle WHERE kind = 'password_change' AND key_hash = private.sign_in_key('password_change', pg_temp.u(9)::text)), 0,
  'RN-12: o sucesso zera a conta');
SELECT ok((SELECT cardinality(failures) >= 1 FROM private.sign_in_throttle WHERE kind = 'origin' AND key_hash = private.sign_in_key('origin', 'o:' || private.sign_in_origin_key('203.0.113.20'::inet))),
  'RN-12: o sucesso não zera a origem');

-- DA-8: 45 falhas de login e 5 erros da senha atual, da mesma origem, bloqueiam a origem (limite 50, E1.04 PR 1b).
DELETE FROM private.sign_in_throttle;
SELECT pg_temp.see_all();
SELECT pg_temp.login('ninguem' || n || '@teste.invalid', 'qualquer-' || n, '203.0.113.77') FROM generate_series(1, 45) n;
SELECT is((SELECT cardinality(failures) FROM private.sign_in_throttle WHERE kind = 'origin' AND key_hash = private.sign_in_key('origin', 'o:' || private.sign_in_origin_key('203.0.113.77'::inet))),
  45, 'DA-8: 45 falhas de login contam 45 na origem');
SELECT is((SELECT array_agg(pg_temp.cr(pg_temp.chg(n, 'voluntary', 'errada', 'Outra#Senha2026', 'Outra#Senha2026', '203.0.113.77')) ORDER BY n) FROM unnest(ARRAY[1, 2, 3, 4, 14]) n),
  ARRAY['current_password_invalid', 'current_password_invalid', 'current_password_invalid', 'current_password_invalid', 'change_blocked'],
  'DA-8: o 5º erro (de contas diferentes) fecha os 50 e a origem é bloqueada na hora');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', 'Outra#Senha2026', '203.0.113.77')), 'locked', 'DA-8: a origem bloqueada recebe locked no login');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Outra#Senha2026', 'Abacate77', 'Abacate77', '203.0.113.77')), 'change_blocked', 'DA-8: e a próxima troca voluntária dessa origem recebe change_blocked');
SELECT is(pg_temp.cr(pg_temp.chg(9, 'voluntary', 'Outra#Senha2026', 'Abacate77', 'Abacate77', '203.0.113.78')), 'ok', 'DA-8: outra origem não é afetada');
SELECT ok(EXISTS (SELECT 1 FROM public.events e WHERE e.action = 'login_blocked' AND e.metadata ->> 'block_scope' = 'origin' AND e.entity_id IS NULL
                   AND e.id NOT IN (SELECT id FROM seen_events)), 'DA-8: o bloqueio da origem sai como login_blocked, sem cadastro');

-- ===========================================================================
-- RN-17: a Auditoria não tem senha, hash nem origem
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.events e, secrets s WHERE e::text LIKE '%' || s.s || '%'), 0, 'RN-17: nenhuma senha (atual, nova, temporária) aparece em qualquer evento');
SELECT is((SELECT count(*)::int FROM public.events e WHERE e::text LIKE '%$2a$%'), 0, 'RN-17: nenhum evento contém hash');
SELECT is((SELECT count(*)::int FROM public.events e WHERE e::text ~ '203\.0\.113\.'), 0, 'RN-17: nenhum evento contém a origem');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(count(*)) FROM public.events'), '0'::jsonb, 'RN-17: Caio (sem "Visualizar Auditoria") não lê esses eventos pela API');

-- Falha da Auditoria: a troca volta inteira; a recusa (senha atual errada) responde igual.
DELETE FROM private.sign_in_throttle;
ALTER TABLE public.events ADD CONSTRAINT e203_force_fail_changed CHECK (action <> 'password_changed') NOT VALID;
ALTER TABLE public.events ADD CONSTRAINT e203_force_fail_failed CHECK (action <> 'password_change_failed') NOT VALID;
CREATE TEMP TABLE s5 AS SELECT pg_temp.snap() AS v;
SELECT is(pg_temp.chg(9, 'voluntary', 'Abacate77', 'Outra#Senha2026', 'Outra#Senha2026') ->> 'error', '23514', 'RN-17: com a Auditoria falhando, a troca dá erro');
SELECT is(pg_temp.snap(), (SELECT v FROM s5), 'RN-17: e a senha, a marca e as sessões ficam como estavam');
SELECT is(pg_temp.chg(9, 'voluntary', 'errada', 'Outra#Senha2026', 'Outra#Senha2026') ->> 'result', 'current_password_invalid',
  'RN-17: a recusa por senha atual errada responde igual com a Auditoria falhando');
ALTER TABLE public.events DROP CONSTRAINT e203_force_fail_changed;
ALTER TABLE public.events DROP CONSTRAINT e203_force_fail_failed;

SELECT * FROM finish();

ROLLBACK;
