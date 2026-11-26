-- E2.03 (PR 1, tarefa 5): a redefinição de senha pela API (RN-01 a RN-06, RN-16 e RN-17, DA-1 a DA-3).
-- Spec: docs/specs/e2-03-senha.md, RN-01 a RN-06, RN-16, RN-17, DA-1, DA-2, "Contratos".
--
-- Cobre public.reset_member_password como o usuário (papel authenticated, com session_id nas claims):
--   - RN-01: quem não tem a permissão (Gerente só com manage_roles, Caio, Hugo sem função), a função
--     "Apoio" (Carla, sem edit_member), a coluna password_reset_status da members_view;
--   - RN-02: cada pessoa da massa (Caio, Fábio inativo, Beatriz, Pedro, Olga, Diego, Rita, Samuel e Magda,
--     Ester, Nina excluída, Lauro sem conta, a própria Rita, a ordem Caio contra Nina), DA-1, DA-2,
--     o motivo de cada recusa na Auditoria e "nada muda" em cada recusa;
--   - RN-03: 1.000 senhas de generate_temporary_password, o formato, a validade e o login com o celular,
--     o CPF e o e-mail;
--   - RN-04: a senha antiga para na hora, o bloqueio do login continua, vale a última, o ponto do E3.02;
--   - RN-05: o prazo da temporária (antes e depois, motivo e contagem);
--   - RN-06: 20 aceitas e a 21ª com 8 minutos, as recusas não contam, 25 em fila dão 20;
--   - RN-16: a redefinição apaga todas as sessões do alvo e mantém as de quem redefiniu;
--   - RN-17: o conteúdo dos eventos, nenhuma senha, hash ou origem na Auditoria, falha da Auditoria.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- PR 4 (portão ligado): o alvo redefinido volta a agir só depois de "trocar a senha" (pg_temp.changed), e a
-- redefinição com a sessão apagada ou com a marca é recusada pelo portão, sem registro de recusa.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(108);

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

-- Segredos devolvidos pela API (para provar que não vão para a Auditoria).
CREATE TEMP TABLE secrets (s text);
-- PR 4 (portão ligado): depois de redefinido, o alvo tem a marca e nenhuma sessão, e a API o recusa.
-- "Concluiu a troca obrigatória" para quem volta a agir no teste: tira a marca e abre a sessão 1 de novo.
CREATE FUNCTION pg_temp.changed(_n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE private.account_passwords
     SET must_change = false, must_change_reason = NULL, must_change_since = NULL, temp_expires_at = NULL
   WHERE auth_user_id = pg_temp.u(_n);
  INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(_n, 1), pg_temp.u(_n)) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION pg_temp.keep(_r jsonb) RETURNS jsonb LANGUAGE sql AS
$$ WITH x AS (INSERT INTO secrets SELECT _r ->> 'password' WHERE _r ->> 'password' IS NOT NULL) SELECT _r $$;

-- ===========================================================================
-- RN-01: quem não tem "Redefinir Senha de Membros"
-- ===========================================================================
SELECT is(pg_temp.take('password_reset_refused'), '[]'::jsonb, 'massa: nenhuma recusa registrada antes dos testes');
CREATE TEMP TABLE s0 AS SELECT pg_temp.snap() AS v;

SELECT is(pg_temp.rst(21, 9),
  '{"result": "refused", "code": "no_permission", "message": "Você não tem permissão para redefinir senhas."}'::jsonb,
  'RN-01: função com manage_roles e sem change_member_password é recusada, com o texto do PO');
SELECT is(pg_temp.rst(9, 10) - 'message', '{"result": "refused", "code": "no_permission"}'::jsonb,
  'RN-01: Caio (Membro) tenta redefinir Fábio: no_permission');
SELECT is(pg_temp.rst(14, 9) ->> 'code', 'no_permission', 'RN-01: Hugo (sem função) também recebe no_permission');
SELECT is(pg_temp.snap(), (SELECT v FROM s0), 'RN-01: as três recusas não mudam nada (cofre, contas, sessões, limites, cadastros)');
SELECT is((SELECT array_agg(e ->> 'error_reason') FROM jsonb_array_elements(pg_temp.take('password_reset_refused')) e),
  ARRAY['Sem permissão', 'Sem permissão', 'Sem permissão'],
  'RN-01: a Auditoria registra cada recusa com o motivo "Sem permissão"');
