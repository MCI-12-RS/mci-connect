-- E2.09 (PR 1): a situação do relatório com a massa dos critérios (migration 2, e209_02_report_situation).
-- Spec: docs/specs/e2-09-situacao-relatorio.md (repositório apps-mci), "A leitura (migration 2)", "Privilégios",
-- "Verificações obrigatórias (para o QA)" (e209_03); RN-01 a RN-09; DA-7, DA-8; DT-06, DT-07, DT-09, DT-10.
--
-- Cobre:
--   - cells_report_situation(_at) para Rita na quinta, 26/11, às 10:00 (RN-04) e para Pedro na terça, 24/11,
--     às 10:00 (RN-09): os valores; Pedro não recebe C2, C4, C5 nem C8; Caio vê C1 igual a Pedro;
--   - RN-01: Pedro inativa C1 e ela sai do card de Rita; C8 excluída não aparece para ninguém;
--   - RN-03: o relatório da semana tira a célula do card; excluído não conta; restaurado volta a contar;
--   - RN-06: C10 cadastrada na quinta não conta no card;
--   - RN-08: o card de Rita (células da massa) e de Pedro na quinta às 10:00 (3 e 2), às 21:00 (4 e 3) e no
--     sábado às 00:30 (5 e 4); a célula de segunda 20:00 não conta às 20:59 e conta às 21:00; sem
--     "Visualizar Dashboard", 42501;
--   - paridade: por persona, cells_view (id, report_status, report_missing_weeks) = cells_report_situation(now()),
--     e dashboard_summary(_at).cells_pending = "Pendente" de cells_report_situation(_at) em vários momentos;
--   - fuso: os mesmos resultados com a sessão em UTC e em Asia/Tokyo; 02:59:59 e 03:00 UTC de domingo;
--   - DT-06: o EXPLAIN sem as colunas novas não chama cell_report_situation; com report_status, chama;
--   - privilégios, o enum, as colunas da cells_view, sp_now() e sp_today() com o mesmo resultado de antes.
-- Desde o E2.02 (RN-04), quem vê a célula vê os relatórios dela: o caso "relatório da semana que Pedro não
-- vê" (RN-03) não ocorre mais; a leitura conta pela tabela, sem escopo (definer), coberta pela paridade.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK. Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(62);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2090300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2090300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2090300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2090300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192093' || lpad(_n::text, 4, '0') $$;
-- Momento em hora de Brasília.
CREATE FUNCTION pg_temp.br(_local text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$ SELECT (_local || '-03')::timestamptz $$;

-- Valor (texto) de _sql como o membro _n; erro vira 'ERR <SQLSTATE>'.
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
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN 'ERR ' || _state;
  END;
END $$;

-- Situação das células da massa vistas pelo membro _n no momento _at: 'C1=pending/0;C3=...'.
CREATE FUNCTION pg_temp.sit(_n int, _at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, format($q$
    SELECT coalesce(string_agg('C' || ltrim(right(s.cell_id::text, 12), '0') || '=' ||
                               coalesce(s.report_status::text, '-') || '/' || coalesce(s.report_missing_weeks::text, '-'),
                               ';' ORDER BY right(s.cell_id::text, 12)), '')
      FROM public.cells_report_situation(%L) s WHERE s.cell_id::text LIKE 'd2090300%%'$q$, _at)) $$;
-- "Pendente" entre as células da massa, e o card inteiro.
CREATE FUNCTION pg_temp.mine_pending(_n int, _at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, format($q$SELECT count(*) FROM public.cells_report_situation(%L) s
                                    WHERE s.cell_id::text LIKE 'd2090300%%' AND s.report_status = 'pending'$q$, _at)) $$;
CREATE FUNCTION pg_temp.card(_n int, _at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, format('SELECT cells_pending FROM public.dashboard_summary(%L)', _at)) $$;
-- Card menos as pendentes fora da massa (para personas que veem a igreja toda num banco com dados).
CREATE FUNCTION pg_temp.card_mine(_n int, _at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, format($q$SELECT (SELECT cells_pending FROM public.dashboard_summary(%1$L))
                                         - (SELECT count(*) FROM public.cells_report_situation(%1$L) s
                                             WHERE s.cell_id::text NOT LIKE 'd2090300%%' AND s.report_status = 'pending')$q$, _at)) $$;
-- Paridade da view com a função (vazio = iguais) e do card com a função.
CREATE FUNCTION pg_temp.view_mismatch(_n int) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, $q$
    SELECT count(*) FROM (
      (SELECT id, report_status, report_missing_weeks FROM public.cells_view
       EXCEPT SELECT cell_id, report_status, report_missing_weeks FROM public.cells_report_situation(now()))
      UNION ALL
      (SELECT cell_id, report_status, report_missing_weeks FROM public.cells_report_situation(now())
       EXCEPT SELECT id, report_status, report_missing_weeks FROM public.cells_view)) d $q$) $$;
