-- E2.02 (PR 6, migration 5) — Fecha a leitura e a escrita diretas de funções.
-- Ver docs/specs/e2-02-perfis-escopo.md no repositório apps-mci (tarefa 18,
-- RN-23, DA-9, DT-11, DT-18, "Políticas de RLS", "Leituras para a tela" e
-- "Implantação").
--
-- Por quê (RN-23): o nome da função de uma pessoa equivale às permissões dela,
-- então a função de outra pessoa só aparece para quem pode atribuir funções
-- ("Atribuir Função aos Membros" ou "Gerenciar Funções"). A definição das
-- funções não é segredo, mas desde os PRs 2 a 5 o front não lê mais as tabelas
-- (DA-9): a própria função vem de my_access(), as opções do cadastro de
-- role_options(), a tela de Funções de roles_view, e a escrita vai por
-- save_role e delete_role.
--
-- O que muda:
--   1. roles e role_permissions: SELECT só com view_roles ou manage_roles
--      (viewer_has já aplica o atalho da Administrador e ignora cadastro
--      excluído). Nenhuma política de INSERT, UPDATE ou DELETE; anon sem
--      privilégio; authenticated só com SELECT. A escrita fica só pelas RPCs
--      definer (save_role, delete_role) e pelas migrations. service_role e
--      postgres não mudam.
--   2. members_view.role_id: nula, a não ser no próprio cadastro
--      (m.id = viewer_member_id()) ou para quem tem assign_role ou
--      manage_roles (DT-18). Resto da view igual, na mesma ordem.
--   3. members.role_id sem SELECT por coluna para authenticated (DT-11). O
--      INSERT e o UPDATE da coluna continuam (o PATCH do MemberForm devolve só
--      o id, e a create-user-admin grava sem RETURNING).
--
-- Conferência do catálogo antes desta migration: as funções que leem roles,
-- role_permissions ou members.role_id são definer, exceto os triggers
-- enforce_member_write_rules e check_member_insert, que só usam NEW/OLD e
-- gravam a coluna (sem leitura por privilégio). Nenhuma política de outra
-- tabela nem view security_invoker lê as duas tabelas ou a coluna; nenhuma
-- view depende da members_view.
--
-- Pode rodar de novo sem erro: as políticas das duas tabelas são removidas
-- pelo catálogo (inclusive nomes antigos) e recriadas; GRANT/REVOKE e
-- CREATE OR REPLACE VIEW são idempotentes.
--
-- Rollback (uma migration nova; a escrita direta não volta, porque o front
-- já usa as RPCs):
--   DROP POLICY IF EXISTS "Roles view policy" ON public.roles;
--   CREATE POLICY "Authenticated users can view roles" ON public.roles
--     FOR SELECT TO authenticated USING ((SELECT public.viewer_member_id()) IS NOT NULL);
--   DROP POLICY IF EXISTS "Role permissions view policy" ON public.role_permissions;
--   CREATE POLICY "Authenticated users can view role permissions" ON public.role_permissions
--     FOR SELECT TO authenticated USING ((SELECT public.viewer_member_id()) IS NOT NULL);
--   GRANT SELECT (role_id) ON public.members TO authenticated;
--   e a members_view de 20261125140200_e202_03_read.sql (com m.role_id).

-- ===========================================================================
-- 1. roles e role_permissions
-- ===========================================================================

DO $$
DECLARE
  _p record;
BEGIN
  FOR _p IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('roles', 'role_permissions')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', _p.policyname, _p.tablename);
  END LOOP;
END $$;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Roles view policy" ON public.roles FOR SELECT TO authenticated
USING (    (SELECT public.viewer_has('view_roles'::public.permission_action))
        OR (SELECT public.viewer_has('manage_roles'::public.permission_action)));

CREATE POLICY "Role permissions view policy" ON public.role_permissions FOR SELECT TO authenticated
USING (    (SELECT public.viewer_has('view_roles'::public.permission_action))
        OR (SELECT public.viewer_has('manage_roles'::public.permission_action)));

REVOKE ALL ON public.roles, public.role_permissions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.roles, public.role_permissions TO authenticated;

-- ===========================================================================
-- 2. members_view: role_id mascarada (DT-18). Igual à da migration 3 do E2.02
--    (20261125140200_e202_03_read.sql), exceto a coluna role_id e o
--    role_visible no LATERAL.
-- ===========================================================================

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
  sp.name AS spouse_name
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.members sp ON sp.id = m.spouse_id
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
-- Consolidação: o filtro ou a coluna do consolidado entra aqui.

ALTER VIEW public.members_view OWNER TO postgres;
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- ===========================================================================
-- 3. members.role_id sem SELECT por coluna (DT-11). As outras colunas e o
--    INSERT/UPDATE da coluna não mudam.
-- ===========================================================================

REVOKE SELECT (role_id) ON public.members FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.members IS
  'Cadastro de membros. Leitura pelo front: members_view (escopo e máscara de dados sensíveis e da função). '
  'authenticated tem SELECT só por coluna: toda coluna nova não sensível precisa de GRANT SELECT (coluna) na '
  'migration que a cria; as sensíveis (email, cpf, mobile_whatsapp, phone, street, number, complement, zip_code) '
  'nunca recebem, nem a role_id (a função de outra pessoa só sai mascarada pela members_view, RN-23). '
  'Ver E1.08, PR 5, e E2.02, PR 6.';
