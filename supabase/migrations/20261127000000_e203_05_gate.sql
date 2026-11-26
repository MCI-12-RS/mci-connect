-- E2.03 (PR 4, migration 5 de 5) — O portão, a Líder com a redefinição e a
-- marca na publicação. Ver docs/specs/e2-03-senha.md no repositório apps-mci
-- ("O portão", "Marca na publicação", "Implantação", "Riscos"; RN-01, RN-08 c,
-- RN-09, RN-16; DT-04, DT-13; DA-9).
--
-- Só pode ir ao ar depois do front que leva à troca obrigatória (PRs 2 e 3
-- promovidos): sem ele, quem tem a marca fica preso (risco 1).
--
-- Conteúdo:
--   0. Guarda de pré-requisito (migrations 3 e 4 deste passo). Falha cedo.
--   1. private.assert_gate(): o portão num lugar só. Com usuário logado:
--        a) a sessão do token existe em auth.sessions (session_ended, RN-16);
--           token sem session_id: não confere (DA-9);
--        b) a conta não tem a marca (password_change_required, RN-09).
--      Recusa com 42501 + HINT app_error + DETAIL {"code": …} (AQ-3).
--      Sem usuário (service role, migrations, cron): passa.
--   2. O portão ligado nas três portas (DT-04), com os corpos finais do E2.02
--      e do E2.01, só com a chamada a mais no começo:
--        viewer_member_id(), viewer_has(permission_action), default_role_id().
--      Viram plpgsql para o portão rodar sempre antes da leitura (num SQL, a
--      ordem das condições do WHERE é do planejador).
--   3. A Líder com change_member_password (RN-01), e o updated_at dela muda
--      para a tela de Funções aberta não gravar por cima (role_changed).
--   4. Marca na publicação (RN-08 c, DT-13), pela interna
--      private.mark_initial_passwords(): toda conta do cofre cuja senha é
--      123456 (inclusive as suspensas, que já estão no cofre) recebe a marca
--      initial, sem validade. Cada marca nova gera "Troca de senha exigida",
--      motivo initial_password, sem autor, com o cadastro em entity_id e
--      entity_label. O registro vai junto com a marca (sem engolir erro): se
--      falhar, a migration volta inteira. Rodar de novo não marca nem registra
--      de novo (set_must_change devolve false para quem já tem a marca).
--   5. DROP de public.is_admin(uuid), se nenhuma função, política ou view a
--      usar (risco 12 do E2.02).
--   6. members_view.password_reset_status com as funções cobertas num
--      InitPlan, e não mais viewer_covers_role por linha (risco 3: com a Líder
--      redefinindo, a página da lista de Membros calculava a coluna para todo
--      o escopo). No fim do arquivo: a trava da view dura o mínimo.
--
-- Fora do portão (lista fechada; o pgTAP e203_06_gate confere o catálogo):
--   my_password_status() (só a sessão), log_auth_event('logout') e as
--   utilitárias sem dado de ninguém (sp_today, sp_now, week_start,
--   weekday_index, normalize_*, search_normalize, is_valid_*, mobile_match_key,
--   is_placeholder_email, placeholder_email_domain(s), member_has_login_identifier,
--   birth_date_problem, active_permissions).
--
-- Custo (risco 3): duas buscas por chave primária (auth.sessions e o cofre)
-- por chamada das portas. Nas views e políticas, as chamadas são InitPlan.
--
-- Rollback (risco 1): uma migration nova que recria as três portas com os
-- corpos de antes (SQL, sem a chamada a private.assert_gate). A marca pode
-- ficar: sem o portão, a tela continua levando à troca. O SQL está na
-- descrição do PR.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisito
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('private.assert_session_alive()') IS NULL
     OR to_regprocedure('private.assert_no_password_mark()') IS NULL
     OR to_regprocedure('private.set_must_change(uuid,text,timestamptz)') IS NULL
     OR to_regclass('private.account_passwords') IS NULL
     OR to_regprocedure('public.reset_member_password(uuid)') IS NULL
     OR to_regprocedure('public.my_password_status()') IS NULL THEN
    RAISE EXCEPTION 'E2.03 migration 5: faltam as migrations 3 e 4 deste passo (cofre e RPCs).';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. O portão num lugar só
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.assert_gate()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  PERFORM private.assert_session_alive();      -- session_ended antes da marca
  PERFORM private.assert_no_password_mark();
