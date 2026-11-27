-- E2.12 (PR 1), QA independente: o que o e212_01_list nao cobre. Mesma massa (a do Negocio, copiada
-- do e212_01_list) e as mesmas ferramentas de leitura "pela API".
--   1. Paridade com filtros, por persona: cell_reports_list e _count contra a cell_reports_view lida com o
--      WHERE escrito a mao, com cada filtro e combinacoes (RN-01, RN-02, RN-05 a RN-11).
--   2. Paginacao com filtros e com empates; teto de 100 por pagina.
--   3. Celula inativa, celula excluida, relatorio excluido (opcoes, nomes, listas, cell_visible).
--   4. Retrato (lider antigo) x celula atual (a celula muda de lider depois do relatorio).
--   5. server_weeks: borda de domingo em Brasilia, virada de ano e de fevereiro bissexto, igual a
--      dashboard_summary(_at), com timezone de sessao diferente.
--   6. Portao do E2.03 (sessao encerrada e marca de troca de senha) nas quatro RPCs, e anon sem EXECUTE.
--   7. Entradas maliciosas ou extremas pela API (texto, tipos, limites, nulos).
--   8. save_cell_report(NULL) e com id sem mudanca (migration 2).
-- Autocontido, ROLLBACK. Rodar com: supabase test db


BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(95);

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

