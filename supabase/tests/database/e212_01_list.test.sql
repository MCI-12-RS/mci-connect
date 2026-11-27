-- E2.12 (PR 1): a lista de Relatórios com filtros (cell_reports_list e cell_reports_list_count), os
-- seletores de Líder e G12 (cell_report_filter_options e cell_report_filter_names), a semana do servidor
-- (server_weeks), as colunas novas da cell_reports_view (consulta, cell_visible), os participantes pelo
-- nome e a equivalência com o Dashboard (RN-18), pela sessão de cada persona; e o fim do lançamento pela
-- save_cell_report (migration 2).
-- Spec: docs/specs/e2-12-listagem-relatorios.md ("Massa de exemplo", "Critérios por regra",
-- "Verificações obrigatórias (para o QA)"; RN-01 a RN-18; DA-1 a DA-9; DT-01 a DT-10).
-- Massa (dados fictícios): a do Negócio (21 pessoas, 8 células, R1 a R10 e R3 excluído). Pessoas e
-- células com os triggers ligados (regras do E2.04 e do E2.08); os relatórios em replica, com o retrato
-- explícito (R5 com Fábio e Discipulado). Os outros cadastros da base ficam excluídos dentro da transação
-- (em replica, desfeito no ROLLBACK), para os números de Rita (Administrador) valerem.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(110);

-- ---------------------------------------------------------------------------
-- Massa
-- 1 Samuel, 2 Magda (pastores, casados); 3 Pedro (de Samuel) e 4 Paula (de Magda), casados;
-- 5 Tiago (de Samuel) e 6 Tânia (de Magda), casados; 7 André (de Pedro) e 8 Beatriz (de Tânia), casados;
-- 9 Caio e 10 Fábio (inativo), de André; 11 Gabriel, de Fábio; 12 Jonas, de Gabriel; 13 Carla, de Paula;
-- 14 Débora, de Beatriz; 15 Rita, de Tânia; 16 Diego e 17 Hugo, de Tiago; 18 Ester (sem liderança);
-- 19 Lúcia e 20 Lia, de Ester; 21 Sara (de Carla, excluída).
-- Funções: Rita Administrador; Samuel, Magda, Pedro, Paula, André e Diego Líder; Caio, Carla, Fábio,
-- Beatriz, Ester e Jonas Membro; Lia "Secretaria" (só view_all_reports); Hugo sem função.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2120000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2120000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2120000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2120000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192120' || lpad(_n::text, 4, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.br(_ts text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$ SELECT (_ts || ' America/Sao_Paulo')::timestamptz $$;

-- Isola a massa (desfeito no ROLLBACK).
SET LOCAL session_replication_role = replica;
UPDATE public.members SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE public.cells SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE public.cell_reports SET deleted_at = now() WHERE deleted_at IS NULL;
SET LOCAL session_replication_role = origin;

