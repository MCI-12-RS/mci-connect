-- E2.06 (PR 1, migration 3) — As colunas calculadas saem de members.
-- Ver docs/specs/e2-06-hierarquia-totais.md no repositório apps-mci
-- ("Colunas antigas e a RN-12 (migration 3)", "Contratos"; RN-12; DA-1;
-- DT-01, DT-10; risco 4).
--
-- 1. Pré-condição: nenhum corpo de função em public ou private cita as
--    colunas calculadas fora da lista conhecida (as que leem a tabela nova ou
--    a view, e as três que esta migration reescreve ou remove). Falha cedo,
--    sem mudar nada, com os nomes das funções.
-- 2. enforce_member_write_rules: a regra 3 fica só com a data de criação. O
--    resto do corpo é o do E2.02 (migration 4), sem mudança.
-- 3. Saem os triggers compute_member_g12_level, trg_refresh_stats_members e
--    trg_refresh_stats_cells, e as funções compute_g12_level e
--    refresh_member_stats_v2.
-- 4. Saem de members as cinco colunas calculadas (o GRANT por coluna do E1.08
--    sai junto). O DROP COLUMN falha sozinho se uma view depender delas.
-- 5. Pós-condição: a mesma busca da pré-condição, agora sem exceções além da
--    lista conhecida.
--
-- RN-12 pela API (DA-1): a tabela nova não é exposta, e um PATCH com essas
-- chaves em members é recusado como coluna inexistente.
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE, DROP ... IF EXISTS.

DO $$
BEGIN
  IF to_regclass('private.member_hierarchy') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass
                     AND t.tgname = 'trg_member_hierarchy')
     OR NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.cells'::regclass
                     AND t.tgname = 'trg_cell_hierarchy')
     OR pg_get_viewdef('public.members_view'::regclass) !~ 'member_hierarchy'
     OR pg_get_viewdef('public.cells_view'::regclass) !~ 'member_hierarchy' THEN
    RAISE EXCEPTION 'E2.06 (migration 3) depende das migrations 1 e 2 do E2.06.';
  END IF;
END $$;

-- ===========================================================================
-- 1. Pré-condição (risco 4)
-- ===========================================================================
DO $$
DECLARE
  _names text[];
BEGIN
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY 1) INTO _names
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private')
     AND p.prosrc ~ '\m(g12_level|total_disciples|total_cells|male_cells|female_cells)\M'
     AND NOT (p.proname ~ '^(_hierarchy_|hierarchy_|member_hierarchy_)'
              OR p.proname IN ('rebuild_member_hierarchy', 'ministry_tree_nodes', 'dashboard_g12_ranking',
                               -- reescrita ou removidas abaixo
                               'enforce_member_write_rules', 'compute_g12_level', 'refresh_member_stats_v2'));
  IF _names IS NOT NULL THEN
    RAISE EXCEPTION 'E2.06: funções que ainda citam as colunas calculadas de members: %', _names;
  END IF;
END $$;

-- ===========================================================================
-- 2. enforce_member_write_rules sem as colunas calculadas (DT-10)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.enforce_member_write_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

  -- 3. Data de criação. Os campos calculados (nível, cadeia, G12 e totais)
  --    ficam em private.member_hierarchy, fora da API (E2.06, RN-12).
  IF TG_OP = 'UPDATE' THEN
    NEW.created_at := OLD.created_at;
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
  --    enviado é ignorado sem erro.
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
$function$;

-- ===========================================================================
-- 3. Triggers e funções antigos
-- ===========================================================================
DROP TRIGGER IF EXISTS compute_member_g12_level ON public.members;
DROP TRIGGER IF EXISTS trg_refresh_stats_members ON public.members;
DROP TRIGGER IF EXISTS trg_refresh_stats_cells ON public.cells;
DROP FUNCTION IF EXISTS public.compute_g12_level();
DROP FUNCTION IF EXISTS public.refresh_member_stats_v2();

-- ===========================================================================
-- 4. Colunas calculadas de members (RN-12, DT-01)
-- ===========================================================================
ALTER TABLE public.members
  DROP COLUMN IF EXISTS g12_level,
  DROP COLUMN IF EXISTS total_disciples,
  DROP COLUMN IF EXISTS total_cells,
  DROP COLUMN IF EXISTS male_cells,
  DROP COLUMN IF EXISTS female_cells;

-- ===========================================================================
-- 5. Pós-condição
-- ===========================================================================
DO $$
DECLARE
  _names text[];
BEGIN
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY 1) INTO _names
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private')
     AND p.prosrc ~ '\m(g12_level|total_disciples|total_cells|male_cells|female_cells)\M'
     AND NOT (p.proname ~ '^(_hierarchy_|hierarchy_|member_hierarchy_)'
              OR p.proname IN ('rebuild_member_hierarchy', 'ministry_tree_nodes', 'dashboard_g12_ranking'));
  IF _names IS NOT NULL THEN
    RAISE EXCEPTION 'E2.06: funções que ainda citam as colunas calculadas de members: %', _names;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.members'::regclass AND NOT attisdropped
                AND attname IN ('g12_level', 'total_disciples', 'total_cells', 'male_cells', 'female_cells')) THEN
    RAISE EXCEPTION 'E2.06: colunas calculadas ainda em members.';
  END IF;
END $$;
