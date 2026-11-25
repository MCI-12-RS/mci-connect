-- E2.01 (PR 1): exclusão lógica de células e relatórios, participantes e
-- "nada aponta para um excluído".
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), RN-01,
-- RN-02, RN-06 a RN-09, RN-11 a RN-13, RN-15, RN-17, RN-19, RN-20; DA-1,
-- DA-4, DA-5, DA-7, DA-10, DT-05, DT-15, DT-23, DT-27, DT-28.
--
-- Cobre, pela API (usuário logado com SET ROLE authenticated):
--   - RN-01: célula e relatório guardam data e autor; os relatórios da célula
--     não mudam; o relatório excluído e restaurado volta com os mesmos 8
--     participantes; PATCH/INSERT tentando marcar deleted_at dá 42501;
--   - RN-02/DA-10: fora do escopo, not_found_or_deleted;
--   - RN-06: líder, cônjuge, timóteo, anfitrião, participante novo e célula do
--     relatório excluídos são recusados (também como postgres, DT-27);
--     invariante no fim;
--   - RN-07: PATCH em célula/relatório excluído volta com 0 linhas; excluir de
--     novo dá not_found_or_deleted;
--   - RN-08: Tiago sem vínculo de líder; Ubiratan sem vínculo e em "sem vínculo
--     celular"; DA-1; last_report_date e pendentes sem relatório excluído;
--     link direto e busca de Sara;
--   - RN-09: nome do participante excluído; eventos de Sara na Auditoria;
--   - RN-11: os 10 relatórios de Yara com cell_deleted; somas da semana;
--     contagem por tipo e pendentes; edição e participantes recusados;
--     excluir e restaurar o relatório; relatório novo recusado; visível para
--     o ministério (DT-05);
--   - RN-12: a semana liberada aceita outro relatório e volta a pendente; a
--     semana que já passou continua fechada (REL-02);
--   - RN-13: a edição preserva Sara; retirar Sara pela RPC, por DELETE direto
--     ou como postgres é recusado; incluir excluído novo é recusado; limites
--     da RPC (repetidos, mais de 1000, relatório inexistente ou excluído, sem
--     política de DELETE);
--   - RN-15: listas de células e relatórios excluídos; sem manage_roles, vazias
--     e 42501; not_deleted; not_found (DA-4);
--   - RN-17: pessoa excluída (DA-5); semana ocupada, também numa semana
--     passada; relatório de semana passada restaurado (DT-28); relatório de
--     célula excluída restaurado continua só para consulta;
--   - RN-19: eventos de exclusão e restauração de célula e relatório;
--   - RN-20: auditoria que falha desfaz a exclusão da célula e do relatório.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Datas relativas à semana atual (domingo a sábado, America/Sao_Paulo).
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(148);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2010400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b2010400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
-- Início da semana atual e de semanas passadas.
CREATE FUNCTION pg_temp.ws(_weeks_ago int DEFAULT 0) RETURNS date LANGUAGE sql STABLE AS
$$ SELECT public.week_start(public.sp_today()) - 7 * _weeks_ago $$;
-- Sábado 23:50 da semana atual, em Brasília (para "pendentes").
CREATE FUNCTION pg_temp.sat2350() RETURNS timestamptz LANGUAGE sql STABLE AS
$$ SELECT ((pg_temp.ws() + 6) + time '23:50') AT TIME ZONE 'America/Sao_Paulo' $$;

CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  _state text; _msg text; _detail text; _hint text; _rows bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END,
      true);
    IF _n IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('state', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg, 'hint', nullif(_hint, ''),
      'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ELSE to_jsonb(nullif(_detail, '')) END);
  END;
END $$;
CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text; _msg text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END,
      true);
    IF _n IS NOT NULL THEN EXECUTE 'SET LOCAL ROLE authenticated'; END IF;
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT;
    RETURN 'ERR ' || _state || ': ' || _msg;
  END;
END $$;
CREATE FUNCTION pg_temp.code(_r jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _r ->> 'state' = '22023' AND _r ->> 'hint' = 'app_error'
              THEN _r -> 'detail' ->> 'code' ELSE _r ->> 'state' END
$$;
CREATE FUNCTION pg_temp.cell(_n int) RETURNS public.cells LANGUAGE sql STABLE AS
$$ SELECT * FROM public.cells WHERE id = pg_temp.c(_n) $$;
CREATE FUNCTION pg_temp.rep(_n int) RETURNS public.cell_reports LANGUAGE sql STABLE AS
$$ SELECT * FROM public.cell_reports WHERE id = pg_temp.r(_n) $$;
-- Participantes de um relatório (na tabela, como postgres), ordenados.
CREATE FUNCTION pg_temp.parts(_n int) RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(array_agg(member_id ORDER BY member_id), '{}') FROM public.cell_report_participants WHERE report_id = pg_temp.r(_n) $$;
-- Um número do dashboard_summary, como o usuário _n, no instante _at.
CREATE FUNCTION pg_temp.dash(_n int, _col text, _at timestamptz DEFAULT now()) RETURNS int LANGUAGE sql AS
$$ SELECT pg_temp.val(_n, format('SELECT %I FROM public.dashboard_summary(%L)', _col, _at))::int $$;

-- ---------------------------------------------------------------------------
-- Massa (postgres, triggers ligados; semanas passadas com replica)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password)
SELECT pg_temp.u(n), 'e201-04-' || n || '@teste.invalid', extensions.crypt('Senha#' || n, extensions.gen_salt('bf', 4))
  FROM generate_series(1, 9) n;