INSERT INTO public.roles (id, name) VALUES ('f2120000-0000-0000-0000-000000000001', 'Secretaria E212');
INSERT INTO public.role_permissions (role_id, permission)
VALUES ('f2120000-0000-0000-0000-000000000001', 'view_all_reports');

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e212-' || n || '@teste.invalid' FROM generate_series(1, 21) n;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1),  'Samuel Teste',  'M', true,  NULL,          false, pg_temp.u(1),  pg_temp.role('Líder'),  true,  pg_temp.mob(1)),
  (pg_temp.m(2),  'Magda Teste',   'F', true,  NULL,          false, pg_temp.u(2),  pg_temp.role('Líder'),  true,  pg_temp.mob(2)),
  (pg_temp.m(3),  'Pedro Teste',   'M', false, pg_temp.m(1),  true,  pg_temp.u(3),  pg_temp.role('Líder'),  true,  pg_temp.mob(3)),
  (pg_temp.m(4),  'Paula Teste',   'F', false, pg_temp.m(2),  true,  pg_temp.u(4),  pg_temp.role('Líder'),  true,  pg_temp.mob(4)),
  (pg_temp.m(5),  'Tiago Teste',   'M', false, pg_temp.m(1),  true,  pg_temp.u(5),  NULL,                   true,  pg_temp.mob(5)),
  (pg_temp.m(6),  'Tânia Teste',   'F', false, pg_temp.m(2),  true,  pg_temp.u(6),  NULL,                   true,  pg_temp.mob(6)),
  (pg_temp.m(7),  'André Teste',   'M', false, pg_temp.m(3),  true,  pg_temp.u(7),  pg_temp.role('Líder'),  true,  pg_temp.mob(7)),
  (pg_temp.m(8),  'Beatriz Teste', 'F', false, pg_temp.m(6),  true,  pg_temp.u(8),  pg_temp.role('Membro'), true,  pg_temp.mob(8)),
  (pg_temp.m(9),  'Caio Teste',    'M', false, pg_temp.m(7),  true,  pg_temp.u(9),  pg_temp.role('Membro'), true,  pg_temp.mob(9)),
  (pg_temp.m(10), 'Fábio Teste',   'M', false, pg_temp.m(7),  true,  pg_temp.u(10), pg_temp.role('Membro'), false, pg_temp.mob(10)),
  (pg_temp.m(11), 'Gabriel Teste', 'M', false, pg_temp.m(10), true,  pg_temp.u(11), NULL,                   true,  pg_temp.mob(11)),
  (pg_temp.m(12), 'Jonas Teste',   'M', false, pg_temp.m(11), true,  pg_temp.u(12), pg_temp.role('Membro'), true,  pg_temp.mob(12)),
  (pg_temp.m(13), 'Carla Teste',   'F', false, pg_temp.m(4),  true,  pg_temp.u(13), pg_temp.role('Membro'), true,  pg_temp.mob(13)),
  (pg_temp.m(14), 'Débora Teste',  'F', false, pg_temp.m(8),  true,  pg_temp.u(14), NULL,                   true,  pg_temp.mob(14)),
  (pg_temp.m(15), 'Rita Teste',    'F', false, pg_temp.m(6),  true,  pg_temp.u(15), pg_temp.role('Administrador'), true, pg_temp.mob(15)),
  (pg_temp.m(16), 'Diego Teste',   'M', false, pg_temp.m(5),  true,  pg_temp.u(16), pg_temp.role('Líder'),  true,  pg_temp.mob(16)),
  (pg_temp.m(17), 'Hugo Teste',    'M', false, pg_temp.m(5),  true,  pg_temp.u(17), NULL,                   true,  pg_temp.mob(17)),
  (pg_temp.m(18), 'Ester Teste',   'F', false, NULL,          false, pg_temp.u(18), pg_temp.role('Membro'), true,  pg_temp.mob(18)),
  (pg_temp.m(19), 'Lúcia Teste',   'F', false, pg_temp.m(18), true,  pg_temp.u(19), NULL,                   true,  pg_temp.mob(19)),
  (pg_temp.m(20), 'Lia Teste',     'F', false, pg_temp.m(18), true,  pg_temp.u(20), 'f2120000-0000-0000-0000-000000000001', true, pg_temp.mob(20)),
  (pg_temp.m(21), 'Sara Teste',    'F', false, pg_temp.m(13), true,  pg_temp.u(21), NULL,                   true,  pg_temp.mob(21));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.m(21);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time,
                          street, number, neighborhood, city, state, zip_code) VALUES
  (pg_temp.c(1), pg_temp.m(7),  pg_temp.m(9),  pg_temp.m(13), 'Evangelística', 'Quarta',  '20:00',
   'Rua das Flores', '100', 'Centro', 'Porto Alegre', 'RS', '90010000'),
  (pg_temp.c(3), pg_temp.m(14), pg_temp.m(15), pg_temp.m(8),  'Discipulado',   'Terça',   '19:30',
   'Rua Sao Joao', '12', 'Niterói', 'Canoas', 'RS', NULL),
  (pg_temp.c(5), pg_temp.m(12), pg_temp.m(11), pg_temp.m(10), 'Evangelística', 'Sexta',   '20:00',
   NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.c(6), pg_temp.m(4),  pg_temp.m(13), pg_temp.m(4),  'Discipulado',   'Segunda', '20:00',
   NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.c(7), pg_temp.m(1),  pg_temp.m(5),  pg_temp.m(2),  'Macrocélula',   'Domingo', '18:00',
   'Rua da Igreja', '1', 'Centro', 'Porto Alegre', 'RS', NULL),
  (pg_temp.c(8), pg_temp.m(18), pg_temp.m(19), pg_temp.m(18), 'Evangelística', 'Sábado',  '16:00',
   'Rua das Flores', '7', 'Rio Branco', 'Canoas', 'RS', NULL);
UPDATE public.cells SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.c(5);
SELECT private.rebuild_member_hierarchy();

-- Relatórios em replica, com o retrato da massa (R5: Fábio e Discipulado).
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, reason_not_held, observations, visitors, offering,
                                 snapshot_leader_id, snapshot_timothy_id, snapshot_host_id, snapshot_cell_type,
                                 created_by, created_by_kind, created_at, deleted_at) VALUES
  (pg_temp.r(9),  pg_temp.c(6), '2026-11-23', '20:00', true,  'Amizade', NULL, NULL, '{V1,V2,V3}', 40,
   pg_temp.m(4), pg_temp.m(13), pg_temp.m(4), 'Discipulado', NULL, 'system', pg_temp.br('2026-11-23 21:00'), NULL),
  (pg_temp.r(10), pg_temp.c(7), '2026-11-22', '18:00', true,  'Visão', NULL, NULL, '{V1,V2,V3,V4,V5}', 300,
   pg_temp.m(1), pg_temp.m(5), pg_temp.m(2), 'Macrocélula', NULL, 'system', pg_temp.br('2026-11-22 19:00'), NULL),
  (pg_temp.r(6),  pg_temp.c(5), '2026-11-20', '20:00', true,  'Gratidão', NULL, NULL, '{V1}', 30,
   pg_temp.m(12), pg_temp.m(11), pg_temp.m(10), 'Evangelística', NULL, 'system', pg_temp.br('2026-11-20 21:00'), NULL),
  (pg_temp.r(1),  pg_temp.c(1), '2026-11-18', '20:00', true,  'A fé que vence', NULL, 'Dois visitantes do trabalho do Caio',
   '{"João Pereira","Maria Lima"}', 50,
   pg_temp.m(7), pg_temp.m(9), pg_temp.m(13), 'Evangelística', pg_temp.m(9), 'member', pg_temp.br('2026-11-18 21:40'), NULL),
  (pg_temp.r(2),  pg_temp.c(1), '2026-11-11', '20:00', false, NULL, 'Chuva forte no bairro', NULL, '{}', NULL,
   pg_temp.m(7), pg_temp.m(9), pg_temp.m(13), 'Evangelística', NULL, 'system', pg_temp.br('2026-11-11 21:00'), NULL),
  (pg_temp.r(8),  pg_temp.c(3), '2026-11-10', '19:30', true,  'Família', NULL, NULL, '{}', 25,
   pg_temp.m(14), pg_temp.m(15), pg_temp.m(8), 'Discipulado', NULL, 'system', pg_temp.br('2026-11-10 21:00'), NULL),
  (pg_temp.r(4),  pg_temp.c(1), '2026-10-28', '20:00', true,  'Perdão', NULL, NULL, '{}', 20,
   pg_temp.m(7), pg_temp.m(9), pg_temp.m(13), 'Evangelística', NULL, 'system', pg_temp.br('2026-10-28 21:00'), NULL),
  (pg_temp.r(5),  pg_temp.c(1), '2026-10-21', '20:00', true,  'Oração', NULL, NULL, '{V1}', 15,
   pg_temp.m(10), pg_temp.m(9), pg_temp.m(13), 'Discipulado', NULL, 'system', pg_temp.br('2026-10-21 21:00'), NULL),
  (pg_temp.r(3),  pg_temp.c(1), '2026-11-04', '20:15', true,  'Excluído', NULL, NULL, '{}', 10,
   pg_temp.m(7), pg_temp.m(9), pg_temp.m(13), 'Evangelística', NULL, 'system', pg_temp.br('2026-11-04 21:00'), now());