CREATE FUNCTION pg_temp.card_mismatch(_n int, _at timestamptz) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, format($q$SELECT (SELECT cells_pending FROM public.dashboard_summary(%1$L))
                                         - (SELECT count(*) FROM public.cells_report_situation(%1$L) s
                                             WHERE s.report_status = 'pending')$q$, _at)) $$;
CREATE FUNCTION pg_temp.plan_text(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _l text; _out text := '';
BEGIN
  FOR _l IN EXECUTE 'EXPLAIN (VERBOSE, COSTS OFF) ' || _sql LOOP _out := _out || _l || E'\n'; END LOOP;
  RETURN _out;
END $$;

-- ---------------------------------------------------------------------------
-- Massa (a dos critérios do spec)
--   1 Samuel e 2 Magda: pastores (casal)        3 Pedro (Líder), de Samuel, casado com 4 Paula, de Magda
--   5 André (Líder), de Pedro                    6 Caio (Membro), de André; timóteo de C1
--   7 Carla (Membro), de Paula; anfitriã de C1   8 Fábio, de André, inativo
--   9 Ester, sem liderança                       10 Diego (Líder), de 11 Tiago, de Samuel (outro ministério)
--   12 Rita (Administrador), de Magda            13 Hugo, de Pedro, função sem "Visualizar Dashboard"
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) SELECT pg_temp.u(n), 'e2093-' || n || '@teste.invalid' FROM generate_series(1, 13) n;
INSERT INTO public.roles (id, name) VALUES ('b2090300-0000-0000-0000-000000000001', 'E209 Sem Dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES ('b2090300-0000-0000-0000-000000000001', 'view_own_ministry');

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1),  'Samuel Situacao', 'M', true,  NULL, false, pg_temp.u(1), pg_temp.role('Líder'),  true, pg_temp.mob(1)),
  (pg_temp.m(2),  'Magda Situacao',  'F', true,  NULL, false, pg_temp.u(2), pg_temp.role('Líder'),  true, pg_temp.mob(2)),
  (pg_temp.m(9),  'Ester Situacao',  'F', false, NULL, false, pg_temp.u(9), pg_temp.role('Membro'), true, pg_temp.mob(9));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(3),  'Pedro Situacao',  'M', false, pg_temp.m(1), true, pg_temp.u(3),  pg_temp.role('Líder'),         true, pg_temp.mob(3)),
  (pg_temp.m(4),  'Paula Situacao',  'F', false, pg_temp.m(2), true, pg_temp.u(4),  pg_temp.role('Líder'),         true, pg_temp.mob(4)),
  (pg_temp.m(11), 'Tiago Situacao',  'M', false, pg_temp.m(1), true, pg_temp.u(11), pg_temp.role('Líder'),         true, pg_temp.mob(11)),
  (pg_temp.m(12), 'Rita Situacao',   'F', false, pg_temp.m(2), true, pg_temp.u(12), pg_temp.role('Administrador'), true, pg_temp.mob(12));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(5),  'Andre Situacao',  'M', false, pg_temp.m(3),  true, pg_temp.u(5),  pg_temp.role('Líder'),  true, pg_temp.mob(5)),
  (pg_temp.m(7),  'Carla Situacao',  'F', false, pg_temp.m(4),  true, pg_temp.u(7),  pg_temp.role('Membro'), true, pg_temp.mob(7)),
  (pg_temp.m(10), 'Diego Situacao',  'M', false, pg_temp.m(11), true, pg_temp.u(10), pg_temp.role('Líder'),  true, pg_temp.mob(10)),
  (pg_temp.m(13), 'Hugo Situacao',   'M', false, pg_temp.m(3),  true, pg_temp.u(13), 'b2090300-0000-0000-0000-000000000001', true, pg_temp.mob(13));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(6),  'Caio Situacao',   'M', false, pg_temp.m(5), true, pg_temp.u(6), pg_temp.role('Membro'), true,  pg_temp.mob(6)),
  (pg_temp.m(8),  'Fabio Situacao',  'M', false, pg_temp.m(5), true, pg_temp.u(8), pg_temp.role('Membro'), true,  pg_temp.mob(8));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1),  pg_temp.m(5),  pg_temp.m(6),  pg_temp.m(7),  'Evangelística', 'Quarta',  '20:00'),
  (pg_temp.c(2),  pg_temp.m(10), pg_temp.m(11), pg_temp.m(10), 'Evangelística', 'Quarta',  '20:00'),
  (pg_temp.c(3),  pg_temp.m(8),  pg_temp.m(6),  pg_temp.m(6),  'Evangelística', 'Sexta',   '23:30'),
  (pg_temp.c(4),  pg_temp.m(9),  pg_temp.m(9),  pg_temp.m(9),  'Evangelística', 'Sábado',  '23:30'),
  (pg_temp.c(5),  pg_temp.m(1),  pg_temp.m(1),  pg_temp.m(2),  'Discipulado',   'Segunda', '19:30'),
  (pg_temp.c(6),  pg_temp.m(4),  pg_temp.m(7),  pg_temp.m(7),  'Discipulado',   'Quinta',  '20:00'),
  (pg_temp.c(7),  pg_temp.m(5),  pg_temp.m(6),  pg_temp.m(5),  'Evangelística', 'Terça',   '20:00'),
  (pg_temp.c(8),  pg_temp.m(5),  pg_temp.m(6),  pg_temp.m(5),  'Evangelística', 'Quarta',  '19:00'),
  (pg_temp.c(9),  pg_temp.m(3),  pg_temp.m(3),  pg_temp.m(3),  'Macrocélula',   'Quarta',  '19:30'),
  (pg_temp.c(10), pg_temp.m(5),  pg_temp.m(6),  pg_temp.m(5),  'Evangelística', 'Quarta',  '20:00');
