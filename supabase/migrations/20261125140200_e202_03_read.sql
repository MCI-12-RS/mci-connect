-- E2.02 (PR 1, migration 3) — Leitura no escopo novo.
-- Ver docs/specs/e2-02-perfis-escopo.md no repositório apps-mci ("Leitura
-- (migration 3)", RN-01 a RN-08, RN-15, RN-22, RN-23, DA-6, DA-12, DT-03 a
-- DT-05, DT-11, DT-16 a DT-19, DT-23 a DT-25, DT-28).
--
-- Predicados canônicos. O escopo de cada entidade aparece em três formas, e as
-- três são conferidas pelo mesmo teste de paridade, por persona. Mudou uma,
-- mude as outras.
--
--   church   = (SELECT viewer_has('view_all_church'))
--   ministry = (SELECT viewer_has('view_own_ministry'))
--   reports  = (SELECT viewer_has('view_own_reports'))
--   me       = (SELECT viewer_member_id())
--   ids      = (SELECT viewer_ministry_member_ids())          -- descida, nas views
--   scope(x) = viewer_scope_contains_any(ARRAY[x, ...])       -- subida, nas políticas
--
--   | Entidade     | Regra (RN-02 a RN-04)                     | View (em conjunto)                         | Política e função de linha (por linha)             |
--   |--------------|-------------------------------------------|--------------------------------------------|----------------------------------------------------|
--   | Membro       | church OR (ministry AND no escopo)        | m.id IN ids                                | scope(id) / viewer_sees_member(id)                 |
--   |              | OR é quem consulta                        | OR m.id = me                               | OR id = me                                         |
--   | Célula       | church OR (ministry AND alguma pessoa no  | leader/timothy/host IN ids                 | scope(leader, timothy, host)                       |
--   |              | escopo) OR quem consulta é pessoa dela    | OR me IN (leader, timothy, host)           | / viewer_sees_cell_people(...)                     |
--   | Relatório    | view_all_reports OR church OR ((ministry  | idem, sobre c.* (pessoas atuais da célula, | cell_in_viewer_ministry(cell_id)                   |
--   |              | OR reports) AND alguma pessoa da célula   | DA-12)                                     | OR viewer_is_cell_person(cell_id)                  |
--   |              | no escopo) OR quem consulta é pessoa dela |                                            |                                                    |
--   | Participante | o relatório é visível                     | JOIN cell_reports_view                     | EXISTS em cell_reports (pelo RLS dela, DT-05)      |
--
--   - Todas terminam com AND deleted_at IS NULL, fora dos parênteses (E2.01).
--   - view_members e view_own_ministry_dashboard não aparecem em nenhum
--     predicado (RN-22). Elas também não valem mais em viewer_has (migration 2).
--   - As views de excluídos usam o mesmo predicado da principal, com o filtro
--     manage_roles do E2.01 (DA-10 do E2.01) e deleted_at IS NOT NULL (RN-15).
--   - As views continuam security definer com security_barrier, donas
--     postgres, só com SELECT para authenticated. Colunas existentes iguais e
--     na mesma ordem; as novas no fim (risco 5 do E1.08).
--
-- Também nesta migration:
--   - políticas de todas as tabelas (com viewer_has no lugar de
--     user_has_permission/is_admin, DT-11), inclusive as de escrita, porque as
--     de INSERT dependem das viewer_can_insert_* (E2.01, PR 2), que deixam de
--     usar can_manage_own_cell;
--   - member_names, ministry_tree_nodes (ramo de raízes, DA-6),
--     _dashboard_assert_access (só view_dashboard), my_access, role_options e
--     roles_view;
--   - REVOKE de is_admin e DROP das quatro funções de escopo obsoletas. O
--     REVOKE de user_has_permission fica para a migration 4, depois que o
--     trigger de members (INVOKER) deixa de chamá-la.
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE, DROP ... IF EXISTS antes de
-- cada CREATE POLICY e grants.

-- ===========================================================================
-- 1. Views principais (E1.08)
-- ===========================================================================

-- members_view: WHERE espelha "Members view policy". Coluna nova: spouse_name,
-- o nome de referência do cônjuge (DT-23).
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
  m.g12_level,
  m.total_disciples,
  m.total_cells,
  m.male_cells,
  m.female_cells,
  m.role_id,
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
  sp.name AS spouse_name
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.members sp ON sp.id = m.spouse_id
CROSS JOIN LATERAL (
  SELECT coalesce(m.auth_user_id = (SELECT auth.uid()), false)
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action)) AS sensitive_visible
) s
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
  OR m.id = (SELECT public.viewer_member_id())
)
AND m.deleted_at IS NULL;   -- espelhado em "Members view policy"
-- Consolidação: o filtro ou a coluna do consolidado entra aqui.

REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- cells_view: WHERE espelha "Cells view policy", com o anfitrião no item (d).
-- O G12 vem da árvore real (DT-25): o membro logo abaixo do topo na cadeia do
-- líder, por uma subconsulta recursiva correlacionada no próprio SQL, sem
-- função exposta. Só é calculado quando a coluna é pedida. Líder no topo
-- (pastor ou sem liderança) ou cadeia com ciclo: sem G12.
-- Colunas novas: can_submit_report (a regra de can_submit_report(), AQ-4;
-- toda linha da view já é visível), is_mine e leader_is_pastor.
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
  l.g12_level AS leader_g12_level,
  t.name AS timothy_name,
  h.name AS host_name,
  (
    WITH RECURSIVE up(id, leader_id, path) AS (
      SELECT m.id, m.leader_id, ARRAY[m.id] FROM public.members m WHERE m.id = c.leader_id
      UNION ALL
      SELECT p.id, p.leader_id, up.path || p.id
        FROM up JOIN public.members p ON p.id = up.leader_id
       WHERE NOT p.id = ANY (up.path)
    )
    SELECT up.id
      FROM up JOIN public.members top ON top.id = up.leader_id AND top.leader_id IS NULL
     LIMIT 1
  ) AS g12_leader_id,
  (
    SELECT g.name
      FROM public.members g
     WHERE g.id = (
       WITH RECURSIVE up(id, leader_id, path) AS (
         SELECT m.id, m.leader_id, ARRAY[m.id] FROM public.members m WHERE m.id = c.leader_id
         UNION ALL
         SELECT p.id, p.leader_id, up.path || p.id
           FROM up JOIN public.members p ON p.id = up.leader_id
          WHERE NOT p.id = ANY (up.path)
       )
       SELECT up.id
         FROM up JOIN public.members top ON top.id = up.leader_id AND top.leader_id IS NULL
        LIMIT 1
     )
  ) AS g12_leader_name,
  (SELECT max(r.date) FROM public.cell_reports r WHERE r.cell_id = c.id AND r.deleted_at IS NULL) AS last_report_date,
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text,
  (    (SELECT public.viewer_has('edit_cell'::public.permission_action))
    OR (SELECT public.viewer_has('submit_any_visible_report'::public.permission_action))
    OR (     (SELECT public.viewer_has('submit_own_cell_report'::public.permission_action))
         AND coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false))
  ) AS can_submit_report,
  coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false) AS is_mine,
  coalesce(l.is_pastor, false) AS leader_is_pastor
FROM public.cells c
LEFT JOIN public.members l ON l.id = c.leader_id
LEFT JOIN public.members t ON t.id = c.timothy_id
LEFT JOIN public.members h ON h.id = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
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

REVOKE ALL ON public.cells_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_view TO authenticated;

-- cell_reports_view: WHERE espelha "Cell reports view policy", com
-- view_own_reports e o anfitrião (RN-04, DT-04). Pessoas atuais da célula
-- até o E2.11 (DA-12). Nenhuma coluna nova.
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
  c.deleted_at IS NOT NULL AS cell_deleted
FROM public.cell_reports r
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

REVOKE ALL ON public.cell_reports_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_view TO authenticated;

-- cell_report_participants_view: acompanha o relatório. Coluna nova:
-- member_visible (o participante está na members_view de quem consulta: não
-- excluído e no predicado de membro; AQ-7).
CREATE OR REPLACE VIEW public.cell_report_participants_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  p.report_id,
  p.member_id,
  m.name AS member_name,
  m.deleted_at IS NOT NULL AS member_deleted,
  coalesce(
        m.deleted_at IS NULL
    AND (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
          OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
               AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
          OR m.id = (SELECT public.viewer_member_id())),
    false) AS member_visible
FROM public.cell_report_participants p
JOIN public.cell_reports_view r ON r.id = p.report_id
LEFT JOIN public.members m ON m.id = p.member_id;

REVOKE ALL ON public.cell_report_participants_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_report_participants_view TO authenticated;

-- ===========================================================================
-- 2. Views de excluídos (E2.01): o mesmo predicado da principal (RN-15)
-- ===========================================================================
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
  d.name AS deleted_by_name,
  public.search_normalize(concat_ws(' ',
    m.name,
    CASE WHEN s.sensitive_visible THEN m.email END,
    CASE WHEN s.sensitive_visible THEN m.cpf END,
    CASE WHEN s.sensitive_visible THEN regexp_replace(m.cpf, '\D', '', 'g') END
  )) AS search_text
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

REVOKE ALL ON public.members_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_deleted_view TO authenticated;

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
  d.name AS deleted_by_name,
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text
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

REVOKE ALL ON public.cells_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_deleted_view TO authenticated;

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
  d.name AS deleted_by_name,
  public.search_normalize(concat_ws(' ', cl.name, r.theme)) AS search_text
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

REVOKE ALL ON public.cell_reports_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_deleted_view TO authenticated;