-- ---------------------------------------------------------------------------
-- Ajudantes deste arquivo
-- ---------------------------------------------------------------------------
-- Como pg_temp.run_as, com a sessao do token (_k = 0: token sem session_id) e devolvendo o app_error.
CREATE FUNCTION pg_temp.s(_n int, _k int DEFAULT 1) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('5e212000-0000-0000-' || lpad(_k::text, 4, '0') || '-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.api(_n int, _sql text, _k int DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _detail text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated',
                        'session_id', CASE WHEN _k > 0 THEN pg_temp.s(_n, _k) END)::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN coalesce(_out, 'null'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', _state, 'code', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'code' END);
  END;
END $$;
-- Com um papel qualquer da API (anon, service_role) e sem usuario.
CREATE FUNCTION pg_temp.as_role(_role text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('role', _role)::text, true);
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    RETURN coalesce(_out, 'null'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state);
  END;
END $$;

INSERT INTO auth.sessions (id, user_id) SELECT pg_temp.s(n, 1), pg_temp.u(n) FROM generate_series(1, 21) n;

-- A view lida pela persona com um WHERE escrito a mao, na ordem da RN-13 (independente da RPC).
CREATE FUNCTION pg_temp.view_where(_n int, _where text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(coalesce(l.label, v.id::text) ORDER BY v.date DESC, v."time" DESC, v.id), ''[]'')
     FROM public.cell_reports_view v LEFT JOIN pg_temp.lbl l ON l.id = v.id WHERE %s', _where));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
-- As personas cujo resultado (todas as paginas, de 4 em 4, e o total) difere da view com o WHERE a mao.
CREATE FUNCTION pg_temp.parity(_args text, _where text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _bad text[] := '{}'; _n int; _exp text[];
BEGIN
  FOREACH _n IN ARRAY ARRAY[1, 3, 7, 9, 15, 16, 17, 18, 20] LOOP
    _exp := pg_temp.view_where(_n, _where);
    IF pg_temp.pages(_n, 4, _args) IS DISTINCT FROM _exp
       OR pg_temp.cnt(_n, _args) IS DISTINCT FROM cardinality(_exp)::text THEN
      _bad := _bad || (_n::text);
    END IF;
  END LOOP;
  RETURN _bad;
END $$;
CREATE FUNCTION pg_temp.dash(_at timestamptz) RETURNS TABLE (week_start date) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY SELECT (pg_temp.run_as(15, format('SELECT to_jsonb(d.week_start) FROM public.dashboard_summary(%L) d', _at)) #>> '{}')::date;
END $$;
-- Pessoas cuja cell_visible difere de "a celula esta na cells_view" (RN-16).
CREATE FUNCTION pg_temp.vis_diff() RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _bad text[] := '{}'; _n int; _v jsonb;
BEGIN
  FOREACH _n IN ARRAY ARRAY[1, 3, 7, 9, 15, 16, 17, 18, 20] LOOP
    _v := pg_temp.run_as(_n, 'SELECT coalesce(jsonb_agg(v.id), ''[]'') FROM public.cell_reports_view v
           WHERE v.cell_visible IS DISTINCT FROM EXISTS (SELECT 1 FROM public.cells_view c WHERE c.id = v.cell_id)');
    IF _v <> '[]'::jsonb THEN _bad := _bad || (_n::text); END IF;
  END LOOP;
  RETURN _bad;
END $$;
-- Pessoas cujas opcoes de Lider/G12 diferem dos nomes que a view mostra (RN-05, RN-06).
CREATE FUNCTION pg_temp.opts_diff(_person text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _bad text[] := '{}'; _n int; _v jsonb;
BEGIN
  FOREACH _n IN ARRAY ARRAY[1, 3, 7, 9, 15, 16, 17, 18, 20] LOOP
    _v := pg_temp.run_as(_n, format('SELECT to_jsonb((SELECT coalesce(jsonb_agg(o.name ORDER BY o.name), ''[]'') FROM public.cell_report_filter_options(%L, NULL, 100) o)
          IS NOT DISTINCT FROM (SELECT coalesce(jsonb_agg(DISTINCT x ORDER BY x), ''[]'') FROM (SELECT %s AS x FROM public.cell_reports_view v) s WHERE x IS NOT NULL))',
          _person, CASE _person WHEN 'leader' THEN 'v.snapshot_leader_name' ELSE 'v.snapshot_g12_leader_name' END));
    IF _v IS DISTINCT FROM 'true'::jsonb THEN _bad := _bad || (_n::text); END IF;
  END LOOP;
  RETURN _bad;
END $$;
CREATE FUNCTION pg_temp.nov() RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '_date_from => ''2026-10-01'', _date_to => ''2026-11-30''' $$;

-- ===========================================================================
-- 1. Paridade com filtros, por persona (RN-01, RN-02, RN-05 a RN-11, RN-13, RN-16) — 14
--    A lista e o total contra a cell_reports_view lida pela mesma persona, com o WHERE escrito a mao.
-- ===========================================================================
SELECT is(pg_temp.parity('_held => false', 'was_held = false'), '{}'::text[], 'paridade: Nao houve celula, as 9 personas');
SELECT is(pg_temp.parity('_held => true', 'was_held = true'), '{}'::text[], 'paridade: Celula realizada, as 9 personas');
SELECT is(pg_temp.parity('_types => ''{Discipulado}''', 'snapshot_cell_type = ''Discipulado'''), '{}'::text[],
  'paridade: Tipo (pelo retrato), as 9 personas');
SELECT is(pg_temp.parity('_types => ''{Macrocélula,Evangelística,Foo}''', 'snapshot_cell_type IN (''Macrocélula'', ''Evangelística'')'),
  '{}'::text[], 'paridade: dois tipos e um valor invalido ignorado');
SELECT is(pg_temp.parity(format('_cell_id => %L', pg_temp.c(1)), format('cell_id = %L', pg_temp.c(1))), '{}'::text[],
  'paridade: Celula C1, as 9 personas');
SELECT is(pg_temp.parity('_date_from => ''2026-11-10'', _date_to => ''2026-11-22''', 'date BETWEEN ''2026-11-10'' AND ''2026-11-22'''),
  '{}'::text[], 'paridade: Periodo');
SELECT is(pg_temp.parity(format('_leader_ids => %s', pg_temp.ids(7, 10, 4)),
    format('snapshot_leader_id IN (%L, %L, %L)', pg_temp.m(7), pg_temp.m(10), pg_temp.m(4))), '{}'::text[],
  'paridade: Lider (Andre, Fabio, Paula pelo retrato)');
SELECT is(pg_temp.parity(format('_g12_ids => %s', pg_temp.ids(3, 4)),
    format('snapshot_g12_leader_id IN (%L, %L)', pg_temp.m(3), pg_temp.m(4))), '{}'::text[],
  'paridade: G12 (Pedro e Paula)');
SELECT is(pg_temp.parity('_search => ''{%fe%}''', 'search_text ILIKE ''%fe%'''), '{}'::text[], 'paridade: busca');
SELECT is(pg_temp.parity('_search => ARRAY[''%fe%'', ''%ora%'']', 'search_text ILIKE ALL (ARRAY[''%fe%'', ''%ora%''])'), '{}'::text[],
  'paridade: busca com dois termos (todos)');
SELECT is(pg_temp.parity(format('_leader_ids => %s, _types => ''{Evangelística,Discipulado}'', _held => true, _date_from => ''2026-10-25''', pg_temp.ids(7, 10)),
    format('snapshot_leader_id IN (%L, %L) AND snapshot_cell_type IN (''Evangelística'', ''Discipulado'') AND was_held AND date >= ''2026-10-25''',
           pg_temp.m(7), pg_temp.m(10))), '{}'::text[],
  'paridade: combinacao de cinco filtros');

SELECT is(pg_temp.vis_diff(), '{}'::text[], 'RN-16: cell_visible = "a celula esta na cells_view", para as 9 personas e todos os relatorios');
SELECT is(pg_temp.opts_diff('leader'), '{}'::text[], 'RN-05: opcoes de Lider = lideres registrados dos relatorios visiveis, 9 personas');
SELECT is(pg_temp.opts_diff('g12'), '{}'::text[], 'RN-06: opcoes de G12 = G12 dos relatorios visiveis, 9 personas');

-- ===========================================================================
-- 2. Paginacao com filtros e empates, teto de 100 (RN-13) — 11
--    130 relatorios na mesma data e horario (130 celulas, de Ester), metade com tipo e situacao diferentes.
--    Inclui as opcoes de Hugo e de Ester.
-- ===========================================================================
SET LOCAL session_replication_role = replica;
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
SELECT ('d2120000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid, pg_temp.m(18), pg_temp.m(19), pg_temp.m(18),
       'Evangelística', 'Quarta', '10:00'
  FROM generate_series(1, 130) n;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, reason_not_held, offering,
                                 snapshot_leader_id, snapshot_timothy_id, snapshot_host_id, snapshot_cell_type)
SELECT ('e2120000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid, ('d2120000-0000-0000-0002-' || lpad(n::text, 12, '0'))::uuid,
       '2026-08-05', '10:00', n % 2 = 1, CASE WHEN n % 2 = 1 THEN 'Empate' END, CASE WHEN n % 2 = 0 THEN 'Chuva' END,
       CASE WHEN n % 2 = 1 THEN 10 END, pg_temp.m(18), pg_temp.m(19), pg_temp.m(18),
       CASE WHEN n % 3 = 0 THEN 'Discipulado' ELSE 'Evangelística' END
  FROM generate_series(1, 130) n;
SET LOCAL session_replication_role = origin;
CREATE FUNCTION pg_temp.tie_ids(_where text) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(('e2120000-0000-0000-0002-' || lpad(n::text, 12, '0')) ORDER BY ('e2120000-0000-0000-0002-' || lpad(n::text, 12, '0')))
    FROM generate_series(1, 130) n WHERE (CASE _where WHEN 'all' THEN true WHEN 'held' THEN n % 2 = 1
                                                      WHEN 'notheld' THEN n % 2 = 0 WHEN 'disc' THEN n % 3 = 0
                                                      WHEN 'disc_held' THEN n % 3 = 0 AND n % 2 = 1 END) $$;
SELECT is(pg_temp.pages(15, 7, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'''), pg_temp.tie_ids('all'),
  'RN-13: 130 empates, de 7 em 7: cada um uma vez, por id (Rita)');
SELECT is(pg_temp.pages(18, 50, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'''), pg_temp.tie_ids('all'),
  'RN-13: os mesmos 130, de 50 em 50, para Ester (so o que e dela)');
SELECT is(pg_temp.pages(15, 9, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'', _held => false'), pg_temp.tie_ids('notheld'),
  'RN-13: empates com filtro (Nao houve celula): mesma ordem relativa');
SELECT is(pg_temp.pages(15, 6, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'', _held => true, _types => ''{Discipulado}'''), pg_temp.tie_ids('disc_held'),
  'RN-13: empates com Tipo e Situacao juntos');
SELECT is(cardinality(pg_temp.list(15, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'', _limit => 1000')), 100,
  'DA-1: _limit 1000 vira 100');
SELECT is(cardinality(pg_temp.list(15, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'', _limit => 100, _offset => 100')), 30,
  'RN-13: a pagina alem de 100 traz os 30 restantes');
SELECT is(pg_temp.cnt(18, '_date_from => ''2026-08-05'', _date_to => ''2026-08-05'', _types => ''{Discipulado}'''), '43',
  'RN-03: total exato com filtro para Ester (43 dos 130 sao Discipulado)');

SELECT is(pg_temp.opts(17, 'leader'), ARRAY[]::text[], 'RN-05: Hugo (sem funcao, sem relatorio): nenhuma opcao de Lider');
SELECT is(pg_temp.opts(18, 'leader'), ARRAY['Ester'], 'RN-05: Ester: so ela, que e lider registrada dos relatorios dela (sem nivel: sem topo)');
SELECT is(pg_temp.opts(18, 'g12'), ARRAY[]::text[], 'RN-06: Ester sem liderança nao tem G12: nenhuma opcao');
SELECT is(pg_temp.opts(15, 'leader', ', _limit => 1000')::text[] = pg_temp.opts(15, 'leader', ', _limit => 100'), true, 'DA-4: _limit das opcoes e limitado a 100');

-- ===========================================================================
-- 3. server_weeks (RN-10, RN-18) — 9
-- ===========================================================================
SELECT is((SELECT array_agg(t ORDER BY t) FROM (
    SELECT g AS t FROM generate_series('2026-11-28 20:00 America/Sao_Paulo'::timestamptz, '2026-11-29 04:00 America/Sao_Paulo'::timestamptz, interval '15 minutes') g) s
   WHERE (SELECT this_week_start FROM public.server_weeks(s.t)) IS DISTINCT FROM
         (SELECT d.week_start FROM pg_temp.dash(s.t) d)),
  NULL, 'RN-18: server_weeks = dashboard_summary(_at).week_start a cada 15 min na virada de sabado para domingo');
SELECT is((SELECT array_agg(t ORDER BY t) FROM (
    SELECT g AS t FROM generate_series('2026-12-30 00:00+00'::timestamptz, '2027-01-05 00:00+00'::timestamptz, interval '1 hour') g) s
   WHERE (SELECT this_week_start FROM public.server_weeks(s.t)) IS DISTINCT FROM
         (SELECT d.week_start FROM pg_temp.dash(s.t) d)),
  NULL, 'RN-18: igual ao Dashboard de hora em hora na virada de ano');
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks(pg_temp.br('2027-01-03 00:00:00')) w),
  '{"today": "2027-01-03", "this_week_start": "2027-01-03", "this_week_end": "2027-01-09", "last_week_start": "2026-12-27", "last_week_end": "2027-01-02", "week_before_last_start": "2026-12-20", "week_before_last_end": "2026-12-26"}'::jsonb,
  'RN-10: domingo 00:00:00 em Brasilia, na virada de ano');
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks(pg_temp.br('2026-12-31 23:59:59')) w),
  '{"today": "2026-12-31", "this_week_start": "2026-12-27", "this_week_end": "2027-01-02", "last_week_start": "2026-12-20", "last_week_end": "2026-12-26", "week_before_last_start": "2026-12-13", "week_before_last_end": "2026-12-19"}'::jsonb,
  'RN-10: quinta 31/12 23:59:59 em Brasilia');
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks(pg_temp.br('2028-02-29 12:00:00')) w),
  '{"today": "2028-02-29", "this_week_start": "2028-02-27", "this_week_end": "2028-03-04", "last_week_start": "2028-02-20", "last_week_end": "2028-02-26", "week_before_last_start": "2028-02-13", "week_before_last_end": "2028-02-19"}'::jsonb,
  'RN-10: 29/02/2028 (bissexto)');
