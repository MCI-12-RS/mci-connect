-- E2.07 (PR 1, migration 1 de 2) — Vínculo celular numa coluna só. Ver docs/specs/e2-07-filtros-membros.md
-- no repositório apps-mci ("Modelo de dados e migrations", "DDL de referência (migration 1)", "Contratos";
-- RN-08, RN-10, RN-11, RN-12, RN-17; DA-7; DT-06, DT-07, DT-10, DT-15).
--
-- Conteúdo:
--   0. Guarda de pré-requisitos (PR 1 do E2.02, banco do E2.05, PR 1 do E2.06). Falha cedo, sem mudar nada.
--   1. Enums public.member_cell_link e public.member_leadership_status (os rótulos são os valores da URL).
--   2. public.cell_links_or_none(...): completa as categorias com "Sem vínculo" (RN-10 e).
--   3. public.sp_day_start(date): o início do dia de Brasília (RN-12), por sp_instant (o fuso num lugar só).
--   4. members_view recriada (DA-7, DT-15): sem is_cell_leader, is_cell_timothy, is_cell_host e
--      attended_last_30_days; com leadership_status e cell_links no fim. Parte da definição vigente
--      (20261127200300_e205_04_read.sql): as outras colunas, a ordem, os JOINs (inclusive "hr", de
--      private.member_hierarchy), o WHERE (predicado canônico do E2.02 e deleted_at IS NULL), o dono, as
--      opções e os privilégios não mudam (conferidos na pós-condição contra os de antes).
--      O DROP é sem CASCADE: com algum dependente, a migration falha e nada muda. Na segunda execução
--      (a view já sem as colunas antigas, e a members_list do E2.07 dependendo dela), não há DROP: o
--      CREATE OR REPLACE com as mesmas colunas basta.
--   5. dashboard_summary: o corpo do E2.09 (20261127100100), só com os FILTERs de "Sem Liderança" e
--      "Sem Vínculo Celular" trocados pelas colunas novas (RN-11, RN-17).
--   6. Índice members_created_at_idx (RN-12; "Novos membros" do E2.14).
--   7. Privilégios das funções novas.
--   8. Pós-condições.
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos
-- ===========================================================================
DO $$
BEGIN
  IF to_regclass('private.member_hierarchy') IS NULL
     OR to_regprocedure('public.viewer_scope_contains_any(uuid[])') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members'::regclass
                     AND attname = 'created_by_kind' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members_view'::regclass
                     AND attname = 'g12_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'E2.07 depende do PR 1 do E2.06, do banco do E2.05 e do PR 1 do E2.02.';
  END IF;
END $$;

-- ===========================================================================
-- 1. Tipos (DT-08). O front lê as listas de Constants.public.Enums.
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE public.member_cell_link AS ENUM ('leader', 'timothy', 'host', 'attendee', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.member_leadership_status AS ENUM ('with_leader', 'no_leadership', 'pastor');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2. RN-10 (e): "Sem vínculo" = nenhuma categoria de (a) a (d), total de células zero e não pastor(a).
-- ===========================================================================
-- plpgsql, e não sql: o argumento (os EXISTS da view) aparece duas vezes no corpo, então uma função sql
-- não seria inlinada e passaria pelo executor de funções sql a cada linha (medido: cerca de 2,5 µs por
-- linha, +50 ms no Dashboard com 20 mil membros). Em plpgsql, a expressão simples é avaliada direto, e o
-- argumento é calculado uma vez por linha. Sem SET search_path, pelo mesmo motivo (o padrão da DT-14 do
-- E2.09): o corpo só usa pg_catalog e o tipo qualificado. Pura; a view a chama com o papel de quem
-- consulta (EXECUTE para authenticated).
CREATE OR REPLACE FUNCTION public.cell_links_or_none(
  _links public.member_cell_link[], _total_cells integer, _is_pastor boolean)
RETURNS public.member_cell_link[]
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
BEGIN
  RETURN CASE WHEN COALESCE(pg_catalog.cardinality(_links), 0) OPERATOR(pg_catalog.=) 0
                   AND COALESCE(_total_cells, 0) OPERATOR(pg_catalog.=) 0
                   AND NOT COALESCE(_is_pastor, false)
              THEN ARRAY['none']::public.member_cell_link[]
              ELSE COALESCE(_links, '{}'::public.member_cell_link[])
         END;
END
$$;

-- ===========================================================================
-- 3. RN-12: o início do dia de Brasília. O E2.14 usa a mesma para "Novos membros da semana".
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.sp_day_start(_day date)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT public.sp_instant(_day::timestamp)
$$;

-- ===========================================================================
-- 4. members_view (DA-7, DT-15)
-- ===========================================================================
-- Dono, opções e privilégios de antes, para a pós-condição.
CREATE TEMP TABLE e207_members_view_before AS
SELECT pg_get_userbyid(c.relowner) AS owner, c.reloptions, c.relacl
  FROM pg_class c WHERE c.oid = 'public.members_view'::regclass;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members_view'::regclass
              AND attname = 'is_cell_leader' AND NOT attisdropped) THEN
    DROP VIEW public.members_view;   -- sem CASCADE: com algum dependente, falha e nada muda
  END IF;
