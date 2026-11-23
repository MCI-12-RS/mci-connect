-- E2.01 (PR 1, migration 3 de 4) — Exclusão lógica: leitura sem excluídos.
-- Ver docs/specs/e2-01-exclusao-logica.md no repositório apps-mci ("Leitura:
-- onde os excluídos somem", DT-04 a DT-06, DT-25, DA-9, DA-10).
--
-- O filtro fica em três níveis (DT-04):
--   - entidade: as views do E1.08 e as políticas de SELECT e UPDATE ganham
--     deleted_at IS NULL, fora dos parênteses do escopo;
--   - identidade de quem consulta: os helpers de permissão e escopo ignoram o
--     cadastro excluído, e é isso que corta o acesso dele (RN-14);
--   - árvore: get_ministry_root e a descida de viewer_ministry_member_ids NÃO
--     filtram, para que o histórico (célula ou relatório de um excluído)
--     mantenha o escopo de antes da exclusão.
--
-- 1. Helpers de identidade e escopo; viewer_covers_role e
--    cell_in_viewer_ministry (novas); member_names; log_auth_event.
-- 2. Views do E1.08 com o filtro, e as colunas cell_deleted (cell_reports_view)
--    e member_deleted (cell_report_participants_view) no fim.
-- 3. Views de excluídos (members_deleted_view, cells_deleted_view,
--    cell_reports_deleted_view), só para manage_roles, com o mesmo escopo das
--    principais (RN-15).
-- 4. Políticas de SELECT, UPDATE e INSERT de members, cells, cell_reports e
--    cell_report_participants, e de SELECT de roles e role_permissions.
--    As políticas de DELETE saem na migration 5 (PR 2).
--
-- Regra do E1.08 que continua valendo: o WHERE de cada view espelha a política
-- de SELECT da tabela. Mudou uma, mude a outra (teste de paridade).
--
-- Pode rodar de novo sem erro: só CREATE OR REPLACE, DROP ... IF EXISTS antes
-- de cada CREATE POLICY, e grants.

-- ===========================================================================
-- 1. Identidade e escopo de quem consulta
-- ===========================================================================

-- O excluído não tem permissão nenhuma, mesmo que a função dele tenha (RN-14).
-- Vale para viewer_has, as RPCs, o RLS e as Edge Functions.
CREATE OR REPLACE FUNCTION public.user_has_permission(_user_id uuid, _permission public.permission_action)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.members m
      JOIN public.role_permissions rp ON rp.role_id = m.role_id
     WHERE m.auth_user_id = _user_id
       AND m.deleted_at IS NULL
       AND rp.permission = _permission
  )
$$;

CREATE OR REPLACE FUNCTION public.is_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.members m
      JOIN public.role_permissions rp ON rp.role_id = m.role_id
     WHERE m.auth_user_id = _user_id
       AND m.deleted_at IS NULL
       AND rp.permission = 'manage_roles'
  )
$$;

-- Sem cadastro não excluído, sem escopo (DEL-06). Escolas depende disto (ESC-33).
CREATE OR REPLACE FUNCTION public.viewer_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id
    FROM public.members m
   WHERE m.auth_user_id = auth.uid()
     AND m.deleted_at IS NULL
$$;

-- "Cobrir a função" (RN-03, RN-16 b; DT-12): as permissões da função _role_id
-- estão todas entre as de quem consulta. Não exige assign_role. Falso sem
-- cadastro não excluído. Com _role_id NULL (sem função), verdadeiro.
CREATE OR REPLACE FUNCTION public.viewer_covers_role(_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.members me
            WHERE me.auth_user_id = auth.uid()
              AND me.deleted_at IS NULL
         )
     AND NOT EXISTS (
           SELECT rp.permission FROM public.role_permissions rp WHERE rp.role_id = _role_id
           EXCEPT
           SELECT own.permission
             FROM public.role_permissions own
             JOIN public.members m ON m.role_id = own.role_id
            WHERE m.auth_user_id = auth.uid()
              AND m.deleted_at IS NULL
         )
$$;

-- Mesma regra do E1.03, agora sobre viewer_covers_role.
CREATE OR REPLACE FUNCTION public.can_assign_role(_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
      public.user_has_permission(auth.uid(), 'assign_role'::public.permission_action)
      OR public.user_has_permission(auth.uid(), 'manage_roles'::public.permission_action)
    )
    AND public.viewer_covers_role(_role_id)
