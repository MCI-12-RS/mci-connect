-- E2.10 (PR 1, migration 1 de 2) — A lista de Células por RPC, com os filtros, e os seletores de Líder
-- e G12. Ver docs/specs/e2-10-listagem-celulas.md no repositório apps-mci ("A lista (migration 1)",
-- "Os seletores (migration 1)", "Metas de tempo e índices", "Contratos"; RN-01 a RN-13, RN-21;
-- DA-1 a DA-3, DA-6 a DA-8, DA-11, DA-12; DT-01 a DT-07, DT-11, DT-12).
--
-- Conteúdo:
--   0. Guarda de pré-requisitos (E2.02, E2.05, E2.06, E2.07, E2.08 e E2.09).
--   1. Enum public.cell_filter_person ('leader', 'g12'): qual pessoa da célula o seletor oferece.
--   2. public.first_distinct_ids(uuid[], integer): "os N primeiros ids distintos", num lugar só (DA-2).
--   3. Índice cells_created_at_idx (datas de cadastro e a ordem da RN-13).
--   4. Tipo private.cell_filter, private.cell_filter_normalize e private.cell_filter_sql: os filtros
--      normalizados (DA-1) e o WHERE, só com fragmentos fixos; os valores entram por USING ($1).
--      Nunca concatene um valor no SQL dinâmico (risco 1).
--   5. public.cells_list e public.cells_list_count (definer): a página (na ordem da RN-13) e o total.
--      Leem só a cells_view, que decide quem aparece (escopo e excluídas) pelo auth.uid() também aqui
--      dentro. São definer só para chamar os auxiliares de private sem dar USAGE no schema.
--   6. public.cell_filter_options e public.cell_filter_names (invoker): as opções e os nomes do Líder
--      e do G12, só das linhas da cells_view de quem consulta (e da members_view, nos nomes).
--   7. Privilégios e pós-condições.
--
-- Nenhuma view, tabela, trigger ou política muda. Todas as funções públicas chamam o portão do E2.03
-- (viewer_member_id) antes de tudo, mesmo quando nenhuma linha chegaria a ser lida.
-- Filtro novo de Células entra em dois pontos fixos: cell_filter_normalize e cell_filter_sql.
-- A cells_view é o tipo de retorno da cells_list: um DROP VIEW exige recriar as duas RPCs.
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos. Falha cedo, sem mudar nada. Só nomes de objetos na mensagem.
-- ===========================================================================
DO $$ BEGIN
  IF to_regprocedure('private.text_key(text)') IS NULL                 -- E2.07, PR 1
     OR to_regprocedure('public.sp_day_start(date)') IS NULL           -- E2.07, PR 1
     OR to_regprocedure('public.viewer_member_id()') IS NULL           -- E2.02 / portão do E2.03
     OR to_regprocedure('public.cell_types()') IS NULL                 -- E2.08, PR 2
     OR to_regtype('public.cell_report_status') IS NULL                -- E2.09, PR 1
     OR EXISTS (SELECT 1
                  FROM unnest(ARRAY['g12_leader_id', 'g12_leader_name', 'leader_name', 'leader_g12_level',
                                    'leader_is_pastor', 'leader_gender', 'meeting_weekday',
                                    'can_submit_report', 'created_by_name', 'report_status',
                                    'report_missing_weeks', 'search_text', 'created_at']) c(col)
                 WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
                                    WHERE attrelid = 'public.cells_view'::regclass
                                      AND attname = c.col AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'E2.10: faltam pré-requisitos (PR 1 do E2.07, PR 2 do E2.08, PR 1 do E2.09 ou colunas da cells_view do E2.02, do E2.05 e do E2.06).';
  END IF;
END $$;

-- ===========================================================================
-- 1. RN-04, RN-05: qual pessoa da célula o seletor oferece
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE public.cell_filter_person AS ENUM ('leader', 'g12');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2. RN-04, DA-2: os N primeiros ids distintos, na ordem da primeira aparição, sem os nulos.
--    Pura (só o próprio argumento): fica em public com EXECUTE para authenticated, porque as funções
--    invoker a chamam. Está na lista fechada do portão (e203_06_gate).
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.first_distinct_ids(_ids uuid[], _max integer)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT ARRAY(SELECT t.x FROM unnest(_ids) WITH ORDINALITY AS t(x, i)
                WHERE t.x IS NOT NULL
                GROUP BY t.x ORDER BY min(t.i) LIMIT greatest(coalesce(_max, 0), 0))
$$;

-- ===========================================================================
-- 3. RN-11, RN-13: datas de cadastro e a ordem. As comparações de timestamptz são leakproof: o filtro
--    entra na view. Conferido em produção (tarefa 1): não havia índice em cells.created_at.
-- ===========================================================================
CREATE INDEX IF NOT EXISTS cells_created_at_idx
  ON public.cells (created_at DESC NULLS LAST, id) WHERE deleted_at IS NULL;

-- ===========================================================================
-- 4. O filtro normalizado e o WHERE
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE private.cell_filter AS (
    search          text[],                            -- padrões ILIKE (toSearchPatterns, E1.08)
    leader_ids      uuid[],                            -- até 10, na ordem da escolha (DA-2, DA-3)
    g12_ids         uuid[],
    street          text,                              -- private.text_key; nulo = sem filtro
    neighborhood    text,
    city            text,
    types           text[],                            -- valores de cell_types()
    weekdays        integer[],                         -- 0 = domingo … 6 = sábado (weekday_index)
    is_active       boolean,
    report_statuses public.cell_report_status[],       -- sem no_meeting_day
    missing_weeks   integer[],                         -- 1 a 4 (4 = "4 ou mais")
    created_from    timestamptz,                       -- início do dia "a partir de" (Brasília)
    created_until   timestamptz);                      -- início do dia seguinte ao "até" (exclusivo)
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Os valores como a tela os aplica (DA-1, DA-2, DA-6, DA-7, DA-12). INVOKER: só é chamada pelas RPCs
-- (definer).
CREATE OR REPLACE FUNCTION private.cell_filter_normalize(
  _search text[], _leader_ids uuid[], _g12_ids uuid[],
  _street text, _neighborhood text, _city text,
  _types text[], _weekdays integer[], _is_active boolean,
  _report_statuses public.cell_report_status[], _missing_weeks integer[],
  _created_from date, _created_to date)
RETURNS private.cell_filter
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _f    private.cell_filter;
  _from date;
  _to   date;
BEGIN
  -- A busca: os 5 primeiros padrões não vazios.
  _f.search := (SELECT array_agg(s.p ORDER BY s.i)
                  FROM (SELECT t.p, t.i FROM unnest(_search) WITH ORDINALITY t(p, i)
                         WHERE coalesce(t.p, '') <> '' ORDER BY t.i LIMIT 5) s);

  -- RN-04, RN-05, DA-2, DA-3: os 10 primeiros ids distintos; vazio = sem filtro. A visibilidade das
  -- pessoas não é conferida: o filtro só compara colunas das linhas visíveis da cells_view.
  _f.leader_ids   := nullif(public.first_distinct_ids(_leader_ids, 10), '{}');
  _f.g12_ids      := nullif(public.first_distinct_ids(_g12_ids, 10), '{}');

  -- RN-07: os 100 primeiros caracteres, contados antes da normalização; vazio = sem filtro.
  _f.street       := nullif(private.text_key(left(_street, 100)), '');
  _f.neighborhood := nullif(private.text_key(left(_neighborhood, 100)), '');
  _f.city         := nullif(private.text_key(left(_city, 100)), '');

  -- RN-08, RN-12: fora da lista é ignorado; sem repetidos.
  _f.types        := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_types) x
                                   WHERE x = ANY (public.cell_types())), '{}');
  _f.weekdays     := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_weekdays) x
                                   WHERE x BETWEEN 0 AND 6), '{}');
  _f.is_active    := _is_active;

  -- RN-10: no_meeting_day nunca é opção; semanas só de 1 a 4. sent_held e sent_not_held sozinhos
  -- são aceitos (DA-12).
  _f.report_statuses := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_report_statuses) x
                                      WHERE x IS NOT NULL AND x <> 'no_meeting_day'), '{}');
  _f.missing_weeks   := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_missing_weeks) x
                                      WHERE x BETWEEN 1 AND 4), '{}');

  -- RN-11, DA-7: datas invertidas desligam o filtro de data inteiro. Cada uma vale sozinha. As datas
  -- são presas entre os anos 1 e 9999 só para caberem no timestamp (o resultado é o mesmo), como na
  -- member_filter_normalize do E2.07. GREATEST e LEAST ignoram nulos, por isso o CASE.
  IF _created_from IS NULL OR _created_to IS NULL OR _created_from <= _created_to THEN
    _from := CASE WHEN _created_from IS NOT NULL
                  THEN least(greatest(_created_from, date '0001-01-01'), date '9999-12-31') END;
    _to   := CASE WHEN _created_to IS NOT NULL
                  THEN least(greatest(_created_to, date '0001-01-01'), date '9999-12-30') END;
    _f.created_from  := public.sp_day_start(_from);
    _f.created_until := public.sp_day_start(_to + 1);
  END IF;
  RETURN _f;
