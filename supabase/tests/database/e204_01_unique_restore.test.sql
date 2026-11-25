-- E2.04 (PR 1): unicidade de e-mail, celular e CPF entre os não excluídos (índices
-- members_{email,mobile,cpf}_key), _member_values_in_use, restore_member com a chave do 9º dígito
-- e find_deleted_member_matches com a mesma chave.
-- Spec: docs/specs/e2-04-validacoes-membro.md, RN-09 (todas as linhas), RN-10, DA-5, DA-6, DT-03,
-- DT-07, DT-09, DT-14, "Unicidade (migration 1)", "Ajustes no E2.01 (migration 1)".
-- Massa (dados fictícios): Samuel, Rita (Administrador), Pedro (Líder), Caio, Lúcia, Davi
-- (inativo), Diego (CPF), Otávio e Olga (casal), Paulo (celular de 10 dígitos), Bruno e Bruna
-- (excluídos).
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(50);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2041100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2041100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e204-' || n || '@teste.invalid' FROM generate_series(1, 4) n;

-- 1 Samuel (pastor), 2 Rita (Administrador), 3 Caio (Membro), 4 Pedro (Líder).
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, email, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Samuel Colares', 'M', true, NULL, pg_temp.u(1), pg_temp.role('Líder'), 'samuel@exemplo.com', NULL),
  (pg_temp.m(2), 'Rita Admin', 'F', false, pg_temp.m(1), pg_temp.u(2), pg_temp.role('Administrador'), 'rita@exemplo.com', NULL),
  (pg_temp.m(3), 'Caio Souza', 'M', false, pg_temp.m(1), pg_temp.u(3), pg_temp.role('Membro'), 'caio@exemplo.com', '(51) 98888-7777'),
  (pg_temp.m(4), 'Pedro Lima', 'M', false, pg_temp.m(1), pg_temp.u(4), pg_temp.role('Líder'), 'pedro@exemplo.com', NULL);
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, email, mobile_whatsapp, cpf, is_active) VALUES
  (pg_temp.m(5), 'Lúcia Prado', 'F', false, pg_temp.m(1), 'lucia@exemplo.com', '51977770001', NULL, true),
  (pg_temp.m(6), 'Davi Souza', 'M', false, pg_temp.m(3), 'davi@exemplo.com', NULL, NULL, false),
  (pg_temp.m(7), 'Diego Rocha', 'M', false, pg_temp.m(1), NULL, NULL, '529.982.247-25', true),
  (pg_temp.m(8), 'Otávio Reis', 'M', false, pg_temp.m(1), NULL, '(51) 97777-0000', NULL, true),
  (pg_temp.m(9), 'Olga Reis', 'F', false, pg_temp.m(1), 'olga@exemplo.com', NULL, NULL, true),  -- E2.04: identificador (RN-08)
  (pg_temp.m(10), 'Paulo Fixo', 'M', false, pg_temp.m(1), NULL, '(51) 8888-1111', NULL, true);
UPDATE public.members SET spouse_id = pg_temp.m(9) WHERE id = pg_temp.m(8);

