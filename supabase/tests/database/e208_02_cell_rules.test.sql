-- E2.08 (PR 2): regras do cadastro de células.
-- Spec: docs/specs/e2-08-cadastro-celulas.md (repositório apps-mci),
-- "Funções de regra e listas (migration 2)", "Integridade do tipo (a)",
-- "Escrita", "Formato dos erros" e "Verificações obrigatórias (para o QA)",
-- PR 2; RN-01 a RN-07, RN-11, RN-13, RN-14; DA-1 a DA-3, DA-8, DA-12; DT-01
-- a DT-05.
--
-- Cobre:
--   - estrutura: NOT NULL, padrões, os três CHECKs, as funções IMMUTABLE com
--     EXECUTE para authenticated e service_role e sem anon, as funções de
--     trigger e private.cell_rule_violations sem EXECUTE pela API, os dois
--     triggers e a ordem dos BEFORE de cells;
--   - RN-01: a service role e o postgres recebem as recusas; em replica os
--     NOT NULL e os CHECKs valem, o trigger não, e a pessoa excluída aparece
--     em private.cell_rule_violations(); quem não pode gravar nunca recebe
--     uma recusa deste spec;
--   - RN-02 a RN-07 e RN-11 pela API, com o código, o campo e a mensagem;
--   - RN-14: a ordem das recusas;
--   - DA-3: os CHECKs valem para a célula excluída;
--   - invariante: private.cell_rule_violations() vazia no fim.
-- Os casos de dia, tipo e horário um a um estão em e208_02_cases.test.sql
-- (gerado da tabela de casos).
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Ids fictícios (usuário do Auth, membro, célula, relatório).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2080201-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2080201-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2080201-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2080201-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- Executa _sql e devolve estado, linhas, código de regra, mensagem e detalhe.
-- _as: número do membro (authenticated), 'service_role' ou 'postgres'.
CREATE FUNCTION pg_temp.run_as(_as text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text; _detail text; _hint text; _rows bigint;
BEGIN
  BEGIN
    IF _as = 'service_role' THEN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
      EXECUTE 'SET LOCAL ROLE service_role';
    ELSIF _as <> 'postgres' THEN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.u(_as::int), 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('state', '00000', 'code', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg, 'hint', nullif(_hint, ''),
      'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ELSE to_jsonb(nullif(_detail, '')) END,
      'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                   THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.run_as(_n::text, _sql) $$;
CREATE FUNCTION pg_temp.code(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.try(_n, _sql) ->> 'code' $$;

-- Valor escalar (texto) como o usuário n; erro vira 'ERR <estado>'.
CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RETURN 'ERR ' || _state;
  END;
END $$;

-- Código, campo e mensagem de uma recusa, numa linha só.
CREATE FUNCTION pg_temp.triple(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(_r ->> 'code', '') || '|' || coalesce(_r -> 'detail' ->> 'field', '') || '|' || coalesce(_r ->> 'message', '') $$;

-- INSERT de célula. Pessoa: número do membro, ou NULL. '<omit>' deixa a coluna de fora.
CREATE FUNCTION pg_temp.cell_sql(_id int, _leader int, _timothy int, _host int,
    _day text DEFAULT 'Quarta', _time text DEFAULT '20:00', _type text DEFAULT 'Evangelística',
    _active text DEFAULT '<omit>') RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _cols text[] := ARRAY['id', 'leader_id', 'timothy_id', 'host_id'];
  _vals text[] := ARRAY[quote_literal(pg_temp.c(_id)),
                        quote_nullable(pg_temp.m(_leader)::text) || '::uuid',
                        quote_nullable(pg_temp.m(_timothy)::text) || '::uuid',
                        quote_nullable(pg_temp.m(_host)::text) || '::uuid'];
BEGIN
  IF _day IS DISTINCT FROM '<omit>' THEN _cols := _cols || 'meeting_day'::text; _vals := _vals || quote_nullable(_day)::text; END IF;
  IF _time IS DISTINCT FROM '<omit>' THEN _cols := _cols || 'meeting_time'::text; _vals := _vals || (quote_nullable(_time) || '::time'); END IF;
  IF _type IS DISTINCT FROM '<omit>' THEN _cols := _cols || 'type'::text; _vals := _vals || quote_nullable(_type)::text; END IF;
  IF _active IS DISTINCT FROM '<omit>' THEN _cols := _cols || 'is_active'::text; _vals := _vals || (quote_nullable(_active) || '::boolean'); END IF;
  RETURN format('INSERT INTO public.cells (%s) VALUES (%s)', array_to_string(_cols, ', '), array_to_string(_vals, ', '));
END $$;

CREATE FUNCTION pg_temp.upd(_id int, _set text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('UPDATE public.cells SET %s WHERE id = %L', _set, pg_temp.c(_id)) $$;

-- Um passo como postgres que é sempre desfeito: roda _setup e devolve _query (texto).
CREATE FUNCTION pg_temp.probe(_setup text, _query text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r text; _state text;
BEGIN
  BEGIN
    EXECUTE _setup;
    EXECUTE _query INTO _r;
    RAISE EXCEPTION USING ERRCODE = 'MCI00', MESSAGE = coalesce(_r, 'NULL');
  EXCEPTION
    WHEN SQLSTATE 'MCI00' THEN RETURN SQLERRM;
    WHEN OTHERS THEN GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE; RETURN 'ERR ' || _state;
  END;
END $$;

-- ---------------------------------------------------------------------------
-- Massa (a do E2.02 e do PR 1, mais Bruno, excluído): 18 pessoas, C1 e C2.
--   C1: líder André (7), timóteo Caio (9), anfitriã Carla (12); quarta, 20:00.
--   C2: líder Diego (14), timóteo Hugo (15), anfitrião Caio (9).
-- Pedro (3) e Diego (14): Líder; Caio (9) e Carla (12): Membro; Rita (16):
-- Administrador; Fábio (10) inativo; Ester (17) sem liderança.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e208b-' || n || '@teste.invalid' FROM generate_series(1, 18) n;

CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192085' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
 (pg_temp.m(1),'Samuel Massa','M',true,NULL, false,pg_temp.u(1),pg_temp.role('Líder'),true, pg_temp.mob(1)),
 (pg_temp.m(2),'Magda Massa','F',true,NULL, false,pg_temp.u(2),pg_temp.role('Líder'),true, pg_temp.mob(2)),
 (pg_temp.m(3),'Pedro Massa','M',false,pg_temp.m(1), true,pg_temp.u(3),pg_temp.role('Líder'),true, pg_temp.mob(3)),
 (pg_temp.m(4),'Paula Massa','F',false,pg_temp.m(2), true,pg_temp.u(4),pg_temp.role('Líder'),true, pg_temp.mob(4)),
 (pg_temp.m(5),'Tiago Massa','M',false,pg_temp.m(1), true,pg_temp.u(5),NULL,true, pg_temp.mob(5)),
 (pg_temp.m(6),'Tania Massa','F',false,pg_temp.m(2), true,pg_temp.u(6),NULL,true, pg_temp.mob(6)),
 (pg_temp.m(7),'Andre Massa','M',false,pg_temp.m(3), true,pg_temp.u(7),pg_temp.role('Líder'),true, pg_temp.mob(7)),
 (pg_temp.m(8),'Beatriz Massa','F',false,pg_temp.m(6), true,pg_temp.u(8),pg_temp.role('Membro'),true, pg_temp.mob(8)),
 (pg_temp.m(9),'Caio Massa','M',false,pg_temp.m(7), true,pg_temp.u(9),pg_temp.role('Membro'),true, pg_temp.mob(9)),
 (pg_temp.m(10),'Fabio Massa','M',false,pg_temp.m(7), true,pg_temp.u(10),pg_temp.role('Membro'),false, pg_temp.mob(10)),
 (pg_temp.m(11),'Gabriel Massa','M',false,pg_temp.m(10), true,pg_temp.u(11),NULL,true, pg_temp.mob(11)),
 (pg_temp.m(12),'Carla Massa','F',false,pg_temp.m(4), true,pg_temp.u(12),pg_temp.role('Membro'),true, pg_temp.mob(12)),
 (pg_temp.m(13),'Debora Massa','F',false,pg_temp.m(8), true,pg_temp.u(13),NULL,true, pg_temp.mob(13)),
 (pg_temp.m(14),'Diego Massa','M',false,pg_temp.m(5), true,pg_temp.u(14),pg_temp.role('Líder'),true, pg_temp.mob(14)),
 (pg_temp.m(15),'Hugo Massa','M',false,pg_temp.m(5), true,pg_temp.u(15),NULL,true, pg_temp.mob(15)),
 (pg_temp.m(16),'Rita Massa','F',false,pg_temp.m(6), true,pg_temp.u(16),pg_temp.role('Administrador'),true, pg_temp.mob(16)),
 (pg_temp.m(17),'Ester Massa','F',false,NULL, false,pg_temp.u(17),pg_temp.role('Membro'),true, pg_temp.mob(17)),
 (pg_temp.m(18),'Bruno Massa','M',false,pg_temp.m(3), true,pg_temp.u(18),pg_temp.role('Membro'),true, pg_temp.mob(18));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
 (pg_temp.c(1), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Quarta', '20:00'),
 (pg_temp.c(2), pg_temp.m(14), pg_temp.m(15), pg_temp.m(9), 'Evangelística', 'Quinta', '20:00');
UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(18);

SELECT plan(95);

-- ===========================================================================
-- Estrutura (DT-01 a DT-05)
-- ===========================================================================
SELECT col_not_null('public', 'cells', 'leader_id', 'RN-02: leader_id NOT NULL');
SELECT col_not_null('public', 'cells', 'timothy_id', 'RN-02: timothy_id NOT NULL');
SELECT col_not_null('public', 'cells', 'host_id', 'RN-02: host_id NOT NULL');
SELECT col_not_null('public', 'cells', 'meeting_day', 'RN-05: meeting_day NOT NULL');
SELECT col_not_null('public', 'cells', 'meeting_time', 'RN-06: meeting_time NOT NULL');
SELECT col_not_null('public', 'cells', 'type', 'RN-07: type NOT NULL');
SELECT col_hasnt_default('public', 'cells', 'meeting_day', 'P-CEL-02: meeting_day sem padrão (saiu o Sábado)');
SELECT col_hasnt_default('public', 'cells', 'meeting_time', 'P-CEL-02: meeting_time sem padrão (saiu o 19:00)');
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE d.adrelid = 'public.cells'::regclass AND a.attname = 'type'),
  'cell_default_type()', 'DT-05: o padrão de type é cell_default_type()');
SELECT results_eq(
  $$ SELECT conname::text COLLATE "default", pg_get_constraintdef(oid) FROM pg_constraint
      WHERE conrelid = 'public.cells'::regclass AND contype = 'c' AND conname LIKE 'cells\_%\_check' AND conname <> 'cells_deleted_by_check'
        AND conname NOT LIKE '%authorship\_check' AND conname <> 'cells_legacy_names_check'
      ORDER BY conname $$,
  $$ VALUES ('cells_meeting_day_check'::text, 'CHECK ((weekday_index(meeting_day) IS NOT NULL))'::text),
            ('cells_meeting_time_check', 'CHECK (is_valid_meeting_time(meeting_time))'),
            ('cells_type_check', 'CHECK ((type = ANY (cell_types())))') $$,
  'RN-05, RN-06, RN-07: os três CHECKs, com os nomes');
SELECT is(
  (SELECT array_agg(p.proname::text || ':' || p.provolatile::text ORDER BY p.proname) FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('cell_weekdays', 'cell_types', 'cell_default_type', 'normalize_meeting_time', 'is_valid_meeting_time', 'weekday_index')),
  ARRAY['cell_default_type:i', 'cell_types:i', 'cell_weekdays:i', 'is_valid_meeting_time:i', 'normalize_meeting_time:i', 'weekday_index:i'],
  'DT-02: as funções de regra são IMMUTABLE');
CREATE TEMP TABLE rule_fns (sig text) ON COMMIT DROP;
INSERT INTO rule_fns VALUES ('public.cell_weekdays()'), ('public.cell_types()'), ('public.cell_default_type()'),
  ('public.normalize_meeting_time(time)'), ('public.is_valid_meeting_time(time)'), ('public.weekday_index(text)');
SELECT is((SELECT bool_and(has_function_privilege('authenticated', sig, 'EXECUTE')) FROM rule_fns), true,
  'funções de regra: EXECUTE para authenticated (CHECKs e views rodam com o papel de quem grava ou lê)');
SELECT is((SELECT bool_and(has_function_privilege('service_role', sig, 'EXECUTE')) FROM rule_fns), true,
  'funções de regra: EXECUTE para service_role');
SELECT is((SELECT bool_or(has_function_privilege('anon', sig, 'EXECUTE')) FROM rule_fns), false,
  'funções de regra: sem EXECUTE para anon');
SELECT is(ARRAY[has_function_privilege('anon', 'private.cell_rule_violations()', 'EXECUTE'),
                has_function_privilege('authenticated', 'private.cell_rule_violations()', 'EXECUTE'),
                has_function_privilege('service_role', 'private.cell_rule_violations()', 'EXECUTE')],
  ARRAY[false, false, false], 'DT-01: private.cell_rule_violations() sem EXECUTE pela API');
SELECT is(ARRAY[has_function_privilege('anon', 'public.normalize_cell_input()', 'EXECUTE'),
                has_function_privilege('authenticated', 'public.normalize_cell_input()', 'EXECUTE'),
                has_function_privilege('anon', 'public.enforce_cell_rules()', 'EXECUTE'),
                has_function_privilege('authenticated', 'public.enforce_cell_rules()', 'EXECUTE')],
  ARRAY[false, false, false, false], 'funções de trigger sem EXECUTE para anon e authenticated');
SELECT is(
  (SELECT string_agg(proname::text || ':' || prosecdef::text || ':' || array_to_string(proconfig, ','), ' ' ORDER BY proname) FROM pg_proc
    WHERE oid IN ('public.normalize_cell_input()'::regprocedure, 'public.enforce_cell_rules()'::regprocedure)),
  'enforce_cell_rules:true:search_path=public normalize_cell_input:false:search_path=public',
  'DT-04: o ad_ é definer (recusa pelo _del_raise) e o a0_ é invoker, os dois com search_path fixo');
SELECT is((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'a0_normalize_cell'),
  'CREATE TRIGGER a0_normalize_cell BEFORE INSERT OR UPDATE OF meeting_time ON public.cells FOR EACH ROW EXECUTE FUNCTION normalize_cell_input()',
  'a0_normalize_cell: BEFORE INSERT OR UPDATE OF meeting_time');
SELECT is((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'ad_enforce_cell_rules'),
  'CREATE TRIGGER ad_enforce_cell_rules BEFORE INSERT OR UPDATE OF leader_id, timothy_id, host_id, type, meeting_day, meeting_time ON public.cells FOR EACH ROW EXECUTE FUNCTION enforce_cell_rules()',
  'ad_enforce_cell_rules: BEFORE INSERT OR UPDATE das colunas das regras (sem is_active e deleted_at)');
SELECT is(
  (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
    WHERE t.tgrelid = 'public.cells'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) <> 0
      AND t.tgname <> 'zz_stamp_authorship'),
  ARRAY['a0_check_insert_permission', 'a0_normalize_cell', 'aa_enforce_cell_links', 'ab_enforce_cell_scope', 'ad_enforce_cell_rules'],
  'RN-14: a ordem dos BEFORE de cells: permissão < normalização < excluído < escopo < regras');

-- ===========================================================================
-- RN-01: todos os papéis; em replica valem os NOT NULL e os CHECKs
-- ===========================================================================
SELECT is(pg_temp.triple(pg_temp.run_as('service_role', pg_temp.cell_sql(10, 7, NULL, 12))),
  'timothy_required|timothy_id|Escolha o timóteo da célula.', 'RN-01: a service role grava uma célula sem timóteo: recusada');
SELECT is(pg_temp.triple(pg_temp.run_as('postgres', pg_temp.cell_sql(10, 7, NULL, 12))),
  'timothy_required|timothy_id|Escolha o timóteo da célula.', 'RN-01: o postgres, também');
SELECT is(pg_temp.triple(pg_temp.run_as('service_role', pg_temp.upd(1, 'timothy_id = NULL'))),
  'timothy_required|timothy_id|Escolha o timóteo da célula.', 'RN-01: a service role tira o timóteo de C1: recusada');
SELECT is((SELECT timothy_id FROM public.cells WHERE id = pg_temp.c(1)), pg_temp.m(9), 'RN-01: Caio continua timóteo de C1');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, NULL, 12), 'SELECT 1'),
  'ERR 23502', 'RN-01: em replica, o NOT NULL vale (sem timóteo)');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, 9, 12, 'Feriado'), 'SELECT 1'),
  'ERR 23514', 'RN-01: em replica, o CHECK do dia vale');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, 9, 12, 'Quarta', '24:00'), 'SELECT 1'),
  'ERR 23514', 'RN-01: em replica, o CHECK do horário vale');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, 9, 12, 'Quarta', '20:00', 'Discipuladora'), 'SELECT 1'),
  'ERR 23514', 'RN-01: em replica, o CHECK do tipo vale');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, 7, 7, 'Quarta', '20:00', 'Evangelística', 'false'),
                        format('SELECT is_active::text FROM public.cells WHERE id = %L', pg_temp.c(11))),
  'false', 'RN-01: em replica, o trigger não roda (a célula nova inativa entra)');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, 9, 18),
                        format($q$SELECT string_agg(rule, ',' ORDER BY rule) FROM private.cell_rule_violations() WHERE cell_id = %L$q$, pg_temp.c(11))),
  'person_deleted', 'RN-01, RN-13: em replica, a pessoa excluída entra e aparece em private.cell_rule_violations()');
