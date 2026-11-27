-- E2.11 (PR 1): retrato do relatório e visibilidade pelo retrato.
-- Spec: docs/specs/e2-11-lancamento-relatorio.md (repositório apps-mci), "Retrato (migration 1)",
-- "Integridade garantida pelo banco", "Visibilidade pelo retrato (migration 1)", "Verificações
-- obrigatórias (para o QA)", PR 1; RN-14, RN-16, RN-21; DT-01, DT-02.
--
-- Cobre:
--   - estrutura: as quatro colunas NOT NULL, as FKs sem cascata, o CHECK do tipo, os três índices
--     parciais, o trigger definer (ENABLE ALWAYS) sem EXECUTE para a API, a ordem dos BEFORE, as
--     colunas novas das views no fim, viewer_sees_report_people e a saída de cell_in_viewer_ministry;
--   - RN-14: o INSERT ignora o retrato enviado; o UPDATE do retrato não muda nada; a troca de célula dá
--     report_cell_immutable; em replica, o retrato do legado fica e o que falta vem da célula;
--   - visibilidade por persona, antes e depois de trocar as pessoas das células (Pedro, Carla só com
--     "Enviar Relatório das Próprias Células", Fábio depois da troca de anfitriã, Hugo sem função,
--     Lucas, Júlia só com view_all_reports, Rita Administradora); paridade view × tabela (RLS) ×
--     viewer_sees_report_people para todas; a cell_reports_deleted_view; os participantes;
--   - colunas novas: nomes do retrato (o excluído pelo nome), G12, nível e pastor, search_text pelo
--     líder registrado, is_snapshot_person, member_is_active e member_gender só para quem é visível;
--   - política de UPDATE e viewer_can_insert_cell_report_participant pelo retrato;
--   - invariantes: nenhum relatório sem retrato; nenhuma célula com dois relatórios na mesma semana.
-- O preenchimento dos relatórios existentes (RN-21), a reexecução e a guarda da migration ficam em
-- supabase/tests/concurrency/e211_migrations.sh (precisam rodar o arquivo da migration).
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db
BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(67);

-- ---------------------------------------------------------------------------
-- Ids fictícios e helpers (os mesmos do e202_01)
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2110000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2110000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2110000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2110000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192111' || lpad(_n::text, 4, '0') $$;