SELECT is((SELECT count(*)::int FROM generate_series('2026-01-01 12:00+00'::timestamptz, '2028-01-01 12:00+00'::timestamptz, interval '1 day') g,
                LATERAL public.server_weeks(g) w
            WHERE extract(dow FROM w.this_week_start) <> 0 OR w.this_week_end <> w.this_week_start + 6
               OR w.last_week_end + 1 <> w.this_week_start OR w.week_before_last_end + 1 <> w.last_week_start
               OR w.last_week_start + 6 <> w.last_week_end OR w.week_before_last_start + 6 <> w.week_before_last_end
               OR w.today NOT BETWEEN w.this_week_start AND w.this_week_end),
  0, 'RN-10: por dois anos, as tres semanas comecam no domingo, sao contiguas e hoje cai na atual');
SET LOCAL timezone = 'Pacific/Kiritimati';
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks('2026-11-29 02:59:59+00') w) ->> 'this_week_start', '2026-11-22',
  'RN-10: timezone de sessao UTC+14 nao muda a semana (sabado 23:59:59 em Brasilia)');
SET LOCAL timezone = 'America/Los_Angeles';
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks('2026-11-29 03:00:00+00') w) ->> 'this_week_start', '2026-11-29',
  'RN-10: timezone de sessao UTC-8, domingo 00:00:00 em Brasilia');