SELECT is(pg_temp.probe('SET LOCAL session_replication_role = replica; ' || pg_temp.cell_sql(11, 7, 9, 18)
                        || format('; UPDATE public.cells SET deleted_at = now() WHERE id = %L', pg_temp.c(11)),
                        $q$SELECT count(*)::text FROM private.cell_rule_violations()$q$),
  '0', 'RN-04: a célula excluída com pessoa excluída não é violação');
SELECT is(pg_temp.try(9, pg_temp.upd(1, 'host_id = NULL')) ->> 'rows', '0',
  'RN-01, RN-12: Caio (sem Editar Célula) tira a anfitriã de C1: nada muda (0 linhas), sem recusa deste spec');
SELECT is(pg_temp.code(9, pg_temp.cell_sql(12, NULL, NULL, NULL, '<omit>', '<omit>', '<omit>')), '42501',
  'RN-14: Caio (sem Criar Célula) envia uma célula vazia: 42501, antes de qualquer regra');
SELECT is(pg_temp.try(14, pg_temp.upd(1, 'host_id = NULL')) ->> 'rows', '0',
  'RN-14: Diego (não vê C1) tira a anfitriã: nada muda (0 linhas)');

-- ===========================================================================
-- RN-02 e RN-03: as três pessoas
-- ===========================================================================
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(12, NULL, 9, 12))),
  'leader_required|leader_id|Escolha o líder da célula.', 'RN-02: célula nova sem líder pela API: recusada');
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(12, 7, NULL, 12))),
  'timothy_required|timothy_id|Escolha o timóteo da célula.', 'RN-02: célula nova sem timóteo: recusada');
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.upd(1, 'host_id = NULL'))),
  'host_required|host_id|Escolha o anfitrião da célula.', 'RN-02: Rita limpa a anfitriã de C1: recusada');