-- Executa _sql como o usuário n; devolve o código (22023 + app_error → code do DETAIL) e as linhas.
CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _state text; _detail text; _hint text; _rows bigint;
BEGIN
  BEGIN
    IF _n IS NOT NULL THEN
      PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    IF _n IS NOT NULL THEN
      EXECUTE 'RESET ROLE';
      PERFORM set_config('request.jwt.claims', '', true);
    END IF;
    RETURN jsonb_build_object('code', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                                           THEN _detail::jsonb ->> 'code' ELSE _state END,
                              'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb END);
  END;
END $$;
CREATE FUNCTION pg_temp.code(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.try(_n, _sql) ->> 'code' $$;
CREATE FUNCTION pg_temp.rows(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN j ->> 'code' = '00000' THEN j ->> 'rows' ELSE j ->> 'code' END FROM pg_temp.try(_n, _sql) j $$;
CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
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
CREATE FUNCTION pg_temp.ids(_n int, _sql text) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE _out uuid[];
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT coalesce(array_agg(x ORDER BY x), ''{}''::uuid[]) FROM (' || _sql || ') q(x)' INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;

CREATE TEMP TABLE lbl (ord int PRIMARY KEY, id uuid UNIQUE, label text);
INSERT INTO lbl VALUES
  (101, pg_temp.c(1), 'C1'), (102, pg_temp.c(2), 'C2'), (103, pg_temp.c(3), 'C3'), (104, pg_temp.c(4), 'C4'),
  (105, pg_temp.c(5), 'C5'),
  (201, pg_temp.r(1), 'R1'), (202, pg_temp.r(2), 'R2'), (203, pg_temp.r(3), 'R3'), (204, pg_temp.r(4), 'R4'),
  (205, pg_temp.r(5), 'R5'), (206, pg_temp.r(6), 'R6'), (207, pg_temp.r(7), 'R7'), (208, pg_temp.r(8), 'R8');
CREATE FUNCTION pg_temp.lab(_ids uuid[]) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN _ids IS NULL THEN 'ERRO' ELSE coalesce(
     (SELECT string_agg(l.label, ',' ORDER BY l.ord) FROM pg_temp.lbl l WHERE l.id = ANY (_ids)), '-') END $$;

CREATE FUNCTION pg_temp.mkrole(_name text, _perms text[]) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.roles (id, name) VALUES (_id, _name);
  INSERT INTO public.role_permissions (role_id, permission)
    SELECT _id, p::public.permission_action FROM unnest(_perms) p;
  RETURN _id;
END $$;

-- ---------------------------------------------------------------------------
-- Massa: 16 pessoas, 5 células, relatórios da semana passada.
--   Samuel e Magda (pastores, casal) → Pedro (G12) e Paula (casal) → André e Beatriz (casal);
--   André → Caio, Fábio (inativo) e Bruno (excluído depois); Paula → Carla e Beatriz;
--   Samuel → Lucas (G12) → Diego e Hugo; Magda → Júlia e Rita; Ester sem liderança.
-- ---------------------------------------------------------------------------
SELECT pg_temp.mkrole('T211 próprias', ARRAY['submit_own_cell_report']);
SELECT pg_temp.mkrole('T211 rel igreja', ARRAY['view_all_reports']);
SELECT pg_temp.mkrole('T211 igreja', ARRAY['view_all_church']);
SELECT pg_temp.mkrole('T211 excluídos', ARRAY['view_own_ministry', 'manage_roles']);

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e211-' || n || '@teste.invalid' FROM generate_series(1, 16) n;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
 (pg_temp.m(1), 'Samuel Retrato', 'M', true,  NULL,          false, pg_temp.u(1),  pg_temp.role('T211 igreja'), true, pg_temp.mob(1)),
 (pg_temp.m(2), 'Magda Retrato',  'F', true,  NULL,          false, pg_temp.u(2),  pg_temp.role('Líder'), true, pg_temp.mob(2)),
 (pg_temp.m(3), 'Pedro Retrato',  'M', false, pg_temp.m(1),  true,  pg_temp.u(3),  pg_temp.role('Líder'), true, pg_temp.mob(3)),
 (pg_temp.m(4), 'Paula Retrato',  'F', false, pg_temp.m(2),  true,  pg_temp.u(4),  pg_temp.role('Líder'), true, pg_temp.mob(4)),
 (pg_temp.m(5), 'André Retrato',  'M', false, pg_temp.m(3),  true,  pg_temp.u(5),  pg_temp.role('Líder'), true, pg_temp.mob(5)),
 (pg_temp.m(6), 'Beatriz Retrato','F', false, pg_temp.m(4),  true,  pg_temp.u(6),  pg_temp.role('Membro'), true, pg_temp.mob(6)),
 (pg_temp.m(7), 'Caio Retrato',   'M', false, pg_temp.m(5),  true,  pg_temp.u(7),  pg_temp.role('Membro'), true, pg_temp.mob(7)),
 (pg_temp.m(8), 'Carla Retrato',  'F', false, pg_temp.m(4),  true,  pg_temp.u(8),  pg_temp.role('T211 próprias'), true, pg_temp.mob(8)),
 (pg_temp.m(9), 'Lucas Retrato',  'M', false, pg_temp.m(1),  true,  pg_temp.u(9),  pg_temp.role('Membro'), true, pg_temp.mob(9)),
 (pg_temp.m(10),'Júlia Retrato',  'F', false, pg_temp.m(2),  true,  pg_temp.u(10), pg_temp.role('T211 rel igreja'), true, pg_temp.mob(10)),
 (pg_temp.m(11),'Fábio Retrato',  'M', false, pg_temp.m(5),  true,  pg_temp.u(11), pg_temp.role('T211 próprias'), false, pg_temp.mob(11)),
 (pg_temp.m(12),'Ester Retrato',  'F', false, NULL,          false, pg_temp.u(12), pg_temp.role('Membro'), true, pg_temp.mob(12)),
 (pg_temp.m(13),'Diego Retrato',  'M', false, pg_temp.m(9),  true,  pg_temp.u(13), pg_temp.role('Líder'), true, pg_temp.mob(13)),
 (pg_temp.m(14),'Hugo Retrato',   'M', false, pg_temp.m(9),  true,  pg_temp.u(14), NULL, true, pg_temp.mob(14)),
 (pg_temp.m(15),'Rita Retrato',   'F', false, pg_temp.m(2),  true,  pg_temp.u(15), pg_temp.role('Administrador'), true, pg_temp.mob(15)),
 (pg_temp.m(16),'Bruno Retrato',  'M', false, pg_temp.m(5),  true,  NULL,          NULL, true, pg_temp.mob(16));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
 (pg_temp.c(1), pg_temp.m(5),  pg_temp.m(7),  pg_temp.m(8),  'Evangelística', 'Domingo', '00:00'),
 (pg_temp.c(2), pg_temp.m(13), pg_temp.m(14), pg_temp.m(11), 'Discipulado',   'Domingo', '08:00'),
 (pg_temp.c(3), pg_temp.m(9),  pg_temp.m(13), pg_temp.m(14), 'Evangelística', 'Domingo', '08:00'),
 (pg_temp.c(4), pg_temp.m(1),  pg_temp.m(2),  pg_temp.m(3),  'Macrocélula',   'Domingo', '08:00'),
 (pg_temp.c(5), pg_temp.m(5),  pg_temp.m(16), pg_temp.m(6),  'Evangelística', 'Domingo', '08:00');

-- Semana passada (em replica: o trigger de semana atual não roda; o do retrato completa pela célula).
-- R6: excluído (C1, duas semanas atrás). R7: com o retrato do legado (Lucas, Diego e Hugo, Macrocélula).
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, deleted_at) VALUES
 (pg_temp.r(1), pg_temp.c(1), public.week_start(public.sp_today()) - 6, '20:00', true, 'Tema um', NULL),
 (pg_temp.r(2), pg_temp.c(2), public.week_start(public.sp_today()) - 6, '20:00', true, 'Tema dois', NULL),
 (pg_temp.r(3), pg_temp.c(3), public.week_start(public.sp_today()) - 6, '20:00', true, 'Tema três', NULL),
 (pg_temp.r(4), pg_temp.c(4), public.week_start(public.sp_today()) - 6, '20:00', true, 'Tema quatro', NULL),
 (pg_temp.r(5), pg_temp.c(5), public.week_start(public.sp_today()) - 6, '20:00', true, 'Tema cinco', NULL),
 (pg_temp.r(6), pg_temp.c(1), public.week_start(public.sp_today()) - 13, '20:00', true, 'Tema seis', now());
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme,
                                 snapshot_leader_id, snapshot_timothy_id, snapshot_host_id, snapshot_cell_type) VALUES
 (pg_temp.r(7), pg_temp.c(3), public.week_start(public.sp_today()) - 13, '20:00', true, 'Tema sete',
  pg_temp.m(9), pg_temp.m(13), pg_temp.m(14), 'Macrocélula');
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
 (pg_temp.r(1), pg_temp.m(5)), (pg_temp.r(1), pg_temp.m(7)), (pg_temp.r(1), pg_temp.m(9));
-- E2.11 PR 2: a oferta não tem mais padrão e é obrigatória na edição da célula realizada (RN-13).
UPDATE public.cell_reports SET offering = 0 WHERE id::text LIKE 'e2110000%';
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- Universo para as funções de linha (lido como authenticated).
CREATE TEMP TABLE universe AS
SELECT id, deleted_at IS NOT NULL AS deleted, snapshot_leader_id AS l, snapshot_timothy_id AS t, snapshot_host_id AS h
  FROM public.cell_reports WHERE id::text LIKE 'e2110000%';
GRANT SELECT ON universe TO authenticated;

-- ===========================================================================
-- 1. Estrutura (14)
-- ===========================================================================
SELECT col_not_null('public', 'cell_reports', c, 'DT-01: cell_reports.' || c || ' é NOT NULL')
  FROM unnest(ARRAY['snapshot_leader_id', 'snapshot_timothy_id', 'snapshot_host_id', 'snapshot_cell_type']) c;
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conrelid = 'public.cell_reports'::regclass AND contype = 'f'
              AND conname IN ('cell_reports_snapshot_leader_id_fkey', 'cell_reports_snapshot_timothy_id_fkey',
                              'cell_reports_snapshot_host_id_fkey')
              AND confrelid = 'public.members'::regclass AND confdeltype = 'a' AND confupdtype = 'a'), 3,
  'DT-01: as três FKs do retrato para members, sem cascata (NO ACTION)');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'cell_reports_snapshot_cell_type_check'),
  'CHECK ((snapshot_cell_type = ANY (cell_types())))', 'RN-14: o tipo do retrato é um de cell_types()');
