-- E4 (PR 1), QA independente: todos os caminhos que poderiam gravar legacy_id (DT-02), a carga em replica
-- (UNIQUE vale para excluídos, CHECK, vários nulos) e as linhas órfãs com cenários mistos (DT-03).
-- Complementa e4_01_load_support. Massa fictícia carregada em replica, como a carga:
--   1 Samuel (pastor, 101); 2 Rita (Administrador, conta, 102); 3 Lia (Líder, conta, 103, de Rita);
--   4 Mara (Membro, conta, 104, de Lia); 5 Caio (105, de Mara, sem célula: pode ser excluído);
--   células C1 (201, líder Mara) e C2 (202, líder Mara); relatórios R1 (301, C1) e R2 (302, C2).
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(52);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a4020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c4020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d4020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e4020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5194020' || lpad(_n::text, 4, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- Pela API como o membro _n (JWT + papel authenticated): 'ok' ou o código do erro.
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

-- Como um papel da API sem JWT (service_role): 'ok' ou o SQLSTATE.
CREATE FUNCTION pg_temp.as_role(_role text, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql;
    RESET ROLE;
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RETURN _state;
  END;
END $$;

CREATE FUNCTION pg_temp.lid(_t text, _id uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r text;
BEGIN
  EXECUTE format('SELECT coalesce(legacy_id::text, ''nulo'') FROM public.%I WHERE id = %L', _t, _id) INTO _r;
  RETURN coalesce(_r, 'sem linha');
END $$;

INSERT INTO auth.users (id, email) VALUES
  (pg_temp.u(2), 'e402-2@teste.invalid'), (pg_temp.u(3), 'e402-3@teste.invalid'), (pg_temp.u(4), 'e402-4@teste.invalid');

SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id,
                            is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1), 101, 'Samuel Teste', 'M', true,  NULL,         false, NULL,         NULL, true, pg_temp.mob(1)),
  (pg_temp.m(2), 102, 'Rita Teste',   'F', false, pg_temp.m(1), true,  pg_temp.u(2), pg_temp.role('Administrador'), true, pg_temp.mob(2)),
  (pg_temp.m(3), 103, 'Lia Teste',    'F', false, pg_temp.m(2), true,  pg_temp.u(3), pg_temp.role('Líder'),         true, pg_temp.mob(3)),
  (pg_temp.m(4), 104, 'Mara Teste',   'F', false, pg_temp.m(3), true,  pg_temp.u(4), pg_temp.role('Membro'),        true, pg_temp.mob(4)),
  (pg_temp.m(5), 105, 'Caio Teste',   'M', false, pg_temp.m(4), true,  NULL,         NULL, true, pg_temp.mob(5));
INSERT INTO public.cells (id, legacy_id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  (pg_temp.c(1), 201, pg_temp.m(4), pg_temp.m(2), pg_temp.m(2), 'Evangelística', 'Quarta', '20:00', true),
  (pg_temp.c(2), 202, pg_temp.m(4), pg_temp.m(2), pg_temp.m(2), 'Discipulado',   'Quinta', '20:00', true);
INSERT INTO public.cell_reports (id, legacy_id, cell_id, date, time, was_held, theme, offering, visitors) VALUES
  (pg_temp.r(1), 301, pg_temp.c(1), '2026-01-07', '20:00', true, 'Tema E4', 10, ARRAY[]::text[]),
  (pg_temp.r(2), 302, pg_temp.c(2), '2026-01-08', '20:00', true, 'Tema E4', 10, ARRAY[]::text[]);
SET LOCAL session_replication_role = origin;

DO $$ BEGIN PERFORM private.rebuild_member_hierarchy(); END $$;
DO $$ BEGIN PERFORM private.backfill_cell_active_periods(); END $$;

-- ===========================================================================
-- DT-02: cada função semeada pela API
-- ===========================================================================
SELECT is(pg_temp.api(3, $$UPDATE public.members SET legacy_id = 777, notes = 'Líder edita' WHERE id = 'c4020000-0000-0000-0000-000000000004'$$),
  'ok', 'Líder pela API: UPDATE de discípulo com legacy_id não dá erro');
SELECT is((SELECT legacy_id || ' ' || notes FROM public.members WHERE id = pg_temp.m(4)), '104 Líder edita',
  'Líder pela API: a linha muda, o legacy_id do discípulo continua o da carga');
SELECT is(pg_temp.api(4, $$UPDATE public.members SET legacy_id = 778, notes = 'Membro edita' WHERE id = 'c4020000-0000-0000-0000-000000000004'$$),
  'ok', 'Membro pela API: UPDATE do próprio cadastro com legacy_id não dá erro');
SELECT is((SELECT legacy_id || ' ' || notes FROM public.members WHERE id = pg_temp.m(4)), '104 Membro edita',
  'Membro pela API: a linha muda, e ele não trocou o próprio legacy_id');
SELECT is(pg_temp.api(4, $$UPDATE public.members SET legacy_id = 101 WHERE id = 'c4020000-0000-0000-0000-000000000004'$$),
  'ok', 'Membro pela API: pedir o legacy_id de outro (101) não vira conflito de UNIQUE (23505)');
SELECT is(pg_temp.api(3, format($$INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, mobile_whatsapp)
                                  VALUES (%L, 101, 'Duplicata Teste', 'F', false, %L, %L)$$, pg_temp.m(6), pg_temp.m(3), pg_temp.mob(6))),
  'ok', 'Líder pela API: cadastro que repete um legacy_id existente (101) não dá 23505');