SELECT pg_temp.rst(9, 10);
SELECT is((pg_temp.take('password_reset_refused') -> 0) - 'actor_label',
  jsonb_build_object('actor_user_id', pg_temp.u(9), 'action', 'password_reset_refused', 'entity', 'auth',
                     'entity_id', pg_temp.m(10), 'entity_label', 'Fábio E203', 'description', 'Redefinição de senha recusada',
                     'metadata', '{"reason": "no_permission"}'::jsonb, 'success', false, 'error_reason', 'Sem permissão'),
  'RN-01, RN-17: evento da recusa (autor Caio, alvo Fábio, reason no_permission, success false)');
SELECT pg_temp.see_all();

-- A coluna da lista de Membros (AQ-2): o que cada um vê na members_view.
SELECT is(pg_temp.api(7, format('SELECT to_jsonb(password_reset_status) FROM public.members_view WHERE id = %L', pg_temp.m(9))),
  '"allowed"'::jsonb, 'RN-01: André vê "Redefinir senha" liberada para Caio (allowed)');
SELECT is(pg_temp.api(7, format('SELECT to_jsonb(password_reset_status) FROM public.members_view WHERE id = %L', pg_temp.m(7))),
  '"self"'::jsonb, 'RN-01: na linha dele mesmo, self');
SELECT is(pg_temp.api(7, format('SELECT to_jsonb(password_reset_status) FROM public.members_view WHERE id = %L', pg_temp.m(17))),
  '"role_not_covered"'::jsonb, 'RN-02: Olga (Administrador) aparece para André como role_not_covered');
SELECT is(pg_temp.api(7, format('SELECT to_jsonb(password_reset_status) FROM public.members_view WHERE id = %L', pg_temp.m(19))),
  '"no_account"'::jsonb, 'RN-02: Lauro (sem conta) aparece como no_account');
SELECT is(pg_temp.api(9, format('SELECT to_jsonb(password_reset_status) FROM public.members_view WHERE id = %L', pg_temp.m(9))),
  NULL, 'RN-01: Caio (sem a permissão) não vê a coluna preenchida (NULL)');
SELECT is((SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'members_view'
            ORDER BY ordinal_position DESC LIMIT 1 OFFSET 6), 'password_reset_status', 'AQ-2: password_reset_status é a última coluna da members_view antes das quatro da autoria do E2.05 e das duas do E2.07');

-- Carla, com a função Apoio (Membro + change_member_password, sem edit_member), redefine Caio.
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(12, 9))), 'ok', 'RN-01: Carla (Apoio, sem edit_member) redefine Caio: aceita');

-- ===========================================================================
-- RN-02: o alcance, a função, o estado do alvo e a ordem das verificações
-- ===========================================================================
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(7, 9))), 'ok', 'RN-02: André redefine Caio: aceita');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(7, 10))), 'ok', 'RN-02: André redefine Fábio (inativo): aceita');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(7, 8))), 'ok', 'RN-02: André redefine Beatriz (cônjuge, de outro ministério): aceita');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(7, 3))), 'ok', 'RN-02: André redefine Pedro (o G12 dele, Líder): aceita');
SELECT is(pg_temp.take('password_reset') -> 0 ->> 'description', 'Senha redefinida', 'RN-17: cada redefinição aceita vira o evento "Senha redefinida"');
SELECT pg_temp.changed(3);   -- Pedro, redefinido por André, troca a senha e volta a agir
SELECT pg_temp.see_all();

CREATE TEMP TABLE s1 AS SELECT pg_temp.snap() AS v;
SELECT is(pg_temp.rst(7, 17),
  '{"result": "refused", "code": "role_not_covered", "message": "Você não tem permissão para redefinir a senha deste membro."}'::jsonb,
  'RN-02: André tenta redefinir Olga (Administrador): role_not_covered');
SELECT is(pg_temp.rst(13, 15) ->> 'code', 'role_not_covered', 'RN-02: Diego (Líder, outro ministério) tenta Rita (Administrador, visível a ele): role_not_covered');
SELECT is(pg_temp.rst(13, 9),
  '{"result": "refused", "code": "not_found", "message": "Este cadastro não existe ou já foi excluído."}'::jsonb,
  'RN-02: Diego tenta Caio (fora do que ele vê): not_found');