SELECT is((SELECT count(*)::int FROM pg_index i JOIN pg_class x ON x.oid = i.indexrelid
            WHERE i.indrelid = 'public.cell_reports'::regclass
              AND x.relname IN ('cell_reports_snapshot_leader_idx', 'cell_reports_snapshot_timothy_idx', 'cell_reports_snapshot_host_idx')
              AND pg_get_expr(i.indpred, i.indrelid) = '(deleted_at IS NULL)'), 3,
  'os três índices parciais do retrato (WHERE deleted_at IS NULL)');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.cell_report_snapshot()'::regprocedure)
          AND NOT has_function_privilege('authenticated', 'public.cell_report_snapshot()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.cell_report_snapshot()', 'EXECUTE'),
  'DT-02: cell_report_snapshot é definer com search_path e sem EXECUTE para authenticated e anon');
SELECT is((SELECT tgenabled::text FROM pg_trigger WHERE tgrelid = 'public.cell_reports'::regclass AND tgname = 'ad_cell_report_snapshot'),
  'A', 'DT-02: ad_cell_report_snapshot é ENABLE ALWAYS (dispara também em replica, só para completar)');
SELECT is((SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
            WHERE tgrelid = 'public.cell_reports'::regclass AND NOT tgisinternal AND (tgtype & 2) = 2),
  ARRAY['a0_guard_cell_report_write', 'aa_enforce_cell_report_rules', 'ac_enforce_cell_report_active',
        'ad_cell_report_snapshot', 'zz_stamp_authorship'],
  'ordem dos BEFORE (E2.11 PR 2): a0_ (guarda) < aa_ < ac_ < ad_ (retrato) < zz_ (carimbo)');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.viewer_sees_report_people(uuid,uuid,uuid)'::regprocedure)
          AND has_function_privilege('authenticated', 'public.viewer_sees_report_people(uuid,uuid,uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.viewer_sees_report_people(uuid,uuid,uuid)', 'EXECUTE'),
  'viewer_sees_report_people: definer com search_path, EXECUTE para authenticated e não para anon');
