-- E2.02 (PR 1, migration 2) — Escopo pela árvore real e permissões efetivas.
-- Ver docs/specs/e2-02-perfis-escopo.md no repositório apps-mci ("Escopo
-- (migration 2)", "Estrutura (migrations 2 e 4)", RN-01, RN-05, RN-06, RN-16,
-- RN-17, RN-22, RN-23, DT-01, DT-02, DT-09 a DT-11, DT-28).
--
-- Escopo do ministério (RN-01): as âncoras são quem consulta, o cônjuge, o G12
-- (quem está logo abaixo do topo na cadeia de leader_id) e o cônjuge do G12,
-- com toda a descendência das quatro. Nada aqui usa g12_level. Duas formas,
-- com o mesmo resultado (teste de equivalência do QA):
--   - viewer_ministry_member_ids(): a descida em conjunto, para as views;
--   - viewer_scope_contains_any(ids): a subida por id, para as políticas e os
--     triggers. O(profundidade), sem montar o escopo inteiro.
-- As duas passam por membros excluídos (DT-04 do E2.01): o filtro fica nas
-- views e nas políticas. As duas voltam vazias ou falsas sem "Visualizar Seu
-- Ministério" e sem "Visualizar Relatórios do Seu Ministério" (DT-28).
--
-- Permissões efetivas (RN-17, RN-22): active_permissions() é a lista única das
-- que valem (o enum menos view_members e view_own_ministry_dashboard). A
-- função is_system tem todas as ativas, inclusive as criadas depois.
--
-- RN-23: as funções novas respondem só sobre quem está logado
-- (viewer_member_id()). user_has_permission e is_admin, que recebem um id,
-- passam a responder só sobre o próprio usuário quando há usuário logado; o
-- EXECUTE delas para authenticated sai nas migrations 3 e 4, depois que as
-- políticas e o trigger de members deixam de chamá-las.
--
-- Funções internas (sem EXECUTE para authenticated): _viewer_scope_anchors,
-- role_effective_permissions e viewer_permissions. As demais funções novas
-- têm EXECUTE só para authenticated (e service_role), nunca para anon.
--
-- Pode rodar de novo sem erro: IF NOT EXISTS, DO com guarda, CREATE OR
-- REPLACE e grants.

-- ===========================================================================
-- 1. Estrutura
-- ===========================================================================
-- Uma só função Administrador, e ela nunca é a padrão (RN-17). "No máximo uma
-- padrão" já é idx_roles_single_default; "pelo menos uma" é o constraint
-- trigger adiado da migration 4 (RN-19).
CREATE UNIQUE INDEX IF NOT EXISTS roles_single_system_idx ON public.roles (is_system) WHERE is_system;

DO $$
BEGIN
  ALTER TABLE public.roles ADD CONSTRAINT roles_system_not_default CHECK (NOT (is_system AND is_default));
EXCEPTION WHEN duplicate_object THEN
  NULL;
END
$$;

-- Contagem de membros por função (roles_view, delete_role, RN-20) e o
-- ON DELETE SET NULL de members.role_id.
CREATE INDEX IF NOT EXISTS members_role_id_idx ON public.members (role_id) WHERE deleted_at IS NULL;

