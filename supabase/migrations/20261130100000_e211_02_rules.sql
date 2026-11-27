-- E2.11 (PR 2, migration 2 de 3) — Regras do lançamento e da edição num lugar só e as leituras da tela.
-- Ver docs/specs/e2-11-lancamento-relatorio.md no repositório apps-mci ("Conferência antes de preencher
-- e contexto da edição (migration 2)", "Regras (migration 2)", "Formato dos erros (AQ-2)"; RN-04 a RN-09,
-- RN-12, RN-13, RN-16, RN-18, RN-19; DT-07, DT-08, DT-13, DT-14, DT-16).
--
-- Só funções e leituras: nenhuma gravação muda aqui (a migration 3 fecha a escrita direta).
--   0. Guarda de pré-requisitos (o PR 1 do E2.11 em produção).
--   1. Enums report_launch_status (a conferência) e report_submit_outcome (o lançamento).
--   2. Funções puras em private (sem grants; recebem o "agora" local e não leem tabela; a tabela de casos
--      supabase/tests/fixtures/report-rules-cases.json gera o pgTAP e211_02_cases):
--      report_limits, report_meeting_at, report_launch_rule, report_edit_rule, report_launch_status,
--      report_launch_dates, report_edit_dates.
--   3. private.report_input: a entrada normalizada (nunca recusa), a mesma para a validação e para a
--      comparação da repetição (DT-06).
--   4. private.report_message e private.report_raise: o único lugar com os textos do banco deste passo.
--   5. public.cell_report_launch_check(_cell_id) e public.cell_report_edit_context(_report_id): só leitura,
--      definer, com o relatório da semana só para quem o vê (DT-13).
--
-- "Agora" é sp_local(now()): o início da transação, em America/Sao_Paulo (DT-08). As mensagens das guardas
-- trazem só ids e nomes de regra (os logs do Actions são públicos). Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.viewer_sees_report_people(uuid,uuid,uuid)') IS NULL      -- E2.11 PR 1
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.cell_reports'::regclass
                     AND attname = 'snapshot_leader_id' AND NOT attisdropped)
     OR to_regprocedure('public._del_raise(text,text,jsonb)') IS NULL                 -- E2.01
     OR to_regprocedure('public._del_lock_cell_week(uuid,date)') IS NULL
     OR to_regprocedure('public.normalize_meeting_time(time without time zone)') IS NULL   -- E2.08
     OR to_regprocedure('public.is_valid_meeting_time(time without time zone)') IS NULL
     OR to_regprocedure('public.weekday_index(text)') IS NULL
     OR to_regprocedure('public.sp_local(timestamp with time zone)') IS NULL          -- E2.09
     OR to_regprocedure('private.current_actor()') IS NULL THEN                       -- E2.05
    RAISE EXCEPTION 'E2.11 PR 2 depende do E2.11 PR 1, do E2.01, do E2.05, do E2.08 e do E2.09.';
  END IF;
END $$;

