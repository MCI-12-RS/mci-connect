-- E2.05 (PR 1, migration 4 de 6) — Auditoria: leitura. Ver docs/specs/e2-05-auditoria-autor.md no
-- repositório apps-mci ("Leitura": "Autoria nas views", "events_view", "Histórico de um
-- registro"; RN-07, RN-08, RN-11, RN-18, RN-19; AQ-1 a AQ-3; DT-12, DT-15).
--
-- Conteúdo:
--   1. As seis views com a autoria no fim (CREATE OR REPLACE VIEW: as mesmas colunas, na mesma
--      ordem, e as novas no fim). Cada uma parte da definição vigente:
--        members_view      — 20261127000000_e203_05_gate.sql
--        cells_view        — 20261127100100_e209_02_report_situation.sql
--        cell_reports_view e as três de excluídos — 20261125140200_e202_03_read.sql
--      O WHERE de nenhuma muda: a autoria vem com o registro para quem pode lê-lo (RN-07), e as
--      três formas do escopo (view, política, função de linha) continuam iguais. Continuam
--      security definer com security_barrier (armadilha do E1.08). O nome do autor vem por junção
--      sem filtro de escopo nem de excluídos, só o nome e o tipo (RN-08, DA-11); as listas não
--      pedem essas colunas, e o planejador tira as duas junções do plano.
--      Nas de excluídos: deleted_by_kind no fim, e deleted_by_name passa a trazer também o nome
--      do legado (RN-11).
--   2. public.audit_assert_access(): o portão da Auditoria (42501 sem "Visualizar Auditoria").
--   3. public.events_view: a Auditoria paginada pelo PostgREST, com o total exato, o período pela data
--      de Brasília (occurred_on) e a busca em search_text (DT-12), com o portão audit_assert_access()
--      (security definer, sem security_barrier: DT-25).
--   4. public.audit_record_label(): o título do histórico de um registro (AQ-3).
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 1. Autoria nas views (AQ-1)
-- ===========================================================================
-- members_view
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
  EXISTS (SELECT 1 FROM public.cells c WHERE c.leader_id = m.id AND c.deleted_at IS NULL) AS is_cell_leader,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.timothy_id = m.id AND c.deleted_at IS NULL) AS is_cell_timothy,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.host_id = m.id AND c.deleted_at IS NULL) AS is_cell_host,
  m.id IN (
    SELECT p.member_id
      FROM public.cell_report_participants p
      JOIN public.cell_reports r ON r.id = p.report_id
     WHERE r.date >= public.sp_today() - 30
       AND r.deleted_at IS NULL
  ) AS attended_last_30_days,
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
                           WHEN 'legacy' THEN public.legacy_author_label(m.updated_by_legacy) END AS updated_by_name
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
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- cells_view
CREATE OR REPLACE VIEW public.cells_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  c.id,
  c.leader_id,
  c.timothy_id,
  c.host_id,
  c.type,
  c.meeting_day,
  c.meeting_time,
  c.street,
  c.number,
  c.complement,
  c.neighborhood,
  c.city,
  c.state,
  c.zip_code,
  c.is_active,
  c.created_at,
  c.updated_at,
  public.weekday_index(c.meeting_day) AS meeting_weekday,
  l.name AS leader_name,
  l.gender AS leader_gender,
  lhr.g12_level AS leader_g12_level,
  t.name AS timothy_name,
  h.name AS host_name,
  lhr.g12_id AS g12_leader_id,
  g12.name AS g12_leader_name,
  -- Contrato do E1.08; não entra no cálculo da situação (DT-02).
  (SELECT max(r.date) FROM public.cell_reports r WHERE r.cell_id = c.id AND r.deleted_at IS NULL) AS last_report_date,
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text,
  -- DT-07 do E2.08: o direito de lançar do E2.02 (can_submit_report(uuid)) com a célula ativa.
  c.is_active AND (
       (SELECT public.viewer_has('edit_cell'::public.permission_action))
    OR (SELECT public.viewer_has('submit_any_visible_report'::public.permission_action))
    OR (     (SELECT public.viewer_has('submit_own_cell_report'::public.permission_action))
         AND coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false))
  ) AS can_submit_report,
  coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false) AS is_mine,
  coalesce(l.is_pastor, false) AS leader_is_pastor,
  rs.report_status,                         -- RN-04, RN-07; nulo na célula inativa
  rs.report_missing_weeks,                   -- RN-05: 0 a 4 ("4 ou mais"); nulo sem contagem (DA-6)
  -- E2.05 (AQ-1, RN-07, RN-08, DA-11), no fim: a autoria, sem o id do autor. O nome é o atual
  -- (sem filtro de escopo nem de excluídos); o do legado com "Administrador" no lugar de "AdminUser".
  c.created_by_kind,
  CASE c.created_by_kind WHEN 'member' THEN cby.name
                           WHEN 'legacy' THEN public.legacy_author_label(c.created_by_legacy) END AS created_by_name,
  c.updated_by_kind,
  CASE c.updated_by_kind WHEN 'member' THEN uby.name
                           WHEN 'legacy' THEN public.legacy_author_label(c.updated_by_legacy) END AS updated_by_name