-- 1 Elisa (AD), 2 Lucas (LE), 3 Edna (edita relatórios), 4 Mila (ministério de
-- Gina, com dashboard), 5 Yara (líder, lança o próprio relatório), 6 Maria
-- (MB), 9 Lena (LE do ministério de Gina)
INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'E201-04 AD'), (pg_temp.role(2), 'E201-04 LE'), (pg_temp.role(3), 'E201-04 ED'),
  (pg_temp.role(4), 'E201-04 MIN'), (pg_temp.role(5), 'E201-04 LID'), (pg_temp.role(6), 'E201-04 MB'),
  (pg_temp.role(9), 'E201-04 LE ministério');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(2), 'view_all_church'), (pg_temp.role(2), 'create_cell'), (pg_temp.role(2), 'edit_cell'),
  (pg_temp.role(2), 'delete_cell'), (pg_temp.role(2), 'delete_cell_report'),
  (pg_temp.role(3), 'view_all_church'), (pg_temp.role(3), 'edit_cell_report'), (pg_temp.role(3), 'edit_cell'),
  (pg_temp.role(4), 'view_own_ministry'), (pg_temp.role(4), 'view_dashboard'),
  (pg_temp.role(5), 'submit_own_cell_report'), (pg_temp.role(5), 'view_own_reports'), (pg_temp.role(5), 'edit_own_data'),
  (pg_temp.role(6), 'view_all_church'), (pg_temp.role(6), 'view_dashboard'),
  (pg_temp.role(9), 'view_own_ministry'), (pg_temp.role(9), 'delete_cell'), (pg_temp.role(9), 'delete_cell_report');

-- Paulo Pastor → Gina (G12, ministério A) e Dora (G12, ministério B).
-- E2.04 (DT-23): todo cadastro novo tem um identificador real (RN-08).
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192014' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Paulo Pastor E201-04', 'M', true, false, pg_temp.mob(1));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(2),  'Gina Garcia',   'F', pg_temp.m(1), true, NULL,         NULL, pg_temp.mob(2)),
  (pg_temp.m(3),  'Dora Dias',     'F', pg_temp.m(1), true, NULL,         NULL, pg_temp.mob(3)),
  (pg_temp.m(17), 'Elisa Esteves', 'F', pg_temp.m(1), true, pg_temp.u(1), pg_temp.role(1), pg_temp.mob(17)),
  (pg_temp.m(18), 'Lucas Lopes',   'M', pg_temp.m(1), true, pg_temp.u(2), pg_temp.role(2), pg_temp.mob(18)),
  (pg_temp.m(19), 'Edna Ely',      'F', pg_temp.m(1), true, pg_temp.u(3), pg_temp.role(3), pg_temp.mob(19)),
  (pg_temp.m(20), 'Maria Melo',    'F', pg_temp.m(1), true, pg_temp.u(6), pg_temp.role(6), pg_temp.mob(20));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(10), 'Carlos Castro',    'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(10)),
  (pg_temp.m(21), 'Mila Matos',       'F', pg_temp.m(2), true, true, pg_temp.u(4), pg_temp.role(4), pg_temp.mob(21)),
  (pg_temp.m(22), 'Lena Leal',        'F', pg_temp.m(2), true, true, pg_temp.u(9), pg_temp.role(9), pg_temp.mob(22)),
  (pg_temp.m(25), 'Quintino Quadros', 'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(25)),
  (pg_temp.m(26), 'Rui Ramos',        'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(26)),
  (pg_temp.m(27), 'Sara Souza',       'F', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(27)),
  (pg_temp.m(28), 'Ana Abreu',        'F', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(28)),
  (pg_temp.m(29), 'Bruno Brito',      'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(29)),
  (pg_temp.m(30), 'Yara Yamada',      'F', pg_temp.m(2), true, true, pg_temp.u(5), pg_temp.role(5), pg_temp.mob(30)),
  (pg_temp.m(31), 'Tiago Teles',      'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(31)),
  (pg_temp.m(32), 'Ubiratan Urbano',  'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(32)),
  (pg_temp.m(33), 'Zeca Zanin',       'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(33)),
  (pg_temp.m(34), 'Hugo Hart',        'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(34)),
  (pg_temp.m(35), 'Úrsula Uchoa',     'F', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(35)),
  (pg_temp.m(36), 'Lia Lima',         'F', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(36)),
  (pg_temp.m(37), 'Otto Osório',      'M', pg_temp.m(2), true, true, NULL,         NULL, pg_temp.mob(37)),
  (pg_temp.m(40), 'Davi Duarte',      'M', pg_temp.m(3), true, true, NULL,         NULL, pg_temp.mob(40));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp)
SELECT pg_temp.m(50 + n), 'Participante Número ' || n, 'M', pg_temp.m(36), true, pg_temp.mob(50 + n) FROM generate_series(1, 8) n;

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  (pg_temp.c(1), pg_temp.m(10), NULL, pg_temp.m(10), 'Evangelística', 'Quarta',  '20:00', true),
  (pg_temp.c(2), pg_temp.m(26), NULL, pg_temp.m(25), 'Discipulado',   'Terça',   '20:00', true),
  (pg_temp.c(3), pg_temp.m(30), NULL, pg_temp.m(30), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(4), pg_temp.m(31), NULL, pg_temp.m(31), 'Evangelística', 'Sexta',   '20:00', true),
  (pg_temp.c(5), pg_temp.m(33), NULL, pg_temp.m(33), 'Evangelística', 'Domingo', '10:00', true),
  (pg_temp.c(6), pg_temp.m(40), NULL, pg_temp.m(40), 'Evangelística', 'Quinta',  '20:00', true),
  (pg_temp.c(7), pg_temp.m(34), NULL, pg_temp.m(34), 'Discipulado',   'Quinta',  '20:00', true),
  (pg_temp.c(8), pg_temp.m(36), NULL, pg_temp.m(36), 'Evangelística', 'Domingo', '09:00', true);

-- Semana atual (triggers ligados).
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, visitors, offering, was_held) VALUES
  (pg_temp.r(30), pg_temp.c(3), pg_temp.ws(), '20:00', 'Semana de Yara', ARRAY['V1','V2','V3','V4','V5','V6'], 50.00, true),
  (pg_temp.r(50), pg_temp.c(5), pg_temp.ws(), '10:00', 'Semana de Zeca', '{}', 0, true),
  (pg_temp.r(80), pg_temp.c(8), pg_temp.ws(), '09:00', 'Oito participantes', '{}', 0, true);
INSERT INTO public.cell_report_participants (report_id, member_id)
SELECT pg_temp.r(80), pg_temp.m(50 + n) FROM generate_series(1, 8) n;
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (pg_temp.r(30), pg_temp.m(35));

-- Semanas passadas (replica: o trigger de semana atual barraria).
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, deleted_at)
SELECT pg_temp.r(30 + k), pg_temp.c(3), pg_temp.ws(k) + 1, '20:00', 'Yara ' || k, true, NULL
  FROM generate_series(1, 9) k;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, deleted_at) VALUES
  (pg_temp.r(20), pg_temp.c(2), pg_temp.ws(1) + 2, '20:00', 'Rui passado', true, NULL),
  (pg_temp.r(51), pg_temp.c(5), pg_temp.ws(1),     '10:00', 'Zeca semana passada', true, NULL),
  (pg_temp.r(52), pg_temp.c(5), pg_temp.ws(2),     '10:00', 'Zeca há duas semanas', true, NULL),
  (pg_temp.r(60), pg_temp.c(6), pg_temp.ws(1) + 4, '20:00', 'Davi passado', true, NULL),
  (pg_temp.r(71), pg_temp.c(7), pg_temp.ws(1) + 4, '20:00', 'Ubiratan participou', true, NULL),
  (pg_temp.r(72), pg_temp.c(7), pg_temp.ws(2) + 4, '20:00', 'Ana e Sara', true, NULL),
  (pg_temp.r(73), pg_temp.c(7), pg_temp.ws(3) + 4, '20:00', 'Excluído antes', true, now() - interval '20 days'),
  (pg_temp.r(74), pg_temp.c(7), pg_temp.ws(3) + 5, '20:00', 'Lançado depois', true, NULL),
  (pg_temp.r(75), pg_temp.c(7), pg_temp.ws(4) + 4, '20:00', 'Semana livre', true, NULL);
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  (pg_temp.r(71), pg_temp.m(32)),
  (pg_temp.r(72), pg_temp.m(28)), (pg_temp.r(72), pg_temp.m(27));
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- ===========================================================================
-- 1. RN-01 e RN-02: excluir célula e relatório — 14
-- ===========================================================================
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell(%L)', pg_temp.c(1)))), '00000',
  'RN-02: LE exclui a célula de Carlos (quarta, 20:00)');
SELECT is(ARRAY[(pg_temp.cell(1)).deleted_at::text, (pg_temp.cell(1)).deleted_by::text], ARRAY[now()::text, pg_temp.m(18)::text],
  'RN-01: a célula guarda a data e quem excluiu');
SELECT is(pg_temp.val(2, format('SELECT count(*) FROM public.cells_view WHERE id = %L', pg_temp.c(1))), '0',
  'RN-01/RN-08: a célula some da cells_view');
SELECT is(pg_temp.val(2, format('SELECT count(*) FROM public.cells WHERE id = %L', pg_temp.c(1))), '0',
  'RN-08: e da tabela sob RLS');
SELECT is(pg_temp.code(pg_temp.try(9, format('SELECT public.delete_cell(%L)', pg_temp.c(6)))), 'not_found_or_deleted',
  'RN-02/DA-10: LE do ministério não exclui a célula de Davi, de outro ministério');
SELECT is(pg_temp.code(pg_temp.try(9, format('SELECT public.delete_cell_report(%L)', pg_temp.r(60)))), 'not_found_or_deleted',
  'RN-02/DA-10: nem o relatório dela');
SELECT ok((pg_temp.cell(6)).deleted_at IS NULL AND (pg_temp.rep(60)).deleted_at IS NULL, 'RN-02: os dois continuam');

SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell_report(%L)', pg_temp.r(80)))), '00000',
  'RN-01: LE exclui o relatório com 8 participantes');
SELECT is(ARRAY[(pg_temp.rep(80)).deleted_at::text, (pg_temp.rep(80)).deleted_by::text], ARRAY[now()::text, pg_temp.m(18)::text],
  'RN-01: o relatório guarda a data e quem excluiu');
SELECT is(cardinality(pg_temp.parts(80)), 8, 'RN-01: os 8 participantes continuam guardados');
SELECT is(pg_temp.val(1, format('SELECT count(*) FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(80))), '0',
  'RN-12: os participantes do relatório excluído somem da view');
SELECT is(pg_temp.val(1, format('SELECT count(*) FROM public.cell_report_participants WHERE report_id = %L', pg_temp.r(80))), '0',
  'RN-12: e da tabela sob RLS');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(80)))), '00000',
  'RN-01: AD restaura o relatório');
