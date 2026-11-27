-- E2.12 (PR 1, migration 1 de 2) — A lista de Relatórios por RPC, com os filtros e os atalhos de semana,
-- e os seletores de Líder e G12. Ver docs/specs/e2-12-listagem-relatorios.md no repositório apps-mci
-- ("A lista (migration 1)", "Os seletores (migration 1)", "Metas de tempo e índices", "Contratos";
-- RN-01 a RN-14, RN-16, RN-18; DA-1 a DA-6, DA-9, DA-10; DT-01 a DT-09).
--
-- Conteúdo:
--   0. Guarda de pré-requisitos (E2.02, E2.05, E2.06, E2.08, E2.09, E2.10 PR 1 e E2.11 PRs 1 e 2).
--   1. public.cell_reports_view com quatro colunas no fim: cell_city, cell_state, cell_zip_code (o
--      endereço atual da célula, que não é sensível) e cell_visible (quem consulta vê a célula: o
--      critério da cells_view, DA-9). Nenhuma outra coluna, junção ou condição muda.
--   2. public.server_weeks(_at): a data de hoje e as três semanas, em Brasília, pelo relógio do
--      servidor (RN-10, DT-08). Não lê tabela: está na lista fechada do portão (e203_06_gate).
--   3. Tipo private.cell_report_filter, private.cell_report_filter_people,
--      private.cell_report_filter_normalize e private.cell_report_filter_sql: os filtros normalizados
--      (DA-1 a DA-3, DA-6) e o WHERE, só com fragmentos fixos; os valores entram por USING ($1).
--      Nunca concatene um valor no SQL dinâmico (risco 1).
--   4. public.cell_reports_list e public.cell_reports_list_count (definer): a página (na ordem da RN-13)
--      e o total. Leem só a cell_reports_view, que decide quem aparece (escopo pelo retrato e
--      excluídos) pelo auth.uid() também aqui dentro. São definer só para chamar os auxiliares de
--      private sem dar USAGE no schema.
--   5. public.cell_report_filter_options e public.cell_report_filter_names (definer): as opções e os
--      nomes do Líder e do G12. Os ids saem só da cell_reports_view (e da members_view, nos nomes) de
--      quem consulta; o nome, o nível, a marca de pastor e o sexo do pastor são lidos da tabela só
--      para esses ids (DT-07). O excluído nunca volta.
--   6. Privilégios e pós-condições.
--
-- Nenhuma tabela, trigger ou política muda. As funções públicas que leem dados chamam o portão do
-- E2.03 (viewer_member_id) antes de tudo, mesmo quando nenhuma linha chegaria a ser lida.
-- Filtro novo de Relatórios entra em dois pontos fixos: cell_report_filter_normalize e
-- cell_report_filter_sql. A cell_reports_view é o tipo de retorno da cell_reports_list: um DROP VIEW
-- exige recriar as duas RPCs (risco 4), e todo CREATE da view repete
-- WITH (security_barrier = true, security_invoker = false).
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos. Falha cedo, sem mudar nada. Só nomes de objetos na mensagem.
-- ===========================================================================
DO $$ BEGIN
  IF to_regprocedure('public.first_distinct_ids(uuid[], integer)') IS NULL              -- E2.10 PR 1
     OR to_regtype('public.cell_filter_person') IS NULL                                 -- E2.10 PR 1
     OR to_regprocedure('public.cell_identity(uuid)') IS NULL                           -- E2.10 PR 1
     OR to_regprocedure('public.viewer_sees_report_people(uuid,uuid,uuid)') IS NULL     -- E2.11 PR 1
     OR to_regprocedure('public.submit_cell_report(uuid,jsonb,uuid[])') IS NULL         -- E2.11 PR 2
     OR to_regprocedure('public.viewer_sees_cell_people(uuid,uuid,uuid)') IS NULL       -- E2.02 PR 1
     OR to_regprocedure('public.viewer_member_id()') IS NULL                            -- portão do E2.03
     OR to_regprocedure('public.cell_types()') IS NULL                                  -- E2.08 PR 2
     OR to_regprocedure('public.sp_local(timestamp with time zone)') IS NULL            -- E2.09
     OR to_regclass('private.member_hierarchy') IS NULL                                 -- E2.06 PR 1
     OR EXISTS (SELECT 1
                  FROM unnest(ARRAY['snapshot_leader_id', 'snapshot_leader_name', 'snapshot_timothy_name',
                                    'snapshot_host_name', 'snapshot_cell_type', 'snapshot_leader_g12_level',
                                    'snapshot_leader_is_pastor', 'snapshot_g12_leader_id', 'snapshot_g12_leader_name',
                                    'created_by_name', 'updated_by_name', 'cell_deleted', 'cell_meeting_day',
                                    'cell_meeting_time', 'participants_count', 'visitors_count', 'search_text']) c(col)
                 WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
                                    WHERE attrelid = 'public.cell_reports_view'::regclass
                                      AND attname = c.col AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'E2.12 depende do E2.02, E2.05, E2.06, E2.08, E2.09, E2.10 (PR 1) e E2.11 (PRs 1 e 2) em produção.';
  END IF;
END $$;

-- ===========================================================================
-- 1. A view, com quatro colunas no fim (RN-16 b e c; DA-9). Recriada a partir da definição do E2.11
--    (20261129100000_e211_01_snapshot.sql, conferida contra o pg_get_viewdef): nenhuma outra coluna,
--    junção ou condição muda. A cell_report_participants_view, que junta esta, continua valendo
--    (colunas só no fim). cell_visible, participants_count e search_text custam por linha: o front só
--    as lê pela cell_reports_list (25 linhas) ou por id (risco 8).
-- ===========================================================================
CREATE OR REPLACE VIEW public.cell_reports_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.id,
  r.cell_id,
  r.date,
  r.time,
  r.theme,
  r.observations,
  r.visitors,
  r.offering,
  r.was_held,
  r.reason_not_held,
  r.created_at,
  r.updated_at,
  public.week_start(r.date) AS week_start,
  coalesce(cardinality(r.visitors), 0) AS visitors_count,
  (SELECT count(*) FROM public.cell_report_participants p WHERE p.report_id = r.id) AS participants_count,
  c.type AS cell_type,
  c.is_active AS cell_is_active,
  c.leader_id AS cell_leader_id,
  cl.name AS cell_leader_name,
  c.timothy_id AS cell_timothy_id,
  c.host_id AS cell_host_id,
  c.street AS cell_street,
  c.number AS cell_number,
  c.complement AS cell_complement,
  c.neighborhood AS cell_neighborhood,
  c.meeting_day AS cell_meeting_day,
  c.meeting_time AS cell_meeting_time,
  public.search_normalize(concat_ws(' ', sl.name, r.theme)) AS search_text,   -- E2.11: o líder registrado
  c.deleted_at IS NOT NULL AS cell_deleted,
  r.created_by_kind,
  CASE r.created_by_kind WHEN 'member' THEN cby.name
                           WHEN 'legacy' THEN public.legacy_author_label(r.created_by_legacy) END AS created_by_name,
  r.updated_by_kind,
  CASE r.updated_by_kind WHEN 'member' THEN uby.name
                           WHEN 'legacy' THEN public.legacy_author_label(r.updated_by_legacy) END AS updated_by_name,
  -- E2.11 (RN-14): o retrato.
  r.snapshot_leader_id,
  r.snapshot_timothy_id,
  r.snapshot_host_id,
  sl.name AS snapshot_leader_name,
  st.name AS snapshot_timothy_name,
  sh.name AS snapshot_host_name,
  r.snapshot_cell_type,
  slh.g12_level AS snapshot_leader_g12_level,
  coalesce(sl.is_pastor, false) AS snapshot_leader_is_pastor,
  slh.g12_id AS snapshot_g12_leader_id,
  sg12.name AS snapshot_g12_leader_name,
  -- E2.12 (RN-16 b e c), no fim: o endereço atual da célula e se quem consulta vê a célula (o mesmo
  -- critério da cells_view, E2.02). Só "Ver célula" usa cell_visible.
  c.city AS cell_city,
  c.state AS cell_state,
  c.zip_code AS cell_zip_code,
  (c.deleted_at IS NULL
   AND public.viewer_sees_cell_people(c.leader_id, c.timothy_id, c.host_id)) AS cell_visible
FROM public.cell_reports r
LEFT JOIN public.members cby ON cby.id = r.created_by
LEFT JOIN public.members uby ON uby.id = r.updated_by
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
LEFT JOIN public.members sl ON sl.id = r.snapshot_leader_id
LEFT JOIN public.members st ON st.id = r.snapshot_timothy_id
LEFT JOIN public.members sh ON sh.id = r.snapshot_host_id
LEFT JOIN private.member_hierarchy slh ON slh.member_id = r.snapshot_leader_id
LEFT JOIN public.members sg12 ON sg12.id = slh.g12_id
WHERE (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
       AND (   r.snapshot_leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR r.snapshot_timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR r.snapshot_host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR r.snapshot_leader_id = (SELECT public.viewer_member_id())
  OR r.snapshot_timothy_id = (SELECT public.viewer_member_id())
  OR r.snapshot_host_id = (SELECT public.viewer_member_id())
)
AND r.deleted_at IS NULL;   -- espelhado em "Cell reports view policy"

ALTER VIEW public.cell_reports_view OWNER TO postgres;
REVOKE ALL ON public.cell_reports_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_view TO authenticated;

-- ===========================================================================
-- 2. A data de hoje e as três semanas, em Brasília, segundo o servidor (RN-10, DA-10, DT-08). As
--    mesmas funções da dashboard_summary (sp_local e week_start, RN-18). Não lê tabela e não diz nada
--    de ninguém. _at existe só para os testes; a tela não o manda. INVOKER.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.server_weeks(_at timestamptz DEFAULT now())
RETURNS TABLE (today date,
               this_week_start date, this_week_end date,
               last_week_start date, last_week_end date,
               week_before_last_start date, week_before_last_end date)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT t.today, w.ws, w.ws + 6, w.ws - 7, w.ws - 1, w.ws - 14, w.ws - 8
    FROM (SELECT public.sp_local(coalesce(_at, now()))::date AS today) t
   CROSS JOIN LATERAL (SELECT public.week_start(t.today) AS ws) w
$$;

-- ===========================================================================
-- 3. O filtro normalizado e o WHERE
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE private.cell_report_filter AS (
    search     text[],     -- padrões ILIKE (E1.08), até 5
    cell_id    uuid,       -- RN-08
    leader_ids uuid[],     -- RN-05: nulo = sem filtro; '{}' = ninguém disponível (nada volta)
    g12_ids    uuid[],     -- RN-06: idem
    date_from  date,       -- RN-09: datas de Brasília, inclusive
    date_to    date,
    types      text[],     -- RN-11: valores de cell_types()
    held       boolean);   -- RN-11: nulo = Todas
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- As pessoas escolhidas no Líder ou no G12 (RN-05 a RN-07; DA-2, DA-3): os 10 primeiros ids distintos,
-- sem os nulos, e, deles, só os de membros não excluídos. Nulo quando a chamada não traz nenhum id
-- (sem filtro); '{}' quando nenhum dos ids está disponível (o filtro vale e nada volta). A
-- visibilidade das pessoas não é conferida: o filtro só compara colunas das linhas visíveis da view.
CREATE OR REPLACE FUNCTION private.cell_report_filter_people(_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE WHEN cardinality(f.ids) > 0 THEN
           ARRAY(SELECT m.id FROM public.members m WHERE m.id = ANY (f.ids) AND m.deleted_at IS NULL)
         END
    FROM (SELECT public.first_distinct_ids(_ids, 10) AS ids) f
$$;

-- Os valores como a tela os aplica (DA-1, DA-6). Só é chamada pelas duas RPCs da lista (definer).
CREATE OR REPLACE FUNCTION private.cell_report_filter_normalize(
  _search text[], _cell_id uuid, _leader_ids uuid[], _g12_ids uuid[],
  _date_from date, _date_to date, _types text[], _held boolean)
RETURNS private.cell_report_filter
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _f private.cell_report_filter;
BEGIN
  -- A busca: os 5 primeiros padrões não vazios (RN-14).
  _f.search := (SELECT array_agg(s.p ORDER BY s.i)
                  FROM (SELECT t.p, t.i FROM unnest(_search) WITH ORDINALITY t(p, i)
                         WHERE coalesce(t.p, '') <> '' ORDER BY t.i LIMIT 5) s);
  -- RN-08: a célula que não existe ou que a pessoa não alcança dá lista vazia (a view decide).
  _f.cell_id    := _cell_id;
  -- RN-05 a RN-07; DA-2, DA-3.
  _f.leader_ids := private.cell_report_filter_people(_leader_ids);
  _f.g12_ids    := private.cell_report_filter_people(_g12_ids);
  -- RN-11, DA-1: fora de cell_types() é ignorado; sem repetidos; sem nenhum válido, sem filtro.
  _f.types      := nullif(ARRAY(SELECT DISTINCT x FROM unnest(_types) x
                                 WHERE x = ANY (public.cell_types())), '{}');
  _f.held       := _held;
  -- RN-09, DA-6: datas invertidas desligam o Período inteiro; cada data vale sozinha.
  IF _date_from IS NULL OR _date_to IS NULL OR _date_from <= _date_to THEN
    _f.date_from := _date_from;
    _f.date_to   := _date_to;
  END IF;
  RETURN _f;
END
$$;

-- O WHERE, num lugar só. Só fragmentos fixos, escolhidos pela nulidade de cada campo; os valores vêm
-- de $1 (o filtro) por USING. Nunca concatene um valor aqui. O alias é sempre "v". Todas as condições,
-- menos a busca, usam operadores leakproof e entram na view (security barrier), junto dos índices.
CREATE OR REPLACE FUNCTION private.cell_report_filter_sql(_f private.cell_report_filter)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT concat_ws(' AND ', 'true',
    CASE WHEN _f.search     IS NOT NULL THEN 'v.search_text ILIKE ALL (($1).search)' END,
    CASE WHEN _f.cell_id    IS NOT NULL THEN 'v.cell_id = ($1).cell_id' END,
    CASE WHEN _f.leader_ids IS NOT NULL THEN 'v.snapshot_leader_id = ANY (($1).leader_ids)' END,
    -- RN-06: pastor e sem liderança têm snapshot_g12_leader_id nulo e nunca entram.
    CASE WHEN _f.g12_ids    IS NOT NULL THEN 'v.snapshot_g12_leader_id = ANY (($1).g12_ids)' END,
    -- RN-09: date é a data de Brasília da reunião, sem hora: os dois dias entram.
    CASE WHEN _f.date_from  IS NOT NULL THEN 'v.date >= ($1).date_from' END,
    CASE WHEN _f.date_to    IS NOT NULL THEN 'v.date <= ($1).date_to' END,
    CASE WHEN _f.types      IS NOT NULL THEN 'v.snapshot_cell_type = ANY (($1).types)' END,
    CASE WHEN _f.held       IS NOT NULL THEN 'v.was_held = ($1).held' END)
$$;

-- ===========================================================================
-- 4. A página e o total
-- ===========================================================================
-- A página, na ordem da RN-13 (date DESC, time DESC, id). Em duas etapas (DT-03): (1) os ids da
-- página, calculando só as chaves da ordem e as colunas dos filtros ativos; (2) as linhas por
-- "id = ANY", que é leakproof, entra na view e usa cell_reports_pkey. O front não chama .order(): o
-- PostgREST lê a função na ordem em que ela devolve.
CREATE OR REPLACE FUNCTION public.cell_reports_list(
  _search text[] DEFAULT NULL, _cell_id uuid DEFAULT NULL,
  _leader_ids uuid[] DEFAULT NULL, _g12_ids uuid[] DEFAULT NULL,
  _date_from date DEFAULT NULL, _date_to date DEFAULT NULL,
  _types text[] DEFAULT NULL, _held boolean DEFAULT NULL,
  _limit integer DEFAULT 25, _offset integer DEFAULT 0)
RETURNS SETOF public.cell_reports_view
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f   private.cell_report_filter;
  _ids uuid[];
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  _f := private.cell_report_filter_normalize(
          _search, _cell_id, _leader_ids, _g12_ids, _date_from, _date_to, _types, _held);

  EXECUTE format(
    'SELECT array_agg(p.id ORDER BY p.date DESC, p."time" DESC, p.id)
       FROM (SELECT v.id, v.date, v."time"
               FROM public.cell_reports_view v
              WHERE %s
              ORDER BY v.date DESC, v."time" DESC, v.id
              LIMIT $2 OFFSET $3) p',
    private.cell_report_filter_sql(_f))
    INTO _ids
    USING _f, least(greatest(coalesce(_limit, 25), 1), 100), greatest(coalesce(_offset, 0), 0);

  IF _ids IS NULL THEN RETURN; END IF;                   -- página além do fim: vazia, sem erro

  RETURN QUERY
    SELECT v.* FROM public.cell_reports_view v
     WHERE v.id = ANY (_ids)
     ORDER BY array_position(_ids, v.id);
END
$$;

-- O total, com a mesma normalização e o mesmo WHERE (DT-04).
CREATE OR REPLACE FUNCTION public.cell_reports_list_count(
  _search text[] DEFAULT NULL, _cell_id uuid DEFAULT NULL,
  _leader_ids uuid[] DEFAULT NULL, _g12_ids uuid[] DEFAULT NULL,
  _date_from date DEFAULT NULL, _date_to date DEFAULT NULL,
  _types text[] DEFAULT NULL, _held boolean DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _f private.cell_report_filter;
  _n bigint;
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  _f := private.cell_report_filter_normalize(
          _search, _cell_id, _leader_ids, _g12_ids, _date_from, _date_to, _types, _held);

  EXECUTE 'SELECT count(*) FROM public.cell_reports_view v WHERE ' || private.cell_report_filter_sql(_f)
     INTO _n USING _f;
  RETURN _n;
END
$$;

-- ===========================================================================
-- 5. Os seletores de Líder e G12 (RN-05 a RN-07; DA-4, DA-5; DT-07). DEFINER: a regra "excluído nunca
--    é opção" precisa de members.deleted_at, e o rótulo do P40 precisa do sexo do pastor, que não estão
--    na cell_reports_view. Os ids saem só da view (e da members_view, nos nomes), que filtram por
--    auth.uid(); o resto é lido da tabela só para esses ids. Nada da cadeia. No G12, o nível, a marca
--    de pastor e o sexo voltam nulos (a opção mostra só o nome, P-LRE-03); no Líder, o sexo só do
--    pastor (DA-5).
-- ===========================================================================
-- As opções: quem é o líder registrado (ou o G12) de pelo menos um relatório da cell_reports_view de
-- quem consulta, ativo ou inativo, nunca excluído. Paginada aqui dentro (o seletor pede 21 linhas), na
-- ordem do nome sem acento e em minúsculas, byte a byte, e do id (DA-4).
CREATE OR REPLACE FUNCTION public.cell_report_filter_options(
  _person public.cell_filter_person, _search text[] DEFAULT NULL,
  _limit integer DEFAULT 21, _offset integer DEFAULT 0)
RETURNS TABLE (id uuid, name text, g12_level integer, is_pastor boolean, gender text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _patterns text[];
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  IF _person IS NULL THEN RETURN; END IF;
  -- A busca como na lista: os 5 primeiros padrões não vazios.
  _patterns := (SELECT array_agg(s.p ORDER BY s.i)
                  FROM (SELECT t.p, t.i FROM unnest(_search) WITH ORDINALITY t(p, i)
                         WHERE coalesce(t.p, '') <> '' ORDER BY t.i LIMIT 5) s);
  RETURN QUERY
    WITH people AS (
      SELECT DISTINCT v.snapshot_leader_id AS pid
        FROM public.cell_reports_view v
       WHERE _person = 'leader'
      UNION
      SELECT DISTINCT v.snapshot_g12_leader_id
        FROM public.cell_reports_view v
       WHERE _person = 'g12' AND v.snapshot_g12_leader_id IS NOT NULL)   -- pastor e sem liderança: nunca
    SELECT m.id, m.name,
           CASE WHEN _person = 'leader' THEN h.g12_level END,
           CASE WHEN _person = 'leader' THEN m.is_pastor END,
           CASE WHEN _person = 'leader' AND m.is_pastor THEN m.gender END
      FROM people p
      JOIN public.members m ON m.id = p.pid AND m.deleted_at IS NULL     -- excluído: nunca (RN-08 do E2.01)
      LEFT JOIN private.member_hierarchy h ON h.member_id = m.id
     WHERE _patterns IS NULL OR public.search_normalize(m.name) ILIKE ALL (_patterns)
     ORDER BY public.search_normalize(m.name) COLLATE "C", m.id
     LIMIT least(greatest(coalesce(_limit, 21), 1), 100) OFFSET greatest(coalesce(_offset, 0), 0);
END
$$;

-- Os ids vindos da URL (RN-07): o nome de quem quem consulta vê como membro, ou de quem é o líder
-- registrado (no Líder) ou o G12 (no G12) de um relatório visível, desde que não excluído. Nenhuma
-- linha para o resto (invisível, excluído, inexistente), com a mesma resposta nos três casos. Os 10
-- primeiros ids distintos (DA-1, DA-3).
CREATE OR REPLACE FUNCTION public.cell_report_filter_names(_person public.cell_filter_person, _ids uuid[])
RETURNS TABLE (id uuid, name text, g12_level integer, is_pastor boolean, gender text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
    SELECT m.id, m.name,
           CASE WHEN _person = 'leader' THEN h.g12_level END,
           CASE WHEN _person = 'leader' THEN m.is_pastor END,
           CASE WHEN _person = 'leader' AND m.is_pastor THEN m.gender END
      FROM unnest(_wanted) WITH ORDINALITY AS w(wid, ord)
      JOIN public.members m ON m.id = w.wid AND m.deleted_at IS NULL
      LEFT JOIN private.member_hierarchy h ON h.member_id = m.id
     WHERE EXISTS (SELECT 1 FROM public.members_view mv WHERE mv.id = w.wid)
        OR (_person = 'leader' AND EXISTS (SELECT 1 FROM public.cell_reports_view v
                                            WHERE v.snapshot_leader_id = w.wid))
        OR (_person = 'g12'    AND EXISTS (SELECT 1 FROM public.cell_reports_view v
                                            WHERE v.snapshot_g12_leader_id = w.wid))
     ORDER BY w.ord;
END
$$;

-- ===========================================================================
-- 6. Privilégios e pós-condições
-- ===========================================================================
-- Os privilégios padrão do Supabase dão EXECUTE a anon, authenticated e service_role em função nova:
-- revogar e conceder de novo, como o E2.07 e o E2.10.
REVOKE ALL ON FUNCTION public.cell_reports_list(text[], uuid, uuid[], uuid[], date, date, text[], boolean,
  integer, integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cell_reports_list_count(text[], uuid, uuid[], uuid[], date, date, text[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cell_report_filter_options(public.cell_filter_person, text[], integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cell_report_filter_names(public.cell_filter_person, uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.server_weeks(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cell_reports_list(text[], uuid, uuid[], uuid[], date, date, text[], boolean,
  integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cell_reports_list_count(text[], uuid, uuid[], uuid[], date, date, text[], boolean)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cell_report_filter_options(public.cell_filter_person, text[], integer, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cell_report_filter_names(public.cell_filter_person, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.server_weeks(timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION private.cell_report_filter_people(uuid[]),
  private.cell_report_filter_normalize(text[], uuid, uuid[], uuid[], date, date, text[], boolean),
  private.cell_report_filter_sql(private.cell_report_filter)
  FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  _definer regprocedure[] := ARRAY[
    'public.cell_reports_list(text[], uuid, uuid[], uuid[], date, date, text[], boolean, integer, integer)'::regprocedure,
    'public.cell_reports_list_count(text[], uuid, uuid[], uuid[], date, date, text[], boolean)'::regprocedure,
    'public.cell_report_filter_options(public.cell_filter_person, text[], integer, integer)'::regprocedure,
    'public.cell_report_filter_names(public.cell_filter_person, uuid[])'::regprocedure];
  _invoker regprocedure[] := ARRAY['public.server_weeks(timestamptz)'::regprocedure];
  _priv regprocedure[] := ARRAY[
    'private.cell_report_filter_people(uuid[])'::regprocedure,
    'private.cell_report_filter_normalize(text[], uuid, uuid[], uuid[], date, date, text[], boolean)'::regprocedure,
    'private.cell_report_filter_sql(private.cell_report_filter)'::regprocedure];
  _p regprocedure;
  _cols text[];
BEGIN
  FOREACH _p IN ARRAY _definer || _invoker LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = _p) <> (_p = ANY (_definer))
       OR NOT (SELECT coalesce(proconfig @> ARRAY['search_path=public'], false) FROM pg_proc WHERE oid = _p)
       OR NOT has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.12: modo de segurança ou privilégios das funções diferentes do desenho (%).', _p;
    END IF;
  END LOOP;
  FOREACH _p IN ARRAY _priv LOOP
    IF has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.12: modo de segurança ou privilégios das funções diferentes do desenho (%).', _p;
    END IF;
  END LOOP;
  IF has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('anon', 'private', 'USAGE')
     OR NOT has_function_privilege('authenticated', 'public.viewer_sees_cell_people(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'E2.12: modo de segurança ou privilégios das funções diferentes do desenho (schema private ou viewer_sees_cell_people).';
  END IF;

  -- A view: as reloptions de antes e as quatro colunas novas no fim, nesta ordem.
  SELECT array_agg(attname::text ORDER BY attnum DESC) INTO _cols
    FROM (SELECT attname, attnum FROM pg_attribute
           WHERE attrelid = 'public.cell_reports_view'::regclass AND attnum > 0 AND NOT attisdropped
           ORDER BY attnum DESC LIMIT 4) x;
  IF _cols IS DISTINCT FROM ARRAY['cell_visible', 'cell_zip_code', 'cell_state', 'cell_city']
     OR (SELECT reloptions FROM pg_class WHERE oid = 'public.cell_reports_view'::regclass)
          IS DISTINCT FROM ARRAY['security_barrier=true', 'security_invoker=false'] THEN
    RAISE EXCEPTION 'E2.12: cell_reports_view diferente do desenho (colunas no fim ou reloptions).';
  END IF;
END $$;
