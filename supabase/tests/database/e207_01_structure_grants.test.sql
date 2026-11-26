-- E2.07 (PR 1): estrutura e privilégios das migrations e207_01_cell_link e e207_02_member_list, a
-- normalização dos filtros (DA-1, DA-2, DA-6), a recusa pelo tipo (22P02) e a injeção (risco 1).
-- Spec: docs/specs/e2-07-filtros-membros.md ("Modelo de dados e migrations", "A lista (migration 2)",
-- "Contratos", "Verificações obrigatórias (para o QA)").
-- Autocontido, sem massa de membros (a normalização da Liderança, que lê a members_view, está no
-- e207_02_list). Termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(47);

CREATE FUNCTION pg_temp.cols(_rel regclass) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
   WHERE a.attrelid = _rel AND a.attnum > 0 AND NOT a.attisdropped $$;

-- Assinaturas
CREATE TEMP TABLE sig (k text PRIMARY KEY, p regprocedure);
INSERT INTO sig VALUES
  ('list',  'public.members_list(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date, integer, integer)'),
  ('count', 'public.members_list_count(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date)'),
  ('links', 'public.cell_links_or_none(public.member_cell_link[], integer, boolean)'),
  ('day',   'public.sp_day_start(date)'),
  ('key',   'private.text_key(text)'),
  ('norm',  'private.member_filter_normalize(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date)'),
  ('sql',   'private.member_filter_sql(private.member_filter)');
CREATE FUNCTION pg_temp.p(_k text) RETURNS regprocedure LANGUAGE sql STABLE AS $$ SELECT p FROM sig WHERE k = _k $$;

-- ===========================================================================
-- 1. Tipos
-- ===========================================================================
SELECT is(enum_range(NULL::public.member_cell_link)::text, '{leader,timothy,host,attendee,none}',
  'enum member_cell_link com os rótulos da URL, na ordem da RN-10 (AQ-1)');
SELECT is(enum_range(NULL::public.member_leadership_status)::text, '{with_leader,no_leadership,pastor}',
  'enum member_leadership_status com as três situações do E2.04 (RN-08, AQ-1)');
SELECT has_type('private', 'member_filter', 'tipo interno private.member_filter');

-- ===========================================================================
-- 2. members_view (DA-7, DT-15)
-- ===========================================================================
SELECT is((pg_temp.cols('public.members_view'))[array_length(pg_temp.cols('public.members_view'), 1) - 1 :],
  ARRAY['leadership_status', 'cell_links'], 'members_view: leadership_status e cell_links no fim');
SELECT is(pg_temp.cols('public.members_view') && ARRAY['is_cell_leader', 'is_cell_timothy', 'is_cell_host', 'attended_last_30_days'],
  false, 'members_view: as quatro colunas de vínculo do E1.08 saíram');