INSERT INTO public.cell_report_participants (report_id, member_id)
SELECT pg_temp.r(1), pg_temp.m(n) FROM unnest(ARRAY[7, 8, 9, 13, 14, 11, 12, 21]) n
UNION ALL SELECT pg_temp.r(9), pg_temp.m(n) FROM unnest(ARRAY[4, 13]) n
UNION ALL SELECT pg_temp.r(10), pg_temp.m(n) FROM unnest(ARRAY[1, 2, 5]) n;
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE lbl (id uuid PRIMARY KEY, label text);
INSERT INTO lbl SELECT pg_temp.r(n), 'R' || n FROM generate_series(1, 10) n;
GRANT SELECT ON lbl TO authenticated;

-- ---------------------------------------------------------------------------
-- Leitura "pela API": papel authenticated com o JWT de um membro da massa. Devolve o jsonb da
-- consulta, ou {"error": SQLSTATE}.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.run_as(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _v jsonb; _state text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql INTO _v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    _v := jsonb_build_object('error', _state);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN _v;
END $$;
CREATE FUNCTION pg_temp.args(_args text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN _args ~ '_limit' THEN _args ELSE concat_ws(', ', nullif(_args, ''), '_limit => 100') END $$;
-- Os relatórios da página, pelos rótulos, na ordem da lista.
CREATE FUNCTION pg_temp.list(_n int, _args text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(coalesce(l.label, t.id::text) ORDER BY t.ordinality), ''[]'')
     FROM public.cell_reports_list(%s) WITH ORDINALITY t LEFT JOIN pg_temp.lbl l ON l.id = t.id',
  pg_temp.args(_args)));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
CREATE FUNCTION pg_temp.cnt(_n int, _args text DEFAULT '') RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(pg_temp.run_as(_n, format('SELECT to_jsonb(public.cell_reports_list_count(%s))', _args)) ->> 'error',
                   pg_temp.run_as(_n, format('SELECT to_jsonb(public.cell_reports_list_count(%s))', _args))::text) $$;
-- A view direto, na ordem da RN-13, pelos rótulos.
CREATE FUNCTION pg_temp.view_list(_n int) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n,
  'SELECT coalesce(jsonb_agg(coalesce(l.label, v.id::text) ORDER BY v.date DESC, v."time" DESC, v.id), ''[]'')
     FROM public.cell_reports_view v LEFT JOIN pg_temp.lbl l ON l.id = v.id');