SELECT is((SELECT host_id FROM public.cells WHERE id = pg_temp.c(1)), pg_temp.m(12), 'RN-02: Carla continua anfitriã de C1');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(12, 7, 9, NULL, 'Quarta', '20:00', 'Macrocélula')), 'host_required',
  'RN-02: Macrocélula sem anfitrião: a mesma recusa');
SELECT is(pg_temp.try(16, pg_temp.upd(1, format('host_id = %L', pg_temp.m(10)))) ->> 'rows', '1',
  'RN-02, RN-04: Rita troca a anfitriã de C1 por Fábio (inativo): aceita');
UPDATE public.cells SET host_id = pg_temp.m(12) WHERE id = pg_temp.c(1);
SELECT is(pg_temp.try(16, pg_temp.cell_sql(13, 7, 7, 7)) ->> 'rows', '1', 'RN-03: André líder, timóteo e anfitrião: aceita');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(14, 7, 9, 12)) ->> 'rows', '1',
  'RN-03: segunda célula de André, quarta às 20:00 com Carla: aceita, sem conflito');
SELECT is(pg_temp.try(16, pg_temp.upd(1, format('host_id = %L', pg_temp.m(8)))) ->> 'rows', '1',
  'RN-03: Beatriz, esposa de André, anfitriã de C1: aceita');

