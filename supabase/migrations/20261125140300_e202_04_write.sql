-- E2.02 (PR 1, migration 4) — Escrita no escopo novo e funções protegidas.
-- Ver docs/specs/e2-02-perfis-escopo.md no repositório apps-mci ("Escrita
-- (migration 4)", "Formato dos erros (AQ-5)", "Bloqueios e concorrência",
-- RN-09 a RN-14, RN-17 a RN-21, DA-2 a DA-5, DA-7, DA-8, DA-10, DA-11, DT-06,
-- DT-07, DT-12 a DT-15, DT-20, DT-21, DT-27).
--
-- Erros (DT-15): 42501 só para falta de permissão; as regras saem com 22023,
-- HINT 'app_error' e DETAIL em JSON ({ code, ... }), como no E2.01. As regras
-- de função e de próprio cadastro do E1.03 deixam o 42501.
--
-- Triggers de escopo (SECURITY INVOKER, como o do E1.03): não valem para
-- postgres, service_role e supabase_admin (current_user), o que inclui as RPCs
-- definer e a cascata do trigger de cônjuge (DT-06). As RPCs definer que
-- gravam conferem as mesmas regras pelas funções de linha.
--   Como são INVOKER, eles levantam o erro direto (RAISE ... USING), sem
--   chamar _del_raise, que só tem EXECUTE para postgres e service_role
--   (alerta de 2026-11-24 na Implantação do spec). Torná-los definer mudaria
--   o current_user e desligaria a exceção acima; dar EXECUTE de _del_raise a
--   authenticated abriria uma função interna.
--   Ordem dos BEFORE (alfabética): a0_ (permissão do E2.01), aa_ e ab_ do
--   E2.01 (o excluído tem prioridade sobre o invisível), depois os deste passo.
--
-- Triggers de roles e role_permissions (RN-17, RN-19, RN-20, DA-3): valem para
-- todos os papéis (DT-27 do E2.01), exceto com app.role_maintenance = 'on'
-- (só migrations de manutenção). São definer: contam membros e leem funções
-- sem depender do RLS nem do privilégio de coluna de quem grava. O constraint
-- trigger da padrão (zz_roles_exactly_one_default) não tem exceção.
--
-- Até o PR 6, a tela de Funções antiga continua gravando direto nas tabelas,
-- sob estes triggers (risco 7).
--
-- No fim, authenticated perde o EXECUTE de user_has_permission (RN-23, DT-11):
-- o trigger de members, reescrito aqui, era o último chamador INVOKER.
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE, DROP TRIGGER IF EXISTS antes
-- de cada CREATE TRIGGER e grants.

-- ===========================================================================
-- 1. members
-- ===========================================================================

