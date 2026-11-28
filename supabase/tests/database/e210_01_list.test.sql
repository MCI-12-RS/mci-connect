-- E2.10 (PR 1): a lista de Células com filtros (cells_list e cells_list_count), os seletores de Líder e
-- G12 (cell_filter_options e cell_filter_names) e a equivalência com o Dashboard (RN-21), pela sessão de
-- cada persona.
-- Spec: docs/specs/e2-10-listagem-celulas.md ("Massa de exemplo", "Critérios por regra",
-- "Verificações obrigatórias (para o QA)"; RN-01 a RN-13, RN-21; DA-1 a DA-3, DA-6 a DA-8, DA-11, DA-12).
-- Massa (dados fictícios): a do Negócio (20 pessoas, 8 células), montada como postgres com os triggers
-- ligados e as regras do E2.04 e do E2.08. Os outros cadastros da base ficam excluídos dentro da
-- transação (em replica, desfeito no ROLLBACK), para os números de Rita (Administrador) valerem.
-- A situação do relatório (RN-10) é conferida como propriedade (a contagem igual às linhas da
-- cells_view com o mesmo valor, na mesma chamada), sem depender da hora em que o teste roda.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(149);

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
-- Relatórios relativos a hoje, para variar a situação (E2.09): C6 e C7 com relatório desta semana;
-- C1 da semana passada; C3 de duas semanas atrás; C2, C4 e C8 sem nenhum.
SET LOCAL mci.cell_report_write = 'on';
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering) VALUES
  (pg_temp.r(1), pg_temp.c(1), public.week_start(public.sp_today()) - 4,  '20:00', true, 'Tema', 10),
  (pg_temp.r(8), pg_temp.c(3), public.week_start(public.sp_today()) - 12, '19:30', true, 'Tema', 10),
  (pg_temp.r(9), pg_temp.c(6), public.week_start(public.sp_today()),      '00:00', true, 'Tema', 10),
  (pg_temp.r(10), pg_temp.c(7), public.week_start(public.sp_today()),     '00:00', true, 'Tema', 10);
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();
-- As células contam para a situação desde sempre (risco 4 do E2.09).
UPDATE private.cell_active_periods SET periods = '{(,)}' WHERE cell_id::text LIKE 'd2100000%';

