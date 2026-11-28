-- E2.14 (PR 1): os números do Dashboard (spec docs/specs/e2-14-dashboard.md, Solução técnica).
--
--   0. Pré-requisitos (E2.02, E2.06, E2.07, E2.08, E2.09). Falha cedo, sem mudar nada.
--   1. dashboard_summary(_at): DROP e CREATE a partir do corpo vigente (E2.09 + E2.07), com:
--        - "Visitantes em Células" só dos relatórios de célula realizada (RN-05, P-DSH-02);
--        - seis colunas no fim: reports_held (RN-12), members_new (RN-07), cells_new (RN-08) e os
--          três tipos, só com as células ativas (RN-10): cells_evangelistic, cells_discipleship,
--          cells_macrocell.
--   2. dashboard_g12_ranking(): DROP e CREATE, contando pelas células visíveis e ativas da
--      cells_view, pelo g12_leader_id (o mesmo do filtro G12 da lista de Células, DA-1), e com
--      g12_ids no fim (os integrantes de nível 1 do casal, na ordem do nome, DA-2).
--   3. Privilégios.
--   4. Pós-condições.
--
-- Nada de tabela, coluna, view, trigger ou política nova. A dashboard_cells_by_type fica igual
-- (o front de hoje ainda a usa) e sai no PR 4.
--
-- Idempotente: DROP ... IF EXISTS antes de cada CREATE; a guarda aceita o corpo deste arquivo.
-- As mensagens das guardas trazem só nomes de objetos.

-- ===========================================================================
-- 0. Pré-requisitos
-- ===========================================================================
DO $$
DECLARE
  _body text;
BEGIN
  IF to_regclass('private.member_hierarchy') IS NULL                              -- E2.06, PR 1
     OR to_regprocedure('public.sp_day_start(date)') IS NULL                       -- E2.07, PR 1
     OR to_regprocedure('public.cell_types()') IS NULL                             -- E2.08, PR 2
     OR to_regprocedure('public.sp_local(timestamptz)') IS NULL                    -- E2.09, PR 1
     OR to_regprocedure('public.cells_report_situation(timestamptz)') IS NULL      -- E2.09, PR 1
     OR EXISTS (
          SELECT 1
            FROM (VALUES ('public.members_view', 'created_at'), ('public.members_view', 'is_active'),
                         ('public.members_view', 'leadership_status'), ('public.members_view', 'cell_links'),
                         ('public.members_view', 'g12_level'), ('public.members_view', 'spouse_id'),
                         ('public.members_view', 'gender'),
                         ('public.cells_view', 'created_at'), ('public.cells_view', 'type'),
                         ('public.cells_view', 'is_active'), ('public.cells_view', 'g12_leader_id'),
                         ('public.cells_view', 'leader_gender'),
                         ('public.cell_reports_view', 'date'),
                         ('public.cell_reports_view', 'was_held'),
                         ('public.cell_reports_view', 'visitors_count')) c(rel, col)
           WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a
                              WHERE a.attrelid = c.rel::regclass AND a.attname = c.col
                                AND NOT a.attisdropped)) THEN
    RAISE EXCEPTION 'E2.14 depende do E2.06 (PR 1), do E2.07 (PR 1), do E2.08 (PR 2) e do E2.09 (PR 1).';
  END IF;

  IF pg_get_functiondef('public._dashboard_assert_access()'::regprocedure) ~ 'view_own_ministry_dashboard' THEN
    RAISE EXCEPTION 'E2.14 depende do PR 1 do E2.02 (_dashboard_assert_access só com view_dashboard).';
  END IF;

  -- O corpo vigente precisa ter as mudanças do E2.07 e do E2.09: este arquivo parte dele.
  _body := pg_get_functiondef('public.dashboard_summary(timestamptz)'::regprocedure);
  IF _body !~ 'cells_report_situation' OR _body !~ 'leadership_status' OR _body !~ 'cell_links' THEN
    RAISE EXCEPTION 'E2.14: o dashboard_summary vigente não tem as mudanças do E2.07 e do E2.09.';
  END IF;

  -- Uma coluna por tipo (DT-03): se a lista mudar, o desenho volta ao architect.
  IF public.cell_types() IS DISTINCT FROM ARRAY['Evangelística', 'Discipulado', 'Macrocélula'] THEN
    RAISE EXCEPTION 'E2.14: a lista de tipos de célula mudou; o dashboard_summary tem uma coluna por tipo.';
  END IF;
