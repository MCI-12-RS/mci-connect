-- E1.08 (PR 1) — Fundação de leitura no servidor e máscara de dados sensíveis.
-- Ver docs/specs/e1-08-paginacao-servidor.md no repositório apps-mci.
--
-- 1. Utilitários de data (horário de Brasília, semana de domingo a sábado) e de
--    busca (sem acento, sem diferenciar maiúsculas).
-- 2. Escopo de quem consulta: funções sem parâmetro de usuário, sempre auth.uid().
--    viewer_ministry_member_ids() calcula o ministério uma vez por consulta, em
--    vez de chamar is_in_same_ministry linha a linha.
-- 3. members_view: a leitura de membros do front. Mesmo escopo da política de
--    SELECT de members, nome do líder, vínculo celular, coluna de busca e a
--    máscara de dados sensíveis (CPF, e-mail, telefones, rua, número,
--    complemento e CEP), que só saem para o próprio membro e para quem tem
--    view_sensitive_data.
-- 4. Regra 6 no trigger de escrita: quem não vê os dados sensíveis de um membro
--    não os altera.
-- 5. As roles de sistema (Administrador) passam a ter view_sensitive_data.
-- 6. Índices para as listas.

-- ---------------------------------------------------------------------------
-- 1. Utilitários
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

-- Agora e hoje no horário de Brasília.
CREATE OR REPLACE FUNCTION public.sp_now()
RETURNS timestamp
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT now() AT TIME ZONE 'America/Sao_Paulo' $$;

