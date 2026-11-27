-- E2.10 (PR 1): o detalhe da célula (cells_view por id e cell_recent_reports), o filtro Célula de
-- Relatórios (cell_identity e cell_reports_view por cell_id) e a estrutura das funções do passo.
-- Spec: docs/specs/e2-10-listagem-celulas.md ("Massa de exemplo", "Critérios por regra",
-- "Verificações obrigatórias (para o QA)"; RN-14, RN-17 a RN-20; DA-1, DA-4, DA-9, DA-10).
-- Massa (dados fictícios): a do Negócio, como no e210_01_list, com os relatórios R1 a R10 em datas fixas
-- (gravados em replica, com o retrato preenchido pelo trigger do E2.11).
-- Os cenários que mudam dados rodam num bloco desfeito (pg_temp.scn) e devolvem o que leram.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(40);

-- ---------------------------------------------------------------------------
-- Massa
-- 1 Samuel, 2 Magda (pastores, casados); 3 Pedro (de Samuel) e 4 Paula (de Magda), casados;
-- 5 Tiago (de Samuel) e 6 Tânia (de Magda), casados; 7 André (de Pedro) e 8 Beatriz (de Tânia), casados;
-- 9 Caio e 10 Fábio (inativo), de André; 11 Gabriel, de Fábio; 12 Jonas, de Gabriel; 13 Carla, de Paula;
-- 14 Débora, de Beatriz; 15 Rita, de Tânia; 16 Diego e 17 Hugo, de Tiago; 18 Ester (sem liderança);
-- 19 Lúcia e 20 Lia, de Ester; 21 Sara (de Pedro, excluída).
-- Funções: Rita Administrador; Samuel, Magda, Pedro, Paula, André e Diego Líder; Caio, Carla, Fábio,
-- Beatriz, Ester e Jonas Membro; Lia "Secretaria" (só view_all_reports); Hugo sem função.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2100000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2100000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2100000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2100000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192100' || lpad(_n::text, 4, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
-- Instante de Brasília.
CREATE FUNCTION pg_temp.br(_ts text) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS
$$ SELECT (_ts || ' America/Sao_Paulo')::timestamptz $$;

-- Isola a massa (desfeito no ROLLBACK).
SET LOCAL session_replication_role = replica;
UPDATE public.members SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE public.cells SET deleted_at = now() WHERE deleted_at IS NULL;
UPDATE public.cell_reports SET deleted_at = now() WHERE deleted_at IS NULL;
SET LOCAL session_replication_role = origin;