SELECT is(pg_temp.val(1, format('SELECT array_agg(member_id ORDER BY member_id) FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(80))),
  pg_temp.parts(80)::text, 'RN-01: volta com os mesmos 8 participantes');

-- ===========================================================================
-- 2. RN-01 e RN-07: a marcação é só pela RPC; excluído não muda — 12
-- ===========================================================================
SELECT is(pg_temp.try(1, format('UPDATE public.cells SET deleted_at = now() WHERE id = %L', pg_temp.c(7))) ->> 'state', '42501',
  'RN-01: PATCH de AD tentando marcar a célula dá 42501');
SELECT is(pg_temp.try(1, format('UPDATE public.cell_reports SET deleted_at = now() WHERE id = %L', pg_temp.r(75))) ->> 'state', '42501',
  'RN-01: PATCH de AD tentando marcar o relatório dá 42501');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cells (leader_id, type, meeting_day, meeting_time, deleted_at)
                                  VALUES (%L, 'Evangelística', 'Sábado', '20:00', now())$$, pg_temp.m(37))) ->> 'state', '42501',
  'RN-01: INSERT de célula já excluída dá 42501');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held, deleted_at)
                                  VALUES (%L, %L, '20:00', 'x', true, now())$$, pg_temp.c(7), pg_temp.ws())) ->> 'state', '42501',
  'RN-01: INSERT de relatório já excluído dá 42501');
SELECT is(pg_temp.try(1, format($$UPDATE public.cells SET meeting_time = '21:00' WHERE id = %L$$, pg_temp.c(1))) ->> 'rows', '0',
  'RN-07: PATCH numa célula excluída volta com 0 linhas');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(1)))), 'not_found_or_deleted',
  'RN-07: excluir a célula de novo dá not_found_or_deleted');