SELECT is(pg_temp.snap(), (SELECT v FROM s1), 'RN-02: as recusas por função e por alcance não mudam nada');
SELECT is((SELECT array_agg(e ->> 'error_reason' ORDER BY e ->> 'error_reason') FROM jsonb_array_elements(pg_temp.take('password_reset_refused')) e),
  ARRAY['Fora do que a pessoa vê', 'Função não coberta', 'Função não coberta'], 'RN-02: motivos na Auditoria: "Fora do que a pessoa vê" e (duas vezes) "Função não coberta"');

SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(15, 17))), 'ok', 'RN-02: Rita (Administrador) redefine Olga (Administrador): aceita');
SELECT is(pg_temp.rst(3, 1) ->> 'code', 'not_found', 'RN-02: Pedro não vê os pastores: tentar Samuel dá not_found');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(2, 1))), 'ok', 'RN-02: Magda (cônjuge de Samuel, Líder) redefine Samuel: aceita');
SELECT pg_temp.changed(1);
SELECT is(pg_temp.rst(1, 16) ->> 'code', 'not_found', 'RN-02: Samuel tenta Ester (sem liderança): not_found');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(15, 16))), 'ok', 'RN-02: Rita redefine Ester: aceita');

-- Nina (excluída, conta suspensa): DA-2.
CREATE TEMP TABLE s2 AS SELECT pg_temp.snap() AS v;
SELECT pg_temp.see_all();
SELECT is(pg_temp.rst(7, 18),
  '{"result": "refused", "code": "not_found", "message": "Este cadastro não existe ou já foi excluído."}'::jsonb,
  'RN-02, DA-2: André tenta Nina (excluída): not_found');
SELECT is(pg_temp.rst(15, 18) ->> 'code', 'not_found', 'RN-02, DA-2: Rita também recebe not_found para Nina');
SELECT is(pg_temp.snap(), (SELECT v FROM s2), 'RN-02: a conta suspensa e o cofre de Nina não mudam');
SELECT is((SELECT array_agg(e ->> 'error_reason') FROM jsonb_array_elements(pg_temp.take('password_reset_refused')) e),
  ARRAY['Cadastro excluído', 'Cadastro excluído'], 'RN-02, DA-2: a Auditoria registra o motivo "Cadastro excluído" (duas vezes)');

SELECT is(pg_temp.rst(7, 19),
  '{"result": "refused", "code": "no_account", "message": "Este membro não tem acesso ao sistema."}'::jsonb,
  'RN-02: André tenta Lauro (sem conta): no_account');
SELECT is((SELECT count(*)::int FROM auth.users WHERE id::text LIKE 'a2030000%'), 20, 'RN-02: nenhuma conta foi criada para Lauro');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id::text LIKE 'a2030000%'), 20, 'RN-02: nenhuma linha de cofre foi criada para Lauro');
SELECT is(pg_temp.take('password_reset_refused') -> 0 ->> 'error_reason', 'Sem conta de acesso', 'RN-02: motivo "Sem conta de acesso" na Auditoria');

SELECT is(pg_temp.rst(15, 15),
  jsonb_build_object('result', 'refused', 'code', 'self', 'message', 'Para trocar a sua senha, use "Alterar minha senha".'),
  'RN-02: Rita tenta redefinir a própria senha: self, com o texto do PO');
SELECT is(pg_temp.take('password_reset_refused') -> 0 ->> 'error_reason', 'Própria senha', 'RN-02: motivo "Própria senha" na Auditoria');
SELECT pg_temp.changed(9);
SELECT is(pg_temp.rst(9, 18) ->> 'code', 'no_permission', 'RN-02: a ordem: Caio contra Nina (excluída) recebe no_permission, a permissão vem primeiro');

-- DA-1: id que não existe ou nulo.
SELECT pg_temp.see_all();
SELECT is(pg_temp.rst(15, 99) ->> 'code', 'not_found', 'DA-1: id inexistente dá not_found');
SELECT is(pg_temp.api(15, 'SELECT public.reset_member_password(NULL)') ->> 'code', 'not_found', 'DA-1: id nulo dá not_found');
SELECT is((SELECT array_agg(coalesce(e ->> 'entity_id', 'nulo')) FROM jsonb_array_elements(pg_temp.take('password_reset_refused')) e),
  ARRAY['nulo', 'nulo'], 'DA-1: a Auditoria não ganha um alvo que não existe (entity_id nulo)');