INSERT INTO public.roles (id, name) VALUES ('f2100000-0000-0000-0000-000000000001', 'Secretaria E210');
INSERT INTO public.role_permissions (role_id, permission)
VALUES ('f2100000-0000-0000-0000-000000000001', 'view_all_reports');

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e210-' || n || '@teste.invalid' FROM generate_series(1, 21) n;

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
  (pg_temp.m(20), 'Lia Teste',     'F', false, pg_temp.m(18), true,  pg_temp.u(20), 'f2100000-0000-0000-0000-000000000001', true, pg_temp.mob(20)),
  (pg_temp.m(21), 'Sara Teste',    'F', false, pg_temp.m(3),  true,  pg_temp.u(21), NULL,                   true,  pg_temp.mob(21));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.m(21);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time,
                          street, number, neighborhood, city, state, zip_code) VALUES
  (pg_temp.c(1), pg_temp.m(7),  pg_temp.m(9),  pg_temp.m(13), 'Evangelística', 'Quarta',  '20:00',
   'Rua das Flores', '100', 'Centro', 'Porto Alegre', 'RS', '90010000'),
  (pg_temp.c(2), pg_temp.m(16), pg_temp.m(17), pg_temp.m(9),  'Evangelística', 'Quinta',  '20:00',
   'Av. São João', '45', 'São João', 'Porto Alegre', 'RS', NULL),
  (pg_temp.c(3), pg_temp.m(14), pg_temp.m(15), pg_temp.m(8),  'Discipulado',   'Terça',   '19:30',
   'Rua Sao Joao', '12', 'Niterói', 'Canoas', 'RS', NULL),
  (pg_temp.c(4), pg_temp.m(11), pg_temp.m(12), pg_temp.m(10), 'Evangelística', 'Sábado',  '10:00',
   'Rua Brasil', '500', 'Centro', 'Alegrete', 'RS', NULL),
  (pg_temp.c(5), pg_temp.m(12), pg_temp.m(11), pg_temp.m(10), 'Evangelística', 'Sexta',   '20:00',
   NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.c(6), pg_temp.m(4),  pg_temp.m(13), pg_temp.m(4),  'Discipulado',   'Segunda', '20:00',
   NULL, NULL, NULL, NULL, NULL, NULL),
  (pg_temp.c(7), pg_temp.m(1),  pg_temp.m(5),  pg_temp.m(2),  'Macrocélula',   'Domingo', '18:00',
   'Rua da Igreja', '1', 'Centro', 'Porto Alegre', 'RS', NULL),
  (pg_temp.c(8), pg_temp.m(18), pg_temp.m(19), pg_temp.m(18), 'Evangelística', 'Sábado',  '16:00',
   'Rua das Flores', '7', 'Rio Branco', 'Canoas', 'RS', NULL);
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(4);
UPDATE public.cells SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.c(5);
-- Datas de cadastro (RN-11, RN-13): C3 sem data (legado). Em replica, o carimbo da autoria não roda.
SET LOCAL session_replication_role = replica;
UPDATE public.cells SET created_by_kind = CASE WHEN id = pg_temp.c(3) THEN 'unknown' ELSE created_by_kind END,
                        created_at = CASE id
    WHEN pg_temp.c(1) THEN pg_temp.br('2025-03-10 10:00')
    WHEN pg_temp.c(2) THEN pg_temp.br('2026-11-22 00:10')
    WHEN pg_temp.c(3) THEN NULL
    WHEN pg_temp.c(4) THEN pg_temp.br('2026-06-05 10:00')
    WHEN pg_temp.c(5) THEN pg_temp.br('2026-09-01 10:00')
    WHEN pg_temp.c(6) THEN pg_temp.br('2026-11-21 23:30')
    WHEN pg_temp.c(7) THEN pg_temp.br('2024-01-15 10:00')
    WHEN pg_temp.c(8) THEN pg_temp.br('2026-02-02 10:00') END
 WHERE id::text LIKE 'd2100000%';
-- Relatórios da massa do Negócio (datas fixas; a marca dispensa as regras de lançamento):
-- C1: R1 (18/11, 8 participantes, 2 visitantes, R$ 50), R2 (11/11, não houve), R3 (04/11 20:15, excluído,
-- 7 e 1), R4 (28/10, 6 e 0), R5 (21/10, 5 e 1); C3: R8; C5: R6 (antes da exclusão); C6: R9; C7: R10.
SET LOCAL mci.cell_report_write = 'on';
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering, reason_not_held, observations, visitors, deleted_at) VALUES
  (pg_temp.r(1),  pg_temp.c(1), '2026-11-18', '20:00', true,  'A fé que vence', 50, NULL, 'Dois visitantes do trabalho do Caio', '{Visitante A,Visitante B}', NULL),
  (pg_temp.r(2),  pg_temp.c(1), '2026-11-11', '20:00', false, NULL, NULL, 'Chuva forte no bairro', NULL, '{}', NULL),
  (pg_temp.r(3),  pg_temp.c(1), '2026-11-04', '20:15', true,  'Esperança', 30, NULL, NULL, '{Visitante C}', now()),
  (pg_temp.r(4),  pg_temp.c(1), '2026-10-28', '20:00', true,  'Perdão', 20, NULL, NULL, '{}', NULL),
  (pg_temp.r(5),  pg_temp.c(1), '2026-10-21', '20:00', true,  'Oração', 15, NULL, NULL, '{Visitante D}', NULL),
  (pg_temp.r(6),  pg_temp.c(5), '2026-11-20', '20:00', true,  'Tema', 10, NULL, NULL, '{}', NULL),
  (pg_temp.r(8),  pg_temp.c(3), '2026-11-10', '19:30', true,  'Tema', 10, NULL, NULL, '{}', NULL),
  (pg_temp.r(9),  pg_temp.c(6), '2026-11-23', '20:00', true,  'Tema', 10, NULL, NULL, '{}', NULL),
  (pg_temp.r(10), pg_temp.c(7), '2026-11-22', '18:00', true,  'Tema', 10, NULL, NULL, '{}', NULL);