-- Fábio inativo depois de liderar C3 (o líder pode ser inativo, RN-01); C7 inativa.
UPDATE public.members SET is_active = false WHERE id = pg_temp.m(8);
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(7);

-- Relatórios (replica: datas fora da semana atual) e C8 excluída em 10/11, quando ativa.
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, reason_not_held) VALUES
  (pg_temp.r(1),  pg_temp.c(1), '2026-11-18', '20:00', 'C1 s1', true, NULL),
  (pg_temp.r(2),  pg_temp.c(1), '2026-11-11', '20:00', 'C1 s2', true, NULL),
  (pg_temp.r(3),  pg_temp.c(1), '2026-11-04', '20:00', 'C1 s3', true, NULL),
  (pg_temp.r(4),  pg_temp.c(1), '2026-10-28', '20:00', 'C1 s4', true, NULL),
  (pg_temp.r(5),  pg_temp.c(1), '2026-10-21', '20:00', 'C1 s5', true, NULL),
  (pg_temp.r(6),  pg_temp.c(2), '2026-11-18', '20:00', 'C2', true, NULL),
  (pg_temp.r(7),  pg_temp.c(3), '2026-11-20', '23:30', 'C3', true, NULL),
  (pg_temp.r(8),  pg_temp.c(4), '2026-11-21', '23:30', 'C4', true, NULL),
  (pg_temp.r(9),  pg_temp.c(5), '2026-11-23', '19:30', NULL, false, 'Chuva'),
  (pg_temp.r(10), pg_temp.c(7), '2026-08-25', '20:00', 'C7', true, NULL),
  (pg_temp.r(11), pg_temp.c(8), '2026-11-04', '19:00', 'C8', true, NULL),
  (pg_temp.r(12), pg_temp.c(9), '2026-11-04', '19:30', 'C9', true, NULL);
UPDATE public.cells SET deleted_at = '2026-11-10 10:00-03', deleted_by = pg_temp.m(12) WHERE id = pg_temp.c(8);
SET LOCAL session_replication_role = origin;