-- ===========================================================================
-- 1. Enums
-- ===========================================================================
DO $$ BEGIN
  CREATE TYPE public.report_launch_status AS ENUM
    ('can_submit', 'already_sent', 'not_yet', 'cell_inactive', 'cell_deleted',
     'not_found', 'not_allowed', 'no_permission');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.report_submit_outcome AS ENUM ('created', 'replayed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 2. Regras puras
-- ===========================================================================
-- Lista única dos limites (DA-4, DA-5; RN-10, RN-12). A tabela de casos repete os valores, e o pgTAP
-- gerado confere.
CREATE OR REPLACE FUNCTION private.report_limits(
  OUT theme integer, OUT reason integer, OUT observations integer, OUT visitor_name integer,
  OUT visitors integer, OUT participants integer, OUT offering_max numeric)
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$ SELECT 300, 2000, 4000, 150, 1000, 1000, 999999.99::numeric $$;

-- Reunião da semana (RN-06): o dia e o horário atuais da célula na semana de referência (0 = domingo).
CREATE OR REPLACE FUNCTION private.report_meeting_at(_week_start date, _weekday integer, _meeting_time time)
RETURNS timestamp
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$ SELECT (_week_start + _weekday) + _meeting_time $$;

-- Lançamento (RN-04 a RN-07, RN-09), itens 4 a 8 da RN-20, nesta ordem: o primeiro código, ou nulo.
-- Em "Não houve célula", a data e o horário finais são os da reunião. A reunião é comparada no segundo
-- (às 19:59:59 a das 20:00 ainda não aconteceu) e o futuro no minuto (o próprio minuto é aceito; DT-08).
CREATE OR REPLACE FUNCTION private.report_launch_rule(
  _now_local timestamp, _meeting_at timestamp, _held boolean, _date date, _time time,
  _week_has_report boolean, OUT code text, OUT final_date date, OUT final_time time)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
DECLARE
  _ws date := public.week_start(_now_local::date);
BEGIN
  final_date := CASE WHEN _held THEN _date ELSE _meeting_at::date END;
  final_time := CASE WHEN _held THEN _time ELSE _meeting_at::time END;
  IF final_date NOT BETWEEN _ws AND _ws + 6 THEN
    code := 'report_not_current_week';                                        -- 4 (RN-04)
  ELSIF _week_has_report THEN
    code := 'report_week_taken';                                              -- 5 (RN-07)
  ELSIF _now_local < _meeting_at THEN
    code := 'meeting_not_yet';                                                -- 6 (RN-06)
  ELSIF final_date + final_time > date_trunc('minute', _now_local) THEN
    code := 'report_in_future';                                               -- 7 (RN-05)
  ELSIF final_date + final_time < _meeting_at THEN
    code := 'report_before_meeting';                                          -- 8 (RN-06)
  END IF;
END $$;

-- Edição (RN-05, RN-16): a semana do relatório e, se a data ou o horário mudaram, o futuro.
CREATE OR REPLACE FUNCTION private.report_edit_rule(
  _now_local timestamp, _stored_date date, _date date, _time time, _moment_changed boolean)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE
    WHEN _date NOT BETWEEN public.week_start(_stored_date) AND public.week_start(_stored_date) + 6
      THEN 'report_week_locked'
    WHEN _moment_changed AND _date + _time > date_trunc('minute', _now_local)
      THEN 'report_in_future'
  END
$$;

-- Situação da conferência pela semana (RN-19, os três últimos degraus da precedência): a semana já tem
-- relatório (a) vem antes de a reunião não ter acontecido (b).
CREATE OR REPLACE FUNCTION private.report_launch_status(_now_local timestamp, _meeting_at timestamp,
                                                        _week_has_report boolean)
RETURNS public.report_launch_status
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE WHEN _week_has_report THEN 'already_sent'::public.report_launch_status
              WHEN _now_local < _meeting_at THEN 'not_yet'::public.report_launch_status
              ELSE 'can_submit'::public.report_launch_status END
$$;

-- Datas aceitas no lançamento (P-REL-22): da reunião da semana até hoje; vazia antes da reunião.
CREATE OR REPLACE FUNCTION private.report_launch_dates(_now_local timestamp, _meeting_at timestamp)
RETURNS date[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE WHEN _now_local < _meeting_at THEN '{}'::date[]
              ELSE ARRAY(SELECT d::date
                           FROM pg_catalog.generate_series(_meeting_at::date, _now_local::date, interval '1 day') d
                          ORDER BY d)
         END
$$;

-- Datas aceitas na edição (RN-16, P-REL-22): da semana do relatório até o sábado dela ou até hoje.
CREATE OR REPLACE FUNCTION private.report_edit_dates(_now_local timestamp, _stored_date date)
RETURNS date[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT ARRAY(SELECT d::date
                 FROM pg_catalog.generate_series(public.week_start(_stored_date),
                                                 LEAST(public.week_start(_stored_date) + 6, _now_local::date),
                                                 interval '1 day') d
                ORDER BY d)
$$;

REVOKE ALL ON FUNCTION private.report_limits() FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_meeting_at(date, integer, time) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_launch_rule(timestamp, timestamp, boolean, date, time, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_edit_rule(timestamp, date, date, time, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_launch_status(timestamp, timestamp, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_launch_dates(timestamp, timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_edit_dates(timestamp, date) FROM PUBLIC;

-- ===========================================================================
-- 3. Entrada normalizada (RN-08, RN-09, RN-12, RN-13; DT-06)
-- ===========================================================================
-- Para cada chave: se veio (has_*, para o PATCH da edição), o valor normalizado e se ele foi lido (*_ok).
-- Outras chaves (id, snapshot_*, autoria) são ignoradas. Nunca recusa: quem chama decide a mensagem.
DO $$ BEGIN
  CREATE TYPE private.report_input_t AS (
    has_cell boolean,         cell_id uuid,          cell_ok boolean,
    has_was_held boolean,     was_held boolean,      was_held_ok boolean,
    has_date boolean,         date date,             date_ok boolean,
    has_time boolean,         "time" time,           time_ok boolean,
    has_theme boolean,        theme text,
    has_reason boolean,       reason_not_held text,
    has_observations boolean, observations text,
    has_visitors boolean,     visitors text[],       visitors_ok boolean,
    has_offering boolean,     offering numeric,      offering_ok boolean);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- O valor de texto da chave, sem as pontas; vazio vira nulo (RN-08, DT-24 do E2.04).
CREATE OR REPLACE FUNCTION private.report_text(_j jsonb, _key text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$ SELECT NULLIF(pg_catalog.btrim(_j ->> _key), '') $$;

CREATE OR REPLACE FUNCTION private.report_input(_report jsonb)
RETURNS private.report_input_t
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
DECLARE
  _j jsonb := CASE WHEN pg_catalog.jsonb_typeof(_report) = 'object' THEN _report ELSE '{}'::jsonb END;
  _r private.report_input_t;
  _raw text;
  _t time;
  _v jsonb;
  _names text[] := '{}';
BEGIN
  -- Célula.
  _r.has_cell := _j ? 'cell_id';
  _r.cell_ok := true;
  _raw := private.report_text(_j, 'cell_id');
  IF _raw IS NOT NULL THEN
    BEGIN
      _r.cell_id := _raw::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      _r.cell_ok := false;
    END;
  END IF;

  -- Situação: ausente (ou nula) fica nula; quem lança assume "Célula realizada" (P-REL-21).
  _r.has_was_held := _j ? 'was_held' AND pg_catalog.jsonb_typeof(_j -> 'was_held') <> 'null';
  _r.was_held_ok := true;
  IF _r.has_was_held THEN
    BEGIN
      _r.was_held := (_j ->> 'was_held')::boolean;
    EXCEPTION WHEN invalid_text_representation THEN
      _r.was_held_ok := false;
    END;
  END IF;

  -- Data.
  _r.has_date := _j ? 'date';
  _r.date_ok := true;
  _raw := private.report_text(_j, 'date');
  IF _raw IS NOT NULL THEN
    BEGIN
      _r.date := _raw::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      _r.date_ok := false;
    END;
  END IF;

  -- Horário: sem os segundos (RN-06 do E2.08); '24:00' não é horário de reunião.
  _r.has_time := _j ? 'time';
  _r.time_ok := true;
  _raw := private.report_text(_j, 'time');
  IF _raw IS NOT NULL THEN
    BEGIN
      _t := public.normalize_meeting_time(_raw::time);
      IF public.is_valid_meeting_time(_t) THEN
        _r."time" := _t;
      ELSE
        _r.time_ok := false;
      END IF;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN
      _r.time_ok := false;
    END;
  END IF;

  -- Textos.
  _r.has_theme := _j ? 'theme';
  _r.theme := private.report_text(_j, 'theme');
  _r.has_reason := _j ? 'reason_not_held';
  _r.reason_not_held := private.report_text(_j, 'reason_not_held');
  _r.has_observations := _j ? 'observations';
  _r.observations := private.report_text(_j, 'observations');

  -- Visitantes (RN-12): espaços das pontas fora, repetidos viram um, vazios descartados, a ordem fica.
  _r.has_visitors := _j ? 'visitors';
  _r.visitors_ok := true;
  IF pg_catalog.jsonb_typeof(_j -> 'visitors') = 'array' THEN
    FOR _v IN SELECT e FROM pg_catalog.jsonb_array_elements(_j -> 'visitors') WITH ORDINALITY AS a (e, o) ORDER BY o LOOP
      IF pg_catalog.jsonb_typeof(_v) = 'string' THEN
        _raw := NULLIF(pg_catalog.regexp_replace(pg_catalog.btrim(_v #>> '{}'), '\s+', ' ', 'g'), '');
        IF _raw IS NOT NULL THEN
          _names := _names || _raw;
        END IF;
      ELSIF pg_catalog.jsonb_typeof(_v) <> 'null' THEN
        _r.visitors_ok := false;
      END IF;
    END LOOP;
    _r.visitors := _names;
  ELSIF _r.has_visitors AND pg_catalog.jsonb_typeof(_j -> 'visitors') <> 'null' THEN
    _r.visitors_ok := false;
    _r.visitors := '{}';
  ELSE
    _r.visitors := '{}';
  END IF;

  -- Oferta: numeric sem escala, para conferir as casas antes de o numeric(10,2) arredondar (DT-15).
  _r.has_offering := _j ? 'offering';
  _r.offering_ok := true;
  _raw := private.report_text(_j, 'offering');
  IF _raw IS NOT NULL THEN
    BEGIN
      _r.offering := _raw::numeric;
      IF _r.offering = 'NaN'::numeric OR _r.offering IN ('Infinity'::numeric, '-Infinity'::numeric) THEN
        _r.offering := NULL;
        _r.offering_ok := false;
      END IF;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      _r.offering_ok := false;
    END;
  END IF;
  RETURN _r;
END $$;

REVOKE ALL ON FUNCTION private.report_text(jsonb, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_input(jsonb) FROM PUBLIC;

-- ===========================================================================
-- 4. Mensagens (AQ-2, DT-14): o único lugar com os textos do banco deste passo
-- ===========================================================================
-- Os dias vêm de cell_weekdays() (E2.08) em minúsculas; as datas em dd/mm/aaaa; os horários em HH:mm.
CREATE OR REPLACE FUNCTION private.report_moment_text(_at timestamp)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT pg_catalog.lower((public.cell_weekdays())[EXTRACT(dow FROM _at)::int + 1])
         || ', ' || pg_catalog.to_char(_at, 'DD/MM/YYYY') || ', às ' || pg_catalog.to_char(_at, 'HH24:MI')
$$;

CREATE OR REPLACE FUNCTION private.report_message(_code text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$
  SELECT CASE _code
    WHEN 'cell_required' THEN 'Escolha a célula.'
    WHEN 'report_date_required' THEN 'Informe a data da reunião.'
    WHEN 'report_date_invalid' THEN 'Data inválida.'
    WHEN 'report_time_required' THEN 'Informe o horário da reunião.'
    WHEN 'report_time_invalid' THEN 'Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.'
    WHEN 'theme_required' THEN 'Informe o tema ministrado.'
    WHEN 'theme_too_long' THEN 'O tema pode ter no máximo 300 caracteres.'
    WHEN 'reason_required' THEN 'Informe o motivo de não ter havido célula.'
    WHEN 'reason_too_long' THEN 'O motivo pode ter no máximo 2000 caracteres.'
    WHEN 'was_held_invalid' THEN 'Situação inválida.'
    WHEN 'not_held_with_deleted_participant' THEN
      'Este relatório tem participante com cadastro excluído e não pode passar para "Não houve célula".'
    WHEN 'deleted_member_chosen' THEN 'Este membro foi excluído e não pode ser escolhido.'
    WHEN 'person_not_visible' THEN 'Você só pode escolher pessoas que você vê.'
    WHEN 'participant_not_found' THEN 'Participante não encontrado.'
    WHEN 'deleted_participant_removal' THEN 'Não é possível retirar um participante cujo cadastro foi excluído.'
    WHEN 'snapshot_participant_removal' THEN
      'O líder, o timóteo e o anfitrião registrados no relatório não podem ser retirados dos participantes.'
    WHEN 'too_many_participants' THEN 'Um relatório pode ter no máximo 1000 participantes.'
    WHEN 'visitors_invalid' THEN 'Visitantes inválidos. Envie uma lista de nomes.'
    WHEN 'too_many_visitors' THEN 'Um relatório pode ter no máximo 1000 visitantes.'
    WHEN 'visitor_name_too_long' THEN 'Cada visitante pode ter no máximo 150 caracteres.'
    WHEN 'offering_required' THEN 'Informe a oferta. Se não houve oferta, informe R$ 0,00.'
    WHEN 'offering_negative' THEN 'A oferta não pode ser negativa.'
    WHEN 'offering_invalid' THEN 'Oferta inválida. Informe um valor em reais, com até 2 casas decimais.'
    WHEN 'offering_too_large' THEN 'A oferta pode ser de no máximo R$ 999.999,99.'
    WHEN 'observations_too_long' THEN 'As observações podem ter no máximo 4000 caracteres.'
    WHEN 'report_cell_immutable' THEN 'A célula de um relatório não pode ser trocada.'
    WHEN 'report_week_locked' THEN
      'Na edição, a data só pode mudar dentro da semana do relatório, de '
      || pg_catalog.to_char((_detail ->> 'week_start')::date, 'DD/MM/YYYY') || ' a '
      || pg_catalog.to_char((_detail ->> 'week_end')::date, 'DD/MM/YYYY') || '.'
    WHEN 'report_not_current_week' THEN
      'O relatório precisa ser da semana atual, de '
      || pg_catalog.to_char((_detail ->> 'week_start')::date, 'DD/MM/YYYY') || ' a '
      || pg_catalog.to_char((_detail ->> 'week_end')::date, 'DD/MM/YYYY') || '.'
    WHEN 'report_week_taken' THEN 'O relatório para esta semana já foi enviado.'
    WHEN 'meeting_not_yet' THEN
      'A reunião desta semana ainda não aconteceu. O relatório pode ser enviado a partir de '
      || private.report_moment_text((_detail ->> 'meeting_at')::timestamp) || '.'
    WHEN 'report_in_future' THEN 'O relatório não pode ser enviado para uma data ou horário futuros.'
    WHEN 'report_before_meeting' THEN
      'O relatório não pode ser de antes da reunião da célula nesta semana ('
      || private.report_moment_text((_detail ->> 'meeting_at')::timestamp) || ').'
    WHEN 'report_submit_not_allowed' THEN 'Você não pode enviar o relatório desta célula.'
    WHEN 'cell_deleted' THEN 'Esta célula foi excluída e não recebe relatórios.'
    WHEN 'report_cell_deleted' THEN
      'A célula deste relatório foi excluída. Restaure a célula para editar o relatório.'
    WHEN 'cell_inactive' THEN 'Esta célula está inativa e não recebe relatórios.'
    WHEN 'not_found_or_deleted' THEN
      CASE WHEN _detail ->> 'entity' = 'cell' THEN 'Esta célula não existe ou já foi excluída.'
           ELSE 'Este relatório não existe ou já foi excluído.' END
    WHEN 'report_id_required' THEN 'Informe o identificador do relatório.'
    WHEN 'report_id_conflict' THEN 'Este identificador de relatório já foi usado.'
    WHEN 'cell_meeting_day_missing' THEN 'A célula não tem dia de reunião válido.'
    ELSE _code
  END
$$;

-- Levanta o app_error do E2.01 (22023, HINT 'app_error', DETAIL com o código) com a mensagem do código.
CREATE OR REPLACE FUNCTION private.report_raise(_code text, _detail jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '22023',
    MESSAGE = private.report_message(_code, _detail),
    DETAIL  = (coalesce(_detail, '{}'::jsonb) || pg_catalog.jsonb_build_object('code', _code))::text,
    HINT    = 'app_error';
END $$;

REVOKE ALL ON FUNCTION private.report_moment_text(timestamp) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_message(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_raise(text, jsonb) FROM PUBLIC;

-- ===========================================================================
-- 5. Leituras da tela
-- ===========================================================================
-- Conferência antes de preencher (RN-19, AQ-1, DA-8, DA-10). Só leitura; definer para contar o relatório
-- da semana que quem consulta não vê. Precedência: no_permission → not_found → cell_deleted →
-- not_allowed → cell_inactive → already_sent → not_yet → can_submit. A service role (sem sessão) pula as
-- três de permissão e escopo. "Agora", hoje e a semana sempre vêm; a reunião a partir de already_sent;
-- allowed_dates só em can_submit; existing_* só para quem vê o relatório da semana.
CREATE OR REPLACE FUNCTION public.cell_report_launch_check(_cell_id uuid)
RETURNS TABLE (
  status public.report_launch_status,
  server_now timestamptz,
  today date,
  week_start date,
  week_end date,
  meeting_date date,
  meeting_time time,
  allowed_dates date[],
  existing_report_id uuid,
  existing_date date,
  existing_time time,
  existing_was_held boolean,
  existing_can_edit boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _now timestamptz := now();
  _local timestamp := public.sp_local(now());
  _ws date := public.week_start(public.sp_local(now())::date);
  _member boolean;
  _c record;
  _weekday integer;
  _meeting timestamp;
  _r record;
  _sees boolean;
BEGIN
  _member := (SELECT a.kind FROM private.current_actor() a) = 'member';     -- 42501 sem cadastro
  IF _member THEN
    PERFORM public.viewer_member_id();                                       -- portão do E2.03, antes de tudo
  END IF;

  IF _member AND NOT (    public.viewer_has('edit_cell'::public.permission_action)
                       OR public.viewer_has('submit_any_visible_report'::public.permission_action)
                       OR public.viewer_has('submit_own_cell_report'::public.permission_action)) THEN
    RETURN QUERY SELECT 'no_permission'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      NULL::date, NULL::time, NULL::date[], NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
    RETURN;
  END IF;

  SELECT c.id, c.leader_id, c.timothy_id, c.host_id, c.meeting_day, c.meeting_time, c.is_active, c.deleted_at
    INTO _c FROM public.cells c WHERE c.id = _cell_id;
  IF NOT FOUND OR (_member AND NOT public.viewer_sees_cell_people(_c.leader_id, _c.timothy_id, _c.host_id)) THEN
    RETURN QUERY SELECT 'not_found'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      NULL::date, NULL::time, NULL::date[], NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
    RETURN;
  END IF;
  IF _c.deleted_at IS NOT NULL THEN
    RETURN QUERY SELECT 'cell_deleted'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      NULL::date, NULL::time, NULL::date[], NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
    RETURN;
  END IF;
  IF _member AND NOT public.can_submit_report(_c.id) THEN
    RETURN QUERY SELECT 'not_allowed'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      NULL::date, NULL::time, NULL::date[], NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
    RETURN;
  END IF;
  IF _c.is_active IS NOT TRUE THEN
    RETURN QUERY SELECT 'cell_inactive'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      NULL::date, NULL::time, NULL::date[], NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
    RETURN;
  END IF;

  _weekday := public.weekday_index(_c.meeting_day);
  IF _weekday IS NULL OR _c.meeting_time IS NULL THEN                       -- não existe depois do E2.08
    PERFORM private.report_raise('cell_meeting_day_missing', jsonb_build_object('cell_id', _c.id));
  END IF;
  _meeting := private.report_meeting_at(_ws, _weekday, _c.meeting_time);

  SELECT r.id, r.date, r."time", r.was_held, r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id
    INTO _r
    FROM public.cell_reports r
   WHERE r.cell_id = _c.id AND r.deleted_at IS NULL AND public.week_start(r.date) = _ws
   LIMIT 1;
  IF FOUND THEN
    _sees := NOT _member OR public.viewer_sees_report_people(_r.snapshot_leader_id, _r.snapshot_timothy_id,
                                                             _r.snapshot_host_id);
    RETURN QUERY SELECT 'already_sent'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      _meeting::date, _meeting::time, NULL::date[],
      CASE WHEN _sees THEN _r.id END, CASE WHEN _sees THEN _r.date END, CASE WHEN _sees THEN _r."time" END,
      CASE WHEN _sees THEN _r.was_held END,
      CASE WHEN _sees THEN (NOT _member OR public.viewer_has('edit_cell_report'::public.permission_action)) END;
    RETURN;
  END IF;

  IF private.report_launch_status(_local, _meeting, false) = 'not_yet' THEN
    RETURN QUERY SELECT 'not_yet'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
      _meeting::date, _meeting::time, NULL::date[], NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
    RETURN;
  END IF;

  RETURN QUERY SELECT 'can_submit'::public.report_launch_status, _now, _local::date, _ws, _ws + 6,
    _meeting::date, _meeting::time, private.report_launch_dates(_local, _meeting),
    NULL::uuid, NULL::date, NULL::time, NULL::boolean, NULL::boolean;
END $$;

ALTER FUNCTION public.cell_report_launch_check(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cell_report_launch_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cell_report_launch_check(uuid) TO authenticated, service_role;

-- Contexto da edição (RN-16, P-REL-22): "agora", hoje, a semana do relatório e as datas aceitas. Nenhuma
-- linha quando o relatório não existe, está excluído ou não está visível para quem consulta.
CREATE OR REPLACE FUNCTION public.cell_report_edit_context(_report_id uuid)
RETURNS TABLE (server_now timestamptz, today date, week_start date, week_end date, allowed_dates date[])
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _member boolean;
  _local timestamp := public.sp_local(now());
BEGIN
  _member := (SELECT a.kind FROM private.current_actor() a) = 'member';
  IF _member THEN
    PERFORM public.viewer_member_id();                                       -- portão do E2.03, antes de tudo
  END IF;
  RETURN QUERY
    SELECT now(), _local::date, public.week_start(r.date), public.week_start(r.date) + 6,
           private.report_edit_dates(_local, r.date)
      FROM public.cell_reports r
     WHERE r.id = _report_id
       AND r.deleted_at IS NULL
       AND (NOT _member
            OR public.viewer_sees_report_people(r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id));
END $$;

ALTER FUNCTION public.cell_report_edit_context(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cell_report_edit_context(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cell_report_edit_context(uuid) TO authenticated, service_role;