END
$$;

-- O WHERE, num lugar só. Só fragmentos fixos, escolhidos pela nulidade de cada campo; os valores vêm
-- de $1 (o filtro) por USING. Nunca concatene um valor aqui.
CREATE OR REPLACE FUNCTION private.cell_filter_sql(_f private.cell_filter)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws(' AND ', 'true',
    CASE WHEN _f.search IS NOT NULL THEN 'v.search_text ILIKE ALL (($1).search)' END,
    CASE WHEN _f.leader_ids IS NOT NULL THEN 'v.leader_id = ANY (($1).leader_ids)' END,
    -- RN-05: o G12 do líder (o próprio, no nível 1); pastor e sem liderança têm nulo e nunca entram.
    CASE WHEN _f.g12_ids IS NOT NULL THEN 'v.g12_leader_id = ANY (($1).g12_ids)' END,
    -- RN-07: "contém" literal (strpos não tem curinga); sem endereço, text_key(null) é nulo e fica de fora.
    CASE WHEN _f.street IS NOT NULL THEN 'strpos(private.text_key(v.street), ($1).street) > 0' END,
    CASE WHEN _f.neighborhood IS NOT NULL
         THEN 'strpos(private.text_key(v.neighborhood), ($1).neighborhood) > 0' END,
    CASE WHEN _f.city IS NOT NULL THEN 'strpos(private.text_key(v.city), ($1).city) > 0' END,
    CASE WHEN _f.types IS NOT NULL THEN 'v.type = ANY (($1).types)' END,
    CASE WHEN _f.weekdays IS NOT NULL THEN 'v.meeting_weekday = ANY (($1).weekdays)' END,
    CASE WHEN _f.is_active IS NOT NULL THEN 'v.is_active = ($1).is_active' END,
    -- RN-10: OU entre os subgrupos. A inativa (as duas nulas) e a sem dia (no_meeting_day, ignorado
    -- na normalização, e contagem nula) nunca entram: nulo não satisfaz "= ANY".
    CASE WHEN _f.report_statuses IS NOT NULL OR _f.missing_weeks IS NOT NULL THEN
      '(v.report_status = ANY (coalesce(($1).report_statuses, ''{}''))'
      || ' OR v.report_missing_weeks = ANY (coalesce(($1).missing_weeks, ''{}'')))' END,
    -- RN-11: intervalo semiaberto em instantes de Brasília; created_at nulo fica de fora.
    CASE WHEN _f.created_from IS NOT NULL THEN 'v.created_at >= ($1).created_from' END,
    CASE WHEN _f.created_until IS NOT NULL THEN 'v.created_at < ($1).created_until' END)