SELECT is(pg_temp.lid('members', pg_temp.m(6)), 'nulo', 'Líder pela API: o cadastro novo fica com legacy_id nulo');
SELECT is(pg_temp.api(2, $$SELECT public.check_member_insert('{"id": "c4020000-0000-0000-0000-000000000077", "legacy_id": 123,
  "name": "Ensaio Teste", "gender": "F", "is_pastor": false, "leader_id": "c4020000-0000-0000-0000-000000000003",
  "mobile_whatsapp": "51940209999"}'::jsonb)$$),
  'ok', 'Administrador: check_member_insert com legacy_id no JSON não recusa por isso');
SELECT is((SELECT count(*)::int FROM public.members WHERE id = 'c4020000-0000-0000-0000-000000000077'), 0,
  'check_member_insert não gravou nada');

-- save_cell_report: legacy_id dentro do JSON do relatório (aceito ou recusado por regra, nunca gravado)
DO $do$ BEGIN PERFORM pg_temp.api(2, $$SELECT * FROM public.save_cell_report('e4020000-0000-0000-0000-000000000001'::uuid,
  '{"theme": "Edita legacy", "legacy_id": 999}'::jsonb, NULL::uuid[])$$); END $do$;
SELECT is(pg_temp.lid('cell_reports', pg_temp.r(1)), '301', 'save_cell_report com "legacy_id" no JSON: o legacy_id do relatório continua 301');

-- ===========================================================================
-- DT-02: service_role, postgres, UPSERT, UPDATE em massa, para nulo, e a guarda não se desliga pela API
-- ===========================================================================
SELECT is(pg_temp.as_role('service_role', format($$INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, mobile_whatsapp)
                                  VALUES (%L, 555, 'Service Teste', 'M', false, %L, %L)$$, pg_temp.m(7), pg_temp.m(3), pg_temp.mob(7))),
  'ok', 'service_role: INSERT de membro com legacy_id é aceito');
SELECT is(pg_temp.lid('members', pg_temp.m(7)), 'nulo', 'service_role: o INSERT fica com legacy_id nulo');

