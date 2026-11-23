-- E2.01 (PR 1, migration 4 de 4) — Exclusão lógica: escrita.
-- Ver docs/specs/e2-01-exclusao-logica.md no repositório apps-mci ("Escrita",
-- "Acesso do membro excluído", "Formato dos erros", "Bloqueios e
-- concorrência", "Auditoria", DT-08 a DT-28).
--
-- 1. Funções internas _del_* (sem EXECUTE para a API): erro estruturado,
--    travas, bloqueios da exclusão de membro, suspensão e retomada do acesso.
-- 2. Triggers BEFORE, última barreira das RN-06, RN-11, RN-13 e RN-18. Valem
--    para qualquer papel, inclusive a service role (DT-27); só a carga com
--    session_replication_role = replica passa por fora.
-- 3. Semana única do relatório ignorando excluídos, com trava consultiva.
-- 4. Totais (RN-10) sem excluídos, também em UPDATE OF deleted_at.
-- 5. Auditoria da exclusão, da restauração e do cônjuge desfeito, sem engolir
--    erro (RN-19, RN-20).
-- 6. RPCs: check_member_deletion, delete_member, restore_member, delete_cell,
--    restore_cell, delete_cell_report, restore_cell_report,
--    set_cell_report_participants e find_deleted_member_matches.
--
-- Erros (AQ-2, DT-10):
--   - falta de permissão: 42501, "Você não tem permissão para esta ação.";
--   - regra: 22023, HINT 'app_error', MESSAGE com o texto pronto para a tela e
--     DETAIL com um JSON { "code": ..., ... }.
--
-- ORDEM GLOBAL DAS TRAVAS (DT-09), igual em todas as RPCs e triggers deste
-- passo. Nenhuma operação pega uma trava de um nível acima depois de uma de
-- nível abaixo:
--   1. relatório (cell_reports);
--   2. célula (cells);
--   3. membros: o alvo, o cônjuge e quem exclui, em ordem de id
--      (_del_lock_members); nos triggers, as pessoas escolhidas, em ordem de id;
--   4. trava consultiva (célula, semana) (_del_lock_cell_week);
--   5. linhas atualizadas pelos triggers: ancestrais (totais), auth.users e
--      sessões, suspensão e eventos.
-- As RPCs de exclusão usam FOR UPDATE; os triggers usam FOR KEY SHARE na linha
-- referenciada. Os dois conflitam: "escolher" e "excluir" a mesma pessoa ou
-- célula nunca passam juntos (RN-20, DT-08). Em READ COMMITTED, cada comando
-- PL/pgSQL tira um snapshot novo, então as checagens feitas depois da trava
-- enxergam o que a outra transação acabou de gravar. Os índices únicos ficam
-- como última garantia.
--
-- Pode rodar de novo sem erro: só CREATE OR REPLACE, DROP TRIGGER IF EXISTS
-- antes de cada CREATE TRIGGER, e grants.

-- ===========================================================================
-- 1. Funções internas
-- ===========================================================================

-- Erro estruturado de regra (DT-10). O "code" sempre vence um "code" do detalhe.
CREATE OR REPLACE FUNCTION public._del_raise(_code text, _message text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '22023',
    MESSAGE = _message,
    DETAIL  = (coalesce(_detail, '{}'::jsonb) || jsonb_build_object('code', _code))::text,
    HINT    = 'app_error';
END;
$$;

-- Trava com FOR UPDATE, em ordem de id, o alvo, o cônjuge atual dele e quem
-- exclui (DT-09, DT-21). Relê o cônjuge depois da trava e repete se ele mudou
-- na espera (no máximo 5 vezes; depois disso, o UPDATE do cônjuge pelo trigger
-- de cônjuge trava a linha de qualquer forma).
CREATE OR REPLACE FUNCTION public._del_lock_members(_target uuid, _actor uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _spouse uuid;
  _locked_spouse uuid;
  _id uuid;
  _attempt int := 0;
BEGIN
  LOOP
    _attempt := _attempt + 1;
    SELECT m.spouse_id INTO _spouse FROM public.members m WHERE m.id = _target;

    FOR _id IN
      SELECT DISTINCT x
        FROM unnest(ARRAY[_target, _spouse, _actor]) AS x
       WHERE x IS NOT NULL
       ORDER BY x
    LOOP
      PERFORM 1 FROM public.members m WHERE m.id = _id FOR UPDATE;
    END LOOP;

    SELECT m.spouse_id INTO _locked_spouse FROM public.members m WHERE m.id = _target;
    EXIT WHEN _locked_spouse IS NOT DISTINCT FROM _spouse OR _attempt >= 5;
  END LOOP;
END;
$$;

-- O que impede a exclusão de um membro (RN-02 a RN-04; DT-11). NULL se a
-- exclusão pode seguir. Senão, o objeto da recusa, na ordem:
--   not_found_or_deleted (inexistente, excluído ou fora da members_view: DA-10)
--   → self_delete → role_above (viewer_covers_role, DT-12) → member_has_links.
-- A mesma função alimenta a pré-checagem (check_member_deletion) e a exclusão
-- (delete_member), então a tela e o servidor nunca discordam (UXD-2).
CREATE OR REPLACE FUNCTION public._del_member_blockers(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _m record;
  _disciples_total int;
  _disciples jsonb;
  _cells_total int;
  _cells jsonb;
  _parts text[] := ARRAY[]::text[];
BEGIN
  SELECT m.id, m.name, m.role_id, m.deleted_at
    INTO _m
    FROM public.members m
   WHERE m.id = _member_id;

  IF NOT FOUND
     OR _m.deleted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.members_view v WHERE v.id = _member_id) THEN
    RETURN jsonb_build_object(
      'code', 'not_found_or_deleted',
      'message', 'Este cadastro não existe ou já foi excluído.',
      'entity', 'member');
  END IF;

  IF _member_id = public.viewer_member_id() THEN
    RETURN jsonb_build_object(
      'code', 'self_delete',
      'message', 'Você não pode excluir o seu próprio cadastro.');
  END IF;

  IF NOT public.viewer_covers_role(_m.role_id) THEN
    RETURN jsonb_build_object(
      'code', 'role_above',
      'message', 'Você não tem permissão para excluir este membro.');
  END IF;

  -- (a) Discípulos não excluídos, ativos ou inativos (P-DEL-01).
  SELECT count(*)::int
    INTO _disciples_total
    FROM public.members d
   WHERE d.leader_id = _member_id
     AND d.deleted_at IS NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'is_active', x.is_active)
                            ORDER BY x.name, x.id), '[]'::jsonb)
    INTO _disciples
    FROM (
      SELECT d.id, d.name, d.is_active
        FROM public.members d
       WHERE d.leader_id = _member_id
         AND d.deleted_at IS NULL
       ORDER BY d.name, d.id
       LIMIT 5
    ) x;

  -- (b) Células não excluídas, ativas ou inativas, em que ele é líder, timóteo
  --     ou anfitrião. A célula é identificada pelo líder, pelo dia e pelo horário.
  SELECT count(*)::int
    INTO _cells_total
    FROM public.cells c
   WHERE c.deleted_at IS NULL
     AND (c.leader_id = _member_id OR c.timothy_id = _member_id OR c.host_id = _member_id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
                              'id', x.id,
                              'roles', to_jsonb(x.roles),
                              'leader_name', x.leader_name,
                              'meeting_day', x.meeting_day,
                              'meeting_time', x.meeting_time,
                              'is_active', x.is_active)
                            ORDER BY x.leader_name, x.weekday, x.meeting_time, x.id), '[]'::jsonb)
    INTO _cells
    FROM (
      SELECT c.id,
             array_remove(ARRAY[
               CASE WHEN c.leader_id  = _member_id THEN 'leader'  END,
               CASE WHEN c.timothy_id = _member_id THEN 'timothy' END,
               CASE WHEN c.host_id    = _member_id THEN 'host'    END
             ], NULL) AS roles,
             l.name AS leader_name,
             c.meeting_day,
             public.weekday_index(c.meeting_day) AS weekday,
             to_char(c.meeting_time, 'HH24:MI') AS meeting_time,
             c.is_active
        FROM public.cells c
        LEFT JOIN public.members l ON l.id = c.leader_id
       WHERE c.deleted_at IS NULL
         AND (c.leader_id = _member_id OR c.timothy_id = _member_id OR c.host_id = _member_id)
       ORDER BY l.name, public.weekday_index(c.meeting_day), c.meeting_time, c.id
       LIMIT 5
    ) x;

  IF _disciples_total = 0 AND _cells_total = 0 THEN
    RETURN NULL;
  END IF;

  IF _disciples_total > 0 THEN
    _parts := _parts || (_disciples_total || CASE WHEN _disciples_total = 1 THEN ' discípulo' ELSE ' discípulos' END);
  END IF;
  IF _cells_total > 0 THEN
    _parts := _parts || (_cells_total || CASE WHEN _cells_total = 1 THEN ' célula' ELSE ' células' END);
  END IF;

  RETURN jsonb_build_object(
    'code', 'member_has_links',
    'message', 'Não é possível excluir ' || _m.name || '. Antes, reatribua '
               || array_to_string(_parts, ' e ') || '.',
    'member_id', _m.id,
    'member_name', _m.name,
    'disciples_total', _disciples_total,
    'disciples', _disciples,
    'cells_total', _cells_total,
    'cells', _cells);