FROM public.cells c
LEFT JOIN public.members cby ON cby.id = c.created_by   -- E2.05: só o nome (RN-08)
LEFT JOIN public.members uby ON uby.id = c.updated_by
LEFT JOIN public.members l ON l.id = c.leader_id
LEFT JOIN public.members t ON t.id = c.timothy_id
LEFT JOIN public.members h ON h.id = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
LEFT JOIN private.member_hierarchy lhr ON lhr.member_id = c.leader_id
LEFT JOIN public.members g12 ON g12.id = lhr.g12_id
LEFT JOIN LATERAL (
  -- Um agregado sem GROUP BY devolve sempre uma linha: é o que deixa o
  -- planejador remover esta junção quando nenhuma das duas colunas é pedida
  -- (DT-06). "Agora" = now(), o início da transação: o mesmo instante para a
  -- página e para o total.
  SELECT max(s.report_status)        AS report_status,
         max(s.report_missing_weeks) AS report_missing_weeks
    FROM private.cell_report_situation(c.id, c.is_active, c.meeting_day, c.meeting_time, now()) s
) rs ON true
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (   c.leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR c.leader_id = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR c.host_id = (SELECT public.viewer_member_id())
)
AND c.deleted_at IS NULL;   -- espelhado em "Cells view policy"

ALTER VIEW public.cells_view OWNER TO postgres;
REVOKE ALL ON public.cells_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_view TO authenticated;

-- cell_reports_view
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
  public.search_normalize(concat_ws(' ', cl.name, r.theme)) AS search_text,
  c.deleted_at IS NOT NULL AS cell_deleted,
  -- E2.05 (AQ-1, RN-07, RN-08, DA-11), no fim: a autoria, sem o id do autor. O nome é o atual
  -- (sem filtro de escopo nem de excluídos); o do legado com "Administrador" no lugar de "AdminUser".
  r.created_by_kind,
  CASE r.created_by_kind WHEN 'member' THEN cby.name
                           WHEN 'legacy' THEN public.legacy_author_label(r.created_by_legacy) END AS created_by_name,
  r.updated_by_kind,
  CASE r.updated_by_kind WHEN 'member' THEN uby.name
                           WHEN 'legacy' THEN public.legacy_author_label(r.updated_by_legacy) END AS updated_by_name