END $$;

-- Repetir sempre as opções: o CREATE de uma view nova não as herda.
CREATE OR REPLACE VIEW public.members_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  m.id,
  m.name,
  m.gender,
  m.birth_date,
  m.instagram,
  m.avatar_url,
  m.notes,
  m.neighborhood,
  m.city,
  m.state,
  m.is_pastor,
  m.has_leadership,
  m.leader_id,
  l.name AS leader_name,
  m.spouse_id,
  m.is_baptized,
  m.baptism_date,
  m.is_active,
  hr.g12_level,
  coalesce(hr.total_disciples, 0) AS total_disciples,
  coalesce(hr.total_cells, 0) AS total_cells,
  coalesce(hr.male_cells, 0) AS male_cells,
  coalesce(hr.female_cells, 0) AS female_cells,
  CASE WHEN s.role_visible THEN m.role_id END AS role_id,
  m.auth_user_id,
  m.created_at,
  m.updated_at,
  s.sensitive_visible,
  CASE WHEN s.sensitive_visible THEN m.email END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  CASE WHEN s.sensitive_visible THEN m.phone END AS phone,
  CASE WHEN s.sensitive_visible THEN m.street END AS street,
  CASE WHEN s.sensitive_visible THEN m.number END AS number,
  CASE WHEN s.sensitive_visible THEN m.complement END AS complement,
  CASE WHEN s.sensitive_visible THEN m.zip_code END AS zip_code,
  public.search_normalize(concat_ws(' ',
    m.name,
    CASE WHEN s.sensitive_visible THEN m.email END,
    CASE WHEN s.sensitive_visible THEN m.cpf END,
    CASE WHEN s.sensitive_visible THEN regexp_replace(m.cpf, '\D', '', 'g') END
  )) AS search_text,
  sp.name AS spouse_name,
  -- E2.06, no fim (AQ-1, RN-10): o G12 da pessoa, como nome de referência.
  hr.g12_id,
  g12.name AS g12_name,
  -- E2.03 (AQ-2): a recusa previsível da redefinição, na ordem da RN-02.
  CASE WHEN NOT (SELECT public.viewer_has('change_member_password'::public.permission_action)) THEN NULL
       WHEN m.id = (SELECT public.viewer_member_id())                                       THEN 'self'
       -- PR 4 (risco 3): as funções cobertas são calculadas uma vez por consulta (InitPlan), e não
       -- uma vez por linha. A view é security_barrier: a coluna é projetada para toda linha do
       -- escopo antes da ordenação da página. Sem função (NULL), coberta, como viewer_covers_role(NULL).
       WHEN NOT (   m.role_id IS NULL
                 OR m.role_id = ANY (ARRAY(SELECT r.id FROM public.roles r
                                            WHERE public.viewer_covers_role(r.id))))     THEN 'role_not_covered'
       WHEN m.auth_user_id IS NULL                                                           THEN 'no_account'
       ELSE 'allowed'
  END AS password_reset_status,
  -- E2.05 (AQ-1, RN-07, RN-08, DA-11), no fim: a autoria, sem o id do autor. O nome é o atual
  -- (sem filtro de escopo nem de excluídos); o do legado com "Administrador" no lugar de "AdminUser".
  m.created_by_kind,
  CASE m.created_by_kind WHEN 'member' THEN cby.name
                           WHEN 'legacy' THEN public.legacy_author_label(m.created_by_legacy) END AS created_by_name,
  m.updated_by_kind,
  CASE m.updated_by_kind WHEN 'member' THEN uby.name
                           WHEN 'legacy' THEN public.legacy_author_label(m.updated_by_legacy) END AS updated_by_name,
  -- E2.07, no fim. RN-08: a situação de liderança do E2.04 (RN-11 de lá), num lugar só.
  CASE WHEN m.is_pastor         THEN 'pastor'
       WHEN m.leader_id IS NULL THEN 'no_leadership'
       ELSE                          'with_leader'
  END::public.member_leadership_status AS leadership_status,
  -- RN-10 (DT-06): o vínculo celular, numa definição só (o filtro da lista e o card do Dashboard).
  -- Considera todas as células e relatórios da igreja (D-3 do E1.08), e não só os visíveis.
  -- Os EXISTS ficam no nível de cima da view, com igualdade simples: o planejador escolhe entre a
  -- busca por índice (a página) e a tabela hash (o conjunto inteiro). Sem a coluna pedida, nada roda.
  public.cell_links_or_none(
    array_remove(ARRAY[
      CASE WHEN EXISTS (SELECT 1 FROM public.cells c
                         WHERE c.leader_id = m.id AND c.is_active AND c.deleted_at IS NULL)     -- P-FIL-07
           THEN 'leader'::public.member_cell_link END,
      CASE WHEN EXISTS (SELECT 1 FROM public.cells c
                         WHERE c.timothy_id = m.id AND c.is_active AND c.deleted_at IS NULL)
           THEN 'timothy'::public.member_cell_link END,
      CASE WHEN EXISTS (SELECT 1 FROM public.cells c
                         WHERE c.host_id = m.id AND c.is_active AND c.deleted_at IS NULL)
           THEN 'host'::public.member_cell_link END,
      CASE WHEN EXISTS (SELECT 1 FROM public.cell_report_participants p
                          JOIN public.cell_reports r ON r.id = p.report_id
                         WHERE p.member_id = m.id
                           AND r.deleted_at IS NULL AND r.was_held                    -- P-FIL-08, DA-1 do E2.01
                           AND r.date >= public.sp_today() - 30)                     -- P-FIL-09
           THEN 'attendee'::public.member_cell_link END
    ], NULL),
    hr.total_cells, m.is_pastor) AS cell_links