-- A restauração de Nina (E2.01) devolve a conta, e ela entra com a mesma senha de antes.
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(18), 'Forte@2024x')), 'invalid', 'RN-02: Nina excluída não entra');
SELECT pg_temp.api(15, format('SELECT to_jsonb(public.restore_member(%L))', pg_temp.m(18)));
SELECT is(pg_temp.lres(pg_temp.login(pg_temp.mob(18), 'Forte@2024x')), 'ok', 'RN-02: restaurada, Nina entra com a mesma senha de antes');

-- ===========================================================================
-- RN-03: a senha temporária
-- ===========================================================================
CREATE TEMP TABLE gen AS
  SELECT g, private.generate_temporary_password('52998224725', '51988887777', '1990-03-15', 'caio.lima@exemplo.com') AS p
    FROM generate_series(1, 1000) g;
SELECT is((SELECT count(*)::int FROM gen), 1000, 'RN-03: 1.000 senhas geradas');
SELECT is((SELECT count(*)::int FROM gen WHERE p ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{8}$'), 1000,
  'RN-03: todas têm 8 caracteres, só minúsculas e números, sem 0, 1, i, l e o');
SELECT is((SELECT count(*)::int FROM gen WHERE private.password_policy_violation(p, '52998224725', '51988887777', '1990-03-15', 'caio.lima@exemplo.com') IS NOT NULL), 0,
  'RN-03: todas atendem à política (RN-13)');
SELECT is((SELECT count(DISTINCT p)::int FROM gen), 1000, 'RN-03: nenhuma se repete');

CREATE TEMP TABLE r_caio AS SELECT pg_temp.keep(pg_temp.rst(7, 9)) AS r;
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys((SELECT r FROM r_caio)) k),
  ARRAY['expires_at', 'password', 'reset_at', 'result'], 'RN-03: o ok traz result, password, expires_at e reset_at');
SELECT ok((SELECT r ->> 'password' ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{8}$' FROM r_caio), 'RN-03: a senha devolvida tem o formato');
SELECT ok((SELECT (r ->> 'expires_at')::timestamptz BETWEEN now() + interval '167 hours 59 minutes' AND now() + interval '168 hours 1 minute' FROM r_caio),
  'RN-05: a validade é de 168 horas (7 dias) a partir da redefinição');
SELECT is((SELECT must_change_reason FROM private.account_passwords WHERE auth_user_id = pg_temp.u(9)), 'reset', 'RN-03: a marca "reset" fica no cofre');
SELECT ok((SELECT temp_expires_at = (r ->> 'expires_at')::timestamptz FROM private.account_passwords p, r_caio WHERE p.auth_user_id = pg_temp.u(9)),
  'RN-05: temp_expires_at é a validade devolvida');
-- Caio entra com o celular, o CPF e o e-mail e a temporária, e vai para a troca obrigatória.
SELECT is(pg_temp.login('(51) 98888-7777', (SELECT r ->> 'password' FROM r_caio)) -> 'must_change_password', 'true'::jsonb,
  'RN-03: Caio entra com o celular e a senha temporária e vai para a troca obrigatória');
SELECT is(pg_temp.login('529.982.247-25', (SELECT r ->> 'password' FROM r_caio)) ->> 'result', 'ok', 'RN-03: entra com o CPF');
SELECT is(pg_temp.login('caio.lima@exemplo.com', (SELECT r ->> 'password' FROM r_caio)) ->> 'result', 'ok', 'RN-03: entra com o e-mail');
SELECT ok(NOT EXISTS (SELECT 1 FROM private.sign_in_throttle t WHERE t.kind = 'identifier' AND cardinality(t.failures) > 0),
  'RN-03: entrar com a temporária (colada inteira) pelos três identificadores não gasta tentativa');
-- A senha só aparece uma vez: nenhum lugar acessível guarda a senha em claro.
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE password_hash = (SELECT r ->> 'password' FROM r_caio)), 0,
  'RN-03: o cofre guarda só o hash, nunca a senha');