-- ===========================================================================
-- 3. roles_view (AQ-2, DT-17)
-- ===========================================================================
-- As funções com as permissões efetivas (sem as aposentadas, na ordem do enum)
-- e a contagem de membros não excluídos. Só com "Visualizar Funções" ou
-- "Gerenciar Funções". Security definer de propósito (o advisor acusa).
CREATE OR REPLACE VIEW public.roles_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.id,
  r.name,
  r.description,
  r.is_system AS is_protected,
  r.is_default,
  ARRAY(
    SELECT p
      FROM unnest(public.active_permissions()) AS p
     WHERE r.is_system
        OR EXISTS (SELECT 1 FROM public.role_permissions rp
                    WHERE rp.role_id = r.id AND rp.permission = p)
     ORDER BY p
  ) AS permissions,
  (SELECT count(*) FROM public.members m WHERE m.role_id = r.id AND m.deleted_at IS NULL) AS members_count,
  r.updated_at
FROM public.roles r
WHERE (SELECT public.viewer_has('view_roles'::public.permission_action))
   OR (SELECT public.viewer_has('manage_roles'::public.permission_action));

ALTER VIEW public.roles_view OWNER TO postgres;
REVOKE ALL ON public.roles_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.roles_view TO authenticated;

-- ===========================================================================
-- 4. Predicados de INSERT (E2.01, PR 2): fonte da política e do trigger
--    a0_check_insert_permission
-- ===========================================================================
-- Ficam com a parte da permissão (42501 no trigger a0_, o primeiro BEFORE).
-- O escopo do relatório (RN-13) não entra em viewer_can_insert_cell_report:
-- as recusas amigáveis (not_found_or_deleted, report_submit_not_allowed) vêm do
-- trigger ab_enforce_cell_report_scope (migration 4), que roda depois do aa_ do
-- E2.01 (o excluído tem prioridade sobre o invisível). A política de INSERT
-- soma can_submit_report, como última barreira.
-- Sai "Editar Próprio Cadastro" como direito de lançar (RN-13).

-- cells: só a permissão (as pessoas escolhidas são do trigger ab_enforce_cell_scope).
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('create_cell'::public.permission_action)
$$;