BEGIN
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
-- Todas as páginas, de _size em _size: os rótulos na ordem em que vieram.
CREATE FUNCTION pg_temp.pages(_n int, _size int, _args text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _all text[] := '{}'; _page text[]; _off int := 0;
BEGIN
  LOOP
    _page := pg_temp.list(_n, concat_ws(', ', nullif(_args, ''), format('_limit => %s, _offset => %s', _size, _off)));
    EXIT WHEN cardinality(_page) = 0 OR _off > 1000;
    _all := _all || _page;
    _off := _off + _size;
  END LOOP;
  RETURN _all;
END $$;
CREATE FUNCTION pg_temp.ids(VARIADIC _n int[]) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT quote_literal(array_agg(pg_temp.m(n) ORDER BY o)::text) FROM unnest(_n) WITH ORDINALITY t(n, o) $$;
-- Opções e nomes dos seletores: "Nome (nível)" ou só "Nome"; com "/F" ou "/M" quando o sexo vem.
CREATE FUNCTION pg_temp.opts(_n int, _person text, _extra text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(split_part(t.name, '' '', 1) || coalesce('' ('' || t.g12_level || '')'', '''')
                             || CASE WHEN t.is_pastor THEN '' pastor'' ELSE '''' END || coalesce(''/'' || t.gender, '''')
                    ORDER BY t.ordinality), ''[]'')
     FROM public.cell_report_filter_options(%L%s) WITH ORDINALITY t', _person, _extra));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
CREATE FUNCTION pg_temp.names(_n int, _person text, _ids text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(split_part(t.name, '' '', 1) ORDER BY t.ordinality), ''[]'')
     FROM public.cell_report_filter_names(%L, %s::uuid[]) WITH ORDINALITY t', _person, _ids));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;

-- ===========================================================================
-- 1. Estrutura e privilégios — 9
-- ===========================================================================
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
              AND p.proname IN ('cell_reports_list', 'cell_reports_list_count', 'cell_report_filter_options',
                                'cell_report_filter_names', 'server_weeks')
              AND 'search_path=public' = ANY (p.proconfig)),
  ARRAY['cell_report_filter_names', 'cell_report_filter_options', 'cell_reports_list', 'cell_reports_list_count'],
  'as quatro RPCs são definer com search_path fixo');
SELECT ok((SELECT NOT prosecdef AND 'search_path=public' = ANY (proconfig) FROM pg_proc
            WHERE oid = 'public.server_weeks(timestamptz)'::regprocedure), 'server_weeks é invoker com search_path fixo');
SELECT is((SELECT array_agg(DISTINCT a.grantee::regrole::text ORDER BY a.grantee::regrole::text)
             FROM pg_proc p, aclexplode(p.proacl) a
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('cell_reports_list', 'cell_reports_list_count', 'cell_report_filter_options',
                                'cell_report_filter_names', 'server_weeks')),
  ARRAY['authenticated', 'postgres'], 'EXECUTE das cinco só para authenticated (e a dona)');
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.oid IN ('private.cell_report_filter_people(uuid[])'::regprocedure,
                            'private.cell_report_filter_normalize(text[],uuid,uuid[],uuid[],date,date,text[],boolean)'::regprocedure,
                            'private.cell_report_filter_sql(private.cell_report_filter)'::regprocedure)
              AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   OR has_function_privilege('service_role', p.oid, 'EXECUTE'))), 0,
  'as três internas sem EXECUTE para os papéis da API');
SELECT ok(NOT has_schema_privilege('anon', 'private', 'USAGE') AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
  'os papéis da API sem USAGE em private');
SELECT is((SELECT reloptions FROM pg_class WHERE oid = 'public.cell_reports_view'::regclass),
  ARRAY['security_barrier=true', 'security_invoker=false'], 'cell_reports_view: as reloptions de antes');
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
            WHERE attrelid = 'public.cell_reports_view'::regclass AND attnum > 44 AND NOT attisdropped),
  ARRAY['cell_city', 'cell_state', 'cell_zip_code', 'cell_visible'], 'cell_reports_view: as quatro colunas novas no fim');
SELECT ok((SELECT prosecdef AND prosrc NOT LIKE '%submit_cell_report%' AND prosrc LIKE '%report_id_required%'
             FROM pg_proc WHERE oid = 'public.save_cell_report(uuid,jsonb,uuid[])'::regprocedure)
          AND NOT has_function_privilege('anon', 'public.save_cell_report(uuid,jsonb,uuid[])', 'EXECUTE'),
  'migration 2: save_cell_report definer, sem anon e sem o lançamento');
SELECT is((SELECT private.cell_report_filter_sql(private.cell_report_filter_normalize(
             ARRAY['%x%'], pg_temp.c(1), ARRAY[pg_temp.m(7)], ARRAY[pg_temp.m(3)], '2026-11-01', '2026-11-30',
             ARRAY['Discipulado'], true))),
  'true AND v.search_text ILIKE ALL (($1).search) AND v.cell_id = ($1).cell_id AND v.snapshot_leader_id = ANY (($1).leader_ids)'
  || ' AND v.snapshot_g12_leader_id = ANY (($1).g12_ids) AND v.date >= ($1).date_from AND v.date <= ($1).date_to'
  || ' AND v.snapshot_cell_type = ANY (($1).types) AND v.was_held = ($1).held',
  'risco 1: o WHERE só com fragmentos fixos, sem nenhum valor');

-- ===========================================================================
-- 2. Paridade por persona (RN-01, RN-03, RN-13) — 18
-- ===========================================================================
CREATE TEMP TABLE persona (n int, nome text, expected text[]);
INSERT INTO persona VALUES
  (15, 'Rita',   ARRAY['R9', 'R10', 'R6', 'R1', 'R2', 'R8', 'R4', 'R5']),
  (1,  'Samuel', ARRAY['R9', 'R10', 'R6', 'R1', 'R2', 'R8', 'R4', 'R5']),
  (20, 'Lia',    ARRAY['R9', 'R10', 'R6', 'R1', 'R2', 'R8', 'R4', 'R5']),
  (7,  'André',  ARRAY['R9', 'R6', 'R1', 'R2', 'R8', 'R4', 'R5']),
  (3,  'Pedro',  ARRAY['R9', 'R6', 'R1', 'R2', 'R4', 'R5']),
  (9,  'Caio',   ARRAY['R9', 'R6', 'R1', 'R2', 'R4', 'R5']),
  (16, 'Diego',  ARRAY['R10', 'R8']),
  (18, 'Ester',  ARRAY[]::text[]),
  (17, 'Hugo',   ARRAY[]::text[]);
SELECT is(pg_temp.pages(p.n, 3), p.expected, 'RN-01/RN-13: ' || p.nome || ': todas as páginas (de 3 em 3) = os visíveis, na ordem')
  FROM persona p ORDER BY p.n;
SELECT ok(pg_temp.pages(p.n, 2) = pg_temp.view_list(p.n) AND pg_temp.cnt(p.n) = cardinality(pg_temp.view_list(p.n))::text,
          'RN-03: ' || p.nome || ': a lista e o total iguais aos da cell_reports_view')
  FROM persona p ORDER BY p.n;

-- ===========================================================================
-- 3. Filtros (RN-02, RN-05, RN-06, RN-08, RN-09, RN-11, RN-14) — 20
-- ===========================================================================
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(7))), ARRAY['R1', 'R2', 'R4'],
  'RN-05: Líder André: os relatórios em que ele é o líder registrado (R5 é de Fábio)');
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(10))), ARRAY['R5'], 'RN-04/RN-05: Líder Fábio: R5, pelo retrato');
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(9))), ARRAY[]::text[], 'RN-05: timóteo não conta (Caio)');
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(3))), ARRAY[]::text[], 'RN-05: não é "em qualquer nível" (Pedro)');
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(3))), ARRAY['R6', 'R1', 'R2', 'R4', 'R5'], 'RN-06: G12 Pedro');
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(4))), ARRAY['R9'], 'RN-06: G12 Paula, inclusive o dela própria; por pessoa, sem o cônjuge');
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(1))), ARRAY[]::text[], 'RN-06: relatório de pastor nunca entra no G12');
SELECT is(pg_temp.list(15, '_types => ''{Discipulado}'''), ARRAY['R9', 'R8', 'R5'], 'RN-11: Tipo pelo retrato (R5 Discipulado; C1 é Evangelística hoje)');
SELECT is(pg_temp.list(15, '_held => false'), ARRAY['R2'], 'RN-11: Não houve célula');
SELECT is(pg_temp.cnt(15, '_held => true'), '7', 'RN-11: Célula realizada');
SELECT is(pg_temp.list(15, format('_cell_id => %L', pg_temp.c(1))), ARRAY['R1', 'R2', 'R4', 'R5'], 'RN-08: Célula C1, qualquer que seja o retrato');
SELECT is(pg_temp.list(15, format('_cell_id => %L', pg_temp.c(5))), ARRAY['R6'], 'RN-03/RN-08: a célula excluída continua com os relatórios');
SELECT is(pg_temp.list(16, format('_cell_id => %L', pg_temp.c(1))), ARRAY[]::text[], 'RN-08: Diego não alcança C1: lista vazia');
SELECT is(pg_temp.list(15, '_date_from => ''2026-11-18'', _date_to => ''2026-11-18'''), ARRAY['R1'], 'RN-09: os dois dias entram');
SELECT is(pg_temp.list(15, '_date_from => ''2026-11-20'''), ARRAY['R9', 'R10', 'R6'], 'RN-09: só "De"');
SELECT is(pg_temp.list(15, '_date_to => ''2026-10-28'''), ARRAY['R4', 'R5'], 'RN-09: só "Até"');
SELECT is(pg_temp.list(15, '_date_from => ''2026-11-22'', _date_to => ''2027-12-31'''), ARRAY['R9', 'R10'], 'RN-09: datas futuras aceitas');
SELECT is(pg_temp.list(15, '_date_from => ''2026-11-30'', _date_to => ''2026-11-01'''), pg_temp.view_list(15), 'DA-6: datas invertidas desligam o Período');
SELECT is(pg_temp.list(15, '_search => ''{%fabio%}'''), ARRAY['R5'], 'RN-14: busca pelo líder registrado, sem acento');
SELECT is(pg_temp.list(15, format('_search => ''{%%fe%%}'', _leader_ids => %s, _g12_ids => %s, _date_from => ''2026-10-01'', _date_to => ''2026-11-30'', _types => ''{Evangelística,Discipulado}'', _held => true',
                                  pg_temp.ids(7, 10), pg_temp.ids(3))),
  ARRAY['R1'], 'RN-02: a combinação (busca, Líder com 2, G12, Período, Tipo com 2 e Reunião): todos valem (E)');

-- ===========================================================================
-- 4. DA-1 a DA-3: valores fora da regra — 10
-- ===========================================================================
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(2, 3, 5, 6, 8, 9, 11, 13, 15, 16, 4, 7))), ARRAY[]::text[],
  'DA-1/RN-05: com 12 ids valem os 10 primeiros (Paula e André, 11º e 12º, saem)');