-- ===========================================================================
-- RN-04: pessoas
-- ===========================================================================
SELECT is(pg_temp.try(16, pg_temp.upd(1, format('timothy_id = %L', pg_temp.m(10)))) ->> 'rows', '1',
  'RN-04: Fábio (inativo) timóteo de C1: aceita');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(15, 1, 1, 1)) ->> 'rows', '1', 'RN-04: Samuel (pastor) líder: aceita');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(16, 17, 17, 17)) ->> 'rows', '1', 'RN-04: Ester (sem liderança) líder: aceita');
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.upd(1, format('host_id = %L', pg_temp.m(18))))),
  'deleted_member_chosen|host_id|Este membro foi excluído e não pode ser escolhido.', 'RN-04: Bruno (excluído) anfitrião de C1: recusado (E2.01)');
SELECT is((SELECT host_id FROM public.cells WHERE id = pg_temp.c(1)), pg_temp.m(8), 'RN-04: e nada muda');
SELECT is(pg_temp.triple(pg_temp.try(3, pg_temp.cell_sql(17, 7, 14, 7))),
  'person_not_visible|timothy_id|Você só pode escolher pessoas que você vê.', 'RN-04: Pedro escolhe Diego (que não vê) como timóteo: recusado (E2.02)');
SELECT is(pg_temp.try(3, pg_temp.upd(1, $q$meeting_time = '21:00'$q$)) ->> 'rows', '1',
  'RN-04, AQ-9: Pedro (não vê Beatriz) muda só o horário de C1: aceita');
