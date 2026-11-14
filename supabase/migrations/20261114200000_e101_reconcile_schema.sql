-- E1.01 — Reconcilia o schema gerado pelas migrations (aplicadas do zero) com o
-- que o app espera. Ver docs/migracao.md (passo E1.01) no repositório apps-mci.
--
-- Aplicadas em ordem num banco zerado, as migrations anteriores deixam:
--   1. cell_reports.visitors como jsonb (o front e o types.ts usam lista de textos);
--   2. políticas antigas de 20260326193800 somando com as novas (permissivas = OR),
--      o que libera, por exemplo, edit_cell para qualquer operação em participantes;
--   3. dois triggers de cônjuge ativos ao mesmo tempo, com guardas diferentes;
--   4. auditoria de células, relatórios e participantes quebrada: as funções usam
--      cells.name (removida em 20260326040000) e participants.id (a tabela usa
--      chave composta). As falhas eram engolidas com WARNING e nada era gravado.

-- ---------------------------------------------------------------------------
-- 1. cell_reports.visitors: jsonb -> text[]
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.e101_jsonb_to_text_array(_value jsonb)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _value IS NULL THEN NULL
    WHEN jsonb_typeof(_value) = 'array' THEN ARRAY(SELECT jsonb_array_elements_text(_value))
    ELSE ARRAY[]::text[]
  END
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cell_reports'
      AND column_name = 'visitors' AND data_type = 'jsonb'
  ) THEN
    ALTER TABLE public.cell_reports ALTER COLUMN visitors DROP DEFAULT;
    ALTER TABLE public.cell_reports
      ALTER COLUMN visitors TYPE text[]
      USING pg_temp.e101_jsonb_to_text_array(visitors);
  END IF;
END $$;

ALTER TABLE public.cell_reports ALTER COLUMN visitors SET DEFAULT '{}'::text[];

-- ---------------------------------------------------------------------------
-- 2. Políticas antigas de 20260326193800, substituídas pelas de
--    20260330180540, 20260403142708 e 20260403184252
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users with view_members can view cell_reports" ON public.cell_reports;
DROP POLICY IF EXISTS "Users with create_cell can insert cell_reports" ON public.cell_reports;
DROP POLICY IF EXISTS "Users with edit_cell can update cell_reports" ON public.cell_reports;
DROP POLICY IF EXISTS "Users with delete_cell can delete cell_reports" ON public.cell_reports;
DROP POLICY IF EXISTS "Users with view_members can view cell_report_participants" ON public.cell_report_participants;
DROP POLICY IF EXISTS "Users with create_cell can insert cell_report_participants" ON public.cell_report_participants;
DROP POLICY IF EXISTS "Users with edit_cell can update/delete cell_report_participants" ON public.cell_report_participants;

-- ---------------------------------------------------------------------------
-- 3. Cônjuge: fica só sync_spouse_relationship (20260426175140).
--    A exclusão é coberta pela FK spouse_id ON DELETE SET NULL.
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_member_spouse_change ON public.members;
DROP FUNCTION IF EXISTS public.sync_spouse_trigger();

-- ---------------------------------------------------------------------------
-- 4. Auditoria sem cells.name e sem participants.id
--    Uma célula é identificada pelo líder: "célula de <nome do líder>".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._cell_label_by_leader(_leader_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'célula de ' || COALESCE(
    (SELECT m.name FROM public.members m WHERE m.id = _leader_id),
    'líder não informado'
  )
$$;

REVOKE ALL ON FUNCTION public._cell_label_by_leader(uuid) FROM PUBLIC, anon, authenticated;

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
$$;

CREATE OR REPLACE FUNCTION public._trg_log_cell_report_participant_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _member_name text;
  _leader_id uuid;
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
  SELECT c.leader_id, cr.date INTO _leader_id, _date
    FROM public.cell_reports cr
    JOIN public.cells c ON c.id = cr.cell_id
    WHERE cr.id = _row_report_id;

  _label := 'relatório da ' || public._cell_label_by_leader(_leader_id)
    || ' em ' || COALESCE(_date::text, '');
  _meta  := jsonb_build_object('report_id', _row_report_id, 'member_id', _row_member_id);

  -- A tabela de participantes usa chave composta: o evento aponta para o relatório.
  IF TG_OP = 'INSERT' THEN
    _desc := 'Adicionou ' || COALESCE(_member_name, 'um membro') || ' ao ' || _label;
    PERFORM public._log_event('create','cell_report_participant',_row_report_id,_label,_desc,NULL,_meta);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    _desc := 'Removeu ' || COALESCE(_member_name, 'um membro') || ' do ' || _label;
    PERFORM public._log_event('delete','cell_report_participant',_row_report_id,_label,_desc,NULL,_meta);
    RETURN OLD;
  END IF;

  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'log cell_report_participant event failed: %', SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;
