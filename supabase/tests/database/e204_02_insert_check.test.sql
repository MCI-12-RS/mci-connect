-- E2.04 (PR 2): o ensaio check_member_insert (DT-12): as mesmas recusas do INSERT real, nada
-- gravado, nenhum evento de Auditoria, o id vindo do cliente e "Tem Liderança?" nulo resolvido.
-- Spec: docs/specs/e2-04-validacoes-membro.md, "Verificações obrigatórias" (Ensaio), DT-06, DT-12,
-- RN-19, RN-09, RN-10.
-- Massa (dados fictícios): Samuel e Magda (pastores), Pedro (Líder: cria e edita, vê só o
-- ministério, sem dados sensíveis), André, Caio (Membro, batizado em 10/05/2020), Davi (inativo),
-- Rita (Administrador), Diego (CPF 529.982.247-25, fora do ministério de Pedro), Ester (sem
-- liderança), Otávio e Olga (casal), Fábio (do legado, carregado em replica), Bruno e Bruna
-- (excluídos), Lúcia e Paulo, a cadeia N1 a N8 e X1, X2 (excluído) e X3.
-- "Hoje" é sp_today(): as datas dos casos são relativas a ele.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(28);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2040201-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2040201-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192043' || lpad(_n::text, 4, '0') $$;

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