SELECT is(to_regprocedure('public.cell_in_viewer_ministry(uuid)'), NULL, 'cell_in_viewer_ministry saiu (sem uso)');
SELECT ok(to_regprocedure('public.viewer_is_cell_person(uuid)') IS NOT NULL
          AND (SELECT prosrc ~ 'viewer_is_cell_person' FROM pg_proc WHERE oid = 'public.can_submit_report(uuid)'::regprocedure),
  'viewer_is_cell_person fica (a can_submit_report, sobre a célula, ainda a usa)');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cell_reports'
            AND policyname IN ('Cell reports view policy', 'Cell reports update policy')
            AND coalesce(qual, '') ~ 'viewer_sees_report_people\(snapshot_leader_id, snapshot_timothy_id, snapshot_host_id\)'
            AND coalesce(qual, '') !~ 'viewer_is_cell_person'), 1,
  'política de SELECT de cell_reports pelo retrato (a de UPDATE saiu no PR 2: só as RPCs gravam)');
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
            WHERE attrelid = 'public.cell_reports_view'::regclass AND attnum > 33 AND NOT attisdropped),
  ARRAY['snapshot_leader_id', 'snapshot_timothy_id', 'snapshot_host_id', 'snapshot_leader_name', 'snapshot_timothy_name',
        'snapshot_host_name', 'snapshot_cell_type', 'snapshot_leader_g12_level', 'snapshot_leader_is_pastor',
        'snapshot_g12_leader_id', 'snapshot_g12_leader_name'],
  'cell_reports_view: as onze colunas do retrato no fim, depois das 33 antigas');