SELECT is((SELECT host_id FROM public.cells WHERE id = pg_temp.c(1)), pg_temp.m(8), 'RN-04: e Beatriz continua anfitriã');

-- ===========================================================================
-- RN-05: dia da semana (DA-12)
-- ===========================================================================
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(18, 7, 9, 12, '<omit>'))),
  'meeting_day_required|meeting_day|Escolha o dia da semana.', 'RN-05: célula nova sem dia: recusada (não grava mais Sábado)');
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(18, 7, 9, 12, 'Segunda-feira'))),
  'meeting_day_invalid|meeting_day|Dia da semana inválido. Escolha de domingo a sábado.', 'RN-05: "Segunda-feira": recusado');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(18, 7, 9, 12, '')), 'meeting_day_required', 'DA-12: dia vazio é "sem dia"');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(18, 7, 9, 12, '  ')), 'meeting_day_required', 'DA-12: só espaços é "sem dia"');
SELECT is(pg_temp.code(16, pg_temp.upd(1, $q$meeting_day = 'Terca'$q$)), 'meeting_day_invalid', 'RN-05: na edição, "Terca": recusado');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(18, 7, 9, 12, 'Segunda')) ->> 'rows', '1', 'RN-05: "Segunda": aceita');

-- ===========================================================================
-- RN-06: horário (DA-8)
-- ===========================================================================
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(19, 7, 9, 12, 'Quarta', '<omit>'))),
  'meeting_time_required|meeting_time|Informe o horário.', 'RN-06: célula nova sem horário: recusada (não grava mais 19:00)');
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(19, 7, 9, 12, 'Quarta', '24:00'))),
  'meeting_time_invalid|meeting_time|Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.', 'RN-06: "24:00": recusado');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(19, 7, 9, 12, 'Quarta', '25:00')), '22008', 'DA-8: "25:00": recusado pelo tipo time');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(19, 7, 9, 12, 'Quarta', '19:60')), '22008', 'DA-8: "19:60": recusado pelo tipo time');
