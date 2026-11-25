-- E2.02 (PR 1, migration 1) — Dados das funções e "Tem Liderança?".
-- Ver docs/specs/e2-02-perfis-escopo.md no repositório apps-mci ("Dados
-- (migration 1)", RN-16, RN-17, RN-19, RN-22, DA-11, DT-09, DT-10, DT-22).
--
-- 1. Administrador: a única função is_system. Sem nenhuma, cria
--    "Administrador". Com mais de uma, falha com a lista, sem mudar nada (o
--    índice único roles_single_system_idx da migration 2 depende disso).
--    Recebe a descrição nova e uma linha por permissão ativa, só como
--    documentação: o que vale é o atalho is_system de user_has_permission
--    (migration 2, DT-09).
-- 2. Líder e Membro, por nome (roles_name_key): criadas se faltarem, com a
--    descrição e exatamente as permissões da tabela "Funções semeadas".
-- 3. Membro passa a ser a padrão (a anterior é desmarcada antes, por causa do
--    índice idx_roles_single_default).
-- 4. Permissões aposentadas (RN-22) nas demais funções: view_members vira
--    view_all_church e view_own_ministry_dashboard vira view_dashboard. Nenhuma
--    linha aposentada sobra em role_permissions.
-- 5. has_leadership ligado em todo cadastro com líder (DA-11), inclusive os
--    excluídos, para a restauração voltar coerente.
--
-- Tudo num bloco só: uma falha não deixa nada pela metade.
--
-- Pode rodar de novo sem erro e sem mudar nada. Na segunda vez, os triggers de
-- roles e role_permissions da migration 4 já existem: o bloco liga
-- app.role_maintenance (a exceção prevista para migrations de manutenção) e o
-- desliga no fim. A troca da padrão termina com exatamente uma padrão, então o
-- constraint trigger adiado zz_roles_exactly_one_default passa no commit.

DO $$
DECLARE
  _systems text[];
  _admin uuid;
  _leader uuid;
  _member uuid;
  _retired constant public.permission_action[] :=
    ARRAY['view_members', 'view_own_ministry_dashboard']::public.permission_action[];
  _active public.permission_action[];
  _leader_perms constant public.permission_action[] := ARRAY[
    'view_dashboard', 'view_own_ministry', 'edit_own_data',
    'create_member', 'edit_member', 'delete_member',
    'create_cell', 'edit_cell', 'delete_cell',
    'submit_own_cell_report', 'edit_cell_report', 'delete_cell_report'
  ]::public.permission_action[];
  _member_perms constant public.permission_action[] := ARRAY[
    'view_dashboard', 'view_own_ministry', 'edit_own_data', 'submit_own_cell_report'
  ]::public.permission_action[];
BEGIN
  -- 0. Pré-condições, antes de qualquer escrita.
  SELECT array_agg(r.name ORDER BY r.name) INTO _systems FROM public.roles r WHERE r.is_system;
  IF coalesce(cardinality(_systems), 0) > 1 THEN
    RAISE EXCEPTION 'E2.02: existe mais de uma função de sistema (%). Deixe só uma antes de aplicar esta migration.',
      array_to_string(_systems, ', ');
  END IF;
  IF coalesce(cardinality(_systems), 0) = 0
     AND EXISTS (SELECT 1 FROM public.roles r WHERE r.name = 'Administrador') THEN
    RAISE EXCEPTION 'E2.02: não há função de sistema, e já existe uma função comum chamada "Administrador". Resolva antes de aplicar esta migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.roles r WHERE r.is_system AND r.name IN ('Líder', 'Membro')) THEN
    RAISE EXCEPTION 'E2.02: a função de sistema se chama "Líder" ou "Membro". Resolva antes de aplicar esta migration.';
  END IF;

  PERFORM set_config('app.role_maintenance', 'on', true);

  _active := ARRAY(
    SELECT p FROM unnest(enum_range(NULL::public.permission_action)) AS p
     WHERE p <> ALL (_retired)
     ORDER BY p
  );

  -- 1. Administrador
  SELECT r.id INTO _admin FROM public.roles r WHERE r.is_system;
  IF _admin IS NULL THEN
    INSERT INTO public.roles (name, description, is_system, is_default)
    VALUES ('Administrador', 'Acesso total ao sistema, em toda a igreja.', true, false)
    RETURNING id INTO _admin;
  END IF;

  -- 2. Líder e Membro
  INSERT INTO public.roles (name, description, is_system, is_default)
  VALUES ('Líder', 'Vê e gerencia membros, células e relatórios do seu ministério.', false, false),
         ('Membro', 'Vê o seu ministério, edita os próprios dados e envia o relatório das suas células.', false, false)
  ON CONFLICT (name) DO NOTHING;
  SELECT r.id INTO _leader FROM public.roles r WHERE r.name = 'Líder';
  SELECT r.id INTO _member FROM public.roles r WHERE r.name = 'Membro';

  -- 3. Membro como padrão (antes de mexer na Administrador, que pode ser a padrão hoje).
  UPDATE public.roles SET is_default = false WHERE is_default AND id <> _member;
  UPDATE public.roles SET is_default = true WHERE id = _member AND NOT is_default;

  UPDATE public.roles
     SET description = 'Acesso total ao sistema, em toda a igreja.'
   WHERE id = _admin
     AND description IS DISTINCT FROM 'Acesso total ao sistema, em toda a igreja.';
  UPDATE public.roles
     SET description = 'Vê e gerencia membros, células e relatórios do seu ministério.'
   WHERE id = _leader
     AND description IS DISTINCT FROM 'Vê e gerencia membros, células e relatórios do seu ministério.';
  UPDATE public.roles
     SET description = 'Vê o seu ministério, edita os próprios dados e envia o relatório das suas células.'
   WHERE id = _member
     AND description IS DISTINCT FROM 'Vê o seu ministério, edita os próprios dados e envia o relatório das suas células.';

  -- Permissões da Administrador (documentação), da Líder e da Membro: exatamente as da tabela.
  INSERT INTO public.role_permissions (role_id, permission)
  SELECT _admin, p FROM unnest(_active) AS p
  ON CONFLICT (role_id, permission) DO NOTHING;
  DELETE FROM public.role_permissions rp
   WHERE rp.role_id = _admin AND rp.permission <> ALL (_active);

  INSERT INTO public.role_permissions (role_id, permission)
  SELECT _leader, p FROM unnest(_leader_perms) AS p
  ON CONFLICT (role_id, permission) DO NOTHING;
  DELETE FROM public.role_permissions rp
   WHERE rp.role_id = _leader AND rp.permission <> ALL (_leader_perms);

  INSERT INTO public.role_permissions (role_id, permission)
  SELECT _member, p FROM unnest(_member_perms) AS p
  ON CONFLICT (role_id, permission) DO NOTHING;
  DELETE FROM public.role_permissions rp
   WHERE rp.role_id = _member AND rp.permission <> ALL (_member_perms);

  -- 4. Aposentadas nas demais funções: a substituta entra, a antiga sai.
  INSERT INTO public.role_permissions (role_id, permission)
  SELECT DISTINCT rp.role_id,
         CASE rp.permission
           WHEN 'view_members' THEN 'view_all_church'::public.permission_action
           ELSE 'view_dashboard'::public.permission_action
         END
    FROM public.role_permissions rp
   WHERE rp.permission = ANY (_retired)
     AND rp.role_id NOT IN (_admin, _leader, _member)
  ON CONFLICT (role_id, permission) DO NOTHING;
  DELETE FROM public.role_permissions rp WHERE rp.permission = ANY (_retired);

  PERFORM set_config('app.role_maintenance', 'off', true);

  -- 5. DA-11: com líder, "Tem Liderança?" ligado.
  UPDATE public.members
     SET has_leadership = true
   WHERE leader_id IS NOT NULL
     AND NOT has_leadership;
END
$$;