INSERT INTO public.cells (id, legacy_id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
VALUES (pg_temp.c(1), 888, pg_temp.m(4), pg_temp.m(2), pg_temp.m(2), 'Evangelística', 'Quarta', '20:00')
ON CONFLICT (id) DO UPDATE SET legacy_id = 999, meeting_time = '21:30';
SELECT is((SELECT legacy_id || ' ' || to_char(meeting_time, 'HH24:MI') FROM public.cells WHERE id = pg_temp.c(1)), '201 21:30',
  'postgres: INSERT ... ON CONFLICT DO UPDATE muda a coluna pedida e mantém o legacy_id');

CREATE TEMP TABLE before_ids ON COMMIT DROP AS
  SELECT 'm' || id::text AS k, legacy_id FROM public.members WHERE legacy_id IS NOT NULL
  UNION ALL SELECT 'c' || id::text, legacy_id FROM public.cells WHERE legacy_id IS NOT NULL
  UNION ALL SELECT 'r' || id::text, legacy_id FROM public.cell_reports WHERE legacy_id IS NOT NULL;
UPDATE public.members SET legacy_id = legacy_id + 1000 WHERE legacy_id IS NOT NULL;
UPDATE public.cells SET legacy_id = legacy_id + 1000 WHERE legacy_id IS NOT NULL;
DO $$ BEGIN PERFORM set_config('mci.cell_report_write', 'on', true); END $$;
UPDATE public.cell_reports SET legacy_id = legacy_id + 1000 WHERE legacy_id IS NOT NULL;
UPDATE public.cell_reports SET legacy_id = NULL WHERE legacy_id IS NOT NULL;
DO $$ BEGIN PERFORM set_config('mci.cell_report_write', '', true); END $$;
UPDATE public.members SET legacy_id = NULL WHERE legacy_id IS NOT NULL;
UPDATE public.cells SET legacy_id = NULL WHERE legacy_id IS NOT NULL;
SELECT is_empty($$SELECT 1 FROM before_ids b WHERE b.legacy_id IS DISTINCT FROM
    coalesce((SELECT legacy_id FROM public.members WHERE 'm' || id::text = b.k),
             (SELECT legacy_id FROM public.cells WHERE 'c' || id::text = b.k),
             (SELECT legacy_id FROM public.cell_reports WHERE 'r' || id::text = b.k))$$,
  'postgres: UPDATE em massa (+1000 e para NULL) nas três tabelas não muda nenhum legacy_id');

SELECT is(pg_temp.api(2, 'SET LOCAL session_replication_role = replica'), '42501',
  'authenticated não liga session_replication_role = replica (a guarda não se desliga pela API)');
SELECT is(pg_temp.as_role('service_role', 'SET LOCAL session_replication_role = replica'), '42501',
  'service_role não liga session_replication_role = replica');
SELECT is(pg_temp.api(2, $$SELECT set_config('session_replication_role', 'replica', true)$$), '42501',
  'authenticated: set_config(session_replication_role) também recusado');
SELECT is(pg_temp.api(2, $$ALTER TABLE public.members DISABLE TRIGGER zy_keep_legacy_id$$), '42501',
  'authenticated não desliga o trigger zy_keep_legacy_id');
SELECT is(pg_temp.api(2, $$DROP TRIGGER zy_keep_legacy_id ON public.cells$$), '42501',
  'authenticated não remove o trigger zy_keep_legacy_id');

-- ===========================================================================
-- DT-02: exclusão e restauração mantêm o legacy_id; UNIQUE e CHECK valem em replica
-- ===========================================================================
-- (os legacy_id foram levados a nulo pelo teste acima? não: o UPDATE para NULL é descartado)
SELECT is(pg_temp.api(2, $$SELECT public.delete_member('c4020000-0000-0000-0000-000000000005')$$), 'ok', 'Administrador exclui Caio');
SELECT is(pg_temp.api(2, $$SELECT public.delete_cell('d4020000-0000-0000-0000-000000000002')$$), 'ok', 'Administrador exclui C2');
SELECT is(pg_temp.api(2, $$SELECT public.delete_cell_report('e4020000-0000-0000-0000-000000000001')$$), 'ok', 'Administrador exclui R1');
SELECT is(pg_temp.lid('members', pg_temp.m(5)) || '/' || pg_temp.lid('cells', pg_temp.c(2)) || '/' || pg_temp.lid('cell_reports', pg_temp.r(1)),
  '105/202/301', 'delete_member, delete_cell e delete_cell_report: os excluídos guardam o legacy_id');

SET LOCAL session_replication_role = replica;
SELECT throws_ok(format($$INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp)
  VALUES (%L, 105, 'Caio Duplicado', 'M', false, %L, true, %L)$$, pg_temp.m(8), pg_temp.m(4), pg_temp.mob(8)),
  '23505', NULL, 'replica: legacy_id de membro excluído (105) não pode ser reaproveitado (UNIQUE sem WHERE)');