SELECT is(pg_temp.code(16, pg_temp.upd(1, 'meeting_time = NULL')), 'meeting_time_required', 'RN-06: na edição, sem horário: recusado');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(19, 7, 9, 12, 'Quarta', '19:30:45')) ->> 'rows', '1', 'RN-06: "19:30:45": aceita');
SELECT is((SELECT meeting_time FROM public.cells WHERE id = pg_temp.c(19)), '19:30'::time, 'RN-06: e gravado como 19:30');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(20, 7, 9, 12, 'Quarta', '00:00')) ->> 'rows', '1', 'RN-06: "00:00": aceita');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(21, 7, 9, 12, 'Quarta', '23:59')) ->> 'rows', '1', 'RN-06: "23:59": aceita');
SELECT is(pg_temp.try(16, pg_temp.upd(1, $q$meeting_time = '19:30:45'$q$)) ->> 'rows', '1', 'RN-06: na edição, "19:30:45": aceita');
SELECT is((SELECT meeting_time FROM public.cells WHERE id = pg_temp.c(1)), '19:30'::time, 'RN-06: e C1 fica com 19:30');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(22, 7, 9, 12, 'Sábado', '23:30')) ->> 'rows', '1', 'RN-06: sábado às 23:30: aceita');
SELECT is(pg_temp.val(16, format($q$SELECT meeting_day || ' ' || meeting_time::text FROM public.cells_view WHERE id = %L$q$, pg_temp.c(22))), 'Sábado 23:30:00',
  'RN-06: e aparece como sábado, 23:30, sem conversão de fuso');