-- ===========================================================================
-- 2. RN-14 e RN-16: o retrato vem da célula e não muda (9)
-- ===========================================================================
SELECT is((SELECT ARRAY[snapshot_leader_id, snapshot_timothy_id, snapshot_host_id]::text || snapshot_cell_type
             FROM public.cell_reports WHERE id = pg_temp.r(7)),
  ARRAY[pg_temp.m(9), pg_temp.m(13), pg_temp.m(14)]::text || 'Macrocélula',
  'RN-14 (carga em replica): o retrato do legado fica como veio');
SELECT is((SELECT ARRAY[snapshot_leader_id, snapshot_timothy_id, snapshot_host_id]::text || snapshot_cell_type
             FROM public.cell_reports WHERE id = pg_temp.r(1)),
  ARRAY[pg_temp.m(5), pg_temp.m(7), pg_temp.m(8)]::text || 'Evangelística',
  'RN-21 (carga em replica sem retrato): completado com as pessoas e o tipo atuais da célula');

-- Lançamento pela API (André, Líder, lança C1 nesta semana, pela submit_cell_report do PR 2) mandando
-- outro retrato: ignorado.
SELECT is(pg_temp.code(5, format($q$SELECT * FROM public.submit_cell_report(%L, jsonb_build_object(
    'cell_id', %L::uuid, 'date', public.week_start(public.sp_today()), 'time', '00:00', 'theme', 'Nesta semana',
    'offering', 0, 'snapshot_leader_id', %L::uuid, 'snapshot_timothy_id', %L::uuid, 'snapshot_host_id', %L::uuid,
    'snapshot_cell_type', 'Macrocélula'))$q$,
  pg_temp.r(8), pg_temp.c(1), pg_temp.m(9), pg_temp.m(9), pg_temp.m(9))), '00000', 'RN-14: André lança C1 pela API');
SELECT is((SELECT ARRAY[snapshot_leader_id, snapshot_timothy_id, snapshot_host_id]::text || snapshot_cell_type
             FROM public.cell_reports WHERE id = pg_temp.r(8)),
  ARRAY[pg_temp.m(5), pg_temp.m(7), pg_temp.m(8)]::text || 'Evangelística',
  'RN-14: o INSERT ignora o retrato enviado (Lucas e Macrocélula) e grava André, Caio, Carla e Evangelística');
-- UPDATE do retrato (Rita, Administradora, e postgres): nada muda.
SELECT is(pg_temp.rows(15, format($q$UPDATE public.cell_reports SET snapshot_leader_id = %L, snapshot_cell_type = 'Discipulado'
  WHERE id = %L$q$, pg_temp.m(9), pg_temp.r(1))), '42501', 'RN-14: o UPDATE direto do retrato pela API é recusado (42501, PR 2)…');
UPDATE public.cell_reports SET snapshot_host_id = pg_temp.m(14) WHERE id = pg_temp.r(1);
SELECT is((SELECT ARRAY[snapshot_leader_id, snapshot_timothy_id, snapshot_host_id]::text || snapshot_cell_type
             FROM public.cell_reports WHERE id = pg_temp.r(1)),
  ARRAY[pg_temp.m(5), pg_temp.m(7), pg_temp.m(8)]::text || 'Evangelística',
  'RN-14: …mas o retrato não muda (nem pela API, nem como postgres)');