$$;

-- ===========================================================================
-- 5. A página e o total
-- ===========================================================================
-- A página, na ordem da RN-13 (created_at DESC NULLS LAST, id). Em duas etapas (DT-03): (1) os ids da
-- página, calculando só as chaves da ordem e as colunas dos filtros ativos; (2) as linhas por
-- "id = ANY", que é leakproof, entra na view e usa cells_pkey. O front não chama .order(): o
-- PostgREST lê a função na ordem em que ela devolve.
CREATE OR REPLACE FUNCTION public.cells_list(
  _search text[] DEFAULT NULL, _leader_ids uuid[] DEFAULT NULL, _g12_ids uuid[] DEFAULT NULL,
  _street text DEFAULT NULL, _neighborhood text DEFAULT NULL, _city text DEFAULT NULL,
  _types text[] DEFAULT NULL, _weekdays integer[] DEFAULT NULL, _is_active boolean DEFAULT NULL,
  _report_statuses public.cell_report_status[] DEFAULT NULL, _missing_weeks integer[] DEFAULT NULL,
  _created_from date DEFAULT NULL, _created_to date DEFAULT NULL,
  _limit integer DEFAULT 25, _offset integer DEFAULT 0)
RETURNS SETOF public.cells_view
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f   private.cell_filter;
  _ids uuid[];
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  _f := private.cell_filter_normalize(
          _search, _leader_ids, _g12_ids, _street, _neighborhood, _city, _types, _weekdays,
          _is_active, _report_statuses, _missing_weeks, _created_from, _created_to);

  EXECUTE format(
    'SELECT array_agg(p.id ORDER BY p.created_at DESC NULLS LAST, p.id)
       FROM (SELECT v.id, v.created_at
               FROM public.cells_view v
              WHERE %s
              ORDER BY v.created_at DESC NULLS LAST, v.id
              LIMIT $2 OFFSET $3) p',
    private.cell_filter_sql(_f))
    INTO _ids
    USING _f, least(greatest(coalesce(_limit, 25), 1), 100), greatest(coalesce(_offset, 0), 0);

  IF _ids IS NULL THEN RETURN; END IF;                   -- página além do fim: vazia, sem erro

  RETURN QUERY
    SELECT v.* FROM public.cells_view v
     WHERE v.id = ANY (_ids)
     ORDER BY array_position(_ids, v.id);