-- ===========================================================================
-- 2. Permissões efetivas
-- ===========================================================================
-- As permissões que valem, na ordem do enum (DT-10).
CREATE OR REPLACE FUNCTION public.active_permissions()
RETURNS public.permission_action[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT array_agg(p ORDER BY p)
    FROM unnest(enum_range(NULL::public.permission_action)) AS p
   WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard')
$$;

-- Com usuário logado, responde só sobre ele (RN-23). Sem usuário (service
-- role, migrations), responde sobre qualquer um: a change-member-password a
-- usa assim até o E2.03. A função is_system tem todas as ativas (DT-09).
CREATE OR REPLACE FUNCTION public.user_has_permission(_user_id uuid, _permission public.permission_action)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (auth.uid() IS NULL OR _user_id = auth.uid())
     AND _permission = ANY (public.active_permissions())
     AND EXISTS (
       SELECT 1
         FROM public.members m
         JOIN public.roles r ON r.id = m.role_id
        WHERE m.auth_user_id = _user_id
          AND m.deleted_at IS NULL
          AND (    r.is_system
                OR EXISTS (SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role_id = r.id AND rp.permission = _permission))
     )
$$;

-- Fica só para a service role (change-member-password, até o E2.03).
CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.user_has_permission(_user_id, 'manage_roles'::public.permission_action)
$$;

-- Interna: as permissões efetivas de uma função. Todas as ativas para a
-- is_system; senão, as linhas da função que estão ativas. Função nula ou
-- inexistente: nenhuma.
CREATE OR REPLACE FUNCTION public.role_effective_permissions(_role_id uuid)
RETURNS public.permission_action[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(array_agg(p ORDER BY p), '{}'::public.permission_action[])
    FROM unnest(public.active_permissions()) AS p
   WHERE EXISTS (
     SELECT 1
       FROM public.roles r
      WHERE r.id = _role_id
        AND (    r.is_system
              OR EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.role_id = r.id AND rp.permission = p))
   )
$$;

-- Interna: as permissões efetivas de quem consulta (vazia sem cadastro ou sem função).
CREATE OR REPLACE FUNCTION public.viewer_permissions()
RETURNS public.permission_action[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT public.role_effective_permissions(m.role_id)
       FROM public.members m
      WHERE m.id = public.viewer_member_id()),
    '{}'::public.permission_action[])
$$;