SELECT is(pg_temp.code(15, format($q$SELECT * FROM public.save_cell_report(%L, jsonb_build_object('cell_id', %L::uuid))$q$,
                                   pg_temp.r(1), pg_temp.c(5))),
  'report_cell_immutable', 'RN-16: a troca de célula pela API (save_cell_report) dá report_cell_immutable');
SELECT is(pg_temp.code(NULL, format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(5), pg_temp.r(1))),
  'report_cell_immutable', 'RN-16: e também como postgres');
-- Em replica, a carga pode corrigir o retrato.
SET LOCAL session_replication_role = replica;
UPDATE public.cell_reports SET snapshot_cell_type = 'Discipulado' WHERE id = pg_temp.r(7);
SET LOCAL session_replication_role = origin;
SELECT is((SELECT snapshot_cell_type FROM public.cell_reports WHERE id = pg_temp.r(7)), 'Discipulado',
  'DT-02: em replica o UPDATE do retrato passa (correção da carga)');

-- ===========================================================================
-- 3. Visibilidade antes da troca de pessoas (8)
-- ===========================================================================
SELECT is(pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_view')), 'R1,R2,R4,R5,R8',
  'Pedro (ministério): R1, R5 e R8 (André), R2 (Fábio, anfitrião) e R4 (ele, anfitrião); não R3 nem R7');
SELECT is(pg_temp.lab(pg_temp.ids(8, 'SELECT id FROM public.cell_reports_view')), 'R1,R8',
  'Carla (só "Enviar Relatório das Próprias Células"): só os relatórios em que está registrada');
SELECT is(pg_temp.lab(pg_temp.ids(14, 'SELECT id FROM public.cell_reports_view')), 'R2,R3,R7',
  'Hugo (sem função): os relatórios em que está registrado (RN-14 d)');
SELECT is(pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.cell_reports_view')), 'R2,R3,R7',
  'Lucas (ministério de Lucas): R2, R3 e R7; não R1, onde é só participante');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cell_reports_view')), 'R2',
  'Fábio (inativo, só as próprias): R2, onde é anfitrião');
SELECT is(pg_temp.lab(pg_temp.ids(10, 'SELECT id FROM public.cell_reports_view')), 'R1,R2,R3,R4,R5,R7,R8',
  'Júlia (só view_all_reports): todos os não excluídos');
SELECT is(pg_temp.lab(pg_temp.ids(12, 'SELECT id FROM public.cell_reports_view')), '-',
  'Ester (sem liderança, ministério só dela): nenhum');
SELECT is(pg_temp.lab(pg_temp.ids(1, 'SELECT id FROM public.cell_reports_view')), 'R1,R2,R3,R4,R5,R7,R8',
  'Samuel (view_all_church): todos os não excluídos');

-- ===========================================================================
-- 4. Troca das pessoas das células: o relatório fica com quem estava registrado (12)
-- ===========================================================================
-- Rita troca as pessoas de C1 por Diego, Hugo e Lucas; C2 passa a ter Júlia como anfitriã; C5 troca o
-- timóteo Bruno por Caio, e Bruno é excluído.
SELECT is(pg_temp.code(15, format('UPDATE public.cells SET leader_id = %L, timothy_id = %L, host_id = %L WHERE id = %L',
  pg_temp.m(13), pg_temp.m(14), pg_temp.m(9), pg_temp.c(1))), '00000', 'Rita troca as pessoas de C1 por Diego, Hugo e Lucas');
SELECT is(pg_temp.code(15, format('UPDATE public.cells SET host_id = %L WHERE id = %L', pg_temp.m(10), pg_temp.c(2))),
  '00000', 'Rita troca a anfitriã de C2 (Fábio → Júlia)');
SELECT is(pg_temp.code(15, format('UPDATE public.cells SET timothy_id = %L WHERE id = %L', pg_temp.m(7), pg_temp.c(5))),
  '00000', 'Rita troca o timóteo de C5 (Bruno → Caio)');