FROM public.cell_reports r
LEFT JOIN public.members cby ON cby.id = r.created_by   -- E2.05: só o nome (RN-08)
LEFT JOIN public.members uby ON uby.id = r.updated_by
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
WHERE (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
       AND (   c.leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR c.leader_id = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR c.host_id = (SELECT public.viewer_member_id())
)
AND r.deleted_at IS NULL;   -- espelhado em "Cell reports view policy"

ALTER VIEW public.cell_reports_view OWNER TO postgres;
REVOKE ALL ON public.cell_reports_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_view TO authenticated;

-- members_deleted_view
CREATE OR REPLACE VIEW public.members_deleted_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  m.id,
  m.name,
  m.gender,
  m.is_active,
  m.is_pastor,
  m.neighborhood,
  m.city,
  m.leader_id,
  l.name AS leader_name,
  l.deleted_at IS NOT NULL AS leader_deleted,
  m.role_id,
  r.name AS role_name,
  CASE WHEN m.role_id IS NULL AND m.auth_user_id IS NOT NULL THEN dr.name ELSE r.name END AS restore_role_name,
  m.role_id IS NULL AND m.auth_user_id IS NOT NULL AND dr.id IS NOT NULL AS role_reset_on_restore,
  m.auth_user_id IS NOT NULL AS has_account,
  s.sensitive_visible,
  CASE WHEN s.sensitive_visible THEN m.email END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  m.deleted_at,
  m.deleted_by,
  CASE m.deleted_by_kind WHEN 'legacy' THEN public.legacy_author_label(m.deleted_by_legacy)
                           ELSE d.name END AS deleted_by_name,   -- E2.05 (RN-11): também o do legado
  public.search_normalize(concat_ws(' ',
    m.name,
    CASE WHEN s.sensitive_visible THEN m.email END,
    CASE WHEN s.sensitive_visible THEN m.cpf END,
    CASE WHEN s.sensitive_visible THEN regexp_replace(m.cpf, '\D', '', 'g') END
  )) AS search_text,
  m.deleted_by_kind   -- E2.05 (RN-11, T6), no fim
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.roles r ON r.id = m.role_id
LEFT JOIN public.roles dr ON dr.is_default
LEFT JOIN public.members d ON d.id = m.deleted_by
CROSS JOIN LATERAL (
  SELECT coalesce(m.auth_user_id = (SELECT auth.uid()), false)
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action)) AS sensitive_visible
) s
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
AND (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
  OR m.id = (SELECT public.viewer_member_id())
)
AND m.deleted_at IS NOT NULL;

ALTER VIEW public.members_deleted_view OWNER TO postgres;
REVOKE ALL ON public.members_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_deleted_view TO authenticated;

-- cells_deleted_view
CREATE OR REPLACE VIEW public.cells_deleted_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  c.id,
  c.type,
  c.meeting_day,
  public.weekday_index(c.meeting_day) AS meeting_weekday,
  c.meeting_time,
  c.street,
  c.number,
  c.neighborhood,
  c.city,
  c.is_active,
  c.leader_id,
  l.name AS leader_name,
  l.deleted_at IS NOT NULL AS leader_deleted,
  c.timothy_id,
  t.name AS timothy_name,
  t.deleted_at IS NOT NULL AS timothy_deleted,
  c.host_id,
  h.name AS host_name,
  h.deleted_at IS NOT NULL AS host_deleted,
  c.deleted_at,
  c.deleted_by,
  CASE c.deleted_by_kind WHEN 'legacy' THEN public.legacy_author_label(c.deleted_by_legacy)
                           ELSE d.name END AS deleted_by_name,   -- E2.05 (RN-11): também o do legado
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text,
  c.deleted_by_kind   -- E2.05 (RN-11, T6), no fim
