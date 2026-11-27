-- E2.11 (PR 2, migration 3 de 3) — Lançamento e edição do relatório numa chamada, e o fim da escrita
-- direta. Ver docs/specs/e2-11-lancamento-relatorio.md no repositório apps-mci ("Escrita (migration 3)",
-- "Fim da escrita direta", "Formato dos erros (AQ-2)", "Bloqueios e concorrência", "Divergências do PR 1"
-- e "Divergências do PR 2"; RN-01 a RN-13, RN-15, RN-16, RN-20; DA-1 a DA-12; DT-05, DT-06, DT-09 a DT-12,
-- DT-15, DT-16).
--
-- Conteúdo:
--   0. Guarda de pré-requisitos (a migration 2) e da oferta (nenhuma fora do CHECK novo).
--   1. Funções internas (private, sem grants): campos, participantes, "semana já tem relatório" e a
--      repetição do envio (private.report_replay).
--   2. public.submit_cell_report (lançamento, idempotente pelo id do formulário) e public.save_cell_report
--      reescrita (edição; definer; mesmo contrato do E2.05; o ramo _report_id nulo lança, DA-12).
--   3. A guarda public.guard_cell_report_write (a0_guard_cell_report_write nas duas tabelas) e a barreira
--      dos registrados public.keep_snapshot_participants (ac_keep_snapshot_participants).
--   4. Oferta sem padrão e com CHECK de 0 a R$ 999.999,99 (DT-15).
--   5. Saem: os triggers de semana (o índice e a trava da RPC cobrem, DT-09), os triggers e as funções
--      que só serviam à escrita direta (DT-11), a set_cell_report_participants e as políticas de escrita.
--   6. Privilégios: authenticated e service_role sem INSERT e UPDATE em cell_reports e sem INSERT, UPDATE
--      e DELETE em participantes (RN-01, DT-10).
--   7. Pós-condições.
--
-- Gravação fora das RPCs pelo próprio banco (pgTAP, massas do Playwright, manutenção): só com
-- SET LOCAL mci.cell_report_write = 'on' (DA-11). A marca dispensa as regras de lançamento e de edição;
-- o retrato, os CHECKs, o índice da semana e os triggers do E2.01, do E2.05 e do E2.08 continuam. A carga
-- do legado roda em replica (a guarda não dispara). Nenhuma Edge Function usa a marca.
--
-- Ordem das travas (E2.01, E2.05, E2.08): relatório → célula → membros → (célula, semana) → linhas dos
-- triggers. Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos e oferta
-- ===========================================================================
DO $$
DECLARE
  _ids uuid[];
BEGIN
  IF to_regprocedure('private.report_input(jsonb)') IS NULL
     OR to_regprocedure('private.report_raise(text,jsonb)') IS NULL
     OR to_regtype('public.report_submit_outcome') IS NULL THEN
    RAISE EXCEPTION 'E2.11: a migration 3 depende da migration 2 (e211_02_rules).';
  END IF;
  SELECT array_agg(id ORDER BY id) INTO _ids
    FROM public.cell_reports
   WHERE offering < 0 OR offering > 999999.99;
  IF _ids IS NOT NULL THEN
    RAISE EXCEPTION 'E2.11: relatórios com oferta fora de 0 a 999999.99 (RN-13): %', _ids;
  END IF;
END $$;

