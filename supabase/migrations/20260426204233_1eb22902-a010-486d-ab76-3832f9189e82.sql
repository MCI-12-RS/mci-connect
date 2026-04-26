-- =========================================================
-- 1. ENUMS (event_action, event_entity)
-- =========================================================
DO $$ BEGIN
  CREATE TYPE public.event_action AS ENUM (
    'create', 'update', 'delete',
    'login', 'login_failed', 'logout',
    'password_changed'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_entity AS ENUM (
    'member', 'cell', 'cell_report', 'cell_report_participant', 'auth'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- 2. TABLE
-- =========================================================
CREATE TABLE IF NOT EXISTS public.events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,
  actor_label    text,
  action         public.event_action NOT NULL,
  entity         public.event_entity NOT NULL,
  entity_id      uuid,
  entity_label   text,
  description    text NOT NULL,
  changed_fields text[],
  metadata       jsonb,
  success        boolean NOT NULL DEFAULT true,
  error_reason   text
);

CREATE INDEX IF NOT EXISTS events_occurred_at_idx ON public.events (occurred_at DESC);
CREATE INDEX IF NOT EXISTS events_entity_idx      ON public.events (entity, entity_id);
CREATE INDEX IF NOT EXISTS events_actor_idx       ON public.events (actor_user_id);
CREATE INDEX IF NOT EXISTS events_action_idx      ON public.events (action);

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Events view policy" ON public.events;
CREATE POLICY "Events view policy" ON public.events
  FOR SELECT TO authenticated
  USING (public.user_has_permission(auth.uid(), 'view_audit_log'));
-- No INSERT/UPDATE/DELETE policies => blocked for all roles.

-- =========================================================
-- 3. HELPERS
-- =========================================================
CREATE OR REPLACE FUNCTION public._mask_identifier(_id text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  _digits text;
BEGIN
  IF _id IS NULL OR length(_id) = 0 THEN RETURN NULL; END IF;

  IF position('@' IN _id) > 0 THEN
    RETURN substring(_id FROM 1 FOR 1) || '***@' || split_part(_id, '@', 2);
  END IF;

  _digits := regexp_replace(_id, '\D', '', 'g');
  IF length(_digits) = 11 THEN
    RETURN '***' || right(_digits, 4);
  END IF;

  RETURN left(_id, 1) || repeat('*', greatest(length(_id) - 2, 1)) || right(_id, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public._log_event(
  _action public.event_action,
  _entity public.event_entity,
  _entity_id uuid,
  _entity_label text,
  _description text,
  _changed_fields text[] DEFAULT NULL,
  _metadata jsonb DEFAULT NULL,
  _success boolean DEFAULT true,
  _error_reason text DEFAULT NULL,
  _actor_user_id uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor uuid;
  _actor_label text;
BEGIN
  _actor := COALESCE(_actor_user_id, auth.uid());
  IF _actor IS NOT NULL THEN
    SELECT name INTO _actor_label FROM public.members WHERE auth_user_id = _actor LIMIT 1;
  END IF;

  INSERT INTO public.events (
    actor_user_id, actor_label, action, entity, entity_id, entity_label,
    description, changed_fields, metadata, success, error_reason
  ) VALUES (
    _actor, _actor_label, _action, _entity, _entity_id, _entity_label,
    _description, _changed_fields, _metadata, _success, _error_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public._log_event(
  public.event_action, public.event_entity, uuid, text, text,
  text[], jsonb, boolean, text, uuid
) FROM PUBLIC;

-- =========================================================
-- 4. AUTH RPC
-- =========================================================
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
BEGIN
  IF _action NOT IN ('login', 'login_failed', 'logout') THEN
    RAISE EXCEPTION 'Invalid action for log_auth_event';
  END IF;

  PERFORM public._log_event(
    _action      => _action,
    _entity      => 'auth'::public.event_entity,
    _entity_id   => auth.uid(),
    _entity_label=> NULL,
    _description => CASE _action
      WHEN 'login'        THEN 'Login realizado'
      WHEN 'login_failed' THEN 'Falha no login'
      WHEN 'logout'       THEN 'Logout realizado'
      ELSE 'Evento de autenticação'
    END,
    _metadata    => jsonb_strip_nulls(jsonb_build_object(
                      'identifier_masked', public._mask_identifier(_identifier),
                      'reason', _reason
                    )),
    _success     => _success,
    _error_reason=> _reason,
    _actor_user_id => auth.uid()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_auth_event(
  public.event_action, boolean, text, text
) TO anon, authenticated;

-- =========================================================
-- 5. TRIGGER - members
-- =========================================================
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
$$;

DROP TRIGGER IF EXISTS trg_log_member_event ON public.members;
CREATE TRIGGER trg_log_member_event
AFTER INSERT OR UPDATE OR DELETE ON public.members
FOR EACH ROW EXECUTE FUNCTION public._trg_log_member_event();

-- =========================================================
-- 6. TRIGGER - cells
-- =========================================================
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
    'name','type','leader_id','timothy_id','host_id','is_active',
    'meeting_day','meeting_time','neighborhood','city'
  ];
  _f text;
  _old_v text;
  _new_v text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _label := NEW.name;
    _desc  := 'Criou a célula ' || COALESCE(NEW.name, '');
    _meta := jsonb_strip_nulls(jsonb_build_object(
      'name', NEW.name, 'type', NEW.type,
      'leader_id', NEW.leader_id, 'timothy_id', NEW.timothy_id,
      'host_id', NEW.host_id, 'is_active', NEW.is_active
    ));
    PERFORM public._log_event('create','cell',NEW.id,_label,_desc,NULL,_meta);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    _label := NEW.name;
    FOREACH _f IN ARRAY _whitelist LOOP
      EXECUTE format('SELECT ($1).%I::text, ($2).%I::text', _f, _f)
        INTO _old_v, _new_v USING OLD, NEW;
      IF _old_v IS DISTINCT FROM _new_v THEN
        _changed := _changed || _f;
        _meta := _meta || jsonb_build_object(_f, jsonb_build_object('from', _old_v, 'to', _new_v));
      END IF;
    END LOOP;

    IF array_length(_changed, 1) IS NULL THEN RETURN NEW; END IF;

    _desc := 'Atualizou a célula ' || COALESCE(NEW.name, '');
    PERFORM public._log_event('update','cell',NEW.id,_label,_desc,_changed,_meta);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    _label := OLD.name;
    _desc  := 'Removeu a célula ' || COALESCE(OLD.name, '');
    _meta := jsonb_strip_nulls(jsonb_build_object(
      'name', OLD.name, 'leader_id', OLD.leader_id
    ));
    PERFORM public._log_event('delete','cell',OLD.id,_label,_desc,NULL,_meta);
    RETURN OLD;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'log cell event failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_cell_event ON public.cells;
CREATE TRIGGER trg_log_cell_event
AFTER INSERT OR UPDATE OR DELETE ON public.cells
FOR EACH ROW EXECUTE FUNCTION public._trg_log_cell_event();

-- =========================================================
-- 7. TRIGGER - cell_reports
-- =========================================================
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
  _cell_name text;
  _whitelist text[] := ARRAY['date','was_held','offering','theme','reason_not_held'];
  _f text;
  _old_v text;
  _new_v text;
  _row_cell_id uuid;
  _row_date date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _row_cell_id := OLD.cell_id; _row_date := OLD.date;
  ELSE
    _row_cell_id := NEW.cell_id; _row_date := NEW.date;
  END IF;

  SELECT name INTO _cell_name FROM public.cells WHERE id = _row_cell_id;
  _label := 'Relatório de ' || COALESCE(_cell_name, 'célula') || ' em ' || _row_date::text;

  IF TG_OP = 'INSERT' THEN
    _desc := 'Registrou ' || _label;
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

    _desc := 'Atualizou ' || _label;
    PERFORM public._log_event('update','cell_report',NEW.id,_label,_desc,_changed,_meta);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    _desc := 'Removeu ' || _label;
    _meta := jsonb_strip_nulls(jsonb_build_object(
      'cell_id', OLD.cell_id, 'date', OLD.date
    ));
    PERFORM public._log_event('delete','cell_report',OLD.id,_label,_desc,NULL,_meta);
    RETURN OLD;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'log cell_report event failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_cell_report_event ON public.cell_reports;
CREATE TRIGGER trg_log_cell_report_event
AFTER INSERT OR UPDATE OR DELETE ON public.cell_reports
FOR EACH ROW EXECUTE FUNCTION public._trg_log_cell_report_event();

-- =========================================================
-- 8. TRIGGER - cell_report_participants
-- =========================================================
CREATE OR REPLACE FUNCTION public._trg_log_cell_report_participant_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _member_name text;
  _cell_name text;
  _date date;
  _label text;
  _desc text;
  _meta jsonb;
  _row_member_id uuid;
  _row_report_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _row_member_id := OLD.member_id; _row_report_id := OLD.report_id;
  ELSE
    _row_member_id := NEW.member_id; _row_report_id := NEW.report_id;
  END IF;

  SELECT name INTO _member_name FROM public.members WHERE id = _row_member_id;
  SELECT c.name, cr.date INTO _cell_name, _date
    FROM public.cell_reports cr
    JOIN public.cells c ON c.id = cr.cell_id
    WHERE cr.id = _row_report_id;

  _label := 'Relatório de ' || COALESCE(_cell_name, 'célula') || ' em ' || COALESCE(_date::text, '');
  _meta  := jsonb_build_object('report_id', _row_report_id, 'member_id', _row_member_id);

  IF TG_OP = 'INSERT' THEN
    _desc := 'Adicionou ' || COALESCE(_member_name,'um membro') || ' ao ' || _label;
    PERFORM public._log_event('create','cell_report_participant',NEW.id,_label,_desc,NULL,_meta);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    _desc := 'Removeu ' || COALESCE(_member_name,'um membro') || ' do ' || _label;
    PERFORM public._log_event('delete','cell_report_participant',OLD.id,_label,_desc,NULL,_meta);
    RETURN OLD;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'log cell_report_participant event failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_log_cell_report_participant_event ON public.cell_report_participants;
CREATE TRIGGER trg_log_cell_report_participant_event
AFTER INSERT OR DELETE ON public.cell_report_participants
FOR EACH ROW EXECUTE FUNCTION public._trg_log_cell_report_participant_event();

-- =========================================================
-- 9. Grant view_audit_log to admin role(s)
-- =========================================================
INSERT INTO public.role_permissions (role_id, permission)
SELECT DISTINCT rp.role_id, 'view_audit_log'::public.permission_action
FROM public.role_permissions rp
WHERE rp.permission = 'manage_roles'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp2
    WHERE rp2.role_id = rp.role_id
      AND rp2.permission = 'view_audit_log'
  );