END;
$$;

REVOKE ALL ON FUNCTION private.assert_gate() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. As três portas (DT-04)
-- ---------------------------------------------------------------------------
-- Corpo do E2.01 (20261123233300_e201_03_read): sem cadastro não excluído,
-- sem escopo (DEL-06).
CREATE OR REPLACE FUNCTION public.viewer_member_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.assert_gate();
  RETURN (SELECT m.id
            FROM public.members m
           WHERE m.auth_user_id = auth.uid()
             AND m.deleted_at IS NULL);
END;
$$;

-- Corpo do E2.02 (atalho da Administrador e aposentadas em user_has_permission).
CREATE OR REPLACE FUNCTION public.viewer_has(_permission public.permission_action)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;
  PERFORM private.assert_gate();
  RETURN public.user_has_permission(auth.uid(), _permission);
END;
$$;

-- Corpo do E2.02 (20261125140100_e202_02_scope).
CREATE OR REPLACE FUNCTION public.default_role_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM private.assert_gate();
  RETURN (SELECT r.id FROM public.roles r WHERE r.is_default LIMIT 1);
END;
$$;

-- Os grants não mudam com CREATE OR REPLACE; reafirmados para um banco que
-- chegue aqui por outro caminho.
REVOKE ALL ON FUNCTION public.viewer_member_id()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.viewer_has(public.permission_action)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.default_role_id()                        FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_member_id()                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.viewer_has(public.permission_action)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.default_role_id()                     TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A Líder redefine (RN-01)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _leader uuid;
BEGIN
  SELECT r.id INTO _leader FROM public.roles r WHERE r.name = 'Líder' AND NOT r.is_system;
  IF _leader IS NULL THEN
    RAISE NOTICE 'E2.03 migration 5: a função "Líder" não existe; a permissão não foi acrescentada.';
    RETURN;
  END IF;

  INSERT INTO public.role_permissions (role_id, permission)
  VALUES (_leader, 'change_member_password'::public.permission_action)
  ON CONFLICT (role_id, permission) DO NOTHING;

  IF FOUND THEN
    UPDATE public.roles SET updated_at = now() WHERE id = _leader;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Marca na publicação (RN-08 c, DT-13)
-- ---------------------------------------------------------------------------
-- private.mark_initial_passwords(): um bcrypt por conta do cofre (custo 10).
-- O literal é a senha inicial pública da D11; nada fica guardado em claro. Em
-- ordem de conta (a trava da linha do cofre vem de set_must_change, nível 4 da
-- ordem global). Devolve quantas marcas novas pôs. Interna: só o dono executa
-- (a migration e o pgTAP).
CREATE OR REPLACE FUNCTION private.mark_initial_passwords()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  _acc record;
  _member record;
  _marked integer := 0;
BEGIN
  FOR _acc IN
    SELECT p.auth_user_id
      FROM private.account_passwords p
     WHERE p.password_hash LIKE '$2%'
       AND NOT p.must_change
       AND extensions.crypt('123456', p.password_hash) = p.password_hash
     ORDER BY p.auth_user_id
  LOOP
    IF private.set_must_change(_acc.auth_user_id, 'initial', NULL) THEN
      _marked := _marked + 1;
      _member := NULL;
      SELECT m.id, m.name INTO _member
        FROM public.members m
       WHERE m.auth_user_id = _acc.auth_user_id
       ORDER BY m.deleted_at NULLS FIRST
       LIMIT 1;

      -- O registro vai junto com a marca (sem engolir erro).
      PERFORM public._log_event(
        _action         => 'password_change_required'::public.event_action,
        _entity         => 'auth'::public.event_entity,
        _entity_id      => _member.id,
        _entity_label   => _member.name,
        _description    => 'Troca de senha exigida',
        _changed_fields => NULL,
        _metadata       => jsonb_build_object('reason', 'initial_password'),
        _success        => true,
        _error_reason   => NULL,
        _actor_user_id  => NULL
      );
    END IF;
  END LOOP;
  RETURN _marked;