SELECT is(pg_temp.list(15, format('_leader_ids => ARRAY[NULL, %L, %L]::uuid[]', pg_temp.m(7), pg_temp.m(7))), ARRAY['R1', 'R2', 'R4'],
  'DA-3: repetidos e nulos contam uma vez');
SELECT is(pg_temp.list(15, '_leader_ids => ''{}''::uuid[]'), pg_temp.view_list(15), 'DA-1: Líder vazio = sem filtro');
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(21))), ARRAY[]::text[], 'DA-2: só um excluído no Líder: nada volta');
SELECT is(pg_temp.list(15, format('_leader_ids => ARRAY[%L, %L]::uuid[]', 'ffffffff-0000-0000-0000-000000000000', pg_temp.m(4))), ARRAY['R9'],
  'DA-2: o inexistente sai, e a outra pessoa vale');
SELECT is(pg_temp.list(15, '_types => ''{Foo}'''), pg_temp.view_list(15), 'DA-1: tipo fora de cell_types() ignorado');
SELECT is(cardinality(pg_temp.list(15, '_limit => 0')), 1, 'DA-1: _limit 0 vira 1');
SELECT is(pg_temp.list(15, '_limit => 2, _offset => -5'), ARRAY['R9', 'R10'], 'DA-1: _offset negativo vira 0');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list(_cell_id => ''xyz'')') ->> 'error', '22P02',
  'leitura técnica 1: uuid malformado recusado');
SELECT ok(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list(_date_from => ''2026-02-30'')') ->> 'error' IN ('22008', '22007'),
  'leitura técnica 1: data impossível recusada');