RESET timezone;
SELECT is((SELECT to_jsonb(w) FROM public.server_weeks(NULL) w) ->> 'today', (SELECT public.sp_today())::text,
  'DA-10: _at nulo vale o relogio do servidor');

-- ===========================================================================
-- 4. Relatorio excluido: nunca aparece, nem nas opcoes (RN-03, RN-05, RN-06, RN-08) — 5
--    R11 (excluido): lider registrado Tiago, em C8, 01/11/2026.
-- ===========================================================================
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering,
                                 snapshot_leader_id, snapshot_timothy_id, snapshot_host_id, snapshot_cell_type, deleted_at)
VALUES (pg_temp.r(11), pg_temp.c(8), '2026-11-01', '16:00', true, 'Excluido E212', 5,
        pg_temp.m(5), pg_temp.m(19), pg_temp.m(18), 'Evangelística', now());
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.cnt(15, format('_cell_id => %L', pg_temp.c(8))), '0', 'RN-03: celula so com relatorio excluido: total zero para Rita');
SELECT is(pg_temp.cnt(15, format('_leader_ids => %s', pg_temp.ids(5))), '0', 'RN-05: o lider do relatorio excluido nao filtra nada');
SELECT ok(NOT 'Tiago (1)' = ANY (pg_temp.opts(15, 'leader')) AND NOT 'Tiago' = ANY (pg_temp.opts(15, 'g12')),
  'RN-05/RN-06: quem so e lider/G12 de relatorio excluido nao e opcao (Rita)');