SELECT ok((SELECT password_hash ~ '^\$2a\$10\$' FROM private.account_passwords WHERE auth_user_id = pg_temp.u(9)), 'RN-03: hash bcrypt $2a$ de custo 10');

-- ===========================================================================
-- RN-04: a senha antiga para na hora
-- ===========================================================================
SELECT is(pg_temp.lres(pg_temp.login('(51) 98888-7777', 'Caminho2024')), 'invalid', 'RN-04: Caminho2024 deixa de funcionar depois da redefinição (mensagem única)');
SELECT is((SELECT row(name, role_id, is_active, deleted_at, leader_id)::text FROM public.members WHERE id = pg_temp.m(9)),
  (SELECT row('Caio Lima', pg_temp.role('Membro'), true, NULL::timestamptz, pg_temp.m(7))::text), 'RN-04: o cadastro, a função e a situação de Caio continuam iguais');

-- Duas redefinições seguidas: vale a última.
SELECT pg_temp.see_all();
CREATE TEMP TABLE r_a AS SELECT pg_temp.keep(pg_temp.rst(7, 9)) AS r;
CREATE TEMP TABLE r_b AS SELECT pg_temp.keep(pg_temp.rst(3, 9)) AS r;
SELECT is(pg_temp.lres(pg_temp.login('(51) 98888-7777', (SELECT r ->> 'password' FROM r_a))), 'invalid', 'RN-04: a senha gerada para André não funciona mais depois da de Pedro');
SELECT is(pg_temp.lres(pg_temp.login('(51) 98888-7777', (SELECT r ->> 'password' FROM r_b))), 'ok', 'RN-04: a de Pedro funciona');
SELECT is((SELECT array_agg(e ->> 'actor_user_id' ORDER BY e ->> 'actor_user_id') FROM jsonb_array_elements(pg_temp.take('password_reset')) e
            WHERE e ->> 'entity_id' = pg_temp.m(9)::text),
  ARRAY[pg_temp.u(3)::text, pg_temp.u(7)::text], 'RN-04: a Auditoria tem as duas redefinições (André e Pedro)');

-- O bloqueio do login continua (E1.04): 5 falhas bloqueiam a identificação do celular.
SELECT pg_temp.login('51988887777', 'errada-' || n) FROM generate_series(1, 5) n;
SELECT is(pg_temp.lres(pg_temp.login('51988887777', (SELECT r ->> 'password' FROM r_b))), 'locked', 'RN-04: com o login bloqueado, nem a temporária entra');
CREATE TEMP TABLE r_c AS SELECT pg_temp.keep(pg_temp.rst(7, 9)) AS r;
SELECT is(pg_temp.lres(pg_temp.login('51988887777', (SELECT r ->> 'password' FROM r_c))), 'locked', 'RN-04: redefinir não desbloqueia o login: continua locked');
SELECT is(pg_temp.lres(pg_temp.login('caio.lima@exemplo.com', (SELECT r ->> 'password' FROM r_c))), 'ok', 'RN-04: outra identificação (e-mail) não está bloqueada e entra');
UPDATE private.sign_in_throttle SET blocked_until = now() - interval '1 second' WHERE kind = 'identifier' AND blocked_until IS NOT NULL;
SELECT is(pg_temp.lres(pg_temp.login('51988887777', (SELECT r ->> 'password' FROM r_c))), 'ok', 'RN-04: passado o bloqueio, entra com a senha temporária');

