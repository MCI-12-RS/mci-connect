-- E2.01 (PR 2, migration 6) — Ordem das conferências no INSERT.
-- Ver docs/specs/e2-01-exclusao-logica.md no repositório apps-mci ("Triggers
-- (última barreira)", "Políticas de RLS", DT-10 e DT-27).
--
-- A permissão de inserir passa a ser a primeira conferência no INSERT de
-- members, cells, cell_reports e cell_report_participants (42501, "Você não
-- tem permissão para esta ação."). Quem pode inserir continua recebendo as
-- mesmas recusas de regra de antes. A política de INSERT continua valendo: o
-- trigger só antecipa a mesma conferência para antes dos outros triggers
-- BEFORE. Não retire o trigger achando que repete a política.
--
-- 1. anon perde INSERT, UPDATE, DELETE e TRUNCATE nas quatro tabelas. Nada
--    grava como anon (o front grava com a sessão do usuário, e as Edge
--    Functions com a sessão de quem chama ou com a service_role); a recusa
--    sai na checagem de privilégio.
-- 2. members: regra 1 (nova) de enforce_member_write_rules, no trigger
--    aa_enforce_member_write_rules, o primeiro BEFORE da tabela: INSERT sem
--    create_member dá 42501. As regras 2 a 6 não mudam.
-- 3. cells, cell_reports e cell_report_participants: o predicado de
--    permissão de cada política de INSERT vira uma função (viewer_can_insert_*)
--    usada pela política e pelo trigger novo a0_check_insert_permission
--    (BEFORE INSERT, INVOKER), que roda antes dos triggers aa_ do E2.01 e dos
--    triggers de semana de cell_reports (a ordem dos BEFORE é alfabética).
--    O trigger deixa passar postgres, service_role e supabase_admin, como o
--    E1.03: as RPCs definer conferem a permissão por conta própria.
--
-- O comportamento das políticas para quem tem permissão não muda. Em
-- participantes, a política fazia o EXISTS em cell_reports sob o RLS de quem
-- grava; a função, que é definer, repete esse efeito explicitamente
-- (relatório não excluído e can_manage_own_cell, que já basta para o
-- relatório ser visível pela política de SELECT de cell_reports).
--
-- UPDATE e DELETE não precisam disso: o USING das políticas filtra as linhas
-- antes dos triggers.
--
-- Pode rodar de novo sem erro: REVOKE, CREATE OR REPLACE, DROP ... IF EXISTS
-- antes de cada CREATE POLICY e CREATE TRIGGER, e grants.

-- ===========================================================================
-- 1. anon não grava nas quatro tabelas
-- ===========================================================================
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.members, public.cells, public.cell_reports, public.cell_report_participants
  FROM PUBLIC, anon;

-- ===========================================================================
-- 2. members: regra 1 de enforce_member_write_rules
-- ===========================================================================
-- Reescrita inteira. Só entra a regra 1; as regras 2 a 6 estão iguais à versão
-- em produção (E1.03, com a regra 6 do E1.08). A regra 1 do E1.03 (uma conta
-- por membro) é o índice members_auth_user_id_key, fora desta função.
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

  -- 1. Cadastro só com create_member (E2.01, ordem das conferências no
  --    INSERT): a permissão vem antes das outras regras desta função e dos
  --    triggers seguintes. viewer_has é falso sem usuário logado.
  IF TG_OP = 'INSERT' AND NOT public.viewer_has('create_member'::permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
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

-- Função de trigger: não é chamada direto.
REVOKE ALL ON FUNCTION public.enforce_member_write_rules() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. cells, cell_reports e cell_report_participants
-- ===========================================================================

-- 3.1 Predicados de permissão de INSERT (os mesmos das políticas até aqui).
--     Sem parâmetro de usuário: valem para quem está logado (auth.uid()).

-- cells: create_cell.
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('create_cell'::public.permission_action)
$$;

-- cell_reports: edit_cell ou submit_any_visible_report em qualquer célula;
-- submit_own_cell_report ou edit_own_data na célula de que é líder ou timóteo.
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell_report(_cell_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('edit_cell'::public.permission_action)
      OR public.viewer_has('submit_any_visible_report'::public.permission_action)
      OR (
           (    public.viewer_has('submit_own_cell_report'::public.permission_action)
             OR public.viewer_has('edit_own_data'::public.permission_action) )
           AND public.can_manage_own_cell(auth.uid(), _cell_id)
         )
$$;

-- cell_report_participants: edit_cell ou submit_any_visible_report em
-- qualquer relatório; submit_own_cell_report ou edit_own_data num relatório
-- não excluído da célula de que é líder ou timóteo. A política antiga lia
-- cell_reports sob o RLS de quem grava, que esconde o relatório excluído; o
-- r.deleted_at IS NULL reproduz isso (com can_manage_own_cell, o relatório
-- não excluído é sempre visível pela política de SELECT de cell_reports).
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell_report_participant(_report_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('edit_cell'::public.permission_action)
      OR public.viewer_has('submit_any_visible_report'::public.permission_action)
      OR (
           (    public.viewer_has('submit_own_cell_report'::public.permission_action)
             OR public.viewer_has('edit_own_data'::public.permission_action) )
           AND EXISTS (
             SELECT 1
               FROM public.cell_reports r
              WHERE r.id = _report_id
                AND r.deleted_at IS NULL
                AND public.can_manage_own_cell(auth.uid(), r.cell_id)
           )
         )
$$;

REVOKE ALL ON FUNCTION public.viewer_can_insert_cell() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_can_insert_cell_report(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_can_insert_cell_report_participant(uuid) FROM PUBLIC, anon;
-- As políticas rodam como quem grava.
GRANT EXECUTE ON FUNCTION public.viewer_can_insert_cell() TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_can_insert_cell_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.viewer_can_insert_cell_report_participant(uuid) TO authenticated;

-- 3.2 Políticas de INSERT com as funções (mesmo nome e mesmo efeito).
DROP POLICY IF EXISTS "Users with create_cell can insert" ON public.cells;
CREATE POLICY "Users with create_cell can insert"
ON public.cells
FOR INSERT
TO authenticated
WITH CHECK (
  public.viewer_can_insert_cell()
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

DROP POLICY IF EXISTS "Cell reports insert policy" ON public.cell_reports;
CREATE POLICY "Cell reports insert policy"
ON public.cell_reports
FOR INSERT
TO authenticated
WITH CHECK (
  public.viewer_can_insert_cell_report(cell_id)
  AND deleted_at IS NULL
  AND deleted_by IS NULL
);

DROP POLICY IF EXISTS "Participants insert policy" ON public.cell_report_participants;
CREATE POLICY "Participants insert policy"
ON public.cell_report_participants
FOR INSERT
TO authenticated
WITH CHECK (
  public.viewer_can_insert_cell_report_participant(report_id)
);

-- 3.3 Trigger a0_check_insert_permission: a mesma função da política, antes
--     dos outros triggers BEFORE. INVOKER, para enxergar quem grava em
--     current_user.
CREATE OR REPLACE FUNCTION public.enforce_insert_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _allowed boolean;
BEGIN
  -- Migrations, manutenção, Edge Functions com a service_role e RPCs definer
  -- (que conferem a permissão por conta própria).
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Um IF por tabela: cada ramo só é preparado quando roda, e NEW só tem as
  -- colunas da tabela do trigger.
  IF TG_TABLE_NAME = 'cells' THEN
    _allowed := public.viewer_can_insert_cell();
  ELSIF TG_TABLE_NAME = 'cell_reports' THEN
    _allowed := public.viewer_can_insert_cell_report(NEW.cell_id);
  ELSIF TG_TABLE_NAME = 'cell_report_participants' THEN
    _allowed := public.viewer_can_insert_cell_report_participant(NEW.report_id);
  ELSE
    RAISE EXCEPTION 'enforce_insert_permission: tabela não prevista (%)', TG_TABLE_NAME;
  END IF;

  IF NOT coalesce(_allowed, false) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Função de trigger: não é chamada direto.
REVOKE ALL ON FUNCTION public.enforce_insert_permission() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a0_check_insert_permission ON public.cells;
CREATE TRIGGER a0_check_insert_permission
BEFORE INSERT ON public.cells
FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_permission();

DROP TRIGGER IF EXISTS a0_check_insert_permission ON public.cell_reports;
CREATE TRIGGER a0_check_insert_permission
BEFORE INSERT ON public.cell_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_permission();

DROP TRIGGER IF EXISTS a0_check_insert_permission ON public.cell_report_participants;
CREATE TRIGGER a0_check_insert_permission
BEFORE INSERT ON public.cell_report_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_insert_permission();