FROM public.members m
LEFT JOIN public.members cby ON cby.id = m.created_by   -- E2.05: só o nome (RN-08)
LEFT JOIN public.members uby ON uby.id = m.updated_by
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.members sp ON sp.id = m.spouse_id
LEFT JOIN private.member_hierarchy hr ON hr.member_id = m.id
LEFT JOIN public.members g12 ON g12.id = hr.g12_id
CROSS JOIN LATERAL (
  SELECT coalesce(m.auth_user_id = (SELECT auth.uid()), false)
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action)) AS sensitive_visible,
         m.id = (SELECT public.viewer_member_id())
      OR (SELECT public.viewer_has('assign_role'::public.permission_action))
      OR (SELECT public.viewer_has('manage_roles'::public.permission_action)) AS role_visible
) s
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
  OR m.id = (SELECT public.viewer_member_id())
)
AND m.deleted_at IS NULL;   -- espelhado em "Members view policy"

ALTER VIEW public.members_view OWNER TO postgres;
-- Os privilégios padrão do Supabase dão tudo a anon e authenticated num objeto novo de public;
-- service_role fica com o padrão, como antes.
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- ===========================================================================
-- 5. dashboard_summary (RN-11, RN-17): o corpo do E2.09, só com os dois FILTERs de membros trocados
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.dashboard_summary(_at timestamptz DEFAULT now())
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
  members_without_cell_link bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- Agora no horário de Brasília; _at nulo vale como agora.
  _local timestamp := public.sp_local(coalesce(_at, now()));
  _ws date := public.week_start(_local::date);
  _we date := _ws + 6;