-- Bruno e Bruna: excluídos (E2.01), carregados direto (a exclusão pela RPC é testada no E2.01).
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, email, mobile_whatsapp, cpf, deleted_at) VALUES
  (pg_temp.m(11), 'Bruno Alves', 'M', false, pg_temp.m(1), true, 'bruno@exemplo.com', '(51) 8888-0000', '01234567890', now()),  -- CPF só com dígitos (CHECK do E2.04)
  (pg_temp.m(12), 'Bruna Alves', 'F', false, pg_temp.m(1), true, NULL, '51988882222', NULL, now());
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- Tenta o comando e desfaz: 'accepted', 'unique:<índice>' ou 'error:<sqlstate>'.
-- E2.04 (PR 2): o trigger ad_enforce_member_rules recusaria antes, com value_in_use. Aqui se
-- prova o índice, que é a garantia (DT-07): o trigger sai só dentro da tentativa (o a0_ continua
-- normalizando). As recusas do trigger são testadas nos e204_02_*.
CREATE FUNCTION pg_temp.attempt(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _c text;
BEGIN
  BEGIN
    ALTER TABLE public.members DISABLE TRIGGER ad_enforce_member_rules;
    EXECUTE _sql;
    RAISE EXCEPTION 'undo' USING ERRCODE = 'XU001';
  EXCEPTION
    WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS _c = CONSTRAINT_NAME;
      RETURN 'unique:' || _c;
    WHEN SQLSTATE 'XU001' THEN RETURN 'accepted';
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS _c = RETURNED_SQLSTATE;
      RETURN 'error:' || _c;
  END;
END $$;

-- Cenário: _setup como postgres, _call como o usuário n (papel authenticated), _after como
-- postgres. Desfaz tudo. Devolve {ok, code, message, fields, after}.
CREATE FUNCTION pg_temp.scenario(_setup text, _n int, _call text, _after text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text; _detail text; _hint text; _res jsonb; _aft text;
BEGIN
  BEGIN
    IF _setup IS NOT NULL THEN EXECUTE _setup; END IF;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    BEGIN
      EXECUTE _call;
      EXECUTE 'RESET ROLE';
      _res := jsonb_build_object('ok', true);
    EXCEPTION WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                              _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
      _res := jsonb_build_object('ok', false, 'state', _state, 'message', _msg,
        'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%' THEN _detail::jsonb ->> 'code' ELSE _state END,
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

-- ---------------------------------------------------------------------------
-- RN-09: os três índices, entre os não excluídos.
-- ---------------------------------------------------------------------------
-- Modelo de INSERT: pastor, para não depender de líder.
CREATE FUNCTION pg_temp.ins(_email text, _mobile text, _cpf text) RETURNS text LANGUAGE sql AS
$$ SELECT format('INSERT INTO public.members (name, gender, is_pastor, email, mobile_whatsapp, cpf) VALUES (''Novo Teste'', ''M'', true, %L, %L, %L)',
                 _email, _mobile, _cpf) $$;

SELECT is(pg_temp.attempt(pg_temp.ins(' CAIO@Exemplo.COM ', NULL, NULL)), 'unique:members_email_key',
  'RN-09: e-mail sem diferenciar maiúsculas nem espaços das pontas');
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, '(51) 8888-7777', NULL)), 'unique:members_mobile_key',
  'RN-09: 9º dígito, guardado com 9 e novo sem 9 (51988887777 x 5188887777)');
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, '+55 (51) 98888-1111', NULL)), 'unique:members_mobile_key',
  'RN-09: 9º dígito no outro sentido, guardado sem 9 e novo com 9 (5188881111 x 51988881111)');
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, '051 98888-7777', NULL)), 'unique:members_mobile_key',
  'RN-09: o celular é lido como no login (zero à esquerda)');
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, NULL, '529.982.247-25')), 'unique:members_cpf_key', 'RN-09: CPF com máscara');
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, NULL, '52998224725')), 'unique:members_cpf_key', 'RN-09: CPF pelos 11 dígitos');
SELECT is(pg_temp.attempt(pg_temp.ins('davi@exemplo.com', NULL, NULL)), 'unique:members_email_key',
  'RN-09: o cadastro inativo (Davi) conta');
SELECT is(pg_temp.attempt('UPDATE public.members SET mobile_whatsapp = ''(51) 97777-0000'' WHERE id = ' || quote_literal(pg_temp.m(9))),
  'unique:members_mobile_key', 'RN-09: o cônjuge conta (Olga com o celular de Otávio)');
SELECT is(pg_temp.attempt('UPDATE public.members SET email = ''lucia@exemplo.com'' WHERE id = ' || quote_literal(pg_temp.m(3))),
  'unique:members_email_key', 'RN-09: a troca de e-mail para o de outro cadastro é recusada');
SELECT is(pg_temp.attempt('UPDATE public.members SET cpf = ''529.982.247-25'' WHERE id = ' || quote_literal(pg_temp.m(5))),
  'unique:members_cpf_key', 'RN-09: a troca de CPF para o de outro cadastro é recusada');

-- Excluídos não contam (DEL-04); o dado de quem foi excluído é usado por outro cadastro.
SELECT is(pg_temp.attempt(pg_temp.ins('bruno@exemplo.com', '(51) 98888-0000', '012.345.678-90')), 'accepted',
  'DEL-04: e-mail, celular (pelo 9º dígito) e CPF de um excluído podem ser usados');