SELECT throws_ok(format($$INSERT INTO public.cells (id, legacy_id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
  VALUES (%L, 202, %L, %L, %L, 'Evangelística', 'Sexta', '19:00')$$, pg_temp.c(8), pg_temp.m(4), pg_temp.m(2), pg_temp.m(2)),
  '23505', NULL, 'replica: legacy_id de célula excluída (202) não pode ser reaproveitado');
SELECT throws_ok(format($$INSERT INTO public.cell_reports (id, legacy_id, cell_id, date, time, was_held, theme, offering, visitors)
  VALUES (%L, 301, %L, '2026-01-21', '20:00', true, 'Dup', 1, ARRAY[]::text[])$$, pg_temp.r(8), pg_temp.c(1)),
  '23505', NULL, 'replica: legacy_id de relatório excluído (301) não pode ser reaproveitado');
SELECT lives_ok(format($$INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp) VALUES
  (%L, 'Nulo Um Teste', 'M', false, %L, true, %L), (%L, 'Nulo Dois Teste', 'M', false, %L, true, %L)$$,
  pg_temp.m(9), pg_temp.m(4), pg_temp.mob(9), pg_temp.m(10), pg_temp.m(4), pg_temp.mob(10)),
  'replica: vários cadastros sem legacy_id (nulo) convivem com o UNIQUE');
SELECT throws_ok(format($$INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp)
  VALUES (%L, 0, 'Zero Teste', 'M', false, %L, true, %L)$$, pg_temp.m(11), pg_temp.m(4), pg_temp.mob(11)),
  '23514', NULL, 'replica: members.legacy_id = 0 recusado pelo CHECK');
SELECT throws_ok(format($$INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp)
  VALUES (%L, -5, 'Negativo Teste', 'M', false, %L, true, %L)$$, pg_temp.m(12), pg_temp.m(4), pg_temp.mob(12)),
  '23514', NULL, 'replica: members.legacy_id negativo recusado pelo CHECK');
SELECT throws_ok(format($$INSERT INTO public.cell_reports (id, legacy_id, cell_id, date, time, was_held, theme, offering, visitors)
  VALUES (%L, 0, %L, '2026-01-28', '20:00', true, 'Zero', 1, ARRAY[]::text[])$$, pg_temp.r(9), pg_temp.c(1)),
  '23514', NULL, 'replica: cell_reports.legacy_id = 0 recusado pelo CHECK');
SET LOCAL session_replication_role = origin;

SELECT is(pg_temp.api(2, $$SELECT public.restore_member('c4020000-0000-0000-0000-000000000005')$$), 'ok', 'Administrador restaura Caio');
SELECT is(pg_temp.api(2, $$SELECT public.restore_cell('d4020000-0000-0000-0000-000000000002')$$), 'ok', 'Administrador restaura C2');
SELECT is(pg_temp.api(2, $$SELECT public.restore_cell_report('e4020000-0000-0000-0000-000000000001')$$), 'ok', 'Administrador restaura R1');
SELECT is(pg_temp.lid('members', pg_temp.m(5)) || '/' || pg_temp.lid('cells', pg_temp.c(2)) || '/' || pg_temp.lid('cell_reports', pg_temp.r(1)),
  '105/202/301', 'restore_*: o legacy_id volta como estava');

-- ===========================================================================
-- DT-03: órfãs e cenários mistos
-- ===========================================================================
DO $$ BEGIN PERFORM private.rebuild_member_hierarchy(); END $$;
DO $$ BEGIN PERFORM private.backfill_cell_active_periods(); END $$;
SELECT is_empty('SELECT * FROM private.member_hierarchy_drift()', 'base: member_hierarchy_drift() vazia antes das órfãs');
SELECT is_empty('SELECT * FROM private.cell_active_period_problems()', 'base: cell_active_period_problems() vazia antes das órfãs');

SET LOCAL session_replication_role = replica;
INSERT INTO private.member_hierarchy (member_id) VALUES
  ('f4020000-0000-0000-0000-000000000001'), ('f4020000-0000-0000-0000-000000000002'), ('f4020000-0000-0000-0000-000000000003');
INSERT INTO private.cell_active_periods (cell_id, periods) VALUES
  ('f4020000-0000-0000-0000-0000000000a1', '{(,)}'::tstzmultirange),
  ('f4020000-0000-0000-0000-0000000000a2', '{}'::tstzmultirange);