-- cell_reports: alguma permissão de lançar (RN-13). _cell_id fica pela
-- assinatura do E2.01; o escopo é can_submit_report(_cell_id).
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell_report(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('edit_cell'::public.permission_action)
      OR public.viewer_has('submit_any_visible_report'::public.permission_action)
      OR public.viewer_has('submit_own_cell_report'::public.permission_action)
$$;

-- cell_report_participants (DA-5): com "Editar Relatórios de Células", em
-- relatório visível; senão, só quem pode lançar a célula e só na semana atual
-- (sp_today). Relatório inexistente ou excluído (ou de célula excluída) passa
-- aqui para quem tem alguma permissão de gravar relatório: a recusa sai do
-- aa_enforce_participant_rules, com a mensagem do E2.01, e a política barra de
-- qualquer jeito.
-- A política de INSERT chama esta função uma vez por participante (risco 8):
-- por isso ela lê a linha de cell_reports direto e confere a visibilidade pela
-- forma por id do predicado da cell_reports_view ("Cell reports view policy"),
-- sem ler a view (que expande viewer_ministry_member_ids a cada chamada).
-- Mudou o predicado da view ou da política, mude aqui também.
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell_report_participant(_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cell_id uuid;
  _week date;
BEGIN
  IF NOT (    public.viewer_has('edit_cell_report'::public.permission_action)
           OR public.viewer_has('edit_cell'::public.permission_action)
           OR public.viewer_has('submit_any_visible_report'::public.permission_action)
           OR public.viewer_has('submit_own_cell_report'::public.permission_action)) THEN
    RETURN false;
  END IF;

  SELECT r.cell_id, public.week_start(r.date)
    INTO _cell_id, _week
    FROM public.cell_reports r
    JOIN public.cells c ON c.id = r.cell_id
   WHERE r.id = _report_id
     AND r.deleted_at IS NULL
     AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN true;          -- o aa_enforce_participant_rules responde
  END IF;

  -- Relatório visível (o WHERE da cell_reports_view, por id).
  IF NOT (    public.viewer_has('view_all_reports'::public.permission_action)
           OR public.viewer_has('view_all_church'::public.permission_action)
           OR public.viewer_is_cell_person(_cell_id)
           OR (    (    public.viewer_has('view_own_ministry'::public.permission_action)
                     OR public.viewer_has('view_own_reports'::public.permission_action))
               AND public.cell_in_viewer_ministry(_cell_id))) THEN
    RETURN false;
  END IF;

  RETURN public.viewer_has('edit_cell_report'::public.permission_action)
      OR (    _week = public.week_start(public.sp_today())
          AND public.can_submit_report(_cell_id));
END;
$$;

REVOKE ALL ON FUNCTION public.viewer_can_insert_cell() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_can_insert_cell_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_can_insert_cell_report_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.viewer_can_insert_cell(),
  public.viewer_can_insert_cell_report(uuid),
  public.viewer_can_insert_cell_report_participant(uuid)
TO authenticated, service_role;

-- ===========================================================================
-- 5. Políticas de RLS
-- ===========================================================================
-- members
DROP POLICY IF EXISTS "Members view policy" ON public.members;
CREATE POLICY "Members view policy" ON public.members FOR SELECT TO authenticated
USING (
  (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR ((SELECT public.viewer_has('view_own_ministry'::public.permission_action))
        AND public.viewer_scope_contains_any(ARRAY[id]))
    OR id = (SELECT public.viewer_member_id()) )
  AND deleted_at IS NULL                 -- espelhado na members_view
);

DROP POLICY IF EXISTS "Members update policy" ON public.members;
CREATE POLICY "Members update policy" ON public.members FOR UPDATE TO authenticated
USING (
  (    (    (SELECT public.viewer_has('edit_member'::public.permission_action))
        AND (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
              OR ((SELECT public.viewer_has('view_own_ministry'::public.permission_action))
                  AND public.viewer_scope_contains_any(ARRAY[id]))
              OR id = (SELECT public.viewer_member_id())))
    OR (    (SELECT public.viewer_has('edit_own_data'::public.permission_action))
        AND id = (SELECT public.viewer_member_id())) )
  AND deleted_at IS NULL
)
WITH CHECK (
  (    (    (SELECT public.viewer_has('edit_member'::public.permission_action))
        AND (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
              OR ((SELECT public.viewer_has('view_own_ministry'::public.permission_action))
                  AND public.viewer_scope_contains_any(ARRAY[id]))
              OR id = (SELECT public.viewer_member_id())))
    OR (    (SELECT public.viewer_has('edit_own_data'::public.permission_action))
        AND id = (SELECT public.viewer_member_id())) )
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users with create_member can insert" ON public.members;
CREATE POLICY "Users with create_member can insert" ON public.members FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.viewer_has('create_member'::public.permission_action))
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

-- cells
DROP POLICY IF EXISTS "Cells view policy" ON public.cells;
CREATE POLICY "Cells view policy" ON public.cells FOR SELECT TO authenticated
USING (
  (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR ((SELECT public.viewer_has('view_own_ministry'::public.permission_action))
        AND public.viewer_scope_contains_any(ARRAY[leader_id, timothy_id, host_id]))
    OR (SELECT public.viewer_member_id()) IN (leader_id, timothy_id, host_id) )
  AND deleted_at IS NULL                 -- espelhado na cells_view
);

-- RN-12: só com "Editar Célula" (sai o ramo edit_own_data), na célula visível.
DROP POLICY IF EXISTS "Cells update policy" ON public.cells;
CREATE POLICY "Cells update policy" ON public.cells FOR UPDATE TO authenticated
USING (
  (SELECT public.viewer_has('edit_cell'::public.permission_action))
  AND (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
        OR ((SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            AND public.viewer_scope_contains_any(ARRAY[leader_id, timothy_id, host_id]))
        OR (SELECT public.viewer_member_id()) IN (leader_id, timothy_id, host_id) )
  AND deleted_at IS NULL
)
WITH CHECK (
  (SELECT public.viewer_has('edit_cell'::public.permission_action))
  AND (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
        OR ((SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            AND public.viewer_scope_contains_any(ARRAY[leader_id, timothy_id, host_id]))
        OR (SELECT public.viewer_member_id()) IN (leader_id, timothy_id, host_id) )
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users with create_cell can insert" ON public.cells;
CREATE POLICY "Users with create_cell can insert" ON public.cells FOR INSERT TO authenticated
WITH CHECK (
  public.viewer_can_insert_cell()
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

-- cell_reports
DROP POLICY IF EXISTS "Cell reports view policy" ON public.cell_reports;
CREATE POLICY "Cell reports view policy" ON public.cell_reports FOR SELECT TO authenticated
USING (
  (    (SELECT public.viewer_has('view_all_reports'::public.permission_action))
    OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR (    (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
             OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
        AND public.cell_in_viewer_ministry(cell_id))
    OR public.viewer_is_cell_person(cell_id) )
  AND deleted_at IS NULL                 -- espelhado na cell_reports_view
);

-- RN-14: "Editar Relatórios de Células", só em relatório visível.
DROP POLICY IF EXISTS "Cell reports update policy" ON public.cell_reports;
CREATE POLICY "Cell reports update policy" ON public.cell_reports FOR UPDATE TO authenticated
USING (
  (SELECT public.viewer_has('edit_cell_report'::public.permission_action))
  AND (    (SELECT public.viewer_has('view_all_reports'::public.permission_action))
        OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
        OR (    (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
                 OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
            AND public.cell_in_viewer_ministry(cell_id))
        OR public.viewer_is_cell_person(cell_id) )
  AND deleted_at IS NULL
)
WITH CHECK (
  (SELECT public.viewer_has('edit_cell_report'::public.permission_action))
  AND (    (SELECT public.viewer_has('view_all_reports'::public.permission_action))
        OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
        OR (    (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
                 OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
            AND public.cell_in_viewer_ministry(cell_id))
        OR public.viewer_is_cell_person(cell_id) )
  AND deleted_at IS NULL
);

-- RN-13: alguma permissão de lançar (a0_) e o direito nesta célula.
DROP POLICY IF EXISTS "Cell reports insert policy" ON public.cell_reports;
CREATE POLICY "Cell reports insert policy" ON public.cell_reports FOR INSERT TO authenticated
WITH CHECK (
  public.viewer_can_insert_cell_report(cell_id)
  AND public.can_submit_report(cell_id)
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

-- cell_report_participants: delegam ao RLS de cell_reports (DT-05).
DROP POLICY IF EXISTS "Participants view policy" ON public.cell_report_participants;
CREATE POLICY "Participants view policy" ON public.cell_report_participants FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.cell_reports r
           WHERE r.id = cell_report_participants.report_id
             AND r.deleted_at IS NULL)
);

DROP POLICY IF EXISTS "Participants insert policy" ON public.cell_report_participants;
CREATE POLICY "Participants insert policy" ON public.cell_report_participants FOR INSERT TO authenticated
WITH CHECK (
  public.viewer_can_insert_cell_report_participant(report_id)
  AND EXISTS (SELECT 1 FROM public.cell_reports r
               WHERE r.id = cell_report_participants.report_id
                 AND r.deleted_at IS NULL)
);

-- DA-5: retirar participante exige "Editar Relatórios de Células".
DROP POLICY IF EXISTS "Participants delete policy" ON public.cell_report_participants;
CREATE POLICY "Participants delete policy" ON public.cell_report_participants FOR DELETE TO authenticated
USING (
  (SELECT public.viewer_has('edit_cell_report'::public.permission_action))
  AND EXISTS (SELECT 1 FROM public.cell_reports r
               WHERE r.id = cell_report_participants.report_id)
);

-- roles e role_permissions. PR 1: leitura como no E2.01 (com cadastro);
-- escrita com "Gerenciar Funções" (troca is_admin). O PR 6 fecha as duas.
DROP POLICY IF EXISTS "Authenticated users can view roles" ON public.roles;
CREATE POLICY "Authenticated users can view roles" ON public.roles FOR SELECT TO authenticated
USING ((SELECT public.viewer_member_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Admins can insert roles" ON public.roles;
CREATE POLICY "Admins can insert roles" ON public.roles FOR INSERT TO authenticated
WITH CHECK ((SELECT public.viewer_has('manage_roles'::public.permission_action)));

DROP POLICY IF EXISTS "Admins can update roles" ON public.roles;
CREATE POLICY "Admins can update roles" ON public.roles FOR UPDATE TO authenticated
USING ((SELECT public.viewer_has('manage_roles'::public.permission_action)))
WITH CHECK ((SELECT public.viewer_has('manage_roles'::public.permission_action)));

DROP POLICY IF EXISTS "Admins can delete roles" ON public.roles;
CREATE POLICY "Admins can delete roles" ON public.roles FOR DELETE TO authenticated
USING ((SELECT public.viewer_has('manage_roles'::public.permission_action)));

DROP POLICY IF EXISTS "Authenticated users can view role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated users can view role permissions" ON public.role_permissions FOR SELECT TO authenticated
USING ((SELECT public.viewer_member_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Admins can insert role permissions" ON public.role_permissions;
CREATE POLICY "Admins can insert role permissions" ON public.role_permissions FOR INSERT TO authenticated
WITH CHECK ((SELECT public.viewer_has('manage_roles'::public.permission_action)));

DROP POLICY IF EXISTS "Admins can update role permissions" ON public.role_permissions;
CREATE POLICY "Admins can update role permissions" ON public.role_permissions FOR UPDATE TO authenticated
USING ((SELECT public.viewer_has('manage_roles'::public.permission_action)))
WITH CHECK ((SELECT public.viewer_has('manage_roles'::public.permission_action)));

DROP POLICY IF EXISTS "Admins can delete role permissions" ON public.role_permissions;
CREATE POLICY "Admins can delete role permissions" ON public.role_permissions FOR DELETE TO authenticated
USING ((SELECT public.viewer_has('manage_roles'::public.permission_action)));

-- events: Auditoria sem escopo (RN-02, P-PER-18).
DROP POLICY IF EXISTS "Events view policy" ON public.events;
CREATE POLICY "Events view policy" ON public.events FOR SELECT TO authenticated
USING ((SELECT public.viewer_has('view_audit_log'::public.permission_action)));

-- ===========================================================================
-- 6. Leituras para a tela
-- ===========================================================================

-- member_names (E1.13 sobre o escopo novo, DT-23): os nomes dos ids que estão
-- na members_view de quem consulta ou que são líder de alguma linha dela.
-- Ignora excluídos (E2.01). No máximo 500 ids.
CREATE OR REPLACE FUNCTION public.member_names(_ids uuid[])
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.name
    FROM public.members m
   WHERE auth.uid() IS NOT NULL
     AND coalesce(cardinality(_ids), 0) <= 500
     AND m.id = ANY (_ids)
     AND m.deleted_at IS NULL
     AND (    m.id IN (SELECT v.id FROM public.members_view v WHERE v.id = ANY (_ids))
           OR m.id IN (SELECT v.leader_id FROM public.members_view v WHERE v.leader_id = ANY (_ids)))
$$;

-- ministry_tree_nodes: só o ramo de raízes muda (DA-6, DT-24). Com
-- "Visualizar Toda a Igreja", os pastores, como antes; sem ela, o casal G12 de
-- quem consulta ou, sem G12, o próprio casal (viewer_tree_roots). O resto é o
-- do E1.08.
CREATE OR REPLACE FUNCTION public.ministry_tree_nodes(_parent_ids uuid[] DEFAULT NULL::uuid[])
RETURNS TABLE(member_id uuid, member_name text, member_gender text, g12_level integer, is_pastor boolean, spouse_id uuid, spouse_name text, direct_disciples bigint, total_disciples integer, total_cells integer)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  _roots boolean;
  _parents uuid[];
  _church boolean;
  _tree_roots uuid[];
BEGIN
  IF cardinality(_parent_ids) > 100 THEN
    RAISE EXCEPTION 'No máximo 100 nós por chamada.' USING ERRCODE = '22023';
  END IF;
  _roots := _parent_ids IS NULL;
  -- Os nós informados, sem nulos nem repetidos (um NULL no array faria o
  -- "<> ALL" abaixo dar NULL e esconder todo mundo).
  _parents := ARRAY(
    SELECT DISTINCT pid FROM unnest(_parent_ids) AS u(pid) WHERE pid IS NOT NULL
  );
  IF NOT _roots AND cardinality(_parents) = 0 THEN
    RETURN;
  END IF;
  IF _roots THEN
    _church := public.viewer_has('view_all_church'::public.permission_action);
    _tree_roots := CASE WHEN _church THEN '{}'::uuid[] ELSE public.viewer_tree_roots() END;
  END IF;
  RETURN QUERY
  WITH candidates AS MATERIALIZED (
    -- Raízes: o topo do escopo (DA-6).
    SELECT mv.id, mv.name, mv.gender, mv.g12_level, mv.is_pastor, mv.leader_id,
           mv.spouse_id, mv.total_disciples, mv.total_cells
      FROM public.members_view mv
     WHERE _roots
       AND mv.is_active
       AND CASE WHEN _church THEN mv.is_pastor ELSE mv.id = ANY (_tree_roots) END
    UNION ALL
    -- Filhos: liderados por algum nó informado, menos os próprios nós.
    SELECT mv.id, mv.name, mv.gender, mv.g12_level, mv.is_pastor, mv.leader_id,
           mv.spouse_id, mv.total_disciples, mv.total_cells
      FROM public.members_view mv
     WHERE NOT _roots
       AND mv.is_active
       AND mv.leader_id = ANY (_parents)
       AND mv.id <> ALL (_parents)
  ),
  spouses AS MATERIALIZED (
    -- Os cônjuges exibíveis dos candidatos (MIN-03). O "= ANY (ARRAY(...))",
    -- em vez de IN, vira um parâmetro e leva a busca para a chave primária.
    SELECT mv.id, mv.name, mv.gender, mv.g12_level, mv.is_pastor, mv.leader_id,
           mv.total_disciples, mv.total_cells
      FROM public.members_view mv
     WHERE mv.is_active
       AND mv.id = ANY (ARRAY(SELECT c.spouse_id FROM candidates c))
       AND mv.id <> ALL (_parents)
  ),
  people AS (
    SELECT c.id, c.name, c.gender, c.g12_level, c.is_pastor, c.leader_id,
           c.total_disciples, c.total_cells
      FROM candidates c
    UNION
    SELECT s.id, s.name, s.gender, s.g12_level, s.is_pastor, s.leader_id,
           s.total_disciples, s.total_cells
      FROM spouses s
  ),
  pairs AS (
    -- Uma linha por candidato, com o casal já ordenado.
    SELECT
      CASE
        WHEN s.id IS NULL THEN c.id::text
        ELSE least(c.id, s.id)::text || '|' || greatest(c.id, s.id)::text
      END AS couple_key,
      -- O cônjuge é o principal? O homem primeiro; empatado, o candidato;
      -- empatado de novo, o de menor (nome, id).
      CASE
        WHEN s.id IS NULL THEN false
        WHEN coalesce(s.gender = 'M', false) <> coalesce(c.gender = 'M', false)
          THEN coalesce(s.gender = 'M', false)
        WHEN NOT EXISTS (SELECT 1 FROM candidates c2 WHERE c2.id = s.id) THEN false
        ELSE (s.name, s.id) < (c.name, c.id)
      END AS spouse_first,
      c.id AS candidate_id,
      s.id AS partner_id
    FROM candidates c
    LEFT JOIN spouses s ON s.id = c.spouse_id AND s.id <> c.id
  ),
  nodes AS (
    SELECT DISTINCT ON (pr.couple_key)
      pr.couple_key,
      CASE WHEN pr.spouse_first THEN pr.partner_id ELSE pr.candidate_id END AS principal_id,
      CASE WHEN pr.spouse_first THEN pr.candidate_id ELSE pr.partner_id END AS partner_id
    FROM pairs pr
    ORDER BY pr.couple_key
  ),
  links AS (
    -- Os integrantes de cada nó, um por linha (os líderes dos discípulos
    -- diretos), com o principal e o cônjuge do nó ao lado para a exclusão.
    SELECT n.couple_key, n.principal_id, n.partner_id, n.principal_id AS leader_id
      FROM nodes n
    UNION ALL
    SELECT n.couple_key, n.principal_id, n.partner_id, n.partner_id
      FROM nodes n
     WHERE n.partner_id IS NOT NULL
  ),
  disciples AS MATERIALIZED (
    -- Contagem, etapa 1: os discípulos diretos ativos e visíveis de todos os
    -- integrantes do nível, numa leitura só, com só id e leader_id.
    SELECT d.id, d.leader_id
      FROM public.members_view d
     WHERE d.is_active
       AND d.leader_id = ANY (ARRAY(SELECT l.leader_id FROM links l))
  ),
  node_counts AS MATERIALIZED (
    -- Contagem, etapa 2: cada discípulo vai para o nó do seu líder, menos os
    -- integrantes do próprio nó. O FULL JOIN é de propósito (E1.08): só por
    -- hash ou merge, nunca por laço aninhado.
    SELECT l.couple_key, l.principal_id, l.partner_id,
           count(d.id) FILTER (
             WHERE d.id <> l.principal_id AND d.id IS DISTINCT FROM l.partner_id
           ) AS total
      FROM links l
      FULL JOIN disciples d ON d.leader_id = l.leader_id
     GROUP BY l.couple_key, l.principal_id, l.partner_id
  )
  SELECT
    p.id,
    p.name,
    p.gender,
    p.g12_level,
    p.is_pastor,
    o.id,
    o.name,
    nc.total,
    CASE
      WHEN o.id IS NULL THEN coalesce(p.total_disciples, 0)
      -- Um lidera o outro: só o líder, sem contar o liderado como discípulo.
      WHEN o.leader_id = p.id THEN greatest(coalesce(p.total_disciples, 0) - 1, 0)
      WHEN p.leader_id = o.id THEN greatest(coalesce(o.total_disciples, 0) - 1, 0)
      ELSE coalesce(p.total_disciples, 0) + coalesce(o.total_disciples, 0)
    END,
    CASE
      WHEN o.id IS NULL THEN coalesce(p.total_cells, 0)
      WHEN o.leader_id = p.id THEN coalesce(p.total_cells, 0)
      WHEN p.leader_id = o.id THEN coalesce(o.total_cells, 0)
      ELSE coalesce(p.total_cells, 0) + coalesce(o.total_cells, 0)
    END
  FROM node_counts nc
  JOIN people p ON p.id = nc.principal_id
  LEFT JOIN people o ON o.id = nc.partner_id
  ORDER BY p.name, p.id;
END;
$$;

-- Dashboard: só "Visualizar Dashboard" (RN-22). Conta sem cadastro e membro
-- sem função recebem 42501 (AQ-11).
CREATE OR REPLACE FUNCTION public._dashboard_assert_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce(public.viewer_has('view_dashboard'::public.permission_action), false) THEN
    RAISE EXCEPTION 'Você não tem permissão para ver o dashboard.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- my_access (AQ-1, DT-16): o que quem chama pode fazer, numa linha só.
-- Sem cadastro (ou cadastro excluído): member_id nulo, tudo falso e
-- permissions vazia. Membro sem função: role_id nulo.
CREATE OR REPLACE FUNCTION public.my_access()
RETURNS TABLE (
  member_id uuid,
  role_id uuid,
  role_name text,
  role_is_protected boolean,
  permissions public.permission_action[],
  sees_whole_church boolean,
  sees_ministry boolean,
  sees_whole_church_reports boolean,
  sees_ministry_reports boolean,
  can_create_member boolean,
  can_assign_roles boolean,
  can_submit_some_report boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT m.id, m.role_id, r.name AS role_name, r.is_system
      FROM public.members m
      LEFT JOIN public.roles r ON r.id = m.role_id
     WHERE m.id = public.viewer_member_id()
  ),
  p AS (
    SELECT public.viewer_permissions() AS perms
  )
  SELECT
    me.id,
    me.role_id,
    me.role_name,
    coalesce(me.is_system, false),
    CASE WHEN me.id IS NULL THEN '{}'::public.permission_action[] ELSE p.perms END,
    coalesce('view_all_church' = ANY (p.perms), false),
    coalesce('view_own_ministry' = ANY (p.perms), false),
    coalesce('view_all_reports' = ANY (p.perms) OR 'view_all_church' = ANY (p.perms), false),
    coalesce('view_own_reports' = ANY (p.perms) OR 'view_own_ministry' = ANY (p.perms), false),
    coalesce('create_member' = ANY (p.perms)
             AND (   'assign_role' = ANY (p.perms)
                  OR 'manage_roles' = ANY (p.perms)
                  OR public.viewer_covers_role(public.default_role_id())), false),
    coalesce('assign_role' = ANY (p.perms) OR 'manage_roles' = ANY (p.perms), false),
    me.id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.cells_view cv WHERE cv.is_active AND cv.can_submit_report)
  FROM p
  LEFT JOIN me ON true
$$;

-- role_options (AQ-3, DT-18): as funções que quem chama pode atribuir, para o
-- cadastro novo (_member_id nulo) ou para um cadastro existente. Sem cadastro,
-- 42501. "current" só sai para quem atribui funções, no próprio cadastro ou
-- quando quem chama não cobre a função atual (RN-23).
CREATE OR REPLACE FUNCTION public.role_options(_member_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := public.viewer_member_id();
  _assigns boolean;
  _options jsonb;
  _default jsonb;
  _current jsonb;
  _target_role uuid;
  _reason text;
  _editable boolean;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  _assigns := public.viewer_has('assign_role'::public.permission_action)
           OR public.viewer_has('manage_roles'::public.permission_action);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'is_default', r.is_default)
                            ORDER BY r.name, r.id), '[]'::jsonb)
    INTO _options
    FROM public.roles r
   WHERE _assigns
     AND public.viewer_covers_role(r.id);

  SELECT jsonb_build_object('id', r.id, 'name', r.name)
    INTO _default
    FROM public.roles r
   WHERE r.is_default
   LIMIT 1;

  IF _member_id IS NULL THEN
    _editable := _assigns;
    _reason := CASE WHEN _assigns THEN NULL ELSE 'no_permission' END;
    _current := NULL;
  ELSIF NOT public.viewer_sees_member(_member_id) THEN
    _editable := false;
    _reason := 'not_found';
    _current := NULL;
  ELSE
    SELECT m.role_id INTO _target_role FROM public.members m WHERE m.id = _member_id;
    SELECT jsonb_build_object('id', r.id, 'name', r.name)
      INTO _current
      FROM public.roles r
     WHERE r.id = _target_role;
    IF _member_id = _me THEN
      _editable := false;
      _reason := 'self';
    ELSIF NOT _assigns THEN
      _editable := false;
      _reason := 'no_permission';
      _current := NULL;
    ELSIF NOT public.viewer_covers_role(_target_role) THEN
      _editable := false;
      _reason := 'role_above';
    ELSE
      _editable := true;
      _reason := NULL;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'current', _current,
    'editable', _editable,
    'reason', _reason,
    'options', _options,
    'default_role', _default);
END;
$$;

REVOKE ALL ON FUNCTION public.member_names(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ministry_tree_nodes(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._dashboard_assert_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.my_access() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.role_options(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.member_names(uuid[]),
  public.ministry_tree_nodes(uuid[]),
  public._dashboard_assert_access(),
  public.my_access(),
  public.role_options(uuid)
TO authenticated, service_role;

-- ===========================================================================
-- 7. RN-23: funções com id fora do alcance de authenticated
-- ===========================================================================
-- is_admin: nenhuma política nem função usa mais. Fica para a service role
-- (change-member-password, até o E2.03).
REVOKE EXECUTE ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO service_role;

-- As quatro de escopo obsoletas. Sem CASCADE: o DROP falha se alguma política
-- ou view ainda depender delas. Os corpos plpgsql não registram dependência;
-- a conferência é a busca em pg_proc.prosrc (tarefa 1 e pgTAP do QA).
DROP FUNCTION IF EXISTS public.is_leader_of_visible_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_in_same_ministry(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_ministry_root(uuid);
DROP FUNCTION IF EXISTS public.can_manage_own_cell(uuid, uuid);