CREATE TEMP TABLE lbl (id uuid PRIMARY KEY, label text);
INSERT INTO lbl SELECT pg_temp.c(n), 'C' || n FROM generate_series(1, 8) n;
INSERT INTO lbl SELECT pg_temp.m(n), 'M' || n FROM generate_series(1, 21) n;
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
-- Opções e nomes dos seletores: "Nome (nível)" ou só "Nome".
CREATE FUNCTION pg_temp.opts(_n int, _person text, _extra text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(split_part(t.name, '' '', 1) || coalesce('' ('' || t.g12_level || '')'', '''') ORDER BY t.ordinality), ''[]'')
     FROM public.cell_filter_options(%L%s) WITH ORDINALITY t', _person, _extra));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
CREATE FUNCTION pg_temp.nms(_n int, _person text, _ids text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(split_part(t.name, '' '', 1) ORDER BY t.name), ''[]'')
     FROM public.cell_filter_names(%L, %s) t', _person, _ids));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
-- Os ids da cells_view na ordem da RN-13, pela sessão.
CREATE FUNCTION pg_temp.view_ids(_n int) RETURNS text[] LANGUAGE sql AS $$
  SELECT ARRAY(SELECT jsonb_array_elements_text(pg_temp.run_as(_n,
    'SELECT coalesce(jsonb_agg(v.id ORDER BY v.created_at DESC NULLS LAST, v.id), ''[]'') FROM public.cells_view v')))
$$;

-- ===========================================================================
-- RN-01, RN-03, RN-13: sem filtros, a lista é a cells_view de cada um, na ordem do cadastro
-- ===========================================================================
SELECT is(pg_temp.list(15), ARRAY['C2', 'C6', 'C4', 'C8', 'C1', 'C7', 'C3'],
  'RN-13: Rita sem filtros: cadastro mais recente primeiro, "data não registrada" (C3) no fim; C5 (excluída) fora');
SELECT is(pg_temp.cnt(15), '7', 'RN-01: Rita sem filtros: total 7');
SELECT is(pg_temp.set(n), pg_temp.srt(VARIADIC exp), 'RN-03: ' || nm || ' vê ' || array_to_string(exp, ', '))
  FROM (VALUES (1,  'Samuel', ARRAY['C1', 'C2', 'C3', 'C4', 'C6', 'C7']),
               (3,  'Pedro',  ARRAY['C1', 'C2', 'C4', 'C6']),
               (9,  'Caio',   ARRAY['C1', 'C2', 'C4', 'C6']),
               (10, 'Fábio',  ARRAY['C1', 'C2', 'C4', 'C6']),
               (7,  'André',  ARRAY['C1', 'C2', 'C3', 'C4', 'C6']),
               (16, 'Diego',  ARRAY['C2', 'C3', 'C7']),
               (18, 'Ester',  ARRAY['C8']),
               (17, 'Hugo',   ARRAY['C2']),
               (20, 'Lia',    ARRAY[]::text[])) p(n, nm, exp);

-- Paridade (E2.02, risco 2): todas as páginas, de 2 em 2, são os ids da cells_view na ordem da RN-13,
-- sem repetir, e o total é a contagem da view.
CREATE FUNCTION pg_temp.parity(_n int) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE _p text[] := pg_temp.pages(_n, 2);
        _v text[] := pg_temp.view_ids(_n);
BEGIN
  RETURN _p = _v AND pg_temp.cnt(_n) = cardinality(_v)::text;
END $$;
SELECT ok(pg_temp.parity(n), 'paridade (E2.02): ' || nm || ': as páginas de 2 em 2 e o total são os da cells_view, na ordem')
  FROM (VALUES (15, 'Rita'), (1, 'Samuel'), (3, 'Pedro'), (7, 'André'), (16, 'Diego'), (9, 'Caio'),
               (10, 'Fábio'), (18, 'Ester'), (17, 'Hugo'), (20, 'Lia')) p(n, nm);
SELECT is(pg_temp.list(15, '_limit => 2, _offset => 50'), ARRAY[]::text[], 'RN-02: página além do fim: vazia, sem erro');

-- ===========================================================================
-- RN-02: combinação
-- ===========================================================================
SELECT is(pg_temp.list(15, '_types => ''{Evangelística}'', _city => ''porto alegre'''), ARRAY['C2', 'C1'],
  'RN-02: Tipo Evangelística E Cidade Porto Alegre: C2 e C1, na ordem do cadastro');
SELECT is(pg_temp.cnt(15, '_types => ''{Evangelística}'', _city => ''porto alegre'''), '2', 'RN-02: total 2');
SELECT is(pg_temp.set(15, '_types => ''{Discipulado,Macrocélula}'''), pg_temp.srt('C3', 'C6', 'C7'),
  'RN-02: dentro do Tipo, basta valer uma opção');
SELECT is(pg_temp.cnt(15, '_search => ''{%andre%}'', _types => ''{Discipulado}'''), '0', 'RN-02: busca e filtro juntos');
SELECT is(pg_temp.set(3, '_search => ''{%caio%}'''), pg_temp.srt('C1', 'C2'), 'RN-02: a busca da lista (E1.08) continua: Caio em C1 e C2 (Pedro)');

-- ===========================================================================
-- RN-04, RN-05, RN-06: Líder e G12
-- ===========================================================================
SELECT is(pg_temp.set(15, '_leader_ids => ' || pg_temp.ids(7)), ARRAY['C1'], 'RN-04: Líder André: C1');
SELECT is(pg_temp.set(15, '_leader_ids => ' || pg_temp.ids(9)), ARRAY[]::text[], 'RN-04: ser timóteo ou anfitrião não conta (Caio)');
SELECT is(pg_temp.set(15, '_leader_ids => ' || pg_temp.ids(3)), ARRAY[]::text[], 'RN-04: não é "em qualquer nível" (Pedro não lidera célula)');
SELECT is(pg_temp.set(15, '_leader_ids => ' || pg_temp.ids(7, 11, 1)), pg_temp.srt('C1', 'C4', 'C7'),
  'RN-04: André, Gabriel e Samuel: C1, C4 (inativa) e C7 (pastor)');
SELECT is(pg_temp.set(15, '_g12_ids => ' || pg_temp.ids(3)), pg_temp.srt('C1', 'C4'), 'RN-05: G12 Pedro: C1 e C4 (C5 excluída fora)');
SELECT is(pg_temp.set(15, '_g12_ids => ' || pg_temp.ids(4)), ARRAY['C6'], 'RN-05: G12 Paula: C6, que ela mesma lidera');
SELECT is(pg_temp.set(15, '_g12_ids => ' || pg_temp.ids(3, 4)), pg_temp.srt('C1', 'C4', 'C6'), 'RN-05: o casal Pedro e Paula: escolhem-se os dois');
SELECT is(pg_temp.set(15, '_g12_ids => ' || pg_temp.ids(1, 18)), ARRAY[]::text[], 'RN-05: pastor e sem liderança nunca entram no G12');
SELECT is(pg_temp.set(3, '_g12_ids => ' || pg_temp.ids(6)), ARRAY[]::text[], 'RN-06: Pedro com G12 Tânia (não vê): nada');
SELECT is(pg_temp.set(3, '_g12_ids => ' || pg_temp.ids(6, 3)), pg_temp.srt('C1', 'C4'), 'RN-06: com outra pessoa, vale só a outra');
SELECT is(pg_temp.set(7, '_g12_ids => ' || pg_temp.ids(6)), ARRAY['C3'], 'RN-06: André com G12 Tânia: C3');

-- Opções (RN-04, RN-05, DA-8): só das células visíveis, em ordem alfabética, ativas e inativas.
SELECT is(pg_temp.opts(3, 'leader'), ARRAY['André (2)', 'Diego (2)', 'Gabriel (4)', 'Paula (1)'],
  'RN-04: opções de Líder de Pedro, com o nível');
SELECT is(pg_temp.opts(3, 'g12'), ARRAY['Paula', 'Pedro', 'Tiago'], 'RN-05: opções de G12 de Pedro, só o nome');
SELECT is(pg_temp.opts(7, 'leader'), ARRAY['André (2)', 'Débora (3)', 'Diego (2)', 'Gabriel (4)', 'Paula (1)'],
  'RN-04: opções de Líder de André (Débora pelo ministério da cônjuge)');
SELECT is(pg_temp.opts(7, 'g12'), ARRAY['Paula', 'Pedro', 'Tânia', 'Tiago'], 'RN-05: opções de G12 de André');
SELECT is(pg_temp.opts(15, 'leader'), ARRAY['André (2)', 'Débora (3)', 'Diego (2)', 'Ester', 'Gabriel (4)', 'Paula (1)', 'Samuel (0)'],
  'RN-04: opções de Líder de Rita: pastor e sem liderança entram; Jonas (C5 excluída) não');
SELECT is(pg_temp.opts(15, 'g12'), ARRAY['Paula', 'Pedro', 'Tânia', 'Tiago'], 'RN-05: opções de G12 de Rita: sem pastor e sem liderança');
SELECT is(pg_temp.opts(3, 'leader', ', _search => ''{%DIE%}'''), ARRAY['Diego (2)'], 'RN-04: busca nas opções');
SELECT is(pg_temp.opts(7, 'g12', ', _search => ''{%tania%}'''), ARRAY['Tânia'], 'RN-05: busca sem acento');
SELECT is(pg_temp.opts(3, 'g12', ', _search => ''{%tania%}'''), ARRAY[]::text[], 'RN-06: Pedro não encontra Tânia nas opções');
SELECT is(pg_temp.opts(15, 'leader', ', _limit => 2, _offset => 2'), ARRAY['Diego (2)', 'Ester'], 'DA-8: paginação das opções');
SELECT is(pg_temp.opts(17, 'leader'), ARRAY['Diego (2)'], 'RN-04: Hugo: só o líder de C2');
SELECT is(pg_temp.opts(20, 'g12'), ARRAY[]::text[], 'RN-04: Lia (nenhuma célula): nenhuma opção');

-- Nomes da URL (RN-06, DA-11).
SELECT is(pg_temp.nms(3, 'g12', pg_temp.ids(6)), ARRAY[]::text[], 'RN-06: Tânia para Pedro (G12): nenhuma linha');
SELECT is(pg_temp.nms(7, 'g12', pg_temp.ids(6)), ARRAY['Tânia'], 'RN-06: Tânia para André (G12): o nome');
SELECT is(pg_temp.nms(3, 'leader', pg_temp.ids(14)), ARRAY[]::text[], 'RN-06: Débora para Pedro (Líder): nenhuma linha');
SELECT is(pg_temp.nms(15, 'leader', pg_temp.ids(9)), ARRAY['Caio'], 'DA-11: Caio para Rita (Líder): visível como membro, o nome');
SELECT is(pg_temp.nms(15, 'g12', pg_temp.ids(9)), ARRAY['Caio'], 'DA-11: Caio para Rita (G12): o nome');
SELECT is(pg_temp.nms(16, 'g12', pg_temp.ids(5)), ARRAY['Tiago'], 'RN-06: Tiago para Diego (G12 de C2): o nome');
SELECT is(pg_temp.nms(15, 'leader', pg_temp.ids(21)), ARRAY[]::text[], 'RN-06: excluída (Sara): nenhuma linha');
SELECT is(pg_temp.nms(15, 'leader', quote_literal(ARRAY[gen_random_uuid()]::text)), ARRAY[]::text[], 'RN-06: inexistente: nenhuma linha');
SELECT is(pg_temp.nms(3, 'leader', pg_temp.ids(7, 14, 16)), pg_temp.srt('André', 'Diego'), 'RN-06: os resolvidos voltam; os outros, não');
SELECT is(pg_temp.run_as(15, format('SELECT jsonb_agg(t.g12_level) FROM public.cell_filter_names(''g12'', %s) t', pg_temp.ids(3))),
  '[null]'::jsonb, 'contrato: no G12, o nível volta nulo também nos nomes');
SELECT is(pg_temp.nms(15, 'leader', format('ARRAY[%L, %L, NULL, %L]::uuid[]', pg_temp.m(7), pg_temp.m(7), pg_temp.m(16))),
  pg_temp.srt('André', 'Diego'), 'DA-2: repetidos e nulos nos nomes');

-- DA-2: 12 ids valem os 10 primeiros; repetidos e nulos contam uma vez.
SELECT is(pg_temp.set(15, '_leader_ids => ' || pg_temp.ids(1, 2, 3, 5, 6, 8, 9, 10, 12, 13, 7, 16)), ARRAY['C7'],
  'DA-2: 12 ids: valem os 10 primeiros (André e Diego, 11º e 12º, ficam de fora)');
SELECT is(pg_temp.set(15, '_leader_ids => ' || pg_temp.ids(7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 16)), pg_temp.srt('C1', 'C2'),
  'DA-2: repetidos contam uma vez: Diego entra');
SELECT is(pg_temp.set(15, '_leader_ids => ''{NULL}'''), pg_temp.set(15), 'DA-2: só nulos = sem filtro');
SELECT is(pg_temp.set(15, '_leader_ids => ''{}'', _g12_ids => ''{}'''), pg_temp.set(15), 'DA-2: vazio = sem filtro');
SELECT is((SELECT public.first_distinct_ids(ARRAY[pg_temp.m(2), NULL, pg_temp.m(1), pg_temp.m(2)], 10)),
  ARRAY[pg_temp.m(2), pg_temp.m(1)], 'DT-11: first_distinct_ids na ordem da primeira aparição, sem nulos');
SELECT is((SELECT public.first_distinct_ids(ARRAY[pg_temp.m(2)], NULL)), '{}'::uuid[], 'DT-11: limite nulo = nenhum');

-- Nenhuma resposta de Pedro traz Tânia, Débora, Samuel ou Magda (RN-06).
CREATE FUNCTION pg_temp.leak(_n int, _txt text) RETURNS boolean LANGUAGE sql AS $$
  SELECT strpos(_txt, x) > 0 FROM unnest(ARRAY['Tânia', 'Débora', 'Samuel', 'Magda',
    pg_temp.m(6)::text, pg_temp.m(14)::text, pg_temp.m(1)::text, pg_temp.m(2)::text]) x ORDER BY 1 DESC LIMIT 1
$$;
SELECT is(pg_temp.leak(3, concat_ws('#',
    pg_temp.run_as(3, 'SELECT jsonb_agg(t) FROM public.cells_list(_limit => 100) t')::text,
    pg_temp.run_as(3, format('SELECT jsonb_agg(t) FROM public.cells_list(_g12_ids => %s) t', pg_temp.ids(6)))::text,
    pg_temp.run_as(3, 'SELECT jsonb_agg(t) FROM public.cell_filter_options(''leader'', _limit => 100) t')::text,
    pg_temp.run_as(3, 'SELECT jsonb_agg(t) FROM public.cell_filter_options(''g12'', _limit => 100) t')::text,
    pg_temp.run_as(3, format('SELECT jsonb_agg(t) FROM public.cell_filter_names(''g12'', %s) t', pg_temp.ids(6, 14, 1, 2)))::text,
    pg_temp.run_as(3, format('SELECT jsonb_agg(t) FROM public.cell_filter_names(''leader'', %s) t', pg_temp.ids(6, 14, 1, 2)))::text)),
  false, 'RN-06: nenhuma resposta de Pedro traz o nome ou o id de Tânia, Débora, Samuel ou Magda');

-- ===========================================================================
-- RN-07: rua, bairro e cidade
-- ===========================================================================
SELECT is(pg_temp.set(15, '_street => ''flores'''), pg_temp.srt('C1', 'C8'), 'RN-07: rua contém "flores"');
SELECT is(pg_temp.set(15, '_street => ''  RUA   DAS  flôres '''), pg_temp.srt('C1', 'C8'), 'RN-07: maiúsculas, acentos e espaços');
SELECT is(pg_temp.set(15, E'_street => ''rua\tdas flores'''), pg_temp.srt('C1', 'C8'), 'RN-07: tabulação conta como espaço');
SELECT is(pg_temp.set(15, '_street => ''sao joao'''), pg_temp.srt('C2', 'C3'), 'RN-07: "São João" e "Sao Joao" sem acento');
SELECT is(pg_temp.set(15, '_neighborhood => ''centro'''), pg_temp.srt('C1', 'C4', 'C7'), 'RN-07: bairro Centro');
SELECT is(pg_temp.set(15, '_city => ''canoas'''), pg_temp.srt('C3', 'C8'), 'RN-07: cidade Canoas');
SELECT is(pg_temp.cnt(15, '_street => ''%'''), '0', 'RN-07: % é texto');
SELECT is(pg_temp.cnt(15, '_street => ''_'''), '0', 'RN-07: _ é texto');
SELECT is(pg_temp.cnt(15, E'_street => ''\\'''), '0', 'RN-07: \ é texto');
SELECT is(pg_temp.cnt(15, '_city => ''porto''''alegre'''), '0', 'RN-07: aspas são texto');
SELECT is(pg_temp.cnt(15, '_street => ''rua%flores'''), '0', 'RN-07: % no meio não é curinga');
SELECT is(pg_temp.cnt(15, '_street => ''   '''), '7', 'RN-07: só espaços = sem filtro');
SELECT is(length((private.cell_filter_normalize(NULL, NULL, NULL, repeat('a', 150), NULL, NULL, NULL, NULL, NULL,
  NULL, NULL, NULL, NULL)).street), 100, 'RN-07: valem os 100 primeiros caracteres');
SELECT ok(NOT ('C6' = ANY (pg_temp.list(15, '_street => ''a''')) OR 'C6' = ANY (pg_temp.list(15, '_neighborhood => ''a'''))
               OR 'C6' = ANY (pg_temp.list(15, '_city => ''a'''))), 'RN-07: a célula sem endereço (C6) nunca entra');

-- Injeção (risco 1): texto malicioso é só texto, sem erro e sem efeito.
SELECT is(pg_temp.cnt(15, format('_street => %L, _neighborhood => %L, _city => %L, _search => %L',
    $x$'); DROP TABLE public.cells; --$x$, $x$' OR 1=1 --$x$, $x$"; SELECT pg_sleep(5); --$x$,
    ARRAY[$x$%'); DROP TABLE public.cells; --%$x$]::text)), '0', 'risco 1: texto malicioso em rua, bairro, cidade e busca: total 0, sem erro');
SELECT is(pg_temp.list(15, format('_street => %L', $x$x') OR true OR ('$x$)), ARRAY[]::text[], 'risco 1: nada é concatenado no SQL');
SELECT has_table('public', 'cells', 'risco 1: a tabela continua lá');

-- ===========================================================================
-- RN-08, RN-09: tipo, dia e situação
-- ===========================================================================
SELECT is(pg_temp.set(15, '_types => ''{Discipulado}'''), pg_temp.srt('C3', 'C6'), 'RN-08: Discipulado');
SELECT is(pg_temp.set(15, '_types => ''{Macrocélula}'''), ARRAY['C7'], 'RN-08: Macrocélula');
SELECT is(pg_temp.set(15, '_weekdays => ''{3}'''), ARRAY['C1'], 'RN-08: quarta');
SELECT is(pg_temp.set(15, '_weekdays => ''{6,0}'''), pg_temp.srt('C4', 'C7', 'C8'), 'RN-08: sábado ou domingo');
SELECT is(pg_temp.set(15, '_is_active => false'), ARRAY['C4'], 'RN-09: Inativa');
SELECT is(pg_temp.cnt(15, '_is_active => true'), '6', 'RN-09: Ativa');

-- ===========================================================================
-- RN-10: situação do relatório (propriedade: a mesma da cells_view, na mesma chamada)
-- ===========================================================================
CREATE FUNCTION pg_temp.prop(_n int, _st text, _wk text) RETURNS boolean LANGUAGE sql AS $$
  SELECT (pg_temp.run_as(_n, format(
    $q$SELECT to_jsonb(
         public.cells_list_count(_report_statuses => %1$s, _missing_weeks => %2$s)
           = (SELECT count(*) FROM public.cells_view v
               WHERE v.report_status = ANY (coalesce(%1$s, '{}'::public.cell_report_status[]))
                  OR v.report_missing_weeks = ANY (coalesce(%2$s, '{}'::integer[])))
         AND (SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') FROM public.cells_list(_report_statuses => %1$s, _missing_weeks => %2$s, _limit => 100) t)
           = (SELECT coalesce(array_agg(v.id ORDER BY v.id), '{}') FROM public.cells_view v
               WHERE v.report_status = ANY (coalesce(%1$s, '{}'::public.cell_report_status[]))
                  OR v.report_missing_weeks = ANY (coalesce(%2$s, '{}'::integer[]))))$q$,
    coalesce(quote_literal(_st) || '::public.cell_report_status[]', 'NULL::public.cell_report_status[]'),
    coalesce(quote_literal(_wk) || '::integer[]', 'NULL::integer[]'))))::text = 'true'
$$;
SELECT ok(pg_temp.prop(n, st, wk), 'RN-10: ' || nm || ', ' || coalesce(st, '') || coalesce(wk, '') || ': a lista e o total são as células da cells_view com o valor')
  FROM (VALUES (15, 'Rita'), (3, 'Pedro')) p(n, nm),
       (VALUES ('{sent_held,sent_not_held}', NULL), ('{not_yet}', NULL), ('{pending}', NULL), ('{next_week}', NULL),
               (NULL, '{1}'), (NULL, '{2}'), (NULL, '{3}'), (NULL, '{4}'), ('{pending}', '{1}'),
               ('{sent_held}', NULL)) o(st, wk);
SELECT ok(NOT ('C4' = ANY (pg_temp.list(15, '_report_statuses => ''{sent_held,sent_not_held,not_yet,pending,next_week}'', _missing_weeks => ''{1,2,3,4}'''))),
  'RN-10: a inativa (C4) nunca entra, mesmo com todas as opções (DA-6)');
SELECT is(pg_temp.cnt(15, '_report_statuses => ''{sent_held,sent_not_held,not_yet,pending,next_week}'', _missing_weeks => ''{0,1,2,3,4}'''),
  pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cells_view WHERE report_status IS NOT NULL AND report_status <> ''no_meeting_day''')::text,
  'DA-6: todas as opções = as células com situação');
SELECT is(pg_temp.cnt(15, '_report_statuses => ''{no_meeting_day}'''), '7', 'RN-10: no_meeting_day ignorado = sem filtro');
SELECT is(pg_temp.cnt(15, '_missing_weeks => ''{0,5,-1}'''), '7', 'RN-10: semanas fora de 1 a 4 ignoradas = sem filtro');
SELECT is(pg_temp.set(15, '_report_statuses => ''{sent_held}'''), pg_temp.srt('C6', 'C7'), 'RN-10: Enviado: C6 e C7, com relatório desta semana');
SELECT ok(pg_temp.cnt(15, '_missing_weeks => ''{4}''')::int >= 1, 'RN-10: C8 (nunca enviou) entra em "4 ou mais"');

-- ===========================================================================
-- RN-11: datas de cadastro (Brasília)
-- ===========================================================================
SELECT is(pg_temp.set(15, '_created_from => ''2026-11-21'', _created_to => ''2026-11-21'''), ARRAY['C6'],
  'RN-11: 21/11: C6 (23:30 de Brasília = 02:30 UTC do dia 22)');
SELECT is(pg_temp.set(15, '_created_from => ''2026-11-22'', _created_to => ''2026-11-22'''), ARRAY['C2'], 'RN-11: 22/11: C2 (00:10)');
SELECT is(pg_temp.list(15, '_created_from => ''2026-11-21'''), ARRAY['C2', 'C6'], 'RN-11: só "a partir de"');
SELECT is(pg_temp.set(15, '_created_to => ''2025-03-10'''), pg_temp.srt('C1', 'C7'), 'RN-11: só "até": os dois dias entram');
SELECT ok(NOT ('C3' = ANY (pg_temp.list(15, '_created_from => ''1900-01-01''')) OR 'C3' = ANY (pg_temp.list(15, '_created_to => ''2999-12-31'''))),
  'RN-11: "data não registrada" (C3) fica fora com qualquer data');
SELECT is(pg_temp.cnt(15, '_created_from => ''2026-12-01'', _created_to => ''2026-01-01'''), '7', 'DA-7: datas invertidas: sem filtro de data');
SELECT is(pg_temp.cnt(15, '_created_from => ''2099-01-01'''), '0', 'RN-11: data futura aceita');
SELECT is(pg_temp.cnt(15, '_created_from => ''0001-01-01'', _created_to => ''9999-12-31'''), '6', 'RN-11: datas nos extremos não estouram');
SET LOCAL timezone = 'UTC';
SELECT is(pg_temp.set(15, '_created_from => ''2026-11-21'', _created_to => ''2026-11-21'''), ARRAY['C6'], 'RN-11: sessão em UTC: o mesmo dia de Brasília');
SET LOCAL timezone = 'Asia/Tokyo';
SELECT is(pg_temp.set(15, '_created_from => ''2026-11-22'', _created_to => ''2026-11-22'''), ARRAY['C2'], 'RN-11: sessão em Asia/Tokyo: o mesmo dia de Brasília');
RESET timezone;

-- ===========================================================================
-- DA-1: normalização pela API
-- ===========================================================================
SELECT is(pg_temp.cnt(15, '_types => ''{Evangelística,Célula}'''), pg_temp.cnt(15, '_types => ''{Evangelística}'''), 'DA-1: tipo fora de cell_types() ignorado');
SELECT is(pg_temp.cnt(15, '_types => ''{Célula}'''), '7', 'DA-1: só tipos inválidos = sem filtro');
SELECT is(pg_temp.cnt(15, '_weekdays => ''{3,9,-1}'''), '1', 'DA-1: dia fora de 0 a 6 ignorado');
SELECT is(cardinality(pg_temp.list(15, '_limit => 0')), 1, 'DA-1: _limit abaixo de 1 vira 1');
SELECT is(pg_temp.list(15, '_limit => 2, _offset => -5'), ARRAY['C2', 'C6'], 'DA-1: _offset negativo vira 0');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(public.cells_list_count(_report_statuses => ''{foo}''))') ->> 'error', '22P02',
  'DA-1: valor fora do enum: recusado (22P02)');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(public.cells_list_count(_leader_ids => ''{xyz}''))') ->> 'error', '22P02',
  'DA-1: uuid malformado: recusado (22P02)');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_filter_options(''foo'')') ->> 'error', '22P02',
  'DA-1: pessoa fora do enum: recusada (22P02)');

-- ===========================================================================
-- RN-21: os números do Dashboard são os da lista filtrada
-- ===========================================================================
SELECT is(pg_temp.run_as(n, 'SELECT to_jsonb((SELECT cells_pending FROM public.dashboard_summary()) = public.cells_list_count(_report_statuses => ''{pending}''))'),
  'true'::jsonb, 'RN-21: ' || nm || ': "Células com relatório pendente" = a lista com Pendente')
  FROM (VALUES (15, 'Rita'), (3, 'Pedro'), (7, 'André')) p(n, nm);
SELECT is(pg_temp.run_as(n, 'SELECT to_jsonb(bool_and(d.total = public.cells_list_count(_types => ARRAY[d.cell_type])) AND count(*) > 0) FROM public.dashboard_cells_by_type() d'),
  'true'::jsonb, 'RN-21: ' || nm || ': cada tipo de "Células por tipo" = a lista com o Tipo')
  FROM (VALUES (15, 'Rita'), (3, 'Pedro'), (7, 'André')) p(n, nm);
SELECT is(pg_temp.run_as(n, $q$SELECT to_jsonb(bool_and(d.total_cells = public.cells_list_count(
      _g12_ids => d.g12_ids, _is_active => true)) AND count(*) > 0)
    FROM public.dashboard_g12_ranking() d$q$),
  'true'::jsonb, 'RN-21: ' || nm || ': cada casal de "Células por G12" = a lista com os dois no G12 e Ativa')
  FROM (VALUES (15, 'Rita'), (3, 'Pedro'), (7, 'André')) p(n, nm);

-- ===========================================================================
-- RN-13: ordem estável com o mesmo instante de cadastro (60 células, de 25 em 25)
-- ===========================================================================
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
SELECT ('d2100000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, pg_temp.m(9), pg_temp.m(13), pg_temp.m(7),
       CASE WHEN n % 2 = 0 THEN 'Evangelística' ELSE 'Discipulado' END, 'Quarta', '20:00'
  FROM generate_series(1, 60) n;
SET LOCAL session_replication_role = replica;
UPDATE public.cells SET created_at = pg_temp.br('2026-11-10 10:00') WHERE id::text LIKE 'd2100000-0000-0000-0001-%';
SET LOCAL session_replication_role = origin;
CREATE TEMP TABLE p60 AS SELECT pg_temp.pages(15, 25) AS ids;
SELECT is(cardinality((SELECT ids FROM p60)), 67, 'RN-13: 67 células em páginas de 25: todas aparecem');
SELECT is((SELECT count(DISTINCT x)::int FROM p60, unnest(ids) x), 67, 'RN-13: nenhuma repetida');
SELECT is((SELECT ids FROM p60), pg_temp.view_ids(15), 'RN-13: na ordem do cadastro e do id');
SELECT is(pg_temp.pages(15, 25, '_types => ''{Discipulado}'''),
  ARRAY(SELECT x FROM p60, unnest(ids) WITH ORDINALITY u(x, o)
         WHERE x::uuid IN (SELECT id FROM public.cells WHERE type = 'Discipulado' AND deleted_at IS NULL) ORDER BY o),
  'RN-13: com filtro, a mesma ordem relativa');
SELECT is(pg_temp.cnt(15), '67', 'RN-02: o total acompanha');

SELECT * FROM finish();
ROLLBACK;