-- Celular ilegível e valores vazios ficam fora da unicidade (DA-5).
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, '98887777', NULL) || '; ' || pg_temp.ins(NULL, '98887777', NULL)), 'accepted',
  'DA-5: celular ilegível repetido é aceito');
SELECT is(pg_temp.attempt(pg_temp.ins(NULL, NULL, NULL) || '; ' || pg_temp.ins('', '', '')), 'accepted',
  'valores vazios repetidos são aceitos');
-- Dado liberado: Caio troca o e-mail, e Lúcia passa a usar o antigo.
SELECT is(pg_temp.attempt('UPDATE public.members SET email = ''caio.novo@exemplo.com'' WHERE id = ' || quote_literal(pg_temp.m(3))
    || '; UPDATE public.members SET email = ''caio@exemplo.com'' WHERE id = ' || quote_literal(pg_temp.m(5))),
  'accepted', 'RN-09: o dado que Caio largou fica livre para Lúcia');
-- Salvar o próprio cadastro sem mudar nada não colide consigo mesmo.
SELECT is(pg_temp.attempt('UPDATE public.members SET email = email, mobile_whatsapp = mobile_whatsapp, cpf = cpf WHERE id = ' || quote_literal(pg_temp.m(3))),
  'accepted', 'RN-09: o cadastro não colide consigo mesmo');
-- A restauração libera de novo: um excluído deixa o dado livre (exclusão por UPDATE em replica).
SELECT is(pg_temp.attempt('SET LOCAL session_replication_role = replica; UPDATE public.members SET deleted_at = now() WHERE id = '
    || quote_literal(pg_temp.m(6)) || '; SET LOCAL session_replication_role = origin; ' || pg_temp.ins('davi@exemplo.com', NULL, NULL)),
  'accepted', 'RN-09: excluir libera o e-mail (o inativo Davi, excluído)');

-- ---------------------------------------------------------------------------
-- _member_values_in_use (DT-07, DT-09).
-- ---------------------------------------------------------------------------
-- E2.04 (PR 2): os INSERTs da massa já pegaram as travas por valor (trigger ad_), que duram até
-- o fim da transação; as contagens abaixo são a partir delas.
CREATE TEMP TABLE lk0 ON COMMIT DROP AS
  SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid();
SELECT is(public._member_values_in_use(NULL, 'caio@exemplo.com', '(51) 8888-7777', '529.982.247-25', false),
  ARRAY['email', 'mobile', 'cpf']::text[], 'RN-10: devolve os três campos em uso, na ordem e-mail, celular, CPF');
SELECT is(public._member_values_in_use(NULL, NULL, '51988887777', '52998224725', false),
  ARRAY['mobile', 'cpf']::text[], 'RN-10: só os campos em uso, mesma ordem');
SELECT is(public._member_values_in_use(pg_temp.m(3), 'caio@exemplo.com', '(51) 98888-7777', NULL, false),
  ARRAY[]::text[], '_self é excluído: o próprio cadastro não conta');
SELECT is(public._member_values_in_use(pg_temp.m(5), 'CAIO@exemplo.com ', NULL, NULL, false),
  ARRAY['email']::text[], 'e-mail comparado sem maiúsculas nem espaços');
SELECT is(public._member_values_in_use(NULL, NULL, NULL, NULL, false), ARRAY[]::text[], 'valores nulos: nada em uso');
SELECT is(public._member_values_in_use(NULL, 'bruno@exemplo.com', '(51) 8888-0000', '012.345.678-90', false), ARRAY[]::text[],
  'DEL-04: os dados de um excluído não estão em uso');
SELECT is(public._member_values_in_use(NULL, NULL, '98887777', NULL, false), ARRAY[]::text[], 'DA-5: celular ilegível não é conferido');
SELECT is((SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), (SELECT n FROM lk0),
  'DT-07: com _lock = false nenhuma trava é pedida');
SELECT is(public._member_values_in_use(NULL, 'livre@exemplo.com', '5133330000', '111.444.777-35', true), ARRAY[]::text[],
  'com _lock = true e nada em uso, devolve vazio');