-- ===========================================================================
-- RN-07: tipo (DA-1)
-- ===========================================================================
SELECT is(pg_temp.try(16, pg_temp.cell_sql(23, 7, 9, 12, 'Quarta', '20:00', '<omit>')) ->> 'rows', '1', 'RN-07: célula nova sem tipo: aceita');
SELECT is((SELECT type FROM public.cells WHERE id = pg_temp.c(23)), 'Evangelística', 'RN-07: e fica Evangelística');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(24, 7, 9, 12, 'Quarta', '20:00', NULL)) ->> 'rows', '1', 'DA-1: tipo nulo no cadastro: aceita');
SELECT is((SELECT type FROM public.cells WHERE id = pg_temp.c(24)), 'Evangelística', 'DA-1: e fica Evangelística');
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(25, 7, 9, 12, 'Quarta', '20:00', 'Discipuladora'))),
  'cell_type_invalid|type|Tipo de célula inválido. Escolha Evangelística, Discipulado ou Macrocélula.', 'RN-07: "Discipuladora": recusado');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(25, 7, 9, 12, 'Quarta', '20:00', 'evangelistica')), 'cell_type_invalid', 'RN-07: "evangelistica": recusado');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(25, 7, 9, 12, 'Quarta', '20:00', '')), 'cell_type_invalid', 'RN-07: tipo vazio: recusado');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(25, 7, 9, 12, 'Quarta', '20:00', 'Discipulado')) ->> 'rows', '1', 'RN-07: "Discipulado": aceita');