END
$$;

-- O total, com a mesma normalização e o mesmo WHERE (DT-04).
CREATE OR REPLACE FUNCTION public.cells_list_count(
  _search text[] DEFAULT NULL, _leader_ids uuid[] DEFAULT NULL, _g12_ids uuid[] DEFAULT NULL,
  _street text DEFAULT NULL, _neighborhood text DEFAULT NULL, _city text DEFAULT NULL,
  _types text[] DEFAULT NULL, _weekdays integer[] DEFAULT NULL, _is_active boolean DEFAULT NULL,
  _report_statuses public.cell_report_status[] DEFAULT NULL, _missing_weeks integer[] DEFAULT NULL,
  _created_from date DEFAULT NULL, _created_to date DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f private.cell_filter;
  _n bigint;
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  _f := private.cell_filter_normalize(
          _search, _leader_ids, _g12_ids, _street, _neighborhood, _city, _types, _weekdays,
          _is_active, _report_statuses, _missing_weeks, _created_from, _created_to);

  EXECUTE 'SELECT count(*) FROM public.cells_view v WHERE ' || private.cell_filter_sql(_f)
     INTO _n USING _f;
  RETURN _n;
END
$$;

-- ===========================================================================
-- 6. Os seletores de Líder e G12 (RN-04 a RN-06, DA-8, DA-11). INVOKER: só leem as views, que
--    decidem o escopo pelo auth.uid(). Nada da cadeia: as colunas são as que já saem numa linha da
--    lista (leader_*, g12_leader_*) ou na members_view de quem consulta. No G12, o nível, a marca de
--    pastor e o sexo voltam nulos (a opção mostra só o nome, P-LCE-26), nas duas funções.
-- ===========================================================================
-- As opções: quem aparece numa linha da cells_view de quem consulta, ativa ou inativa. Paginada aqui
-- dentro (o seletor pede 21 linhas), na ordem do nome sem acento e em minúsculas, byte a byte, e do id.
CREATE OR REPLACE FUNCTION public.cell_filter_options(
  _person public.cell_filter_person, _search text[] DEFAULT NULL,
  _limit integer DEFAULT 21, _offset integer DEFAULT 0)
RETURNS TABLE (id uuid, name text, g12_level integer, is_pastor boolean, gender text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _patterns text[];
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  -- A busca como na lista: os 5 primeiros padrões não vazios.
  _patterns := (SELECT array_agg(s.p ORDER BY s.i)
                  FROM (SELECT t.p, t.i FROM unnest(_search) WITH ORDINALITY t(p, i)
                         WHERE coalesce(t.p, '') <> '' ORDER BY t.i LIMIT 5) s);
  RETURN QUERY
    WITH people AS (
      SELECT DISTINCT c.leader_id AS pid, c.leader_name AS pname, c.leader_g12_level AS plevel,
             c.leader_is_pastor AS ppastor, c.leader_gender AS pgender
        FROM public.cells_view c
       WHERE _person = 'leader'
      UNION
      SELECT DISTINCT c.g12_leader_id, c.g12_leader_name, NULL::integer, NULL::boolean, NULL::text
        FROM public.cells_view c
       WHERE _person = 'g12' AND c.g12_leader_id IS NOT NULL)   -- pastor e sem liderança: nunca
    SELECT p.pid, p.pname, p.plevel, p.ppastor, p.pgender
      FROM people p
     WHERE _patterns IS NULL OR public.search_normalize(p.pname) ILIKE ALL (_patterns)
     ORDER BY public.search_normalize(p.pname) COLLATE "C", p.pid
     LIMIT least(greatest(coalesce(_limit, 21), 1), 100) OFFSET greatest(coalesce(_offset, 0), 0);
END
$$;

-- Os ids vindos da URL (RN-06, DA-11): o nome de quem lidera (ou é o G12 de) uma célula visível, ou é
-- visível como membro. Nenhuma linha para o resto (invisível, excluído, inexistente), com a mesma
-- resposta nos três casos. Os 10 primeiros ids distintos (DA-2).
CREATE OR REPLACE FUNCTION public.cell_filter_names(_person public.cell_filter_person, _ids uuid[])
RETURNS TABLE (id uuid, name text, g12_level integer, is_pastor boolean, gender text)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _wanted uuid[];
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  _wanted := public.first_distinct_ids(_ids, 10);
  IF _person IS NULL OR cardinality(_wanted) = 0 THEN RETURN; END IF;

  RETURN QUERY
    WITH found AS (
      SELECT c.leader_id AS pid, c.leader_name AS pname, c.leader_g12_level AS plevel,
             c.leader_is_pastor AS ppastor, c.leader_gender AS pgender, 1 AS source
        FROM public.cells_view c
       WHERE _person = 'leader' AND c.leader_id = ANY (_wanted)
      UNION ALL
      SELECT c.g12_leader_id, c.g12_leader_name, NULL::integer, NULL::boolean, NULL::text, 1
        FROM public.cells_view c
       WHERE _person = 'g12' AND c.g12_leader_id = ANY (_wanted)
      UNION ALL
      SELECT m.id, m.name,
             CASE WHEN _person = 'leader' THEN m.g12_level END,
             CASE WHEN _person = 'leader' THEN m.is_pastor END,
             CASE WHEN _person = 'leader' THEN m.gender END,
             2
        FROM public.members_view m
       WHERE m.id = ANY (_wanted))
    SELECT DISTINCT ON (f.pid) f.pid, f.pname, f.plevel, f.ppastor, f.pgender
      FROM found f
     ORDER BY f.pid, f.source;
END
$$;

-- ===========================================================================
-- 7. Privilégios e pós-condições
-- ===========================================================================
-- Os privilégios padrão do Supabase dão EXECUTE a anon, authenticated e service_role em função nova:
-- revogar e conceder de novo, como o E2.07.
REVOKE ALL ON FUNCTION public.cells_list(text[], uuid[], uuid[], text, text, text, text[], integer[],
  boolean, public.cell_report_status[], integer[], date, date, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cells_list_count(text[], uuid[], uuid[], text, text, text, text[], integer[],
  boolean, public.cell_report_status[], integer[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cell_filter_options(public.cell_filter_person, text[], integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cell_filter_names(public.cell_filter_person, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cells_list(text[], uuid[], uuid[], text, text, text, text[], integer[],
  boolean, public.cell_report_status[], integer[], date, date, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cells_list_count(text[], uuid[], uuid[], text, text, text, text[], integer[],
  boolean, public.cell_report_status[], integer[], date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cell_filter_options(public.cell_filter_person, text[], integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cell_filter_names(public.cell_filter_person, uuid[]) TO authenticated;

REVOKE ALL ON FUNCTION public.first_distinct_ids(uuid[], integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.first_distinct_ids(uuid[], integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.cell_filter_normalize(text[], uuid[], uuid[], text, text, text,
  text[], integer[], boolean, public.cell_report_status[], integer[], date, date),
  private.cell_filter_sql(private.cell_filter)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  _definer regprocedure[] := ARRAY[
    'public.cells_list(text[], uuid[], uuid[], text, text, text, text[], integer[], boolean, public.cell_report_status[], integer[], date, date, integer, integer)'::regprocedure,
    'public.cells_list_count(text[], uuid[], uuid[], text, text, text, text[], integer[], boolean, public.cell_report_status[], integer[], date, date)'::regprocedure];
  _invoker regprocedure[] := ARRAY[
    'public.cell_filter_options(public.cell_filter_person, text[], integer, integer)'::regprocedure,
    'public.cell_filter_names(public.cell_filter_person, uuid[])'::regprocedure];
  _priv regprocedure[] := ARRAY[
    'private.cell_filter_normalize(text[], uuid[], uuid[], text, text, text, text[], integer[], boolean, public.cell_report_status[], integer[], date, date)'::regprocedure,
    'private.cell_filter_sql(private.cell_filter)'::regprocedure];
  _p regprocedure;
BEGIN
  FOREACH _p IN ARRAY _definer || _invoker LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = _p) <> (_p = ANY (_definer))
       OR NOT (SELECT coalesce(proconfig @> ARRAY['search_path=public'], false) FROM pg_proc WHERE oid = _p)
       OR NOT has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.10: % com modo de segurança, search_path ou EXECUTE diferentes do desenho.', _p;
    END IF;
  END LOOP;
  FOREACH _p IN ARRAY _priv LOOP
    IF has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.10: % com EXECUTE para um papel da API.', _p;
    END IF;
  END LOOP;
  IF has_function_privilege('anon', 'public.first_distinct_ids(uuid[], integer)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.first_distinct_ids(uuid[], integer)', 'EXECUTE')
     OR has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('anon', 'private', 'USAGE')
     OR has_schema_privilege('service_role', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'E2.10: privilégios de first_distinct_ids ou do schema private diferentes do desenho.';
  END IF;
END $$;