SELECT is((SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), (SELECT n FROM lk0) + 3,
  'DT-07: uma trava por valor não nulo (e-mail, celular e CPF)');
SELECT is(public._member_values_in_use(NULL, NULL, '5133330001', NULL, true), ARRAY[]::text[], 'trava só o valor informado');
SELECT is((SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()), (SELECT n FROM lk0) + 4,
  'DT-07: um valor nulo não é travado (só mais uma trava)');

-- ---------------------------------------------------------------------------
-- restore_member (Rita, Administrador) com a chave do 9º dígito (RN-09, RN-16 e do E2.01).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.restore(_n int, _id uuid) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT count(*) FROM public.restore_member(%L)', _id) $$;
CREATE FUNCTION pg_temp.deleted_of(_id uuid) RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT (deleted_at IS NOT NULL)::text FROM public.members WHERE id = %L', _id) $$;
CREATE FUNCTION pg_temp.pastor(_email text, _mobile text, _cpf text) RETURNS text LANGUAGE sql AS
$$ SELECT format('INSERT INTO public.members (name, gender, is_pastor, email, mobile_whatsapp, cpf) VALUES (''Outro Cadastro'', ''F'', true, %L, %L, %L)',
                 _email, _mobile, _cpf) $$;

CREATE TEMP TABLE rs (k text PRIMARY KEY, r jsonb) ON COMMIT DROP;
INSERT INTO rs VALUES
  ('ok',     pg_temp.scenario(NULL, 2, pg_temp.restore(2, pg_temp.m(11)), pg_temp.deleted_of(pg_temp.m(11)))),
  ('m9',     pg_temp.scenario(pg_temp.pastor(NULL, '(51) 98888-0000', NULL), 2, pg_temp.restore(2, pg_temp.m(11)), pg_temp.deleted_of(pg_temp.m(11)))),
  ('m8',     pg_temp.scenario(pg_temp.pastor(NULL, '(51) 8888-2222', NULL), 2, pg_temp.restore(2, pg_temp.m(12)), pg_temp.deleted_of(pg_temp.m(12)))),
  ('mfmt',   pg_temp.scenario(pg_temp.pastor(NULL, '+55 51 98888-0000', NULL), 2, pg_temp.restore(2, pg_temp.m(11)))),
  ('email',  pg_temp.scenario(pg_temp.pastor('BRUNO@exemplo.com', NULL, NULL), 2, pg_temp.restore(2, pg_temp.m(11)), pg_temp.deleted_of(pg_temp.m(11)))),
  ('cpf',    pg_temp.scenario(pg_temp.pastor(NULL, NULL, '01234567890'), 2, pg_temp.restore(2, pg_temp.m(11)))),
  ('two',    pg_temp.scenario(pg_temp.pastor('bruno@exemplo.com', NULL, '012.345.678-90'), 2, pg_temp.restore(2, pg_temp.m(11)))),
  ('three',  pg_temp.scenario(pg_temp.pastor('bruno@exemplo.com', '5188880000', '01234567890'), 2, pg_temp.restore(2, pg_temp.m(11)))),
  ('noperm', pg_temp.scenario(NULL, 4, pg_temp.restore(4, pg_temp.m(11)))),
  ('inact',  pg_temp.scenario('UPDATE public.members SET is_active = false WHERE id = ' || quote_literal(pg_temp.m(3)) || '; '
                              || pg_temp.pastor(NULL, '5188880000', NULL), 2, pg_temp.restore(2, pg_temp.m(11))));