END $$;

-- ===========================================================================
-- 1. dashboard_summary
-- ===========================================================================
-- O retorno ganha colunas, e o CREATE OR REPLACE não muda o retorno: DROP e CREATE, na mesma
-- transação (sem janela). Nada depende da função (conferência d do spec).
-- Os nomes das colunas de RETURNS TABLE viram variáveis em plpgsql: toda coluna é qualificada
-- pelo apelido, e as funções são chamadas pelo schema.
DROP FUNCTION IF EXISTS public.dashboard_summary(timestamptz);
CREATE FUNCTION public.dashboard_summary(_at timestamptz DEFAULT now())
RETURNS TABLE (
  week_start date,
  week_end date,
  reports_sent bigint,
  cells_pending bigint,
  visitors bigint,
  cells_not_held bigint,
  members_total bigint,
  members_active bigint,
  members_inactive bigint,
  members_baptized bigint,
  members_not_baptized bigint,
  members_without_leader bigint,
  members_without_cell_link bigint,
  -- E2.14, no fim (Pontos de extensão do E1.08):
  reports_held bigint,              -- RN-12: parte "Célula realizada" do gráfico
  members_new bigint,               -- RN-07
  cells_new bigint,                 -- RN-08
  cells_evangelistic bigint,        -- RN-10: só as ativas, uma coluna por valor de cell_types()
  cells_discipleship bigint,
  cells_macrocell bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- Agora no horário de Brasília; _at nulo vale como agora.
  _local     timestamp   := public.sp_local(coalesce(_at, now()));
  _ws        date        := public.week_start(_local::date);
  _we        date        := _ws + 6;
  -- RN-07, RN-08: o intervalo que os filtros de data de cadastro das listas montam com a semana
  -- (E2.07, E2.10): do início do domingo ao início do domingo seguinte, em Brasília.
  _new_from  timestamptz := public.sp_day_start(_ws);
  _new_until timestamptz := public.sp_day_start(_we + 1);
BEGIN
  PERFORM public._dashboard_assert_access();                                   -- RN-01 (E2.02)

  RETURN QUERY
  SELECT
    _ws,
    _we,
    rep.reports_sent,
    pend.cells_pending,
    rep.visitors,
    rep.cells_not_held,
    mem.members_total,
    mem.members_active,
    mem.members_inactive,
    mem.members_baptized,
    mem.members_not_baptized,
    mem.members_without_leader,
    mem.members_without_cell_link,
    rep.reports_held,
    mem.members_new,
    cel.cells_new,
    cel.cells_evangelistic,
    cel.cells_discipleship,
    cel.cells_macrocell
  FROM (
    -- RN-03, RN-05, RN-06, RN-12: relatórios visíveis da semana, inclusive os de célula excluída.
    SELECT
      count(*) AS reports_sent,
      count(*) FILTER (WHERE rv.was_held) AS reports_held,
      count(*) FILTER (WHERE NOT rv.was_held) AS cells_not_held,
      -- P-DSH-02: só os visitantes de célula realizada.
      coalesce(sum(rv.visitors_count) FILTER (WHERE rv.was_held), 0)::bigint AS visitors
    FROM public.cell_reports_view rv
    WHERE rv.date BETWEEN _ws AND _we
  ) rep
  CROSS JOIN (
    -- RN-04: a RN-08 do E2.09, sem mudança.
    SELECT count(*) AS cells_pending
    FROM public.cells_report_situation(coalesce(_at, now())) s
    WHERE s.report_status = 'pending'::public.cell_report_status
  ) pend
  CROSS JOIN (
    -- RN-08 e RN-10: uma passada pelas células visíveis (a excluída não está na view).
    -- Sem report_status: a junção da situação não roda (DT-06 do E2.09).
    SELECT
      count(*) FILTER (WHERE cv.created_at >= _new_from AND cv.created_at < _new_until) AS cells_new,
      count(*) FILTER (WHERE cv.is_active AND cv.type = 'Evangelística') AS cells_evangelistic,
      count(*) FILTER (WHERE cv.is_active AND cv.type = 'Discipulado') AS cells_discipleship,
      count(*) FILTER (WHERE cv.is_active AND cv.type = 'Macrocélula') AS cells_macrocell
    FROM public.cells_view cv
  ) cel
  CROSS JOIN (
    -- RN-07 e RN-09: o corpo vigente (E1.08 com os dois FILTERs do E2.07), mais members_new.
    SELECT
      count(*) AS members_total,
      count(*) FILTER (WHERE mv.is_active) AS members_active,
      count(*) FILTER (WHERE NOT mv.is_active) AS members_inactive,
      count(*) FILTER (WHERE mv.is_baptized) AS members_baptized,
      count(*) FILTER (WHERE NOT mv.is_baptized) AS members_not_baptized,
      -- E2.07 (RN-11, RN-17): as mesmas colunas do filtro da lista.
      count(*) FILTER (
        WHERE mv.is_active AND mv.leadership_status = 'no_leadership'::public.member_leadership_status
      ) AS members_without_leader,
      count(*) FILTER (
        WHERE mv.is_active AND 'none'::public.member_cell_link = ANY (mv.cell_links)
      ) AS members_without_cell_link,
      -- O nulo ("data não registrada") nunca satisfaz a comparação.
      count(*) FILTER (WHERE mv.created_at >= _new_from AND mv.created_at < _new_until) AS members_new
    FROM public.members_view mv
  ) mem;
END;
$$;

COMMENT ON FUNCTION public.dashboard_summary(timestamptz) IS
  'E2.14: os números do Dashboard numa linha, no escopo de quem consulta (views). '
  'Semana de domingo a sábado em Brasília a partir de _at; visitantes só de célula realizada; '
  'tipos só com as células ativas.';

-- ===========================================================================
-- 2. dashboard_g12_ranking
-- ===========================================================================
-- A contagem passa a ser a do filtro "G12 + Situação: Ativa" da lista de Células (DA-1).
-- couple_key fica (chave da linha no front, contrato do E1.08). Casais com 0 células continuam.
-- Regra do nome: a do E1.08, com o empate "o de nível 1 primeiro" por IS DISTINCT FROM 1
-- (o nível aceita nulo desde o E2.06).
DROP FUNCTION IF EXISTS public.dashboard_g12_ranking();
CREATE FUNCTION public.dashboard_g12_ranking()
RETURNS TABLE (
  couple_key text,
  name text,
  spouse_name text,
  male_cells bigint,
  female_cells bigint,
  total_cells bigint,
  g12_ids uuid[]                    -- E2.14 (AQ-4): os integrantes de nível 1, na ordem do nome (DA-2)
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM public._dashboard_assert_access();

  RETURN QUERY
  WITH g12 AS MATERIALIZED (
    -- Os G12 ativos e visíveis.
    SELECT mv.id, mv.name, mv.spouse_id, coalesce(mv.gender = 'M', false) AS is_male
      FROM public.members_view mv
     WHERE mv.is_active AND mv.g12_level = 1
  ),
  spouse AS MATERIALIZED (
    -- O cônjuge só se for ativo e visível: nenhum id invisível sai daqui. Lido por id.
    SELECT mv.id, mv.name, mv.g12_level, coalesce(mv.gender = 'M', false) AS is_male
      FROM public.members_view mv
     WHERE mv.is_active
       AND mv.id = ANY (ARRAY(SELECT g.spouse_id FROM g12 g WHERE g.spouse_id IS NOT NULL))
  ),
  per_g12 AS MATERIALIZED (
    -- RN-11, RN-13, RN-18: as células visíveis e ativas de cada G12, pela mesma coluna do filtro
    -- G12 da lista (E2.10). Cada célula tem um g12_leader_id só: nenhuma conta duas vezes.
    SELECT cv.g12_leader_id AS g12_id,
           count(*) FILTER (WHERE cv.leader_gender = 'M') AS male_cells,
           count(*) FILTER (WHERE cv.leader_gender = 'F') AS female_cells,
           count(*) AS total_cells
      FROM public.cells_view cv
     WHERE cv.is_active
       AND cv.g12_leader_id = ANY (ARRAY(SELECT g.id FROM g12 g))
     GROUP BY cv.g12_leader_id
  ),
  pairs AS (
    -- Uma linha por integrante de nível 1.
    SELECT CASE WHEN s.id IS NULL THEN g.id::text
                ELSE least(g.id, s.id)::text || '|' || greatest(g.id, s.id)::text END AS couple_key,
           -- O cônjuge vem primeiro? O homem primeiro; empatado, o de nível 1 (g sempre é de
           -- nível 1); empatado de novo, o de menor id.
           CASE WHEN s.id IS NULL THEN false
                WHEN s.is_male <> g.is_male THEN s.is_male
                WHEN s.g12_level IS DISTINCT FROM 1 THEN false
                ELSE s.id < g.id END AS spouse_first,
           g.id,
           g.is_male,
           g.name,
           s.name AS spouse_name
      FROM g12 g
      LEFT JOIN spouse s ON s.id = g.spouse_id
  ),
  couples AS (
    SELECT p.couple_key,
           min(CASE WHEN p.spouse_first THEN p.spouse_name ELSE p.name END) AS name,
           min(CASE WHEN p.spouse_first THEN p.name ELSE p.spouse_name END) AS spouse_name,
           coalesce(sum(c.male_cells), 0)::bigint AS male_cells,
           coalesce(sum(c.female_cells), 0)::bigint AS female_cells,
           coalesce(sum(c.total_cells), 0)::bigint AS total_cells,
           array_agg(p.id ORDER BY p.is_male DESC, p.id) AS g12_ids                     -- DA-2
      FROM pairs p
      LEFT JOIN per_g12 c ON c.g12_id = p.id
     GROUP BY p.couple_key
  )
  SELECT c.couple_key, c.name, c.spouse_name, c.male_cells, c.female_cells, c.total_cells, c.g12_ids
    FROM couples c
   ORDER BY c.total_cells DESC, c.name, c.couple_key;
END;
$$;

COMMENT ON FUNCTION public.dashboard_g12_ranking() IS
  'E2.14: uma linha por casal G12 visível e ativo, com as células visíveis e ativas pelo '
  'g12_leader_id da cells_view (o filtro G12 da lista de Células) e os g12_ids do link.';

-- ===========================================================================
-- 3. Privilégios
-- ===========================================================================
-- Os privilégios padrão do Supabase dão EXECUTE a anon em função nova de public.
REVOKE ALL ON FUNCTION public.dashboard_summary(timestamptz), public.dashboard_g12_ranking()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(timestamptz), public.dashboard_g12_ranking()
  TO authenticated, service_role;

-- ===========================================================================
-- 4. Pós-condições
-- ===========================================================================
-- As duas invoker, com search_path fixo, EXECUTE para authenticated e não para anon, e os
-- retornos com as colunas do desenho, nesta ordem. proargnames começa pelo parâmetro de
-- entrada (_at) no dashboard_summary; por isso o [2:].
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid IN ('public.dashboard_summary(timestamptz)'::regprocedure,
                              'public.dashboard_g12_ranking()'::regprocedure)
                AND (p.prosecdef OR p.proconfig IS NULL
                     OR has_function_privilege('anon', p.oid, 'EXECUTE')
                     OR NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     OR (SELECT p.proargnames[2:] FROM pg_proc p
          WHERE p.oid = 'public.dashboard_summary(timestamptz)'::regprocedure)
        IS DISTINCT FROM ARRAY['week_start', 'week_end', 'reports_sent', 'cells_pending', 'visitors',
          'cells_not_held', 'members_total', 'members_active', 'members_inactive', 'members_baptized',
          'members_not_baptized', 'members_without_leader', 'members_without_cell_link', 'reports_held',
          'members_new', 'cells_new', 'cells_evangelistic', 'cells_discipleship', 'cells_macrocell']
     OR (SELECT p.proargnames FROM pg_proc p
          WHERE p.oid = 'public.dashboard_g12_ranking()'::regprocedure)
        IS DISTINCT FROM ARRAY['couple_key', 'name', 'spouse_name', 'male_cells', 'female_cells',
          'total_cells', 'g12_ids'] THEN
    RAISE EXCEPTION 'E2.14: modo de segurança, privilégios ou retorno das funções do Dashboard diferentes do desenho.';
  END IF;
END $$;
