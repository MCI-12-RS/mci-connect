-- E2.07 (PR 1, migration 2 de 2) — A lista de Membros por RPC, com os filtros. Ver
-- docs/specs/e2-07-filtros-membros.md no repositório apps-mci ("A lista (migration 2)", "Filtro de liderança
-- sem expor a cadeia", "Metas de tempo e índices", "Contratos"; RN-01 a RN-09, RN-12 a RN-15, RN-17;
-- DA-1 a DA-8; DT-01 a DT-05, DT-09, DT-11).
--
-- Conteúdo:
--   1. Tipo private.member_filter: os filtros já normalizados (DT-09).
--   2. private.text_key(text): sem acento, minúsculas, qualquer espaço como um, sem os das pontas
--      (RN-06, DA-6).
--   3. private.member_filter_normalize(...): os valores como a tela os aplica (DA-1, DA-2). A Liderança
--      fica só com os ids que a members_view de quem consulta devolve (RN-05).
--   4. private.member_filter_sql(member_filter): o WHERE, num lugar só. Devolve só fragmentos fixos,
--      escolhidos pela nulidade de cada campo; os valores entram por USING ($1). Nunca concatene um
--      valor aqui (risco 1).
--   5. public.members_list(...) e public.members_list_count(...): a página (na ordem da RN-15) e o
--      total. Leem só a members_view, que decide quem aparece (escopo e excluídos) pelo auth.uid()
--      também aqui dentro. São definer só para ler a cadeia em private.member_hierarchy, no WHERE,
--      para ids que vieram da view; a cadeia nunca sai (DT-02).
--   6. Privilégios e pós-condições.
--
-- Filtro novo de Membros entra em dois pontos fixos: member_filter_normalize e member_filter_sql.
-- A members_view é o tipo de retorno da members_list: um DROP VIEW exige recriar as duas RPCs.
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 1. Tipo dos filtros normalizados
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE private.member_filter AS (
    search        text[],                              -- padrões ILIKE (toSearchPatterns, E1.08)
    leader_ids    uuid[],                              -- só os visíveis; '{}' = só pessoas indisponíveis
    neighborhood  text,                                -- private.text_key; nulo = sem filtro
    city          text,
    is_active     boolean,
    leadership    public.member_leadership_status[],
    is_baptized   boolean,
    levels        integer[],                           -- 0 a 4
    level_5_plus  boolean,
    cell_links    public.member_cell_link[],
    created_from  timestamptz,                         -- início do dia "a partir de" (Brasília)
    created_until timestamptz);                        -- início do dia seguinte ao "até" (exclusivo)
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2. RN-06, DA-6: a chave de texto de bairro e cidade
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.text_key(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT btrim(regexp_replace(public.search_normalize(_value), '\s+', ' ', 'g'))
$$;

-- ===========================================================================
-- 3. Normalização (DA-1, DA-2). INVOKER: só é chamada pelas RPCs (definer).
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.member_filter_normalize(
  _search text[], _leader_ids uuid[], _neighborhood text, _city text, _is_active boolean,
  _leadership public.member_leadership_status[], _is_baptized boolean, _levels integer[],
  _cell_links public.member_cell_link[], _created_from date, _created_to date)
RETURNS private.member_filter
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _f    private.member_filter;
  _ten  uuid[];
  _from date;
  _to   date;
BEGIN
  -- A busca: os 5 primeiros padrões não vazios.
  _f.search := (SELECT array_agg(s.p ORDER BY s.i)
                  FROM (SELECT t.p, t.i FROM unnest(_search) WITH ORDINALITY t(p, i)
                         WHERE coalesce(t.p, '') <> '' ORDER BY t.i LIMIT 5) s);

  -- RN-04, RN-05, DA-2: os 10 primeiros ids distintos, na ordem da primeira aparição, sem os nulos;
  -- valem só os que a members_view de quem consulta devolve. Nenhum visível = '{}' (lista vazia).
  _ten := ARRAY(SELECT t.x FROM unnest(_leader_ids) WITH ORDINALITY t(x, i)
                 WHERE t.x IS NOT NULL GROUP BY t.x ORDER BY min(t.i) LIMIT 10);
  IF cardinality(_ten) > 0 THEN
    _f.leader_ids := ARRAY(SELECT v.id FROM public.members_view v WHERE v.id = ANY (_ten));
  END IF;

  -- RN-06: os 100 primeiros caracteres, contados antes da normalização; vazio = sem filtro.
  _f.neighborhood := nullif(private.text_key(left(_neighborhood, 100)), '');
  _f.city         := nullif(private.text_key(left(_city, 100)), '');

  _f.is_active    := _is_active;
  _f.is_baptized  := _is_baptized;
  _f.leadership   := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_leadership) x WHERE x IS NOT NULL), '{}');
  _f.cell_links   := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_cell_links) x WHERE x IS NOT NULL), '{}');

  -- RN-09: 0 a 4 exatos; 5 liga "5 ou mais"; o resto é ignorado.
  _f.levels       := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_levels) x WHERE x BETWEEN 0 AND 4), '{}');
  _f.level_5_plus := coalesce(5 = ANY (_levels), false);

  -- RN-12, DA-4: datas invertidas desligam o filtro de data inteiro. Cada uma vale sozinha. As datas
  -- são presas entre os anos 1 e 9999 só para caberem no timestamp (o resultado é o mesmo). Cuidado:
  -- GREATEST e LEAST ignoram nulos, por isso o CASE.
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