SELECT is(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(1))) ->> 'message',
  'Esta célula não existe ou já foi excluída.', 'RN-07: texto da célula');
SELECT is((pg_temp.cell(1)).deleted_by, pg_temp.m(18), 'RN-07: o autor continua o da primeira vez');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell_report(%L)', pg_temp.r(73)))), 'not_found_or_deleted',
  'RN-07: excluir de novo um relatório excluído dá not_found_or_deleted');
SELECT is(pg_temp.try(1, format('SELECT public.delete_cell_report(%L)', pg_temp.r(73))) ->> 'message',
  'Este relatório não existe ou já foi excluído.', 'RN-07: texto do relatório');
SELECT is(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Editado' WHERE id = %L$$, pg_temp.r(73))) ->> 'rows', '0',
  'RN-07: PATCH num relatório excluído volta com 0 linhas');
SELECT is((pg_temp.rep(73)).theme, 'Excluído antes', 'RN-07: nada mudou no relatório excluído');

-- ===========================================================================
-- 3. RN-11: relatórios de uma célula excluída — 22
-- ===========================================================================
CREATE TEMP TABLE yara0 AS SELECT
  pg_temp.dash(4, 'reports_sent') AS sent, pg_temp.dash(4, 'visitors') AS visitors,
  pg_temp.val(4, $$SELECT total FROM public.dashboard_cells_by_type() WHERE cell_type = 'Evangelística'$$)::int AS evang,
  pg_temp.dash(4, 'cells_pending', pg_temp.sat2350()) AS pending;
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.cells_view WHERE id = %L', pg_temp.c(4))), '1',
  'RN-11 (antes): a célula de Tiago, sem relatório na semana, é visível para o ministério');

SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(3)))), '00000',
  'RN-11: AD exclui a célula de Yara (10 relatórios, um desta semana com 6 visitantes e R$ 50,00)');
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE cell_id = pg_temp.c(3) AND deleted_at IS NULL), 10,
  'RN-11: excluir a célula não exclui nem altera os relatórios');
SELECT is(pg_temp.val(1, format('SELECT count(*) FILTER (WHERE cell_deleted) || ''/'' || count(*) FROM public.cell_reports_view WHERE cell_id = %L', pg_temp.c(3))),
  '10/10', 'RN-11: os 10 relatórios continuam na lista, com cell_deleted (AQ-4)');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.cell_reports_view WHERE cell_id = %L AND cell_deleted', pg_temp.c(3))),
  '10', 'RN-11/DT-05: continuam visíveis para quem vê pelo ministério (view)');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.cell_reports WHERE cell_id = %L', pg_temp.c(3))),
  '10', 'RN-11/DT-05: e pela tabela sob RLS (paridade)');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(30))),
  '1', 'RN-11: os participantes do relatório da célula excluída continuam visíveis');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.cell_reports_view WHERE cell_id = %L AND search_text LIKE %L',
                               pg_temp.c(3), '%' || public.search_normalize('yara') || '%')),
  '10', 'RN-11: e aparecem na busca (nome do líder)');
SELECT is(pg_temp.dash(4, 'reports_sent'), (SELECT sent FROM yara0),
  'RN-11: os relatórios enviados da semana continuam contando o relatório da célula excluída');
SELECT is(pg_temp.dash(4, 'visitors'), (SELECT visitors FROM yara0), 'RN-11: e os 6 visitantes');
SELECT is(pg_temp.val(4, $$SELECT total FROM public.dashboard_cells_by_type() WHERE cell_type = 'Evangelística'$$)::int,
  (SELECT evang - 1 FROM yara0), 'RN-11: a célula excluída sai da contagem por tipo');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(4)))), '00000',
  'RN-11: AD exclui a célula de Tiago, que estava pendente');
SELECT is(pg_temp.dash(4, 'cells_pending', pg_temp.sat2350()), (SELECT pending - 1 FROM yara0),
  'RN-11: a célula excluída sai das pendentes');

SELECT is(pg_temp.code(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Corrigido' WHERE id = %L$$, pg_temp.r(31)))),
  'report_cell_deleted', 'RN-11: editar o relatório da célula excluída pela API é recusado');
SELECT is(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Corrigido' WHERE id = %L$$, pg_temp.r(31))) ->> 'message',
  'A célula deste relatório foi excluída. Restaure a célula para editar o relatório.', 'RN-11: texto');
SELECT is(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Corrigido' WHERE id = %L$$, pg_temp.r(31))) -> 'detail',
  jsonb_build_object('code', 'report_cell_deleted', 'cell_id', pg_temp.c(3)), 'RN-11: detalhe com cell_id (AQ-2)');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])',
                                            pg_temp.r(30), pg_temp.m(35), pg_temp.m(37)))),
  'report_cell_deleted', 'RN-11/DA-7: incluir participante no relatório da célula excluída é recusado');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[]::uuid[])', pg_temp.r(30)))),
  'report_cell_deleted', 'RN-11/DA-7: retirar também');
SELECT is(pg_temp.code(pg_temp.try(1, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                                              VALUES (%L, %L, '20:00', 'Novo', true)$$, pg_temp.c(3), pg_temp.ws()))),
  'cell_deleted', 'RN-11/RN-06: um relatório novo para a célula excluída é recusado');
SELECT is(pg_temp.code(pg_temp.try(5, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                                              VALUES (%L, %L, '20:00', 'Novo da líder', true)$$, pg_temp.c(3), pg_temp.ws()))),
  'cell_deleted', 'RN-11/RN-06: também pela líder da célula (submit_own_cell_report)');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell_report(%L)', pg_temp.r(31)))), '00000',
  'RN-11: quem tem "Excluir Relatórios" exclui um relatório da célula excluída');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(31)))), '00000',
  'RN-17: o relatório de uma célula excluída também pode ser restaurado');