UPDATE public.cell_reports SET deleted_by = pg_temp.m(15) WHERE id = pg_temp.r(3);
-- Participantes: R1 8, R3 7, R4 6, R5 5 (os primeiros da lista).
INSERT INTO public.cell_report_participants (report_id, member_id)
SELECT pg_temp.r(k.r), pg_temp.m(x)
  FROM (VALUES (1, 8), (3, 7), (4, 6), (5, 5)) k(r, n),
       LATERAL unnest((ARRAY[7, 9, 13, 3, 4, 8, 10, 11])[1:k.n]) x;
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();
-- As células contam para a situação desde sempre (risco 4 do E2.09).
UPDATE private.cell_active_periods SET periods = '{(,)}' WHERE cell_id::text LIKE 'd2100000%';

CREATE TEMP TABLE lbl (id uuid PRIMARY KEY, label text);
INSERT INTO lbl SELECT pg_temp.c(n), 'C' || n FROM generate_series(1, 8) n;
INSERT INTO lbl SELECT pg_temp.m(n), 'M' || n FROM generate_series(1, 21) n;
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
-- As células da página, pelos rótulos, na ordem da lista.
CREATE FUNCTION pg_temp.list(_n int, _args text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(coalesce(l.label, t.id::text) ORDER BY t.ordinality), ''[]'')
     FROM public.cells_list(%s) WITH ORDINALITY t LEFT JOIN pg_temp.lbl l ON l.id = t.id',
  pg_temp.args(_args)));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
CREATE FUNCTION pg_temp.srt(VARIADIC _v text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') FROM unnest(_v) x $$;
CREATE FUNCTION pg_temp.set(_n int, _args text DEFAULT '') RETURNS text[] LANGUAGE sql AS
$$ SELECT pg_temp.srt(VARIADIC pg_temp.list(_n, _args)) $$;
CREATE FUNCTION pg_temp.cnt(_n int, _args text DEFAULT '') RETURNS text LANGUAGE sql AS
$$ SELECT coalesce(pg_temp.run_as(_n, format('SELECT to_jsonb(public.cells_list_count(%s))', _args)) ->> 'error',
                   pg_temp.run_as(_n, format('SELECT to_jsonb(public.cells_list_count(%s))', _args))::text) $$;
-- Todas as páginas, de _size em _size: os ids na ordem em que vieram.
CREATE FUNCTION pg_temp.pages(_n int, _size int, _args text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _all text[] := '{}'; _page jsonb; _off int := 0;
BEGIN
  LOOP
    _page := pg_temp.run_as(_n, format(
      'SELECT coalesce(jsonb_agg(t.id ORDER BY t.ordinality), ''[]'') FROM public.cells_list(%s) WITH ORDINALITY t',
      concat_ws(', ', nullif(_args, ''), format('_limit => %s, _offset => %s', _size, _off))));
    EXIT WHEN jsonb_typeof(_page) <> 'array' OR jsonb_array_length(_page) = 0 OR _off > 1000;
    _all := _all || ARRAY(SELECT jsonb_array_elements_text(_page));
    _off := _off + _size;
  END LOOP;
  RETURN _all;
END $$;
CREATE FUNCTION pg_temp.ids(VARIADIC _n int[]) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT quote_literal(array_agg(pg_temp.m(n) ORDER BY o)::text) FROM unnest(_n) WITH ORDINALITY t(n, o) $$;
-- Os relatórios do detalhe: "Rn:participantes:visitantes:seta de participantes:seta de visitantes".
CREATE FUNCTION pg_temp.recent(_n int, _cell int, _extra text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(concat_ws('':'', coalesce(l.label, t.id::text), t.participants_count, t.visitors_count,
                                       coalesce(t.participants_trend::text, ''-''), coalesce(t.visitors_trend::text, ''-''))
                             ORDER BY t.ordinality), ''[]'')
     FROM public.cell_recent_reports(%L%s) WITH ORDINALITY t LEFT JOIN pg_temp.lbl l ON l.id = t.id',
  pg_temp.c(_cell), _extra));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