-- ===========================================================================
-- 5. Injeção (risco 1) — 3
-- ===========================================================================
SELECT is(pg_temp.list(15, $q$_search => ARRAY['%''); DROP TABLE public.members; --%']$q$), ARRAY[]::text[],
  'risco 1: texto malicioso na busca é texto, sem erro');
SELECT is(pg_temp.cnt(15, $q$_search => ARRAY['%\_%', '%"%', '%''%']$q$), '0', 'risco 1: barra, sublinhado e aspas sem erro');
SELECT ok(to_regclass('public.members') IS NOT NULL AND (SELECT count(*) FROM public.members WHERE id::text LIKE 'c2120000%') = 21,
  'risco 1: nada mudou');

-- ===========================================================================
-- 6. Seletores (RN-05 a RN-07; DA-4, DA-5) — 16
-- ===========================================================================
SELECT is(pg_temp.opts(15, 'leader'), ARRAY['André (2)', 'Débora (3)', 'Fábio (3)', 'Jonas (5)', 'Paula (1)', 'Samuel (0) pastor/M'],
  'RN-05: opções do Líder de Rita, em ordem, com o nível; o sexo só do pastor');
SELECT is(pg_temp.opts(15, 'g12'), ARRAY['Paula', 'Pedro', 'Tânia'], 'RN-06: opções do G12 de Rita (sem pastor), só o nome');
SELECT is(pg_temp.opts(3, 'leader'), ARRAY['André (2)', 'Fábio (3)', 'Jonas (5)', 'Paula (1)'], 'RN-05: opções do Líder de Pedro');
SELECT is(pg_temp.opts(3, 'g12'), ARRAY['Paula', 'Pedro'], 'RN-06: opções do G12 de Pedro');
SELECT is(pg_temp.opts(16, 'leader'), ARRAY['Débora (3)', 'Samuel (0) pastor/M'], 'RN-05: opções do Líder de Diego');
SELECT is(pg_temp.opts(16, 'g12'), ARRAY['Tânia'], 'RN-06: opções do G12 de Diego');
SELECT is(pg_temp.opts(15, 'leader', ', _search => ''{%fa%}'''), ARRAY['Fábio (3)'], 'RN-05: a busca sem acento');
SELECT is(pg_temp.opts(15, 'leader', ', _limit => 2, _offset => 2'), ARRAY['Fábio (3)', 'Jonas (5)'], 'RN-05: paginada no servidor');
SELECT is(pg_temp.names(3, 'leader', pg_temp.ids(14)), ARRAY[]::text[], 'RN-07: Débora para Pedro: nenhuma linha');
SELECT is(pg_temp.names(3, 'g12', pg_temp.ids(6)), ARRAY[]::text[], 'RN-07: Tânia para Pedro: nenhuma linha');
SELECT is(pg_temp.names(16, 'g12', pg_temp.ids(6)), ARRAY['Tânia'], 'RN-07: Tânia para Diego: o nome');
SELECT is(pg_temp.names(20, 'leader', pg_temp.ids(7)), ARRAY['André'], 'RN-07: André para Lia: o nome, pelo relatório');
SELECT is(pg_temp.names(20, 'leader', pg_temp.ids(9)), ARRAY[]::text[], 'RN-07: Caio para Lia: nenhuma');
SELECT is(pg_temp.names(15, 'leader', pg_temp.ids(9)), ARRAY['Caio'], 'RN-07: Caio para Rita: o nome');
SELECT is(pg_temp.names(15, 'leader', format('ARRAY[%L, %L]', pg_temp.m(21), 'ffffffff-0000-0000-0000-000000000000')), ARRAY[]::text[],
  'RN-07: excluído e inexistente: nenhuma linha');
SELECT ok(pg_temp.run_as(3, format($q$SELECT jsonb_build_array(
            (SELECT jsonb_agg(t) FROM public.cell_report_filter_options('leader') t),
            (SELECT jsonb_agg(t) FROM public.cell_report_filter_options('g12') t),
            (SELECT jsonb_agg(t) FROM public.cell_report_filter_names('leader', ARRAY[%L, %L, %L, %L]::uuid[]) t),
            (SELECT jsonb_agg(t) FROM public.cell_report_filter_names('g12', ARRAY[%L, %L, %L, %L]::uuid[]) t),
            (SELECT jsonb_agg(t) FROM public.cell_reports_list() t))$q$,
            pg_temp.m(14), pg_temp.m(6), pg_temp.m(1), pg_temp.m(2), pg_temp.m(14), pg_temp.m(6), pg_temp.m(1), pg_temp.m(2)))::text
          !~ (pg_temp.m(14)::text || '|' || pg_temp.m(6)::text || '|' || pg_temp.m(1)::text || '|' || pg_temp.m(2)::text
              || '|Débora|Tânia|Samuel|Magda'),
  'RN-07: nenhuma resposta de Pedro traz o id ou o nome de Débora, Tânia, Samuel ou Magda');

-- ===========================================================================
-- 7. RN-10: server_weeks — 6
-- ===========================================================================
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks(pg_temp.br('2026-11-24 21:00')) w),
  '{"today": "2026-11-24", "this_week_start": "2026-11-22", "this_week_end": "2026-11-28", "last_week_start": "2026-11-15",
    "last_week_end": "2026-11-21", "week_before_last_start": "2026-11-08", "week_before_last_end": "2026-11-14"}'::jsonb,
  'RN-10: terça, 24/11, às 21:00: as três semanas');
SELECT is((SELECT this_week_start FROM public.server_weeks('2026-11-29 02:59:59+00')), '2026-11-22'::date,
  'RN-10: sábado, 23:59:59 de Brasília: a semana de 22/11');