SELECT is(pg_temp.code(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Corrigido' WHERE id = %L$$, pg_temp.r(31)))),
  'report_cell_deleted', 'RN-17: e continua só para consulta');

-- ===========================================================================
-- 4. RN-12: excluir um relatório libera a semana — 9
-- ===========================================================================
CREATE TEMP TABLE zeca0 AS SELECT pg_temp.dash(4, 'cells_pending', pg_temp.sat2350()) AS pending;
SELECT is(pg_temp.val(1, format('SELECT last_report_date FROM public.cells_view WHERE id = %L', pg_temp.c(5))), pg_temp.ws()::text,
  'RN-12 (antes): o último relatório da célula de Zeca é desta semana');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell_report(%L)', pg_temp.r(50)))), '00000',
  'RN-12: LE exclui o relatório desta semana');
SELECT is(pg_temp.val(1, format('SELECT last_report_date FROM public.cells_view WHERE id = %L', pg_temp.c(5))), pg_temp.ws(1)::text,
  'RN-08/RN-12: last_report_date ignora o relatório excluído');
SELECT is(pg_temp.dash(4, 'cells_pending', pg_temp.sat2350()), (SELECT pending + 1 FROM zeca0),
  'RN-12: a reunião da semana já passou (sábado 23:50), então a célula volta a pendente');
SELECT is(pg_temp.code(pg_temp.try(1, format($$INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
                                              VALUES (%L, %L, %L, '10:00', 'Relatório certo', true)$$, pg_temp.r(53), pg_temp.c(5), pg_temp.ws()))),
  '00000', 'RN-12: a semana liberada aceita outro relatório (índice parcial)');
SELECT is(pg_temp.dash(4, 'cells_pending', pg_temp.sat2350()), (SELECT pending FROM zeca0),
  'RN-12: com o relatório novo, a célula deixa de estar pendente');
SELECT is(pg_temp.code(pg_temp.try(1, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                                              VALUES (%L, %L, '10:00', 'Duplicado', true)$$, pg_temp.c(5), pg_temp.ws()))),
  '23505', 'RN-12/REL-03: um segundo relatório não excluído na mesma semana continua recusado');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell_report(%L)', pg_temp.r(51)))), '00000',
  'RN-12: LE exclui o relatório da semana passada');
SELECT is(pg_temp.code(pg_temp.try(1, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                                              VALUES (%L, %L, '10:00', 'Atrasado', true)$$, pg_temp.c(5), pg_temp.ws(1)))),
  '23514', 'RN-12/REL-02: a semana que já passou continua fechada para relatório novo');

-- ===========================================================================
-- 5. RN-08 e RN-09: vínculo celular, link direto, busca e histórico — 13
-- ===========================================================================
SELECT is(pg_temp.val(1, format('SELECT is_cell_leader FROM public.members_view WHERE id = %L', pg_temp.m(31))), 'false',
  'RN-08: Tiago, cuja única célula foi excluída, deixa de ter vínculo de líder');
SELECT is(pg_temp.val(1, format('SELECT is_cell_host FROM public.members_view WHERE id = %L', pg_temp.m(31))), 'false',
  'RN-08: nem de anfitrião');
SELECT is(pg_temp.val(1, format('SELECT attended_last_30_days FROM public.members_view WHERE id = %L', pg_temp.m(35))), 'true',
  'DA-1: a participação num relatório não excluído de célula excluída continua contando (Úrsula)');
CREATE TEMP TABLE ubi0 AS SELECT pg_temp.dash(4, 'members_without_cell_link') AS n;
SELECT is(pg_temp.val(1, format('SELECT attended_last_30_days FROM public.members_view WHERE id = %L', pg_temp.m(32))), 'true',
  'RN-08 (antes): Ubiratan tem participação nos últimos 30 dias');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.delete_cell_report(%L)', pg_temp.r(71)))), '00000',
  'RN-08: o único relatório de Ubiratan é excluído');
SELECT is(pg_temp.val(1, format('SELECT attended_last_30_days FROM public.members_view WHERE id = %L', pg_temp.m(32))), 'false',
  'RN-08/RN-12: a participação num relatório excluído não conta no vínculo celular');
SELECT is(pg_temp.dash(4, 'members_without_cell_link'), (SELECT n + 1 FROM ubi0),
  'RN-08: Ubiratan aparece em "sem vínculo celular"');

SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(27)))), '00000',
  'RN-09: AD exclui Sara, participante de um relatório de 2 semanas atrás');
SELECT is(pg_temp.val(1, format('SELECT count(*) FROM public.members_view WHERE id = %L', pg_temp.m(27))), '0',
  'RN-08: o link direto para Sara não encontra o cadastro');
SELECT is(pg_temp.val(1, format('SELECT count(*) FROM public.members_view WHERE search_text LIKE %L',
                               '%' || public.search_normalize('Sara Souza') || '%')), '0',
  'RN-08: a busca "Sara Souza" em Membros não a encontra');
SELECT is(pg_temp.val(4, format($$SELECT member_name || '|' || member_deleted FROM public.cell_report_participants_view
                                 WHERE report_id = %L AND member_id = %L$$, pg_temp.r(72), pg_temp.m(27))),
  'Sara Souza|true', 'RN-09 b/RN-13: Sara aparece pelo nome nos participantes, marcada como excluída (AQ-5)');
SELECT is(pg_temp.val(4, format('SELECT participants_count FROM public.cell_reports_view WHERE id = %L', pg_temp.r(72))), '2',
  'RN-13: e conta no número de participantes');
SELECT is(pg_temp.val(1, format($$SELECT string_agg(DISTINCT action::text || ':' || entity_label, ',')
                                 FROM public.events WHERE entity_id = %L$$, pg_temp.m(27))),
  'create:Sara Souza,delete:Sara Souza', 'RN-09 a: a Auditoria mostra os eventos de Sara de antes e de depois, com o nome');

-- ===========================================================================
-- 6. RN-13: participante excluído no histórico — 18
-- ===========================================================================
SELECT is(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Ana, Bruno e Sara' WHERE id = %L$$, pg_temp.r(72))) ->> 'rows',
  '1', 'RN-13: quem tem "Editar Relatórios" muda o tema');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(28), pg_temp.m(29), pg_temp.m(27)))),
  '00000', 'RN-13: e grava Ana, Bruno e Sara (o conjunto final, com a excluída)');
