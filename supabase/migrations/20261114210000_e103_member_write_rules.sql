-- E1.03 — Regras de escrita em `members` impostas no banco (AUT-05 e AUT-07).
-- Ver docs/migracao.md (passo E1.03) no repositório apps-mci.
--
-- Antes, as políticas de RLS só diziam QUEM pode inserir/alterar uma linha, não
-- QUAIS colunas. Pela API, quem tinha `edit_own_data` alterava o próprio perfil
-- (role_id) e o próprio líder, e quem tinha `create_member` conseguia criar uma
-- segunda linha com o próprio auth_user_id e o perfil Administrador.
--
-- Regras (só para chamadas da API em nome de um usuário, papel `authenticated`;
-- triggers internos, funções SECURITY DEFINER e a service role não são afetados):
--   1. Uma conta de acesso fica ligada a, no máximo, um membro.
--   2. auth_user_id não pode ser alterado, nem apontar para quem está cadastrando.
--   3. Colunas calculadas pelo servidor ignoram o valor enviado pelo cliente.
--   4. Ninguém altera a própria função. Para alterar a de outra pessoa, é preciso
--      assign_role ou manage_roles, e tanto a função atual quanto a nova não podem
--      ter permissões que quem altera não tem. No cadastro, a função padrão é livre.
--   5. Editando o próprio cadastro sem edit_member, só os dados pessoais mudam
--      (não: líder, liderança, cônjuge, pastor, batismo, situação).

-- 1. Uma conta de acesso por membro
CREATE UNIQUE INDEX IF NOT EXISTS members_auth_user_id_key
  ON public.members (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

-- 4. Quem pode atribuir (ou tirar) uma função
CREATE OR REPLACE FUNCTION public.can_assign_role(_role_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
      public.user_has_permission(auth.uid(), 'assign_role'::permission_action)
      OR public.user_has_permission(auth.uid(), 'manage_roles'::permission_action)
    )
    AND NOT EXISTS (
      SELECT rp.permission FROM public.role_permissions rp WHERE rp.role_id = _role_id
      EXCEPT
      SELECT own.permission
        FROM public.role_permissions own
        JOIN public.members m ON m.role_id = own.role_id
       WHERE m.auth_user_id = auth.uid()
    )
$$;

REVOKE ALL ON FUNCTION public.can_assign_role(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_assign_role(uuid) TO authenticated;

-- SECURITY INVOKER de propósito: current_user diferencia a chamada direta da API
-- (`authenticated`) das atualizações feitas por triggers e funções internas.
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
  IF current_user <> 'authenticated' THEN
    RETURN NEW;
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

  -- 4. Função (perfil)
  IF TG_OP = 'UPDATE' AND NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    IF OLD.auth_user_id = _uid THEN
      RAISE EXCEPTION 'Ninguém pode alterar a própria função.' USING ERRCODE = '42501';
    END IF;
    IF NOT public.can_assign_role(OLD.role_id) OR NOT public.can_assign_role(NEW.role_id) THEN
      RAISE EXCEPTION 'Você não tem permissão para alterar a função deste membro.' USING ERRCODE = '42501';
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.role_id IS NOT NULL THEN
    SELECT id INTO _default_role FROM public.roles WHERE is_default LIMIT 1;
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

  RETURN NEW;
END;
$$;

-- Os triggers BEFORE disparam em ordem alfabética. O prefixo "aa_" faz este rodar
-- antes de compute_member_g12_level, que então recalcula o g12_level quando o
-- líder muda.
DROP TRIGGER IF EXISTS aa_enforce_member_write_rules ON public.members;
CREATE TRIGGER aa_enforce_member_write_rules
BEFORE INSERT OR UPDATE ON public.members
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_write_rules();