-- O histórico da massa (RN-06): as células existem desde antes de 01/10, salvo indicação.
UPDATE private.cell_active_periods SET periods = '{(,)}'
 WHERE cell_id IN (pg_temp.c(1), pg_temp.c(2), pg_temp.c(3), pg_temp.c(4), pg_temp.c(5), pg_temp.c(9));
UPDATE private.cell_active_periods SET periods = tstzmultirange(tstzrange(pg_temp.br('2026-11-01 10:00'), NULL)) WHERE cell_id = pg_temp.c(6);
UPDATE private.cell_active_periods SET periods = tstzmultirange(tstzrange(NULL, pg_temp.br('2026-09-01 00:00'))) WHERE cell_id = pg_temp.c(7);
UPDATE private.cell_active_periods SET periods = tstzmultirange(tstzrange(NULL, pg_temp.br('2026-11-10 10:00'))) WHERE cell_id = pg_temp.c(8);
UPDATE private.cell_active_periods SET periods = tstzmultirange(tstzrange(pg_temp.br('2026-11-26 10:00'), NULL)) WHERE cell_id = pg_temp.c(10);

-- ===========================================================================
-- 1. RN-04, RN-09: os valores por persona — 6
-- ===========================================================================
SELECT is(pg_temp.sit(12, pg_temp.br('2026-11-26 10:00')),
  'C1=pending/0;C2=pending/0;C3=not_yet/0;C4=not_yet/0;C5=sent_not_held/0;C6=not_yet/3;C7=-/-;C9=pending/2;C10=next_week/0',
  'RN-04: Rita na quinta, 26/11, às 10:00 (C7 inativa sem situação; C8 excluída fora; C10 conta a partir da próxima semana)');
SELECT is(pg_temp.sit(3, pg_temp.br('2026-11-24 10:00')),
  'C1=not_yet/0;C3=not_yet/0;C6=not_yet/3;C7=-/-;C9=not_yet/2;C10=not_yet/0',
  'RN-09: Pedro na terça, 24/11, às 10:00; não recebe C2, C4, C5 nem C8');
SELECT is(pg_temp.val(6, format($q$SELECT report_status || '/' || report_missing_weeks FROM public.cells_report_situation(%L)
                                    WHERE cell_id = %L$q$, pg_temp.br('2026-11-24 10:00'), pg_temp.c(1))),
  'not_yet/0', 'RN-09: Caio (timóteo, Membro) vê C1 igual a Pedro, sem permissão nova');