SELECT is((SELECT this_week_start FROM public.server_weeks('2026-11-29 03:00:00+00')), '2026-11-29'::date,
  'RN-10: domingo, 00:00 de Brasília: a semana de 29/11');
SET LOCAL TimeZone = 'Asia/Tokyo';
SELECT is((SELECT this_week_start::text || ' ' || today::text FROM public.server_weeks('2026-11-29 02:59:59+00')), '2026-11-22 2026-11-28',
  'RN-10: na sessão em Asia/Tokyo, o mesmo');
SET LOCAL TimeZone = 'UTC';
SELECT is((SELECT this_week_start::text || ' ' || today::text FROM public.server_weeks('2026-11-29 02:59:59+00')), '2026-11-22 2026-11-28',
  'RN-10: na sessão em UTC, o mesmo');
SELECT is(to_jsonb((SELECT this_week_start FROM public.server_weeks(pg_temp.br('2026-11-24 21:00')))),
          pg_temp.run_as(15, format('SELECT to_jsonb(week_start) FROM public.dashboard_summary(%L)', pg_temp.br('2026-11-24 21:00'))),
  'RN-10/RN-18: igual à week_start da dashboard_summary no mesmo instante');
RESET TimeZone;

-- ===========================================================================
-- 8. RN-18: a lista e o Dashboard, por persona e por semana — 9
-- ===========================================================================
CREATE FUNCTION pg_temp.dash_eq(_n int, _at timestamptz) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE _d jsonb; _l jsonb;
BEGIN
  _d := pg_temp.run_as(_n, format('SELECT to_jsonb(d) FROM public.dashboard_summary(%L) d', _at));
  _l := pg_temp.run_as(_n, format($q$
    SELECT jsonb_build_object(
      'sent', public.cell_reports_list_count(_date_from => w.this_week_start, _date_to => w.this_week_end),
      'visitors', (SELECT coalesce(sum(t.visitors_count), 0) FROM public.cell_reports_list(_date_from => w.this_week_start,
                                                                   _date_to => w.this_week_end, _limit => 100) t),
      'not_held', public.cell_reports_list_count(_date_from => w.this_week_start, _date_to => w.this_week_end, _held => false),
      'held', public.cell_reports_list_count(_date_from => w.this_week_start, _date_to => w.this_week_end, _held => true))
      FROM public.server_weeks(%L) w$q$, _at));
  RETURN (_d ->> 'reports_sent')::int = (_l ->> 'sent')::int
     AND (_d ->> 'visitors')::int = (_l ->> 'visitors')::int
     AND (_d ->> 'cells_not_held')::int = (_l ->> 'not_held')::int
     AND (_d ->> 'reports_sent')::int - (_d ->> 'cells_not_held')::int = (_l ->> 'held')::int
     AND (_l ->> 'sent')::int > 0;
END $$;
SELECT ok(pg_temp.dash_eq(p.n, w.at), format('RN-18: %s, semana de %s: enviados, visitantes, não houve e realizadas iguais', p.nome, w.lbl))
  FROM (VALUES (15, 'Rita'), (3, 'Pedro'), (16, 'Diego')) p(n, nome)
 CROSS JOIN (VALUES (pg_temp.br('2026-11-24 21:00'), '22/11'), (pg_temp.br('2026-11-17 21:00'), '15/11 (célula excluída)'),
                    (pg_temp.br('2026-11-10 21:00'), '08/11 (não houve)')) w(at, lbl)
 WHERE NOT (p.n = 16 AND w.lbl LIKE '15/11%')
 ORDER BY p.n, w.at;
SELECT is(pg_temp.cnt(16, '_date_from => ''2026-11-15'', _date_to => ''2026-11-21'''), '0', 'RN-18: Diego, semana de 15/11: nenhum relatório');

-- ===========================================================================
-- 9. RN-16, RN-17: a consulta e os participantes — 9
-- ===========================================================================
SELECT is(pg_temp.run_as(3, format('SELECT to_jsonb(count(*)) FROM public.cell_reports_view WHERE id IN (%L, %L, %L)',
                                   pg_temp.r(8), pg_temp.r(3), 'ffffffff-0000-0000-0000-000000000000')), '0'::jsonb,
  'RN-16 d: Pedro em R8 (invisível), R3 (excluído) e num inexistente: nenhuma linha');