END;
$$;

REVOKE ALL ON FUNCTION private.mark_initial_passwords() FROM PUBLIC, anon, authenticated, service_role;

DO $$
BEGIN
  RAISE NOTICE 'E2.03 migration 5: % conta(s) com a senha inicial receberam a marca.', private.mark_initial_passwords();
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. is_admin sai, se nada a usa (risco 12 do E2.02)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.is_admin(uuid)') IS NULL THEN
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid <> 'public.is_admin(uuid)'::regprocedure
                AND p.prosrc ~ '\mis_admin\M')
     OR EXISTS (SELECT 1 FROM pg_policies
                 WHERE coalesce(qual, '') ~ '\mis_admin\M' OR coalesce(with_check, '') ~ '\mis_admin\M')
     OR EXISTS (SELECT 1 FROM pg_views WHERE definition ~ '\mis_admin\M') THEN
    RAISE NOTICE 'E2.03 migration 5: public.is_admin(uuid) ainda é usada; fica.';
    RETURN;
  END IF;
  DROP FUNCTION public.is_admin(uuid);
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. members_view.password_reset_status sem custo por linha (risco 3)
-- ---------------------------------------------------------------------------
-- Por último: o CREATE OR REPLACE VIEW pega a trava exclusiva da view até o
-- commit, e aqui ela fica pelo menor tempo (depois do bcrypt da seção 4).
-- Com a Líder redefinindo (seção 3), a lista de Membros de toda Líder passa a
-- calcular a coluna. Na migration 4 ela chamava viewer_covers_role(m.role_id)
-- por linha, e a view (security_barrier) projeta a coluna para todo o escopo
-- antes de ordenar a página: 20 mil membros levavam cerca de 12 s. Agora as
-- funções cobertas saem de um InitPlan (uma vez por consulta). O resto da view
-- é o da migration 4 (20261126100300_e203_04_rpcs), igual e na mesma ordem;
-- o WHERE (espelho da "Members view policy") não muda.
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
  hr.g12_level,
  coalesce(hr.total_disciples, 0) AS total_disciples,
  coalesce(hr.total_cells, 0) AS total_cells,
  coalesce(hr.male_cells, 0) AS male_cells,
  coalesce(hr.female_cells, 0) AS female_cells,
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
  sp.name AS spouse_name,
  -- E2.06, no fim (AQ-1, RN-10): o G12 da pessoa, como nome de referência.
  hr.g12_id,
  g12.name AS g12_name,
  -- E2.03 (AQ-2): a recusa previsível da redefinição, na ordem da RN-02.
  CASE WHEN NOT (SELECT public.viewer_has('change_member_password'::public.permission_action)) THEN NULL
       WHEN m.id = (SELECT public.viewer_member_id())                                       THEN 'self'
       -- PR 4 (risco 3): as funções cobertas são calculadas uma vez por consulta (InitPlan), e não
       -- uma vez por linha. A view é security_barrier: a coluna é projetada para toda linha do
       -- escopo antes da ordenação da página. Sem função (NULL), coberta, como viewer_covers_role(NULL).
       WHEN NOT (   m.role_id IS NULL
                 OR m.role_id = ANY (ARRAY(SELECT r.id FROM public.roles r
                                            WHERE public.viewer_covers_role(r.id))))     THEN 'role_not_covered'
       WHEN m.auth_user_id IS NULL                                                           THEN 'no_account'
       ELSE 'allowed'
  END AS password_reset_status
FROM public.members m
LEFT JOIN public.members l ON l.id = m.leader_id
LEFT JOIN public.members sp ON sp.id = m.spouse_id
LEFT JOIN private.member_hierarchy hr ON hr.member_id = m.id
LEFT JOIN public.members g12 ON g12.id = hr.g12_id
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