FROM public.cells c
LEFT JOIN public.members l ON l.id = c.leader_id
LEFT JOIN public.members t ON t.id = c.timothy_id
LEFT JOIN public.members h ON h.id = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
LEFT JOIN public.members d ON d.id = c.deleted_by
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
AND (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (   c.leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR c.leader_id = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR c.host_id = (SELECT public.viewer_member_id())
)
AND c.deleted_at IS NOT NULL;

ALTER VIEW public.cells_deleted_view OWNER TO postgres;
REVOKE ALL ON public.cells_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_deleted_view TO authenticated;

-- cell_reports_deleted_view
CREATE OR REPLACE VIEW public.cell_reports_deleted_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.id,
  r.cell_id,
  r.date,
  r.time,
  r.was_held,
  r.theme,
  r.reason_not_held,
  public.week_start(r.date) AS week_start,
  c.leader_id AS cell_leader_id,
  cl.name AS cell_leader_name,
  c.deleted_at IS NOT NULL AS cell_deleted,
  EXISTS (
    SELECT 1 FROM public.cell_reports o
     WHERE o.cell_id = r.cell_id
       AND public.week_start(o.date) = public.week_start(r.date)
       AND o.deleted_at IS NULL
  ) AS week_taken,
  r.deleted_at,
  r.deleted_by,
  CASE r.deleted_by_kind WHEN 'legacy' THEN public.legacy_author_label(r.deleted_by_legacy)
                           ELSE d.name END AS deleted_by_name,   -- E2.05 (RN-11): também o do legado
  public.search_normalize(concat_ws(' ', cl.name, r.theme)) AS search_text,
  r.deleted_by_kind   -- E2.05 (RN-11, T6), no fim
FROM public.cell_reports r
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
LEFT JOIN public.members d ON d.id = r.deleted_by
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
AND (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
       AND (   c.leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR c.leader_id = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR c.host_id = (SELECT public.viewer_member_id())
)
AND r.deleted_at IS NOT NULL;

ALTER VIEW public.cell_reports_deleted_view OWNER TO postgres;
REVOKE ALL ON public.cell_reports_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_deleted_view TO authenticated;

-- ===========================================================================
-- 2. O portão da Auditoria (AQ-2, RN-18)
-- ===========================================================================
-- Devolve true ou levanta 42501. Não depende da linha: na view, o Postgres a roda uma vez,
-- antes de ler (One-Time Filter), e o erro sai mesmo com a tabela vazia e na contagem. Passa pelo
-- portão do E2.03 (viewer_has).
CREATE OR REPLACE FUNCTION public.audit_assert_access()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.viewer_has('view_audit_log'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_assert_access() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.audit_assert_access() TO authenticated;

-- ===========================================================================
-- 3. events_view (AQ-2, DT-12)
-- ===========================================================================
-- Security definer e sem security_barrier, de propósito (DT-25): o portão é audit_assert_access(), a
-- mesma permissão da política de SELECT de events ("Visualizar Auditoria"). Ele não depende da linha,
-- então vira um One-Time Filter acima da leitura e roda antes de qualquer linha ser lida (o erro sai
-- antes). Com security_invoker, o RLS de events entraria como qual de barreira, e os filtros da tela
-- com operador que não é leakproof (ilike da busca, = de enum em ação e entidade) não poderiam usar
-- índice: a busca levava cerca de 1 s com 300 mil eventos (risco 4). A tabela continua com a política
-- (leitura direta) e sem escrita pela API. actor_user_id não sai.
CREATE OR REPLACE VIEW public.events_view
WITH (security_invoker = false) AS
SELECT
  e.id,
  e.occurred_at,
  (e.occurred_at AT TIME ZONE 'America/Sao_Paulo')::date AS occurred_on,   -- RN-18: datas de Brasília
  e.seq,
  e.actor_kind,
  e.actor_label,
  e.action,
  e.entity,
  e.entity_id,
  e.entity_label,
  e.description,
  e.changed_fields,
  e.changes,
  e.metadata,
  e.success,
  e.error_reason,
  e.search_text
FROM public.events e
WHERE (SELECT public.audit_assert_access());          -- portão: 42501 sem "Visualizar Auditoria"

ALTER VIEW public.events_view OWNER TO postgres;
REVOKE ALL ON public.events_view FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.events_view TO authenticated;

-- ===========================================================================
-- 4. Título do histórico de um registro (AQ-3, RN-19)
-- ===========================================================================
-- Quem audita vê a igreja toda: lê as tabelas sem filtro de excluídos; deleted liga o selo.
-- Registro inexistente: nenhuma linha.
CREATE OR REPLACE FUNCTION public.audit_record_label(_record_type public.event_entity, _record_id uuid)
RETURNS TABLE (name text, leader_name text, report_date date, deleted boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.viewer_has('view_audit_log'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _record_type = 'member' THEN
    RETURN QUERY SELECT m.name, NULL::text, NULL::date, m.deleted_at IS NOT NULL
                   FROM public.members m WHERE m.id = _record_id;
  ELSIF _record_type = 'cell' THEN
    RETURN QUERY SELECT NULL::text, l.name, NULL::date, c.deleted_at IS NOT NULL
                   FROM public.cells c LEFT JOIN public.members l ON l.id = c.leader_id
                  WHERE c.id = _record_id;
  ELSIF _record_type = 'cell_report' THEN
    RETURN QUERY SELECT NULL::text, l.name, r.date, r.deleted_at IS NOT NULL
                   FROM public.cell_reports r
                   JOIN public.cells c ON c.id = r.cell_id
                   LEFT JOIN public.members l ON l.id = c.leader_id
                  WHERE r.id = _record_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.audit_record_label(public.event_entity, uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.audit_record_label(public.event_entity, uuid) TO authenticated;