-- O ponto do E3.02: a redefinição chama private.discard_legacy_credential (aqui, uma versão de teste).
CREATE TEMP TABLE legacy_calls (member_id uuid);
CREATE OR REPLACE FUNCTION private.discard_legacy_credential(_member_id uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$ BEGIN INSERT INTO pg_temp.legacy_calls VALUES (_member_id); END $$;
SELECT pg_temp.rst(7, 9);
SELECT is((SELECT array_agg(member_id) FROM legacy_calls), ARRAY[pg_temp.m(9)], 'RN-04: a redefinição chama discard_legacy_credential com o membro do alvo');

-- ===========================================================================
-- RN-05: o prazo da temporária
-- ===========================================================================
CREATE TEMP TABLE r_d AS SELECT pg_temp.keep(pg_temp.rst(7, 9)) AS r;
DELETE FROM private.sign_in_throttle WHERE kind IN ('identifier', 'origin');
SELECT pg_temp.see_all();
UPDATE private.account_passwords SET temp_expires_at = now() + interval '1 minute' WHERE auth_user_id = pg_temp.u(9);
SELECT is(pg_temp.login('51988887777', (SELECT r ->> 'password' FROM r_d)) -> 'must_change_password', 'true'::jsonb,
  'RN-05: um minuto antes do prazo a temporária entra e vai para a troca obrigatória');
UPDATE private.account_passwords SET temp_expires_at = now() - interval '1 minute' WHERE auth_user_id = pg_temp.u(9);
SELECT is(pg_temp.lres(pg_temp.login('51988887777', (SELECT r ->> 'password' FROM r_d))), 'invalid', 'RN-05: um minuto depois do prazo, mensagem única');
SELECT is((SELECT jsonb_build_object('reason', e #>> '{metadata,reason}', 'error_reason', e ->> 'error_reason', 'action', e ->> 'action')
             FROM jsonb_array_elements(pg_temp.take('login_failed')) e),
  '{"reason": "temp_password_expired", "error_reason": "Senha temporária vencida", "action": "login_failed"}'::jsonb,
  'RN-05: a Auditoria registra "Falha no login" com o motivo "Senha temporária vencida"');
SELECT is((SELECT max(cardinality(failures)) FROM private.sign_in_throttle WHERE kind = 'identifier'), 1, 'RN-05: a tentativa vencida conta para o limite do login');
SELECT is(pg_temp.lres(pg_temp.login('51988887777', 'outra-qualquer-senha')), 'invalid', 'RN-05: depois do prazo, outra senha qualquer');
SELECT is((SELECT e #>> '{metadata,reason}' FROM jsonb_array_elements(pg_temp.take('login_failed')) e), 'wrong_password',
  'RN-05: com outra senha o motivo é "Senha incorreta" (wrong_password)');
-- A senha inicial não vence (temp_expires_at nulo): conta com marca initial entra "60 dias depois".
UPDATE private.account_passwords SET must_change = true, must_change_reason = 'initial', must_change_since = now() - interval '60 days',
       temp_expires_at = NULL, password_hash = extensions.crypt('Inicial#2024', extensions.gen_salt('bf', 4)) WHERE auth_user_id = pg_temp.u(10);
SELECT is(pg_temp.login(pg_temp.mob(10), 'Inicial#2024') -> 'must_change_password', 'true'::jsonb, 'RN-07: a senha inicial não vence (marca initial sem validade) e leva à troca obrigatória');

-- ===========================================================================
-- RN-06: no máximo 20 redefinições aceitas por hora, por quem redefine
-- ===========================================================================
DELETE FROM private.sign_in_throttle WHERE kind = 'password_reset';
-- Pedro com 20 aceitas, a mais antiga há 52 minutos.
SELECT private.throttle_lock('password_reset', pg_temp.m(3)::text, interval '60 minutes');
UPDATE private.sign_in_throttle
   SET failures = ARRAY[clock_timestamp() - interval '52 minutes'] || ARRAY(SELECT clock_timestamp() - (g || ' minutes')::interval FROM generate_series(19, 1, -1) g),
       expires_at = clock_timestamp() + interval '60 minutes'
 WHERE kind = 'password_reset' AND key_hash = private.sign_in_key('password_reset', pg_temp.m(3)::text);
CREATE TEMP TABLE s3 AS SELECT pg_temp.snap() AS v;
SELECT pg_temp.see_all();
SELECT is(pg_temp.rst(3, 9),
  '{"result": "refused", "code": "rate_limited", "retry_after_minutes": 8, "message": "Você redefiniu muitas senhas na última hora. Aguarde 8 minutos e tente de novo."}'::jsonb,
  'RN-06: a 21ª (a mais antiga há 52 minutos) recebe rate_limited com 8 minutos');
SELECT is(pg_temp.snap(), (SELECT v FROM s3), 'RN-06: a recusa por limite não muda nada');
SELECT is(pg_temp.take('password_reset_refused') -> 0 ->> 'error_reason', 'Limite de redefinições', 'RN-06: a Auditoria registra o motivo "Limite de redefinições"');

-- 19 aceitas e 5 recusadas na última hora: mais uma é aceita (as recusas não contam).
UPDATE private.sign_in_throttle SET failures = ARRAY(SELECT clock_timestamp() - (g || ' minutes')::interval FROM generate_series(19, 1, -1) g)
 WHERE kind = 'password_reset' AND key_hash = private.sign_in_key('password_reset', pg_temp.m(3)::text);
SELECT pg_temp.rst(3, 17) FROM generate_series(1, 5);   -- Pedro contra Olga (Administrador): recusas
SELECT is((SELECT cardinality(failures) FROM private.sign_in_throttle WHERE kind = 'password_reset'
            AND key_hash = private.sign_in_key('password_reset', pg_temp.m(3)::text)), 19, 'RN-06: as 5 recusas não entraram na contagem');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(3, 9))), 'ok', 'RN-06: a 20ª aceita passa');