SELECT is(pg_temp.val(3, 'SELECT report_status::text FROM public.cells_view WHERE id = ''' || pg_temp.c(9) || ''''),
  (SELECT s.report_status::text FROM private.cell_report_situation(pg_temp.c(9), true, 'Quarta', '19:30', now()) s),
  'DT-07: Pedro (authenticated, sem USAGE em private) lê cells_view.report_status');
SELECT is(pg_temp.val(12, format('SELECT count(*) FROM public.cells_view WHERE id = %L', pg_temp.c(8))), '0',
  'RN-01: C8, excluída, não aparece na lista de ninguém');
SELECT is(pg_temp.sit(12, pg_temp.br('2026-11-28 00:30')),
  'C1=pending/0;C2=pending/0;C3=pending/0;C4=not_yet/0;C5=sent_not_held/0;C6=pending/3;C7=-/-;C9=pending/2;C10=next_week/0',
  'RN-01: sábado 00:30: C3 (líder inativo) Pendente, C4 (líder sem liderança) Ainda não ocorreu, C5 (pastor) Enviado');

-- ===========================================================================
-- 2. RN-08: o card — 11
-- ===========================================================================
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-26 10:00')), '3', 'RN-08: card de Rita na quinta às 10:00 = 3 (C1, C2, C9)');
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-26 10:00')), '2', 'RN-08: card de Pedro na quinta às 10:00 = 2 (C1, C9)');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-26 21:00')), '4', 'RN-08: card de Rita na quinta às 21:00 = 4 (entra C6)');
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-26 21:00')), '3', 'RN-08: card de Pedro na quinta às 21:00 = 3');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-28 00:30')), '5', 'RN-08: card de Rita no sábado às 00:30 = 5 (entra C3; C4 não)');
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-28 00:30')), '4', 'RN-08: card de Pedro no sábado às 00:30 = 4');
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-29 00:00')), '0', 'RN-02: domingo 00:00: o card de Pedro zera');
SELECT is(pg_temp.val(3, format($q$SELECT report_status FROM public.cells_report_situation(%L) WHERE cell_id = %L$q$,
                                 pg_temp.br('2026-12-03 10:00'), pg_temp.c(10))),
  'pending', 'RN-06: C10 fica "Pendente" na quinta, 03/12, às 10:00');
SELECT is(pg_temp.val(13, format('SELECT cells_pending FROM public.dashboard_summary(%L)', pg_temp.br('2026-11-26 10:00'))),
  'ERR 42501', 'RN-08: sem "Visualizar Dashboard", 42501 (RN-09 do E1.08)');
SELECT is(pg_temp.val(13, format($q$SELECT count(*) FROM public.cells_report_situation(%L) WHERE cell_id = %L$q$,
                                  pg_temp.br('2026-11-26 10:00'), pg_temp.c(1))),
  '1', 'DA-8: sem permissão nova, quem vê a célula recebe a situação dela (Hugo, sem dashboard)');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-24 10:00')), '0', 'RN-08: terça às 10:00, nenhuma célula da massa pendente para Rita');

-- Célula de segunda 20:00: não conta às 20:59 e conta às 21:00 — 2
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(11), pg_temp.m(5), pg_temp.m(6), pg_temp.m(5), 'Evangelística', 'Segunda', '20:00');
UPDATE private.cell_active_periods SET periods = '{(,)}' WHERE cell_id = pg_temp.c(11);
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-23 20:59')), '0', 'RN-08: segunda 20:59: a célula de segunda 20:00 não conta');
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-23 21:00')), '1', 'RN-08: segunda 21:00: conta (substitui o critério do E1.08)');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(11);

-- ===========================================================================
-- 3. RN-01 e RN-03: inativar e o relatório da semana — 10
-- ===========================================================================
SELECT is(pg_temp.val(3, format('UPDATE public.cells SET is_active = false WHERE id = %L RETURNING 1', pg_temp.c(1))), '1',
  'RN-01: Pedro inativa C1');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-26 10:00')), '2', 'RN-01: C1 inativa sai do card de Rita (3 → 2)');
SELECT is(pg_temp.val(3, format('UPDATE public.cells SET is_active = true WHERE id = %L RETURNING 1', pg_temp.c(1))), '1',
  'Pedro reativa C1 na mesma transação');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-26 10:00')), '3',
  'RN-06: inativar e reativar sem passar um prazo não muda nada (3 de novo)');

SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
  (pg_temp.r(20), pg_temp.c(1), '2026-11-25', '20:00', 'C1 desta semana', true);
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.sit(12, pg_temp.br('2026-11-26 10:30')),
  'C1=sent_held/0;C2=pending/0;C3=not_yet/0;C4=not_yet/0;C5=sent_not_held/0;C6=not_yet/3;C7=-/-;C9=pending/2;C10=next_week/0;C11=-/-',
  'RN-03: o relatório de C1 com a data de 25/11 deixa C1 "Enviado · Célula realizada"');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-28 10:00')), '4', 'RN-03: sábado às 10:00, com o relatório de C1: 4 (C2, C3, C6, C9)');
SELECT is(pg_temp.val(12, format('SELECT ''ok'' FROM public.delete_cell_report(%L)', pg_temp.r(20))), 'ok',
  'RN-03: Rita exclui o relatório da semana de C1');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-28 10:00')), '5', 'RN-03: o relatório excluído não conta: C1 volta ao card (5)');
SELECT is(pg_temp.val(12, format('SELECT ''ok'' FROM public.restore_cell_report(%L)', pg_temp.r(20))), 'ok',
  'RN-03: Rita restaura o relatório');
SELECT is(pg_temp.card_mine(12, pg_temp.br('2026-11-28 10:00')), '4', 'RN-03: restaurado, volta a contar e C1 sai do card (4)');

-- ===========================================================================
-- 4. Paridade (DT-09, DT-10) — 15
-- ===========================================================================
SELECT is(pg_temp.view_mismatch(12), '0', 'paridade: Rita, cells_view = cells_report_situation(now())');
SELECT is(pg_temp.view_mismatch(3),  '0', 'paridade: Pedro, cells_view = cells_report_situation(now())');
SELECT is(pg_temp.view_mismatch(6),  '0', 'paridade: Caio, cells_view = cells_report_situation(now())');
SELECT is(pg_temp.view_mismatch(10), '0', 'paridade: Diego, cells_view = cells_report_situation(now())');
SELECT is(pg_temp.view_mismatch(9),  '0', 'paridade: Ester, cells_view = cells_report_situation(now())');
SELECT is(pg_temp.card_mismatch(12, pg_temp.br('2026-11-24 10:00')), '0', 'paridade: card de Rita na terça às 10:00');
SELECT is(pg_temp.card_mismatch(12, pg_temp.br('2026-11-26 10:00')), '0', 'paridade: card de Rita na quinta às 10:00');
SELECT is(pg_temp.card_mismatch(12, pg_temp.br('2026-11-26 21:00')), '0', 'paridade: card de Rita na quinta às 21:00');
SELECT is(pg_temp.card_mismatch(12, pg_temp.br('2026-11-28 00:30')), '0', 'paridade: card de Rita no sábado às 00:30');
SELECT is(pg_temp.card_mismatch(12, now()), '0', 'paridade: card de Rita agora');
SELECT is(pg_temp.card_mismatch(3, pg_temp.br('2026-11-26 10:00')), '0', 'paridade: card de Pedro na quinta às 10:00');
SELECT is(pg_temp.card_mismatch(3, pg_temp.br('2026-11-28 00:30')), '0', 'paridade: card de Pedro no sábado às 00:30');
SELECT is(pg_temp.card_mismatch(3, now()), '0', 'paridade: card de Pedro agora');
SELECT is(pg_temp.card_mismatch(6, pg_temp.br('2026-11-26 21:00')), '0', 'paridade: card de Caio na quinta às 21:00');
SELECT is(pg_temp.val(12, 'SELECT cells_pending FROM public.dashboard_summary(NULL)'),
          pg_temp.val(12, 'SELECT count(*) FROM public.cells_report_situation(NULL) WHERE report_status = ''pending'''),
  'paridade: _at nulo vale como agora nas duas');