SET LOCAL session_replication_role = origin;

SELECT is((SELECT array_agg(problem) FROM private.member_hierarchy_drift()), ARRAY['orphan_row', 'orphan_row', 'orphan_row'],
  'drift: três órfãs, três orphan_row e nada mais');
SELECT is((SELECT count(*)::int FROM private.cell_active_period_problems() WHERE problem = 'orphan_row'
              AND cell_id IN ('f4020000-0000-0000-0000-0000000000a1', 'f4020000-0000-0000-0000-0000000000a2')), 2,
  'problems: as duas órfãs de período, a aberta e a vazia, aparecem como orphan_row');
SELECT is(private.rebuild_member_hierarchy(), 3, 'rebuild_member_hierarchy(): devolve exatamente 3 (só as órfãs; nada a refazer)');
SELECT is(private.backfill_cell_active_periods(), 2, 'backfill_cell_active_periods(): devolve exatamente 2');
SELECT is(private.rebuild_member_hierarchy() + private.backfill_cell_active_periods(), 0, 'segunda passada: 0');
SELECT is_empty('SELECT * FROM private.member_hierarchy_drift()', 'drift vazia depois do rebuild');
SELECT is_empty('SELECT * FROM private.cell_active_period_problems()', 'problems vazia depois do backfill');

-- Misto: órfã + membro e célula carregados sem linha.
SET LOCAL session_replication_role = replica;
INSERT INTO private.member_hierarchy (member_id) VALUES ('f4020000-0000-0000-0000-000000000004');
INSERT INTO private.cell_active_periods (cell_id, periods) VALUES ('f4020000-0000-0000-0000-0000000000a3', '{}'::tstzmultirange);
INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, leader_id, has_leadership, mobile_whatsapp)
  VALUES (pg_temp.m(20), 120, 'Carregado Teste', 'M', false, pg_temp.m(5), true, pg_temp.mob(20));
INSERT INTO public.cells (id, legacy_id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
  VALUES (pg_temp.c(20), 220, pg_temp.m(5), pg_temp.m(2), pg_temp.m(2), 'Evangelística', 'Sábado', '18:00');
SET LOCAL session_replication_role = origin;

SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift() WHERE problem = 'missing_row'), 1, 'drift: o carregado sem linha é missing_row');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift() WHERE problem = 'orphan_row'), 1, 'drift: a órfã do misto é orphan_row');
SELECT is((SELECT array_agg(problem ORDER BY problem) FROM private.cell_active_period_problems()),
  ARRAY['missing_row', 'orphan_row'], 'problems: célula sem linha (missing_row) e uma órfã');
SELECT is(private.backfill_cell_active_periods(), 2, 'backfill: apaga 1 órfã e cria 1 linha (2 mudanças)');
SELECT cmp_ok(private.rebuild_member_hierarchy(), '>=', 2, 'rebuild: apaga 1 órfã, cria a linha que faltava e refaz os totais');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift())
        + (SELECT count(*)::int FROM private.cell_active_period_problems()), 0, 'tudo volta vazio depois do misto');

-- Excluído lógico não é órfão: a linha fica.
SELECT is(pg_temp.api(2, $$SELECT public.delete_member('c4020000-0000-0000-0000-000000000020')$$), 'ok', 'Administrador exclui o carregado');
SELECT is(pg_temp.api(2, $$SELECT public.delete_cell('d4020000-0000-0000-0000-000000000020')$$), 'ok', 'Administrador exclui a célula carregada');
DO $$ BEGIN PERFORM private.rebuild_member_hierarchy(); END $$;
DO $$ BEGIN PERFORM private.backfill_cell_active_periods(); END $$;
SELECT ok(EXISTS (SELECT 1 FROM private.member_hierarchy WHERE member_id = pg_temp.m(20))
          AND EXISTS (SELECT 1 FROM private.cell_active_periods WHERE cell_id = pg_temp.c(20))
          AND NOT EXISTS (SELECT 1 FROM private.member_hierarchy_drift())
          AND NOT EXISTS (SELECT 1 FROM private.cell_active_period_problems()),
  'excluído lógico mantém a linha nas duas tabelas (os recálculos só apagam a órfã)');

SELECT * FROM finish();
ROLLBACK;