SELECT is(pg_temp.code(16, pg_temp.upd(1, 'type = NULL')), 'cell_type_invalid', 'DA-1: na edição, tipo nulo: recusado');
SELECT is(pg_temp.code(16, pg_temp.upd(1, $q$type = ''$q$)), 'cell_type_invalid', 'DA-1: na edição, tipo vazio: recusado');

-- ===========================================================================
-- RN-11: a célula nova sempre começa ativa (DA-2)
-- ===========================================================================
SELECT is(pg_temp.triple(pg_temp.try(16, pg_temp.cell_sql(26, 7, 9, 12, 'Quarta', '20:00', 'Evangelística', 'false'))),
  'cell_new_inactive|is_active|Uma célula nova sempre começa ativa.', 'RN-11: célula nova inativa pela API: recusada');
SELECT is(pg_temp.try(16, pg_temp.cell_sql(26, 7, 9, 12, 'Quarta', '20:00', 'Evangelística', NULL)) ->> 'rows', '1', 'DA-2: is_active nulo no cadastro: aceita');
SELECT is((SELECT is_active FROM public.cells WHERE id = pg_temp.c(26)), true, 'DA-2: e fica ativa');
SELECT is(pg_temp.try(3, pg_temp.upd(1, 'is_active = false')) ->> 'rows', '1', 'RN-11: Pedro inativa C1 na edição: aceita');
SELECT is(pg_temp.try(3, pg_temp.upd(1, 'is_active = true')) ->> 'rows', '1', 'RN-11: Pedro reativa C1: aceita');

-- ===========================================================================
-- RN-14: a ordem das recusas
-- ===========================================================================
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, 7, NULL, 18)), 'deleted_member_chosen',
  'RN-14: pessoa excluída mais timóteo vazio: deleted_member_chosen (E2.01 antes)');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, 7, NULL, 12, 'Feriado')), 'timothy_required',
  'RN-14: timóteo vazio mais dia inválido: timothy_required');
SELECT is(pg_temp.code(3, pg_temp.cell_sql(27, NULL, NULL, NULL)), 'would_leave_scope',
  'RN-14: Pedro (vê só o ministério) envia sem nenhuma pessoa: a recusa de escopo do E2.02 vem antes');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, NULL, NULL, NULL)), 'leader_required',
  'RN-14: Rita (igreja toda) envia sem nenhuma pessoa: leader_required');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, 7, 9, NULL, 'Feriado', '24:00', 'X')), 'host_required',
  'RN-14: anfitrião vazio vem antes do tipo, do dia e do horário');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, 7, 9, 12, 'Feriado', '24:00', 'X')), 'cell_type_invalid',
  'RN-14: o tipo vem antes do dia');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, 7, 9, 12, 'Feriado', '24:00')), 'meeting_day_invalid',
  'RN-14: o dia vem antes do horário');
SELECT is(pg_temp.code(16, pg_temp.cell_sql(27, 7, 9, 12, 'Quarta', '24:00', 'Evangelística', 'false')), 'meeting_time_invalid',
  'RN-14: o horário vem antes da célula nova inativa');

-- ===========================================================================
-- DA-3: a célula excluída também fica dentro dos CHECKs
-- ===========================================================================
UPDATE public.cells SET deleted_at = now() WHERE id = pg_temp.c(25);
SELECT is(pg_temp.run_as('postgres', pg_temp.upd(25, $q$type = 'Discipuladora'$q$)) ->> 'code', '23514',
  'DA-3: na célula excluída, o trigger não confere, mas o CHECK recusa');

-- ===========================================================================
-- Invariante
-- ===========================================================================
SELECT is_empty('SELECT * FROM private.cell_rule_violations()', 'RN-13: private.cell_rule_violations() sem linhas no fim');

SELECT * FROM finish();

ROLLBACK;