SELECT is(pg_temp.rst(3, 9) ->> 'code', 'rate_limited', 'RN-06: a seguinte já é recusada');

-- 25 redefinições em fila: exatamente 20 aceitas.
DELETE FROM private.sign_in_throttle WHERE kind = 'password_reset';
CREATE TEMP TABLE rr AS SELECT g, pg_temp.rc(pg_temp.keep(pg_temp.rst(3, 9))) AS c FROM generate_series(1, 25) g;
SELECT is((SELECT array_agg(c ORDER BY g) FROM rr),
  (SELECT array_agg('ok'::text ORDER BY g) FROM generate_series(1, 20) g) || (SELECT array_agg('rate_limited'::text ORDER BY g) FROM generate_series(21, 25) g),
  'RN-06: 25 redefinições de Pedro em sequência: 20 aceitas e 5 rate_limited');
-- A janela é por pessoa: André não é afetado pelo limite de Pedro.
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(7, 9))), 'ok', 'RN-06: o limite é de quem redefine (André segue livre)');

-- ===========================================================================
-- RN-16: a redefinição encerra todas as sessões do alvo, e só as dele
-- ===========================================================================
DELETE FROM private.sign_in_throttle WHERE kind = 'password_reset';
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(9, 1), pg_temp.u(9)) ON CONFLICT DO NOTHING;
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(9, 2), pg_temp.u(9)) ON CONFLICT DO NOTHING;
INSERT INTO auth.refresh_tokens (token, user_id, session_id, revoked)
  VALUES ('e203-rt-caio-1', pg_temp.u(9)::text, pg_temp.s(9, 1), false), ('e203-rt-caio-2', pg_temp.u(9)::text, pg_temp.s(9, 2), false),
         ('e203-rt-andre', pg_temp.u(7)::text, pg_temp.s(7, 1), false);
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(9)), 2, 'RN-16: Caio tem duas sessões (celular e computador)');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', 2), '{"must_change_password": true}'::jsonb,
  'RN-16: antes da redefinição, my_password_status com a sessão dele responde (a marca da redefinição anterior está nela)');
SELECT is(pg_temp.rc(pg_temp.keep(pg_temp.rst(7, 9))), 'ok', 'RN-16: André redefine Caio de novo');
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(9)), 0, 'RN-16: as duas sessões de Caio foram apagadas');
SELECT is((SELECT count(*)::int FROM auth.refresh_tokens WHERE user_id = pg_temp.u(9)::text), 0, 'RN-16: os refresh tokens de Caio foram apagados');
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(7)), 1, 'RN-16: a sessão de André continua');
SELECT is((SELECT count(*)::int FROM auth.refresh_tokens WHERE user_id = pg_temp.u(7)::text), 1, 'RN-16: o refresh token de André continua');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', 2) ->> 'error', '42501',
  'RN-16: my_password_status com a sessão apagada nas claims: 42501');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', 2) #>> '{detail,code}', 'session_ended',
  'RN-16: o código é session_ended');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(t) FROM (SELECT * FROM public.my_password_status()) t', 0) ->> 'must_change_password', 'true',
  'RN-16: sem session_id nas claims (token de função, sem sessão) a consulta responde');