SELECT is(r ->> 'ok', 'true', 'RN-09: restaurar Bruno sem conflito é aceito') FROM rs WHERE k = 'ok';
SELECT is(r ->> 'after', 'false', 'Bruno volta a não excluído') FROM rs WHERE k = 'ok';
SELECT is(r ->> 'code', 'restore_value_in_use', 'RN-09: Bruno (5188880000) x cadastro com 51988880000 é recusado') FROM rs WHERE k = 'm9';
SELECT is(r -> 'fields', '["mobile"]'::jsonb, 'o DETAIL traz o campo: mobile') FROM rs WHERE k = 'm9';
SELECT is(r ->> 'message', 'Não é possível restaurar: outro cadastro já usa este celular.', 'a mensagem cita o celular') FROM rs WHERE k = 'm9';
SELECT is(r ->> 'after', 'true', 'nada muda: Bruno continua excluído') FROM rs WHERE k = 'm9';
SELECT is(r ->> 'code', 'restore_value_in_use', 'RN-09: Bruna (51988882222) x cadastro com 5188882222 é recusado (outro sentido)') FROM rs WHERE k = 'm8';
SELECT is(r ->> 'after', 'true', 'Bruna continua excluída') FROM rs WHERE k = 'm8';
SELECT is(r ->> 'code', 'restore_value_in_use', 'RN-09: o celular escrito de outro modo (+55 51 98888-0000) é o mesmo') FROM rs WHERE k = 'mfmt';
SELECT is(r ->> 'message', 'Não é possível restaurar: outro cadastro já usa este e-mail.', 'a mensagem cita o e-mail (sem diferenciar maiúsculas)') FROM rs WHERE k = 'email';
SELECT is(r ->> 'message', 'Não é possível restaurar: outro cadastro já usa este CPF.', 'a mensagem cita o CPF') FROM rs WHERE k = 'cpf';
SELECT is(r -> 'fields', '["email", "cpf"]'::jsonb, 'dois campos em uso: o DETAIL traz os dois, na ordem e-mail, celular, CPF') FROM rs WHERE k = 'two';
SELECT is(r ->> 'message', 'Não é possível restaurar: outro cadastro já usa este e-mail.', 'dois campos: a mensagem cita o primeiro (e-mail)') FROM rs WHERE k = 'two';
SELECT is(r -> 'fields', '["email", "mobile", "cpf"]'::jsonb, 'três campos em uso: os três') FROM rs WHERE k = 'three';
SELECT is(r ->> 'code', '42501', 'sem manage_roles (Pedro) a restauração é recusada por permissão, e não por dado em uso') FROM rs WHERE k = 'noperm';
SELECT is(r ->> 'code', 'restore_value_in_use', 'o cadastro inativo também conta na restauração') FROM rs WHERE k = 'inact';

-- ---------------------------------------------------------------------------
-- find_deleted_member_matches: o celular pela chave do 9º dígito dos dois lados.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.matches(_n int, _email text, _mobile text, _cpf text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', f.member_id, 'fields', f.matched_fields, 'account', f.is_account_email)), '[]'::jsonb)
      INTO _out FROM public.find_deleted_member_matches(_email, _mobile, _cpf) f;
  EXCEPTION WHEN OTHERS THEN
    _out := jsonb_build_object('error', SQLSTATE);
  END;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN _out;
END $$;

SELECT is(pg_temp.matches(2, NULL, '(51) 98888-0000', NULL), jsonb_build_array(jsonb_build_object('id', pg_temp.m(11), 'fields', jsonb_build_array('mobile'), 'account', false)),
  'aviso de excluído: o celular com 9 casa com o guardado sem 9 (Bruno)');
SELECT is(pg_temp.matches(2, NULL, '(51) 8888-2222', NULL), jsonb_build_array(jsonb_build_object('id', pg_temp.m(12), 'fields', jsonb_build_array('mobile'), 'account', false)),
  'aviso de excluído: o celular sem 9 casa com o guardado com 9 (Bruna)');
SELECT is(pg_temp.matches(2, NULL, '98887777', NULL), '[]'::jsonb, 'DA-5: o celular ilegível não procura nada');
SELECT is(pg_temp.matches(2, ' BRUNO@exemplo.com', NULL, '012.345.678-90') -> 0 -> 'fields', '["email", "cpf"]'::jsonb,
  'e-mail e CPF continuam casando (e-mail sem maiúsculas, CPF sem máscara)');
SELECT is(pg_temp.matches(4, NULL, '(51) 98888-0000', NULL), jsonb_build_array(jsonb_build_object('id', NULL, 'fields', jsonb_build_array('mobile'), 'account', false)),
  'sem manage_roles (Pedro) o aviso vem sem id nem nome, só com o campo');
SELECT is(pg_temp.matches(3, NULL, '(51) 98888-0000', NULL) ->> 'error', '42501', 'sem create_member (Caio): 42501');

SELECT * FROM finish();

ROLLBACK;