SELECT is(pg_temp.parts(72), (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[pg_temp.m(27), pg_temp.m(28), pg_temp.m(29)]) x),
  'RN-13: o relatório fica com Ana, Bruno e Sara (Sara preservada, sem duplicar)');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(28), pg_temp.m(29)))),
  'deleted_participant_removal', 'RN-13: omitir Sara da lista é recusado');
SELECT is(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])',
                                pg_temp.r(72), pg_temp.m(28), pg_temp.m(29))) -> 'detail',
  jsonb_build_object('code', 'deleted_participant_removal', 'member_id', pg_temp.m(27)), 'RN-13: detalhe com o member_id');
SELECT is(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])',
                                pg_temp.r(72), pg_temp.m(28), pg_temp.m(29))) ->> 'message',
  'Não é possível retirar um participante cujo cadastro foi excluído.', 'RN-13: texto');
SELECT is(cardinality(pg_temp.parts(72)), 3, 'RN-13: e nada muda (Sara continua)');
SELECT is(pg_temp.code(pg_temp.try(3, format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
                                            pg_temp.r(72), pg_temp.m(27)))),
  'deleted_participant_removal', 'RN-13: DELETE direto de Sara pela API é recusado');
SELECT is(pg_temp.code(pg_temp.try(NULL, format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
                                               pg_temp.r(72), pg_temp.m(27)))),
  'deleted_participant_removal', 'RN-13/DT-27: também como postgres (service role)');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(27)))),
  '00000', 'RN-13: retirar os participantes não excluídos, mantendo Sara, é aceito');
SELECT is(pg_temp.parts(72), ARRAY[pg_temp.m(27)], 'RN-13: o relatório fica só com Sara');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L, %L]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(28), pg_temp.m(29), pg_temp.m(27), pg_temp.m(25)))),
  '00000', 'RN-13 (controle): incluir Quintino enquanto ele não está excluído é aceito');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L, %L, %L, NULL]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(28), pg_temp.m(28), pg_temp.m(29), pg_temp.m(27), pg_temp.m(25)))),
  '00000', 'DT-15: ids repetidos e nulos são ignorados');
SELECT is(cardinality(pg_temp.parts(72)), 4, 'DT-15: o conjunto continua com 4 participantes');
SELECT is(pg_temp.code(pg_temp.try(6, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(28), pg_temp.m(29), pg_temp.m(27)))),
  '42501', 'DT-15: sem política de DELETE, retirar um participante dá 42501 (INVOKER, o RLS vale)');
SELECT is(cardinality(pg_temp.parts(72)), 4, 'DT-15: e nada muda');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 1001)))',
                                            pg_temp.r(72)))),
  'too_many_participants', 'DT-15: mais de 1000 participantes é recusado');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', gen_random_uuid(), pg_temp.m(28)))),
  'not_found_or_deleted', 'DT-15: relatório inexistente → not_found_or_deleted');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(73), pg_temp.m(28)))),
  'not_found_or_deleted', 'RN-07: relatório excluído não recebe participantes');

-- ===========================================================================
-- 7. RN-06: nada aponta para um excluído — 16
-- ===========================================================================
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(2)))), '00000',
  'RN-06: AD exclui a célula de Rui (anfitrião Quintino)');
SELECT is(pg_temp.code(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L]::uuid[])',
                                            pg_temp.r(72), pg_temp.m(28), pg_temp.m(29), pg_temp.m(27)))),
  '00000', 'RN-06 (preparação): Quintino sai do relatório antes de ser excluído');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(25)))), '00000',
  'RN-06: AD exclui Quintino (a célula de Rui, excluída, não impede)');

SELECT is(pg_temp.try(1, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(25), pg_temp.m(37))) -> 'detail',
  jsonb_build_object('code', 'deleted_member_chosen', 'field', 'leader_id', 'member_id', pg_temp.m(25)),
  'RN-06: membro com líder excluído → deleted_member_chosen (leader_id)');
SELECT is(pg_temp.try(1, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(25), pg_temp.m(37))) ->> 'message',
  'Este membro foi excluído e não pode ser escolhido.', 'RN-06: texto');
SELECT is(pg_temp.try(1, format('UPDATE public.members SET spouse_id = %L WHERE id = %L', pg_temp.m(25), pg_temp.m(37))) -> 'detail' ->> 'field',
  'spouse_id', 'RN-06: cônjuge excluído → deleted_member_chosen (spouse_id)');
SELECT is(pg_temp.code(pg_temp.try(1, format($$INSERT INTO public.members (name, gender, leader_id) VALUES ('Novo', 'M', %L)$$, pg_temp.m(25)))),
  'deleted_member_chosen', 'RN-06: membro novo com líder excluído é recusado');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cells (leader_id, type, meeting_day, meeting_time)
                                  VALUES (%L, 'Evangelística', 'Sábado', '20:00')$$, pg_temp.m(25))) -> 'detail' ->> 'field',
  'leader_id', 'RN-06: célula nova com líder excluído → leader_id');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cells (leader_id, timothy_id, type, meeting_day, meeting_time)
                                  VALUES (%L, %L, 'Evangelística', 'Sábado', '20:00')$$, pg_temp.m(37), pg_temp.m(25))) -> 'detail' ->> 'field',
  'timothy_id', 'RN-06: célula nova com timóteo excluído → timothy_id');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cells (leader_id, host_id, type, meeting_day, meeting_time)
                                  VALUES (%L, %L, 'Evangelística', 'Sábado', '20:00')$$, pg_temp.m(37), pg_temp.m(25))) -> 'detail' ->> 'field',
  'host_id', 'RN-06: célula nova com anfitrião excluído → host_id');
SELECT is(pg_temp.try(1, format('UPDATE public.cells SET timothy_id = %L WHERE id = %L', pg_temp.m(25), pg_temp.c(7))) -> 'detail' ->> 'field',
  'timothy_id', 'RN-06: trocar o timóteo por um excluído é recusado');