-- Portão (PR 4): com a sessão apagada, Caio não chega à redefinição (session_ended, antes da permissão);
-- com uma sessão viva e a marca, recebe password_change_required. Nada é registrado como recusa.
SELECT pg_temp.see_all();
SELECT is(pg_temp.api(9, format('SELECT public.reset_member_password(%L)', pg_temp.m(10)), 2) #>> '{detail,code}', 'session_ended',
  'RN-16 (portão): a redefinição com a sessão apagada dá session_ended');
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(9, 3), pg_temp.u(9));
SELECT is(pg_temp.api(9, format('SELECT public.reset_member_password(%L)', pg_temp.m(10)), 3) #>> '{detail,code}', 'password_change_required',
  'RN-09 (portão): com a marca, a redefinição dá password_change_required');
SELECT is(pg_temp.take('password_reset_refused'), '[]'::jsonb, 'RN-09/RN-16: o portão recusa antes de qualquer registro de recusa');

-- ===========================================================================
-- RN-17: a Auditoria
-- ===========================================================================
SELECT pg_temp.see_all();
CREATE TEMP TABLE r_e AS SELECT pg_temp.keep(pg_temp.rst(7, 9)) AS r;
SELECT is((pg_temp.take('password_reset') -> 0) - 'actor_label' - 'metadata',
  jsonb_build_object('actor_user_id', pg_temp.u(7), 'action', 'password_reset', 'entity', 'auth', 'entity_id', pg_temp.m(9),
                     'entity_label', 'Caio Lima', 'description', 'Senha redefinida', 'success', true, 'error_reason', NULL),
  'RN-17: "Senha redefinida", com André como autor e o cadastro de Caio');
SELECT is((SELECT array_agg(k ORDER BY k) FROM (SELECT jsonb_object_keys(e.metadata) k FROM public.events e
            WHERE e.action = 'password_reset' AND e.entity_id = pg_temp.m(9) ORDER BY e.occurred_at DESC, e.id LIMIT 1) x),
  ARRAY['valid_until'], 'RN-17: o metadata da redefinição só tem a validade (valid_until)');
SELECT is((SELECT count(*)::int FROM public.events e, secrets s WHERE e::text LIKE '%' || s.s || '%'), 0,
  'RN-17: nenhuma senha temporária devolvida pela API aparece em qualquer evento');
SELECT is((SELECT count(*)::int FROM public.events e WHERE e::text LIKE '%$2a$%' OR e::text LIKE '%Caminho2024%' OR e::text LIKE '%Forte@2024x%'), 0,
  'RN-17: nenhum evento contém hash, a senha antiga ou a senha da massa');
SELECT is((SELECT count(*)::int FROM public.events e WHERE e::text ~ '198\.18\.'), 0, 'RN-17: nenhum evento de redefinição contém a origem');
SELECT pg_temp.changed(9);
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(count(*)) FROM public.events'), '0'::jsonb, 'RN-17: Caio (sem "Visualizar Auditoria") não lê eventos pela API');
SELECT ok((pg_temp.api(2, 'SELECT to_jsonb(count(*)) FROM public.events') = '0'::jsonb), 'RN-17: nem a Líder Magda');

-- Falha forçada na gravação da Auditoria: a redefinição volta inteira; a recusa responde igual.
ALTER TABLE public.events ADD CONSTRAINT e203_force_fail_reset CHECK (action <> 'password_reset') NOT VALID;
ALTER TABLE public.events ADD CONSTRAINT e203_force_fail_refused CHECK (action <> 'password_reset_refused') NOT VALID;
CREATE TEMP TABLE s4 AS SELECT pg_temp.snap() AS v;
SELECT is(pg_temp.rst(7, 9) ->> 'error', '23514', 'RN-17: com a Auditoria falhando, a redefinição dá erro (a tela mostra a falha de conexão)');
SELECT is(pg_temp.snap(), (SELECT v FROM s4), 'RN-17: a senha não muda, nenhuma temporária é gerada e as sessões continuam (tudo volta)');
SELECT is(pg_temp.rst(9, 10) ->> 'code', 'no_permission', 'RN-17: a recusa responde igual mesmo com a Auditoria falhando');
ALTER TABLE public.events DROP CONSTRAINT e203_force_fail_reset;
ALTER TABLE public.events DROP CONSTRAINT e203_force_fail_refused;

SELECT * FROM finish();

ROLLBACK;
