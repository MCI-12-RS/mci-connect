-- E2.05 (PR 1, migration 3 de 6) — Auditoria: escrita (autoria e eventos). Ver
-- docs/specs/e2-05-auditoria-autor.md no repositório apps-mci ("Escrita: autoria e eventos",
-- "Relatório e participantes", "Funções (RN-15)", "Carga do legado", "Bloqueios e
-- concorrência"; RN-01 a RN-06, RN-13 a RN-16, RN-20; DA-1, DA-5, DA-7, DA-8, DA-10, DA-12;
-- DT-04 a DT-10, DT-16, DT-17).
--
-- Conteúdo:
--   1. private.current_actor(): o autor, pela sessão (DT-04, DA-1).
--   2. Funções internas da Auditoria (private.audit_*): a lista, as diferenças, os nomes, os
--      textos gravados e a escrita com fusão por transação (DT-08).
--   3. O carimbo: private.stamp_authorship() no trigger zz_stamp_authorship (BEFORE, o último)
--      de members, cells e cell_reports (DT-05).
--   4. Os triggers AFTER de Auditoria das seis tabelas, sem engolir erro (DT-07, RN-14):
--      aa_audit_record (membros, células, relatórios), aa_audit_participant (participantes, no
--      evento do relatório), aa_audit_role e zz_audit_role_delete (funções),
--      aa_audit_role_permission (permissões, no evento da função).
--   5. Saem os triggers e as funções antigos (trg_log_*, _trg_log_*) e os de updated_at de
--      membros e relatórios (DT-02). O update_roles_updated_at fica (versão da save_role).
--   6. public._log_event com actor_kind, e só para postgres (RN-16, DT-13).
--   7. enforce_participant_rules trava o relatório com FOR NO KEY UPDATE (DT-09).
--   8. public.save_cell_report (DT-09): relatório e participantes numa transação.
--   9. private.legacy_authorship (DT-17): a regra da carga do legado (RN-10, RN-11).
--
-- A ordem global de travas do E2.01 (DT-09) continua: relatório → célula → membros →
-- (célula, semana) → linhas dos triggers. Os eventos ficam no último nível e a fusão só enxerga
-- o evento da própria transação.
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 1. Quem é o autor (DT-04, DA-1)
-- ===========================================================================
-- Olha a sessão (auth.uid()), e não o papel do banco: as RPCs definer e os triggers rodam como
-- postgres, mas carregam a sessão de quem chamou. Consulta própria, e não viewer_member_id():
-- o portão do E2.03 não pode mudar quem é o autor.
CREATE OR REPLACE FUNCTION private.current_actor(OUT kind public.author_kind, OUT member_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NOT NULL THEN
    SELECT m.id INTO member_id
      FROM public.members m
     WHERE m.auth_user_id = _uid AND m.deleted_at IS NULL
     ORDER BY m.created_at NULLS LAST, m.id
     LIMIT 1;
    IF member_id IS NULL THEN                                  -- DA-1: sessão sem cadastro ou excluída
      RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
    END IF;
    kind := 'member';
  ELSIF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN   -- DA-1: nada grava sem pessoa pela API
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  ELSE
    kind := 'system';                                           -- migration, pg_cron, SQL Editor, chave secreta
  END IF;
END;
$$;

-- ===========================================================================
-- 2. Funções internas da Auditoria
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.audit_entity(_table name)
RETURNS public.event_entity
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE _table
           WHEN 'members' THEN 'member'::public.event_entity
           WHEN 'cells' THEN 'cell'::public.event_entity
           WHEN 'cell_reports' THEN 'cell_report'::public.event_entity
           WHEN 'roles' THEN 'role'::public.event_entity
         END
$$;

-- Algum campo da lista mudou? jsonb compara número por valor (50 = 50.00).
CREATE OR REPLACE FUNCTION private.audit_has_changes(_entity public.event_entity, _old jsonb, _new jsonb)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM private.audit_fields f
                  WHERE f.entity = _entity
                    AND (_old -> f.field) IS DISTINCT FROM (_new -> f.field))
$$;