SELECT is(pg_temp.code(15, format('SELECT public.delete_member(%L)', pg_temp.m(16))), '00000', 'Rita exclui Bruno');

SELECT is(pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_view')), 'R1,R2,R4,R5,R8',
  'RN-14: Pedro continua vendo R1 e R8 (André, Caio e Carla registrados) e R2 (Fábio registrado)');
SELECT is(pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cells_view')), 'C4,C5',
  'RN-14: …mas C1 e C2 saíram das células de Pedro');
SELECT is(pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.cell_reports_view')), 'R2,R3,R7',
  'RN-14: Lucas, agora anfitrião de C1, não passa a ver R1 nem R8 (registrados André, Caio e Carla)');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cell_reports_view')), 'R2',
  'RN-14: Fábio continua vendo R2 depois da troca de anfitriã');
SELECT is(pg_temp.lab(pg_temp.ids(8, 'SELECT id FROM public.cell_reports_view')), 'R1,R8',
  'RN-14: Carla continua vendo R1 e R8');
SELECT is(pg_temp.rows(3, format($q$SELECT * FROM public.save_cell_report(%L, '{"theme": "Pedro edita"}')$q$, pg_temp.r(1))), '1',
  'edição pelo retrato (save_cell_report, PR 2): Pedro (Editar Relatórios) edita R1 depois da troca');
SELECT is(pg_temp.val(3, format('SELECT count(*)::text FROM public.cell_report_edit_context(%L)', pg_temp.r(1))), '1',
  'cell_report_edit_context pelo retrato (PR 2): Pedro em R1, sim');
SELECT is(pg_temp.val(9, format('SELECT count(*)::text FROM public.cell_report_edit_context(%L)', pg_temp.r(1))), '0',
  'cell_report_edit_context pelo retrato (PR 2): Lucas em R1, não');

