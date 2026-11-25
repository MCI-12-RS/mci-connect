-- E2.04 (PR 2): as regras do cadastro de membro pela API (INSERT e UPDATE em members), com código,
-- campo e mensagem (AQ-1), a ordem da DA-11 e a leitura técnica 1 (permissão antes de regra).
-- Spec: docs/specs/e2-04-validacoes-membro.md, RN-01 a RN-19, DA-2, DA-4, DA-8, DA-11, DT-07,
-- DT-08, DT-24, "Formato dos erros (AQ-1)", "Verificações obrigatórias".
-- Massa (dados fictícios): Samuel e Magda (pastores), Pedro (Líder: cria e edita, vê só o
-- ministério, sem dados sensíveis), André, Caio (Membro, batizado em 10/05/2020), Davi (inativo),
-- Rita (Administrador), Diego (CPF 529.982.247-25, fora do ministério de Pedro), Ester (sem
-- liderança), Otávio e Olga (casal), Fábio (do legado, carregado em replica), Bruno e Bruna
-- (excluídos), Lúcia e Paulo, a cadeia N1 a N8 e X1, X2 (excluído) e X3.
-- "Hoje" é sp_today(): as datas dos casos são relativas a ele.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(173);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2040200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2040200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192042' || lpad(_n::text, 4, '0') $$;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e204r-' || n || '@teste.invalid' FROM generate_series(1, 14) n;

-- 1 Samuel, 2 Magda, 3 Pedro, 4 André, 5 Caio, 6 Davi, 7 Rita, 8 Diego, 9 Ester, 10 Otávio, 11 Olga.
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, is_active, mobile_whatsapp, email) VALUES
  (pg_temp.m(1), 'Samuel Colares', 'M', true, NULL, pg_temp.u(1), pg_temp.role('Líder'), true, pg_temp.mob(1), NULL),
  (pg_temp.m(2), 'Magda Colares', 'F', true, NULL, pg_temp.u(2), pg_temp.role('Líder'), true, pg_temp.mob(2), NULL);
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, is_active, mobile_whatsapp, email) VALUES
  (pg_temp.m(3), 'Pedro Lima', 'M', false, pg_temp.m(1), pg_temp.u(3), pg_temp.role('Líder'), true, pg_temp.mob(3), NULL),
  (pg_temp.m(7), 'Rita Admin', 'F', false, pg_temp.m(2), pg_temp.u(7), pg_temp.role('Administrador'), true, pg_temp.mob(7), NULL),
  (pg_temp.m(8), 'Diego Rocha', 'M', false, pg_temp.m(1), pg_temp.u(8), pg_temp.role('Líder'), true, pg_temp.mob(8), NULL);
UPDATE public.members SET cpf = '529.982.247-25' WHERE id = pg_temp.m(8);
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, is_active, mobile_whatsapp, email, birth_date, is_baptized, baptism_date) VALUES
  (pg_temp.m(4), 'André Lima', 'M', false, pg_temp.m(3), pg_temp.u(4), NULL, true, pg_temp.mob(4), NULL, NULL, false, NULL);
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, is_active, mobile_whatsapp, email, birth_date, is_baptized, baptism_date) VALUES
  (pg_temp.m(5), 'Caio Souza', 'M', false, pg_temp.m(4), pg_temp.u(5), pg_temp.role('Membro'), true, '(51) 98888-7777', 'caio@exemplo.com', NULL, true, '2020-05-10');
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, is_active, mobile_whatsapp, email) VALUES
  (pg_temp.m(6), 'Davi Souza', 'M', false, pg_temp.m(5), false, NULL, 'davi@exemplo.com');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(9), 'Ester Prado', 'F', false, false, NULL, true, pg_temp.mob(9)),
  (pg_temp.m(10), 'Otávio Reis', 'M', false, true, pg_temp.m(1), true, '(51) 97777-0000'),
  (pg_temp.m(11), 'Olga Reis', 'F', false, true, pg_temp.m(1), true, pg_temp.mob(11));
UPDATE public.members SET spouse_id = pg_temp.m(11) WHERE id = pg_temp.m(10);
-- 15 Lúcia e 16 Paulo (no ministério de Pedro), 17 X1, 19 X3 e a cadeia N1 a N8 (21 a 28).
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(15), 'Lúcia Prado', 'F', false, pg_temp.m(3), true, pg_temp.mob(15)),
  (pg_temp.m(16), 'Paulo Fixo', 'M', false, pg_temp.m(3), true, pg_temp.mob(16)),
  (pg_temp.m(17), 'Xis Um', 'M', false, pg_temp.m(1), true, pg_temp.mob(17));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, is_active, mobile_whatsapp)
SELECT pg_temp.m(20 + n), 'Nivel ' || n || ' Cadeia', 'M', false,
       CASE WHEN n = 1 THEN pg_temp.m(1) ELSE pg_temp.m(20 + n - 1) END, true, pg_temp.mob(20 + n)
  FROM generate_series(1, 8) n;
-- Dado antigo (E2.01 e legado), carregado em replica: Fábio (RN-17), Bruno e Bruna (excluídos), X2
-- (excluído, no meio da subida de X1 a X3) e Velho (nascimento antigo, RN-15).
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, birth_date, mobile_whatsapp) VALUES
  (pg_temp.m(12), 'Fábio', 'M', false, pg_temp.m(4), true, false, '1920-03-10', '98887777'),
  (pg_temp.m(20), 'Velho Antigo', 'M', false, pg_temp.m(1), true, true, public.sp_today() - interval '100 years' - interval '5 days', pg_temp.mob(20));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, email, mobile_whatsapp, cpf, deleted_at, auth_user_id) VALUES
  (pg_temp.m(13), 'Bruno Alves', 'M', false, pg_temp.m(1), true, 'bruno@exemplo.com', '5188880000', '01234567890', now(), NULL),
  (pg_temp.m(14), 'Bruna Alves', 'F', false, pg_temp.m(1), true, 'bruna@exemplo.com', NULL, NULL, now(), pg_temp.u(14));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp, deleted_at) VALUES
  (pg_temp.m(18), 'Xis Dois', 'M', false, pg_temp.m(17), true, pg_temp.mob(18), now());
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp) VALUES
  (pg_temp.m(19), 'Xis Tres', 'M', false, pg_temp.m(18), true, pg_temp.mob(19));
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

CREATE TEMP TABLE ev0 ON COMMIT DROP AS SELECT count(*) AS n FROM public.events;