-- RN-21 (DA-8): ao tirar a função is_system de alguém, sobra outro membro não
-- excluído com ela? A trava consultiva 'admin-members' põe em série duas
-- retiradas cruzadas. Só age quando quem chama cobre a Administrador (só um
-- administrador consegue tirá-la, e ele já vê a função de todos): para os
-- demais não faz nada, e a recusa de permissão sai antes, no trigger.
-- Definer, com EXECUTE para authenticated, porque o trigger de members é
-- INVOKER (como default_role_id).
CREATE OR REPLACE FUNCTION public._assert_admin_remains(_member_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _system uuid;
BEGIN
  SELECT r.id INTO _system FROM public.roles r WHERE r.is_system;
  IF _system IS NULL OR NOT public.viewer_covers_role(_system) THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = _member_id AND m.role_id = _system) THEN
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('admin-members', 0));
  IF NOT EXISTS (
    SELECT 1 FROM public.members m
     WHERE m.role_id = _system
       AND m.deleted_at IS NULL
       AND m.id <> _member_id
  ) THEN
    PERFORM public._del_raise('last_admin',
      'Não é possível tirar a função Administrador do último administrador.');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assert_admin_remains(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._assert_admin_remains(uuid) TO authenticated, service_role;

-- Regras de escrita do E1.03 e do E1.08 (aa_enforce_member_write_rules), com
-- a regra 4 reescrita (RN-18, RN-19, RN-21, DA-10, DT-13) e os códigos
-- app_error (DT-15). As permissões vêm de viewer_has, que responde só sobre
-- quem grava.
CREATE OR REPLACE FUNCTION public.enforce_member_write_rules()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _default_role uuid;
  _assigns boolean;
  _blocked text[] := ARRAY[]::text[];       -- rótulos, para a mensagem
  _blocked_cols text[] := ARRAY[]::text[];  -- colunas, para o DETAIL (fields)
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- 1. Cadastro só com create_member (E2.01): antes de todas as outras regras.
  IF TG_OP = 'INSERT' AND NOT public.viewer_has('create_member'::permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

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

  -- 4. Função (RN-18, RN-19, RN-21)
  IF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    IF OLD.auth_user_id = _uid THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Ninguém pode alterar a própria função.',
        DETAIL = jsonb_build_object('code', 'own_role')::text;
    END IF;
    IF NOT public.can_assign_role(OLD.role_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Você não tem permissão para alterar a função deste membro.',
        DETAIL = jsonb_build_object('code', 'role_change_not_allowed')::text;
    END IF;
    IF NOT public.can_assign_role(NEW.role_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Você não tem permissão para atribuir esta função.',
        DETAIL = jsonb_build_object('code', 'role_not_assignable')::text;
    END IF;
    -- Tirar a Administrador de alguém: sobra outro administrador? (DA-8)
    PERFORM public._assert_admin_remains(OLD.id);
  ELSIF TG_OP = 'INSERT' THEN
    _assigns := public.viewer_has('assign_role'::permission_action)
             OR public.viewer_has('manage_roles'::permission_action);
    IF _assigns THEN
      -- Sem função é aceito (DA-10).
      IF NEW.role_id IS NOT NULL AND NOT public.can_assign_role(NEW.role_id) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
          MESSAGE = 'Você não tem permissão para atribuir esta função.',
          DETAIL = jsonb_build_object('code', 'role_not_assignable')::text;
      END IF;
    ELSE
      -- Quem não atribui cadastra sempre com a padrão, que o banco preenche,
      -- e precisa cobri-la (RN-19).
      _default_role := public.default_role_id();
      NEW.role_id := coalesce(NEW.role_id, _default_role);
      IF NEW.role_id IS DISTINCT FROM _default_role THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
          MESSAGE = 'Você não tem permissão para atribuir esta função.',
          DETAIL = jsonb_build_object('code', 'role_not_assignable')::text;
      END IF;
      IF NOT public.viewer_covers_role(_default_role) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
          MESSAGE = 'A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.',
          DETAIL = jsonb_build_object('code', 'default_role_not_covered')::text;
      END IF;
    END IF;
  END IF;

  -- 5. Próprio cadastro sem edit_member: só dados pessoais (RN-11)
  IF TG_OP = 'UPDATE'
     AND OLD.auth_user_id = _uid
     AND NOT public.viewer_has('edit_member'::permission_action) THEN
    IF NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN
      _blocked := array_append(_blocked, 'líder'); _blocked_cols := array_append(_blocked_cols, 'leader_id');
    END IF;
    IF NEW.has_leadership IS DISTINCT FROM OLD.has_leadership THEN
      _blocked := array_append(_blocked, 'liderança'); _blocked_cols := array_append(_blocked_cols, 'has_leadership');
    END IF;
    IF NEW.spouse_id IS DISTINCT FROM OLD.spouse_id THEN
      _blocked := array_append(_blocked, 'cônjuge'); _blocked_cols := array_append(_blocked_cols, 'spouse_id');
    END IF;
    IF NEW.is_pastor IS DISTINCT FROM OLD.is_pastor THEN
      _blocked := array_append(_blocked, 'pastor'); _blocked_cols := array_append(_blocked_cols, 'is_pastor');
    END IF;
    IF NEW.is_baptized IS DISTINCT FROM OLD.is_baptized THEN
      _blocked := array_append(_blocked, 'batismo'); _blocked_cols := array_append(_blocked_cols, 'is_baptized');
    END IF;
    IF NEW.baptism_date IS DISTINCT FROM OLD.baptism_date THEN
      _blocked := array_append(_blocked, 'data do batismo'); _blocked_cols := array_append(_blocked_cols, 'baptism_date');
    END IF;
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      _blocked := array_append(_blocked, 'situação (ativo/inativo)'); _blocked_cols := array_append(_blocked_cols, 'is_active');
    END IF;
    IF array_length(_blocked, 1) IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = format('Você só pode alterar os seus dados pessoais. Não é permitido alterar: %s.',
                         array_to_string(_blocked, ', ')),
        DETAIL = jsonb_build_object('code', 'own_data_only', 'fields', to_jsonb(_blocked_cols))::text;
    END IF;
  END IF;

  -- 6. Dados sensíveis: quem não os vê não os altera (E1.08, RN-12). O valor
  --    enviado é ignorado sem erro, como nas colunas calculadas.
  IF TG_OP = 'UPDATE'
     AND OLD.auth_user_id IS DISTINCT FROM _uid
     AND NOT public.viewer_has('view_sensitive_data'::permission_action) THEN
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

-- ac_enforce_member_scope: DA-11, RN-10 (pastor e sem liderança, DA-2) e
-- RN-09 (b) para líder e cônjuge que mudaram (ou todos, no cadastro).
-- A coerência de has_leadership (DA-11) vale para todos os papéis; o resto não
-- vale para postgres, service_role e supabase_admin.
CREATE OR REPLACE FUNCTION public.enforce_member_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _field text;
BEGIN
  IF NEW.leader_id IS NOT NULL AND NOT NEW.has_leadership THEN
    NEW.has_leadership := true;                                                   -- DA-11
  END IF;

  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- RN-10: só quem vê a igreja toda marca ou desmarca pastor e sem liderança.
  -- Manter como está é aceito (P-PER-23).
  IF NOT public.viewer_has('view_all_church'::permission_action) THEN
    _field := CASE
      WHEN TG_OP = 'INSERT' AND NEW.is_pastor THEN 'is_pastor'
      WHEN TG_OP = 'UPDATE' AND NEW.is_pastor IS DISTINCT FROM OLD.is_pastor THEN 'is_pastor'
      WHEN TG_OP = 'UPDATE' AND OLD.is_pastor
           AND NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN 'leader_id'          -- DA-2
      WHEN NEW.leader_id IS NULL AND NOT NEW.is_pastor
           AND (TG_OP = 'INSERT' OR OLD.leader_id IS NOT NULL) THEN 'leader_id'
      WHEN TG_OP = 'UPDATE' AND OLD.has_leadership AND NOT NEW.has_leadership THEN 'has_leadership'
    END;
    IF _field IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.',
        DETAIL = jsonb_build_object('code', 'pastor_or_no_leadership_requires_church', 'field', _field)::text;
    END IF;
  END IF;

  -- RN-09 (b): a pessoa escolhida precisa estar visível. Quem já estava fica.
  IF NEW.leader_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.leader_id IS DISTINCT FROM OLD.leader_id)
     AND NOT public.viewer_sees_member(NEW.leader_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Você só pode escolher pessoas que você vê.',
      DETAIL = jsonb_build_object('code', 'person_not_visible', 'field', 'leader_id',
                                  'member_id', NEW.leader_id)::text;
  END IF;
  IF NEW.spouse_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.spouse_id IS DISTINCT FROM OLD.spouse_id)
     AND NOT public.viewer_sees_member(NEW.spouse_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Você só pode escolher pessoas que você vê.',
      DETAIL = jsonb_build_object('code', 'person_not_visible', 'field', 'spouse_id',
                                  'member_id', NEW.spouse_id)::text;
  END IF;

  RETURN NEW;
END;
$$;

-- zz_enforce_member_visible_after: RN-09 (c). AFTER e depois de
-- sync_spouse_relationship_trigger (ordem alfabética), então enxerga o
-- cônjuge já desfeito e a árvore nova (DT-07). Renomear um dos dois quebra a
-- regra (risco 4).
CREATE OR REPLACE FUNCTION public.enforce_member_visible_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF NOT public.viewer_sees_member(NEW.id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.',
      DETAIL = jsonb_build_object('code', 'would_leave_scope', 'entity', 'member')::text;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ac_enforce_member_scope ON public.members;
CREATE TRIGGER ac_enforce_member_scope
  BEFORE INSERT OR UPDATE OF leader_id, spouse_id, is_pastor, has_leadership ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_scope();

DROP TRIGGER IF EXISTS zz_enforce_member_visible_after ON public.members;
CREATE TRIGGER zz_enforce_member_visible_after
  AFTER INSERT OR UPDATE OF leader_id, spouse_id ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.enforce_member_visible_after();

-- ===========================================================================
-- 2. cells: RN-09 (b) e (c)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.enforce_cell_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _fields text[] := ARRAY['leader_id', 'timothy_id', 'host_id'];
  _new uuid[];
  _old uuid[];
  _i int;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  _new := ARRAY[NEW.leader_id, NEW.timothy_id, NEW.host_id];
  IF TG_OP = 'UPDATE' THEN
    _old := ARRAY[OLD.leader_id, OLD.timothy_id, OLD.host_id];
  END IF;

  -- (b) quem entra precisa estar visível.
  FOR _i IN 1 .. 3 LOOP
    IF _new[_i] IS NOT NULL
       AND (TG_OP = 'INSERT' OR _new[_i] IS DISTINCT FROM _old[_i])
       AND NOT public.viewer_sees_member(_new[_i]) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Você só pode escolher pessoas que você vê.',
        DETAIL = jsonb_build_object('code', 'person_not_visible', 'field', _fields[_i],
                                    'member_id', _new[_i])::text;
    END IF;
  END LOOP;

  -- (c) a célula continua visível (só depende das colunas novas, DT-07).
  IF NOT public.viewer_sees_cell_people(NEW.leader_id, NEW.timothy_id, NEW.host_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Com esta alteração, você deixaria de ver esta célula. Mantenha pelo menos uma pessoa do seu ministério como líder, timóteo ou anfitrião. As alterações não foram salvas.',
      DETAIL = jsonb_build_object('code', 'would_leave_scope', 'entity', 'cell')::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_enforce_cell_scope ON public.cells;
CREATE TRIGGER ab_enforce_cell_scope
  BEFORE INSERT OR UPDATE OF leader_id, timothy_id, host_id ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cell_scope();

-- ===========================================================================
-- 3. cell_reports: quem lança (RN-13)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.enforce_cell_report_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') OR NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT (    public.viewer_has('edit_cell'::permission_action)
             OR public.viewer_has('submit_any_visible_report'::permission_action)
             OR public.viewer_has('submit_own_cell_report'::permission_action)) THEN
      RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.viewer_sees_cell(NEW.cell_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Esta célula não existe ou já foi excluída.',
        DETAIL = jsonb_build_object('code', 'not_found_or_deleted', 'entity', 'cell')::text;
    END IF;
    IF NOT public.can_submit_report(NEW.cell_id) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Você não pode enviar o relatório desta célula.',
        DETAIL = jsonb_build_object('code', 'report_submit_not_allowed', 'cell_id', NEW.cell_id)::text;
    END IF;
  ELSIF NEW.cell_id IS DISTINCT FROM OLD.cell_id AND NOT public.viewer_sees_cell(NEW.cell_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Esta célula não existe ou já foi excluída.',
      DETAIL = jsonb_build_object('code', 'not_found_or_deleted', 'entity', 'cell')::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_enforce_cell_report_scope ON public.cell_reports;
CREATE TRIGGER ab_enforce_cell_report_scope
  BEFORE INSERT OR UPDATE OF cell_id ON public.cell_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cell_report_scope();

-- ===========================================================================
-- 4. cell_report_participants: RN-09 (b) para o participante novo
-- ===========================================================================
-- Um par que já existe passa sem conferência, como no trigger do E2.01. A
-- retirada não é conferida aqui ("retirar não é escolher"); a política de
-- DELETE exige "Editar Relatórios de Células" (DA-5).
CREATE OR REPLACE FUNCTION public.enforce_participant_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.cell_report_participants p
              WHERE p.report_id = NEW.report_id AND p.member_id = NEW.member_id) THEN
    RETURN NEW;
  END IF;
  IF NOT public.viewer_sees_member(NEW.member_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Você só pode escolher pessoas que você vê.',
      DETAIL = jsonb_build_object('code', 'person_not_visible', 'field', 'member_id',
                                  'member_id', NEW.member_id)::text;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_enforce_participant_scope ON public.cell_report_participants;
CREATE TRIGGER ab_enforce_participant_scope
  BEFORE INSERT ON public.cell_report_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_participant_scope();

-- ===========================================================================
-- 5. roles e role_permissions (RN-17, RN-19, RN-20, DA-3)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.protect_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _count int;
BEGIN
  IF current_setting('app.role_maintenance', true) = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.is_system THEN
      PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser alterada.',
        '{"operation": "update"}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.is_system THEN
      IF NEW.is_default THEN
        PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser a função padrão.',
          '{"operation": "default"}'::jsonb);
      END IF;
      IF NEW.name IS DISTINCT FROM OLD.name
         OR NEW.description IS DISTINCT FROM OLD.description
         OR NOT NEW.is_system THEN
        PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser alterada.',
          '{"operation": "update"}'::jsonb);
      END IF;
    ELSIF NEW.is_system THEN
      PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser alterada.',
        '{"operation": "update"}'::jsonb);
    END IF;
    RETURN NEW;
  END IF;

  -- DELETE
  IF OLD.is_system THEN
    PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser excluída.',
      '{"operation": "delete"}'::jsonb);
  END IF;
  IF OLD.is_default THEN
    PERFORM public._del_raise('role_is_default',
      'Esta é a função padrão. Escolha outra função padrão antes de excluí-la.');
  END IF;
  SELECT count(*)::int INTO _count
    FROM public.members m
   WHERE m.role_id = OLD.id AND m.deleted_at IS NULL;
  IF _count > 0 THEN
    PERFORM public._del_raise('role_in_use',
      format('Esta função é usada por %s. Troque a função deles antes de excluí-la.',
             CASE WHEN _count = 1 THEN '1 membro' ELSE _count || ' membros' END),
      jsonb_build_object('count', _count));
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.role_maintenance', true) = 'on' THEN
    RETURN coalesce(NEW, OLD);
  END IF;

  -- RN-17: as linhas da Administrador não mudam (são só documentação).
  IF TG_OP IN ('UPDATE', 'DELETE')
     AND EXISTS (SELECT 1 FROM public.roles r WHERE r.id = OLD.role_id AND r.is_system) THEN
    PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser alterada.',
      '{"operation": "update"}'::jsonb);
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;                                     -- retirar é livre (DA-3)
  END IF;

  IF EXISTS (SELECT 1 FROM public.roles r WHERE r.id = NEW.role_id AND r.is_system) THEN
    PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser alterada.',
      '{"operation": "update"}'::jsonb);
  END IF;
  -- RN-22: aposentada não entra.
  IF NOT (NEW.permission = ANY (public.active_permissions())) THEN
    PERFORM public._del_raise('permission_retired', 'Esta permissão não existe mais.',
      jsonb_build_object('permissions', jsonb_build_array(NEW.permission)));
  END IF;
  -- DA-3: com usuário logado, só entra uma permissão que ele tem.
  IF auth.uid() IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.permission IS DISTINCT FROM OLD.permission OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND NOT public.viewer_has(NEW.permission) THEN
    PERFORM public._del_raise('permission_not_covered',
      'Você não pode dar a uma função uma permissão que você não tem.',
      jsonb_build_object('permissions', jsonb_build_array(NEW.permission)));
  END IF;
  RETURN NEW;
END;
$$;

-- RN-19: no commit, exatamente uma função padrão. Adiado, para a troca
-- (desmarcar uma e marcar outra) caber numa transação.
CREATE OR REPLACE FUNCTION public.roles_exactly_one_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (SELECT count(*) FROM public.roles r WHERE r.is_default) <> 1 THEN
    PERFORM public._del_raise('role_default_required',
      'Esta é a função padrão. Para trocar, marque outra função como padrão.');
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.protect_roles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.protect_role_permissions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.roles_exactly_one_default() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_member_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_member_visible_after() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_cell_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_cell_report_scope() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_participant_scope() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS aa_protect_roles ON public.roles;
CREATE TRIGGER aa_protect_roles
  BEFORE INSERT OR UPDATE OR DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.protect_roles();

DROP TRIGGER IF EXISTS aa_protect_role_permissions ON public.role_permissions;
CREATE TRIGGER aa_protect_role_permissions
  BEFORE INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION public.protect_role_permissions();

DROP TRIGGER IF EXISTS zz_roles_exactly_one_default ON public.roles;
CREATE CONSTRAINT TRIGGER zz_roles_exactly_one_default
  AFTER INSERT OR UPDATE OF is_default OR DELETE ON public.roles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.roles_exactly_one_default();

-- ===========================================================================
-- 6. RPCs de funções (DT-12)
-- ===========================================================================
-- Cria (_role_id nulo) ou atualiza uma função, gravando só a diferença das
-- permissões. Com _is_default numa função que não era a padrão, a anterior é
-- desmarcada na mesma transação (RN-19). Ordem: permissão → entrada → travas →
-- existência → regras → escrita.
CREATE OR REPLACE FUNCTION public.save_role(
  _role_id uuid,
  _name text,
  _description text,
  _permissions public.permission_action[],
  _is_default boolean,
  _expected_updated_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name_clean text := nullif(btrim(coalesce(_name, '')), '');
  _perms public.permission_action[];
  _retired public.permission_action[];
  _added public.permission_action[];
  _missing public.permission_action[];
  _role public.roles%ROWTYPE;
  _id uuid;
  _constraint text;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  -- Entrada
  IF _name_clean IS NULL THEN
    PERFORM public._del_raise('role_name_required', 'Informe o nome da função.', '{"field": "name"}'::jsonb);
  END IF;
  _perms := ARRAY(SELECT DISTINCT p FROM unnest(coalesce(_permissions, '{}'::public.permission_action[])) AS p
                   WHERE p IS NOT NULL ORDER BY p);
  _retired := ARRAY(SELECT p FROM unnest(_perms) AS p WHERE p <> ALL (public.active_permissions()) ORDER BY p);
  IF cardinality(_retired) > 0 THEN
    PERFORM public._del_raise('permission_retired', 'Esta permissão não existe mais.',
      jsonb_build_object('permissions', to_jsonb(_retired)));
  END IF;

  -- Travas: as trocas da padrão ficam em série.
  PERFORM pg_advisory_xact_lock(hashtextextended('roles', 0));

  IF _role_id IS NOT NULL THEN
    SELECT * INTO _role FROM public.roles r WHERE r.id = _role_id FOR UPDATE;
    IF NOT FOUND THEN
      PERFORM public._del_raise('role_not_found', 'Esta função foi alterada em outra tela.');
    END IF;
    IF _expected_updated_at IS NOT NULL AND _role.updated_at IS DISTINCT FROM _expected_updated_at THEN
      PERFORM public._del_raise('role_changed', 'Esta função foi alterada em outra tela.');
    END IF;
    IF _role.is_system THEN
      IF coalesce(_is_default, false) THEN
        PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser a função padrão.',
          '{"operation": "default"}'::jsonb);
      END IF;
      PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser alterada.',
        '{"operation": "update"}'::jsonb);
    END IF;
    IF _role.is_default AND NOT coalesce(_is_default, false) THEN
      PERFORM public._del_raise('role_default_required',
        'Esta é a função padrão. Para trocar, marque outra função como padrão.');
    END IF;
    _added := ARRAY(
      SELECT p FROM unnest(_perms) AS p
       WHERE NOT EXISTS (SELECT 1 FROM public.role_permissions rp
                          WHERE rp.role_id = _role_id AND rp.permission = p)
       ORDER BY p);
  ELSE
    _added := _perms;
  END IF;

  -- DA-3: só acrescenta o que quem salva tem. Retirar é livre.
  _missing := ARRAY(SELECT p FROM unnest(_added) AS p WHERE NOT public.viewer_has(p) ORDER BY p);
  IF cardinality(_missing) > 0 THEN
    PERFORM public._del_raise('permission_not_covered',
      'Você não pode dar a uma função uma permissão que você não tem.',
      jsonb_build_object('permissions', to_jsonb(_missing)));
  END IF;

  -- Escrita
  BEGIN
    IF _role_id IS NULL THEN
      INSERT INTO public.roles (name, description, is_default)
      VALUES (_name_clean, nullif(btrim(coalesce(_description, '')), ''), false)
      RETURNING id INTO _id;
    ELSE
      _id := _role_id;
      UPDATE public.roles
         SET name = _name_clean,
             description = nullif(btrim(coalesce(_description, '')), '')
       WHERE id = _id
         AND (name IS DISTINCT FROM _name_clean
              OR description IS DISTINCT FROM nullif(btrim(coalesce(_description, '')), ''));
    END IF;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    IF _constraint = 'roles_name_key' THEN
      PERFORM public._del_raise('role_name_taken', 'Já existe uma função com este nome.', '{"field": "name"}'::jsonb);
    END IF;
    RAISE;
  END;

  IF coalesce(_is_default, false) AND NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = _id AND r.is_default) THEN
    UPDATE public.roles SET is_default = false WHERE is_default AND id <> _id;
    UPDATE public.roles SET is_default = true WHERE id = _id;
  END IF;

  DELETE FROM public.role_permissions rp
   WHERE rp.role_id = _id AND rp.permission <> ALL (_perms);
  INSERT INTO public.role_permissions (role_id, permission)
  SELECT _id, p FROM unnest(_perms) AS p
  ON CONFLICT (role_id, permission) DO NOTHING;

  RETURN _id;