SELECT is(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L, %L]::uuid[])',
                                pg_temp.r(72), pg_temp.m(28), pg_temp.m(29), pg_temp.m(27), pg_temp.m(25))) -> 'detail',
  jsonb_build_object('code', 'deleted_member_chosen', 'field', 'member_id', 'member_id', pg_temp.m(25)),
  'RN-06/RN-13: excluído como participante novo → deleted_member_chosen (member_id)');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                                  VALUES (%L, %L, '20:00', 'Para célula excluída', true)$$, pg_temp.c(2), pg_temp.ws())) -> 'detail',
  jsonb_build_object('code', 'cell_deleted', 'cell_id', pg_temp.c(2)),
  'RN-06: relatório para a célula excluída de Rui → cell_deleted');
SELECT is(pg_temp.try(1, format($$INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                                  VALUES (%L, %L, '20:00', 'x', true)$$, pg_temp.c(2), pg_temp.ws())) ->> 'message',
  'Esta célula foi excluída e não recebe relatórios.', 'RN-06: texto');
SELECT is(pg_temp.code(pg_temp.try(1, format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(2), pg_temp.r(75)))),
  'cell_deleted', 'RN-06: passar um relatório para a célula excluída é recusado');
SELECT is(pg_temp.code(pg_temp.try(NULL, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(25), pg_temp.m(37)))),
  'deleted_member_chosen', 'RN-06/DT-27: vale também como postgres (service role)');

-- ===========================================================================
-- 8. RN-15 e RN-17: listas e restauração de células e relatórios — 30
-- ===========================================================================
SELECT is(pg_temp.val(1, format($$SELECT jsonb_build_object('leader', leader_name, 'leader_deleted', leader_deleted,
                                       'host', host_name, 'host_deleted', host_deleted, 'by', deleted_by_name,
                                       'at', deleted_at = now())
                                 FROM public.cells_deleted_view WHERE id = %L$$, pg_temp.c(2)))::jsonb,
  '{"leader": "Rui Ramos", "leader_deleted": false, "host": "Quintino Quadros", "host_deleted": true,
    "by": "Elisa Esteves", "at": true}'::jsonb,
  'RN-15/AQ-3: a lista de células excluídas mostra quem excluiu, quando, e antecipa o anfitrião excluído');
SELECT is(pg_temp.val(1, format($$SELECT count(*) FROM public.cells_deleted_view WHERE id = %L AND search_text LIKE %L$$,
                               pg_temp.c(2), '%' || public.search_normalize('rui') || '%')), '1',
  'RN-15: a lista de células excluídas tem busca');
SELECT is(pg_temp.val(2, 'SELECT count(*) FROM public.cells_deleted_view'), '0',
  'RN-15: sem Gerenciar Funções, a lista de células excluídas vem vazia');
SELECT is(pg_temp.val(2, 'SELECT count(*) FROM public.cell_reports_deleted_view'), '0',
  'RN-15: e a de relatórios excluídos também');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.restore_cell(%L)', pg_temp.c(2)))), '42501',
  'RN-15: quem só exclui não restaura célula (42501)');
SELECT is(pg_temp.code(pg_temp.try(2, format('SELECT public.restore_cell_report(%L)', pg_temp.r(73)))), '42501',
  'RN-15: nem relatório (42501)');

-- RN-17: célula com pessoa excluída (DA-5).
CREATE TEMP TABLE c2_before AS SELECT to_jsonb(c) AS j FROM public.cells c WHERE id = pg_temp.c(2);
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2))) ->> 'message',
  'Não é possível restaurar a célula: o anfitrião Quintino Quadros foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.',
  'RN-17: a restauração da célula de Rui é recusada porque o anfitrião foi excluído');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2))) -> 'detail',
  jsonb_build_object('code', 'restore_person_deleted', 'people', jsonb_build_array(
    jsonb_build_object('role', 'host', 'member_id', pg_temp.m(25), 'member_name', 'Quintino Quadros'))),
  'RN-17: detalhe com a pessoa');
SELECT is((SELECT to_jsonb(c) FROM public.cells c WHERE id = pg_temp.c(2)), (SELECT j FROM c2_before), 'RN-17: e nada muda');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_member(%L)', pg_temp.m(26)))), '00000',
  'DA-5: Rui, líder da célula excluída, também é excluído');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2))) ->> 'message',
  'Não é possível restaurar a célula: o líder Rui Ramos foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.',
  'DA-5: com mais de uma pessoa excluída, a mensagem cita a primeira (líder, timóteo, anfitrião)');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2))) -> 'detail' -> 'people',
  jsonb_build_array(jsonb_build_object('role', 'leader', 'member_id', pg_temp.m(26), 'member_name', 'Rui Ramos'),
                    jsonb_build_object('role', 'host', 'member_id', pg_temp.m(25), 'member_name', 'Quintino Quadros')),
  'DA-5: os detalhes trazem todas');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(26)))), '00000', 'RN-17: Rui é restaurado');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT * FROM public.restore_member(%L)', pg_temp.m(25)))), '00000', 'RN-17: Quintino é restaurado');
CREATE TEMP TABLE rui0 AS SELECT total_cells FROM private.member_hierarchy WHERE member_id = pg_temp.m(26);
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2)))), '00000',
  'RN-17: com líder, timóteo e anfitrião não excluídos, a célula é restaurada');
SELECT is(pg_temp.val(4, format('SELECT count(*) FROM public.cells_view WHERE id = %L', pg_temp.c(2))), '1',
  'RN-17: ela volta às listas');
SELECT is((SELECT total_cells FROM private.member_hierarchy WHERE member_id = pg_temp.m(26)), (SELECT total_cells + 1 FROM rui0),
  'RN-17/RN-10: e aos totais');