-- ===========================================================================
-- 4. O WHERE, num lugar só (DT-09). Só fragmentos fixos; os valores vêm de $1 por USING.
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.member_filter_sql(_f private.member_filter)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws(' AND ', 'true',
    CASE WHEN _f.search IS NOT NULL THEN 'v.search_text ILIKE ALL (($1).search)' END,
    -- RN-04: abaixo de pelo menos uma pessoa escolhida, em qualquer nível (a cadeia do E2.06 passa
    -- pelos inativos e não inclui a própria pessoa).
    CASE WHEN _f.leader_ids IS NOT NULL THEN
      'v.id IN (SELECT h.member_id FROM private.member_hierarchy h WHERE h.ancestor_ids && ($1).leader_ids)' END,
    CASE WHEN _f.neighborhood IS NOT NULL THEN 'strpos(private.text_key(v.neighborhood), ($1).neighborhood) > 0' END,
    CASE WHEN _f.city IS NOT NULL THEN 'strpos(private.text_key(v.city), ($1).city) > 0' END,
    CASE WHEN _f.is_active IS NOT NULL THEN 'v.is_active = ($1).is_active' END,
    CASE WHEN _f.leadership IS NOT NULL THEN 'v.leadership_status = ANY (($1).leadership)' END,
    CASE WHEN _f.is_baptized IS NOT NULL THEN 'v.is_baptized = ($1).is_baptized' END,
    -- RN-09: quem está sem liderança (nível nulo) não satisfaz nenhuma das duas condições. Não troque
    -- por least(g12_level, 5): LEAST ignora nulos.
    CASE WHEN _f.levels IS NOT NULL OR _f.level_5_plus THEN
      '(v.g12_level = ANY (coalesce(($1).levels, ''{}'')) OR (($1).level_5_plus AND v.g12_level >= 5))' END,
    CASE WHEN _f.cell_links IS NOT NULL THEN 'v.cell_links && ($1).cell_links' END,
    CASE WHEN _f.created_from IS NOT NULL THEN 'v.created_at >= ($1).created_from' END,
    CASE WHEN _f.created_until IS NOT NULL THEN 'v.created_at < ($1).created_until' END)
$$;

-- ===========================================================================
-- 5. A página e o total
-- ===========================================================================
-- A página, na ordem da RN-15 (DT-05): nível com os nulos por último, o nome sem acento e em
-- minúsculas comparado byte a byte, e o id (DA-5). Em duas etapas (DT-03): (1) os ids da página,
-- calculando só as chaves da ordem e as colunas dos filtros ativos; (2) as linhas por "id = ANY",
-- que é leakproof, entra na view e usa members_pkey. O front não chama .order(): o PostgREST lê a
-- função na ordem em que ela devolve.
CREATE OR REPLACE FUNCTION public.members_list(
  _search text[] DEFAULT NULL, _leader_ids uuid[] DEFAULT NULL,
  _neighborhood text DEFAULT NULL, _city text DEFAULT NULL, _is_active boolean DEFAULT NULL,
  _leadership public.member_leadership_status[] DEFAULT NULL, _is_baptized boolean DEFAULT NULL,
  _levels integer[] DEFAULT NULL, _cell_links public.member_cell_link[] DEFAULT NULL,
  _created_from date DEFAULT NULL, _created_to date DEFAULT NULL,
  _limit integer DEFAULT 25, _offset integer DEFAULT 0)
