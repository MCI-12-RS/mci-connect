-- E4 (PR 1): preparação do destino para a carga do legado.
-- Spec: docs/specs/e4-carga.md (apps-mci), "Modelo de dados e migrations (PR 1)": DT-01 (legacy_id),
-- DT-02 (só a carga grava legacy_id) e DT-03 (orphan_row nas listas de problemas e nos recálculos).
-- Massa (dados fictícios), carregada em replica como a carga: 1 Samuel (pastor), 2 Rita (Administrador,
-- com conta), 3 Caio (de Rita), 4 Otávio (de Samuel; apagado fisicamente em replica no fim);
-- células C1 (líder Caio) e C2 (líder Otávio; apagada fisicamente em replica); relatório R1 de C1.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(39);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a4010000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c4010000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d4010000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e4010000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5194010' || lpad(_n::text, 4, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- "Pela API": papel authenticated com o JWT de um membro; devolve 'ok' ou o código do erro.
CREATE FUNCTION pg_temp.api(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text; _detail text; _hint text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    EXECUTE _sql;
    RESET ROLE;
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                THEN _detail::jsonb ->> 'code' ELSE _state END;
  END;
END $$;

-- Massa em replica (a carga): legacy_id gravado, nenhum trigger de usuário roda.
INSERT INTO auth.users (id, email) VALUES (pg_temp.u(2), 'e401-2@teste.invalid');

SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id,
                            is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1), 101, 'Samuel Teste', 'M', true,  NULL,         false, NULL,         NULL, true, pg_temp.mob(1)),
  (pg_temp.m(2), 102, 'Rita Teste',   'F', false, pg_temp.m(1), true,  pg_temp.u(2), pg_temp.role('Administrador'), true, pg_temp.mob(2)),
  (pg_temp.m(3), 103, 'Caio Teste',   'M', false, pg_temp.m(2), true,  NULL,         NULL, true, pg_temp.mob(3)),
  (pg_temp.m(4), 104, 'Otávio Teste', 'M', false, pg_temp.m(1), true,  NULL,         NULL, true, pg_temp.mob(4));
INSERT INTO public.cells (id, legacy_id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  (pg_temp.c(1), 201, pg_temp.m(3), pg_temp.m(2), pg_temp.m(2), 'Evangelística', 'Quarta', '20:00', true),
  (pg_temp.c(2), 202, pg_temp.m(4), pg_temp.m(2), pg_temp.m(2), 'Discipulado',   'Quinta', '20:00', true);
INSERT INTO public.cell_reports (id, legacy_id, cell_id, date, time, was_held, theme, offering, visitors) VALUES
  (pg_temp.r(1), 301, pg_temp.c(1), '2026-01-07', '20:00', true, 'Tema E4', 10, ARRAY[]::text[]);
SET LOCAL session_replication_role = origin;

SELECT private.rebuild_member_hierarchy();
SELECT private.backfill_cell_active_periods();

-- ===========================================================================
-- DT-01: estrutura e privilégios (15)
-- ===========================================================================
SELECT col_type_is('public', t, 'legacy_id', 'integer', t || '.legacy_id é integer')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint k
                   WHERE k.conrelid = ('public.' || t)::regclass AND k.contype = 'u' AND k.conname = t || '_legacy_id_key'
                     AND k.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                                            WHERE attrelid = ('public.' || t)::regclass AND attname = 'legacy_id')]),
          t || ': UNIQUE (legacy_id), inclusive entre os excluídos (sem WHERE)')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint k
                   WHERE k.conrelid = ('public.' || t)::regclass AND k.contype = 'c' AND k.conname = t || '_legacy_id_check'
                     AND pg_get_constraintdef(k.oid) = 'CHECK ((legacy_id > 0))'),
          t || ': CHECK (legacy_id > 0)')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger g
                   WHERE g.tgrelid = ('public.' || t)::regclass AND g.tgname = 'zy_keep_legacy_id'
                     AND g.tgfoid = 'public.keep_legacy_id()'::regprocedure
                     AND (g.tgtype & 31) = 23            -- ROW + BEFORE + INSERT + UPDATE, sem DELETE
                     AND g.tgenabled = 'O'),             -- não dispara em replica (a carga grava)
          t || ': zy_keep_legacy_id BEFORE INSERT OR UPDATE FOR EACH ROW, desligado em replica')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT ok(has_column_privilege('authenticated', 'public.members', 'legacy_id', 'SELECT'),
  'members.legacy_id: SELECT por coluna para authenticated (não é sensível; risco 4 do E1.08)');