-- ===========================================================================
-- 5. Paridade view × tabela (RLS) × viewer_sees_report_people, por persona (11)
-- ===========================================================================
CREATE FUNCTION pg_temp.parity(_n int) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _a uuid[]; _b uuid[]; _c uuid[];
BEGIN
  _a := pg_temp.ids(_n, $q$SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e2110000%'$q$);
  _b := pg_temp.ids(_n, $q$SELECT id FROM public.cell_reports WHERE id::text LIKE 'e2110000%'$q$);
  _c := pg_temp.ids(_n, $q$SELECT u.id FROM pg_temp.universe u WHERE NOT u.deleted AND public.viewer_sees_report_people(u.l, u.t, u.h)$q$);
  IF _a IS NULL OR _a IS DISTINCT FROM _b OR _a IS DISTINCT FROM _c THEN
    RETURN 'view ' || pg_temp.lab(_a) || ' | tabela ' || pg_temp.lab(_b) || ' | função ' || pg_temp.lab(_c);
  END IF;
  RETURN 'ok';
END $$;
INSERT INTO universe SELECT id, false, snapshot_leader_id, snapshot_timothy_id, snapshot_host_id
  FROM public.cell_reports WHERE id = pg_temp.r(8);
SELECT is(pg_temp.parity(n), 'ok', 'paridade view = tabela = viewer_sees_report_people: usuário ' || n)
  FROM unnest(ARRAY[1, 2, 3, 5, 7, 8, 9, 10, 11, 12, 14]) n;

-- ===========================================================================
-- 6. Excluídos e participantes (4)
-- ===========================================================================
UPDATE public.members SET role_id = pg_temp.role('T211 excluídos') WHERE id = pg_temp.m(3);
SELECT is(pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_deleted_view')), 'R6',
  'cell_reports_deleted_view pelo retrato: Pedro (ministério + Gerenciar Funções) vê R6 de C1 depois da troca');
SELECT is(pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.cell_reports_deleted_view')), '-',
  'cell_reports_deleted_view: Lucas (sem Gerenciar Funções) não vê');
UPDATE public.members SET role_id = pg_temp.role('Líder') WHERE id = pg_temp.m(3);
SELECT is(pg_temp.val(3, format($q$SELECT string_agg(concat_ws(':', split_part(member_name, ' ', 1), is_snapshot_person,
    coalesce(member_is_active::text, '-'), coalesce(member_gender, '-')), ',' ORDER BY member_name)
  FROM public.cell_report_participants_view WHERE report_id = %L$q$, pg_temp.r(1))),
  'André:t:true:M,Caio:t:true:M,Lucas:f:-:-',
  'participantes de R1 para Pedro: is_snapshot_person; situação e sexo só de quem ele vê (Lucas não)');
SELECT is(pg_temp.val(9, format('SELECT count(*)::text FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(1))),
  '0', 'participantes acompanham o relatório: Lucas não vê R1, nem os participantes');

-- ===========================================================================
-- 7. Colunas novas da cell_reports_view (6)
-- ===========================================================================
SELECT is(pg_temp.val(15, format($q$SELECT concat_ws('|', snapshot_leader_name, snapshot_timothy_name, snapshot_host_name,
    snapshot_cell_type, snapshot_leader_g12_level, snapshot_leader_is_pastor, snapshot_g12_leader_name, cell_leader_name)
  FROM public.cell_reports_view WHERE id = %L$q$, pg_temp.r(1))),
  'André Retrato|Caio Retrato|Carla Retrato|Evangelística|2|f|Pedro Retrato|Diego Retrato',
  'R1: nomes e tipo do retrato, nível 2, G12 Pedro; cell_leader_name continua o atual (Diego)');
SELECT is(pg_temp.val(15, format($q$SELECT concat_ws('|', snapshot_leader_g12_level, snapshot_leader_is_pastor,
    coalesce(snapshot_g12_leader_id::text, '-'), coalesce(snapshot_g12_leader_name, '-'))
  FROM public.cell_reports_view WHERE id = %L$q$, pg_temp.r(4))), '0|t|-|-',
  'R4 (C4 de Samuel): nível 0, pastor e sem G12');
SELECT is(pg_temp.val(15, format('SELECT snapshot_timothy_name FROM public.cell_reports_view WHERE id = %L', pg_temp.r(5))),
  'Bruno Retrato', 'R5: o timóteo registrado excluído aparece pelo nome (RN-09 c do E2.01)');
SELECT is(pg_temp.lab(pg_temp.ids(15, $q$SELECT id FROM public.cell_reports_view
    WHERE search_text LIKE '%' || public.search_normalize('André') || '%'$q$)), 'R1,R5,R8',
  'RN-14 d: a busca por "André" acha R1 e R8 depois da troca (líder registrado), e R5');
SELECT is(pg_temp.lab(pg_temp.ids(15, $q$SELECT id FROM public.cell_reports_view
    WHERE search_text LIKE '%' || public.search_normalize('Diego') || '%'$q$)), 'R2',
  'RN-14 d: a busca por "Diego" (líder atual de C1) não acha R1 nem R8');
SELECT is(pg_temp.val(15, format('SELECT snapshot_g12_leader_name FROM public.cell_reports_view WHERE id = %L', pg_temp.r(3))),
  'Lucas Retrato', 'R3: o G12 do líder registrado (Lucas é o próprio G12)');

-- ===========================================================================
-- 8. Invariantes (2)
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.cell_reports
            WHERE snapshot_leader_id IS NULL OR snapshot_timothy_id IS NULL OR snapshot_host_id IS NULL
               OR snapshot_cell_type IS NULL), 0, 'invariante: nenhum relatório sem retrato');
SELECT is((SELECT count(*)::int FROM (SELECT cell_id, public.week_start(date) FROM public.cell_reports
            WHERE deleted_at IS NULL GROUP BY 1, 2 HAVING count(*) > 1) d), 0,
  'invariante: nenhuma célula com dois relatórios não excluídos na mesma semana');

SELECT * FROM finish();
ROLLBACK;