END;
$$;

-- Suspende a conta de acesso (RN-14, DT-13), na mesma transação da exclusão:
--   - guarda a senha (hash) e o banimento anterior em private.member_access_suspensions;
--   - senha vazia: o login responde "invalid_credentials" antes de olhar o
--     banimento, igual a uma conta inexistente (AQ-10);
--   - banimento: barra a renovação do token, o link mágico e a recuperação;
--   - apaga as sessões (os refresh tokens caem em cascata) e os refresh tokens
--     antigos sem sessão.
-- É o único ponto, junto com _del_resume_access, que escreve no schema auth.
CREATE OR REPLACE FUNCTION public._del_suspend_access(_member_id uuid, _auth_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO private.member_access_suspensions
         (member_id, auth_user_id, encrypted_password, previous_banned_until)
  SELECT _member_id, u.id, u.encrypted_password, u.banned_until
    FROM auth.users u
   WHERE u.id = _auth_user_id
  ON CONFLICT (member_id) DO NOTHING;   -- nunca sobrescreve a senha guardada com ''

  UPDATE auth.users
     SET encrypted_password = '',
         banned_until = now() + interval '100 years',
         updated_at = now()
   WHERE id = _auth_user_id;

  DELETE FROM auth.sessions WHERE user_id = _auth_user_id;
  DELETE FROM auth.refresh_tokens WHERE user_id = _auth_user_id::text;
END;
$$;

-- Devolve a senha e o banimento guardados e apaga a suspensão (RN-16 f). Sem
-- suspensão guardada, só tira o banimento da conta atual do membro.
CREATE OR REPLACE FUNCTION public._del_resume_access(_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s private.member_access_suspensions%ROWTYPE;
BEGIN
  SELECT * INTO _s
    FROM private.member_access_suspensions
   WHERE member_id = _member_id
   FOR UPDATE;

  IF FOUND THEN
    UPDATE auth.users
       SET encrypted_password = _s.encrypted_password,
           banned_until = _s.previous_banned_until,
           updated_at = now()
     WHERE id = _s.auth_user_id;
    DELETE FROM private.member_access_suspensions WHERE member_id = _member_id;
  ELSE
    UPDATE auth.users u
       SET banned_until = NULL,
           updated_at = now()
      FROM public.members m
     WHERE m.id = _member_id
       AND u.id = m.auth_user_id
       AND u.banned_until IS NOT NULL;
  END IF;
END;
$$;

-- Trava consultiva por (célula, semana) (DT-23): o trigger de semana única e a
-- restore_cell_report se enfileiram aqui antes de consultar.
CREATE OR REPLACE FUNCTION public._del_lock_cell_week(_cell_id uuid, _date date)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pg_advisory_xact_lock(
    hashtextextended('cell-week:' || _cell_id::text || ':' || public.week_start(_date)::text, 0))
$$;

REVOKE ALL ON FUNCTION public._del_raise(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._del_lock_members(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._del_member_blockers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._del_suspend_access(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._del_resume_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._del_lock_cell_week(uuid, date) FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 2. Triggers BEFORE (última barreira)
-- ===========================================================================

-- members: nada aponta para um excluído (RN-06) e o e-mail da conta de um
-- excluído não volta num cadastro novo (RN-18). Roda depois de
-- aa_enforce_member_write_rules (ordem alfabética) e não tem o retorno
-- antecipado para postgres/service_role daquele: vale para todos (DT-27).
CREATE OR REPLACE FUNCTION public.enforce_member_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fields text[] := ARRAY[]::text[];
  _ids uuid[] := ARRAY[]::uuid[];
  _all boolean;
  _id uuid;
  _i int;
BEGIN
  -- Linha excluída (ou sendo excluída): nada a conferir.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Na criação e na restauração, confere todas as pessoas; na edição, só as
  -- que mudaram.
  IF TG_OP = 'INSERT' THEN
    _all := true;
  ELSE
    _all := OLD.deleted_at IS NOT NULL;
  END IF;

  IF NEW.leader_id IS NOT NULL THEN
    IF _all OR NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN
      _fields := _fields || 'leader_id'::text;
      _ids := _ids || NEW.leader_id;
    END IF;
  END IF;
  IF NEW.spouse_id IS NOT NULL THEN
    IF _all OR NEW.spouse_id IS DISTINCT FROM OLD.spouse_id THEN
      _fields := _fields || 'spouse_id'::text;
      _ids := _ids || NEW.spouse_id;
    END IF;
  END IF;

  -- Trava em ordem de id com FOR KEY SHARE, que conflita com o FOR UPDATE de
  -- delete_member (RN-20); depois confere na ordem dos campos.
  FOR _id IN SELECT DISTINCT x FROM unnest(_ids) AS x ORDER BY x LOOP
    PERFORM 1 FROM public.members m WHERE m.id = _id FOR KEY SHARE;
  END LOOP;

  FOR _i IN 1 .. coalesce(array_length(_ids, 1), 0) LOOP
    IF EXISTS (SELECT 1 FROM public.members m WHERE m.id = _ids[_i] AND m.deleted_at IS NOT NULL) THEN
      PERFORM public._del_raise('deleted_member_chosen',
        'Este membro foi excluído e não pode ser escolhido.',
        jsonb_build_object('field', _fields[_i], 'member_id', _ids[_i]));
    END IF;
  END LOOP;

  -- RN-18: a conta de acesso do excluído continua com o e-mail (RN-14), então
  -- um cadastro novo com esse e-mail é recusado, inclusive pela API.
  IF TG_OP = 'INSERT' THEN
    IF public.normalize_email(NEW.email) IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM public.members d
          WHERE d.deleted_at IS NOT NULL
            AND d.auth_user_id IS NOT NULL
            AND public.normalize_email(d.email) = public.normalize_email(NEW.email)
       ) THEN
      PERFORM public._del_raise('deleted_account_email',
        'Este e-mail pertence a um cadastro excluído. Peça a um administrador para restaurá-lo ou use outro e-mail.');
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ab_enforce_member_links ON public.members;
CREATE TRIGGER ab_enforce_member_links
BEFORE INSERT OR UPDATE OF leader_id, spouse_id, deleted_at ON public.members
FOR EACH ROW EXECUTE FUNCTION public.enforce_member_links();

-- cells: líder, timóteo e anfitrião não excluídos, na criação, na troca e na
-- restauração (RN-06, RN-17).
CREATE OR REPLACE FUNCTION public.enforce_cell_links()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _fields text[] := ARRAY[]::text[];
  _ids uuid[] := ARRAY[]::uuid[];
  _all boolean;
  _id uuid;
  _i int;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _all := true;
  ELSE
    _all := OLD.deleted_at IS NOT NULL;
  END IF;

  IF NEW.leader_id IS NOT NULL THEN
    IF _all OR NEW.leader_id IS DISTINCT FROM OLD.leader_id THEN
      _fields := _fields || 'leader_id'::text;
      _ids := _ids || NEW.leader_id;
    END IF;
  END IF;
  IF NEW.timothy_id IS NOT NULL THEN
    IF _all OR NEW.timothy_id IS DISTINCT FROM OLD.timothy_id THEN
      _fields := _fields || 'timothy_id'::text;
      _ids := _ids || NEW.timothy_id;
    END IF;
  END IF;
  IF NEW.host_id IS NOT NULL THEN
    IF _all OR NEW.host_id IS DISTINCT FROM OLD.host_id THEN
      _fields := _fields || 'host_id'::text;
      _ids := _ids || NEW.host_id;
    END IF;
  END IF;

  FOR _id IN SELECT DISTINCT x FROM unnest(_ids) AS x ORDER BY x LOOP
    PERFORM 1 FROM public.members m WHERE m.id = _id FOR KEY SHARE;
  END LOOP;

  FOR _i IN 1 .. coalesce(array_length(_ids, 1), 0) LOOP
    IF EXISTS (SELECT 1 FROM public.members m WHERE m.id = _ids[_i] AND m.deleted_at IS NOT NULL) THEN
      PERFORM public._del_raise('deleted_member_chosen',
        'Este membro foi excluído e não pode ser escolhido.',
        jsonb_build_object('field', _fields[_i], 'member_id', _ids[_i]));
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_enforce_cell_links ON public.cells;
CREATE TRIGGER aa_enforce_cell_links
BEFORE INSERT OR UPDATE OF leader_id, timothy_id, host_id, deleted_at ON public.cells
FOR EACH ROW EXECUTE FUNCTION public.enforce_cell_links();

-- cell_reports: célula excluída não recebe relatório, e o relatório dela não é
-- editado (RN-06, RN-11). Roda antes dos triggers de semana (ordem alfabética).
CREATE OR REPLACE FUNCTION public.enforce_cell_report_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_cell uuid;
  _cell_changed boolean;
  _id uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Marcar ou desmarcar a exclusão: nada a conferir (RN-11, RN-17).
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RETURN NEW;
    END IF;
    _old_cell := OLD.cell_id;
    _cell_changed := NEW.cell_id IS DISTINCT FROM OLD.cell_id;
  ELSE
    _old_cell := NULL;
    _cell_changed := true;
  END IF;

  -- Relatório excluído (só fora da API): nada a conferir.
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  FOR _id IN
    SELECT DISTINCT x FROM unnest(ARRAY[_old_cell, NEW.cell_id]) AS x
     WHERE x IS NOT NULL
     ORDER BY x
  LOOP
    PERFORM 1 FROM public.cells c WHERE c.id = _id FOR KEY SHARE;
  END LOOP;

  -- Edição de relatório cuja célula está excluída (RN-11).
  IF _old_cell IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cells c WHERE c.id = _old_cell AND c.deleted_at IS NOT NULL) THEN
    PERFORM public._del_raise('report_cell_deleted',
      'A célula deste relatório foi excluída. Restaure a célula para editar o relatório.',
      jsonb_build_object('cell_id', _old_cell));
  END IF;

  -- Relatório novo, ou que passa a ser de outra célula, para célula excluída (RN-06).
  IF _cell_changed
     AND EXISTS (SELECT 1 FROM public.cells c WHERE c.id = NEW.cell_id AND c.deleted_at IS NOT NULL) THEN
    PERFORM public._del_raise('cell_deleted',
      'Esta célula foi excluída e não recebe relatórios.',
      jsonb_build_object('cell_id', NEW.cell_id));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_enforce_cell_report_rules ON public.cell_reports;
CREATE TRIGGER aa_enforce_cell_report_rules
BEFORE INSERT OR UPDATE ON public.cell_reports
FOR EACH ROW EXECUTE FUNCTION public.enforce_cell_report_rules();

-- cell_report_participants (RN-06, RN-07, RN-11, RN-13; DA-7).
CREATE OR REPLACE FUNCTION public.enforce_participant_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _report_id uuid;
  _member_id uuid;
  _report record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _report_id := NEW.report_id;
    _member_id := NEW.member_id;
    -- Par que já existe: o ON CONFLICT o descarta; nada a conferir.
    IF EXISTS (SELECT 1 FROM public.cell_report_participants p
                WHERE p.report_id = _report_id AND p.member_id = _member_id) THEN
      RETURN NEW;
    END IF;
  ELSE
    _report_id := OLD.report_id;
    _member_id := OLD.member_id;
  END IF;

  SELECT r.id, r.cell_id, r.deleted_at
    INTO _report
    FROM public.cell_reports r
   WHERE r.id = _report_id
   FOR KEY SHARE;

  IF NOT FOUND OR _report.deleted_at IS NOT NULL THEN
    PERFORM public._del_raise('not_found_or_deleted',
      'Este relatório não existe ou já foi excluído.',
      jsonb_build_object('entity', 'cell_report'));
  END IF;

  PERFORM 1 FROM public.cells c WHERE c.id = _report.cell_id FOR KEY SHARE;
  IF EXISTS (SELECT 1 FROM public.cells c WHERE c.id = _report.cell_id AND c.deleted_at IS NOT NULL) THEN
    PERFORM public._del_raise('report_cell_deleted',
      'A célula deste relatório foi excluída. Restaure a célula para editar o relatório.',
      jsonb_build_object('cell_id', _report.cell_id));
  END IF;

  PERFORM 1 FROM public.members m WHERE m.id = _member_id FOR KEY SHARE;
  IF EXISTS (SELECT 1 FROM public.members m WHERE m.id = _member_id AND m.deleted_at IS NOT NULL) THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM public._del_raise('deleted_member_chosen',
        'Este membro foi excluído e não pode ser escolhido.',
        jsonb_build_object('field', 'member_id', 'member_id', _member_id));
    ELSE
      PERFORM public._del_raise('deleted_participant_removal',
        'Não é possível retirar um participante cujo cadastro foi excluído.',
        jsonb_build_object('member_id', _member_id));
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS aa_enforce_participant_rules ON public.cell_report_participants;
CREATE TRIGGER aa_enforce_participant_rules
BEFORE INSERT OR DELETE ON public.cell_report_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_participant_rules();

REVOKE ALL ON FUNCTION public.enforce_member_links() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_cell_links() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_cell_report_rules() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_participant_rules() FROM PUBLIC, anon, authenticated;

-- ===========================================================================
-- 3. Um relatório por célula e semana (REL-03), sem contar os excluídos
-- ===========================================================================
-- Mesma mensagem de hoje. A trava consultiva (célula, semana) dá a mensagem
-- amigável também na corrida; o índice cell_reports_cell_week_key é a garantia.
CREATE OR REPLACE FUNCTION public.enforce_unique_weekly_cell_report()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _week_start date;
  _week_end date;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Semana de domingo a sábado.
  _week_start := public.week_start(NEW.date);
  _week_end := _week_start + 6;

  PERFORM public._del_lock_cell_week(NEW.cell_id, NEW.date);

  IF EXISTS (
    SELECT 1
      FROM public.cell_reports r
     WHERE r.cell_id = NEW.cell_id
       AND r.date >= _week_start
       AND r.date <= _week_end
       AND r.deleted_at IS NULL
       AND (TG_OP = 'INSERT' OR r.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'Já existe um relatório para esta célula nesta semana (% a %).', _week_start, _week_end
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 4. Totais (RN-10, DT-24)
-- ===========================================================================
-- Mesma fórmula de antes, com quatro mudanças: a descida da subárvore ignora os
-- membros excluídos; cell_totals conta só células ativas e não excluídas;
-- search_path fixo; e o líder antigo entra nos afetados também quando o novo
-- é nulo (antes, "OLD.leader_id <> NULL" deixava o ramo antigo sem recálculo).
CREATE OR REPLACE FUNCTION public.refresh_member_stats_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_member_ids uuid[] := '{}';
  ancestor_ids uuid[] := '{}';
BEGIN
  -- Proteção contra recursão (as atualizações de totais disparam triggers).
  IF current_setting('my_app.refreshing_stats', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Membros afetados diretamente.
  IF TG_TABLE_NAME = 'members' THEN
    IF TG_OP = 'INSERT' THEN
      affected_member_ids := ARRAY[NEW.id];
      IF NEW.leader_id IS NOT NULL THEN affected_member_ids := affected_member_ids || NEW.leader_id; END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      affected_member_ids := ARRAY[NEW.id];
      IF NEW.leader_id IS NOT NULL THEN affected_member_ids := affected_member_ids || NEW.leader_id; END IF;
      IF OLD.leader_id IS NOT NULL AND OLD.leader_id IS DISTINCT FROM NEW.leader_id THEN
        affected_member_ids := affected_member_ids || OLD.leader_id;
      END IF;
    ELSIF TG_OP = 'DELETE' THEN
      IF OLD.leader_id IS NOT NULL THEN affected_member_ids := ARRAY[OLD.leader_id]; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'cells' THEN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
      IF NEW.leader_id IS NOT NULL THEN affected_member_ids := ARRAY[NEW.leader_id]; END IF;
    END IF;
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
      IF OLD.leader_id IS NOT NULL THEN affected_member_ids := affected_member_ids || OLD.leader_id; END IF;
    END IF;
  END IF;

  IF array_length(affected_member_ids, 1) IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  PERFORM set_config('my_app.refreshing_stats', 'true', true);

  -- Todos os ancestrais.
  WITH RECURSIVE ancestors AS (
    SELECT id, leader_id FROM public.members WHERE id = ANY(affected_member_ids)
    UNION ALL
    SELECT m.id, m.leader_id
      FROM public.members m
      JOIN ancestors a ON m.id = a.leader_id
  )
  SELECT array_agg(DISTINCT id) INTO ancestor_ids FROM ancestors;

  IF ancestor_ids IS NOT NULL AND array_length(ancestor_ids, 1) > 0 THEN
    WITH RECURSIVE subordinates AS (
      SELECT id AS root_id, id AS subordinate_id, ARRAY[id] AS path
        FROM public.members
       WHERE id = ANY(ancestor_ids)
      UNION ALL
      SELECT s.root_id, m.id, s.path || m.id
        FROM public.members m
        JOIN subordinates s ON m.leader_id = s.subordinate_id
       WHERE NOT m.id = ANY(s.path)
         AND m.deleted_at IS NULL                 -- E2.01: a subárvore ignora excluídos
    ),
    cell_totals AS (
      -- Células ativas e não excluídas, por líder e gênero do líder.
      SELECT c.leader_id, m.gender, count(*) AS count
        FROM public.cells c
        JOIN public.members m ON c.leader_id = m.id
       WHERE c.is_active = true
         AND c.deleted_at IS NULL                 -- E2.01
       GROUP BY c.leader_id, m.gender
    ),
    stats AS (
      SELECT
        sub.root_id,
        count(DISTINCT sub.subordinate_id) FILTER (
          WHERE sub.subordinate_id <> sub.root_id
            AND EXISTS (SELECT 1 FROM public.members m2
                         WHERE m2.id = sub.subordinate_id
                           AND m2.is_active = true
                           AND m2.deleted_at IS NULL)
        ) AS calc_total_disciples,
        coalesce(sum(ct.count) FILTER (WHERE ct.gender = 'Masculino' OR ct.gender = 'M'), 0) AS calc_male_cells,
        coalesce(sum(ct.count) FILTER (WHERE ct.gender = 'Feminino' OR ct.gender = 'F'), 0) AS calc_female_cells
      FROM subordinates sub
      LEFT JOIN cell_totals ct ON sub.subordinate_id = ct.leader_id
      GROUP BY sub.root_id
    )
    UPDATE public.members m
       SET total_disciples = s.calc_total_disciples,
           male_cells = s.calc_male_cells,
           female_cells = s.calc_female_cells,
           total_cells = s.calc_male_cells + s.calc_female_cells
      FROM stats s
     WHERE m.id = s.root_id;
  END IF;

  PERFORM set_config('my_app.refreshing_stats', 'false', true);

  RETURN COALESCE(NEW, OLD);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('my_app.refreshing_stats', 'false', true);
  RAISE;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_stats_members ON public.members;
CREATE TRIGGER trg_refresh_stats_members
AFTER INSERT OR DELETE OR UPDATE OF leader_id, is_active, deleted_at ON public.members
FOR EACH ROW EXECUTE FUNCTION public.refresh_member_stats_v2();

DROP TRIGGER IF EXISTS trg_refresh_stats_cells ON public.cells;
CREATE TRIGGER trg_refresh_stats_cells
AFTER INSERT OR DELETE OR UPDATE OF leader_id, is_active, deleted_at ON public.cells
FOR EACH ROW EXECUTE FUNCTION public.refresh_member_stats_v2();

-- ===========================================================================
-- 5. Auditoria (RN-19, DT-16)
-- ===========================================================================
-- Cada função ganha, ANTES do bloco que engole erros, um ramo para a exclusão,
-- a restauração e (em members) o cônjuge desfeito pela exclusão. Esse ramo não
-- engole erro: se a auditoria falhar, a operação inteira falha (RN-20). Os
-- demais eventos continuam como antes.

CREATE OR REPLACE FUNCTION public._trg_log_member_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed text[] := ARRAY[]::text[];
  _meta jsonb := '{}'::jsonb;
  _label text;
  _desc  text;
  _whitelist_with_values text[] := ARRAY[
    'name','role_id','leader_id','spouse_id','is_pastor',
    'has_leadership','is_active','is_baptized','gender'
  ];
  _whitelist_names_only text[] := ARRAY[
    'email','cpf','birth_date','mobile_whatsapp','phone','notes',
    'avatar_url','instagram','street','number','complement',
    'neighborhood','city','state','zip_code','baptism_date'
  ];
  _f text;
  _old_v text;
  _new_v text;
  _spouse_name text;
BEGIN
  -- E2.01: ramo que não engole erro.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN
      _changed := ARRAY['deleted_at'];
      _meta := jsonb_build_object('op', 'soft_delete');
      IF OLD.spouse_id IS DISTINCT FROM NEW.spouse_id THEN
        _changed := _changed || 'spouse_id'::text;
        _meta := _meta || jsonb_build_object('spouse_id',
                   jsonb_build_object('from', OLD.spouse_id, 'to', NEW.spouse_id));
      END IF;
      PERFORM public._log_event('delete', 'member', NEW.id, NEW.name,
        'Excluiu o membro ' || coalesce(NEW.name, ''), _changed, _meta);
      RETURN NEW;

    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN
      _meta := jsonb_build_object(
        'op', 'restore',
        'restored_without_leader', OLD.leader_id IS NOT NULL AND NEW.leader_id IS NULL,
        'previous_leader_id', OLD.leader_id,
        'role_reset_to_default', OLD.role_id IS NULL AND NEW.role_id IS NOT NULL);
      PERFORM public._log_event('restore', 'member', NEW.id, NEW.name,
        'Restaurou o membro ' || coalesce(NEW.name, ''), ARRAY['deleted_at'], _meta);
      RETURN NEW;

    ELSIF NEW.deleted_at IS NULL
          AND OLD.spouse_id IS NOT NULL
          AND NEW.spouse_id IS NULL THEN
      SELECT s.name INTO _spouse_name
        FROM public.members s
       WHERE s.id = OLD.spouse_id
         AND s.deleted_at IS NOT NULL;
      IF FOUND THEN
        PERFORM public._log_event('update', 'member', NEW.id, NEW.name,
          'Vínculo de cônjuge desfeito pela exclusão de ' || coalesce(_spouse_name, ''),
          ARRAY['spouse_id'],
          jsonb_build_object(
            'spouse_id', jsonb_build_object('from', OLD.spouse_id, 'to', NULL::uuid),
            'reason', 'spouse_deleted'));
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      _label := NEW.name;
      _desc  := 'Criou o membro ' || COALESCE(NEW.name, '');
      _meta := jsonb_strip_nulls(jsonb_build_object(
        'name', NEW.name, 'role_id', NEW.role_id,
        'leader_id', NEW.leader_id, 'is_pastor', NEW.is_pastor
      ));
      PERFORM public._log_event('create','member',NEW.id,_label,_desc,NULL,_meta);
      RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
      _label := NEW.name;

      FOREACH _f IN ARRAY _whitelist_with_values LOOP
        EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', _f, _f)
          INTO _old_v, _new_v USING OLD, NEW;
        IF _old_v IS DISTINCT FROM _new_v THEN
          _changed := _changed || _f;
          _meta := _meta || jsonb_build_object(_f, jsonb_build_object('from', _old_v, 'to', _new_v));
        END IF;
      END LOOP;

      FOREACH _f IN ARRAY _whitelist_names_only LOOP
        EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', _f, _f)
          INTO _old_v, _new_v USING OLD, NEW;
        IF _old_v IS DISTINCT FROM _new_v THEN
          _changed := _changed || _f;
        END IF;
      END LOOP;

      IF array_length(_changed, 1) IS NULL THEN
        RETURN NEW;
      END IF;

      _desc := 'Atualizou o membro ' || COALESCE(NEW.name, '');
      PERFORM public._log_event('update','member',NEW.id,_label,_desc,_changed,_meta);
      RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
      _label := OLD.name;
      _desc  := 'Removeu o membro ' || COALESCE(OLD.name, '');
      _meta := jsonb_strip_nulls(jsonb_build_object(
        'name', OLD.name, 'role_id', OLD.role_id, 'leader_id', OLD.leader_id
      ));
      PERFORM public._log_event('delete','member',OLD.id,_label,_desc,NULL,_meta);
      RETURN OLD;
    END IF;

    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log member event failed: %', SQLERRM;
    RETURN COALESCE(NEW, OLD);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_log_cell_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed text[] := ARRAY[]::text[];
  _meta jsonb := '{}'::jsonb;
  _label text;
  _desc  text;
  _whitelist text[] := ARRAY[
    'type','leader_id','timothy_id','host_id','is_active',
    'meeting_day','meeting_time','neighborhood','city'
  ];
  _f text;
  _old_v text;
  _new_v text;
BEGIN
  -- E2.01: ramo que não engole erro.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      _label := public._cell_label_by_leader(NEW.leader_id);
      IF NEW.deleted_at IS NOT NULL THEN
        PERFORM public._log_event('delete', 'cell', NEW.id, _label, 'Excluiu a ' || _label,
          ARRAY['deleted_at'], jsonb_build_object('op', 'soft_delete'));
      ELSE
        PERFORM public._log_event('restore', 'cell', NEW.id, _label, 'Restaurou a ' || _label,
          ARRAY['deleted_at'], jsonb_build_object('op', 'restore'));
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    IF TG_OP = 'INSERT' THEN
      _label := public._cell_label_by_leader(NEW.leader_id);
      _desc  := 'Criou a ' || _label;
      _meta := jsonb_strip_nulls(jsonb_build_object(
        'type', NEW.type,
        'leader_id', NEW.leader_id, 'timothy_id', NEW.timothy_id,
        'host_id', NEW.host_id, 'is_active', NEW.is_active
      ));
      PERFORM public._log_event('create','cell',NEW.id,_label,_desc,NULL,_meta);
      RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
      _label := public._cell_label_by_leader(NEW.leader_id);
      FOREACH _f IN ARRAY _whitelist LOOP
        EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', _f, _f)
          INTO _old_v, _new_v USING OLD, NEW;
        IF _old_v IS DISTINCT FROM _new_v THEN
          _changed := _changed || _f;
          _meta := _meta || jsonb_build_object(_f, jsonb_build_object('from', _old_v, 'to', _new_v));
        END IF;
      END LOOP;

      IF array_length(_changed, 1) IS NULL THEN RETURN NEW; END IF;

      _desc := 'Atualizou a ' || _label;
      PERFORM public._log_event('update','cell',NEW.id,_label,_desc,_changed,_meta);
      RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
      _label := public._cell_label_by_leader(OLD.leader_id);
      _desc  := 'Removeu a ' || _label;
      _meta := jsonb_strip_nulls(jsonb_build_object('leader_id', OLD.leader_id));
      PERFORM public._log_event('delete','cell',OLD.id,_label,_desc,NULL,_meta);
      RETURN OLD;
    END IF;

    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log cell event failed: %', SQLERRM;
    RETURN COALESCE(NEW, OLD);
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_log_cell_report_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _changed text[] := ARRAY[]::text[];
  _meta jsonb := '{}'::jsonb;
  _label text;
  _desc  text;
  _whitelist text[] := ARRAY['date','was_held','offering','theme','reason_not_held'];
  _f text;
  _old_v text;
  _new_v text;
  _row_cell_id uuid;
  _row_date date;
BEGIN
  -- E2.01: ramo que não engole erro.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.deleted_at IS DISTINCT FROM NEW.deleted_at THEN
      _label := 'relatório da '
        || public._cell_label_by_leader((SELECT c.leader_id FROM public.cells c WHERE c.id = NEW.cell_id))
        || ' em ' || NEW.date::text;
      IF NEW.deleted_at IS NOT NULL THEN
        PERFORM public._log_event('delete', 'cell_report', NEW.id, _label, 'Excluiu o ' || _label,
          ARRAY['deleted_at'], jsonb_build_object('op', 'soft_delete', 'cell_id', NEW.cell_id, 'date', NEW.date));
      ELSE
        PERFORM public._log_event('restore', 'cell_report', NEW.id, _label, 'Restaurou o ' || _label,
          ARRAY['deleted_at'], jsonb_build_object('op', 'restore', 'cell_id', NEW.cell_id, 'date', NEW.date));
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      _row_cell_id := OLD.cell_id; _row_date := OLD.date;
    ELSE
      _row_cell_id := NEW.cell_id; _row_date := NEW.date;
    END IF;

    _label := 'relatório da '
      || public._cell_label_by_leader((SELECT c.leader_id FROM public.cells c WHERE c.id = _row_cell_id))
      || ' em ' || _row_date::text;

    IF TG_OP = 'INSERT' THEN
      _desc := 'Registrou o ' || _label;
      _meta := jsonb_strip_nulls(jsonb_build_object(
        'cell_id', NEW.cell_id, 'date', NEW.date,
        'was_held', NEW.was_held, 'offering', NEW.offering, 'theme', NEW.theme
      ));
      PERFORM public._log_event('create','cell_report',NEW.id,_label,_desc,NULL,_meta);
      RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
      FOREACH _f IN ARRAY _whitelist LOOP
        EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', _f, _f)
          INTO _old_v, _new_v USING OLD, NEW;
        IF _old_v IS DISTINCT FROM _new_v THEN
          _changed := _changed || _f;
          _meta := _meta || jsonb_build_object(_f, jsonb_build_object('from', _old_v, 'to', _new_v));
        END IF;
      END LOOP;

      IF array_length(_changed, 1) IS NULL THEN RETURN NEW; END IF;

      _desc := 'Atualizou o ' || _label;
      PERFORM public._log_event('update','cell_report',NEW.id,_label,_desc,_changed,_meta);
      RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
      _desc := 'Removeu o ' || _label;
      _meta := jsonb_strip_nulls(jsonb_build_object('cell_id', OLD.cell_id, 'date', OLD.date));
      PERFORM public._log_event('delete','cell_report',OLD.id,_label,_desc,NULL,_meta);
      RETURN OLD;
    END IF;

    RETURN NULL;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'log cell_report event failed: %', SQLERRM;
    RETURN COALESCE(NEW, OLD);
  END;
END;
$$;

-- ===========================================================================
-- 6. RPCs
-- ===========================================================================
-- Todas: EXECUTE só para authenticated; nenhuma recebe id de usuário (quem
-- chama é sempre auth.uid()); ordem das checagens: permissão (42501) → entrada
-- → travas → existência e visibilidade → regras → escrita. deleted_by recebe
-- viewer_member_id(). A auditoria sai dos triggers.
--
-- Visibilidade (DA-10): para excluir, o registro precisa estar na view
-- principal (members_view, cells_view, cell_reports_view); para restaurar, na
-- view de excluídos. Fora disso, vale como inexistente (RN-02, RN-15).

-- Pré-checagem da exclusão de membro (AQ-1), só leitura. Devolve
-- { "can_delete": true } ou { "can_delete": false, "code", "message", ... },
-- com o mesmo conteúdo da recusa de delete_member.
CREATE OR REPLACE FUNCTION public.check_member_deletion(_member_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _block jsonb;
BEGIN
  IF NOT public.viewer_has('delete_member'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  _block := public._del_member_blockers(_member_id);
  IF _block IS NULL THEN
    RETURN jsonb_build_object('can_delete', true);
  END IF;
  RETURN jsonb_build_object('can_delete', false) || _block;
END;
$$;

-- Exclusão lógica de um membro (RN-01 a RN-05, RN-10, RN-14, RN-20).
CREATE OR REPLACE FUNCTION public.delete_member(_member_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := public.viewer_member_id();
  _auth uuid;
  _block jsonb;
BEGIN
  IF NOT public.viewer_has('delete_member'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _member_id IS NULL THEN
    PERFORM public._del_raise('not_found_or_deleted', 'Este cadastro não existe ou já foi excluído.',
                              '{"entity": "member"}'::jsonb);
  END IF;

  -- Alvo, cônjuge e quem exclui, em ordem de id (DT-09, DT-21).
  PERFORM public._del_lock_members(_member_id, _me);
  -- Quem exclui pode ter sido excluído durante a espera (RN-03 sob concorrência).
  IF NOT public.viewer_has('delete_member'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  _block := public._del_member_blockers(_member_id);
  IF _block IS NOT NULL THEN
    PERFORM public._del_raise(_block ->> 'code', _block ->> 'message', _block - 'message');
  END IF;

  -- Triggers: cônjuge (sync_spouse_relationship limpa o outro lado), totais,
  -- auditoria.
  UPDATE public.members
     SET deleted_at = now(),
         deleted_by = _me,
         spouse_id = NULL
   WHERE id = _member_id
  RETURNING auth_user_id INTO _auth;

  IF _auth IS NOT NULL THEN
    PERFORM public._del_suspend_access(_member_id, _auth);
  END IF;
END;
$$;

-- Restauração de um membro (RN-15, RN-16; DA-2, DA-3).
CREATE OR REPLACE FUNCTION public.restore_member(_member_id uuid)
RETURNS TABLE (
  restored_without_leader boolean,
  previous_leader_name text,
  role_reset_to_default boolean,
  role_name text
)
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
    SELECT r.id INTO _new_role FROM public.roles r WHERE r.is_default LIMIT 1;
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

-- Exclusão lógica de uma célula (RN-01, RN-02, RN-10, RN-11). Os relatórios dela
-- não mudam.
CREATE OR REPLACE FUNCTION public.delete_cell(_cell_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record;
BEGIN
  IF NOT public.viewer_has('delete_cell'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _cell_id IS NULL THEN
    PERFORM public._del_raise('not_found_or_deleted', 'Esta célula não existe ou já foi excluída.',
                              '{"entity": "cell"}'::jsonb);
  END IF;

  SELECT c.id, c.deleted_at INTO _c FROM public.cells c WHERE c.id = _cell_id FOR UPDATE;
  IF NOT FOUND
     OR _c.deleted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.cells_view v WHERE v.id = _cell_id) THEN
    PERFORM public._del_raise('not_found_or_deleted', 'Esta célula não existe ou já foi excluída.',
                              '{"entity": "cell"}'::jsonb);
  END IF;

  UPDATE public.cells
     SET deleted_at = now(),
         deleted_by = public.viewer_member_id()
   WHERE id = _cell_id;
END;
$$;

-- Restauração de uma célula (RN-15, RN-17; DA-5).
CREATE OR REPLACE FUNCTION public.restore_cell(_cell_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record;
  _id uuid;
  _people jsonb;
  _first jsonb;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _cell_id IS NULL THEN
    PERFORM public._del_raise('not_found', 'Esta célula não foi encontrada.', '{"entity": "cell"}'::jsonb);
  END IF;

  SELECT c.id, c.leader_id, c.timothy_id, c.host_id, c.deleted_at
    INTO _c
    FROM public.cells c
   WHERE c.id = _cell_id
   FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('not_found', 'Esta célula não foi encontrada.', '{"entity": "cell"}'::jsonb);
  END IF;
  IF _c.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.cells_view v WHERE v.id = _cell_id) THEN
      PERFORM public._del_raise('not_deleted', 'Esta célula não está excluída.', '{"entity": "cell"}'::jsonb);
    END IF;
    PERFORM public._del_raise('not_found', 'Esta célula não foi encontrada.', '{"entity": "cell"}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cells_deleted_view v WHERE v.id = _cell_id) THEN
    PERFORM public._del_raise('not_found', 'Esta célula não foi encontrada.', '{"entity": "cell"}'::jsonb);
  END IF;

  -- Líder, timóteo e anfitrião: FOR KEY SHARE em ordem de id.
  FOR _id IN
    SELECT DISTINCT x FROM unnest(ARRAY[_c.leader_id, _c.timothy_id, _c.host_id]) AS x
     WHERE x IS NOT NULL ORDER BY x
  LOOP
    PERFORM 1 FROM public.members m WHERE m.id = _id FOR KEY SHARE;
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('role', p.role, 'member_id', p.member_id, 'member_name', m.name)
                   ORDER BY p.ord)
    INTO _people
    FROM (VALUES (1, 'leader', _c.leader_id), (2, 'timothy', _c.timothy_id), (3, 'host', _c.host_id))
           AS p(ord, role, member_id)
    JOIN public.members m ON m.id = p.member_id
   WHERE m.deleted_at IS NOT NULL;

  IF _people IS NOT NULL THEN
    _first := _people -> 0;
    PERFORM public._del_raise('restore_person_deleted',
      'Não é possível restaurar a célula: o '
        || CASE _first ->> 'role' WHEN 'leader' THEN 'líder' WHEN 'timothy' THEN 'timóteo' ELSE 'anfitrião' END
        || ' ' || (_first ->> 'member_name')
        || ' foi excluído. Restaure o cadastro dele antes ou crie uma célula nova.',
      jsonb_build_object('people', _people));
  END IF;

  UPDATE public.cells
     SET deleted_at = NULL,
         deleted_by = NULL
   WHERE id = _cell_id;
END;
$$;

-- Exclusão lógica de um relatório (RN-01, RN-02, RN-11, RN-12). Os participantes
-- ficam guardados com ele.
CREATE OR REPLACE FUNCTION public.delete_cell_report(_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r record;
BEGIN
  IF NOT public.viewer_has('delete_cell_report'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _report_id IS NULL THEN
    PERFORM public._del_raise('not_found_or_deleted', 'Este relatório não existe ou já foi excluído.',
                              '{"entity": "cell_report"}'::jsonb);
  END IF;

  SELECT r.id, r.deleted_at INTO _r FROM public.cell_reports r WHERE r.id = _report_id FOR UPDATE;
  IF NOT FOUND
     OR _r.deleted_at IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM public.cell_reports_view v WHERE v.id = _report_id) THEN
    PERFORM public._del_raise('not_found_or_deleted', 'Este relatório não existe ou já foi excluído.',
                              '{"entity": "cell_report"}'::jsonb);
  END IF;

  UPDATE public.cell_reports
     SET deleted_at = now(),
         deleted_by = public.viewer_member_id()
   WHERE id = _report_id;
END;
$$;

-- Restauração de um relatório (RN-15, RN-17; DT-23, DT-28). Não confere a
-- semana atual, a data nem o horário da célula: restaurar não é lançar.
CREATE OR REPLACE FUNCTION public.restore_cell_report(_report_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r record;
  _other uuid;
  _constraint text;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _report_id IS NULL THEN
    PERFORM public._del_raise('not_found', 'Este relatório não foi encontrado.', '{"entity": "cell_report"}'::jsonb);
  END IF;

  SELECT r.id, r.cell_id, r.date, r.deleted_at
    INTO _r
    FROM public.cell_reports r
   WHERE r.id = _report_id
   FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('not_found', 'Este relatório não foi encontrado.', '{"entity": "cell_report"}'::jsonb);
  END IF;
  IF _r.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.cell_reports_view v WHERE v.id = _report_id) THEN
      PERFORM public._del_raise('not_deleted', 'Este relatório não está excluído.', '{"entity": "cell_report"}'::jsonb);
    END IF;
    PERFORM public._del_raise('not_found', 'Este relatório não foi encontrado.', '{"entity": "cell_report"}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cell_reports_deleted_view v WHERE v.id = _report_id) THEN
    PERFORM public._del_raise('not_found', 'Este relatório não foi encontrado.', '{"entity": "cell_report"}'::jsonb);
  END IF;

  PERFORM public._del_lock_cell_week(_r.cell_id, _r.date);

  SELECT o.id INTO _other
    FROM public.cell_reports o
   WHERE o.cell_id = _r.cell_id
     AND public.week_start(o.date) = public.week_start(_r.date)
     AND o.deleted_at IS NULL
     AND o.id <> _report_id
   LIMIT 1;
  IF FOUND THEN
    PERFORM public._del_raise('restore_week_taken',
      'Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.',
      jsonb_build_object('report_id', _other, 'week_start', public.week_start(_r.date)));
  END IF;

  BEGIN
    UPDATE public.cell_reports
       SET deleted_at = NULL,
           deleted_by = NULL
     WHERE id = _report_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    IF _constraint IS DISTINCT FROM 'cell_reports_cell_week_key' THEN
      RAISE;
    END IF;
    SELECT o.id INTO _other
      FROM public.cell_reports o
     WHERE o.cell_id = _r.cell_id
       AND public.week_start(o.date) = public.week_start(_r.date)
       AND o.deleted_at IS NULL
       AND o.id <> _report_id
     LIMIT 1;
    PERFORM public._del_raise('restore_week_taken',
      'Esta célula já tem outro relatório na mesma semana. Exclua-o antes de restaurar este.',
      jsonb_build_object('report_id', _other, 'week_start', public.week_start(_r.date)));
  END;
END;
$$;

-- Participantes de um relatório (RN-13, DT-15). _member_ids é o conjunto FINAL,
-- incluindo os participantes excluídos que continuam no relatório. Apaga os
-- pares fora da lista e insere só os que faltam, numa transação. SECURITY
-- INVOKER: valem as políticas de INSERT e DELETE de participantes, e o trigger
-- aa_enforce_participant_rules recusa retirar um excluído, incluir um excluído
-- novo e mexer em relatório excluído ou de célula excluída. O E2.11 absorve.
CREATE OR REPLACE FUNCTION public.set_cell_report_participants(_report_id uuid, _member_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _ids uuid[];
BEGIN
  _ids := ARRAY(
    SELECT DISTINCT x
      FROM unnest(coalesce(_member_ids, '{}'::uuid[])) AS x
     WHERE x IS NOT NULL
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

  DELETE FROM public.cell_report_participants p
   WHERE p.report_id = _report_id
     AND NOT (p.member_id = ANY (_ids));

  -- ON CONFLICT sem alvo (ver spec, "Participantes do relatório").
  INSERT INTO public.cell_report_participants (report_id, member_id)
  SELECT _report_id, x
    FROM unnest(_ids) AS x
   WHERE NOT EXISTS (
     SELECT 1 FROM public.cell_report_participants p
      WHERE p.report_id = _report_id AND p.member_id = x
   )
  ON CONFLICT DO NOTHING;
END;
$$;

-- Cadastro com dados de um membro excluído (RN-18, DT-18, DA-8). Até 10
-- cadastros excluídos com o mesmo e-mail, celular ou CPF, da exclusão mais
-- recente para a mais antiga. member_id, name e deleted_at só saem para quem
-- tem manage_roles e vê o cadastro na members_deleted_view; para os demais,
-- vêm nulos do banco (AQ-6).
CREATE OR REPLACE FUNCTION public.find_deleted_member_matches(_email text, _mobile text, _cpf text)
RETURNS TABLE (
  member_id uuid,
  name text,
  deleted_at timestamptz,
  matched_fields text[],
  is_account_email boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _e text := public.normalize_email(_email);
  _mo text := public.normalize_digits(_mobile);
  _c text := public.normalize_digits(_cpf);
  _admin boolean;
BEGIN
  IF NOT public.viewer_has('create_member'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _e IS NULL AND _mo IS NULL AND _c IS NULL THEN
    RETURN;
  END IF;

  _admin := public.viewer_has('manage_roles'::public.permission_action);

  RETURN QUERY
  SELECT CASE WHEN x.visible THEN x.id END,
         CASE WHEN x.visible THEN x.name END,
         CASE WHEN x.visible THEN x.deleted_at END,
         x.fields,
         x.account_email
    FROM (
      SELECT m.id,
             m.name,
             m.deleted_at,
             array_remove(ARRAY[
               CASE WHEN _e  IS NOT NULL AND public.normalize_email(m.email) = _e THEN 'email' END,
               CASE WHEN _mo IS NOT NULL AND public.normalize_digits(m.mobile_whatsapp) = _mo THEN 'mobile' END,
               CASE WHEN _c  IS NOT NULL AND public.normalize_digits(m.cpf) = _c THEN 'cpf' END
             ], NULL) AS fields,
             coalesce(_e IS NOT NULL AND public.normalize_email(m.email) = _e
                      AND m.auth_user_id IS NOT NULL, false) AS account_email,
             (_admin AND EXISTS (SELECT 1 FROM public.members_deleted_view v WHERE v.id = m.id)) AS visible
        FROM public.members m
       WHERE m.deleted_at IS NOT NULL
         AND (   (_e  IS NOT NULL AND public.normalize_email(m.email) = _e)
              OR (_mo IS NOT NULL AND public.normalize_digits(m.mobile_whatsapp) = _mo)
              OR (_c  IS NOT NULL AND public.normalize_digits(m.cpf) = _c))
       ORDER BY m.deleted_at DESC, m.id
       LIMIT 10
    ) x
   ORDER BY x.deleted_at DESC, x.id;
END;
$$;

-- Grants das RPCs: só authenticated.
REVOKE EXECUTE ON FUNCTION public.check_member_deletion(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_member(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cell(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_cell(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_cell_report(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.restore_cell_report(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_cell_report_participants(uuid, uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.find_deleted_member_matches(text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.check_member_deletion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cell(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cell(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_cell_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_cell_report(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_cell_report_participants(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_deleted_member_matches(text, text, text) TO authenticated;