SELECT ok(NOT has_column_privilege('anon', 'public.members', 'legacy_id', 'SELECT'),
  'members.legacy_id: anon não lê');
SELECT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.keep_legacy_id()'::regprocedure)
          AND NOT has_function_privilege('authenticated', 'public.keep_legacy_id()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.keep_legacy_id()', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.keep_legacy_id()', 'EXECUTE'),
  'keep_legacy_id: invoker, sem EXECUTE pela API');

-- ===========================================================================
-- DT-02: só a carga grava legacy_id (15)
-- ===========================================================================
SELECT is((SELECT array_agg(legacy_id ORDER BY legacy_id) FROM public.members WHERE id IN (pg_temp.m(1), pg_temp.m(2), pg_temp.m(3), pg_temp.m(4))),
  ARRAY[101, 102, 103, 104], 'replica (a carga): legacy_id gravado no INSERT');

UPDATE public.members SET legacy_id = 901, notes = 'nota E4' WHERE id = pg_temp.m(3);
SELECT is((SELECT (legacy_id, notes)::text FROM public.members WHERE id = pg_temp.m(3)), '(103,"nota E4")',
  'postgres (fora de replica): o UPDATE muda as outras colunas e mantém o legacy_id');

SELECT is(pg_temp.api(2, $$UPDATE public.members SET legacy_id = 902, notes = 'nota API' WHERE id = 'c4010000-0000-0000-0000-000000000003'$$), 'ok',
  'Administrador pela API: o UPDATE do legacy_id não dá erro (descartado, como a autoria)');
SELECT is((SELECT (legacy_id, notes)::text FROM public.members WHERE id = pg_temp.m(3)), '(103,"nota API")',
  'Administrador pela API: a linha é alterada, e o legacy_id do membro continua o da carga');

SET LOCAL ROLE service_role;
UPDATE public.members SET legacy_id = 903, notes = 'nota SR' WHERE id = pg_temp.m(3);
UPDATE public.cells SET legacy_id = 904 WHERE id = pg_temp.c(1);
RESET ROLE;
SELECT is((SELECT legacy_id || ' ' || notes FROM public.members WHERE id = pg_temp.m(3)) || '/' || (SELECT legacy_id FROM public.cells WHERE id = pg_temp.c(1)),
  '103 nota SR/201', 'service_role: o UPDATE muda a linha e mantém o legacy_id de membro e de célula');

-- A chamada e a leitura em comandos separados: a leitura no mesmo SELECT não veria a gravação.
SELECT is(pg_temp.api(2, $$UPDATE public.cells SET legacy_id = 905, meeting_time = '21:00' WHERE id = 'd4010000-0000-0000-0000-000000000001'$$),
  'ok', 'Administrador pela API: o UPDATE da célula com legacy_id não dá erro');
SELECT is((SELECT legacy_id || ' ' || meeting_time FROM public.cells WHERE id = pg_temp.c(1)),
  '201 21:00:00', 'Administrador pela API: a célula é alterada, e o legacy_id continua o da carga');

SELECT is(pg_temp.api(2, format($$INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, mobile_whatsapp)
                                  VALUES (%L, 906, 'Nova Pessoa', 'F', false, %L, %L)$$,
                                pg_temp.m(5), pg_temp.m(1), pg_temp.mob(5))),
  'ok', 'Administrador pela API: cadastro com legacy_id é aceito');
SELECT is((SELECT legacy_id FROM public.members WHERE id = pg_temp.m(5)), NULL::int,
  'Administrador pela API: o cadastro novo fica com legacy_id nulo');