END;
$$;

-- Exclui uma função (RN-17, RN-20). As permissões vão em cascata; os membros
-- excluídos que tinham a função ficam sem função (DA-2 do E2.01).
CREATE OR REPLACE FUNCTION public.delete_role(_role_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _role public.roles%ROWTYPE;
  _count int;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _role FROM public.roles r WHERE r.id = _role_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('role_not_found', 'Esta função foi alterada em outra tela.');
  END IF;
  IF _role.is_system THEN
    PERFORM public._del_raise('admin_role_protected', 'A função Administrador não pode ser excluída.',
      '{"operation": "delete"}'::jsonb);
  END IF;
  IF _role.is_default THEN
    PERFORM public._del_raise('role_is_default',
      'Esta é a função padrão. Escolha outra função padrão antes de excluí-la.');
  END IF;
  SELECT count(*)::int INTO _count
    FROM public.members m
   WHERE m.role_id = _role_id AND m.deleted_at IS NULL;
  IF _count > 0 THEN
    PERFORM public._del_raise('role_in_use',
      format('Esta função é usada por %s. Troque a função deles antes de excluí-la.',
             CASE WHEN _count = 1 THEN '1 membro' ELSE _count || ' membros' END),
      jsonb_build_object('count', _count));
  END IF;
  DELETE FROM public.roles WHERE id = _role_id;
END;
$$;

-- Ensaio do cadastro (DT-21): o mesmo INSERT da create-user-admin, com a
-- sessão de quem chama e auth_user_id nulo, dentro de um bloco que termina num
-- erro próprio (SQLSTATE 'MCIDR'). Só esse erro é capturado, e o ensaio inteiro
-- é desfeito (linha, eventos de auditoria e totais). Qualquer outro erro sobe
-- como veio. O zz_enforce_member_visible_after roda no fim do INSERT, antes do
-- erro do ensaio, então a RN-09 (c) também é ensaiada.
-- As colunas com default na tabela recebem o default quando a chave não vem,
-- como no INSERT do PostgREST.
CREATE OR REPLACE FUNCTION public.check_member_insert(_member jsonb)
RETURNS void
LANGUAGE plpgsql
VOLATILE SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _in jsonb := CASE WHEN jsonb_typeof(_member) = 'object' THEN _member ELSE '{}'::jsonb END;
  _r public.members;
BEGIN
  _r := jsonb_populate_record(NULL::public.members, _in);
  BEGIN
    INSERT INTO public.members (
      name, email, cpf, gender, birth_date, mobile_whatsapp, phone, notes,
      instagram, avatar_url, is_pastor, has_leadership, leader_id, spouse_id,
      is_baptized, baptism_date, is_active, street, number, complement,
      neighborhood, city, state, zip_code, role_id
    ) VALUES (
      _r.name, _r.email, _r.cpf, _r.gender, _r.birth_date, _r.mobile_whatsapp, _r.phone, _r.notes,
      _r.instagram, _r.avatar_url,
      CASE WHEN _in ? 'is_pastor' THEN _r.is_pastor ELSE false END,
      CASE WHEN _in ? 'has_leadership' THEN _r.has_leadership ELSE false END,
      _r.leader_id, _r.spouse_id,
      CASE WHEN _in ? 'is_baptized' THEN _r.is_baptized ELSE false END,
      _r.baptism_date,
      CASE WHEN _in ? 'is_active' THEN _r.is_active ELSE true END,
      _r.street, _r.number, _r.complement,
      _r.neighborhood, _r.city, _r.state, _r.zip_code, _r.role_id
    );
    RAISE EXCEPTION USING ERRCODE = 'MCIDR', MESSAGE = 'ensaio do cadastro';
  EXCEPTION WHEN SQLSTATE 'MCIDR' THEN
    RETURN;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.save_role(uuid, text, text, public.permission_action[], boolean, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_role(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.check_member_insert(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION
  public.save_role(uuid, text, text, public.permission_action[], boolean, timestamptz),
  public.delete_role(uuid),
  public.check_member_insert(jsonb)
TO authenticated, service_role;

-- ===========================================================================
-- 7. Ajustes no E2.01
-- ===========================================================================
-- set_cell_report_participants (DT-20, DA-5): retirar participante exige
-- "Editar Relatórios de Células". Sem ela, a RPC recusa antes de qualquer
-- mudança, em vez de terminar pela metade (a política de DELETE filtraria a
-- retirada em silêncio). O resto é o do E2.01.
CREATE OR REPLACE FUNCTION public.set_cell_report_participants(_report_id uuid, _member_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
  _step record;
BEGIN
  _ids := ARRAY(
    SELECT DISTINCT x
      FROM unnest(coalesce(_member_ids, '{}'::uuid[])) AS x
     WHERE x IS NOT NULL
     ORDER BY x
  );
  IF cardinality(_ids) > 1000 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Um relatório pode ter no máximo 1000 participantes.',
      DETAIL  = '{"code": "too_many_participants", "max": 1000}',
      HINT    = 'app_error';
  END IF;
  -- O relatório precisa estar visível para quem chama (RLS), como na edição.
  IF _report_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.cell_reports r WHERE r.id = _report_id) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'Este relatório não existe ou já foi excluído.',
      DETAIL  = '{"code": "not_found_or_deleted", "entity": "cell_report"}',
      HINT    = 'app_error';
  END IF;
  -- DA-5: retirar só com edit_cell_report.
  IF EXISTS (
       SELECT 1 FROM public.cell_report_participants d
        WHERE d.report_id = _report_id
          AND NOT (d.member_id = ANY (_ids)))
     AND NOT public.viewer_has('edit_cell_report'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  FOR _step IN
    SELECT d.member_id, false AS is_insert
      FROM public.cell_report_participants d
     WHERE d.report_id = _report_id
       AND NOT (d.member_id = ANY (_ids))
    UNION ALL
    SELECT x, true
      FROM unnest(_ids) AS x
     WHERE NOT EXISTS (
       SELECT 1 FROM public.cell_report_participants p
        WHERE p.report_id = _report_id AND p.member_id = x
     )
    ORDER BY 1
  LOOP
    IF _step.is_insert THEN
      -- ON CONFLICT sem alvo (ver spec do E2.01, "Participantes do relatório").
      INSERT INTO public.cell_report_participants (report_id, member_id)
      VALUES (_report_id, _step.member_id)
      ON CONFLICT DO NOTHING;
    ELSE
      DELETE FROM public.cell_report_participants p
       WHERE p.report_id = _report_id
         AND p.member_id = _step.member_id;
      -- A linha continua visível e não foi apagada: falta a política de DELETE.
      IF NOT FOUND AND EXISTS (
        SELECT 1 FROM public.cell_report_participants p
         WHERE p.report_id = _report_id AND p.member_id = _step.member_id
      ) THEN
        RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END LOOP;
END;
$$;

-- restore_member (DT-27, DA-7): depois de restaurar, o cadastro precisa
-- continuar visível para quem restaura. Quem não vê a igreja toda não restaura
-- um membro cujo líder foi excluído (ele voltaria sem liderança). É definer,
-- então a regra não vem do trigger. O resto é o do E2.01.
CREATE OR REPLACE FUNCTION public.restore_member(_member_id uuid)
RETURNS TABLE(restored_without_leader boolean, previous_leader_name text, role_reset_to_default boolean, role_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _m public.members%ROWTYPE;
  _leader record;
  _new_leader uuid;
  _new_has_leadership boolean;
  _new_role uuid;
  _without_leader boolean := false;
  _previous_leader_name text;
  _role_reset boolean := false;
  _fields text[];
  _constraint text;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _member_id IS NULL THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  SELECT * INTO _m FROM public.members m WHERE m.id = _member_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  IF _m.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.members_view v WHERE v.id = _member_id) THEN
      PERFORM public._del_raise('not_deleted', 'Este cadastro não está excluído.', '{"entity": "member"}'::jsonb);
    END IF;
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members_deleted_view v WHERE v.id = _member_id) THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  -- (b) Quem restaura precisa cobrir a função dele (regra da RN-03). Voltar com
  -- a função padrão (função apagada) é livre, como no cadastro (E1.03).
  IF NOT public.viewer_covers_role(_m.role_id) THEN
    PERFORM public._del_raise('restore_role_above', 'Você não tem permissão para restaurar este membro.');
  END IF;
  -- (e) Outro cadastro não excluído com o mesmo e-mail, celular ou CPF (DA-6:
  -- a mensagem cita o primeiro, na ordem e-mail, celular, CPF). Sem índice
  -- único até o E2.04; o unique_violation daqueles índices é tratado abaixo.
  SELECT array_agg(f.field ORDER BY f.ord)
    INTO _fields
    FROM (
      SELECT 1 AS ord, 'email' AS field
       WHERE public.normalize_email(_m.email) IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.members o
                      WHERE o.id <> _member_id AND o.deleted_at IS NULL
                        AND public.normalize_email(o.email) = public.normalize_email(_m.email))
      UNION ALL
      SELECT 2, 'mobile'
       WHERE public.normalize_digits(_m.mobile_whatsapp) IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.members o
                      WHERE o.id <> _member_id AND o.deleted_at IS NULL
                        AND public.normalize_digits(o.mobile_whatsapp) = public.normalize_digits(_m.mobile_whatsapp))
      UNION ALL
      SELECT 3, 'cpf'
       WHERE public.normalize_digits(_m.cpf) IS NOT NULL
         AND EXISTS (SELECT 1 FROM public.members o
                      WHERE o.id <> _member_id AND o.deleted_at IS NULL
                        AND public.normalize_digits(o.cpf) = public.normalize_digits(_m.cpf))
    ) f;
  IF _fields IS NOT NULL THEN
    PERFORM public._del_raise('restore_value_in_use',
      'Não é possível restaurar: outro cadastro já usa este '
        || CASE _fields[1] WHEN 'email' THEN 'e-mail' WHEN 'mobile' THEN 'celular' ELSE 'CPF' END || '.',
      jsonb_build_object('fields', to_jsonb(_fields)));
  END IF;
  -- (d) Líder guardado: travado com FOR KEY SHARE. Se ele foi excluído, o
  -- cadastro volta sem líder e com "Tem Liderança?" desligado (DA-3).
  _new_leader := _m.leader_id;
  _new_has_leadership := _m.has_leadership;
  IF _m.leader_id IS NOT NULL THEN
    SELECT l.id, l.name, l.deleted_at
      INTO _leader
      FROM public.members l
     WHERE l.id = _m.leader_id
     FOR KEY SHARE;
    IF NOT FOUND OR _leader.deleted_at IS NOT NULL THEN
      _new_leader := NULL;
      _new_has_leadership := false;
      _without_leader := true;
      _previous_leader_name := _leader.name;
    END IF;
  END IF;
  -- (a) Função apagada: quem tem conta e está sem função volta com a padrão (DA-2).
  _new_role := _m.role_id;
  IF _m.role_id IS NULL AND _m.auth_user_id IS NOT NULL THEN
    _new_role := public.default_role_id();
    _role_reset := _new_role IS NOT NULL;
  END IF;
  -- leader_id sempre no SET: recalcula o nível (compute_g12_level) e os totais.
  -- O cônjuge não volta (RN-05, RN-16 c): a exclusão já o deixou nulo.
  BEGIN
    UPDATE public.members
       SET deleted_at = NULL,
           deleted_by = NULL,
           leader_id = _new_leader,
           has_leadership = _new_has_leadership,
           role_id = _new_role
     WHERE id = _member_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    _fields := array_remove(ARRAY[
      CASE WHEN _constraint ILIKE '%email%' THEN 'email' END,
      CASE WHEN _constraint ILIKE '%mobile%' THEN 'mobile' END,
      CASE WHEN _constraint ILIKE '%cpf%' THEN 'cpf' END
    ], NULL);
    IF cardinality(_fields) = 0 THEN
      RAISE;
    END IF;
    PERFORM public._del_raise('restore_value_in_use',
      'Não é possível restaurar: outro cadastro já usa este '
        || CASE _fields[1] WHEN 'email' THEN 'e-mail' WHEN 'mobile' THEN 'celular' ELSE 'CPF' END || '.',
      jsonb_build_object('fields', to_jsonb(_fields)));
  END;
  -- DA-7 (RN-09 c, RN-10): o restaurado precisa continuar visível. Na prática,
  -- só falha para quem não vê a igreja toda quando o líder foi excluído.
  IF NOT public.viewer_sees_member(_member_id) THEN
    PERFORM public._del_raise('pastor_or_no_leadership_requires_church',
      'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.',
      '{"field": "leader_id"}'::jsonb);
  END IF;
  -- (f) A conta volta a funcionar, com a mesma senha.
  IF _m.auth_user_id IS NOT NULL THEN
    PERFORM public._del_resume_access(_member_id);
  END IF;
  restored_without_leader := _without_leader;
  previous_leader_name := _previous_leader_name;
  role_reset_to_default := _role_reset;
  role_name := (SELECT r.name FROM public.roles r WHERE r.id = _new_role);
  RETURN NEXT;
END;
$$;

-- ===========================================================================
-- 8. RN-23: user_has_permission só para a service role
-- ===========================================================================
-- Nenhuma política, view nem função INVOKER a chama mais (viewer_has, que é
-- definer, é a porta). A change-member-password a chama com a service role até
-- o E2.03.
REVOKE EXECUTE ON FUNCTION public.user_has_permission(uuid, public.permission_action) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, public.permission_action) TO service_role;