-- O ensaio e o INSERT real devem dar o mesmo código para o mesmo corpo.
CREATE FUNCTION pg_temp.ens(_j jsonb) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT public.check_member_insert(%L::jsonb)', _j) $$;
CREATE FUNCTION pg_temp.pair(_k text, _n int, _j jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO rs VALUES (_k || '_real', pg_temp.scenario(NULL, 'authenticated', _n, pg_temp.ins(_j)));
  INSERT INTO rs VALUES (_k || '_ens', pg_temp.scenario(NULL, 'authenticated', _n, pg_temp.ens(_j)));
$$;
SELECT pg_temp.pair('ok', 7, pg_temp.newm());
SELECT pg_temp.pair('name', 7, pg_temp.newm('{"name": "Ana"}'));
SELECT pg_temp.pair('gender', 7, pg_temp.newm('{"gender": null}'));
SELECT pg_temp.pair('cpf', 7, pg_temp.newm('{"cpf": "111.111.111-11"}'));
SELECT pg_temp.pair('email_use', 7, pg_temp.newm('{"email": "caio@exemplo.com"}'));
SELECT pg_temp.pair('two_use', 3, pg_temp.newm('{"email": "caio@exemplo.com", "cpf": "529.982.247-25"}'));
SELECT pg_temp.pair('fake', 7, pg_temp.newm('{"email": "a@mci12fakemail.com"}'));
SELECT pg_temp.pair('ident', 7, pg_temp.newm('{"mobile_whatsapp": null}'));
SELECT pg_temp.pair('leader', 7, pg_temp.newm('{"leader_id": null}'));
SELECT pg_temp.pair('pastor', 7, pg_temp.newm('{"leader_id": null, "is_pastor": true, "has_leadership": true}'));
SELECT pg_temp.pair('baptism', 7, pg_temp.newm('{"baptism_date": "2020-05-10"}'));
SELECT pg_temp.pair('deleted_mail', 7, pg_temp.newm('{"email": "bruna@exemplo.com"}'));
SELECT pg_temp.pair('noperm', 5, pg_temp.newm('{"name": "Ana"}'));
SELECT pg_temp.pair('pedro_off', 3, pg_temp.newm('{"leader_id": null, "has_leadership": false}'));

SELECT is(pg_temp.sig(e.r), pg_temp.sig(x.r), 'ensaio = INSERT real: ' || regexp_replace(e.k, '_ens$', ''))
  FROM rs e JOIN rs x ON x.k = replace(e.k, '_ens', '_real') WHERE e.k LIKE '%\_ens' ORDER BY e.k;
SELECT is(r ->> 'ok', 'true', 'ensaio de um cadastro válido não dá erro') FROM rs WHERE k = 'ok_ens';
SELECT is(r ->> 'code', 'name_invalid', 'ensaio: name_invalid') FROM rs WHERE k = 'name_ens';
SELECT is(r ->> 'code', '42501', 'ensaio: sem create_member, 42501 antes de qualquer regra') FROM rs WHERE k = 'noperm_ens';
SELECT is(r ->> 'fields', '["email", "cpf"]', 'ensaio: value_in_use com dois campos') FROM rs WHERE k = 'two_use_ens';

-- Nada gravado nem auditado, ensaio válido ou recusado, e o id vindo do cliente.
SELECT pg_temp.run('side_ok', 'authenticated', 7, pg_temp.ens(pg_temp.newm(jsonb_build_object('id', pg_temp.m(90)))),
  format($q$SELECT concat_ws('|', (SELECT count(*) FROM public.members WHERE id = %L), (SELECT count(*) FROM public.members WHERE name = 'Lúcia Nova'), (SELECT count(*) FROM public.events) - %s)$q$,
         pg_temp.m(90), (SELECT n FROM ev0)));
SELECT pg_temp.run('side_fail', 'authenticated', 7, pg_temp.ens(pg_temp.newm('{"name": "Ana"}')),
  format($q$SELECT concat_ws('|', (SELECT count(*) FROM public.members WHERE name = 'Ana'), (SELECT count(*) FROM public.events) - %s)$q$, (SELECT n FROM ev0)));
SELECT pg_temp.run('id_taken', 'authenticated', 7, pg_temp.ens(pg_temp.newm(jsonb_build_object('id', pg_temp.m(5)))));
SELECT pg_temp.run('id_other', 'authenticated', 7, pg_temp.ens(pg_temp.newm(jsonb_build_object('id', pg_temp.m(90)))));
SELECT is(r ->> 'after', '0|0|0', 'ensaio válido: nada gravado (nem o id) e nenhum evento de Auditoria') FROM rs WHERE k = 'side_ok';
SELECT is(r ->> 'after', '0|0', 'ensaio recusado: nada gravado e nenhum evento') FROM rs WHERE k = 'side_fail';
SELECT is(r ->> 'state', '23505', 'ensaio grava o id do cliente: um id já usado colide (23505)') FROM rs WHERE k = 'id_taken';
SELECT is(r ->> 'ok', 'true', 'ensaio: um id novo passa') FROM rs WHERE k = 'id_other';

-- has_leadership nulo: o ensaio resolve como o INSERT (líder → ligado; pastor → desligado; senão leader_required).
SELECT pg_temp.run('hl_leader', 'authenticated', 7, pg_temp.ens(pg_temp.newm()));
SELECT pg_temp.run('hl_pastor', 'authenticated', 7, pg_temp.ens(pg_temp.newm('{"leader_id": null, "is_pastor": true}')));
SELECT pg_temp.run('hl_none', 'authenticated', 7, pg_temp.ens(pg_temp.newm('{"leader_id": null}')));
SELECT pg_temp.run('hl_off', 'authenticated', 7, pg_temp.ens(pg_temp.newm('{"leader_id": null, "has_leadership": false}')));
SELECT is(r ->> 'ok', 'true', 'ensaio: líder e chave omitida: aceito') FROM rs WHERE k = 'hl_leader';
SELECT is(r ->> 'ok', 'true', 'ensaio: pastor com a chave omitida: aceito') FROM rs WHERE k = 'hl_pastor';
SELECT is(r ->> 'code', 'leader_required', 'ensaio: sem líder, sem pastor e a chave omitida: leader_required') FROM rs WHERE k = 'hl_none';
SELECT is(r ->> 'ok', 'true', 'ensaio: sem liderança de propósito (Rita): aceito') FROM rs WHERE k = 'hl_off';

-- Grants.
SELECT ok(has_function_privilege('authenticated', 'public.check_member_insert(jsonb)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.check_member_insert(jsonb)', 'EXECUTE'),
  'check_member_insert: authenticated sim, anon não');

SELECT is((SELECT count(*)::int FROM private.member_rule_violations() v WHERE v.member_id::text LIKE 'c2040201-%'), 0,
  'invariante: private.member_rule_violations() sem linhas da massa');

SELECT * FROM finish();

ROLLBACK;