SELECT is(pg_temp.try(3, format($$UPDATE public.cell_reports SET theme = 'Editável de novo' WHERE id = %L$$, pg_temp.r(20))) ->> 'rows',
  '1', 'RN-17: os relatórios dela voltam a poder ser editados');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2)))), 'not_deleted',
  'RN-15: restaurar uma célula que não está excluída é recusado');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell(%L)', pg_temp.c(2))) ->> 'message',
  'Esta célula não está excluída.', 'RN-15: texto da célula');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell(%L)', gen_random_uuid())) ->> 'message',
  'Esta célula não foi encontrada.', 'DA-4: célula inexistente');

-- RN-17: relatórios.
SELECT is(pg_temp.val(1, format('SELECT week_taken FROM public.cell_reports_deleted_view WHERE id = %L', pg_temp.r(73))), 'true',
  'AQ-3: a lista antecipa que a semana do relatório já tem outro (week_taken)');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(73))) -> 'detail',
  jsonb_build_object('code', 'restore_week_taken', 'report_id', pg_temp.r(74), 'week_start', pg_temp.ws(3)),
  'RN-17: numa semana passada ocupada, a restauração é recusada (detalhe com o outro relatório e a semana)');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(73))) ->> 'message',
  'Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.', 'RN-17: texto');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(50)))), 'restore_week_taken',
  'RN-17: o mesmo na semana atual (o relatório de Zeca, depois do relatório novo)');
SELECT is(pg_temp.val(1, format('SELECT week_taken FROM public.cell_reports_deleted_view WHERE id = %L', pg_temp.r(71))), 'false',
  'AQ-3: semana livre, week_taken falso');
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(71)))), '00000',
  'RN-17/DT-28: o relatório de uma semana passada volta, mesmo fora da semana atual');
SELECT is((pg_temp.rep(71)).date, pg_temp.ws(1) + 4, 'DT-28: a data não muda na restauração');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', pg_temp.r(71))) ->> 'message',
  'Este relatório não está excluído.', 'RN-15: restaurar um relatório não excluído é recusado');
SELECT is(pg_temp.try(1, format('SELECT public.restore_cell_report(%L)', gen_random_uuid())) ->> 'message',
  'Este relatório não foi encontrado.', 'DA-4: relatório inexistente');

-- ===========================================================================
-- 9. RN-19 e RN-20: auditoria — 10
-- ===========================================================================
SELECT is((SELECT array_agg(action::text || '|' || actor_user_id || '|' || description ORDER BY action::text)
             FROM public.events WHERE entity = 'cell' AND entity_id = pg_temp.c(2) AND action IN ('delete', 'restore')),
  ARRAY['delete|' || pg_temp.u(1) || '|Excluiu a célula de Rui Ramos', 'restore|' || pg_temp.u(1) || '|Restaurou a célula de Rui Ramos'],
  'RN-19: a Auditoria mostra a exclusão e a restauração da célula de Rui, cada uma com AD');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity = 'cell' AND entity_id = pg_temp.c(2)
            AND action IN ('delete', 'restore') AND occurred_at = now()), 2, 'RN-19: com o horário');
SELECT is((SELECT array_agg(action::text || '|' || (metadata ->> 'op') ORDER BY action::text)
             FROM public.events WHERE entity = 'cell_report' AND entity_id = pg_temp.r(80) AND action IN ('delete', 'restore')),
  ARRAY['delete|soft_delete', 'restore|restore'], 'RN-19: exclusão e restauração do relatório, com metadata.op');
SELECT is((SELECT entity_label FROM public.events WHERE entity = 'cell_report' AND entity_id = pg_temp.r(80) AND action = 'delete'),
  'relatório da célula de Lia Lima em ' || pg_temp.ws(), 'RN-19: com o nome do registro');

ALTER TABLE public.events ADD CONSTRAINT e201_qa_audit_fails CHECK (action <> 'delete') NOT VALID;
SELECT is(pg_temp.try(1, format('SELECT public.delete_cell(%L)', pg_temp.c(7))) ->> 'state', '23514',
  'RN-20: com a auditoria falhando, a exclusão da célula falha');
SELECT is((pg_temp.cell(7)).deleted_at, NULL, 'RN-20: a célula não fica excluída');
SELECT is(pg_temp.try(1, format('SELECT public.delete_cell_report(%L)', pg_temp.r(75))) ->> 'state', '23514',
  'RN-20: a exclusão do relatório também falha');
SELECT is((pg_temp.rep(75)).deleted_at, NULL, 'RN-20: o relatório não fica excluído');
ALTER TABLE public.events DROP CONSTRAINT e201_qa_audit_fails;
SELECT is(pg_temp.code(pg_temp.try(1, format('SELECT public.delete_cell_report(%L)', pg_temp.r(75)))), '00000',
  'RN-20: com a auditoria de volta, a exclusão passa');

-- Membro com líder excluído no legado: editar outro campo é aceito (só o que muda é conferido).
SET LOCAL session_replication_role = replica;
UPDATE public.members SET leader_id = pg_temp.m(27) WHERE id = pg_temp.m(37);
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();
SELECT is(pg_temp.try(1, format($$UPDATE public.members SET notes = 'Dado do legado' WHERE id = %L$$, pg_temp.m(37))) ->> 'rows',
  '1', 'RN-06: um cadastro do legado com líder excluído pode ter outros campos editados (só o que muda é conferido)');

-- ===========================================================================
-- 10. RN-06: invariante depois de toda a sequência (sem o dado do legado) — 2
-- ===========================================================================
UPDATE public.members SET leader_id = pg_temp.m(2) WHERE id = pg_temp.m(37);
SELECT is_empty($$
  SELECT m.id FROM public.members m
    JOIN public.members x ON x.id IN (m.leader_id, m.spouse_id)
   WHERE m.deleted_at IS NULL AND x.deleted_at IS NOT NULL$$,
  'RN-06: nenhum membro não excluído tem líder ou cônjuge excluído');
SELECT is_empty($$
  SELECT c.id FROM public.cells c
    JOIN public.members x ON x.id IN (c.leader_id, c.timothy_id, c.host_id)
   WHERE c.deleted_at IS NULL AND x.deleted_at IS NOT NULL$$,
  'RN-06: nenhuma célula não excluída tem líder, timóteo ou anfitrião excluído');

SELECT * FROM finish();
ROLLBACK;