$$;

-- Ignora o USUÁRIO excluído; não filtra a célula: o líder de uma célula
-- excluída continua vendo os relatórios dela (RN-11). O filtro da célula fica
-- nas políticas.
CREATE OR REPLACE FUNCTION public.can_manage_own_cell(_user_id uuid, _cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cells c
      JOIN public.members m ON m.auth_user_id = _user_id AND m.deleted_at IS NULL
     WHERE c.id = _cell_id
       AND (c.leader_id = m.id OR c.timothy_id = m.id)
  )
$$;

-- Ignora o USUÁRIO excluído; não filtra o alvo (a árvore passa por excluídos).
-- Continua equivalente a viewer_ministry_member_ids() (teste do E1.08).
CREATE OR REPLACE FUNCTION public.is_in_same_ministry(_user_id uuid, _target_member_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_member_id uuid;
  _user_root uuid;
  _user_root_spouse uuid;
  _target_root uuid;
  _target_root_spouse uuid;
BEGIN
  IF _target_member_id IS NULL THEN RETURN false; END IF;

  SELECT id INTO _user_member_id
    FROM public.members
   WHERE auth_user_id = _user_id
     AND deleted_at IS NULL;
  IF _user_member_id IS NULL THEN RETURN false; END IF;

  IF _user_member_id = _target_member_id THEN RETURN true; END IF;

  _user_root := public.get_ministry_root(_user_member_id);
  IF _user_root IS NULL THEN RETURN false; END IF;

  -- O cônjuge do G12 (a raiz) também faz parte do ministério visível.
  SELECT spouse_id INTO _user_root_spouse FROM public.members WHERE id = _user_root;

  -- O G12 e o cônjuge dele são visíveis.
  IF _target_member_id = _user_root THEN RETURN true; END IF;
  IF _user_root_spouse IS NOT NULL AND _target_member_id = _user_root_spouse THEN
    RETURN true;
  END IF;

  -- O alvo precisa subir até a mesma raiz, ou até o cônjuge dela.
  _target_root := public.get_ministry_root(_target_member_id);
  IF _target_root IS NOT NULL THEN
    IF _target_root = _user_root THEN RETURN true; END IF;
    IF _user_root_spouse IS NOT NULL AND _target_root = _user_root_spouse THEN
      RETURN true;
    END IF;

    -- Também: o cônjuge da raiz do alvo é a raiz de quem consulta.
    SELECT spouse_id INTO _target_root_spouse FROM public.members WHERE id = _target_root;
    IF _target_root_spouse IS NOT NULL AND _target_root_spouse = _user_root THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- Só discípulos não excluídos (coerente com member_names).
CREATE OR REPLACE FUNCTION public.is_leader_of_visible_member(_user_id uuid, _candidate_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _child record;
BEGIN
  IF _candidate_id IS NULL OR _user_id IS NULL THEN
    RETURN false;
  END IF;

  FOR _child IN
    SELECT id FROM public.members WHERE leader_id = _candidate_id AND deleted_at IS NULL
  LOOP
    IF public.is_in_same_ministry(_user_id, _child.id) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

-- Os seletores não mostram excluídos. O nome de referência nas linhas (líder
-- da célula de um relatório antigo, participante excluído) vem dos joins das
-- views, que não filtram (RN-09 c).
CREATE OR REPLACE FUNCTION public.member_names(_ids uuid[])
RETURNS TABLE (id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id, m.name
    FROM public.members m
   WHERE auth.uid() IS NOT NULL
     AND coalesce(cardinality(_ids), 0) <= 500
     AND m.id = ANY (_ids)
     AND m.deleted_at IS NULL
     AND (
       public.user_has_permission(auth.uid(), 'view_all_church'::public.permission_action)
       OR public.user_has_permission(auth.uid(), 'view_members'::public.permission_action)
       OR m.auth_user_id = auth.uid()
       OR (
         public.user_has_permission(auth.uid(), 'view_own_ministry'::public.permission_action)
         AND (
           public.is_in_same_ministry(auth.uid(), m.id)
           OR public.is_leader_of_visible_member(auth.uid(), m.id)
         )
       )
     )
$$;

-- A célula está no ministério de quem consulta: o líder ou o timóteo dela é do
-- ministério. Lê cells SEM RLS (definer), para que o relatório de uma célula
-- excluída continue visível pelo ministério (RN-11, DT-05). Substitui o EXISTS
-- sob RLS nas políticas de relatórios e participantes. Sem parâmetro de usuário.
CREATE OR REPLACE FUNCTION public.cell_in_viewer_ministry(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.cells c
     WHERE c.id = _cell_id
       AND (
            public.is_in_same_ministry(auth.uid(), c.leader_id)
         OR public.is_in_same_ministry(auth.uid(), c.timothy_id)
       )
  )
$$;

REVOKE EXECUTE ON FUNCTION public.viewer_covers_role(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cell_in_viewer_ministry(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_covers_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cell_in_viewer_ministry(uuid) TO authenticated;

-- Login e logout de um membro excluído não gravam nada (DA-9). O resto é igual
-- ao E1.13.
CREATE OR REPLACE FUNCTION public.log_auth_event(
  _action public.event_action,
  _success boolean,
  _identifier text DEFAULT NULL,
  _reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Não autenticado.' USING ERRCODE = '42501';
  END IF;
  IF _action NOT IN ('login', 'logout') THEN
    RAISE EXCEPTION 'Ação inválida para log_auth_event.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.members
     WHERE auth_user_id = _uid
       AND deleted_at IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Evita enxurrada de eventos repetidos vindos do cliente.
  IF EXISTS (
    SELECT 1 FROM public.events
     WHERE actor_user_id = _uid
       AND entity = 'auth'
       AND action = _action
       AND occurred_at > now() - interval '30 seconds'
  ) THEN
    RETURN;
  END IF;

  PERFORM public._log_event(
    _action        => _action,
    _entity        => 'auth'::public.event_entity,
    _entity_id     => _uid,
    _entity_label  => NULL,
    _description   => CASE _action WHEN 'login' THEN 'Login realizado' ELSE 'Logout realizado' END,
    _metadata      => jsonb_strip_nulls(jsonb_build_object(
                        'identifier_masked', public._mask_identifier(_identifier)
                      )),
    _success       => true,
    _error_reason  => NULL,
    _actor_user_id => _uid
  );
END;
$$;

-- ===========================================================================
-- 2. Views do E1.08 sem excluídos
-- ===========================================================================
-- CREATE OR REPLACE VIEW: as colunas existentes ficam iguais e na mesma ordem;
-- as novas entram no fim (risco 5 do E1.08). Continuam security definer com
-- security_barrier, donas postgres, só com SELECT para authenticated.

-- members_view: WHERE espelha "Members view policy". Vínculo celular sem
-- células excluídas e sem relatórios excluídos; o relatório de uma célula
-- excluída continua contando como participação (DA-1).
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
  -- Bairro, cidade e UF não são sensíveis (decisão D-2 do E1.08).
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
  -- Dados sensíveis (E1.08, RN-11)
  CASE WHEN s.sensitive_visible THEN m.email           END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf             END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  CASE WHEN s.sensitive_visible THEN m.phone           END AS phone,
  CASE WHEN s.sensitive_visible THEN m.street          END AS street,
  CASE WHEN s.sensitive_visible THEN m.number          END AS number,
  CASE WHEN s.sensitive_visible THEN m.complement      END AS complement,
  CASE WHEN s.sensitive_visible THEN m.zip_code        END AS zip_code,
  -- Vínculo celular (MEM-14), sobre todas as células e relatórios não
  -- excluídos, não só os visíveis (RN-08).
  EXISTS (SELECT 1 FROM public.cells c
           WHERE c.leader_id  = m.id AND c.deleted_at IS NULL) AS is_cell_leader,
  EXISTS (SELECT 1 FROM public.cells c
           WHERE c.timothy_id = m.id AND c.deleted_at IS NULL) AS is_cell_timothy,
  EXISTS (SELECT 1 FROM public.cells c
           WHERE c.host_id    = m.id AND c.deleted_at IS NULL) AS is_cell_host,
  m.id IN (
    SELECT p.member_id
      FROM public.cell_report_participants p
      JOIN public.cell_reports r ON r.id = p.report_id
     WHERE r.date >= public.sp_today() - 30
       AND r.deleted_at IS NULL
  ) AS attended_last_30_days,
  -- Busca (E1.08, RN-04 e RN-13): só com valores que quem consulta pode ver.
  public.search_normalize(concat_ws(' ',
    m.name,
    CASE WHEN s.sensitive_visible THEN m.email END,
    CASE WHEN s.sensitive_visible THEN m.cpf END,
    CASE WHEN s.sensitive_visible THEN regexp_replace(m.cpf, '\D', '', 'g') END
  )) AS search_text
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
CROSS JOIN LATERAL (
  SELECT coalesce(m.auth_user_id = (SELECT auth.uid()), false)
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action))
         AS sensitive_visible
) s
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (SELECT public.viewer_has('view_members'::public.permission_action))
  OR (
       (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND m.id IN (SELECT public.viewer_ministry_member_ids())
     )
  OR m.auth_user_id = (SELECT auth.uid())
)
AND m.deleted_at IS NULL;   -- E2.01 (RN-08); espelhado em "Members view policy"
-- Consolidação: o filtro ou a coluna do consolidado entra aqui.

REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- cells_view: WHERE espelha "Cells view policy". last_report_date ignora os
-- relatórios excluídos (RN-08, RN-12).
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
  -- G12 da célula: o ancestral de nível 1 do líder (E2.06 troca pelo caminho
  -- materializado, sem mudar o contrato).
  (SELECT public.get_ministry_root(c.leader_id)) AS g12_leader_id,
  (SELECT g.name
     FROM public.members g
    WHERE g.id = public.get_ministry_root(c.leader_id)) AS g12_leader_name,
  -- Último relatório não excluído da célula, visível ou não para quem consulta.
  (SELECT max(r.date)
     FROM public.cell_reports r
    WHERE r.cell_id = c.id
      AND r.deleted_at IS NULL) AS last_report_date,
  -- E2.09: report_status entra no fim da lista, depois de search_text.
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name,
    ll.name, tl.name, hl.name,
    c.street, c.neighborhood
  )) AS search_text
FROM public.cells c
LEFT JOIN public.members l  ON l.id  = c.leader_id
LEFT JOIN public.members t  ON t.id  = c.timothy_id
LEFT JOIN public.members h  ON h.id  = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (SELECT public.viewer_has('view_members'::public.permission_action))
  OR (
       (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (
            c.leader_id  IN (SELECT public.viewer_ministry_member_ids())
         OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
         OR c.host_id    IN (SELECT public.viewer_ministry_member_ids())
       )
     )
  OR c.leader_id  = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
)
AND c.deleted_at IS NULL;   -- E2.01 (RN-08); espelhado em "Cells view policy"

REVOKE ALL ON public.cells_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_view TO authenticated;

-- cell_reports_view: WHERE espelha o comportamento efetivo de "Cell reports
-- view policy" (ver E1.08). Continua juntando a TABELA cells: o relatório de
-- uma célula excluída fica no histórico (RN-11), com cell_deleted = true (AQ-4).
-- participants_count continua contando os participantes excluídos (RN-13).
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
  (SELECT count(*)
     FROM public.cell_report_participants p
    WHERE p.report_id = r.id) AS participants_count,
  -- Dados atuais da célula (E2.11/E4.02: snapshot do relatório, REL-09).
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
  -- E2.01 (AQ-4): a célula do relatório foi excluída.
  (c.deleted_at IS NOT NULL) AS cell_deleted
FROM public.cell_reports r
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
WHERE (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (SELECT public.viewer_has('view_members'::public.permission_action))
  OR c.leader_id  = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR (
       (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (
            c.leader_id  IN (SELECT public.viewer_ministry_member_ids())
         OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
       )
     )
)
AND r.deleted_at IS NULL;   -- E2.01 (RN-08, RN-12); espelhado em "Cell reports view policy"

REVOKE ALL ON public.cell_reports_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_view TO authenticated;

-- cell_report_participants_view: o escopo vem da cell_reports_view (sem
-- relatórios excluídos). O membro excluído continua aparecendo pelo nome
-- (RN-09 b, RN-13), com member_deleted = true (AQ-5).
CREATE OR REPLACE VIEW public.cell_report_participants_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  p.report_id,
  p.member_id,
  m.name AS member_name,
  (m.deleted_at IS NOT NULL) AS member_deleted
FROM public.cell_report_participants p
JOIN public.cell_reports_view r ON r.id = p.report_id
LEFT JOIN public.members m ON m.id = p.member_id;

REVOKE ALL ON public.cell_report_participants_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_report_participants_view TO authenticated;

-- ===========================================================================
-- 3. Views de excluídos (RN-15, AQ-3, DT-06)
-- ===========================================================================
-- Só para manage_roles, com o MESMO predicado de escopo da view principal: o
-- administrador vê os excluídos que veria se eles não estivessem excluídos.
-- deleted_by_name é o nome de quem excluiu, mesmo que ele tenha sido excluído
-- depois; nulo = "Autor não registrado". Ordem das listas (no cliente):
-- deleted_at DESC, id. O alerta "security_definer_view" é esperado.

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
  (l.deleted_at IS NOT NULL) AS leader_deleted,
  m.role_id,
  r.name AS role_name,
  -- Função com que o cadastro volta (DA-2): a padrão, para quem tem conta e
  -- ficou sem função (a função dele foi apagada).
  CASE WHEN m.role_id IS NULL AND m.auth_user_id IS NOT NULL THEN dr.name ELSE r.name END
    AS restore_role_name,
  (m.role_id IS NULL AND m.auth_user_id IS NOT NULL AND dr.id IS NOT NULL) AS role_reset_on_restore,
  (m.auth_user_id IS NOT NULL) AS has_account,
  s.sensitive_visible,
  CASE WHEN s.sensitive_visible THEN m.email           END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf             END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  m.deleted_at,
  m.deleted_by,
  d.name AS deleted_by_name,
  -- Mesma busca da members_view.
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
      OR (SELECT public.viewer_has('view_sensitive_data'::public.permission_action))
         AS sensitive_visible
) s
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
  AND (
       (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR (SELECT public.viewer_has('view_members'::public.permission_action))
    OR (
         (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
         AND m.id IN (SELECT public.viewer_ministry_member_ids())
       )
    OR m.auth_user_id = (SELECT auth.uid())
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
  (l.deleted_at IS NOT NULL) AS leader_deleted,
  c.timothy_id,
  t.name AS timothy_name,
  (t.deleted_at IS NOT NULL) AS timothy_deleted,
  c.host_id,
  h.name AS host_name,
  (h.deleted_at IS NOT NULL) AS host_deleted,
  c.deleted_at,
  c.deleted_by,
  d.name AS deleted_by_name,
  -- Mesma busca da cells_view.
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name,
    ll.name, tl.name, hl.name,
    c.street, c.neighborhood
  )) AS search_text
FROM public.cells c
LEFT JOIN public.members l  ON l.id  = c.leader_id
LEFT JOIN public.members t  ON t.id  = c.timothy_id
LEFT JOIN public.members h  ON h.id  = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
LEFT JOIN public.members d  ON d.id  = c.deleted_by
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
  AND (
       (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR (SELECT public.viewer_has('view_members'::public.permission_action))
    OR (
         (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
         AND (
              c.leader_id  IN (SELECT public.viewer_ministry_member_ids())
           OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
           OR c.host_id    IN (SELECT public.viewer_ministry_member_ids())
         )
       )
    OR c.leader_id  = (SELECT public.viewer_member_id())
    OR c.timothy_id = (SELECT public.viewer_member_id())
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
  (c.deleted_at IS NOT NULL) AS cell_deleted,
  -- A célula já tem outro relatório não excluído na mesma semana: a restauração
  -- seria recusada (RN-17). Usa o índice cell_reports_cell_week_key.
  EXISTS (
    SELECT 1
      FROM public.cell_reports o
     WHERE o.cell_id = r.cell_id
       AND public.week_start(o.date) = public.week_start(r.date)
       AND o.deleted_at IS NULL
  ) AS week_taken,
  r.deleted_at,
  r.deleted_by,
  d.name AS deleted_by_name,
  -- Mesma busca da cell_reports_view.
  public.search_normalize(concat_ws(' ', cl.name, r.theme)) AS search_text
FROM public.cell_reports r
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
LEFT JOIN public.members d  ON d.id  = r.deleted_by
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
  AND (
       (SELECT public.viewer_has('view_all_reports'::public.permission_action))
    OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR (SELECT public.viewer_has('view_members'::public.permission_action))
    OR c.leader_id  = (SELECT public.viewer_member_id())
    OR c.timothy_id = (SELECT public.viewer_member_id())
    OR (
         (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
         AND (
              c.leader_id  IN (SELECT public.viewer_ministry_member_ids())
           OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
         )
       )
  )
  AND r.deleted_at IS NOT NULL;

REVOKE ALL ON public.cell_reports_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_deleted_view TO authenticated;

-- ===========================================================================
-- 4. Políticas de RLS
-- ===========================================================================
-- deleted_at IS NULL fica fora dos parênteses do escopo, espelhado nas views.
-- O WITH CHECK de UPDATE e INSERT impede marcar a exclusão por PATCH ou criar
-- um registro já excluído (42501): a marcação é só pelas RPCs (DT-02).

-- members ------------------------------------------------------------------
DROP POLICY IF EXISTS "Members view policy" ON public.members;
CREATE POLICY "Members view policy"
ON public.members
FOR SELECT
TO authenticated
USING (
  (
       public.user_has_permission(auth.uid(), 'view_all_church'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'view_members'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'view_own_ministry'::public.permission_action)
         AND public.is_in_same_ministry(auth.uid(), id)
       )
    OR auth_user_id = auth.uid()
  )
  AND deleted_at IS NULL   -- E2.01; espelhado na members_view
);

DROP POLICY IF EXISTS "Members update policy" ON public.members;
CREATE POLICY "Members update policy"
ON public.members
FOR UPDATE
TO authenticated
USING (
  (
       public.user_has_permission(auth.uid(), 'edit_member'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'edit_own_data'::public.permission_action)
         AND auth_user_id = auth.uid()
       )
  )
  AND deleted_at IS NULL
)
WITH CHECK (
  (
       public.user_has_permission(auth.uid(), 'edit_member'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'edit_own_data'::public.permission_action)
         AND auth_user_id = auth.uid()
       )
  )
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users with create_member can insert" ON public.members;
CREATE POLICY "Users with create_member can insert"
ON public.members
FOR INSERT
TO authenticated
WITH CHECK (
  public.user_has_permission(auth.uid(), 'create_member'::public.permission_action)
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

-- cells --------------------------------------------------------------------
DROP POLICY IF EXISTS "Cells view policy" ON public.cells;
CREATE POLICY "Cells view policy"
ON public.cells
FOR SELECT
TO authenticated
USING (
  (
       public.user_has_permission(auth.uid(), 'view_all_church'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'view_members'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'view_own_ministry'::public.permission_action)
         AND (
              public.is_in_same_ministry(auth.uid(), leader_id)
           OR public.is_in_same_ministry(auth.uid(), timothy_id)
           OR public.is_in_same_ministry(auth.uid(), host_id)
         )
       )
    OR public.can_manage_own_cell(auth.uid(), id)
  )
  AND deleted_at IS NULL   -- E2.01; espelhado na cells_view
);

DROP POLICY IF EXISTS "Cells update policy" ON public.cells;
CREATE POLICY "Cells update policy"
ON public.cells
FOR UPDATE
TO authenticated
USING (
  (
       public.user_has_permission(auth.uid(), 'edit_cell'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'edit_own_data'::public.permission_action)
         AND public.can_manage_own_cell(auth.uid(), id)
       )
  )
  AND deleted_at IS NULL
)
WITH CHECK (
  (
       public.user_has_permission(auth.uid(), 'edit_cell'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'edit_own_data'::public.permission_action)
         AND public.can_manage_own_cell(auth.uid(), id)
       )
  )
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users with create_cell can insert" ON public.cells;
CREATE POLICY "Users with create_cell can insert"
ON public.cells
FOR INSERT
TO authenticated
WITH CHECK (
  public.user_has_permission(auth.uid(), 'create_cell'::public.permission_action)
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

-- cell_reports -------------------------------------------------------------
-- O ramo view_own_ministry troca o EXISTS em cells (sob o RLS de cells, que
-- agora esconde as excluídas) por cell_in_viewer_ministry, com a mesma regra
-- (DT-05). Os ramos de view_own_reports ficam como estão (E2.02).
DROP POLICY IF EXISTS "Cell reports view policy" ON public.cell_reports;
CREATE POLICY "Cell reports view policy"
ON public.cell_reports
FOR SELECT
TO authenticated
USING (
  (
       public.user_has_permission(auth.uid(), 'view_all_reports'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'view_all_church'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'view_members'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'view_own_reports'::public.permission_action)
         AND (
              public.can_manage_own_cell(auth.uid(), cell_id)
           OR EXISTS (
                SELECT 1 FROM public.cells c
                 WHERE c.id = cell_reports.cell_id
                   AND (   public.is_in_same_ministry(auth.uid(), c.leader_id)
                        OR public.is_in_same_ministry(auth.uid(), c.timothy_id))
              )
         )
       )
    OR (
         public.user_has_permission(auth.uid(), 'view_own_ministry'::public.permission_action)
         AND public.cell_in_viewer_ministry(cell_id)
       )
    OR public.can_manage_own_cell(auth.uid(), cell_id)
  )
  AND deleted_at IS NULL   -- E2.01; espelhado na cell_reports_view
);

DROP POLICY IF EXISTS "Cell reports update policy" ON public.cell_reports;
CREATE POLICY "Cell reports update policy"
ON public.cell_reports
FOR UPDATE
TO authenticated
USING (
  public.user_has_permission(auth.uid(), 'edit_cell_report'::public.permission_action)
  AND deleted_at IS NULL
)
WITH CHECK (
  public.user_has_permission(auth.uid(), 'edit_cell_report'::public.permission_action)
  AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Cell reports insert policy" ON public.cell_reports;
CREATE POLICY "Cell reports insert policy"
ON public.cell_reports
FOR INSERT
TO authenticated
WITH CHECK (
  (
       public.user_has_permission(auth.uid(), 'edit_cell'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'submit_any_visible_report'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'submit_own_cell_report'::public.permission_action)
         AND public.can_manage_own_cell(auth.uid(), cell_id)
       )
    OR (
         public.user_has_permission(auth.uid(), 'edit_own_data'::public.permission_action)
         AND public.can_manage_own_cell(auth.uid(), cell_id)
       )
  )
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

-- cell_report_participants -------------------------------------------------
-- Mesmo ajuste do ramo view_own_ministry (DT-05) e o filtro do relatório não
-- excluído. INSERT e DELETE não mudam: o trigger de participantes recusa os
-- casos da RN-06, RN-07, RN-11 e RN-13 (migration 4).
DROP POLICY IF EXISTS "Participants view policy" ON public.cell_report_participants;
CREATE POLICY "Participants view policy"
ON public.cell_report_participants
FOR SELECT
TO authenticated
USING (
  (
       public.user_has_permission(auth.uid(), 'view_all_reports'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'view_all_church'::public.permission_action)
    OR public.user_has_permission(auth.uid(), 'view_members'::public.permission_action)
    OR (
         public.user_has_permission(auth.uid(), 'view_own_reports'::public.permission_action)
         AND EXISTS (
           SELECT 1
             FROM public.cell_reports cr
             JOIN public.cells c ON c.id = cr.cell_id
            WHERE cr.id = cell_report_participants.report_id
              AND (   public.can_manage_own_cell(auth.uid(), c.id)
                   OR public.is_in_same_ministry(auth.uid(), c.leader_id)
                   OR public.is_in_same_ministry(auth.uid(), c.timothy_id))
         )
       )
    OR (
         public.user_has_permission(auth.uid(), 'view_own_ministry'::public.permission_action)
         AND EXISTS (
           SELECT 1
             FROM public.cell_reports cr
            WHERE cr.id = cell_report_participants.report_id
              AND public.cell_in_viewer_ministry(cr.cell_id)
         )
       )
    OR EXISTS (
         SELECT 1
           FROM public.cell_reports cr
          WHERE cr.id = cell_report_participants.report_id
            AND public.can_manage_own_cell(auth.uid(), cr.cell_id)
       )
  )
  AND EXISTS (   -- E2.01: participantes de relatório excluído somem
    SELECT 1
      FROM public.cell_reports r
     WHERE r.id = cell_report_participants.report_id
       AND r.deleted_at IS NULL
  )
);

-- roles e role_permissions -------------------------------------------------
-- Só quem tem cadastro não excluído lê funções e permissões (DA-9, DT-25).
DROP POLICY IF EXISTS "Authenticated users can view roles" ON public.roles;
CREATE POLICY "Authenticated users can view roles"
ON public.roles
FOR SELECT
TO authenticated
USING ((SELECT public.viewer_member_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Authenticated users can view role permissions" ON public.role_permissions;
CREATE POLICY "Authenticated users can view role permissions"
ON public.role_permissions
FOR SELECT
TO authenticated
USING ((SELECT public.viewer_member_id()) IS NOT NULL);