BEGIN
  PERFORM public._dashboard_assert_access();

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
    mem.members_without_cell_link
  FROM (
    SELECT
      count(*) AS reports_sent,
      coalesce(sum(rv.visitors_count), 0)::bigint AS visitors,
      count(*) FILTER (WHERE NOT rv.was_held) AS cells_not_held
    FROM public.cell_reports_view rv
    WHERE rv.date BETWEEN _ws AND _we
  ) rep
  CROSS JOIN (
    SELECT count(*) AS cells_pending
    FROM public.cells_report_situation(coalesce(_at, now())) s
    WHERE s.report_status = 'pending'::public.cell_report_status
  ) pend
  CROSS JOIN (
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
      ) AS members_without_cell_link
    FROM public.members_view mv
  ) mem;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dashboard_summary(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(timestamptz) TO authenticated;

-- ===========================================================================
-- 6. Data de cadastro (RN-12, DT-10) e "Novos membros" (E2.14)
-- ===========================================================================
-- As comparações de timestamptz são leakproof: o filtro entra na view e usa o índice.
CREATE INDEX IF NOT EXISTS members_created_at_idx
  ON public.members (created_at) WHERE deleted_at IS NULL;

-- ===========================================================================
-- 7. Privilégios das funções novas
-- ===========================================================================
-- Puras; a view as chama com o papel de quem consulta. Ficam authenticated e service_role (scripts
-- que leem a view). Entram na lista fechada do portão (e203_06_gate), como as outras utilitárias.
REVOKE ALL ON FUNCTION public.cell_links_or_none(public.member_cell_link[], integer, boolean),
                       public.sp_day_start(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cell_links_or_none(public.member_cell_link[], integer, boolean),
                          public.sp_day_start(date) TO authenticated, service_role;

-- ===========================================================================
-- 8. Pós-condições
-- ===========================================================================
DO $$
DECLARE
  _cols text[] := ARRAY(SELECT a.attname::text FROM pg_attribute a
                         WHERE a.attrelid = 'public.members_view'::regclass AND a.attnum > 0
                           AND NOT a.attisdropped ORDER BY a.attnum);
BEGIN
  -- Dono, opções e privilégios iguais aos de antes.
  IF (SELECT row(b.owner, b.reloptions, b.relacl)
             IS DISTINCT FROM row(pg_get_userbyid(c.relowner), c.reloptions, c.relacl)
        FROM e207_members_view_before b, pg_class c WHERE c.oid = 'public.members_view'::regclass)
     OR (SELECT reloptions FROM pg_class WHERE oid = 'public.members_view'::regclass)
        IS DISTINCT FROM ARRAY['security_barrier=true', 'security_invoker=false']
     OR NOT has_table_privilege('authenticated', 'public.members_view', 'SELECT')
     OR has_table_privilege('authenticated', 'public.members_view', 'INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_table_privilege('anon', 'public.members_view', 'SELECT') THEN
    RAISE EXCEPTION 'E2.07: members_view com dono, opções ou privilégios diferentes de antes.';
  END IF;
  -- As colunas novas no fim; as antigas fora.
  IF _cols[cardinality(_cols) - 1 : cardinality(_cols)] IS DISTINCT FROM ARRAY['leadership_status', 'cell_links']
     OR _cols && ARRAY['is_cell_leader', 'is_cell_timothy', 'is_cell_host', 'attended_last_30_days'] THEN
    RAISE EXCEPTION 'E2.07: members_view sem as colunas esperadas.';
  END IF;
  -- Nenhuma função citando as colunas que saíram.
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'private')
                AND p.prosrc ~ '\m(is_cell_leader|is_cell_timothy|is_cell_host|attended_last_30_days)\M') THEN
    RAISE EXCEPTION 'E2.07: ainda há função citando as colunas de vínculo removidas.';
  END IF;
END $$;

DROP TABLE pg_temp.e207_members_view_before;