CREATE OR REPLACE FUNCTION public.sp_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- Domingo da semana do dia informado (semana de domingo a sábado).
CREATE OR REPLACE FUNCTION public.week_start(_day date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$ SELECT _day - extract(dow FROM _day)::int $$;

-- 'Domingo' = 0 … 'Sábado' = 6; valor desconhecido = NULL.
-- Espelho de src/lib/cells/weekdays.ts no mci-connect.
CREATE OR REPLACE FUNCTION public.weekday_index(_meeting_day text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT array_position(
    ARRAY['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'],
    _meeting_day
  ) - 1
$$;

-- Texto normalizado para busca: sem acento e em minúsculas. O dicionário vai
-- qualificado para não depender do search_path de quem consulta.
-- Espelho de src/lib/search.ts no mci-connect.
CREATE OR REPLACE FUNCTION public.search_normalize(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, _value)) $$;

-- ---------------------------------------------------------------------------
-- 2. Escopo de quem consulta
-- ---------------------------------------------------------------------------
-- Nenhuma destas funções recebe um usuário: elas sempre respondem sobre a
-- sessão atual. SECURITY DEFINER para não passar pelo RLS de members.

CREATE OR REPLACE FUNCTION public.viewer_member_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.id FROM public.members m WHERE m.auth_user_id = auth.uid()
  -- E2.01 (DEL-06): AND m.deleted_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.viewer_has(_permission public.permission_action)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND public.user_has_permission(auth.uid(), _permission)
$$;

-- Equivalente, em conjunto, de is_in_same_ministry(auth.uid(), x): devolve todos
-- os x para os quais aquela função devolveria true, com a mesma semântica de
-- get_ministry_root (a subida para no primeiro nível 1, desiste em nível 0 e
-- examina no máximo 20 ancestrais).
--   - o próprio membro;
--   - a raiz do ministério (o G12) e o cônjuge dela;
--   - todo membro cuja raiz seja o G12, o cônjuge do G12 ou alguém casado com o
--     G12 (desde que essa pessoa seja de nível 1).
-- O E2.02 (AUT-03) muda o escopo aqui e nas políticas de RLS.
CREATE OR REPLACE FUNCTION public.viewer_ministry_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE
  me AS (
    SELECT public.viewer_member_id() AS id
  ),
  root AS (
    SELECT r.id, r.spouse_id
      FROM me
      JOIN public.members r ON r.id = public.get_ministry_root(me.id)
  ),
  anchors AS (
    SELECT id FROM root
    UNION
    SELECT spouse_id FROM root WHERE spouse_id IS NOT NULL
    UNION
    SELECT x.id FROM root JOIN public.members x ON x.spouse_id = root.id
  ),
  tree AS (
    SELECT m.id, 0 AS depth
      FROM anchors a
      JOIN public.members m ON m.id = a.id AND m.g12_level = 1
    UNION ALL
    SELECT c.id, t.depth + 1
      FROM tree t
      JOIN public.members c ON c.leader_id = t.id
     WHERE c.g12_level NOT IN (0, 1)
       AND t.depth < 20
  )
  SELECT id FROM me WHERE id IS NOT NULL
  UNION
  SELECT id FROM root
  UNION
  SELECT spouse_id FROM root WHERE spouse_id IS NOT NULL
  UNION
  SELECT id FROM tree
$$;

REVOKE EXECUTE ON FUNCTION public.sp_now() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sp_today() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.week_start(date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.weekday_index(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_normalize(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.viewer_member_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.viewer_has(public.permission_action) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.viewer_ministry_member_ids() FROM PUBLIC, anon;

-- As views executam as funções com o papel de quem consulta.
GRANT EXECUTE ON FUNCTION public.sp_now() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sp_today() TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_start(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.weekday_index(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_normalize(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_member_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_has(public.permission_action) TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_ministry_member_ids() TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. members_view
-- ---------------------------------------------------------------------------
-- View com os privilégios do dono (postgres), que não passa pelo RLS: o WHERE
-- é o espelho exato da política "Members view policy" (E1.13). O alerta
-- "security_definer_view" do Supabase é esperado; trocar para security_invoker
-- desligaria a máscara.
--
-- As subconsultas sem correlação, (SELECT ...), viram InitPlan: as permissões
-- são avaliadas uma vez por consulta. O security_barrier impede que filtros
-- enviados pelo cliente rodem antes do filtro de escopo.
--
-- A lista de colunas sensíveis é espelhada em src/lib/members/fields.ts, na
-- regra 6 de enforce_member_write_rules e no GRANT por coluna do PR 5.
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
  -- Bairro, cidade e UF não são sensíveis (decisão D-2).
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
  -- Dados sensíveis (RN-11)
  CASE WHEN s.sensitive_visible THEN m.email           END AS email,
  CASE WHEN s.sensitive_visible THEN m.cpf             END AS cpf,
  CASE WHEN s.sensitive_visible THEN m.mobile_whatsapp END AS mobile_whatsapp,
  CASE WHEN s.sensitive_visible THEN m.phone           END AS phone,
  CASE WHEN s.sensitive_visible THEN m.street          END AS street,
  CASE WHEN s.sensitive_visible THEN m.number          END AS number,
  CASE WHEN s.sensitive_visible THEN m.complement      END AS complement,
  CASE WHEN s.sensitive_visible THEN m.zip_code        END AS zip_code,
  -- Vínculo celular (MEM-14), sobre todas as células e relatórios, não só os
  -- visíveis. E2.01: ignorar os excluídos.
  EXISTS (SELECT 1 FROM public.cells c WHERE c.leader_id  = m.id) AS is_cell_leader,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.timothy_id = m.id) AS is_cell_timothy,
  EXISTS (SELECT 1 FROM public.cells c WHERE c.host_id    = m.id) AS is_cell_host,
  m.id IN (
    SELECT p.member_id
      FROM public.cell_report_participants p
      JOIN public.cell_reports r ON r.id = p.report_id
     WHERE r.date >= public.sp_today() - 30
  ) AS attended_last_30_days,
  -- Busca (RN-04, RN-13): só com valores que quem consulta pode ver.
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
);
-- E2.01: AND m.deleted_at IS NULL (fora dos parênteses do escopo).
-- Consolidação: o filtro ou a coluna do consolidado entra aqui.

-- Só leitura, e só para usuários logados. Uma escrita pela view rodaria como o
-- dono, passando por cima do RLS.
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Regra 6 no trigger de escrita de members
-- ---------------------------------------------------------------------------
-- Corpo igual ao do E1.03 (20261114210000), com a regra 6 no fim.
CREATE OR REPLACE FUNCTION public.enforce_member_write_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _default_role uuid;
  _blocked text[] := ARRAY[]::text[];
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  SELECT id INTO _default_role FROM public.roles WHERE is_default LIMIT 1;

  -- 3. Colunas calculadas pelo servidor
  IF TG_OP = 'UPDATE' THEN
    -- g12_level é recalculado por compute_member_g12_level, que roda depois deste trigger
    NEW.g12_level := OLD.g12_level;
    NEW.total_disciples := OLD.total_disciples;
    NEW.total_cells := OLD.total_cells;
    NEW.male_cells := OLD.male_cells;
    NEW.female_cells := OLD.female_cells;
    NEW.created_at := OLD.created_at;
  ELSE
    NEW.total_disciples := 0;
    NEW.total_cells := 0;
    NEW.male_cells := 0;
    NEW.female_cells := 0;
  END IF;

  -- 2. Conta de acesso
  IF TG_OP = 'UPDATE' AND NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    RAISE EXCEPTION 'Não é permitido alterar a conta de acesso do membro.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.auth_user_id IS NOT NULL AND NEW.auth_user_id = _uid THEN
    RAISE EXCEPTION 'Não é permitido vincular o próprio acesso a outro cadastro.' USING ERRCODE = '42501';
  END IF;

  -- 4. Função (perfil)
  IF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    IF OLD.auth_user_id = _uid THEN
      RAISE EXCEPTION 'Ninguém pode alterar a própria função.' USING ERRCODE = '42501';
    END IF;
    -- Dar a função padrão a quem não tem função é livre, como no cadastro.
    IF NOT (OLD.role_id IS NULL AND NEW.role_id = _default_role)
       AND (NOT public.can_assign_role(OLD.role_id) OR NOT public.can_assign_role(NEW.role_id)) THEN
      RAISE EXCEPTION 'Você não tem permissão para alterar a função deste membro.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.role_id IS NOT NULL THEN
    -- Cadastro sem função (role_id NULL) é aceito: o membro fica sem permissões.
    IF NEW.role_id IS DISTINCT FROM _default_role AND NOT public.can_assign_role(NEW.role_id) THEN
      RAISE EXCEPTION 'Você não tem permissão para atribuir esta função.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 5. Próprio cadastro sem edit_member: só dados pessoais
  IF TG_OP = 'UPDATE'
     AND OLD.auth_user_id = _uid
     AND NOT public.user_has_permission(_uid, 'edit_member'::permission_action) THEN
    IF NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN _blocked := array_append(_blocked, 'líder'); END IF;
    IF NEW.has_leadership IS DISTINCT FROM OLD.has_leadership THEN _blocked := array_append(_blocked, 'liderança'); END IF;
    IF NEW.spouse_id IS DISTINCT FROM OLD.spouse_id THEN _blocked := array_append(_blocked, 'cônjuge'); END IF;
    IF NEW.is_pastor IS DISTINCT FROM OLD.is_pastor THEN _blocked := array_append(_blocked, 'pastor'); END IF;
    IF NEW.is_baptized IS DISTINCT FROM OLD.is_baptized THEN _blocked := array_append(_blocked, 'batismo'); END IF;
    IF NEW.baptism_date IS DISTINCT FROM OLD.baptism_date THEN _blocked := array_append(_blocked, 'data do batismo'); END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN _blocked := array_append(_blocked, 'situação (ativo/inativo)'); END IF;

    IF array_length(_blocked, 1) IS NOT NULL THEN
      RAISE EXCEPTION 'Você só pode alterar os seus dados pessoais. Não é permitido alterar: %.',
        array_to_string(_blocked, ', ')
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 6. Dados sensíveis: quem não os vê não os altera (E1.08, RN-12). O valor
  --    enviado é ignorado sem erro, como nas colunas calculadas: um cliente que
  --    reenvia a linha lida da members_view (com os campos nulos) não apaga nada.
  IF TG_OP = 'UPDATE'
     AND OLD.auth_user_id IS DISTINCT FROM _uid
     AND NOT public.user_has_permission(_uid, 'view_sensitive_data'::permission_action) THEN
    NEW.email := OLD.email;
    NEW.cpf := OLD.cpf;
    NEW.mobile_whatsapp := OLD.mobile_whatsapp;
    NEW.phone := OLD.phone;
    NEW.street := OLD.street;
    NEW.number := OLD.number;
    NEW.complement := OLD.complement;
    NEW.zip_code := OLD.zip_code;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Roles de sistema veem os dados sensíveis (RN-14)
-- ---------------------------------------------------------------------------
-- A tela já tratava a role de sistema como tendo todas as permissões; o banco
-- passa a concordar para esta, que a máscara exige.
INSERT INTO public.role_permissions (role_id, permission)
SELECT r.id, 'view_sensitive_data'::public.permission_action
  FROM public.roles r
 WHERE r.is_system
ON CONFLICT (role_id, permission) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS members_leader_id_idx ON public.members (leader_id);
CREATE INDEX IF NOT EXISTS members_spouse_id_idx ON public.members (spouse_id);
CREATE INDEX IF NOT EXISTS members_name_id_idx ON public.members (name, id);
-- Vínculo celular da members_view
CREATE INDEX IF NOT EXISTS cells_leader_id_idx ON public.cells (leader_id);
CREATE INDEX IF NOT EXISTS cells_timothy_id_idx ON public.cells (timothy_id);
CREATE INDEX IF NOT EXISTS cells_host_id_idx ON public.cells (host_id);
CREATE INDEX IF NOT EXISTS cell_reports_date_id_idx ON public.cell_reports (date DESC, id);