-- ===========================================================================
-- 1. Funções internas
-- ===========================================================================
-- Data, horário, tema e motivo (RN-08, RN-09; passo 9 do lançamento). _has_* diz se o teto do texto é
-- conferido (na edição, só nos campos que vieram; DA-4).
CREATE OR REPLACE FUNCTION private.report_assert_meeting(
  _held boolean, _date date, _date_ok boolean, _time time, _time_ok boolean,
  _theme text, _has_theme boolean, _reason text, _has_reason boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  _l record := private.report_limits();
BEGIN
  IF _held THEN
    IF NOT _date_ok THEN
      PERFORM private.report_raise('report_date_invalid', '{"field": "date"}'::jsonb);
    ELSIF _date IS NULL THEN
      PERFORM private.report_raise('report_date_required', '{"field": "date"}'::jsonb);
    END IF;
    IF NOT _time_ok THEN
      PERFORM private.report_raise('report_time_invalid', '{"field": "time"}'::jsonb);
    ELSIF _time IS NULL THEN
      PERFORM private.report_raise('report_time_required', '{"field": "time"}'::jsonb);
    END IF;
    IF _theme IS NULL THEN
      PERFORM private.report_raise('theme_required', '{"field": "theme"}'::jsonb);
    ELSIF _has_theme AND pg_catalog.char_length(_theme) > _l.theme THEN
      PERFORM private.report_raise('theme_too_long', pg_catalog.jsonb_build_object('field', 'theme', 'max', _l.theme));
    END IF;
  ELSE
    IF _reason IS NULL THEN
      PERFORM private.report_raise('reason_required', '{"field": "reason_not_held"}'::jsonb);
    ELSIF _has_reason AND pg_catalog.char_length(_reason) > _l.reason THEN
      PERFORM private.report_raise('reason_too_long',
                                   pg_catalog.jsonb_build_object('field', 'reason_not_held', 'max', _l.reason));
    END IF;
  END IF;
END $$;

-- Visitantes, oferta e observações da célula realizada (RN-12, RN-13; passo 11 do lançamento). A oferta
-- é obrigatória sempre; os formatos e os tetos só nos campos que vieram (_has_*).
CREATE OR REPLACE FUNCTION private.report_assert_extras(
  _visitors text[], _visitors_ok boolean, _has_visitors boolean,
  _offering numeric, _offering_ok boolean, _has_offering boolean,
  _observations text, _has_observations boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  _l record := private.report_limits();
  _i integer;
BEGIN
  IF _has_visitors THEN
    IF NOT _visitors_ok THEN
      PERFORM private.report_raise('visitors_invalid', '{"field": "visitors"}'::jsonb);
    END IF;
    IF coalesce(pg_catalog.cardinality(_visitors), 0) > _l.visitors THEN
      PERFORM private.report_raise('too_many_visitors', pg_catalog.jsonb_build_object('field', 'visitors', 'max', _l.visitors));
    END IF;
    SELECT min(o) - 1 INTO _i FROM unnest(_visitors) WITH ORDINALITY AS v (name, o)
     WHERE pg_catalog.char_length(v.name) > _l.visitor_name;
    IF _i IS NOT NULL THEN
      PERFORM private.report_raise('visitor_name_too_long',
        pg_catalog.jsonb_build_object('field', 'visitors', 'index', _i, 'max', _l.visitor_name));
    END IF;
  END IF;

  IF _has_offering AND NOT _offering_ok THEN
    PERFORM private.report_raise('offering_invalid', '{"field": "offering"}'::jsonb);
  ELSIF _offering IS NULL THEN
    PERFORM private.report_raise('offering_required', '{"field": "offering"}'::jsonb);
  ELSIF _has_offering THEN
    IF _offering <> round(_offering, 2) THEN
      PERFORM private.report_raise('offering_invalid', '{"field": "offering"}'::jsonb);
    ELSIF _offering < 0 THEN
      PERFORM private.report_raise('offering_negative', '{"field": "offering"}'::jsonb);
    ELSIF _offering > _l.offering_max THEN
      PERFORM private.report_raise('offering_too_large',
                                   pg_catalog.jsonb_build_object('field', 'offering', 'max', _l.offering_max));
    END IF;
  END IF;

  IF _has_observations AND pg_catalog.char_length(_observations) > _l.observations THEN
    PERFORM private.report_raise('observations_too_long',
                                 pg_catalog.jsonb_build_object('field', 'observations', 'max', _l.observations));
  END IF;
END $$;

-- Os que entram como participantes (RN-10; passo 10 do lançamento, "quem entra" da edição): travados com
-- FOR KEY SHARE em ordem de id (o delete_member espera, ou o contrário: E2.01); inexistente, excluído e,
-- com sessão, quem quem grava não vê (os isentos: os automáticos e os registrados na troca para célula
-- realizada, RN-11). Roda como o dono (postgres); viewer_sees_member responde sobre a sessão.
CREATE OR REPLACE FUNCTION private.report_assert_entering(_ids uuid[], _exempt uuid[], _check_visibility boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  _found uuid[];
  _id uuid;
BEGIN
  IF coalesce(pg_catalog.cardinality(_ids), 0) = 0 THEN
    RETURN;
  END IF;
  SELECT coalesce(array_agg(m.id ORDER BY m.id), '{}') INTO _found
    FROM (SELECT m.id FROM public.members m WHERE m.id = ANY (_ids) ORDER BY m.id FOR KEY SHARE) m;

  SELECT x INTO _id FROM unnest(_ids) x WHERE NOT (x = ANY (_found)) ORDER BY x LIMIT 1;
  IF _id IS NOT NULL THEN
    PERFORM private.report_raise('participant_not_found',
                                 pg_catalog.jsonb_build_object('field', 'participant_ids', 'member_id', _id));
  END IF;
  SELECT m.id INTO _id FROM public.members m WHERE m.id = ANY (_ids) AND m.deleted_at IS NOT NULL ORDER BY m.id LIMIT 1;
  IF _id IS NOT NULL THEN
    PERFORM private.report_raise('deleted_member_chosen',
                                 pg_catalog.jsonb_build_object('field', 'participant_ids', 'member_id', _id));
  END IF;
  IF _check_visibility THEN
    SELECT x INTO _id
      FROM unnest(_ids) x
     WHERE NOT (x = ANY (coalesce(_exempt, '{}'))) AND NOT public.viewer_sees_member(x)
     ORDER BY x LIMIT 1;
    IF _id IS NOT NULL THEN
      PERFORM private.report_raise('person_not_visible',
                                   pg_catalog.jsonb_build_object('field', 'participant_ids', 'member_id', _id));
    END IF;
  END IF;
END $$;

-- Lista ordenada e sem repetição, sem nulos.
CREATE OR REPLACE FUNCTION private.report_id_set(_ids uuid[])
RETURNS uuid[]
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $$ SELECT coalesce(array_agg(DISTINCT x ORDER BY x), '{}') FROM unnest(_ids) x WHERE x IS NOT NULL $$;

-- "O relatório para esta semana já foi enviado." (RN-07, DA-10): a identificação só para quem o vê.
CREATE OR REPLACE FUNCTION private.report_raise_week_taken(_cell_id uuid, _week_start date, _member boolean)
RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  _r record;
  _detail jsonb := pg_catalog.jsonb_build_object('week_start', _week_start);
BEGIN
  SELECT r.id, r.date, r."time", r.was_held, r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id
    INTO _r
    FROM public.cell_reports r
   WHERE r.cell_id = _cell_id AND r.deleted_at IS NULL AND public.week_start(r.date) = _week_start
   LIMIT 1;
  IF FOUND AND (NOT _member
                OR public.viewer_sees_report_people(_r.snapshot_leader_id, _r.snapshot_timothy_id, _r.snapshot_host_id)) THEN
    _detail := _detail || pg_catalog.jsonb_build_object('report', pg_catalog.jsonb_build_object(
      'id', _r.id, 'date', _r.date, 'time', pg_catalog.to_char(_r."time", 'HH24:MI'), 'was_held', _r.was_held,
      'can_edit', NOT _member OR public.viewer_has('edit_cell_report'::public.permission_action)));
  END IF;
  PERFORM private.report_raise('report_week_taken', _detail);
END $$;

-- Repetição do envio (DT-06, DA-1, DA-2, P-REL-29): o relatório com este id já existe. Só o mesmo autor
-- recebe a resposta; compara a chamada normalizada com o gravado. Não grava, não gera evento e não confere
-- permissão (a primeira tentativa foi aceita; a resposta só fala do que o próprio autor enviou).
CREATE OR REPLACE FUNCTION private.report_replay(
  _report_id uuid, _in private.report_input_t, _participant_ids uuid[],
  _actor_kind public.author_kind, _actor_member uuid)
RETURNS TABLE (report_id uuid, outcome public.report_submit_outcome, same_content boolean)
LANGUAGE plpgsql STABLE SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  _r record;
  _held boolean := coalesce(_in.was_held, true);
  _same boolean;
BEGIN
  SELECT r.* INTO _r FROM public.cell_reports r WHERE r.id = _report_id;
  IF _r.created_by_kind IS DISTINCT FROM _actor_kind OR _r.created_by IS DISTINCT FROM _actor_member THEN
    PERFORM private.report_raise('report_id_conflict');                                      -- DA-2
  END IF;
  IF _r.deleted_at IS NOT NULL THEN
    PERFORM private.report_raise('not_found_or_deleted', '{"entity": "cell_report"}'::jsonb);  -- DA-1
  END IF;

  _same := _in.cell_ok AND _in.was_held_ok
       AND _in.cell_id IS NOT DISTINCT FROM _r.cell_id
       AND _held = _r.was_held;
  IF _same AND _held THEN
    _same := _in.date_ok AND _in.time_ok AND _in.visitors_ok AND _in.offering_ok
         AND _in.date IS NOT DISTINCT FROM _r.date
         AND _in."time" IS NOT DISTINCT FROM _r."time"
         AND _in.theme IS NOT DISTINCT FROM _r.theme
         AND _in.observations IS NOT DISTINCT FROM _r.observations
         AND _in.visitors IS NOT DISTINCT FROM _r.visitors
         AND _in.offering IS NOT DISTINCT FROM _r.offering
         AND private.report_id_set(coalesce(_participant_ids, '{}')
                                   || ARRAY[_r.snapshot_leader_id, _r.snapshot_timothy_id, _r.snapshot_host_id])
             = private.report_id_set(ARRAY(SELECT p.member_id FROM public.cell_report_participants p
                                            WHERE p.report_id = _report_id));
  ELSIF _same THEN
    _same := _in.reason_not_held IS NOT DISTINCT FROM _r.reason_not_held;
  END IF;
  RETURN QUERY SELECT _report_id, 'replayed'::public.report_submit_outcome, coalesce(_same, false);
END $$;

-- Liga a marca da gravação (DA-11) e devolve o valor de antes, para devolvê-lo no fim.
CREATE OR REPLACE FUNCTION private.report_write_mark(_value text)
RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path = ''
AS $$
DECLARE
  _before text := coalesce(pg_catalog.current_setting('mci.cell_report_write', true), '');
BEGIN
  PERFORM pg_catalog.set_config('mci.cell_report_write', coalesce(_value, ''), true);
  RETURN _before;
END $$;

REVOKE ALL ON FUNCTION private.report_assert_meeting(boolean, date, boolean, time, boolean, text, boolean, text, boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_assert_extras(text[], boolean, boolean, numeric, boolean, boolean, text, boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_assert_entering(uuid[], uuid[], boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_id_set(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_raise_week_taken(uuid, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_replay(uuid, private.report_input_t, uuid[], public.author_kind, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.report_write_mark(text) FROM PUBLIC;

-- ===========================================================================
-- 2. As RPCs
-- ===========================================================================
-- Lançamento (RN-02 a RN-13, RN-15, RN-20; DT-05, DT-06, DT-09). A ordem é a da RN-20; a primeira recusa
-- levanta o erro e nada fica gravado. Service role (sem sessão): pula quem lança, a visibilidade da célula
-- e a dos escolhidos (RN-01). Auditoria (E2.05): um evento create com os participantes (inclusive os
-- automáticos), sem o retrato.
CREATE OR REPLACE FUNCTION public.submit_cell_report(
  _report_id uuid,
  _report jsonb,
  _participant_ids uuid[] DEFAULT '{}')
RETURNS TABLE (report_id uuid, outcome public.report_submit_outcome, same_content boolean)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _actor record;
  _member boolean;
  _in private.report_input_t;
  _c record;
  _local timestamp := public.sp_local(now());
  _ws date := public.week_start(public.sp_local(now())::date);
  _weekday integer;
  _meeting timestamp;
  _held boolean;
  _auto uuid[];
  _chosen uuid[] := '{}';
  _all uuid[];
  _rule record;
  _prev text;
  _constraint text;
  _snap record;
BEGIN
  SELECT a.kind, a.member_id INTO _actor FROM private.current_actor() a;      -- 0: 42501 sem pessoa
  _member := _actor.kind = 'member';
  IF _member THEN
    PERFORM public.viewer_member_id();                                          -- portão do E2.03, antes de tudo
  END IF;
  IF _report_id IS NULL THEN
    PERFORM private.report_raise('report_id_required');                         -- 0 (técnica)
  END IF;
  _in := private.report_input(_report);

  -- 1. Repetição do envio (DT-06).
  IF EXISTS (SELECT 1 FROM public.cell_reports r WHERE r.id = _report_id) THEN
    RETURN QUERY SELECT * FROM private.report_replay(_report_id, _in, _participant_ids, _actor.kind, _actor.member_id);
    RETURN;
  END IF;

  -- 2. Nenhuma permissão de lançar (RN-02, P-REL-27).
  IF _member AND NOT (    public.viewer_has('edit_cell'::public.permission_action)
                       OR public.viewer_has('submit_any_visible_report'::public.permission_action)
                       OR public.viewer_has('submit_own_cell_report'::public.permission_action)) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  -- 3. A célula na chamada.
  IF NOT _in.cell_ok OR _in.cell_id IS NULL THEN
    PERFORM private.report_raise('cell_required', '{"field": "cell_id"}'::jsonb);
  END IF;

  -- 4 a 8. A célula: FOR SHARE (a edição da célula espera o lançamento, ou o contrário; ponto 4).
  SELECT c.id, c.leader_id, c.timothy_id, c.host_id, c.meeting_day, c.meeting_time, c.is_active, c.deleted_at
    INTO _c FROM public.cells c WHERE c.id = _in.cell_id FOR SHARE;
  IF NOT FOUND OR (_member AND NOT public.viewer_sees_cell_people(_c.leader_id, _c.timothy_id, _c.host_id)) THEN
    PERFORM private.report_raise('not_found_or_deleted', '{"entity": "cell"}'::jsonb);   -- 4 (DA-7)
  END IF;
  IF _c.deleted_at IS NOT NULL THEN
    PERFORM private.report_raise('cell_deleted', pg_catalog.jsonb_build_object('cell_id', _c.id));       -- 5
  END IF;
  IF _member AND NOT public.can_submit_report(_c.id) THEN
    PERFORM private.report_raise('report_submit_not_allowed', pg_catalog.jsonb_build_object('cell_id', _c.id));   -- 6
  END IF;
  IF _c.is_active IS NOT TRUE THEN
    PERFORM private.report_raise('cell_inactive', pg_catalog.jsonb_build_object('cell_id', _c.id));      -- 7
  END IF;
  _weekday := public.weekday_index(_c.meeting_day);
  IF _weekday IS NULL OR _c.meeting_time IS NULL THEN
    PERFORM private.report_raise('cell_meeting_day_missing', pg_catalog.jsonb_build_object('cell_id', _c.id));   -- 8
  END IF;
  _meeting := private.report_meeting_at(_ws, _weekday, _c.meeting_time);

  -- 9. Campos da reunião.
  IF NOT _in.was_held_ok THEN
    PERFORM private.report_raise('was_held_invalid', '{"field": "was_held"}'::jsonb);
  END IF;
  _held := coalesce(_in.was_held, true);                                         -- P-REL-21
  PERFORM private.report_assert_meeting(_held, _in.date, _in.date_ok, _in."time", _in.time_ok,
                                        _in.theme, true, _in.reason_not_held, true);

  -- 10 e 11. Participantes, visitantes, oferta e observações: só na célula realizada (RN-09).
  _auto := private.report_id_set(ARRAY[_c.leader_id, _c.timothy_id, _c.host_id]);
  IF _held THEN
    _chosen := ARRAY(SELECT x FROM unnest(private.report_id_set(_participant_ids)) x
                      WHERE NOT (x = ANY (_auto)) ORDER BY x);
    IF pg_catalog.cardinality(_chosen) + pg_catalog.cardinality(_auto) > (private.report_limits()).participants THEN
      PERFORM private.report_raise('too_many_participants',
        pg_catalog.jsonb_build_object('field', 'participant_ids', 'max', (private.report_limits()).participants));
    END IF;
    PERFORM private.report_assert_entering(_chosen, '{}', _member);
    PERFORM private.report_assert_extras(_in.visitors, _in.visitors_ok, true, _in.offering, _in.offering_ok, true,
                                         _in.observations, true);
  END IF;

  -- 12. Semana atual (RN-04), antes da trava.
  SELECT * INTO _rule FROM private.report_launch_rule(_local, _meeting, _held, _in.date, _in."time", false);
  IF _rule.code = 'report_not_current_week' THEN
    PERFORM private.report_raise('report_not_current_week',
      pg_catalog.jsonb_build_object('week_start', _ws, 'week_end', _ws + 6));
  END IF;

  -- 13. A trava (célula, semana) do E2.01 e de novo a repetição: a primeira tentativa pode ter acabado
  -- de gravar.
  PERFORM public._del_lock_cell_week(_c.id, _ws);
  IF EXISTS (SELECT 1 FROM public.cell_reports r WHERE r.id = _report_id) THEN
    RETURN QUERY SELECT * FROM private.report_replay(_report_id, _in, _participant_ids, _actor.kind, _actor.member_id);
    RETURN;
  END IF;

  -- 14. Um por semana, a reunião, o futuro e antes da reunião (RN-07, RN-06, RN-05).
  SELECT * INTO _rule
    FROM private.report_launch_rule(_local, _meeting, _held, _in.date, _in."time",
           EXISTS (SELECT 1 FROM public.cell_reports r
                    WHERE r.cell_id = _c.id AND r.deleted_at IS NULL AND public.week_start(r.date) = _ws));
  IF _rule.code = 'report_week_taken' THEN
    PERFORM private.report_raise_week_taken(_c.id, _ws, _member);
  ELSIF _rule.code = 'meeting_not_yet' THEN
    PERFORM private.report_raise('meeting_not_yet',
      pg_catalog.jsonb_build_object('meeting_at', pg_catalog.to_char(_meeting, 'YYYY-MM-DD"T"HH24:MI')));
  ELSIF _rule.code = 'report_in_future' THEN
    PERFORM private.report_raise('report_in_future', '{"field": "date_time"}'::jsonb);
  ELSIF _rule.code = 'report_before_meeting' THEN
    PERFORM private.report_raise('report_before_meeting',
      pg_catalog.jsonb_build_object('field', 'date_time',
                                    'meeting_at', pg_catalog.to_char(_meeting, 'YYYY-MM-DD"T"HH24:MI')));
  ELSIF _rule.code IS NOT NULL THEN
    PERFORM private.report_raise(_rule.code);
  END IF;

  -- 15. Gravação. "Não houve célula": a data e o horário da reunião; tema, observações e oferta nulos;
  -- visitantes vazios; nenhum participante (RN-09, DA-6).
  _prev := private.report_write_mark('on');
  BEGIN
    INSERT INTO public.cell_reports AS r
      (id, cell_id, date, "time", was_held, theme, reason_not_held, observations, visitors, offering)
    VALUES (_report_id, _c.id, _rule.final_date, _rule.final_time, _held,
            CASE WHEN _held THEN _in.theme END,
            CASE WHEN _held THEN NULL ELSE _in.reason_not_held END,
            CASE WHEN _held THEN _in.observations END,
            CASE WHEN _held THEN _in.visitors ELSE '{}'::text[] END,
            CASE WHEN _held THEN _in.offering END)
    RETURNING r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id INTO _snap;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    PERFORM private.report_write_mark(_prev);
    IF _constraint = 'cell_reports_pkey' THEN                                    -- a primeira tentativa gravou
      RETURN QUERY SELECT * FROM private.report_replay(_report_id, _in, _participant_ids, _actor.kind, _actor.member_id);
      RETURN;
    ELSIF _constraint = 'cell_reports_cell_week_key' THEN
      PERFORM private.report_raise_week_taken(_c.id, _ws, _member);
    END IF;
    RAISE;
  END;

  -- 16. Participantes: os escolhidos e os três do retrato devolvido, sem repetir, em ordem de id (RN-11).
  IF _held THEN
    _all := private.report_id_set(_chosen || ARRAY[_snap.snapshot_leader_id, _snap.snapshot_timothy_id,
                                                   _snap.snapshot_host_id]);
    INSERT INTO public.cell_report_participants (report_id, member_id)
    SELECT _report_id, x FROM unnest(_all) x ORDER BY x;
  END IF;

  -- 17. Devolve a marca e o resultado.
  PERFORM private.report_write_mark(_prev);
  RETURN QUERY SELECT _report_id, 'created'::public.report_submit_outcome, NULL::boolean;
END $$;

ALTER FUNCTION public.submit_cell_report(uuid, jsonb, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.submit_cell_report(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_cell_report(uuid, jsonb, uuid[]) TO authenticated, service_role;

-- Edição (RN-03, RN-05, RN-08 a RN-13, RN-15, RN-16; DA-3, DA-4, DA-9). Mesmo nome, assinatura e retorno
-- do E2.05; passa a definer. _report só com as chaves que mudam (PATCH); _participant_ids é o conjunto
-- final (com os excluídos), ou nulo para não mexer. O ramo _report_id nulo é o lançamento de transição
-- (DA-12; sai no E2.12): lança com um id novo, sem a repetição segura.
CREATE OR REPLACE FUNCTION public.save_cell_report(
  _report_id uuid,
  _report jsonb,
  _participant_ids uuid[] DEFAULT NULL)
RETURNS TABLE (report_id uuid, changed boolean)
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  _actor record;
  _member boolean;
  _in private.report_input_t;
  _r record;
  _cell_deleted timestamptz;
  _held boolean;
  _date date;
  _time time;
  _theme text;
  _reason text;
  _obs text;
  _visitors text[];
  _offering numeric;
  _snap uuid[];
  _stored uuid[];
  _final uuid[];
  _removed uuid[];
  _added uuid[];
  _bad uuid[];
  _id uuid;
  _code text;
  _prev text;
  _after timestamptz;
BEGIN
  -- 0. Lançamento de transição (DA-12).
  IF _report_id IS NULL THEN
    RETURN QUERY
      SELECT s.report_id, true
        FROM public.submit_cell_report(gen_random_uuid(), _report, coalesce(_participant_ids, '{}'::uuid[])) s;
    RETURN;
  END IF;

  SELECT a.kind, a.member_id INTO _actor FROM private.current_actor() a;      -- 0: 42501 sem pessoa
  _member := _actor.kind = 'member';
  IF _member THEN
    PERFORM public.viewer_member_id();                                          -- portão do E2.03, antes de tudo
  END IF;

  -- 1. Editar Relatórios de Células (RN-03).
  IF _member AND NOT public.viewer_has('edit_cell_report'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  -- 2. O relatório, travado primeiro (ordem global). Invisível é inexistente (RN-09 a do E2.02).
  SELECT r.* INTO _r FROM public.cell_reports r WHERE r.id = _report_id FOR NO KEY UPDATE;
  IF NOT FOUND OR _r.deleted_at IS NOT NULL
     OR (_member AND NOT public.viewer_sees_report_people(_r.snapshot_leader_id, _r.snapshot_timothy_id,
                                                          _r.snapshot_host_id)) THEN
    PERFORM private.report_raise('not_found_or_deleted', '{"entity": "cell_report"}'::jsonb);
  END IF;

  -- 3. A célula: excluída impede; inativa não (RN-11 d do E2.08).
  SELECT c.deleted_at INTO _cell_deleted FROM public.cells c WHERE c.id = _r.cell_id FOR KEY SHARE;
  IF _cell_deleted IS NOT NULL THEN
    PERFORM private.report_raise('report_cell_deleted', pg_catalog.jsonb_build_object('cell_id', _r.cell_id));
  END IF;

  -- 4. O estado final e as trocas da RN-09.
  _in := private.report_input(_report);
  IF NOT _in.was_held_ok THEN
    PERFORM private.report_raise('was_held_invalid', '{"field": "was_held"}'::jsonb);
  END IF;
  _held := CASE WHEN _in.has_was_held THEN _in.was_held ELSE _r.was_held END;
  _stored := private.report_id_set(ARRAY(SELECT p.member_id FROM public.cell_report_participants p
                                          WHERE p.report_id = _report_id));
  _snap := private.report_id_set(ARRAY[_r.snapshot_leader_id, _r.snapshot_timothy_id, _r.snapshot_host_id]);
  IF _r.was_held AND NOT _held THEN
    SELECT array_agg(m.id ORDER BY m.id) INTO _bad
      FROM public.members m WHERE m.id = ANY (_stored) AND m.deleted_at IS NOT NULL;
    IF _bad IS NOT NULL THEN
      PERFORM private.report_raise('not_held_with_deleted_participant',
                                   pg_catalog.jsonb_build_object('field', 'was_held', 'member_ids', _bad));
    END IF;
  END IF;

  -- 5. Os campos do estado final; os tetos só nos campos que vieram (DA-4).
  IF _held THEN
    _date := CASE WHEN _in.has_date THEN _in.date ELSE _r.date END;
    _time := CASE WHEN _in.has_time THEN _in."time" ELSE _r."time" END;
    _theme := CASE WHEN _in.has_theme THEN _in.theme ELSE _r.theme END;
    _reason := CASE WHEN _r.was_held THEN _r.reason_not_held END;                -- a troca apaga o motivo
    _obs := CASE WHEN _in.has_observations THEN _in.observations ELSE _r.observations END;
    _visitors := CASE WHEN _in.has_visitors THEN _in.visitors ELSE _r.visitors END;
    _offering := CASE WHEN _in.has_offering THEN _in.offering ELSE _r.offering END;
    PERFORM private.report_assert_meeting(true, _date, NOT _in.has_date OR _in.date_ok,
                                          _time, NOT _in.has_time OR _in.time_ok,
                                          _theme, _in.has_theme, NULL, false);
  ELSE
    _date := _r.date;                                                            -- RN-09: ficam
    _time := _r."time";
    _reason := CASE WHEN _in.has_reason THEN _in.reason_not_held ELSE _r.reason_not_held END;
    IF _r.was_held THEN                                                          -- realizada → não houve
      _theme := NULL;  _obs := NULL;  _visitors := '{}';  _offering := NULL;
    ELSE                                                                         -- continua (DA-3)
      _theme := _r.theme;  _obs := _r.observations;  _visitors := _r.visitors;  _offering := _r.offering;
    END IF;
    PERFORM private.report_assert_meeting(false, NULL, true, NULL, true, NULL, false, _reason, _in.has_reason);
  END IF;

  -- 6. Participantes: o conjunto final, calculado depois da trava do relatório (DT-12).
  IF _held AND _r.was_held THEN
    _final := private.report_id_set(coalesce(_participant_ids, _stored));
  ELSIF _held THEN                                                               -- não houve → realizada
    _final := private.report_id_set(coalesce(_participant_ids, _stored) || _snap);
  ELSIF _r.was_held THEN                                                         -- realizada → não houve
    _final := '{}';
  ELSE                                                                           -- continua (DA-3)
    _final := _stored;
  END IF;
  IF pg_catalog.cardinality(_final) > (private.report_limits()).participants THEN
    PERFORM private.report_raise('too_many_participants',
      pg_catalog.jsonb_build_object('field', 'participant_ids', 'max', (private.report_limits()).participants));
  END IF;
  _removed := ARRAY(SELECT x FROM unnest(_stored) x WHERE NOT (x = ANY (_final)) ORDER BY x);
  _added := ARRAY(SELECT x FROM unnest(_final) x WHERE NOT (x = ANY (_stored)) ORDER BY x);
  -- Quem sai: excluído; pessoa registrada numa realizada. Quem quem edita não vê pode sair (RN-09 do E2.02).
  SELECT m.id INTO _id FROM public.members m WHERE m.id = ANY (_removed) AND m.deleted_at IS NOT NULL
   ORDER BY m.id LIMIT 1;
  IF _id IS NOT NULL THEN
    PERFORM private.report_raise('deleted_participant_removal',
                                 pg_catalog.jsonb_build_object('field', 'participant_ids', 'member_id', _id));
  END IF;
  IF _held THEN
    SELECT x INTO _id FROM unnest(_removed) x WHERE x = ANY (_snap) ORDER BY x LIMIT 1;
    IF _id IS NOT NULL THEN
      PERFORM private.report_raise('snapshot_participant_removal',
                                   pg_catalog.jsonb_build_object('field', 'participant_ids', 'member_id', _id));
    END IF;
  END IF;
  -- Quem entra: os registrados ficam isentos da visibilidade só na troca para realizada (RN-11).
  PERFORM private.report_assert_entering(_added, CASE WHEN _held AND NOT _r.was_held THEN _snap END, _member);

  IF _held THEN
    PERFORM private.report_assert_extras(_visitors, _in.visitors_ok, _in.has_visitors, _offering, _in.offering_ok,
                                         _in.has_offering, _obs, _in.has_observations);
  END IF;

  -- 7. A célula não muda (RN-16).
  IF _in.has_cell AND (NOT _in.cell_ok OR _in.cell_id IS DISTINCT FROM _r.cell_id) THEN
    PERFORM private.report_raise('report_cell_immutable', pg_catalog.jsonb_build_object('cell_id', _r.cell_id));
  END IF;

  -- 8. A semana do relatório e o futuro, se a data ou o horário mudaram (RN-16, RN-05).
  _code := private.report_edit_rule(public.sp_local(now()), _r.date, _date, _time,
                                    _date IS DISTINCT FROM _r.date OR _time IS DISTINCT FROM _r."time");
  IF _code = 'report_week_locked' THEN
    PERFORM private.report_raise('report_week_locked',
      pg_catalog.jsonb_build_object('field', 'date', 'week_start', public.week_start(_r.date),
                                    'week_end', public.week_start(_r.date) + 6));
  ELSIF _code = 'report_in_future' THEN
    PERFORM private.report_raise('report_in_future', '{"field": "date_time"}'::jsonb);
  END IF;

  -- 9. Gravação: o relatório primeiro (na troca para "Não houve célula", o trigger dos registrados libera
  -- a saída deles), depois os participantes pela diferença, em ordem de member_id (E2.01).
  _prev := private.report_write_mark('on');
  UPDATE public.cell_reports r
     SET date = _date, "time" = _time, was_held = _held, theme = _theme, reason_not_held = _reason,
         observations = _obs, visitors = _visitors, offering = _offering
   WHERE r.id = _report_id
     AND (r.date, r."time", r.was_held, r.theme, r.reason_not_held, r.observations, r.visitors, r.offering)
         IS DISTINCT FROM (_date, _time, _held, _theme, _reason, _obs, _visitors, _offering);
  FOREACH _id IN ARRAY _removed LOOP
    DELETE FROM public.cell_report_participants p WHERE p.report_id = _report_id AND p.member_id = _id;
  END LOOP;
  INSERT INTO public.cell_report_participants (report_id, member_id)
  SELECT _report_id, x FROM unnest(_added) x ORDER BY x;
  PERFORM private.report_write_mark(_prev);

  -- 10. changed: o carimbo do E2.05 só muda o updated_at quando há alteração (RN-15).
  SELECT r.updated_at INTO _after FROM public.cell_reports r WHERE r.id = _report_id;
  RETURN QUERY SELECT _report_id, _after IS DISTINCT FROM _r.updated_at;
END $$;

ALTER FUNCTION public.save_cell_report(uuid, jsonb, uuid[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.save_cell_report(uuid, jsonb, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_cell_report(uuid, jsonb, uuid[]) TO authenticated, service_role;

-- ===========================================================================
-- 3. Guarda e barreira dos registrados
-- ===========================================================================
-- Guarda (DT-10, DA-11). Para todos os papéis; na carga (replica), não dispara. Excluir e restaurar
-- (E2.01) e o carimbo dos participantes (E2.05) não mudam o conteúdo e passam.
CREATE OR REPLACE FUNCTION public.guard_cell_report_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _not_content constant text[] := ARRAY['deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy',
                                        'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy'];
BEGIN
  IF current_setting('mci.cell_report_write', true) = 'on' THEN                -- RPC ou manutenção explícita
    RETURN coalesce(NEW, OLD);
  END IF;
  IF TG_TABLE_NAME = 'cell_reports' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - _not_content) = (to_jsonb(OLD) - _not_content) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Relatórios e participantes só são gravados pelas RPCs submit_cell_report e save_cell_report.'
    USING ERRCODE = '42501';
END $$;

ALTER FUNCTION public.guard_cell_report_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.guard_cell_report_write() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a0_guard_cell_report_write ON public.cell_reports;
CREATE TRIGGER a0_guard_cell_report_write
  BEFORE INSERT OR UPDATE ON public.cell_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_cell_report_write();
DROP TRIGGER IF EXISTS a0_guard_cell_report_write ON public.cell_report_participants;
CREATE TRIGGER a0_guard_cell_report_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.cell_report_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_cell_report_write();

-- Pessoas registradas fixas na célula realizada (RN-11): barreira para qualquer caminho, inclusive com a
-- marca. Vem depois do aa_enforce_participant_rules (o excluído responde primeiro).
CREATE OR REPLACE FUNCTION public.keep_snapshot_participants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cell_reports r
              WHERE r.id = OLD.report_id AND r.was_held
                AND OLD.member_id IN (r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id)) THEN
    PERFORM private.report_raise('snapshot_participant_removal',
                                 jsonb_build_object('field', 'participant_ids', 'member_id', OLD.member_id));
  END IF;
  RETURN OLD;
END $$;

ALTER FUNCTION public.keep_snapshot_participants() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.keep_snapshot_participants() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ac_keep_snapshot_participants ON public.cell_report_participants;
CREATE TRIGGER ac_keep_snapshot_participants
  BEFORE DELETE ON public.cell_report_participants
  FOR EACH ROW EXECUTE FUNCTION public.keep_snapshot_participants();

-- ===========================================================================
-- 4. Oferta (DT-15, DA-5, DA-6)
-- ===========================================================================
ALTER TABLE public.cell_reports ALTER COLUMN offering DROP DEFAULT;
DO $$ BEGIN
  ALTER TABLE public.cell_reports ADD CONSTRAINT cell_reports_offering_check
    CHECK (offering IS NULL OR offering BETWEEN 0 AND 999999.99);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===========================================================================
-- 5. O que sai (conferido no catálogo: nenhum outro uso em pg_proc.prosrc, views ou triggers)
-- ===========================================================================
-- Políticas de escrita: todas as que existirem nas duas tabelas (inclusive as antigas do E1.01).
DO $$
DECLARE
  _p record;
BEGIN
  FOR _p IN
    SELECT policyname, tablename FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('cell_reports', 'cell_report_participants') AND cmd <> 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', _p.policyname, _p.tablename);
  END LOOP;
END $$;

-- Semana atual e um por semana: a RPC (RN-04) e a trava com o índice (DT-09) cobrem.
DROP TRIGGER IF EXISTS enforce_cell_report_current_week_trigger ON public.cell_reports;
DROP TRIGGER IF EXISTS enforce_unique_weekly_cell_report_trigger ON public.cell_reports;
DROP FUNCTION IF EXISTS public.enforce_cell_report_current_week();
DROP FUNCTION IF EXISTS public.enforce_unique_weekly_cell_report();

-- Escrita direta (E2.01 PR 2, E2.02): sem INSERT para a API, só as RPCs definer inserem.
DROP TRIGGER IF EXISTS a0_check_insert_permission ON public.cell_reports;
DROP TRIGGER IF EXISTS a0_check_insert_permission ON public.cell_report_participants;
DROP TRIGGER IF EXISTS ab_enforce_cell_report_scope ON public.cell_reports;
DROP TRIGGER IF EXISTS ab_enforce_participant_scope ON public.cell_report_participants;
DROP FUNCTION IF EXISTS public.enforce_cell_report_scope();
DROP FUNCTION IF EXISTS public.enforce_participant_scope();

-- enforce_insert_permission fica só com o ramo de cells (o único trigger que ainda a usa).
CREATE OR REPLACE FUNCTION public.enforce_insert_permission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Migrations, manutenção, Edge Functions com a service_role e RPCs definer
  -- (que conferem a permissão por conta própria).
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME <> 'cells' THEN
    RAISE EXCEPTION 'enforce_insert_permission: tabela não prevista (%)', TG_TABLE_NAME;
  END IF;
  IF NOT coalesce(public.viewer_can_insert_cell(), false) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP FUNCTION IF EXISTS public.viewer_can_insert_cell_report(uuid);
DROP FUNCTION IF EXISTS public.viewer_can_insert_cell_report_participant(uuid);

-- Absorvida pelas RPCs (E2.01 DT-15; fim da DA-5 do E2.02).
DROP FUNCTION IF EXISTS public.set_cell_report_participants(uuid, uuid[]);

-- ===========================================================================
-- 6. Privilégios (RN-01, DT-10)
-- ===========================================================================
-- TRUNCATE também: ele não passa pelo RLS nem pelos triggers de linha (a guarda).
REVOKE INSERT, UPDATE, TRUNCATE ON public.cell_reports FROM authenticated, service_role, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.cell_report_participants FROM authenticated, service_role, anon;

-- ===========================================================================
-- 7. Pós-condições
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('cell_reports', 'cell_report_participants') AND cmd <> 'SELECT')
     OR has_table_privilege('authenticated', 'public.cell_reports', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cell_reports', 'UPDATE')
     OR has_table_privilege('service_role', 'public.cell_reports', 'INSERT')
     OR has_table_privilege('service_role', 'public.cell_reports', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.cell_report_participants', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cell_report_participants', 'DELETE')
     OR has_table_privilege('service_role', 'public.cell_report_participants', 'INSERT')
     OR has_table_privilege('service_role', 'public.cell_report_participants', 'DELETE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['authenticated', 'service_role', 'anon']) r (role),
                              unnest(ARRAY['public.cell_reports', 'public.cell_report_participants']) t (tab)
                 WHERE has_table_privilege(r.role, t.tab, 'TRUNCATE'))
     OR to_regprocedure('public.set_cell_report_participants(uuid,uuid[])') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid IN ('public.cell_reports'::regclass,
                                                          'public.cell_report_participants'::regclass)
                 AND tgname IN ('enforce_cell_report_current_week_trigger', 'enforce_unique_weekly_cell_report_trigger',
                                'a0_check_insert_permission', 'ab_enforce_cell_report_scope',
                                'ab_enforce_participant_scope'))
     OR (SELECT count(*) FROM pg_trigger WHERE tgname = 'a0_guard_cell_report_write') <> 2 THEN
    RAISE EXCEPTION 'E2.11: a escrita direta em relatórios não ficou fechada.';
  END IF;
END $$;