CREATE FUNCTION pg_temp.ident(_n int, _cell uuid) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(pg_temp.run_as(_n, format(
    'SELECT jsonb_agg(concat_ws(''|'', coalesce(l.label, t.cell_id::text), split_part(t.leader_name, '' '', 1), t.meeting_day,
                                left(t.meeting_time::text, 5), t.cell_deleted))
       FROM public.cell_identity(%L) t LEFT JOIN pg_temp.lbl l ON l.id = t.cell_id', _cell)) ->> 0, 'nenhuma')
$$;
CREATE FUNCTION pg_temp.cv(_n int, _cell uuid) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.run_as(_n, format('SELECT to_jsonb(count(*)) FROM public.cells_view WHERE id = %L', _cell))::text $$;
CREATE FUNCTION pg_temp.crv(_n int, _cell uuid) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.run_as(_n, format('SELECT to_jsonb(count(*)) FROM public.cell_reports_view WHERE cell_id = %L', _cell))::text $$;
-- Cenário: aplica os comandos (como postgres), lê a consulta e DESFAZ tudo.
CREATE FUNCTION pg_temp.scn(_cmds text[], _q text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _c text; _v jsonb;
BEGIN
  BEGIN
    FOREACH _c IN ARRAY _cmds LOOP EXECUTE _c; END LOOP;
    EXECUTE _q INTO _v;
    RAISE EXCEPTION 'e210 rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'e210 rollback' THEN RAISE; END IF;
  END;
  RETURN _v;
END $$;
CREATE FUNCTION pg_temp.ja(_v jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY(SELECT jsonb_array_elements_text(_v)) $$;
CREATE FUNCTION pg_temp.recent_q(_n int, _cell int, _extra text DEFAULT '') RETURNS text LANGUAGE sql AS
$$ SELECT format('SELECT to_jsonb(pg_temp.recent(%s, %s, %L))', _n, _cell, _extra) $$;
-- Oito relatórios a mais em C1, antes de R5, sem participantes nem visitantes (12 visíveis).
CREATE FUNCTION pg_temp.more() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['SET LOCAL mci.cell_report_write = ''on''',
    format($c$INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering)
              SELECT ('e2100000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, %L, date '2026-10-21' - 7 * n, '20:00', true, 'Tema', 1
                FROM generate_series(1, 8) n$c$, pg_temp.c(1))]
$$;

-- ===========================================================================
-- Estrutura e privilégios (os dois arquivos do passo)
-- ===========================================================================
SELECT enum_has_labels('public', 'cell_filter_person', ARRAY['leader', 'g12'], 'estrutura: enum cell_filter_person');
SELECT is((SELECT array_agg(p.proname::text || ':' || CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END ORDER BY p.proname)
             FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('cells_list', 'cells_list_count', 'cell_filter_options', 'cell_filter_names',
                                'cell_recent_reports', 'cell_identity', 'first_distinct_ids')),
  ARRAY['cell_filter_names:invoker', 'cell_filter_options:invoker', 'cell_identity:invoker', 'cell_recent_reports:invoker',
        'cells_list:definer', 'cells_list_count:definer', 'first_distinct_ids:invoker'],
  'estrutura: cells_list e cells_list_count definer; as outras invoker (uma assinatura de cada)');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
              AND p.proname IN ('cells_list', 'cells_list_count', 'cell_filter_options', 'cell_filter_names',
                                'cell_recent_reports', 'cell_identity', 'first_distinct_ids', 'cell_filter_normalize', 'cell_filter_sql')
              AND p.proconfig IS NULL),
  NULL, 'estrutura: todas com search_path fixo');
SELECT is((SELECT array_agg(p.proname::text || ':' || r ORDER BY p.proname, r) FROM pg_proc p,
                  unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('cells_list', 'cells_list_count', 'cell_filter_options', 'cell_filter_names',
                                'cell_recent_reports', 'cell_identity')
              AND has_function_privilege(r, p.oid, 'EXECUTE')),
  ARRAY['cell_filter_names:authenticated', 'cell_filter_options:authenticated', 'cell_identity:authenticated',
        'cell_recent_reports:authenticated', 'cells_list:authenticated', 'cells_list_count:authenticated'],
  'estrutura: as funções da API com EXECUTE só para authenticated');
SELECT is(ARRAY[has_function_privilege('anon', 'public.first_distinct_ids(uuid[], integer)', 'EXECUTE'),
                has_function_privilege('authenticated', 'public.first_distinct_ids(uuid[], integer)', 'EXECUTE')],
  ARRAY[false, true], 'estrutura: first_distinct_ids com EXECUTE para authenticated, não para anon');
SELECT is((SELECT array_agg(p.proname::text || ':' || r ORDER BY p.proname, r) FROM pg_proc p,
                  unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE p.pronamespace = 'private'::regnamespace AND p.proname IN ('cell_filter_normalize', 'cell_filter_sql')
              AND has_function_privilege(r, p.oid, 'EXECUTE')),
  NULL, 'estrutura: as internas sem EXECUTE para os papéis da API');
SELECT is(ARRAY[has_schema_privilege('anon', 'private', 'USAGE'), has_schema_privilege('authenticated', 'private', 'USAGE')],
  ARRAY[false, false], 'estrutura: anon e authenticated sem USAGE em private');
SELECT has_index('public', 'cells', 'cells_created_at_idx', 'estrutura: índice de cells.created_at');
SELECT is((SELECT array_agg(n ORDER BY o) FROM pg_proc p, unnest(p.proargnames) WITH ORDINALITY a(n, o)
            WHERE p.oid = 'public.cell_recent_reports(uuid, integer)'::regprocedure AND o > 2),
  ARRAY['id', 'date', 'time', 'was_held', 'theme', 'reason_not_held', 'observations', 'offering',
        'participants_count', 'visitors_count', 'participants_trend', 'visitors_trend'],
  'RN-18: cell_recent_reports só com números: nenhuma coluna de nomes');

-- ===========================================================================
-- RN-14: o detalhe é a cells_view por id
-- ===========================================================================
SELECT is(ARRAY[pg_temp.cv(16, pg_temp.c(1)), pg_temp.cv(16, pg_temp.c(5)), pg_temp.cv(16, gen_random_uuid())],
  ARRAY['0', '0', '0'], 'RN-14: Diego em C1 (fora do escopo), C5 (excluída) e inexistente: nenhuma linha');
SELECT is(pg_temp.cv(17, pg_temp.c(2)), '1', 'RN-14: Hugo em C2 (timóteo): a linha');
SELECT is(pg_temp.cv(20, pg_temp.c(1)), '0', 'RN-14: Lia em C1: nenhuma linha');
SELECT is(pg_temp.recent(16, 1), ARRAY[]::text[], 'DA-4: cell_recent_reports vazio para Diego em C1');
SELECT is(pg_temp.crv(20, pg_temp.c(1)), '4', 'DA-4: Lia vê os 4 relatórios de C1 em Relatórios…');
SELECT is(pg_temp.recent(20, 1), ARRAY[]::text[], 'DA-4: …mas o detalhe de C1 não lhe dá nenhum');
SELECT is(pg_temp.recent(15, 5), ARRAY[]::text[], 'DA-4: célula excluída (C5): vazio, mesmo para Rita');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_recent_reports(NULL)')::text, '0', 'DA-4: id nulo: vazio');

-- ===========================================================================
-- RN-17, RN-18, RN-20: os últimos relatórios, a ordem e a comparação (DA-9)
-- ===========================================================================
SELECT is(pg_temp.recent(3, 1), ARRAY['R1:8:2:1:1', 'R2:0:0:-:-', 'R4:6:0:1:-1', 'R5:5:1:-:-'],
  'RN-17: Pedro em C1: R1, R2, R4 e R5 (R3 excluído); R1 +1/+1 contra R4; R2 sem; R4 +1/−1 contra R5; R5 sem');
SELECT is(pg_temp.recent(15, 1), pg_temp.recent(3, 1), 'RN-17: Rita vê o mesmo');
SELECT is(pg_temp.recent(3, 1, ', 2'), ARRAY['R1:8:2:1:1', 'R2:0:0:-:-'], 'RN-17: _limit 2: os 2 mais recentes, comparados com os de fora');
SELECT is(pg_temp.run_as(3, format('SELECT jsonb_agg(jsonb_build_array(t.theme, t.offering, t.reason_not_held, t.observations, t.was_held, t.time) ORDER BY t.date DESC)
                                      FROM public.cell_recent_reports(%L) t', pg_temp.c(1))),
  '[["A fé que vence", 50.00, null, "Dois visitantes do trabalho do Caio", true, "20:00:00"],
    [null, null, "Chuva forte no bairro", null, false, "20:00:00"],
    ["Perdão", 20.00, null, null, true, "20:00:00"],
    ["Oração", 15.00, null, null, true, "20:00:00"]]'::jsonb,
  'RN-17: tema, oferta, motivo, observações; "Não houve célula" com a oferta nula (Não informada)');
SELECT is(pg_temp.ja(pg_temp.scn(ARRAY[format('UPDATE public.cell_reports SET deleted_at = now(), deleted_by = %L WHERE id = %L', pg_temp.m(15), pg_temp.r(1))],
                                 pg_temp.recent_q(3, 1))),
  ARRAY['R2:0:0:-:-', 'R4:6:0:1:-1', 'R5:5:1:-:-'], 'RN-17: R1 excluído: sai, e R4 continua comparado com R5');
SELECT is(pg_temp.ja(pg_temp.scn(ARRAY[format('UPDATE public.cell_reports SET deleted_at = NULL, deleted_by = NULL WHERE id = %L', pg_temp.r(3))],
                                 pg_temp.recent_q(3, 1))),
  ARRAY['R1:8:2:1:1', 'R2:0:0:-:-', 'R3:7:1:1:1', 'R4:6:0:1:-1', 'R5:5:1:-:-'], 'RN-17: R3 restaurado: R1 passa a comparar com R3, e R3 com R4');
SELECT is(pg_temp.scn(ARRAY['SET LOCAL mci.cell_report_write = ''on''',
                            format('UPDATE public.cell_reports SET offering = 0 WHERE id = %L', pg_temp.r(5))],
                      format('SELECT pg_temp.run_as(3, %L)',
                             format('SELECT jsonb_agg(t.offering ORDER BY t.date DESC) FROM public.cell_recent_reports(%L) t', pg_temp.c(1)))),
  '[50.00, null, 20.00, 0.00]'::jsonb, 'RN-17: oferta zero volta 0 ("R$ 0,00"), e a nula volta nula');
SELECT is((pg_temp.ja(pg_temp.scn(ARRAY['SET LOCAL session_replication_role = replica',
                                       format('UPDATE public.members SET deleted_at = now() WHERE id = %L', pg_temp.m(9))],
                                 pg_temp.recent_q(3, 1))))[1],
  'R1:8:2:1:1', 'RN-18: o participante excluído (Caio) continua contado');
SELECT is(cardinality(pg_temp.ja(pg_temp.scn(pg_temp.more(), pg_temp.recent_q(3, 1)))), 10,
  'RN-20: 12 relatórios visíveis: valem os 10 mais recentes');
SELECT is(cardinality(pg_temp.ja(pg_temp.scn(pg_temp.more(), pg_temp.recent_q(3, 1, ', 50')))), 10, 'DA-1: _limit acima de 10 vira 10');
SELECT is((pg_temp.ja(pg_temp.scn(pg_temp.more(), pg_temp.recent_q(3, 1))))[4], 'R5:5:1:1:1',
  'DA-9: R5 passa a comparar com o relatório anterior de célula realizada (0 participantes, 0 visitantes)');
SELECT is(pg_temp.recent(3, 1, ', 0'), ARRAY['R1:8:2:1:1'], 'DA-1: _limit abaixo de 1 vira 1');
SELECT is(pg_temp.recent(18, 8), ARRAY[]::text[], 'RN-17: Ester em C8 (sem relatório): vazio');

-- ===========================================================================
-- RN-19: o filtro Célula de Relatórios (cell_identity e cell_reports_view por cell_id)
-- ===========================================================================
SELECT is(pg_temp.ident(3, pg_temp.c(1)), 'C1|André|Quarta|20:00|f', 'RN-19: Pedro em C1: pela célula');
SELECT is(pg_temp.ident(20, pg_temp.c(1)), 'C1|André|Quarta|20:00|f', 'RN-19: Lia em C1: pelo relatório (só vê relatórios)');
SELECT is(pg_temp.ident(16, pg_temp.c(1)), 'nenhuma', 'RN-19: Diego em C1: nenhuma linha');
SELECT is(pg_temp.ident(15, pg_temp.c(5)), 'C5|Jonas|Sexta|20:00|t', 'RN-19: Rita em C5 (excluída): pelo relatório, com "Célula excluída"');
SELECT is(pg_temp.ident(18, pg_temp.c(8)), 'C8|Ester|Sábado|16:00|f', 'RN-19: Ester em C8 (sem relatório): pela célula');
SELECT is(pg_temp.ident(15, gen_random_uuid()), 'nenhuma', 'RN-19: id inexistente: nenhuma linha');
SELECT is(pg_temp.ident(15, NULL), 'nenhuma', 'RN-19: id nulo: nenhuma linha');
SELECT is(ARRAY[pg_temp.crv(3, pg_temp.c(1)), pg_temp.crv(20, pg_temp.c(1)), pg_temp.crv(16, pg_temp.c(1)), pg_temp.crv(15, pg_temp.c(5))],
  ARRAY['4', '4', '0', '1'], 'RN-19: a lista de Relatórios por cell_id: Pedro 4, Lia 4, Diego 0, Rita em C5 1');
SELECT is(pg_temp.scn(ARRAY[format('UPDATE public.cells SET leader_id = %L WHERE id = %L', pg_temp.m(9), pg_temp.c(1))],
                      format('SELECT to_jsonb(pg_temp.ident(15, %L))', pg_temp.c(1))) #>> '{}',
  'C1|Caio|Quarta|20:00|f', 'DA-10: a identificação usa os valores atuais da célula, não o retrato');
SELECT is(pg_temp.run_as(15, format('SELECT jsonb_agg(t) FROM public.cell_identity(%L) t', pg_temp.c(1))) -> 0 ? 'snapshot_leader_id', false,
  'DA-10: nenhuma coluna do retrato na identificação');

SELECT * FROM finish();
ROLLBACK;