-- ---------------------------------------------------------------------------
-- Ferramentas. scenario: _setup como postgres; _call como _role ('authenticated' com o usuário n,
-- 'service_role' ou 'postgres'); _after como postgres. Desfaz tudo. Devolve
-- {ok, state, code, message, field, fields, detail, constraint, after}.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.scenario(_setup text, _role text, _n int, _call text, _after text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text; _detail text; _hint text; _con text; _res jsonb; _aft text;
BEGIN
  BEGIN
    IF _setup IS NOT NULL THEN EXECUTE _setup; END IF;
    IF _role = 'authenticated' THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    END IF;
    IF _role <> 'postgres' THEN EXECUTE format('SET LOCAL ROLE %I', _role); END IF;
    BEGIN
      EXECUTE _call;
      IF _role <> 'postgres' THEN EXECUTE 'RESET ROLE'; END IF;
      _res := jsonb_build_object('ok', true);
    EXCEPTION WHEN OTHERS THEN
      IF _role <> 'postgres' THEN EXECUTE 'RESET ROLE'; END IF;
      GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL,
                              _hint = PG_EXCEPTION_HINT, _con = CONSTRAINT_NAME;
      _res := jsonb_build_object('ok', false, 'state', _state, 'message', _msg, 'constraint', _con,
        'detail', _detail,
        'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%' THEN _detail::jsonb ->> 'code' ELSE _state END,
        'field', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'field' END,
        'fields', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb -> 'fields' END);
    END;
    PERFORM set_config('request.jwt.claims', '', true);
    IF _after IS NOT NULL THEN EXECUTE _after INTO _aft; _res := _res || jsonb_build_object('after', _aft); END IF;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'XU001', DETAIL = _res::text;
  EXCEPTION WHEN SQLSTATE 'XU001' THEN
    GET STACKED DIAGNOSTICS _detail = PG_EXCEPTION_DETAIL;
    RETURN _detail::jsonb;
  END;
END $$;

-- INSERT e UPDATE a partir de um jsonb (só as colunas citadas; as omitidas ficam com o default).
CREATE FUNCTION pg_temp.ins(_j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.members (%1$s) SELECT %1$s FROM jsonb_populate_record(NULL::public.members, %2$L)',
                (SELECT string_agg(quote_ident(k), ', ') FROM jsonb_object_keys(_j) k), _j) $$;
CREATE FUNCTION pg_temp.upd(_id uuid, _j jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT format('UPDATE public.members t SET %s FROM jsonb_populate_record(NULL::public.members, %L) r WHERE t.id = %L',
                (SELECT string_agg(format('%1$I = r.%1$I', k), ', ') FROM jsonb_object_keys(_j) k), _j, _id) $$;
-- Cadastro novo padrão: Lúcia Nova, M/F, líder Pedro. _j sobrescreve (chave com null remove o padrão).
CREATE FUNCTION pg_temp.newm(_j jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object('name', 'Lúcia Nova', 'gender', 'F', 'mobile_whatsapp', '(51) 98888-1234',
                                              'leader_id', pg_temp.m(3)) || _j) $$;
-- "código|campo|mensagem" de um resultado, para comparar de uma vez.
CREATE FUNCTION pg_temp.sig(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN (_r ->> 'ok')::boolean THEN 'ok'
              ELSE (_r ->> 'code') || '|' || coalesce(_r ->> 'field', _r ->> 'fields', '') || '|' || (_r ->> 'message') END $$;

CREATE TEMP TABLE rs (k text PRIMARY KEY, r jsonb) ON COMMIT DROP;
-- Atalhos: a = Rita (Administrador), p = Pedro (Líder), c = Caio (Membro).
CREATE FUNCTION pg_temp.run(_k text, _role text, _n int, _call text, _after text DEFAULT NULL, _setup text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$ INSERT INTO rs VALUES (_k, pg_temp.scenario(_setup, _role, _n, _call, _after)) $$;
CREATE FUNCTION pg_temp.row_of(_id uuid, _col text) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT %I::text FROM public.members WHERE id = %L', _col, _id) $$;

-- ===========================================================================
-- RN-01: vale para todos os papéis; a permissão vem antes; replica só CHECKs e índices.
-- ===========================================================================
SELECT pg_temp.run('rn01_svc', 'service_role', NULL, pg_temp.upd(pg_temp.m(5), '{"name": "Caio"}'));
SELECT pg_temp.run('rn01_pg', 'postgres', NULL, pg_temp.upd(pg_temp.m(5), '{"name": "Caio"}'));
SELECT pg_temp.run('rn01_svc_ins', 'service_role', NULL, pg_temp.ins(pg_temp.newm('{"gender": "X"}')));
SELECT pg_temp.run('rn01_noperm_upd', 'authenticated', 5, pg_temp.upd(pg_temp.m(4), '{"name": "André"}'), pg_temp.row_of(pg_temp.m(4), 'name'));
SELECT pg_temp.run('rn01_noperm_sex', 'authenticated', 5, pg_temp.ins(pg_temp.newm('{"gender": ""}')));
SELECT pg_temp.run('rn01_noperm_cpf', 'authenticated', 5, pg_temp.ins(pg_temp.newm('{"cpf": "529.982.247-25"}')));
SELECT pg_temp.run('rn01_noperm_deleted', 'authenticated', 5, pg_temp.ins(pg_temp.newm('{"email": "bruna@exemplo.com"}')));
SELECT pg_temp.run('rn01_noperm_name', 'authenticated', 5, pg_temp.ins(pg_temp.newm('{"name": "Ana"}')));
SELECT pg_temp.run('rn01_noperm_name_full', 'authenticated', 5, pg_temp.ins(pg_temp.newm()));
-- Em replica, o trigger não dispara; os CHECKs e os índices continuam valendo.
SELECT pg_temp.run('rn01_rep_name', 'postgres', NULL,
  'SET LOCAL session_replication_role = replica; ' || pg_temp.ins(pg_temp.newm('{"name": "Ana", "has_leadership": true}')),
  $q$SELECT count(*)::text FROM public.members WHERE name = 'Ana'$q$);
SELECT pg_temp.run('rn01_rep_check', 'postgres', NULL,
  'SET LOCAL session_replication_role = replica; ' || pg_temp.ins(pg_temp.newm('{"email": "x@exemplo", "has_leadership": true}')));
SELECT pg_temp.run('rn01_rep_gender', 'postgres', NULL,
  'SET LOCAL session_replication_role = replica; ' || pg_temp.ins(pg_temp.newm('{"gender": "X", "has_leadership": true}')));
SELECT pg_temp.run('rn01_rep_index', 'postgres', NULL,
  'SET LOCAL session_replication_role = replica; ' || pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": "5188887777", "has_leadership": true}')));

SELECT is(pg_temp.sig(r), 'name_invalid|name|Informe o nome e o sobrenome.', 'RN-01: a service role recebe name_invalid') FROM rs WHERE k = 'rn01_svc';
SELECT is(pg_temp.sig(r), 'name_invalid|name|Informe o nome e o sobrenome.', 'RN-01: o postgres recebe name_invalid') FROM rs WHERE k = 'rn01_pg';
SELECT is(r ->> 'code', 'gender_required', 'RN-01: a service role também recebe as outras regras (sexo)') FROM rs WHERE k = 'rn01_svc_ins';
SELECT ok(coalesce(r ->> 'code', '') IN ('', '42501'), 'leitura técnica 1: Caio (sem edit_member) mudando o nome de André recebe permissão (42501 ou 0 linhas pelo RLS), nunca name_invalid') FROM rs WHERE k = 'rn01_noperm_upd';
SELECT is(r ->> 'after', 'André Lima', 'leitura técnica 1: o nome de André não mudou') FROM rs WHERE k = 'rn01_noperm_upd';
SELECT is(r ->> 'state', '42501', 'leitura técnica 1: sem create_member, sexo vazio dá 42501 e nunca a regra') FROM rs WHERE k = 'rn01_noperm_sex';
SELECT is(r ->> 'state', '42501', 'leitura técnica 1: sem create_member, o CPF de outro cadastro dá 42501 e nunca value_in_use') FROM rs WHERE k = 'rn01_noperm_cpf';
SELECT is(r ->> 'state', '42501', 'leitura técnica 1: sem create_member, o e-mail da conta de um excluído dá 42501 e nunca deleted_account_email') FROM rs WHERE k = 'rn01_noperm_deleted';
SELECT is(r ->> 'state', '42501', 'leitura técnica 1: sem create_member, nome inválido dá 42501') FROM rs WHERE k = 'rn01_noperm_name';
SELECT is(r ->> 'state', '42501', 'leitura técnica 1: sem create_member, até o cadastro válido dá 42501') FROM rs WHERE k = 'rn01_noperm_name_full';
SELECT is(r ->> 'ok', 'true', 'RN-01: em replica o nome de uma palavra é aceito (a carga do legado)') FROM rs WHERE k = 'rn01_rep_name';
SELECT is(r ->> 'after', '1', 'RN-01: o cadastro da carga em replica ficou gravado') FROM rs WHERE k = 'rn01_rep_name';
SELECT is(r ->> 'constraint', 'members_email_check', 'RN-01: em replica, o CHECK do e-mail vale') FROM rs WHERE k = 'rn01_rep_check';
SELECT is(r ->> 'state', '23514', 'RN-01: em replica, o CHECK recusa com 23514') FROM rs WHERE k = 'rn01_rep_check';
SELECT is(r ->> 'constraint', 'members_gender_check', 'RN-01: em replica, o CHECK do sexo vale') FROM rs WHERE k = 'rn01_rep_gender';
SELECT is(r ->> 'constraint', 'members_mobile_key', 'RN-01: em replica, o índice único do celular vale (sem value_in_use)') FROM rs WHERE k = 'rn01_rep_index';

-- ===========================================================================
-- RN-02 nome; RN-03 sexo.
-- ===========================================================================
SELECT pg_temp.run('rn02_a', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"name": "  Ana   Souza "}')), $q$SELECT name FROM public.members WHERE mobile_whatsapp = '51988881234'$q$);
SELECT pg_temp.run('rn02_b', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"name": "Ana B."}')), $q$SELECT name FROM public.members WHERE mobile_whatsapp = '51988881234'$q$);
SELECT pg_temp.run('rn02_c1', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"name": "Ana"}')), $q$SELECT count(*)::text FROM public.members WHERE mobile_whatsapp = '51988881234'$q$);
SELECT pg_temp.run('rn02_c2', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"name": "Ana 2"}')));
SELECT pg_temp.run('rn02_c3', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"name": "Ana ."}')));
SELECT pg_temp.run('rn02_caio', 'authenticated', 5, pg_temp.upd(pg_temp.m(5), '{"name": "Caio"}'), pg_temp.row_of(pg_temp.m(5), 'name'));
SELECT pg_temp.run('rn02_fabio_notes', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"notes": "visitou"}'), pg_temp.row_of(pg_temp.m(12), 'name'));
SELECT pg_temp.run('rn02_fabio_fabio', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"name": "Fabio"}'));
SELECT pg_temp.run('rn02_fabio_lima', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"name": "Fábio Lima"}'), pg_temp.row_of(pg_temp.m(12), 'name'));
SELECT pg_temp.run('rn03_masc', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"gender": "Masculino"}')));
SELECT pg_temp.run('rn03_x', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"gender": "X"}')));
SELECT pg_temp.run('rn03_empty', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"gender": ""}')));
SELECT pg_temp.run('rn03_omitted', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"gender": null}')));
SELECT pg_temp.run('rn03_caio', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"gender": "X"}'));
SELECT pg_temp.run('rn03_caio_null', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"gender": null}'));
SELECT pg_temp.run('rn03_m', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"gender": "M"}')));

SELECT is(r ->> 'after', 'Ana Souza', 'RN-02: "  Ana   Souza " é gravado como "Ana Souza"') FROM rs WHERE k = 'rn02_a';
SELECT is(r ->> 'after', 'Ana B.', 'RN-02: "Ana B." é aceito') FROM rs WHERE k = 'rn02_b';
SELECT is(pg_temp.sig(r), 'name_invalid|name|Informe o nome e o sobrenome.', 'RN-02: "Ana" é recusado') FROM rs WHERE k = 'rn02_c1';
SELECT is(r ->> 'after', '0', 'RN-02: nada é gravado (RN-19)') FROM rs WHERE k = 'rn02_c1';
SELECT is(r ->> 'code', 'name_invalid', 'RN-02: "Ana 2" é recusado') FROM rs WHERE k = 'rn02_c2';
SELECT is(r ->> 'code', 'name_invalid', 'RN-02: "Ana ." é recusado') FROM rs WHERE k = 'rn02_c3';
SELECT is(pg_temp.sig(r), 'name_invalid|name|Informe o nome e o sobrenome.', 'RN-02: Caio muda o próprio nome para "Caio" e é recusado') FROM rs WHERE k = 'rn02_caio';
SELECT is(r ->> 'after', 'Caio Souza', 'RN-02: o nome de Caio não mudou') FROM rs WHERE k = 'rn02_caio';
SELECT is(r ->> 'ok', 'true', 'RN-02/RN-17: Rita muda só as observações de Fábio e é aceito') FROM rs WHERE k = 'rn02_fabio_notes';
SELECT is(r ->> 'after', 'Fábio', 'RN-17: o nome de Fábio continua "Fábio"') FROM rs WHERE k = 'rn02_fabio_notes';
SELECT is(r ->> 'code', 'name_invalid', 'RN-02: Fábio para "Fabio" é recusado') FROM rs WHERE k = 'rn02_fabio_fabio';
SELECT is(r ->> 'after', 'Fábio Lima', 'RN-02: Fábio para "Fábio Lima" é aceito') FROM rs WHERE k = 'rn02_fabio_lima';
SELECT is(pg_temp.sig(r), 'gender_required|gender|Informe o sexo.', 'RN-03: "Masculino" é recusado') FROM rs WHERE k = 'rn03_masc';
SELECT is(r ->> 'code', 'gender_required', 'RN-03: "X" é recusado') FROM rs WHERE k = 'rn03_x';
SELECT is(r ->> 'code', 'gender_required', 'RN-03: sexo vazio é recusado') FROM rs WHERE k = 'rn03_empty';
SELECT is(r ->> 'code', 'gender_required', 'RN-03: sexo omitido no cadastro novo é recusado (não vira 23502)') FROM rs WHERE k = 'rn03_omitted';
SELECT is(r ->> 'code', 'gender_required', 'RN-03: "X" no cadastro de Caio é recusado') FROM rs WHERE k = 'rn03_caio';
SELECT is(r ->> 'code', 'gender_required', 'RN-03: sexo nulo no cadastro de Caio é recusado') FROM rs WHERE k = 'rn03_caio_null';
SELECT is(r ->> 'ok', 'true', 'RN-03: "M" é aceito') FROM rs WHERE k = 'rn03_m';

-- ===========================================================================
-- RN-04 e-mail; RN-05 e-mail fictício; RN-06 celular; RN-07 CPF.
-- ===========================================================================
CREATE FUNCTION pg_temp.col_of_new(_col text) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT %I::text FROM public.members WHERE name = ''Lúcia Nova''', _col) $$;
SELECT pg_temp.run('rn04_norm', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": " Ana.Souza@Exemplo.COM "}')), pg_temp.col_of_new('email'));
SELECT pg_temp.run('rn04_org', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "ana.souza@igreja.org.br"}')), pg_temp.col_of_new('email'));
SELECT pg_temp.run('rn04_bad_' || i, 'authenticated', 7, pg_temp.ins(pg_temp.newm(jsonb_build_object('email', e))))
  FROM unnest(ARRAY['ana@exemplo', 'ana@.com', 'ana @exemplo.com', 'ana@@exemplo.com', 'ana@exemplo..com']) WITH ORDINALITY u(e, i);
SELECT pg_temp.run('rn05_mobile_only', 'authenticated', 7, pg_temp.ins(pg_temp.newm()), pg_temp.col_of_new('email'));
SELECT pg_temp.run('rn05_fake', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "lucia@mci12fakemail.com"}')));
SELECT pg_temp.run('rn05_fake_up', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "LUCIA@MCI12FAKEMAIL.COM"}')));
SELECT pg_temp.run('rn05_fake_upd', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"email": "x_ab12@mci12fakemail.com"}'), pg_temp.row_of(pg_temp.m(5), 'email'));
SELECT pg_temp.run('rn05_real_then_clear', 'authenticated', 7,
  pg_temp.upd(pg_temp.m(15), '{"email": "lucia@exemplo.com"}') || '; ' || pg_temp.upd(pg_temp.m(15), '{"email": null}'),
  pg_temp.row_of(pg_temp.m(15), 'email'));
SELECT pg_temp.run('rn05_blank', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"email": "   "}'), pg_temp.row_of(pg_temp.m(5), 'email'));

SELECT is(r ->> 'after', 'ana.souza@exemplo.com', 'RN-04: " Ana.Souza@Exemplo.COM " é gravado em minúsculas e sem espaços') FROM rs WHERE k = 'rn04_norm';
SELECT is(r ->> 'after', 'ana.souza@igreja.org.br', 'RN-04: e-mail com .org.br é aceito') FROM rs WHERE k = 'rn04_org';
SELECT is(pg_temp.sig(r), 'email_invalid|email|E-mail inválido. Confira o endereço digitado.', 'RN-04: e-mail inválido ' || i) FROM rs, generate_series(1, 5) i WHERE k = 'rn04_bad_' || i;
SELECT is(r ->> 'after', NULL, 'RN-05: o cadastro só com celular fica com members.email nulo') FROM rs WHERE k = 'rn05_mobile_only';
SELECT is(pg_temp.sig(r), 'email_placeholder|email|Este e-mail não pode ser usado. Informe um e-mail real ou deixe o campo em branco.', 'RN-05: e-mail fictício vindo do cliente é recusado') FROM rs WHERE k = 'rn05_fake';
SELECT is(r ->> 'code', 'email_placeholder', 'RN-05: o domínio em maiúsculas também é recusado') FROM rs WHERE k = 'rn05_fake_up';
SELECT is(r ->> 'code', 'email_placeholder', 'RN-05: trocar o e-mail de um cadastro para um fictício é recusado') FROM rs WHERE k = 'rn05_fake_upd';
SELECT is(r ->> 'after', 'caio@exemplo.com', 'RN-05: o e-mail de Caio não mudou') FROM rs WHERE k = 'rn05_fake_upd';
SELECT is(r ->> 'after', NULL, 'RN-05: e-mail real, depois apagado, volta a "não informado" (nulo)') FROM rs WHERE k = 'rn05_real_then_clear';
SELECT is(r ->> 'after', NULL, 'DT-24: e-mail só com espaços vira nulo') FROM rs WHERE k = 'rn05_blank';

SELECT pg_temp.run('rn06_' || md5(e), 'authenticated', 7, pg_temp.ins(pg_temp.newm(jsonb_build_object('mobile_whatsapp', e))), pg_temp.col_of_new('mobile_whatsapp'))
  FROM unnest(ARRAY['+55 (51) 98888-1234', '051 98888-1234', '(55) 99999-1111', '(51) 3333-4444', '98888-1234', '(51) 98888-12345']) e;
SELECT is(r ->> 'after', '51988881234', 'RN-06: "+55 (51) 98888-1234" é gravado como 51988881234') FROM rs WHERE k = 'rn06_' || md5('+55 (51) 98888-1234');
SELECT is(r ->> 'after', '51988881234', 'RN-06: "051 98888-1234" é gravado como 51988881234') FROM rs WHERE k = 'rn06_' || md5('051 98888-1234');
SELECT is(r ->> 'after', '55999991111', 'RN-06: "(55) 99999-1111" mantém o DDD 55') FROM rs WHERE k = 'rn06_' || md5('(55) 99999-1111');
SELECT is(r ->> 'after', '5133334444', 'RN-06: "(51) 3333-4444" é aceito com 10 dígitos') FROM rs WHERE k = 'rn06_' || md5('(51) 3333-4444');
SELECT is(pg_temp.sig(r), 'mobile_invalid|mobile_whatsapp|Celular inválido. Informe o DDD e o número.', 'RN-06: "98888-1234" (sem DDD) é recusado') FROM rs WHERE k = 'rn06_' || md5('98888-1234');
SELECT is(r ->> 'code', 'mobile_invalid', 'RN-06: "(51) 98888-12345" é recusado') FROM rs WHERE k = 'rn06_' || md5('(51) 98888-12345');

SELECT pg_temp.run('rn07_' || md5(e), 'authenticated', 7, pg_temp.ins(pg_temp.newm(jsonb_build_object('cpf', e))), pg_temp.col_of_new('cpf'))
  FROM unnest(ARRAY['111.444.777-35', '012.345.678-90', '111.444.777-36', '111.111.111-11', '1144477735']) e;
SELECT is(r ->> 'after', '11144477735', 'RN-07: "111.444.777-35" é gravado só com dígitos') FROM rs WHERE k = 'rn07_' || md5('111.444.777-35');
SELECT is(r ->> 'after', '01234567890', 'RN-07: o zero à esquerda é mantido') FROM rs WHERE k = 'rn07_' || md5('012.345.678-90');
SELECT is(pg_temp.sig(r), 'cpf_invalid|cpf|CPF inválido. Se a pessoa não tem CPF, deixe o campo em branco.', 'RN-07: dígito verificador errado é recusado') FROM rs WHERE k = 'rn07_' || md5('111.444.777-36');
SELECT is(r ->> 'code', 'cpf_invalid', 'RN-07: dígitos iguais é recusado') FROM rs WHERE k = 'rn07_' || md5('111.111.111-11');
SELECT is(r ->> 'code', 'cpf_invalid', 'RN-07: CPF de 10 dígitos é recusado') FROM rs WHERE k = 'rn07_' || md5('1144477735');

-- ===========================================================================
-- RN-08 identificador.
-- ===========================================================================
SELECT pg_temp.run('rn08_none', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": null}')));
SELECT pg_temp.run('rn08_blank', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": "  ", "email": "", "cpf": " "}')));
SELECT pg_temp.run('rn08_cpf', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": null, "cpf": "111.444.777-35"}')));
SELECT pg_temp.run('rn08_caio_email', 'authenticated', 5, pg_temp.upd(pg_temp.m(5), '{"email": null}'), pg_temp.row_of(pg_temp.m(5), 'mobile_whatsapp'));
SELECT pg_temp.run('rn08_caio_both', 'authenticated', 5,
  pg_temp.upd(pg_temp.m(5), '{"email": null}') || '; ' || pg_temp.upd(pg_temp.m(5), '{"mobile_whatsapp": null}'),
  pg_temp.row_of(pg_temp.m(5), 'mobile_whatsapp'));
SELECT pg_temp.run('rn08_davi', 'authenticated', 7, pg_temp.upd(pg_temp.m(6), '{"email": null}'), pg_temp.row_of(pg_temp.m(6), 'email'));
SELECT pg_temp.run('rn08_magda', 'authenticated', 7, pg_temp.upd(pg_temp.m(2), '{"mobile_whatsapp": null}'), pg_temp.row_of(pg_temp.m(2), 'mobile_whatsapp'));
SELECT pg_temp.run('rn08_fabio', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"notes": "x"}'));
SELECT pg_temp.run('rn08_pedro_andre', 'authenticated', 3, pg_temp.upd(pg_temp.m(4), '{"email": null, "mobile_whatsapp": null, "cpf": null}'), pg_temp.row_of(pg_temp.m(4), 'mobile_whatsapp'));

SELECT is(pg_temp.sig(r), 'identifier_required|identification|Informe o e-mail, o celular ou o CPF. A pessoa usa um deles para entrar no sistema.', 'RN-08: sem e-mail, celular nem CPF é recusado') FROM rs WHERE k = 'rn08_none';
SELECT is(r -> 'fields', '["mobile_whatsapp", "email", "cpf"]'::jsonb, 'RN-08: o DETAIL traz os três campos') FROM rs WHERE k = 'rn08_none';
SELECT is(r ->> 'field', 'identification', 'RN-08: o campo é "identification"') FROM rs WHERE k = 'rn08_none';
SELECT is(r ->> 'code', 'identifier_required', 'RN-08: identificadores vazios ou só com espaços contam como ausentes') FROM rs WHERE k = 'rn08_blank';
SELECT is(r ->> 'ok', 'true', 'RN-08: só com o CPF 111.444.777-35 é aceito') FROM rs WHERE k = 'rn08_cpf';
SELECT is(r ->> 'ok', 'true', 'RN-08: Caio apaga o e-mail mantendo o celular') FROM rs WHERE k = 'rn08_caio_email';
SELECT is(r ->> 'code', 'identifier_required', 'RN-08: depois, apagar o celular de Caio é recusado') FROM rs WHERE k = 'rn08_caio_both';
SELECT is(r ->> 'after', '51988887777', 'RN-08: o celular de Caio continua gravado') FROM rs WHERE k = 'rn08_caio_both';
SELECT is(r ->> 'code', 'identifier_required', 'RN-08: apagar o único identificador de Davi (inativo) é recusado') FROM rs WHERE k = 'rn08_davi';
SELECT is(r ->> 'after', 'davi@exemplo.com', 'RN-08: o e-mail de Davi continua') FROM rs WHERE k = 'rn08_davi';
SELECT is(r ->> 'code', 'identifier_required', 'RN-08: apagar o único identificador de Magda (pastora) é recusado') FROM rs WHERE k = 'rn08_magda';
SELECT is(r ->> 'ok', 'true', 'RN-08/RN-17: Fábio, sem identificador real, tem as observações salvas') FROM rs WHERE k = 'rn08_fabio';
SELECT is(r ->> 'ok', 'true', 'RN-08: Pedro envia e-mail, celular e CPF vazios para André e não há recusa') FROM rs WHERE k = 'rn08_pedro_andre';
SELECT is(r ->> 'after', pg_temp.mob(4), 'RN-08 (RN-12 do E1.08): o celular de André não mudou') FROM rs WHERE k = 'rn08_pedro_andre';

-- ===========================================================================
-- RN-09 e RN-10: dado em uso.
-- ===========================================================================
SELECT pg_temp.run('rn09_email', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "CAIO@exemplo.com "}')));
SELECT pg_temp.run('rn09_mobile9', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": "(51) 8888-7777"}')));
SELECT pg_temp.run('rn09_cpf_pedro', 'authenticated', 3, pg_temp.ins(pg_temp.newm('{"cpf": "529.982.247-25"}')));
SELECT pg_temp.run('rn09_davi', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "davi@exemplo.com"}')));
SELECT pg_temp.run('rn09_olga', 'authenticated', 7, pg_temp.upd(pg_temp.m(11), '{"mobile_whatsapp": "(51) 97777-0000"}'));
SELECT pg_temp.run('rn09_bruno', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": "(51) 98888-0000"}')), pg_temp.col_of_new('mobile_whatsapp'));
SELECT pg_temp.run('rn09_restore', 'authenticated', 7, 'SELECT count(*) FROM public.restore_member(' || quote_literal(pg_temp.m(13)) || ')',
  pg_temp.row_of(pg_temp.m(13), 'deleted_at'),
  pg_temp.ins(pg_temp.newm('{"mobile_whatsapp": "(51) 98888-0000"}')));
SELECT pg_temp.run('rn09_released', 'authenticated', 7,
  pg_temp.upd(pg_temp.m(5), '{"email": "caio.novo@exemplo.com"}') || '; ' || pg_temp.ins(pg_temp.newm('{"email": "caio@exemplo.com"}')),
  pg_temp.col_of_new('email'));
SELECT pg_temp.run('rn09_self', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"email": "CAIO@exemplo.com", "mobile_whatsapp": "(51) 98888-7777"}'), pg_temp.row_of(pg_temp.m(5), 'mobile_whatsapp'));
SELECT pg_temp.run('rn09_upd_email', 'authenticated', 7, pg_temp.upd(pg_temp.m(15), '{"email": "caio@exemplo.com"}'));
SELECT pg_temp.run('rn09_upd_cpf', 'authenticated', 7, pg_temp.upd(pg_temp.m(15), '{"cpf": "529.982.247-25"}'));
SELECT pg_temp.run('rn09_deleted_cpf_free', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"cpf": "012.345.678-90"}')));
SELECT pg_temp.run('rn09_inactive_mobile', 'authenticated', 7, pg_temp.upd(pg_temp.m(15), '{"mobile_whatsapp": "98887777"}'));

SELECT is(pg_temp.sig(r), 'value_in_use|["email"]|Este e-mail já está sendo usado por outro cadastro.', 'RN-09: "CAIO@exemplo.com " (e-mail de Caio)') FROM rs WHERE k = 'rn09_email';
SELECT is(pg_temp.sig(r), 'value_in_use|["mobile"]|Este celular já está sendo usado por outro cadastro.', 'RN-09: "(51) 8888-7777" sem o 9 contra o de Caio com o 9') FROM rs WHERE k = 'rn09_mobile9';
SELECT is(pg_temp.sig(r), 'value_in_use|["cpf"]|Este CPF já está sendo usado por outro cadastro.', 'RN-09: Pedro, com o CPF de Diego (fora do escopo dele)') FROM rs WHERE k = 'rn09_cpf_pedro';
SELECT is(r ->> 'code', 'value_in_use', 'RN-09: o e-mail do inativo Davi conta') FROM rs WHERE k = 'rn09_davi';
SELECT is(pg_temp.sig(r), 'value_in_use|["mobile"]|Este celular já está sendo usado por outro cadastro.', 'RN-09: Olga com o celular do marido Otávio') FROM rs WHERE k = 'rn09_olga';
SELECT is(r ->> 'after', '51988880000', 'RN-09: o celular de Bruno (excluído) não conta: Lúcia Nova é aceita') FROM rs WHERE k = 'rn09_bruno';
SELECT is(pg_temp.sig(r), 'restore_value_in_use|["mobile"]|Não é possível restaurar: outro cadastro já usa este celular.', 'RN-09: restaurar Bruno com a chave nova (51988880000) é recusado') FROM rs WHERE k = 'rn09_restore';
SELECT is(r ->> 'after' IS NOT NULL, true, 'RN-09: Bruno continua excluído depois da recusa') FROM rs WHERE k = 'rn09_restore';
SELECT is(r ->> 'after', 'caio@exemplo.com', 'RN-09: o e-mail que Caio largou fica livre para Lúcia') FROM rs WHERE k = 'rn09_released';
SELECT is(r ->> 'after', '51988887777', 'RN-09/RN-17: reenviar o celular de Caio com máscara não conta como mudado') FROM rs WHERE k = 'rn09_self';
SELECT is(r ->> 'ok', 'true', 'RN-09: o próprio cadastro não colide consigo mesmo') FROM rs WHERE k = 'rn09_self';
SELECT is(r ->> 'code', 'value_in_use', 'RN-09: trocar o e-mail para o de outro cadastro é recusado') FROM rs WHERE k = 'rn09_upd_email';
SELECT is(r ->> 'code', 'value_in_use', 'RN-09: trocar o CPF para o de outro cadastro é recusado') FROM rs WHERE k = 'rn09_upd_cpf';
SELECT is(r ->> 'ok', 'true', 'DEL-04: o CPF de um excluído (Bruno) não conta') FROM rs WHERE k = 'rn09_deleted_cpf_free';
SELECT is(r ->> 'code', 'mobile_invalid', 'DA-5: o código do celular ilegível é mobile_invalid') FROM rs WHERE k = 'rn09_inactive_mobile';

SELECT pg_temp.run('rn10_pedro', 'authenticated', 3, pg_temp.ins(pg_temp.newm('{"email": "caio@exemplo.com", "cpf": "529.982.247-25"}')));
SELECT pg_temp.run('rn10_rita', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "caio@exemplo.com", "cpf": "529.982.247-25"}')));
SELECT pg_temp.run('rn10_three', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "caio@exemplo.com", "mobile_whatsapp": "51977770000", "cpf": "529.982.247-25"}')));
SELECT pg_temp.run('rn10_deleted_cpf', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"email": "caio@exemplo.com", "cpf": "012.345.678-90"}')));
SELECT pg_temp.run('rn10_pedro_edit', 'authenticated', 3, pg_temp.upd(pg_temp.m(4), '{"email": "caio@exemplo.com"}'), pg_temp.row_of(pg_temp.m(4), 'email'));

SELECT is(pg_temp.sig(r), 'value_in_use|["email", "cpf"]|Este e-mail já está sendo usado por outro cadastro.', 'RN-10: Pedro, com o e-mail de Caio e o CPF de Diego: os dois campos, mensagem do primeiro') FROM rs WHERE k = 'rn10_pedro';
SELECT is(pg_temp.sig(r), 'value_in_use|["email", "cpf"]|Este e-mail já está sendo usado por outro cadastro.', 'RN-10: Rita recebe o mesmo') FROM rs WHERE k = 'rn10_rita';
SELECT is(r -> 'fields', '["email", "mobile", "cpf"]'::jsonb, 'RN-10: os três campos, na ordem e-mail, celular, CPF') FROM rs WHERE k = 'rn10_three';
SELECT is(r ->> 'detail', '{"code": "value_in_use", "fields": ["email", "cpf"]}', 'RN-10: o DETAIL traz só code e fields, nada do outro cadastro') FROM rs WHERE k = 'rn10_pedro';
SELECT ok(r::text !~ 'Caio|Diego|c2040200', 'RN-10: nem nome nem id do outro cadastro na resposta: ' || k) FROM rs WHERE k IN ('rn10_pedro', 'rn10_rita');
SELECT is(pg_temp.sig(r), 'value_in_use|["email"]|Este e-mail já está sendo usado por outro cadastro.', 'RN-10: e-mail em uso e CPF de um excluído: só o e-mail, sem deleted_account_email') FROM rs WHERE k = 'rn10_deleted_cpf';
SELECT is(r ->> 'ok', 'true', 'RN-10 (RN-12 do E1.08): Pedro envia o e-mail de Caio para André: sem recusa') FROM rs WHERE k = 'rn10_pedro_edit';
SELECT is(r ->> 'after', NULL, 'RN-10: o e-mail de André não mudou') FROM rs WHERE k = 'rn10_pedro_edit';

-- ===========================================================================
-- RN-11 e RN-12: "É Pastor(a)?", líder e "Tem Liderança?".
-- ===========================================================================
SELECT pg_temp.run('rn11_andre_pastor', 'authenticated', 7, pg_temp.upd(pg_temp.m(4), '{"is_pastor": true}'), pg_temp.row_of(pg_temp.m(4), 'is_pastor'));
SELECT pg_temp.run('rn11_andre_pastor_free', 'authenticated', 7, pg_temp.upd(pg_temp.m(4), '{"is_pastor": true, "leader_id": null}'),
  $q$SELECT concat_ws('|', is_pastor, leader_id IS NULL, has_leadership) FROM public.members WHERE name = 'André Lima'$q$);
SELECT pg_temp.run('rn11_samuel_leader', 'authenticated', 7, pg_temp.upd(pg_temp.m(1), jsonb_build_object('leader_id', pg_temp.m(2))));
SELECT pg_temp.run('rn11_samuel_flag', 'authenticated', 7, pg_temp.upd(pg_temp.m(1), '{"has_leadership": true}'));
SELECT pg_temp.run('rn11_ester_leader', 'authenticated', 7, pg_temp.upd(pg_temp.m(9), jsonb_build_object('leader_id', pg_temp.m(4))), pg_temp.row_of(pg_temp.m(9), 'has_leadership'));
SELECT pg_temp.run('rn11_ester_flag', 'authenticated', 7, pg_temp.upd(pg_temp.m(9), '{"has_leadership": true}'));
SELECT pg_temp.run('rn12_ins_omitted', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"leader_id": null}')));
SELECT pg_temp.run('rn12_ins_off', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"leader_id": null, "has_leadership": false}')), pg_temp.col_of_new('has_leadership'));
SELECT pg_temp.run('rn12_ins_pastor', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"leader_id": null, "is_pastor": true}')), pg_temp.col_of_new('has_leadership'));
SELECT pg_temp.run('rn12_ins_leader', 'authenticated', 7, pg_temp.ins(pg_temp.newm()), pg_temp.col_of_new('has_leadership'));
SELECT pg_temp.run('rn12_ins_pastor_flag_on', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"leader_id": null, "is_pastor": true, "has_leadership": true}')));
SELECT pg_temp.run('rn12_pedro_omitted', 'authenticated', 3, pg_temp.ins(pg_temp.newm('{"leader_id": null}')));
SELECT pg_temp.run('rn12_pedro_off', 'authenticated', 3, pg_temp.ins(pg_temp.newm('{"leader_id": null, "has_leadership": false}')));
SELECT pg_temp.run('rn12_caio_noleader', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"leader_id": null}'), pg_temp.row_of(pg_temp.m(5), 'leader_id'));
SELECT pg_temp.run('rn12_caio_off', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"leader_id": null, "has_leadership": false}'),
  $q$SELECT concat_ws('|', leader_id IS NULL, has_leadership) FROM public.members WHERE name = 'Caio Souza'$q$);
SELECT pg_temp.run('rn12_pedro_andre_off', 'authenticated', 3, pg_temp.upd(pg_temp.m(4), '{"leader_id": null, "has_leadership": false}'));
SELECT pg_temp.run('rn12_caio_flag_off', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"has_leadership": false}'),
  $q$SELECT concat_ws('|', leader_id IS NOT NULL, has_leadership) FROM public.members WHERE name = 'Caio Souza'$q$);
SELECT pg_temp.run('rn12_samuel_unpastor', 'authenticated', 7, pg_temp.upd(pg_temp.m(1), '{"is_pastor": false}'));
SELECT pg_temp.run('rn12_samuel_unpastor_off', 'authenticated', 7, pg_temp.upd(pg_temp.m(1), '{"is_pastor": false, "has_leadership": false}'),
  $q$SELECT concat_ws('|', is_pastor, has_leadership) FROM public.members WHERE name = 'Samuel Colares'$q$);
SELECT pg_temp.run('rn12_magda_unpastor', 'authenticated', 7, pg_temp.upd(pg_temp.m(2), '{"is_pastor": false}'),
  $q$SELECT concat_ws('|', is_pastor, leader_id IS NULL, has_leadership) FROM public.members WHERE name = 'Magda Colares'$q$);

SELECT is(pg_temp.sig(r), 'pastor_with_leader|is_pastor|Pastor(a) não tem líder. Tire o líder ou desmarque "É Pastor(a)?".', 'RN-11: "É Pastor(a)?" ligado para André mantendo o líder') FROM rs WHERE k = 'rn11_andre_pastor';
SELECT is(r ->> 'after', 'false', 'RN-11: André não virou pastor') FROM rs WHERE k = 'rn11_andre_pastor';
SELECT is(r ->> 'after', 't|t|f', 'RN-11: André vira pastor tirando o líder: pastor, sem líder, "Tem Liderança?" desligado') FROM rs WHERE k = 'rn11_andre_pastor_free';
SELECT is(r ->> 'code', 'pastor_with_leader', 'RN-11: um líder para Samuel (pastor)') FROM rs WHERE k = 'rn11_samuel_leader';
SELECT is(pg_temp.sig(r), 'pastor_with_leader|is_pastor|Pastor(a) não tem líder. Tire o líder ou desmarque "É Pastor(a)?".', 'RN-11: "Tem Liderança?" ligado de propósito em Samuel, sem líder') FROM rs WHERE k = 'rn11_samuel_flag';
SELECT is(r ->> 'after', 'true', 'RN-11: Ester ganha líder sem mexer na chave: "Tem Liderança?" fica ligado') FROM rs WHERE k = 'rn11_ester_leader';
SELECT is(pg_temp.sig(r), 'leader_required|leader_id|Escolha o líder.', 'RN-11: ligar "Tem Liderança?" em Ester, sem líder') FROM rs WHERE k = 'rn11_ester_flag';
SELECT is(pg_temp.sig(r), 'leader_required|leader_id|Escolha o líder.', 'RN-12: Rita, cadastro novo sem líder, sem pastor e sem a chave') FROM rs WHERE k = 'rn12_ins_omitted';
SELECT is(r ->> 'after', 'false', 'RN-12: a mesma pessoa com "Tem Liderança?" desligado é aceita, sem liderança') FROM rs WHERE k = 'rn12_ins_off';
SELECT is(r ->> 'after', 'false', 'RN-12: o pastor com a chave omitida é aceito e fica com a chave desligada') FROM rs WHERE k = 'rn12_ins_pastor';
SELECT is(r ->> 'after', 'true', 'RN-12: o não pastor com líder e a chave omitida fica com a chave ligada') FROM rs WHERE k = 'rn12_ins_leader';
SELECT is(r ->> 'code', 'pastor_with_leader', 'RN-12: pastor com a chave ligada de propósito no cadastro novo é recusado') FROM rs WHERE k = 'rn12_ins_pastor_flag_on';
SELECT is(pg_temp.sig(r), 'leader_required|leader_id|Escolha o líder.', 'RN-12: Pedro, cadastro novo com a chave omitida e sem líder (RN-09 do E2.02, "Escolha o líder.")') FROM rs WHERE k = 'rn12_pedro_omitted';
SELECT is(r ->> 'code', 'pastor_or_no_leadership_requires_church', 'RN-12: Pedro, cadastro novo com a chave desligada: recusa da RN-10 do E2.02') FROM rs WHERE k = 'rn12_pedro_off';
SELECT is(r ->> 'code', 'leader_required', 'RN-12: Rita tira o líder de Caio sem desligar a chave') FROM rs WHERE k = 'rn12_caio_noleader';
SELECT is(r ->> 'after', pg_temp.m(4)::text, 'RN-12: o líder de Caio continua André') FROM rs WHERE k = 'rn12_caio_noleader';
SELECT is(r ->> 'after', 't|f', 'RN-12: com a chave desligada, Caio fica sem líder e sem liderança') FROM rs WHERE k = 'rn12_caio_off';
SELECT is(r ->> 'code', 'pastor_or_no_leadership_requires_church', 'RN-12: Pedro tira o líder de André e desliga a chave: recusa da RN-10 do E2.02') FROM rs WHERE k = 'rn12_pedro_andre_off';
SELECT is(r ->> 'after', 't|t', 'RN-12/DA-11 do E2.02: desligar só a chave de quem tem líder (Caio) não a desliga: o líder continua') FROM rs WHERE k = 'rn12_caio_flag_off';
SELECT is(r ->> 'ok', 'true', 'RN-12: só "É Pastor(a)?" desligado para Samuel: aceito (a chave gravada dele é desligada)') FROM rs WHERE k = 'rn12_samuel_unpastor';
SELECT is(r ->> 'after', 'f|f', 'RN-12: Samuel deixa de ser pastor desligando a chave e fica sem liderança') FROM rs WHERE k = 'rn12_samuel_unpastor_off';
SELECT is(r ->> 'after', 'f|t|f', 'RN-12: só "É Pastor(a)?" desligado para Magda: aceito, sem liderança (chave gravada desligada)') FROM rs WHERE k = 'rn12_magda_unpastor';

-- ===========================================================================
-- RN-13 líder; RN-14 cônjuge.
-- ===========================================================================
SELECT pg_temp.run('rn13_self', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), jsonb_build_object('leader_id', pg_temp.m(5))));
SELECT pg_temp.run('rn13_davi', 'authenticated', 7, pg_temp.upd(pg_temp.m(4), jsonb_build_object('leader_id', pg_temp.m(6))), pg_temp.row_of(pg_temp.m(4), 'leader_id'));
SELECT pg_temp.run('rn13_chain', 'authenticated', 7, pg_temp.upd(pg_temp.m(21), jsonb_build_object('leader_id', pg_temp.m(28))));
SELECT pg_temp.run('rn13_chain_ok', 'authenticated', 7, pg_temp.upd(pg_temp.m(28), jsonb_build_object('leader_id', pg_temp.m(1))), pg_temp.row_of(pg_temp.m(28), 'leader_id'));
SELECT pg_temp.run('rn13_deleted', 'authenticated', 7, pg_temp.upd(pg_temp.m(17), jsonb_build_object('leader_id', pg_temp.m(19))));
SELECT pg_temp.run('rn13_lucia_paulo', 'authenticated', 7,
  pg_temp.upd(pg_temp.m(15), jsonb_build_object('leader_id', pg_temp.m(16))) || '; ' || pg_temp.upd(pg_temp.m(16), jsonb_build_object('leader_id', pg_temp.m(15))));
SELECT pg_temp.run('rn13_old_cycle', 'authenticated', 7, pg_temp.upd(pg_temp.m(15), jsonb_build_object('leader_id', pg_temp.m(16))),
  pg_temp.row_of(pg_temp.m(15), 'leader_id'));
SELECT pg_temp.run('rn14_self', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), jsonb_build_object('spouse_id', pg_temp.m(5))), pg_temp.row_of(pg_temp.m(5), 'spouse_id'));
SELECT pg_temp.run('rn14_ins_self', 'service_role', NULL, pg_temp.ins(pg_temp.newm(jsonb_build_object('id', pg_temp.m(60), 'spouse_id', pg_temp.m(60)))));

SELECT is(pg_temp.sig(r), 'leader_self|leader_id|Uma pessoa não pode ser líder de si mesma.', 'RN-13: Caio como líder de Caio') FROM rs WHERE k = 'rn13_self';
SELECT is(pg_temp.sig(r), 'leader_cycle|leader_id|O líder escolhido é discípulo desta pessoa (direto ou indireto). Escolha outro líder.', 'RN-13: Davi (discípulo inativo de Caio) como líder de André') FROM rs WHERE k = 'rn13_davi';
SELECT is(r ->> 'after', pg_temp.m(3)::text, 'RN-13: André continua com o líder Pedro') FROM rs WHERE k = 'rn13_davi';
SELECT is(r ->> 'code', 'leader_cycle', 'RN-13: cadeia de 8 níveis, N8 como líder de N1') FROM rs WHERE k = 'rn13_chain';
SELECT is(r ->> 'after', pg_temp.m(1)::text, 'RN-13: N8 sob Samuel (sem ciclo) é aceito') FROM rs WHERE k = 'rn13_chain_ok';
SELECT is(r ->> 'code', 'leader_cycle', 'RN-13: a subida de X3 a X1 passa por um excluído (X2) e acha o ciclo') FROM rs WHERE k = 'rn13_deleted';
SELECT is(r ->> 'code', 'leader_cycle', 'RN-13: Lúcia → Paulo e Paulo → Lúcia em sequência: a segunda é recusada') FROM rs WHERE k = 'rn13_lucia_paulo';
SELECT is(r ->> 'ok', 'true', 'RN-13: Lúcia → Paulo sozinha é aceita') FROM rs WHERE k = 'rn13_old_cycle';
SELECT is(pg_temp.sig(r), 'spouse_self|spouse_id|Uma pessoa não pode ser cônjuge de si mesma.', 'RN-14: Caio como cônjuge de Caio') FROM rs WHERE k = 'rn14_self';
SELECT is(r ->> 'after', NULL, 'RN-14: nada muda') FROM rs WHERE k = 'rn14_self';
SELECT is(r ->> 'code', 'spouse_self', 'RN-14: cadastro novo com o próprio id como cônjuge') FROM rs WHERE k = 'rn14_ins_self';

-- ===========================================================================
-- RN-15 nascimento (relativo a sp_today()); RN-16 batismo; RN-17 dado antigo.
-- ===========================================================================
CREATE FUNCTION pg_temp.bd(_d date) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$ SELECT jsonb_build_object('birth_date', _d) $$;
SELECT pg_temp.run('rn15_tomorrow', 'authenticated', 7, pg_temp.ins(pg_temp.newm(pg_temp.bd(public.sp_today() + 1))));
SELECT pg_temp.run('rn15_today', 'authenticated', 7, pg_temp.ins(pg_temp.newm(pg_temp.bd(public.sp_today()))));
SELECT pg_temp.run('rn15_100y', 'authenticated', 7, pg_temp.ins(pg_temp.newm(pg_temp.bd((public.sp_today() - interval '100 years')::date))));
SELECT pg_temp.run('rn15_100y_plus1', 'authenticated', 7, pg_temp.ins(pg_temp.newm(pg_temp.bd((public.sp_today() - interval '100 years' + interval '1 day')::date))));
SELECT pg_temp.run('rn15_blank', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"birth_date": null}')));
SELECT pg_temp.run('rn15_leap', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"birth_date": "2000-02-29"}')), pg_temp.col_of_new('birth_date'));
SELECT pg_temp.run('rn15_fabio_name', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"name": "Fábio Lima"}'), pg_temp.row_of(pg_temp.m(12), 'birth_date'));
SELECT pg_temp.run('rn15_fabio_1921', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"birth_date": "1921-03-10"}'));
SELECT pg_temp.run('rn15_fabio_1960', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"birth_date": "1960-03-10"}'), pg_temp.row_of(pg_temp.m(12), 'birth_date'));
SELECT pg_temp.run('rn15_velho_phone', 'authenticated', 7, pg_temp.upd(pg_temp.m(20), '{"phone": "(51) 3333-0000"}'), pg_temp.row_of(pg_temp.m(20), 'phone'));
SELECT pg_temp.run('rn15_velho_birth', 'authenticated', 7, pg_temp.upd(pg_temp.m(20), pg_temp.bd((public.sp_today() - interval '100 years' - interval '5 days')::date)));

SELECT is(pg_temp.sig(r), 'birth_date_future|birth_date|A data de nascimento não pode ser futura.', 'RN-15: amanhã é recusado') FROM rs WHERE k = 'rn15_tomorrow';
SELECT is(r ->> 'ok', 'true', 'RN-15: hoje é aceito') FROM rs WHERE k = 'rn15_today';
SELECT is(pg_temp.sig(r), 'birth_date_too_old|birth_date|Confira a data de nascimento: a pessoa teria 100 anos ou mais.', 'RN-15: hoje menos 100 anos é recusado') FROM rs WHERE k = 'rn15_100y';
SELECT is(r ->> 'ok', 'true', 'RN-15: hoje menos 100 anos mais um dia é aceito') FROM rs WHERE k = 'rn15_100y_plus1';
SELECT is(r ->> 'ok', 'true', 'RN-15: data em branco é aceita') FROM rs WHERE k = 'rn15_blank';
SELECT is(r ->> 'after', '2000-02-29', 'RN-15: 29/02/2000 é aceito') FROM rs WHERE k = 'rn15_leap';
SELECT is(r ->> 'after', '1920-03-10', 'RN-15/RN-17: Fábio muda o nome e o nascimento de 1920 continua') FROM rs WHERE k = 'rn15_fabio_name';
SELECT is(r ->> 'code', 'birth_date_too_old', 'RN-15: o nascimento de Fábio para 10/03/1921 é recusado') FROM rs WHERE k = 'rn15_fabio_1921';
SELECT is(r ->> 'after', '1960-03-10', 'RN-15: o nascimento de Fábio para 10/03/1960 é aceito') FROM rs WHERE k = 'rn15_fabio_1960';
SELECT is(r ->> 'after', '(51) 3333-0000', 'RN-15: mudar o telefone de quem tem nascimento antigo é aceito') FROM rs WHERE k = 'rn15_velho_phone';
SELECT is(r ->> 'ok', 'true', 'RN-15/RN-17: regravar o mesmo nascimento antigo não conta como mudado') FROM rs WHERE k = 'rn15_velho_birth';

SELECT pg_temp.run('rn16_off', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"is_baptized": false}'),
  $q$SELECT concat_ws('|', is_baptized, baptism_date IS NULL) FROM public.members WHERE name = 'Caio Souza'$q$);
SELECT pg_temp.run('rn16_off_date', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"is_baptized": false, "baptism_date": "2020-05-10"}'),
  $q$SELECT concat_ws('|', is_baptized, baptism_date IS NULL) FROM public.members WHERE name = 'Caio Souza'$q$);
SELECT pg_temp.run('rn16_off_newdate', 'authenticated', 7, pg_temp.upd(pg_temp.m(5), '{"is_baptized": false, "baptism_date": "2021-01-01"}'));
SELECT pg_temp.run('rn16_davi_date', 'authenticated', 7, pg_temp.upd(pg_temp.m(6), '{"baptism_date": "2020-05-10"}'));
SELECT pg_temp.run('rn16_davi_on', 'authenticated', 7, pg_temp.upd(pg_temp.m(6), '{"is_baptized": true}'), pg_temp.row_of(pg_temp.m(6), 'is_baptized'));
SELECT pg_temp.run('rn16_davi_on_date', 'authenticated', 7, pg_temp.upd(pg_temp.m(6), '{"is_baptized": true, "baptism_date": "2020-05-10"}'), pg_temp.row_of(pg_temp.m(6), 'baptism_date'));
SELECT pg_temp.run('rn16_ins', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"baptism_date": "2020-05-10"}')));

SELECT is(r ->> 'after', 'f|t', 'RN-16: só "Batizado(a)?" desligado para Caio: aceito, e a data é apagada') FROM rs WHERE k = 'rn16_off';
SELECT is(r ->> 'after', 'f|t', 'RN-16: desligar e reenviar a mesma data (a tela manda todos os campos): aceito, e a data é apagada') FROM rs WHERE k = 'rn16_off_date';
SELECT is(pg_temp.sig(r), 'baptism_date_without_baptism|baptism_date|A data do batismo só pode ser informada para quem é batizado(a).', 'RN-16: desligar e mandar uma data nova na mesma gravação é recusado') FROM rs WHERE k = 'rn16_off_newdate';
SELECT is(pg_temp.sig(r), 'baptism_date_without_baptism|baptism_date|A data do batismo só pode ser informada para quem é batizado(a).', 'RN-16: a data para Davi, que não é batizado') FROM rs WHERE k = 'rn16_davi_date';
SELECT is(r ->> 'after', 'true', 'RN-16: ligar "Batizado(a)?" para Davi, sem data, é aceito') FROM rs WHERE k = 'rn16_davi_on';
SELECT is(r ->> 'after', '2020-05-10', 'RN-16: ligar "Batizado(a)?" para Davi, com data, é aceito') FROM rs WHERE k = 'rn16_davi_on_date';
SELECT is(r ->> 'code', 'baptism_date_without_baptism', 'RN-16: cadastro novo com data e sem "Batizado(a)?"') FROM rs WHERE k = 'rn16_ins';

-- RN-17: Fábio salvo sem mudar nada, e Pedro (sem dados sensíveis).
SELECT pg_temp.run('rn17_same', 'authenticated', 7,
  pg_temp.upd(pg_temp.m(12), '{"name": "Fábio", "mobile_whatsapp": "98887777", "birth_date": "1920-03-10"}'),
  $q$SELECT concat_ws('|', name, mobile_whatsapp, birth_date) FROM public.members WHERE name = 'Fábio'$q$);
SELECT pg_temp.run('rn17_pedro', 'authenticated', 3, pg_temp.upd(pg_temp.m(12), '{"notes": "Pedro viu"}'),
  $q$SELECT concat_ws('|', name, mobile_whatsapp, birth_date, notes) FROM public.members WHERE notes = 'Pedro viu'$q$);
SELECT pg_temp.run('rn17_valid_mobile', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"mobile_whatsapp": "(51) 98887-7770"}'), pg_temp.row_of(pg_temp.m(12), 'mobile_whatsapp'));
SELECT pg_temp.run('rn17_bad_mobile', 'authenticated', 7, pg_temp.upd(pg_temp.m(12), '{"mobile_whatsapp": "9888-7770"}'));
SELECT pg_temp.run('rn17_sensitive', 'authenticated', 3, pg_temp.upd(pg_temp.m(12), '{"mobile_whatsapp": "(51) 98887-7770", "birth_date": "1960-03-10", "name": "Fábio X"}'),
  $q$SELECT concat_ws('|', name, mobile_whatsapp, birth_date) FROM public.members WHERE notes IS NULL AND name LIKE 'Fábio%'$q$);

SELECT is(r ->> 'after', 'Fábio|98887777|1920-03-10', 'RN-17: Fábio salvo sem mudança: nome, celular e nascimento continuam') FROM rs WHERE k = 'rn17_same';
SELECT is(r ->> 'ok', 'true', 'RN-17: Pedro muda as observações de Fábio: aceito') FROM rs WHERE k = 'rn17_pedro';
SELECT is(r ->> 'after', 'Fábio|98887777|1920-03-10|Pedro viu', 'RN-17: Pedro não muda nem recebe recusa nos campos sensíveis de Fábio') FROM rs WHERE k = 'rn17_pedro';
SELECT is(r ->> 'after', '51988877770', 'RN-17: Fábio para "(51) 98887-7770" é aceito') FROM rs WHERE k = 'rn17_valid_mobile';
SELECT is(pg_temp.sig(r), 'mobile_invalid|mobile_whatsapp|Celular inválido. Informe o DDD e o número.', 'RN-17: Fábio para "9888-7770" é recusado') FROM rs WHERE k = 'rn17_bad_mobile';

-- ===========================================================================
-- RN-19: a ordem da DA-11 (a primeira recusa vence) e "recusado quer dizer nada gravado".
-- ===========================================================================
CREATE FUNCTION pg_temp.order_case(_k text, _j jsonb, _expected text, _label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rs VALUES (_k, pg_temp.scenario(NULL, 'authenticated', 7, pg_temp.ins(pg_temp.newm(_j))));
END $$;
SELECT pg_temp.order_case('o1', '{"name": "Lúcia", "email": "lucia@", "cpf": "111.111.111-11", "gender": null}', NULL, NULL);
SELECT pg_temp.order_case('o2', '{"name": "Lúcia", "cpf": "529.982.247-25"}', NULL, NULL);
SELECT pg_temp.order_case('o3', '{"gender": null, "birth_date": "2999-01-01"}', NULL, NULL);
SELECT pg_temp.order_case('o4', '{"birth_date": "2999-01-01", "mobile_whatsapp": "123"}', NULL, NULL);
SELECT pg_temp.order_case('o5', '{"mobile_whatsapp": "123", "email": "x@mci12fakemail.com"}', NULL, NULL);
SELECT pg_temp.order_case('o6', '{"mobile_whatsapp": null, "email": "x@mci12fakemail.com", "cpf": "111.111.111-11"}', NULL, NULL);
SELECT pg_temp.order_case('o7', '{"mobile_whatsapp": null, "email": "x@exemplo", "cpf": "111.111.111-11"}', NULL, NULL);
SELECT pg_temp.order_case('o8', '{"cpf": "111.111.111-11", "leader_id": null}', NULL, NULL);
SELECT pg_temp.order_case('o9', '{"leader_id": null, "baptism_date": "2020-05-10"}', NULL, NULL);
SELECT pg_temp.order_case('o10', '{"baptism_date": "2020-05-10", "email": "caio@exemplo.com"}', NULL, NULL);
SELECT pg_temp.order_case('o11', '{"mobile_whatsapp": "(51) 98888-7777", "email": "bruna@exemplo.com"}', NULL, NULL);
SELECT pg_temp.order_case('o12', '{"email": "bruna@exemplo.com"}', NULL, NULL);
SELECT pg_temp.order_case('o13', '{"email": "caio@exemplo.com", "cpf": "012.345.678-90"}', NULL, NULL);
SELECT pg_temp.order_case('o14', '{"name": "Lúcia", "gender": null, "mobile_whatsapp": null, "leader_id": null}', NULL, NULL);

SELECT is(r ->> 'code', 'name_invalid', 'DA-11: nome inválido, e-mail inválido, CPF inválido e sem sexo: vem o nome') FROM rs WHERE k = 'o1';
SELECT is(r ->> 'code', 'name_invalid', 'DA-11: nome inválido e CPF em uso: vem o nome') FROM rs WHERE k = 'o2';
SELECT is(r ->> 'code', 'gender_required', 'DA-11: sem sexo e nascimento futuro: vem o sexo') FROM rs WHERE k = 'o3';
SELECT is(r ->> 'code', 'birth_date_future', 'DA-11: nascimento futuro e celular inválido: vem o nascimento') FROM rs WHERE k = 'o4';
SELECT is(r ->> 'code', 'mobile_invalid', 'DA-11: celular inválido e e-mail fictício: vem o celular') FROM rs WHERE k = 'o5';
SELECT is(r ->> 'code', 'email_placeholder', 'DA-11: e-mail fictício e CPF inválido: vem o e-mail fictício') FROM rs WHERE k = 'o6';
SELECT is(r ->> 'code', 'email_invalid', 'DA-11: e-mail inválido e CPF inválido: vem o e-mail') FROM rs WHERE k = 'o7';
SELECT is(r ->> 'code', 'cpf_invalid', 'DA-11: CPF inválido e líder faltando: vem o CPF (com o celular informado)') FROM rs WHERE k = 'o8';
SELECT is(r ->> 'code', 'leader_required', 'DA-11: líder faltando e data de batismo sem batismo: vem o líder') FROM rs WHERE k = 'o9';
SELECT is(r ->> 'code', 'baptism_date_without_baptism', 'DA-11: data de batismo sem batismo e e-mail em uso: vem o batismo') FROM rs WHERE k = 'o10';
SELECT is(r ->> 'code', 'value_in_use', 'DA-11/RN-19: celular em uso e e-mail de excluído: vem value_in_use, sem deleted_account_email') FROM rs WHERE k = 'o11';
SELECT is(r ->> 'code', 'deleted_account_email', 'DA-11: só o e-mail da conta de um excluído: deleted_account_email') FROM rs WHERE k = 'o12';
SELECT is(r ->> 'code', 'value_in_use', 'DA-11/RN-19: e-mail em uso e CPF de um excluído: value_in_use') FROM rs WHERE k = 'o13';
SELECT is(r ->> 'code', 'name_invalid', 'DA-11: o nome vem antes do sexo, do identificador e do líder') FROM rs WHERE k = 'o14';
SELECT is(pg_temp.sig(r), 'deleted_account_email|email|Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.', 'AQ-1: mensagem exata do deleted_account_email') FROM rs WHERE k = 'o12';

-- RN-19: nada gravado em recusa; o cônjuge não muda.
SELECT pg_temp.run('rn19_nothing', 'authenticated', 7, pg_temp.ins(pg_temp.newm('{"name": "Lúcia", "email": "caio@exemplo.com"}')),
  $q$SELECT count(*)::text FROM public.members WHERE mobile_whatsapp = '51988881234'$q$);
SELECT pg_temp.run('rn19_spouse', 'authenticated', 7, pg_temp.upd(pg_temp.m(9), jsonb_build_object('name', 'Ester', 'spouse_id', pg_temp.m(11))),
  $q$SELECT concat_ws('|', (SELECT spouse_id FROM public.members WHERE id = $q$ || quote_literal(pg_temp.m(11)) || $q$) = $q$ || quote_literal(pg_temp.m(10))
  || $q$, (SELECT spouse_id IS NULL FROM public.members WHERE id = $q$ || quote_literal(pg_temp.m(9)) || $q$)) $q$);
SELECT is(r ->> 'after', '0', 'RN-19: cadastro recusado não deixa linha') FROM rs WHERE k = 'rn19_nothing';
SELECT is(r ->> 'code', 'name_invalid', 'RN-19: Ester com nome inválido e Olga de cônjuge: recusado') FROM rs WHERE k = 'rn19_spouse';
SELECT is(r ->> 'after', 't|t', 'RN-19: nem Ester nem Olga mudam; Olga continua casada com Otávio') FROM rs WHERE k = 'rn19_spouse';

-- ===========================================================================
-- Invariantes.
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM private.member_rule_violations() v WHERE v.member_id::text LIKE 'c2040200-%'
            AND v.member_id NOT IN (pg_temp.m(12), pg_temp.m(20))), 0,
  'invariante: nenhum cadastro da massa viola as regras do tipo (a) (Fábio e Velho são dado do legado e passam pelos CHECKs)');

SELECT * FROM finish();

ROLLBACK;