-- ===========================================================================
-- 5. Fuso (RN-02, DT-08) — 6
-- ===========================================================================
CREATE TEMP TABLE tz_base AS
SELECT pg_temp.sit(12, pg_temp.br('2026-11-26 10:00')) AS v, pg_temp.card(3, pg_temp.br('2026-11-26 21:00')) AS card;
SET LOCAL timezone = 'UTC';
SELECT is(pg_temp.sit(12, pg_temp.br('2026-11-26 10:00')), (SELECT v FROM tz_base), 'fuso: sessão em UTC, mesma situação');
SELECT is(pg_temp.val(12, format($q$SELECT report_status || '/' || report_missing_weeks FROM public.cells_report_situation('2026-11-29 02:59:59+00')
                                     WHERE cell_id = %L$q$, pg_temp.c(2))),
  'pending/0', 'RN-02: 02:59:59 UTC de domingo (sábado 23:59:59 em Brasília): C2 Pendente');
SELECT is(pg_temp.val(3, format($q$SELECT report_status || '/' || report_missing_weeks FROM public.cells_report_situation('2026-11-29 03:00:00+00')
                                    WHERE cell_id = %L$q$, pg_temp.c(9))),
  'not_yet/3', 'RN-02: 03:00 UTC de domingo (domingo 00:00 em Brasília): C9 "Ainda não ocorreu" com 3 semanas');
SELECT is(pg_temp.card(3, '2026-11-29 03:00:00+00'), '0', 'RN-02: 03:00 UTC de domingo: o card de Pedro mostra 0');
SET LOCAL timezone = 'Asia/Tokyo';
SELECT is(pg_temp.sit(12, pg_temp.br('2026-11-26 10:00')), (SELECT v FROM tz_base), 'fuso: sessão em Asia/Tokyo, mesma situação');
SELECT is(pg_temp.card(3, pg_temp.br('2026-11-26 21:00')), (SELECT card FROM tz_base), 'fuso: sessão em Asia/Tokyo, mesmo card de Pedro');
RESET timezone;

-- ===========================================================================
-- 6. DT-06: as colunas só são calculadas quando pedidas — 3
-- ===========================================================================
SELECT unalike(pg_temp.plan_text(format('SELECT 1 FROM public.cells_view WHERE id = %L', pg_temp.c(1))),
  '%cell_report_situation%', 'DT-06: SELECT 1 ... WHERE id = … não chama cell_report_situation');