-- Quem consulta cobre a função: tem todas as permissões efetivas dela. Só a
-- Administrador cobre a Administrador. Uma função nula é coberta por todos
-- (com cadastro). Assinatura do E2.01.
CREATE OR REPLACE FUNCTION public.viewer_covers_role(_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_member_id() IS NOT NULL
     AND NOT EXISTS (
       SELECT unnest(public.role_effective_permissions(_role_id))
       EXCEPT
       SELECT unnest(public.viewer_permissions())
     )
$$;

-- RN-18: atribui funções e cobre esta.
CREATE OR REPLACE FUNCTION public.can_assign_role(_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (    public.viewer_has('assign_role'::public.permission_action)
           OR public.viewer_has('manage_roles'::public.permission_action))
     AND public.viewer_covers_role(_role_id)
$$;

-- O id da função padrão, lido sem RLS (o trigger de members, que é
-- INVOKER, deixa de ler roles com o papel de quem grava).
CREATE OR REPLACE FUNCTION public.default_role_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id FROM public.roles r WHERE r.is_default LIMIT 1
$$;

-- ===========================================================================
-- 3. Âncoras e as duas formas de percorrer (RN-01, DT-01, DT-02)
-- ===========================================================================
-- Interna. Âncoras de quem consulta: eu, meu cônjuge, meu G12 e o cônjuge do
-- G12. O G12 é quem está logo abaixo do topo (sem líder) na minha cadeia.
-- Sou o topo (pastor ou sem liderança): sem G12. A cadeia não chega a um topo
-- (ciclo, até o E2.06): sem G12. Sem cadastro: nenhuma linha.
CREATE OR REPLACE FUNCTION public._viewer_scope_anchors()
RETURNS TABLE (me uuid, me_spouse uuid, g12 uuid, g12_spouse uuid)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE
  self AS (
    SELECT m.id, m.spouse_id FROM public.members m WHERE m.id = public.viewer_member_id()
  ),
  up AS (
    SELECT m.id, m.leader_id, ARRAY[m.id] AS path
      FROM public.members m JOIN self ON m.id = self.id
    UNION ALL
    SELECT l.id, l.leader_id, up.path || l.id
      FROM up JOIN public.members l ON l.id = up.leader_id
     WHERE NOT l.id = ANY (up.path)                      -- ciclo: para
  ),
  g12 AS (
    SELECT g.id, g.spouse_id
      FROM up
      JOIN public.members top ON top.id = up.leader_id AND top.leader_id IS NULL
      JOIN public.members g   ON g.id = up.id
     LIMIT 1
  )
  SELECT self.id, self.spouse_id, g12.id, g12.spouse_id FROM self LEFT JOIN g12 ON true
$$;

-- Forma em conjunto (views): âncoras e toda a descendência. O UNION descarta
-- repetidos, então termina em ciclos e quando uma âncora está abaixo de outra.
-- Vazia sem "Visualizar Seu Ministério" e sem "Visualizar Relatórios do Seu
-- Ministério" (DT-28).
CREATE OR REPLACE FUNCTION public.viewer_ministry_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE tree(id) AS (
    SELECT x
      FROM public._viewer_scope_anchors() a,
           unnest(ARRAY[a.me, a.me_spouse, a.g12, a.g12_spouse]) AS x
     WHERE x IS NOT NULL
       AND (    public.viewer_has('view_own_ministry'::public.permission_action)
             OR public.viewer_has('view_own_reports'::public.permission_action))
    UNION
    SELECT c.id FROM tree t JOIN public.members c ON c.leader_id = t.id
  )
  SELECT id FROM tree
$$;

-- Forma por id (políticas e triggers): sobe de cada id até o topo e procura uma
-- âncora no caminho. Falsa sem permissão de escopo (DT-28).
CREATE OR REPLACE FUNCTION public.viewer_scope_contains_any(_member_ids uuid[])
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT (    public.viewer_has('view_own_ministry'::public.permission_action)
               OR public.viewer_has('view_own_reports'::public.permission_action))
      THEN false
    ELSE EXISTS (
      WITH RECURSIVE
      a AS (
        SELECT array_remove(ARRAY[x.me, x.me_spouse, x.g12, x.g12_spouse], NULL) AS ids
          FROM public._viewer_scope_anchors() x
      ),
      up AS (
        SELECT m.id, m.leader_id, ARRAY[m.id] AS path
          FROM public.members m
         WHERE m.id = ANY (_member_ids)
        UNION ALL
        SELECT l.id, l.leader_id, up.path || l.id
          FROM up JOIN public.members l ON l.id = up.leader_id
         WHERE NOT l.id = ANY (up.path)
      )
      SELECT 1 FROM up, a WHERE up.id = ANY (a.ids)
    )
  END
$$;

-- Raízes da árvore de Ministérios (DA-6) para quem não vê a igreja toda: o
-- casal G12 de quem consulta ou, sem G12, o próprio casal. Vazia sem
-- "Visualizar Seu Ministério".
CREATE OR REPLACE FUNCTION public.viewer_tree_roots()
RETURNS uuid[]
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT public.viewer_has('view_own_ministry'::public.permission_action) THEN '{}'::uuid[]
    ELSE coalesce(
      (SELECT array_remove(
                CASE WHEN a.g12 IS NOT NULL THEN ARRAY[a.g12, a.g12_spouse]
                     ELSE ARRAY[a.me, a.me_spouse] END,
                NULL)
         FROM public._viewer_scope_anchors() a),
      '{}'::uuid[])
  END
$$;

-- ===========================================================================
-- 4. Funções de linha: o que quem consulta vê, por id
-- ===========================================================================
-- Respondem só sobre quem consulta e só o que as views já mostram.

-- Membro visível: não excluído e (igreja toda, ou ministério e no escopo, ou
-- é quem consulta).
CREATE OR REPLACE FUNCTION public.viewer_sees_member(_member_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
           EXISTS (SELECT 1 FROM public.members m WHERE m.id = _member_id AND m.deleted_at IS NULL)
       AND (    public.viewer_has('view_all_church'::public.permission_action)
             OR _member_id = public.viewer_member_id()
             OR (    public.viewer_has('view_own_ministry'::public.permission_action)
                 AND public.viewer_scope_contains_any(ARRAY[_member_id]))),
         false)
$$;

-- Célula visível pelas pessoas dela (RN-02, RN-03): igreja toda, ou
-- ministério e alguma das três no escopo, ou quem consulta é uma das três.
CREATE OR REPLACE FUNCTION public.viewer_sees_cell_people(_leader_id uuid, _timothy_id uuid, _host_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('view_all_church'::public.permission_action)
      OR coalesce(public.viewer_member_id() IN (_leader_id, _timothy_id, _host_id), false)
      OR (    public.viewer_has('view_own_ministry'::public.permission_action)
          AND public.viewer_scope_contains_any(ARRAY[_leader_id, _timothy_id, _host_id]))
$$;

-- Célula existente, não excluída e visível.
CREATE OR REPLACE FUNCTION public.viewer_sees_cell(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cells c
     WHERE c.id = _cell_id
       AND c.deleted_at IS NULL
       AND public.viewer_sees_cell_people(c.leader_id, c.timothy_id, c.host_id)
  )
$$;

-- Alguma pessoa da célula (líder, timóteo ou anfitrião) no escopo. Não filtra
-- célula excluída (RN-11 do E2.01). Assinatura do E2.01; passa a incluir o
-- anfitrião e a árvore real.
CREATE OR REPLACE FUNCTION public.cell_in_viewer_ministry(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cells c
     WHERE c.id = _cell_id
       AND public.viewer_scope_contains_any(ARRAY[c.leader_id, c.timothy_id, c.host_id])
  )
$$;

-- Quem consulta é líder, timóteo ou anfitrião da célula (RN-02 d). Substitui
-- can_manage_own_cell, que não tinha o anfitrião e aceitava qualquer id.
CREATE OR REPLACE FUNCTION public.viewer_is_cell_person(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cells c
     WHERE c.id = _cell_id
       AND public.viewer_member_id() IN (c.leader_id, c.timothy_id, c.host_id)
  )
$$;

-- RN-13: quem consulta pode lançar o relatório desta célula. A mesma regra
-- alimenta a cells_view (can_submit_report) e my_access (DT-19).
CREATE OR REPLACE FUNCTION public.can_submit_report(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT (    public.viewer_has('edit_cell'::public.permission_action)
               OR public.viewer_has('submit_any_visible_report'::public.permission_action)
               OR public.viewer_has('submit_own_cell_report'::public.permission_action))
      THEN false
    ELSE public.viewer_sees_cell(_cell_id)
     AND (    public.viewer_has('edit_cell'::public.permission_action)
           OR public.viewer_has('submit_any_visible_report'::public.permission_action)
           OR public.viewer_is_cell_person(_cell_id))
  END
$$;

-- ===========================================================================
-- 5. Privilégios
-- ===========================================================================
-- Internas: só a service role (e o dono).
REVOKE ALL ON FUNCTION public._viewer_scope_anchors() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.role_effective_permissions(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.viewer_permissions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._viewer_scope_anchors() TO service_role;
GRANT EXECUTE ON FUNCTION public.role_effective_permissions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.viewer_permissions() TO service_role;

-- Sobre quem consulta: authenticated (views, políticas, triggers INVOKER e telas).
REVOKE ALL ON FUNCTION public.active_permissions() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.default_role_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_ministry_member_ids() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_scope_contains_any(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_tree_roots() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_sees_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_sees_cell_people(uuid, uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_sees_cell(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cell_in_viewer_ministry(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_is_cell_person(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_submit_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_covers_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_assign_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.active_permissions(),
  public.default_role_id(),
  public.viewer_ministry_member_ids(),
  public.viewer_scope_contains_any(uuid[]),
  public.viewer_tree_roots(),
  public.viewer_sees_member(uuid),
  public.viewer_sees_cell_people(uuid, uuid, uuid),
  public.viewer_sees_cell(uuid),
  public.cell_in_viewer_ministry(uuid),
  public.viewer_is_cell_person(uuid),
  public.can_submit_report(uuid),
  public.viewer_covers_role(uuid),
  public.can_assign_role(uuid)
TO authenticated, service_role;

-- user_has_permission e is_admin: anon nunca. authenticated perde o EXECUTE
-- na migration 3 (is_admin) e na 4 (user_has_permission).
REVOKE ALL ON FUNCTION public.user_has_permission(uuid, public.permission_action) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, public.permission_action) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO service_role;