-- O nome de agora de uma referência (o "nome de então", no momento da gravação).
CREATE OR REPLACE FUNCTION private.audit_ref_name(_value_type text, _id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
           WHEN _id IS NULL THEN NULL
           WHEN _value_type = 'member' THEN (SELECT m.name FROM public.members m WHERE m.id = _id)
           -- A função excluída nesta gravação (DA-5: a cascata roda depois do DELETE): o nome do
           -- evento da exclusão.
           WHEN _value_type = 'role'   THEN coalesce((SELECT r.name FROM public.roles r WHERE r.id = _id),
                                                     (SELECT e.entity_label FROM public.events e
                                                       WHERE e.entity = 'role' AND e.entity_id = _id AND e.action = 'delete'
                                                       ORDER BY e.seq DESC LIMIT 1))
           WHEN _value_type = 'cell'   THEN
             'célula de ' || coalesce((SELECT l.name FROM public.cells c JOIN public.members l ON l.id = c.leader_id
                                        WHERE c.id = _id), 'líder não informado')
         END
$$;

-- O array "fields" de changes, na ordem da lista, ou nulo se nada mudou (RN-20 b e c).
CREATE OR REPLACE FUNCTION private.audit_changes(_entity public.event_entity, _old jsonb, _new jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_agg(
           CASE
             WHEN NOT f.show_values THEN jsonb_build_object('field', f.field)
             WHEN f.value_type IN ('member', 'role', 'cell') THEN
               jsonb_build_object(
                 'field', f.field,
                 'from', private.audit_ref_name(f.value_type, (_old ->> f.field)::uuid),
                 'to', private.audit_ref_name(f.value_type, (_new ->> f.field)::uuid),
                 'from_id', _old -> f.field,
                 'to_id', _new -> f.field)
             ELSE jsonb_build_object('field', f.field, 'from', _old -> f.field, 'to', _new -> f.field)
           END
           ORDER BY f.position)
    FROM private.audit_fields f
   WHERE f.entity = _entity
     AND (_old -> f.field) IS DISTINCT FROM (_new -> f.field)
$$;

-- Fusão dos campos de duas gravações da mesma transação: o "from" do primeiro e o "to" do
-- último; o campo que volta ao valor de antes sai (DT-08).
CREATE OR REPLACE FUNCTION private.audit_merge_fields(_entity public.event_entity, _old jsonb, _new jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH o AS (SELECT x, x ->> 'field' AS f FROM jsonb_array_elements(coalesce(_old, '[]'::jsonb)) x),
       n AS (SELECT x, x ->> 'field' AS f FROM jsonb_array_elements(coalesce(_new, '[]'::jsonb)) x),
       m AS (
         SELECT coalesce(o.f, n.f) AS f,
                o.x IS NOT NULL AND n.x IS NOT NULL AS merged,
                CASE
                  WHEN o.x IS NULL THEN n.x
                  WHEN n.x IS NULL THEN o.x
                  ELSE n.x
                       || CASE WHEN o.x ? 'from' THEN jsonb_build_object('from', o.x -> 'from') ELSE '{}'::jsonb END
                       || CASE WHEN o.x ? 'from_id' THEN jsonb_build_object('from_id', o.x -> 'from_id') ELSE '{}'::jsonb END
                END AS x
           FROM o FULL JOIN n ON n.f = o.f)
  SELECT coalesce(jsonb_agg(m.x ORDER BY af.position), '[]'::jsonb)
    FROM m
    JOIN private.audit_fields af ON af.entity = _entity AND af.field = m.f
   WHERE NOT (m.merged
              AND m.x ? 'from'
              AND CASE WHEN m.x ? 'from_id' THEN (m.x -> 'from_id') = (m.x -> 'to_id')
                       ELSE (m.x -> 'from') = (m.x -> 'to') END)
$$;

-- Participantes e permissões: no cadastro, a lista única (sent / all); na alteração, added e
-- removed líquidos (incluir quem foi retirado na mesma transação anula os dois).
CREATE OR REPLACE FUNCTION private.audit_toggle(_changes jsonb, _group text, _action public.event_action,
                                                _item jsonb, _add boolean)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  _key text := coalesce(_item ->> 'id', _item #>> '{}');
  _g jsonb := coalesce(_changes -> _group, '{}'::jsonb);
  _list_key text := CASE _group WHEN 'participants' THEN 'sent' ELSE 'all' END;
  _list jsonb;
  _added jsonb;
  _removed jsonb;
BEGIN
  IF _action = 'create' THEN
    _list := coalesce(_g -> _list_key, '[]'::jsonb);
    IF _add THEN
      IF NOT private.audit_list_has(_list, _key) THEN
        _list := _list || jsonb_build_array(_item);
      END IF;
    ELSE
      _list := private.audit_list_without(_list, _key);
    END IF;
    _g := jsonb_build_object(_list_key, _list);
  ELSE
    _added := coalesce(_g -> 'added', '[]'::jsonb);
    _removed := coalesce(_g -> 'removed', '[]'::jsonb);
    IF _add THEN
      IF private.audit_list_has(_removed, _key) THEN
        _removed := private.audit_list_without(_removed, _key);
      ELSIF NOT private.audit_list_has(_added, _key) THEN
        _added := _added || jsonb_build_array(_item);
      END IF;
    ELSE
      IF private.audit_list_has(_added, _key) THEN
        _added := private.audit_list_without(_added, _key);
      ELSIF NOT private.audit_list_has(_removed, _key) THEN
        _removed := _removed || jsonb_build_array(_item);
      END IF;
    END IF;
    _g := jsonb_build_object('added', _added, 'removed', _removed);
  END IF;
  RETURN coalesce(_changes, '{}'::jsonb) || jsonb_build_object(_group, _g);
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_list_has(_list jsonb, _key text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(_list, '[]'::jsonb)) x
                  WHERE coalesce(x ->> 'id', x #>> '{}') = _key)
$$;

CREATE OR REPLACE FUNCTION private.audit_list_without(_list jsonb, _key text)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(x ORDER BY o), '[]'::jsonb)
    FROM jsonb_array_elements(coalesce(_list, '[]'::jsonb)) WITH ORDINALITY t (x, o)
   WHERE coalesce(x ->> 'id', x #>> '{}') IS DISTINCT FROM _key
$$;

-- As chaves de fields (events.changed_fields), ou nulo sem campos.
CREATE OR REPLACE FUNCTION private.audit_field_keys(_changes jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT nullif(ARRAY(SELECT x ->> 'field'
                        FROM jsonb_array_elements(coalesce(_changes -> 'fields', '[]'::jsonb)) WITH ORDINALITY t (x, o)
                       ORDER BY o), '{}'::text[])
$$;

-- O changes inicial de um evento novo.
CREATE OR REPLACE FUNCTION private.audit_base_changes(_entity public.event_entity, _action public.event_action)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN _action = 'create' AND _entity = 'cell_report' THEN '{"fields": [], "participants": {"sent": []}}'::jsonb
           WHEN _action = 'create' AND _entity = 'role'        THEN '{"fields": [], "permissions": {"all": []}}'::jsonb
           ELSE '{"fields": []}'::jsonb
         END
$$;

-- O registro (entity_label) e a descrição, já no vocabulário do spec (P-AUD-22, "Textos gravados").
CREATE OR REPLACE FUNCTION private.audit_text(_entity public.event_entity, _action public.event_action,
                                              _row jsonb, _changes jsonb,
                                              OUT label text, OUT description text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _who text;
  _date text;
  _name text := coalesce(_row ->> 'name', '');
  _prev text;
BEGIN
  IF _entity = 'member' THEN
    label := _row ->> 'name';
    description := CASE _action
                     WHEN 'create'  THEN 'Cadastrou o membro '
                     WHEN 'delete'  THEN 'Excluiu o membro '
                     WHEN 'restore' THEN 'Restaurou o membro '
                     ELSE 'Alterou o membro '
                   END || _name;
  ELSIF _entity = 'cell' THEN
    _who := coalesce((SELECT m.name FROM public.members m WHERE m.id = (_row ->> 'leader_id')::uuid),
                     'líder não informado');
    label := 'Célula de ' || _who;
    description := CASE _action
                     WHEN 'create'  THEN 'Cadastrou a célula de '
                     WHEN 'delete'  THEN 'Excluiu a célula de '
                     WHEN 'restore' THEN 'Restaurou a célula de '
                     ELSE 'Alterou a célula de '
                   END || _who;
  ELSIF _entity = 'cell_report' THEN
    _who := coalesce((SELECT m.name FROM public.cells c JOIN public.members m ON m.id = c.leader_id
                       WHERE c.id = (_row ->> 'cell_id')::uuid), 'líder não informado');
    _date := coalesce(to_char((_row ->> 'date')::date, 'DD/MM/YYYY'), '');
    label := 'Relatório de ' || _date || ' da célula de ' || _who;
    description := CASE _action
                     WHEN 'create'  THEN 'Enviou o relatório de '
                     WHEN 'delete'  THEN 'Excluiu o relatório de '
                     WHEN 'restore' THEN 'Restaurou o relatório de '
                     ELSE 'Alterou o relatório de '
                   END || _date || ' da célula de ' || _who;
  ELSIF _entity = 'role' THEN
    label := _row ->> 'name';
    IF _action = 'create' THEN
      description := 'Criou a função ' || _name;
    ELSIF _action = 'delete' THEN
      description := 'Excluiu a função ' || _name;
    ELSIF _changes ? 'default_role'
          AND coalesce(jsonb_array_length(_changes -> 'fields'), 0) = 0
          AND coalesce(jsonb_array_length(_changes #> '{permissions,added}'), 0) = 0
          AND coalesce(jsonb_array_length(_changes #> '{permissions,removed}'), 0) = 0 THEN
      _prev := _changes #>> '{default_role,previous,name}';             -- DA-10: só a troca da padrão
      description := _name || ' passou a ser a função padrão'
                     || CASE WHEN _prev IS NOT NULL THEN ' (antes: ' || _prev || ')' ELSE '' END;
    ELSE
      description := 'Alterou a função ' || _name;
    END IF;
  END IF;
END;
$$;

-- O último evento deste registro nesta gravação (DT-08): a mesma transação e o mesmo comando do
-- cliente (DT-24). Uma chamada da API é um comando só, então cascatas, RPCs de vários passos e
-- participantes por linha caem no mesmo evento; um script com vários comandos numa transação
-- (migration, SQL Editor, pgTAP) grava um evento por comando. O evento de um comando anterior tem
-- occurred_at < statement_timestamp() (o carimbo usa o relógio depois do início do comando). Sem
-- id de transação, nenhum evento desta transação pode existir.
CREATE OR REPLACE FUNCTION private.audit_tx_event(_entity public.event_entity, _id uuid)
RETURNS public.events
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.*
    FROM public.events e
   WHERE e.entity = _entity
     AND e.entity_id = _id
     AND e.tx_id = pg_current_xact_id_if_assigned()
     AND e.occurred_at >= statement_timestamp()
   ORDER BY e.seq DESC
   LIMIT 1
   FOR UPDATE
$$;

CREATE OR REPLACE FUNCTION private.audit_tx_event_action(_entity public.event_entity, _id uuid)
RETURNS public.event_action
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.action
    FROM public.events e
   WHERE e.entity = _entity
     AND e.entity_id = _id
     AND e.tx_id = pg_current_xact_id_if_assigned()
     AND e.occurred_at >= statement_timestamp()
   ORDER BY e.seq DESC
   LIMIT 1
$$;

-- Funde no evento da transação (cadastro ou alteração) ou grava um novo. _patch:
--   {"fields": [...]}                         campos mudados (ignorados na transação do cadastro, DA-12)
--   {"toggle": {"group", "item", "add"}}      participante ou permissão incluído/retirado
--   {"set": {...}}                            chaves gravadas como vêm (default_role, permissions)
-- Exclusão e restauração nunca fundem: são sempre uma gravação só (RPCs do E2.01).
CREATE OR REPLACE FUNCTION private.audit_write(
  _entity public.event_entity,
  _id uuid,
  _action public.event_action,
  _moment timestamptz,
  _actor_kind public.author_kind,
  _actor_member uuid,
  _row jsonb,
  _patch jsonb,
  _metadata jsonb DEFAULT NULL,
  _description text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _ev public.events;
  _merge boolean := false;
  _act public.event_action := _action;
  _ch jsonb;
  _p jsonb := coalesce(_patch, '{}'::jsonb);
  _label text;
  _desc text;
  _new_id uuid;
BEGIN
  IF _action IN ('create', 'update') THEN
    _ev := private.audit_tx_event(_entity, _id);
    _merge := _ev.id IS NOT NULL AND _ev.action IN ('create', 'update');
  END IF;

  IF _merge THEN
    _act := _ev.action;
    _ch := coalesce(_ev.changes, private.audit_base_changes(_entity, _act));
  ELSE
    _ch := private.audit_base_changes(_entity, _action);
  END IF;

  IF _p ? 'fields' AND _act <> 'create' THEN
    _ch := _ch || jsonb_build_object('fields', private.audit_merge_fields(_entity, _ch -> 'fields', _p -> 'fields'));
  END IF;
  IF _p ? 'toggle' THEN
    _ch := private.audit_toggle(_ch, _p #>> '{toggle,group}', _act, _p #> '{toggle,item}', (_p #>> '{toggle,add}')::boolean);
  END IF;
  IF _p ? 'set' THEN
    _ch := _ch || (_p -> 'set');
  END IF;

  SELECT t.label, t.description INTO _label, _desc FROM private.audit_text(_entity, _act, _row, _ch) t;

  IF _merge THEN
    UPDATE public.events e
       SET changes = _ch,
           changed_fields = private.audit_field_keys(_ch),
           entity_label = _label,
           description = coalesce(_description,
                                  CASE WHEN e.metadata ->> 'reason' = 'spouse_deleted' THEN e.description END,
                                  _desc),
           occurred_at = CASE WHEN _act = 'update' AND _moment IS NOT NULL THEN _moment ELSE e.occurred_at END,
           metadata = nullif(coalesce(e.metadata, '{}'::jsonb) || coalesce(_metadata, '{}'::jsonb), '{}'::jsonb)
     WHERE e.id = _ev.id;
    RETURN _ev.id;
  END IF;

  INSERT INTO public.events (occurred_at, actor_user_id, actor_label, actor_kind, action, entity, entity_id,
                             entity_label, description, changed_fields, changes, metadata, success)
  VALUES (coalesce(_moment, clock_timestamp()),
          CASE WHEN _actor_kind = 'member' THEN auth.uid() END,
          CASE WHEN _actor_kind = 'member' THEN (SELECT m.name FROM public.members m WHERE m.id = _actor_member) END,
          CASE WHEN _actor_kind = 'member' THEN 'member' ELSE 'system' END::public.event_actor_kind,
          _act, _entity, _id, _label, coalesce(_description, _desc), private.audit_field_keys(_ch), _ch,
          _metadata, true)
  RETURNING id INTO _new_id;
  RETURN _new_id;
END;
$$;

-- ===========================================================================
-- 3. O carimbo (DT-05): BEFORE, o último da tabela (zz_), compara o valor final
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.stamp_authorship()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _entity public.event_entity := private.audit_entity(TG_TABLE_NAME);
  _kind public.author_kind;
  _mid uuid;
  _moment timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN                                     -- RN-03: o cliente não define nada
    SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
    _moment := clock_timestamp();
    NEW.created_at := _moment;  NEW.created_by := _mid;
    NEW.created_by_kind := _kind;  NEW.created_by_legacy := NULL;
    NEW.updated_at := NULL;  NEW.updated_by := NULL;  NEW.updated_by_kind := NULL;  NEW.updated_by_legacy := NULL;
    NEW.deleted_by_legacy := NULL;
    IF NEW.deleted_at IS NULL THEN                             -- a política de INSERT já exige (E2.01)
      NEW.deleted_by := NULL;  NEW.deleted_by_kind := NULL;
    ELSE                                                       -- só fora da API
      NEW.deleted_at := _moment;  NEW.deleted_by := _mid;  NEW.deleted_by_kind := _kind;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: o cadastro nunca muda, e o resto da autoria só muda pelas regras abaixo (RN-03).
  NEW.created_at := OLD.created_at;  NEW.created_by := OLD.created_by;
  NEW.created_by_kind := OLD.created_by_kind;  NEW.created_by_legacy := OLD.created_by_legacy;
  NEW.updated_at := OLD.updated_at;  NEW.updated_by := OLD.updated_by;
  NEW.updated_by_kind := OLD.updated_by_kind;  NEW.updated_by_legacy := OLD.updated_by_legacy;
  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
    NEW.deleted_at := OLD.deleted_at;                          -- RN-06: excluir de novo não muda nada
  END IF;
  IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at THEN
    NEW.deleted_by := OLD.deleted_by;  NEW.deleted_by_kind := OLD.deleted_by_kind;
    NEW.deleted_by_legacy := OLD.deleted_by_legacy;
  END IF;

  IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
     AND NOT private.audit_has_changes(_entity, to_jsonb(OLD), to_jsonb(NEW))
     AND current_setting('mci.audit_touch', true) IS DISTINCT FROM NEW.id::text THEN
    RETURN NEW;                                                -- RN-04 (b): nada mudou
  END IF;
  IF OLD.deleted_at IS NOT DISTINCT FROM NEW.deleted_at
     AND private.audit_tx_event_action(_entity, NEW.id) = 'create' THEN
    RETURN NEW;                                                -- DA-12: faz parte do cadastro
  END IF;

  SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
  _moment := clock_timestamp();                                -- depois da trava da linha (leitura técnica 1)
  NEW.updated_at := _moment;  NEW.updated_by := _mid;
  NEW.updated_by_kind := _kind;  NEW.updated_by_legacy := NULL;
  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN          -- RN-06: excluir
    NEW.deleted_at := _moment;  NEW.deleted_by := _mid;
    NEW.deleted_by_kind := _kind;  NEW.deleted_by_legacy := NULL;
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN       -- RN-06: restaurar
    NEW.deleted_by := NULL;  NEW.deleted_by_kind := NULL;  NEW.deleted_by_legacy := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- ===========================================================================
-- 4. Triggers AFTER de Auditoria (sem engolir erro: RN-14, DT-07)
-- ===========================================================================
-- Membros, células e relatórios. O momento e o autor do evento são os do carimbo (RN-13 b).
CREATE OR REPLACE FUNCTION private.audit_record_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _entity public.event_entity := private.audit_entity(TG_TABLE_NAME);
  _old jsonb;
  _new jsonb;
  _fields jsonb;
  _meta jsonb;
  _desc text;
  _kind public.author_kind;
  _mid uuid;
  _moment timestamptz;
  _spouse_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.audit_write(_entity, NEW.id, 'create', NEW.created_at, NEW.created_by_kind, NEW.created_by,
                                to_jsonb(NEW), '{}'::jsonb);
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN                                     -- DA-8: só fora da API
    SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
    PERFORM private.audit_write(_entity, OLD.id, 'delete', clock_timestamp(), _kind, _mid, to_jsonb(OLD),
                                '{}'::jsonb, '{"op": "physical_delete"}'::jsonb);
    RETURN NULL;
  END IF;

  _old := to_jsonb(OLD);
  _new := to_jsonb(NEW);
  _fields := private.audit_changes(_entity, _old, _new);
  _kind := NEW.updated_by_kind;
  _mid := NEW.updated_by;
  _moment := NEW.updated_at;
  IF _kind IS NULL OR _moment IS NULL THEN                     -- na transação do cadastro (DA-12)
    SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
    _moment := clock_timestamp();
  END IF;

  IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN            -- exclusão (E2.01)
    _meta := jsonb_build_object('op', 'soft_delete');
    IF _entity = 'member' AND (_old -> 'spouse_id') IS DISTINCT FROM (_new -> 'spouse_id') THEN
      _meta := _meta || jsonb_build_object('spouse_id',
                 jsonb_build_object('from', _old -> 'spouse_id', 'to', _new -> 'spouse_id'));
    ELSIF _entity = 'cell_report' THEN
      _meta := _meta || jsonb_build_object('cell_id', _new -> 'cell_id', 'date', _new -> 'date');
    END IF;
    PERFORM private.audit_write(_entity, NEW.id, 'delete', _moment, _kind, _mid, _new,
                                jsonb_build_object('fields', coalesce(_fields, '[]'::jsonb)), _meta);
  ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN         -- restauração (DA-7)
    _meta := jsonb_build_object('op', 'restore');
    IF _entity = 'member' THEN
      _meta := _meta || jsonb_build_object(
        'restored_without_leader', _old ->> 'leader_id' IS NOT NULL AND _new ->> 'leader_id' IS NULL,
        'previous_leader_id', _old -> 'leader_id',
        'role_reset_to_default', _old ->> 'role_id' IS NULL AND _new ->> 'role_id' IS NOT NULL);
    ELSIF _entity = 'cell_report' THEN
      _meta := _meta || jsonb_build_object('cell_id', _new -> 'cell_id', 'date', _new -> 'date');
    END IF;
    PERFORM private.audit_write(_entity, NEW.id, 'restore', _moment, _kind, _mid, _new,
                                jsonb_build_object('fields', coalesce(_fields, '[]'::jsonb)), _meta);
  ELSIF _fields IS NOT NULL THEN                                           -- alteração
    IF _entity = 'member' AND NEW.deleted_at IS NULL
       AND _old ->> 'spouse_id' IS NOT NULL AND _new ->> 'spouse_id' IS NULL THEN
      SELECT s.name INTO _spouse_name
        FROM public.members s
       WHERE s.id = (_old ->> 'spouse_id')::uuid AND s.deleted_at IS NOT NULL;
      IF FOUND THEN                                            -- cônjuge desfeito pela exclusão (E2.01)
        _desc := 'Vínculo de cônjuge desfeito pela exclusão de ' || coalesce(_spouse_name, '');
        _meta := jsonb_build_object(
          'spouse_id', jsonb_build_object('from', _old -> 'spouse_id', 'to', NULL),
          'reason', 'spouse_deleted');
      END IF;
    END IF;
    PERFORM private.audit_write(_entity, NEW.id, 'update', _moment, _kind, _mid, _new,
                                jsonb_build_object('fields', _fields), _meta, _desc);
  END IF;
  RETURN NULL;
END;
$$;

-- Participantes: entram no evento do relatório (RN-04 d, RN-13 b). Sem evento do relatório na
-- transação, é uma alteração só de participantes: o relatório é carimbado primeiro.
CREATE OR REPLACE FUNCTION private.audit_participant_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _report_id uuid;
  _member_id uuid;
  _item jsonb;
  _action public.event_action;
  _row jsonb;
  _patch jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _report_id := OLD.report_id;  _member_id := OLD.member_id;
  ELSE
    _report_id := NEW.report_id;  _member_id := NEW.member_id;
  END IF;
  _item := jsonb_build_object('id', _member_id,
                              'name', (SELECT m.name FROM public.members m WHERE m.id = _member_id));
  _patch := jsonb_build_object('toggle', jsonb_build_object('group', 'participants', 'item', _item,
                                                            'add', TG_OP = 'INSERT'));
  _action := private.audit_tx_event_action('cell_report', _report_id);

  IF _action IS NULL OR _action NOT IN ('create', 'update') THEN
    -- O carimbo do relatório (mci.audit_touch só vale para este id, nesta transação).
    PERFORM set_config('mci.audit_touch', _report_id::text, true);
    UPDATE public.cell_reports r SET updated_at = r.updated_at WHERE r.id = _report_id
    RETURNING to_jsonb(r) INTO _row;
    PERFORM set_config('mci.audit_touch', '', true);
    IF _row IS NULL THEN                                       -- relatório apagado fisicamente (fora da API)
      RETURN NULL;
    END IF;
    PERFORM private.audit_write('cell_report', _report_id, 'update', (_row ->> 'updated_at')::timestamptz,
                                (_row ->> 'updated_by_kind')::public.author_kind, (_row ->> 'updated_by')::uuid,
                                _row, _patch);
  ELSE
    SELECT to_jsonb(r) INTO _row FROM public.cell_reports r WHERE r.id = _report_id;
    PERFORM private.audit_write('cell_report', _report_id, _action, NULL, NULL, NULL, _row, _patch);
  END IF;
  RETURN NULL;
END;
$$;

-- Funções (RN-15, DT-16): criação, nome, descrição e a troca da padrão. Nada é carimbado
-- (P-AUD-01): o autor e o momento vêm da sessão e do relógio.
CREATE OR REPLACE FUNCTION private.audit_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _kind public.author_kind;
  _mid uuid;
  _fields jsonb;
  _patch jsonb := '{}'::jsonb;
  _prev uuid;
  _default jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_default AND NOT NEW.is_default THEN
    -- DA-10: a anterior não ganha evento; o id dela vai para o evento da nova padrão.
    PERFORM set_config('mci.audit_prev_default_role', OLD.id::text, true);
  END IF;

  IF NEW.is_default AND (TG_OP = 'INSERT' OR NOT OLD.is_default) THEN
    _prev := nullif(current_setting('mci.audit_prev_default_role', true), '')::uuid;
    PERFORM set_config('mci.audit_prev_default_role', '', true);
    _default := jsonb_build_object(
      'current', jsonb_build_object('id', NEW.id, 'name', NEW.name),
      'previous', CASE WHEN _prev IS NULL THEN NULL
                       ELSE jsonb_build_object('id', _prev, 'name', (SELECT r.name FROM public.roles r WHERE r.id = _prev)) END);
    _patch := jsonb_build_object('set', jsonb_build_object('default_role', _default));
  END IF;

  IF TG_OP = 'UPDATE' THEN
    _fields := private.audit_changes('role', to_jsonb(OLD), to_jsonb(NEW));
    IF _fields IS NOT NULL THEN
      _patch := _patch || jsonb_build_object('fields', _fields);
    END IF;
    IF _patch = '{}'::jsonb THEN
      RETURN NULL;                                             -- sem mudança, ou a anterior da padrão
    END IF;
  END IF;

  SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
  PERFORM private.audit_write('role', NEW.id, CASE WHEN TG_OP = 'INSERT' THEN 'create' ELSE 'update' END::public.event_action,
                              clock_timestamp(), _kind, _mid, to_jsonb(NEW), _patch);
  RETURN NULL;
END;
$$;

-- Exclusão de função: BEFORE, porque no AFTER a cascata já apagou as permissões.
CREATE OR REPLACE FUNCTION private.audit_role_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _kind public.author_kind;
  _mid uuid;
  _perms jsonb;
BEGIN
  SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
  SELECT coalesce(jsonb_agg(to_jsonb(rp.permission::text) ORDER BY rp.permission), '[]'::jsonb)
    INTO _perms
    FROM public.role_permissions rp
   WHERE rp.role_id = OLD.id;
  PERFORM private.audit_write('role', OLD.id, 'delete', clock_timestamp(), _kind, _mid, to_jsonb(OLD),
                              jsonb_build_object('set', jsonb_build_object('permissions', jsonb_build_object('all', _perms))));
  RETURN OLD;
END;
$$;

-- Permissões: entram no evento da função. Sem a função (a cascata da exclusão), nada.
CREATE OR REPLACE FUNCTION private.audit_role_permission_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _kind public.author_kind;
  _mid uuid;
  _row jsonb;
  _steps jsonb := '[]'::jsonb;
  _step jsonb;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    _steps := _steps || jsonb_build_array(jsonb_build_object('role_id', OLD.role_id, 'permission', OLD.permission::text, 'add', false));
  END IF;
  IF TG_OP IN ('UPDATE', 'INSERT') THEN
    _steps := _steps || jsonb_build_array(jsonb_build_object('role_id', NEW.role_id, 'permission', NEW.permission::text, 'add', true));
  END IF;
  FOR _step IN SELECT x FROM jsonb_array_elements(_steps) x LOOP
    SELECT to_jsonb(r) INTO _row FROM public.roles r WHERE r.id = (_step ->> 'role_id')::uuid;
    CONTINUE WHEN _row IS NULL;
    IF _kind IS NULL THEN
      SELECT a.kind, a.member_id INTO _kind, _mid FROM private.current_actor() a;
    END IF;
    PERFORM private.audit_write('role', (_step ->> 'role_id')::uuid, 'update', clock_timestamp(), _kind, _mid, _row,
              jsonb_build_object('toggle', jsonb_build_object('group', 'permissions',
                                                              'item', _step -> 'permission',
                                                              'add', (_step ->> 'add')::boolean)));
  END LOOP;
  RETURN NULL;
END;
$$;

-- ===========================================================================
-- 5. Triggers: saem os antigos, entram os novos (as listas vêm de private.audit_fields)
-- ===========================================================================
DROP TRIGGER IF EXISTS trg_log_member_event ON public.members;
DROP TRIGGER IF EXISTS trg_log_cell_event ON public.cells;
DROP TRIGGER IF EXISTS trg_log_cell_report_event ON public.cell_reports;
DROP TRIGGER IF EXISTS trg_log_cell_report_participant_event ON public.cell_report_participants;
DROP TRIGGER IF EXISTS update_members_updated_at ON public.members;
DROP TRIGGER IF EXISTS update_cell_reports_updated_at ON public.cell_reports;
DROP TRIGGER IF EXISTS update_cells_updated_at ON public.cells;
DROP FUNCTION IF EXISTS public._trg_log_member_event();
DROP FUNCTION IF EXISTS public._trg_log_cell_event();
DROP FUNCTION IF EXISTS public._trg_log_cell_report_event();
DROP FUNCTION IF EXISTS public._trg_log_cell_report_participant_event();

DO $$
DECLARE
  _t record;
  _fields text;
  _authorship constant text :=
    'deleted_at, deleted_by, created_at, created_by, created_by_kind, created_by_legacy, '
    'updated_at, updated_by, updated_by_kind, updated_by_legacy, deleted_by_kind, deleted_by_legacy';
BEGIN
  FOR _t IN SELECT * FROM (VALUES ('members', 'member'), ('cells', 'cell'), ('cell_reports', 'cell_report')) v (tbl, entity) LOOP
    SELECT string_agg(quote_ident(f.field), ', ' ORDER BY f.position) INTO _fields
      FROM private.audit_fields f
     WHERE f.entity = _t.entity::public.event_entity;
    EXECUTE format('DROP TRIGGER IF EXISTS zz_stamp_authorship ON public.%I', _t.tbl);
    EXECUTE format('CREATE TRIGGER zz_stamp_authorship BEFORE INSERT OR UPDATE OF %s, %s ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION private.stamp_authorship()', _fields, _authorship, _t.tbl);
    EXECUTE format('DROP TRIGGER IF EXISTS aa_audit_record ON public.%I', _t.tbl);
    EXECUTE format('CREATE TRIGGER aa_audit_record AFTER INSERT OR DELETE OR UPDATE OF %s, deleted_at ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION private.audit_record_change()', _fields, _t.tbl);
  END LOOP;
END;
$$;

DROP TRIGGER IF EXISTS aa_audit_participant ON public.cell_report_participants;
CREATE TRIGGER aa_audit_participant
  AFTER INSERT OR DELETE ON public.cell_report_participants
  FOR EACH ROW EXECUTE FUNCTION private.audit_participant_change();

DROP TRIGGER IF EXISTS aa_audit_role ON public.roles;
CREATE TRIGGER aa_audit_role
  AFTER INSERT OR UPDATE OF name, description, is_default ON public.roles
  FOR EACH ROW EXECUTE FUNCTION private.audit_role_change();

DROP TRIGGER IF EXISTS zz_audit_role_delete ON public.roles;
CREATE TRIGGER zz_audit_role_delete
  BEFORE DELETE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION private.audit_role_delete();

DROP TRIGGER IF EXISTS aa_audit_role_permission ON public.role_permissions;
CREATE TRIGGER aa_audit_role_permission
  AFTER INSERT OR UPDATE OR DELETE ON public.role_permissions
  FOR EACH ROW EXECUTE FUNCTION private.audit_role_permission_change();

-- ===========================================================================
-- 6. _log_event (E1.13, E1.04, E2.03): actor_kind, e só para postgres (RN-16, DT-13)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public._log_event(
  _action public.event_action,
  _entity public.event_entity,
  _entity_id uuid,
  _entity_label text,
  _description text,
  _changed_fields text[] DEFAULT NULL::text[],
  _metadata jsonb DEFAULT NULL::jsonb,
  _success boolean DEFAULT true,
  _error_reason text DEFAULT NULL::text,
  _actor_user_id uuid DEFAULT NULL::uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _actor uuid;
  _actor_label text;
BEGIN
  _actor := COALESCE(_actor_user_id, auth.uid());
  IF _actor IS NOT NULL THEN
    SELECT name INTO _actor_label FROM public.members WHERE auth_user_id = _actor LIMIT 1;
  END IF;

  INSERT INTO public.events (
    actor_user_id, actor_label, actor_kind, action, entity, entity_id, entity_label,
    description, changed_fields, metadata, success, error_reason
  ) VALUES (
    _actor, _actor_label,
    CASE WHEN _actor IS NOT NULL THEN 'member'
         WHEN _entity = 'auth' THEN 'none'
         ELSE 'system' END::public.event_actor_kind,
    _action, _entity, _entity_id, _entity_label,
    _description, _changed_fields, _metadata, _success, _error_reason
  );
END;
$function$;
REVOKE ALL ON FUNCTION public._log_event(public.event_action, public.event_entity, uuid, text, text, text[], jsonb, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 7. Participantes: a trava do relatório passa a FOR NO KEY UPDATE (DT-09)
-- ===========================================================================
-- O corpo é o do E2.01; só a trava do relatório muda. Agora a mudança de participante altera o
-- relatório (carimbo), e pegar a trava forte já no começo evita trocar de trava no meio.
CREATE OR REPLACE FUNCTION public.enforce_participant_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
   FOR NO KEY UPDATE;

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
$function$;

-- ===========================================================================
-- 8. save_cell_report (DT-09): relatório e participantes numa transação
-- ===========================================================================
-- SECURITY INVOKER: valem o RLS e os triggers de hoje, sem regra nova de permissão. Mínima de
-- propósito; o E2.11 a absorve, com o mesmo nome e o mesmo retorno. Só as chaves presentes em
-- _report são gravadas (as ausentes ficam com o padrão da coluna no envio e como estão na
-- alteração); outras chaves são ignoradas. _participant_ids é o conjunto final; nulo não mexe.
-- changed: o envio, ou a alteração que mudou algum dado (o updated_at mudou; AQ-7).
CREATE OR REPLACE FUNCTION public.save_cell_report(
  _report_id uuid,
  _report jsonb,
  _participant_ids uuid[] DEFAULT NULL)
RETURNS TABLE (report_id uuid, changed boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _in jsonb := CASE WHEN jsonb_typeof(_report) = 'object' THEN _report ELSE '{}'::jsonb END;
  _r public.cell_reports;
  _cols text[];
  _id uuid;
  _before timestamptz;
  _after timestamptz;
BEGIN
  BEGIN
    _r := jsonb_populate_record(NULL::public.cell_reports, _in);
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow
                 OR numeric_value_out_of_range OR invalid_parameter_value THEN
    RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
      MESSAGE = 'Os dados do relatório estão em formato inválido.',
      DETAIL  = '{"code": "invalid_input", "entity": "cell_report"}';
  END;
  _cols := ARRAY(SELECT u.k
                   FROM unnest(ARRAY['cell_id', 'date', 'time', 'was_held', 'reason_not_held', 'theme',
                                     'observations', 'visitors', 'offering']) WITH ORDINALITY u (k, o)
                  WHERE _in ? u.k
                  ORDER BY u.o);

  IF _report_id IS NULL THEN
    IF NOT (_in ? 'cell_id') OR _r.cell_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Escolha a célula do relatório.',
        DETAIL  = '{"code": "cell_required", "field": "cell_id", "entity": "cell_report"}';
    END IF;
    EXECUTE format('INSERT INTO public.cell_reports (%s) VALUES (%s) RETURNING id',
                   (SELECT string_agg(quote_ident(k), ', ') FROM unnest(_cols) k),
                   (SELECT string_agg(format('($1).%I', k), ', ') FROM unnest(_cols) k))
       INTO _id
      USING _r;
  ELSE
    -- Trava primeiro o relatório (ordem global) e guarda a versão de antes.
    SELECT c.updated_at INTO _before
      FROM public.cell_reports c
     WHERE c.id = _report_id
       FOR NO KEY UPDATE;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM public.cell_reports c WHERE c.id = _report_id) THEN
        RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION USING ERRCODE = '22023', HINT = 'app_error',
        MESSAGE = 'Este relatório não existe ou já foi excluído.',
        DETAIL  = '{"code": "not_found_or_deleted", "entity": "cell_report"}';
    END IF;
    _id := _report_id;
    IF cardinality(_cols) > 0 THEN
      EXECUTE format('UPDATE public.cell_reports c SET %s WHERE c.id = $2 RETURNING c.id',
                     (SELECT string_agg(format('%1$I = ($1).%1$I', k), ', ') FROM unnest(_cols) k))
         INTO _id
        USING _r, _report_id;
      IF _id IS NULL THEN
        RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF _participant_ids IS NOT NULL THEN
    PERFORM public.set_cell_report_participants(_id, _participant_ids);
  END IF;

  SELECT c.updated_at INTO _after FROM public.cell_reports c WHERE c.id = _id;
  RETURN QUERY SELECT _id, (_report_id IS NULL OR _after IS DISTINCT FROM _before);
END;
$$;
REVOKE ALL ON FUNCTION public.save_cell_report(uuid, jsonb, uuid[]) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.save_cell_report(uuid, jsonb, uuid[]) TO authenticated;

-- ===========================================================================
-- 9. Carga do legado (RN-10, RN-11, DA-4, DT-17)
-- ===========================================================================
-- A carga (E4.06) roda em replica e grava as colunas de autoria direto, com esta função. As
-- horas do legado já são de Brasília (timestamp sem fuso).
CREATE OR REPLACE FUNCTION private.legacy_authorship(
  _created_by text, _created_on timestamp, _updated_by text, _updated_on timestamp,
  _is_deleted boolean, _load_time timestamptz)
RETURNS TABLE (created_at timestamptz, created_by_kind public.author_kind, created_by_legacy text,
               updated_at timestamptz, updated_by_kind public.author_kind, updated_by_legacy text,
               deleted_at timestamptz, deleted_by_kind public.author_kind, deleted_by_legacy text)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  _cb text := nullif(btrim(_created_by), '');
  _ub text := nullif(btrim(_updated_by), '');
BEGIN
  created_at := _created_on AT TIME ZONE 'America/Sao_Paulo';
  created_by_kind := CASE WHEN _cb IS NULL THEN 'unknown' ELSE 'legacy' END;
  created_by_legacy := _cb;

  IF _updated_on IS NULL                                       -- DA-4: sem alteração
     OR (_ub IS NOT DISTINCT FROM _cb                          -- RN-10 (c): o próprio cadastro
         AND _created_on IS NOT NULL
         AND _updated_on >= _created_on
         AND _updated_on <= _created_on + interval '1 minute') THEN
    updated_at := NULL;  updated_by_kind := NULL;  updated_by_legacy := NULL;
  ELSE
    updated_at := _updated_on AT TIME ZONE 'America/Sao_Paulo';
    updated_by_kind := CASE WHEN _ub IS NULL THEN 'unknown' ELSE 'legacy' END;
    updated_by_legacy := _ub;
  END IF;

  IF coalesce(_is_deleted, false) THEN                         -- RN-11
    deleted_at := coalesce(coalesce(_updated_on, _created_on) AT TIME ZONE 'America/Sao_Paulo', _load_time);
    deleted_by_kind := CASE WHEN _ub IS NULL THEN 'unknown' ELSE 'legacy' END;
    deleted_by_legacy := _ub;
  END IF;
  RETURN NEXT;
END;
$$;

-- ===========================================================================
-- Privilégios: as internas sem grant nenhum
-- ===========================================================================
DO $$
DECLARE
  _f regprocedure;
BEGIN
  FOR _f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
     WHERE p.pronamespace = 'private'::regnamespace
       AND p.proname IN ('current_actor', 'audit_entity', 'audit_has_changes', 'audit_ref_name', 'audit_changes',
                         'audit_merge_fields', 'audit_toggle', 'audit_list_has', 'audit_list_without',
                         'audit_field_keys', 'audit_base_changes', 'audit_text', 'audit_tx_event',
                         'audit_tx_event_action', 'audit_write', 'stamp_authorship', 'audit_record_change',
                         'audit_participant_change', 'audit_role_change', 'audit_role_delete',
                         'audit_role_permission_change', 'legacy_authorship')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', _f);
  END LOOP;
END;
$$;