RETURNS SETOF public.members_view
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f   private.member_filter;
  _ids uuid[];
BEGIN
  -- O portão do E2.03 sempre, mesmo quando nenhuma linha chegaria a ser lida.
  PERFORM public.viewer_member_id();
  _f := private.member_filter_normalize(
          _search, _leader_ids, _neighborhood, _city, _is_active, _leadership,
          _is_baptized, _levels, _cell_links, _created_from, _created_to);
  IF _f.leader_ids = '{}' THEN RETURN; END IF;           -- RN-05: só pessoas indisponíveis

  EXECUTE format(
    'SELECT array_agg(p.id ORDER BY p.lvl NULLS LAST, p.name_key, p.id)
       FROM (SELECT v.id, v.g12_level AS lvl,
                    public.search_normalize(v.name) COLLATE "C" AS name_key
               FROM public.members_view v
              WHERE %s
              ORDER BY v.g12_level NULLS LAST, name_key, v.id
              LIMIT $2 OFFSET $3) p',
    private.member_filter_sql(_f))
    INTO _ids
    USING _f, least(greatest(coalesce(_limit, 25), 1), 100), greatest(coalesce(_offset, 0), 0);

  IF _ids IS NULL THEN RETURN; END IF;                   -- página além do fim: vazia, sem erro

  RETURN QUERY
    SELECT v.* FROM public.members_view v
     WHERE v.id = ANY (_ids)
     ORDER BY array_position(_ids, v.id);
END
$$;

-- O total, com a mesma normalização e o mesmo WHERE (DT-04, DT-09).
CREATE OR REPLACE FUNCTION public.members_list_count(
  _search text[] DEFAULT NULL, _leader_ids uuid[] DEFAULT NULL,
  _neighborhood text DEFAULT NULL, _city text DEFAULT NULL, _is_active boolean DEFAULT NULL,
  _leadership public.member_leadership_status[] DEFAULT NULL, _is_baptized boolean DEFAULT NULL,
  _levels integer[] DEFAULT NULL, _cell_links public.member_cell_link[] DEFAULT NULL,
  _created_from date DEFAULT NULL, _created_to date DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f private.member_filter;
  _n bigint;
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  _f := private.member_filter_normalize(
          _search, _leader_ids, _neighborhood, _city, _is_active, _leadership,
          _is_baptized, _levels, _cell_links, _created_from, _created_to);
  IF _f.leader_ids = '{}' THEN RETURN 0; END IF;

  EXECUTE 'SELECT count(*) FROM public.members_view v WHERE ' || private.member_filter_sql(_f)
     INTO _n USING _f;
  RETURN _n;
END
$$;

-- ===========================================================================
-- 6. Privilégios e pós-condições
-- ===========================================================================
-- Os privilégios padrão do Supabase dão EXECUTE a anon, authenticated e service_role em função nova:
-- revogar e conceder de novo, como o E2.06 faz com a ministry_tree_nodes.
REVOKE ALL ON FUNCTION public.members_list(text[], uuid[], text, text, boolean,
  public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date,
  integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.members_list_count(text[], uuid[], text, text, boolean,
  public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.members_list(text[], uuid[], text, text, boolean,
  public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date,
  integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.members_list_count(text[], uuid[], text, text, boolean,
  public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date)
  TO authenticated;

REVOKE ALL ON FUNCTION private.text_key(text),
  private.member_filter_normalize(text[], uuid[], text, text, boolean, public.member_leadership_status[],
                                  boolean, integer[], public.member_cell_link[], date, date),
  private.member_filter_sql(private.member_filter)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  _rpc  regprocedure[] := ARRAY[
    'public.members_list(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date, integer, integer)'::regprocedure,
    'public.members_list_count(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date)'::regprocedure];
  _priv regprocedure[] := ARRAY[
    'private.text_key(text)'::regprocedure,
    'private.member_filter_normalize(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date)'::regprocedure,
    'private.member_filter_sql(private.member_filter)'::regprocedure];
  _p regprocedure;
BEGIN
  FOREACH _p IN ARRAY _rpc LOOP
    IF NOT (SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc WHERE oid = _p)
       OR NOT has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.07: % sem definer, search_path fixo ou com EXECUTE fora de authenticated.', _p;
    END IF;
  END LOOP;
  FOREACH _p IN ARRAY _priv LOOP
    IF has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.07: % com EXECUTE para um papel da API.', _p;
    END IF;
  END LOOP;
END $$;