SELECT is(pg_temp.run_as(15, format('SELECT to_jsonb(count(*)) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(11))), '0'::jsonb,
  'RN-16: a consulta por id do excluido: nenhuma linha');
SELECT is(pg_temp.run_as(15, format('SELECT to_jsonb(count(*)) FROM public.cell_report_participants_view WHERE report_id = %L', pg_temp.r(11))), '0'::jsonb,
  'RN-17: sem participantes do excluido');

-- ===========================================================================
-- 5. Celula inativa e celula excluida (RN-03, RN-08, RN-16) — 8
-- ===========================================================================
SELECT is(pg_temp.list(3, pg_temp.nov()), ARRAY['R9', 'R6', 'R1', 'R2', 'R4', 'R5'], 'base: Pedro, de outubro a novembro');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(1);
SELECT is(pg_temp.list(3, pg_temp.nov()), ARRAY['R9', 'R6', 'R1', 'R2', 'R4', 'R5'], 'RN-03: C1 inativa: os relatorios continuam na lista');
SELECT is(pg_temp.list(3, format('_cell_id => %L', pg_temp.c(1))), ARRAY['R1', 'R2', 'R4', 'R5'], 'RN-08: o filtro Celula da inativa funciona');
SELECT is(pg_temp.run_as(3, format('SELECT to_jsonb(cell_visible) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1))), 'true'::jsonb,
  'RN-16: celula inativa continua visivel (cell_visible)');
SET LOCAL session_replication_role = replica;
UPDATE public.cells SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.c(1);
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.list(3, pg_temp.nov()), ARRAY['R9', 'R6', 'R1', 'R2', 'R4', 'R5'], 'RN-03: C1 excluida: os relatorios continuam na lista (Pedro)');
SELECT is(pg_temp.cnt(15, format('_cell_id => %L', pg_temp.c(1))), '4', 'RN-03/RN-08: C1 excluida: o filtro Celula traz os 4 (Rita), sem o R3 excluido');
SELECT is(pg_temp.run_as(3, format('SELECT to_jsonb(cell_visible) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1))), 'false'::jsonb,
  'RN-16: celula excluida: cell_visible falso');
SELECT is(pg_temp.pages(3, 2, pg_temp.nov()), ARRAY['R9', 'R6', 'R1', 'R2', 'R4', 'R5'] , 'RN-13: as paginas de 2 em 2 batem com a celula excluida');
SET LOCAL session_replication_role = replica;
UPDATE public.cells SET deleted_at = NULL, deleted_by = NULL WHERE id = pg_temp.c(1);
SET LOCAL session_replication_role = origin;
UPDATE public.cells SET is_active = true WHERE id = pg_temp.c(1);

-- ===========================================================================
-- 6. Retrato x celula atual (RN-04, RN-05, RN-06, RN-16) — 11
--    C1 passa a ser liderada por Diego (G12 Tiago); os relatorios continuam com Andre e Pedro.
-- ===========================================================================
UPDATE public.cells SET leader_id = pg_temp.m(16) WHERE id = pg_temp.c(1);
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(16))), ARRAY[]::text[], 'RN-05: Diego, lider atual de C1, nao filtra relatorio antigo');
SELECT is(pg_temp.list(15, format('_leader_ids => %s', pg_temp.ids(7))), ARRAY['R1', 'R2', 'R4'], 'RN-05: Andre continua o lider registrado');
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(5)) || ', ' || pg_temp.nov()), ARRAY[]::text[],
  'RN-06: o G12 atual da celula (Tiago) nao puxa relatorios do retrato (outubro e novembro)');