SELECT unalike(pg_temp.plan_text('SELECT count(*) FROM public.cells_view'),
  '%cell_report_situation%', 'DT-06: count(*) sem filtro não chama cell_report_situation');
SELECT alike(pg_temp.plan_text('SELECT report_status FROM public.cells_view'),
  '%cell_report_situation%', 'DT-06: pedir report_status chama cell_report_situation');

-- ===========================================================================
-- 7. Privilégios, enum, colunas, sp_now e sp_today — 9
-- ===========================================================================
SELECT is((SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_function_privilege(r, 'private.cell_report_situation(uuid, boolean, text, time, timestamptz)', 'EXECUTE')),
  ARRAY['authenticated', 'service_role'], 'private.cell_report_situation: EXECUTE para authenticated e service_role, sem anon');
SELECT ok((SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
            WHERE oid = 'private.cell_report_situation(uuid, boolean, text, time, timestamptz)'::regprocedure),
  'private.cell_report_situation: security definer com search_path vazio');
SELECT is((SELECT array_agg(r || ':' || f ORDER BY r, f)
             FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                  unnest(ARRAY['public.cells_report_situation(timestamptz)', 'public.sp_local(timestamptz)',
                               'public.sp_instant(timestamp)']) f
            WHERE has_function_privilege(r, f, 'EXECUTE')),
  ARRAY['authenticated:public.cells_report_situation(timestamptz)', 'authenticated:public.sp_instant(timestamp)',
        'authenticated:public.sp_local(timestamptz)', 'service_role:public.cells_report_situation(timestamptz)',
        'service_role:public.sp_instant(timestamp)', 'service_role:public.sp_local(timestamptz)'],
  'cells_report_situation, sp_local e sp_instant: EXECUTE para authenticated e service_role, sem anon');
SELECT is((SELECT array_agg(r || ':' || f ORDER BY r, f)
             FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                  unnest(ARRAY['private.report_deadline(date, integer, time)',
                               'private.report_week_counts(date, integer, time, tstzmultirange)',
                               'private.report_situation_rule(timestamp, boolean, integer, time, date[], boolean, tstzmultirange)']) f
            WHERE has_function_privilege(r, f, 'EXECUTE')),
  NULL, 'a regra pura sem EXECUTE para os papéis da API');
SELECT is(enum_range(NULL::public.cell_report_status)::text[],
  ARRAY['sent_held', 'sent_not_held', 'not_yet', 'pending', 'next_week', 'no_meeting_day'],
  'DT-05: o enum com os seis valores, na ordem da RN-04');
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
            WHERE attrelid = 'public.cells_view'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['id','leader_id','timothy_id','host_id','type','meeting_day','meeting_time','street','number','complement',
        'neighborhood','city','state','zip_code','is_active','created_at','updated_at','meeting_weekday','leader_name',
        'leader_gender','leader_g12_level','timothy_name','host_name','g12_leader_id','g12_leader_name',
        'last_report_date','search_text','can_submit_report','is_mine','leader_is_pastor',
        'report_status','report_missing_weeks'],
  'cells_view: as colunas de antes, na mesma ordem, e as duas novas no fim');
SELECT is((SELECT reloptions FROM pg_class WHERE oid = 'public.cells_view'::regclass),
  ARRAY['security_barrier=true', 'security_invoker=false'], 'cells_view: continua security definer com security_barrier');
SET LOCAL timezone = 'Asia/Tokyo';
SELECT is(ARRAY[public.sp_now()::text, public.sp_today()::text],
  ARRAY[(now() AT TIME ZONE 'America/Sao_Paulo')::text, (now() AT TIME ZONE 'America/Sao_Paulo')::date::text],
  'DT-08: sp_now() e sp_today() com o mesmo resultado de antes (sessão em Asia/Tokyo)');
SET LOCAL timezone = 'UTC';
SELECT is(ARRAY[public.sp_local('2026-11-29 03:00+00')::text, public.sp_instant('2026-11-28 23:59:59')::text],
  ARRAY['2026-11-29 00:00:00', '2026-11-29 02:59:59+00'], 'DT-08: sp_local e sp_instant convertem por America/Sao_Paulo');
RESET timezone;

SELECT * FROM finish();
ROLLBACK;