SELECT is(pg_temp.run_as(15, format('SELECT jsonb_build_object(''city'', cell_city, ''state'', cell_state, ''zip'', cell_zip_code, ''visible'', cell_visible) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1))),
  '{"city": "Porto Alegre", "state": "RS", "zip": "90010000", "visible": true}'::jsonb, 'RN-16 b: as colunas novas de R1');
SELECT is(pg_temp.run_as(20, format('SELECT to_jsonb(cell_visible) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1))), 'false'::jsonb,
  'DA-9: Lia em R1: não vê a célula');
SELECT is(pg_temp.run_as(15, format('SELECT to_jsonb(cell_visible) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(6))), 'false'::jsonb,
  'DA-9: Rita em R6 (célula excluída): falso');
SELECT is((SELECT array_agg(p.nome ORDER BY p.n) FROM persona p
            WHERE pg_temp.run_as(p.n, 'SELECT coalesce(jsonb_agg(v.id) FILTER (WHERE v.cell_visible IS DISTINCT FROM EXISTS
                                          (SELECT 1 FROM public.cells_view c WHERE c.id = v.cell_id)), ''[]'')
                                         FROM public.cell_reports_view v') <> '[]'::jsonb),
  NULL, 'DA-9: cell_visible igual a "a célula está na cells_view", para cada persona e cada relatório');
SELECT is(pg_temp.run_as(3, format('SELECT jsonb_agg(split_part(member_name, '' '', 1) ORDER BY member_name) FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(1))),
  '["André", "Beatriz", "Caio", "Carla", "Débora", "Gabriel", "Jonas", "Sara"]'::jsonb, 'RN-17: os 8 participantes de R1 para Pedro');
SELECT is(pg_temp.run_as(3, format('SELECT jsonb_agg(split_part(member_name, '' '', 1) ORDER BY member_name) FROM public.cell_report_participants_view WHERE report_id = %L AND member_is_active IS NULL AND member_gender IS NULL', pg_temp.r(1))),
  '["Beatriz", "Débora", "Sara"]'::jsonb, 'RN-17/DA-8: sem situação e sexo de quem Pedro não vê');
SELECT is(pg_temp.run_as(17, format('SELECT to_jsonb(count(*)) FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(1))), '0'::jsonb,
  'RN-17: Hugo não lê nenhum');
SELECT is(pg_temp.run_as(3, format('SELECT to_jsonb(participants_count) FROM public.cell_reports_list(_cell_id => %L, _limit => 1) t', pg_temp.c(1))), '8'::jsonb,
  'RN-15: o número de participantes vem na linha da lista (com a excluída)');

-- ===========================================================================
-- 10. RN-13: 60 relatórios na mesma data e horário — 2
-- ===========================================================================
SET LOCAL session_replication_role = replica;
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
SELECT ('d2120000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, pg_temp.m(18), pg_temp.m(19), pg_temp.m(18),
       'Evangelística', 'Quarta', '20:00'
  FROM generate_series(1, 60) n;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering,
                                 snapshot_leader_id, snapshot_timothy_id, snapshot_host_id, snapshot_cell_type)
SELECT ('e2120000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, ('d2120000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid,
       '2026-09-02', '20:00', true, 'Mesma hora', 10, pg_temp.m(18), pg_temp.m(19), pg_temp.m(18), 'Evangelística'
  FROM generate_series(1, 60) n;
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.pages(15, 25, '_date_from => ''2026-09-02'', _date_to => ''2026-09-02'''),
  ARRAY(SELECT ('e2120000-0000-0000-0001-' || lpad(n::text, 12, '0')) FROM generate_series(1, 60) n ORDER BY 1),
  'RN-13: 60 na mesma data e horário, de 25 em 25: cada um uma vez, pelo id');
SELECT is(pg_temp.cnt(15, '_date_from => ''2026-09-02'', _date_to => ''2026-09-02'''), '60', 'RN-13: o total exato');

-- ===========================================================================
-- 11. Migration 2: a save_cell_report sem id — 2
-- ===========================================================================
SELECT is(pg_temp.run_as(15, format($q$SELECT to_jsonb(r) FROM public.save_cell_report(NULL,
            jsonb_build_object('cell_id', %L::uuid, 'date', public.sp_today(), 'time', '00:00', 'theme', 'Novo', 'offering', 0)) r$q$,
            pg_temp.c(8))) ->> 'error', '22023', 'DT-10: save_cell_report(NULL, …) recusa (report_id_required)');
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE cell_id = pg_temp.c(8)), 0, 'DT-10: sem gravar');

-- ===========================================================================
-- 12. Líder registrado excluído (RN-05, RN-06, RN-07; DA-2) — 6
--     Gabriel passa a André; Fábio é excluído (congelado, P-HIE-13 do E2.06); depois André passa a Tiago.
-- ===========================================================================
UPDATE public.members SET leader_id = pg_temp.m(7) WHERE id = pg_temp.m(11);
SET LOCAL session_replication_role = replica;
UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.m(10);
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.opts(15, 'leader'), ARRAY['André (2)', 'Débora (3)', 'Ester', 'Jonas (4)', 'Paula (1)', 'Samuel (0) pastor/M'],
  'RN-05: Fábio excluído não é opção (Ester, sem liderança, sem nível, pelos relatórios da seção 10)');
SELECT is(pg_temp.names(15, 'leader', pg_temp.ids(10)), ARRAY[]::text[], 'RN-07: Fábio excluído: nenhuma linha nos nomes');
SELECT is(pg_temp.cnt(15, format('_leader_ids => %s', pg_temp.ids(10))), '0', 'DA-2: o filtro com Fábio dá zero');
SELECT is(pg_temp.run_as(15, format('SELECT jsonb_build_object(''leader'', split_part(snapshot_leader_name, '' '', 1), ''g12'', split_part(snapshot_g12_leader_name, '' '', 1)) FROM public.cell_reports_list(_cell_id => %L) t WHERE t.id = %L', pg_temp.c(1), pg_temp.r(5))),
  '{"leader": "Fábio", "g12": "Pedro"}'::jsonb, 'RN-05: R5 continua na lista, com Fábio e o G12 Pedro');
UPDATE public.members SET leader_id = pg_temp.m(5) WHERE id = pg_temp.m(7);
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(5))), ARRAY['R6', 'R1', 'R2', 'R4'],
  'RN-06: André passou a Tiago: os relatórios dele (e de Jonas) vão para o G12 novo');
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(3))), ARRAY['R5'],
  'RN-06: o de Fábio excluído fica com o G12 da exclusão (Pedro)');

SELECT * FROM finish();
ROLLBACK;