SELECT is(pg_temp.api(2, format($$INSERT INTO public.cells (id, legacy_id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
                                  VALUES (%L, 907, %L, %L, %L, 'Sexta', '19:00')$$,
                                pg_temp.c(3), pg_temp.m(3), pg_temp.m(2), pg_temp.m(2))),
  'ok', 'Administrador pela API: cadastro de célula com legacy_id é aceito');
SELECT is((SELECT coalesce(legacy_id::text, 'nulo') FROM public.cells WHERE id = pg_temp.c(3)), 'nulo',
  'Administrador pela API: a célula nova existe e fica com legacy_id nulo');

-- Relatórios: escrita só pelas RPCs (E2.11); fora delas, com a marca de manutenção.
SELECT set_config('mci.cell_report_write', 'on', true);
UPDATE public.cell_reports SET legacy_id = 908, observations = 'obs E4' WHERE id = pg_temp.r(1);
INSERT INTO public.cell_reports (id, legacy_id, cell_id, date, time, was_held, theme, offering, visitors)
VALUES (pg_temp.r(2), 909, pg_temp.c(1), '2026-01-14', '20:00', true, 'Tema E4 2', 5, ARRAY[]::text[]);
SELECT set_config('mci.cell_report_write', '', true);
SELECT is((SELECT legacy_id || '/' || observations FROM public.cell_reports WHERE id = pg_temp.r(1))
          || '/' || coalesce((SELECT legacy_id::text FROM public.cell_reports WHERE id = pg_temp.r(2)), 'nulo'),
  '301/obs E4/nulo', 'relatório (postgres com a marca): o UPDATE mantém e o INSERT anula o legacy_id');

-- A carga (e a adoção do DT-09) muda o legacy_id em replica; o UNIQUE e o CHECK valem mesmo assim.
SET LOCAL session_replication_role = replica;
UPDATE public.members SET legacy_id = 113 WHERE id = pg_temp.m(3);
SELECT is((SELECT legacy_id FROM public.members WHERE id = pg_temp.m(3)), 113,
  'replica: o UPDATE do legacy_id vale (adoção e limpeza da carga)');
SELECT throws_ok($$UPDATE public.members SET legacy_id = 101 WHERE id = 'c4010000-0000-0000-0000-000000000003'$$,
  '23505', NULL, 'replica: legacy_id repetido é recusado pelo UNIQUE');
SELECT throws_ok($$UPDATE public.cells SET legacy_id = 0 WHERE id = 'd4010000-0000-0000-0000-000000000001'$$,
  '23514', NULL, 'replica: legacy_id fora do CHECK (> 0) é recusado');

-- ===========================================================================
-- DT-03: orphan_row (9). Exclusão física em replica: a cascata da FK não dispara.
-- ===========================================================================
DELETE FROM public.members WHERE id = pg_temp.m(4) AND legacy_id = 104;
DELETE FROM public.cells WHERE id = pg_temp.c(2) AND legacy_id = 202;
SET LOCAL session_replication_role = origin;

SELECT ok(EXISTS (SELECT 1 FROM private.member_hierarchy WHERE member_id = pg_temp.m(4))
          AND EXISTS (SELECT 1 FROM private.cell_active_periods WHERE cell_id = pg_temp.c(2)),
  'replica: a exclusão física deixa as linhas órfãs nas duas tabelas');
SELECT is((SELECT array_agg(problem) FROM private.member_hierarchy_drift() WHERE member_id = pg_temp.m(4)),
  ARRAY['orphan_row'], 'member_hierarchy_drift(): a linha órfã aparece como orphan_row');
SELECT is((SELECT array_agg(problem || ':' || right(cell_id::text, 1)) FROM private.cell_active_period_problems()),
  ARRAY['orphan_row:2'], 'cell_active_period_problems(): só a linha órfã de C2, como orphan_row');

SELECT is(private.backfill_cell_active_periods(), 1, 'backfill_cell_active_periods(): apaga a órfã e a conta');
SELECT ok(NOT EXISTS (SELECT 1 FROM private.cell_active_periods WHERE cell_id = pg_temp.c(2))
          AND NOT EXISTS (SELECT 1 FROM private.cell_active_period_problems()),
  'depois do backfill: a linha de C2 saiu e a lista de problemas voltou vazia');

SELECT cmp_ok(private.rebuild_member_hierarchy(), '>=', 2,
  'rebuild_member_hierarchy(): conta a órfã apagada e os totais refeitos de quem estava acima');
SELECT ok(NOT EXISTS (SELECT 1 FROM private.member_hierarchy WHERE member_id = pg_temp.m(4)),
  'depois do recálculo: a linha órfã de Otávio saiu');
SELECT is_empty('SELECT * FROM private.member_hierarchy_drift()', 'member_hierarchy_drift() vazia depois do recálculo');
SELECT is(private.rebuild_member_hierarchy() + private.backfill_cell_active_periods(), 0,
  'os dois recálculos de novo não mudam nada');

SELECT * FROM finish();
ROLLBACK;