SELECT is((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.members_view'::regclass AND attname = 'cell_links'),
  'member_cell_link[]', 'members_view.cell_links é member_cell_link[]');
SELECT is((SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'public.members_view'::regclass AND attname = 'leadership_status'),
  'member_leadership_status', 'members_view.leadership_status é member_leadership_status');
SELECT is((SELECT reloptions FROM pg_class WHERE oid = 'public.members_view'::regclass),
  ARRAY['security_barrier=true', 'security_invoker=false'], 'members_view: security_barrier, sem security_invoker (armadilha do E1.08)');
SELECT is((SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'public.members_view'::regclass), 'postgres', 'members_view: dono postgres');
SELECT ok(has_table_privilege('authenticated', 'public.members_view', 'SELECT'), 'members_view: authenticated lê');
SELECT ok(NOT has_table_privilege('authenticated', 'public.members_view', 'INSERT')
      AND NOT has_table_privilege('authenticated', 'public.members_view', 'UPDATE')
      AND NOT has_table_privilege('authenticated', 'public.members_view', 'DELETE')
      AND NOT has_table_privilege('authenticated', 'public.members_view', 'TRUNCATE'),
  'members_view: authenticated não escreve');
SELECT ok(NOT has_table_privilege('anon', 'public.members_view', 'SELECT'), 'members_view: anon não lê');
SELECT ok(has_table_privilege('service_role', 'public.members_view', 'SELECT'), 'members_view: service_role lê, como antes');
SELECT ok(pg_get_viewdef('public.members_view'::regclass) ~ 'viewer_ministry_member_ids'
      AND pg_get_viewdef('public.members_view'::regclass) ~ 'deleted_at IS NULL',
  'members_view: o mesmo WHERE (predicado canônico do E2.02 e excluídos fora)');
SELECT is((SELECT array_agg(n.nspname || '.' || p.proname ORDER BY 1) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public', 'private')
              AND p.prosrc ~ '\m(is_cell_leader|is_cell_timothy|is_cell_host|attended_last_30_days)\M'),
  NULL, 'nenhum corpo de função cita as colunas de vínculo que saíram');
SELECT ok(pg_get_functiondef('public.dashboard_summary(timestamptz)'::regprocedure) ~ 'leadership_status'
      AND pg_get_functiondef('public.dashboard_summary(timestamptz)'::regprocedure) ~ 'cell_links',
  'dashboard_summary lê leadership_status e cell_links (RN-11, RN-17)');
SELECT is((SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'members_created_at_idx'),
  'CREATE INDEX members_created_at_idx ON public.members USING btree (created_at) WHERE (deleted_at IS NULL)',
  'índice parcial members_created_at_idx (RN-12, DT-10)');

-- ===========================================================================
-- 3. Funções: segurança e privilégios
-- ===========================================================================
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = pg_temp.p('list')),
  'members_list: definer com search_path fixo');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = pg_temp.p('count')),
  'members_list_count: definer com search_path fixo');
SELECT is((SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_function_privilege(r, pg_temp.p('list'), 'EXECUTE')), ARRAY['authenticated'],
  'members_list: EXECUTE só para authenticated');
SELECT is((SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_function_privilege(r, pg_temp.p('count'), 'EXECUTE')), ARRAY['authenticated'],
  'members_list_count: EXECUTE só para authenticated');
SELECT is((SELECT prorettype::regtype::text FROM pg_proc WHERE oid = pg_temp.p('list')), 'members_view',
  'members_list devolve o tipo da members_view (a cadeia não sai)');
SELECT ok((SELECT proretset FROM pg_proc WHERE oid = pg_temp.p('list')), 'members_list devolve um conjunto');
SELECT is((SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_function_privilege(r, pg_temp.p('links'), 'EXECUTE')), ARRAY['authenticated', 'service_role'],
  'cell_links_or_none: EXECUTE para authenticated e service_role (a view a chama)');
SELECT is((SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_function_privilege(r, pg_temp.p('day'), 'EXECUTE')), ARRAY['authenticated', 'service_role'],
  'sp_day_start: EXECUTE para authenticated e service_role');
SELECT ok((SELECT bool_and(NOT prosecdef AND provolatile = 'i') FROM pg_proc WHERE oid IN (pg_temp.p('links'), pg_temp.p('day'))),
  'cell_links_or_none e sp_day_start: imutáveis e INVOKER (lista fechada do portão do E2.03)');
SELECT is((SELECT array_agg(s.k || ':' || r ORDER BY s.k, r) FROM sig s CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE s.k IN ('key', 'norm', 'sql') AND has_function_privilege(r, s.p, 'EXECUTE')),
  NULL, 'as três internas sem EXECUTE para anon, authenticated e service_role');
SELECT ok(NOT has_schema_privilege('authenticated', 'private', 'USAGE'), 'private continua fora da API (sem USAGE para authenticated)');

-- ===========================================================================
-- 4. Funções puras
-- ===========================================================================
SELECT is(public.cell_links_or_none('{}', 0, false), '{none}'::public.member_cell_link[], 'RN-10 e: sem categoria, sem células e não pastor = {none}');
SELECT is(public.cell_links_or_none('{}', 1, false), '{}'::public.member_cell_link[], 'RN-10: sem categoria e com célula ativa abaixo = nenhuma');
SELECT is(public.cell_links_or_none('{}', 0, true), '{}'::public.member_cell_link[], 'P-FIL-10: pastor nunca é "Sem vínculo"');
SELECT is(public.cell_links_or_none('{leader,attendee}', 1, false), '{leader,attendee}'::public.member_cell_link[], 'RN-10: as categorias se somam');
SELECT is(public.cell_links_or_none(NULL, NULL, NULL), '{none}'::public.member_cell_link[], 'nulos valem como vazio e zero');
SELECT is(public.sp_day_start('2026-11-21'), '2026-11-21 03:00:00+00'::timestamptz, 'RN-12: o dia 21/11 começa às 03:00 UTC (00:00 de Brasília)');
SELECT ok('2026-11-22 02:30:00+00'::timestamptz < public.sp_day_start('2026-11-22'),
  'RN-12: 23:30 de 21/11 em Brasília (02:30 UTC de 22/11) é de 21/11');