SELECT is(pg_temp.list(15, format('_g12_ids => %s', pg_temp.ids(3))), ARRAY['R6', 'R1', 'R2', 'R4', 'R5'], 'RN-06: o G12 do retrato (Pedro) segue');
SELECT is(pg_temp.list(16, pg_temp.nov()), ARRAY['R10', 'R8'], 'RN-04: Diego, lider atual, nao ve os relatorios antigos de C1');
SELECT is(pg_temp.run_as(16, format('SELECT to_jsonb(count(*)) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1))), '0'::jsonb,
  'RN-04/RN-16: o R1 por id: nenhuma linha para Diego');
SELECT ok(NOT 'Diego (2)' = ANY (pg_temp.opts(15, 'leader')) AND NOT 'Diego' = ANY (pg_temp.opts(15, 'g12')),
  'RN-05: o lider atual sem relatorio proprio nao e opcao');
SELECT is(pg_temp.run_as(15, format('SELECT jsonb_build_object(''cell'', split_part(cell_leader_name, '' '', 1), ''snap'', split_part(snapshot_leader_name, '' '', 1)) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1))),
  '{"cell": "Diego", "snap": "André"}'::jsonb, 'RN-16: a view traz a celula atual e o retrato lado a lado');

SELECT is(pg_temp.vis_diff(), '{}'::text[], 'RN-16: cell_visible segue a cells_view tambem depois da troca de lider da celula (9 personas)');
SELECT is(pg_temp.opts_diff('leader'), '{}'::text[], 'RN-05: opcoes de Lider batem com a view depois da troca de lider da celula');
SELECT is(pg_temp.opts_diff('g12'), '{}'::text[], 'RN-06: opcoes de G12 batem com a view depois da troca de lider da celula');

-- ===========================================================================
-- 7. Entradas maliciosas, nulas ou extremas pela API (DA-1 a DA-3, risco 1) — 18
-- ===========================================================================
CREATE FUNCTION pg_temp.timed(_n int, _sql text, OUT r jsonb, OUT ms numeric) LANGUAGE plpgsql AS $$
DECLARE _t timestamptz := clock_timestamp();
BEGIN
  r := pg_temp.run_as(_n, _sql);
  ms := extract(epoch FROM clock_timestamp() - _t) * 1000;
END $$;
SELECT is(pg_temp.list(15, '_search => ARRAY[NULL, '''', NULL]::text[], ' || pg_temp.nov()), pg_temp.view_where(15, 'date BETWEEN ''2026-10-01'' AND ''2026-11-30'''),
  'DA-1: busca so com nulos e vazios = sem filtro');
SELECT is(pg_temp.list(15, '_search => ''{}''::text[], ' || pg_temp.nov()), pg_temp.view_where(15, 'date BETWEEN ''2026-10-01'' AND ''2026-11-30'''),
  'DA-1: busca vazia = sem filtro');
SELECT is(pg_temp.list(15, '_types => ARRAY[NULL, ''Foo'', ''Macrocélula'']::text[]'), ARRAY['R10'], 'DA-1: tipos com nulo e invalido: so o valido vale');
SELECT is(pg_temp.list(15, '_types => ARRAY[NULL]::text[], ' || pg_temp.nov()), pg_temp.view_where(15, 'date BETWEEN ''2026-10-01'' AND ''2026-11-30'''),
  'DA-1: so nulo nos tipos = sem filtro');
SELECT is(pg_temp.cnt(15, '_leader_ids => (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 10000)), _date_from => ''2026-10-01'''), '0',
  'DA-3: 10 mil ids desconhecidos no Lider: zero e sem erro');
SELECT is(pg_temp.cnt(15, format('_leader_ids => (SELECT array_agg(u) FROM (SELECT gen_random_uuid() u FROM generate_series(1, 20) UNION ALL SELECT %L::uuid) x), _date_from => ''2026-10-01''', pg_temp.m(7))),
  '0', 'DA-3: o id real depois dos 10 primeiros nao conta');
SELECT is(pg_temp.cnt(15, '_date_from => ''infinity'''), '0', 'RN-09: De = infinity: zero, sem erro');
SELECT is(pg_temp.cnt(15, '_date_from => ''-infinity'', _date_to => ''infinity'''), pg_temp.cnt(15), 'RN-09: -infinity ate infinity = tudo');
SELECT is(pg_temp.list(15, '_limit => NULL')::text[] = pg_temp.list(15, '_limit => 25'), true, 'DA-1: _limit nulo vale 25');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list(_limit => -50)'), '1'::jsonb, 'DA-1: _limit negativo vira 1');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list(_offset => 2147483647, _limit => 100)'), '0'::jsonb,
  'DA-1: _offset gigante: pagina vazia sem erro');
SELECT ok((pg_temp.timed(15, 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list(_search => ARRAY[repeat(''%a'', 20000) || ''%'', repeat(''_'', 50000)])')).ms < 5000,
  'risco 1: busca com 20 mil curingas e 50 mil sublinhados responde em menos de 5 s');
SELECT ok(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list(_search => ARRAY[E''%\\''])') ->> 'error' IN ('22025'),
  'risco 1 (registro): padrao terminado em barra volta 22025 (a tela sempre fecha com %), sem efeito');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_options(NULL)'), '0'::jsonb, 'opcoes: _person nulo = vazio');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_options(''leader'', ARRAY[NULL, ''''], -3, -9)'), '1'::jsonb,
  'opcoes: busca so de nulos, _limit negativo (1) e _offset negativo (0): uma opcao');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_options(''technician'')') ->> 'error', '22P02',
  'opcoes: _person fora do enum: 22P02');
SELECT is(pg_temp.run_as(15, 'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_names(''leader'', ARRAY[NULL]::uuid[])'), '0'::jsonb, 'nomes: so nulo = vazio');
SELECT is(pg_temp.run_as(15, format('SELECT to_jsonb(count(*)) FROM public.cell_report_filter_names(''leader'', (SELECT array_agg(%L::uuid) || array_agg(gen_random_uuid()) FROM generate_series(1, 10000)))', pg_temp.m(7))), '1'::jsonb,
  'nomes: 10 mil ids (um repetido): o id valido, uma vez');

-- ===========================================================================
-- 8. save_cell_report: sem id e com id sem mudanca (migration 2, DT-10) — 8
-- ===========================================================================
CREATE TEMP TABLE r_before AS SELECT count(*) AS n, max(updated_at) AS u FROM public.cell_reports;
SELECT is(pg_temp.api(15, $$SELECT to_jsonb(r) FROM public.save_cell_report(NULL, '{}') r$$), '{"error": "22023", "code": "report_id_required"}'::jsonb,
  'DT-10: Administrador, NULL e corpo vazio: report_id_required');
SELECT is(pg_temp.api(17, $$SELECT to_jsonb(r) FROM public.save_cell_report(NULL, '{"theme": "x"}') r$$), '{"error": "22023", "code": "report_id_required"}'::jsonb,
  'DT-10: Hugo (sem funcao): report_id_required, sem vazar nada');
SELECT is(pg_temp.api(15, format($q$SELECT to_jsonb(r) FROM public.save_cell_report(NULL,
    jsonb_build_object('cell_id', %L::uuid, 'date', public.sp_today(), 'time', '00:00', 'theme', 'Novo', 'offering', 0), ARRAY[%L]::uuid[]) r$q$,
    pg_temp.c(8), pg_temp.m(19))) ->> 'code', 'report_id_required', 'DT-10: com celula, data e participantes: ainda recusa');
SELECT is((SELECT count(*) FROM public.cell_reports), (SELECT n FROM r_before), 'DT-10: nada foi gravado pelas recusas');
CREATE TEMP TABLE r1_before AS SELECT updated_at FROM public.cell_reports WHERE id = pg_temp.r(1);
SELECT is(pg_temp.api(15, format($q$SELECT to_jsonb(r) - 'report_id' FROM public.save_cell_report(%L, '{}') r$q$, pg_temp.r(1))), '{"changed": false}'::jsonb,
  'E2.05: com id e sem mudanca, changed = false');
SELECT is((SELECT updated_at FROM public.cell_reports WHERE id = pg_temp.r(1)), (SELECT updated_at FROM r1_before), 'E2.05: sem mudanca, o updated_at nao anda');
SELECT is(pg_temp.api(15, format($q$SELECT to_jsonb(r) FROM public.save_cell_report(%L, '{}') r$q$, pg_temp.r(3))) ->> 'code', 'not_found_or_deleted',
  'E2.01: o id de um relatorio excluido: not_found_or_deleted');
SELECT is(pg_temp.api(16, format($q$SELECT to_jsonb(r) FROM public.save_cell_report(%L, '{}') r$q$, pg_temp.r(1))) ->> 'code', 'not_found_or_deleted',
  'RN-04: Diego nao ve R1: not_found_or_deleted, como se nao existisse');

-- ===========================================================================
-- 9. Portao do E2.03 e papeis da API nas cinco funcoes (RN-09 do E2.03; risco 5) — 14
-- ===========================================================================
CREATE TEMP TABLE gate_calls (nm text, q text);
INSERT INTO gate_calls VALUES
  ('list',    'SELECT to_jsonb(count(*)) FROM public.cell_reports_list()'),
  ('count',   'SELECT to_jsonb(public.cell_reports_list_count())'),
  ('options', 'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_options(''leader'')'),
  ('names',   'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_names(''leader'', ARRAY[gen_random_uuid()])'),
  ('view',    'SELECT to_jsonb(count(*)) FROM public.cell_reports_view');
SELECT is((SELECT array_agg(nm ORDER BY nm) FROM gate_calls WHERE pg_temp.api(3, q, 1) ->> 'error' IS NOT NULL), NULL,
  'controle: Pedro com sessao viva chama as cinco sem erro');
SELECT is((SELECT array_agg(nm ORDER BY nm) FROM gate_calls WHERE pg_temp.api(3, q, 2) IS DISTINCT FROM
            jsonb_build_object('error', '42501', 'code', 'session_ended')), NULL,
  'RN-16 do E2.03: sessao apagada: as cinco respondem 42501 session_ended');
SELECT private.set_must_change(pg_temp.u(9), 'reset', now() + interval '7 days');
SELECT is((SELECT array_agg(nm ORDER BY nm) FROM gate_calls WHERE pg_temp.api(9, q, 1) IS DISTINCT FROM
            jsonb_build_object('error', '42501', 'code', 'password_change_required')), NULL,
  'RN-09 do E2.03: Caio com a marca de troca de senha: as cinco respondem 42501 password_change_required');
SELECT is((SELECT array_agg(nm ORDER BY nm) FROM gate_calls WHERE pg_temp.api(9, q, 0) IS DISTINCT FROM
            jsonb_build_object('error', '42501', 'code', 'password_change_required')), NULL,
  'DA-9 do E2.03: token sem session_id, mesma recusa pela marca');
SELECT is(pg_temp.api(9, 'SELECT to_jsonb(w) FROM public.server_weeks() w', 1) ->> 'this_week_start' IS NOT NULL, true,
  'E2.03: server_weeks (so relogio) responde mesmo com a marca');
SELECT is((SELECT array_agg(nm ORDER BY nm) FROM gate_calls WHERE pg_temp.as_role('anon', q) IS DISTINCT FROM '{"error": "42501"}'::jsonb), NULL,
  'privilegios: anon recebe 42501 nas cinco (funcoes e view)');
SELECT is((SELECT array_agg(nm ORDER BY nm) FROM gate_calls WHERE nm <> 'view' AND pg_temp.as_role('service_role', q) IS DISTINCT FROM '{"error": "42501"}'::jsonb), NULL,
  'privilegios: service_role sem EXECUTE nas quatro RPCs');
SELECT is(pg_temp.as_role('anon', 'SELECT to_jsonb(w) FROM public.server_weeks() w'), '{"error": "42501"}'::jsonb, 'privilegios: anon sem EXECUTE na server_weeks');
SELECT is(pg_temp.as_role('authenticated', 'SELECT to_jsonb(public.cell_reports_list_count())'), '0'::jsonb,
  'sem usuario no token (auth.uid() nulo): total zero, nada vaza');
SELECT is(pg_temp.as_role('authenticated', 'SELECT to_jsonb(count(*)) FROM public.cell_report_filter_options(''leader'')'), '0'::jsonb,
  'sem usuario no token: opcoes vazias');
SELECT is(pg_temp.as_role('authenticated', 'SELECT to_jsonb(count(*)) FROM public.cell_reports_list()'), '0'::jsonb,
  'sem usuario no token: lista vazia');

SELECT * FROM finish();
ROLLBACK;