SELECT is(private.text_key(E'  São\t  JOÃO \n do Sul '), 'sao joao do sul', 'DA-6: sem acento, minúsculas, espaços (tabulação, quebra) como um, sem as pontas');

-- ===========================================================================
-- 5. Normalização (DA-1) e o WHERE (só fragmentos fixos)
-- ===========================================================================
CREATE FUNCTION pg_temp.norm(_search text[] DEFAULT NULL, _neighborhood text DEFAULT NULL, _city text DEFAULT NULL,
  _leadership public.member_leadership_status[] DEFAULT NULL, _levels integer[] DEFAULT NULL,
  _cell_links public.member_cell_link[] DEFAULT NULL, _from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS private.member_filter LANGUAGE sql STABLE AS $$
  SELECT private.member_filter_normalize(_search, NULL, _neighborhood, _city, NULL, _leadership, NULL, _levels,
                                         _cell_links, _from, _to) $$;

SELECT is((pg_temp.norm(_search => ARRAY['', NULL, '%a%', '%b%', '%c%', '%d%', '%e%', '%f%'])).search,
  ARRAY['%a%', '%b%', '%c%', '%d%', '%e%'], 'DA-1: a busca usa os 5 primeiros padrões, sem os vazios');
SELECT is((pg_temp.norm(_neighborhood => repeat('a', 99) || 'bc')).neighborhood, repeat('a', 99) || 'b',
  'DA-1: bairro com os 100 primeiros caracteres');
SELECT is((pg_temp.norm(_city => E'   \t ')).city, NULL, 'RN-06: cidade só com espaços não filtra');
SELECT is((pg_temp.norm(_levels => ARRAY[7, -1, NULL, 2, 2, 5])).levels, ARRAY[2], 'DA-1: nível fora de 0 a 5 é ignorado; repetidos contam uma vez');
SELECT is((pg_temp.norm(_levels => ARRAY[7, 5])).level_5_plus, true, 'RN-09: 5 liga "5 ou mais"');
SELECT is((pg_temp.norm(_levels => ARRAY[7, 9])), pg_temp.norm(), 'DA-1: só níveis inválidos = sem filtro de nível');
SELECT is(private.member_filter_sql(pg_temp.norm(_from => '2026-11-25', _to => '2026-11-20')), 'true',
  'DA-4: datas invertidas desligam o filtro de data inteiro');
SELECT is(private.member_filter_sql(pg_temp.norm()), 'true', 'sem filtros, o WHERE é só "true" (a lista de hoje)');
SELECT is(private.member_filter_sql(pg_temp.norm(_neighborhood => $$x'); DROP TABLE public.members; --$$,
                                                 _search => ARRAY[$$%'; DELETE FROM public.members; --%$$])),
  'true AND v.search_text ILIKE ALL (($1).search) AND strpos(private.text_key(v.neighborhood), ($1).neighborhood) > 0',
  'risco 1: textos maliciosos não entram no WHERE (só fragmentos fixos; os valores vão por $1)');

-- ===========================================================================
-- 6. Recusa pelo tipo (DA-1): o PostgREST manda o texto, e o cast falha antes da função
-- ===========================================================================
SELECT throws_ok($$SELECT public.members_list_count(_leadership => '{chefe}')$$, '22P02', NULL,
  'DA-1: valor fora do enum é recusado (22P02)');
SELECT throws_ok($$SELECT public.members_list_count(_leader_ids => '{xyz}')$$, '22P02', NULL,
  'DA-1: uuid malformado é recusado (22P02)');

SELECT * FROM finish();
ROLLBACK;
