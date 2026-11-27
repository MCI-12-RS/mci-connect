-- E2.12 (PR 1, migration 2 de 2) — A save_cell_report deixa de lançar (DA-12 do E2.11; DT-10 do E2.12).
-- Ver docs/specs/e2-12-listagem-relatorios.md no repositório apps-mci ("Fim do lançamento pela
-- save_cell_report (migration 2)", risco 9).
--
-- Conteúdo:
--   0. Guarda: a migration 1 deste passo e a save_cell_report definer do E2.11.
--   1. public.save_cell_report recriada a partir da definição vigente (20261130100100_e211_03_write.sql,
--      a última que a define), mudando só o passo 0: o ramo _report_id nulo, que lançava pela
--      submit_cell_report com um id novo (sem a repetição segura), passa a recusar com
--      report_id_required (técnica), depois do portão, na mesma ordem da submit_cell_report. Mesmo
--      nome, assinatura, retorno, modo (definer), search_path e privilégios. Com id, nada muda.
--   2. Pós-condições.
--
-- O lançamento é só pela submit_cell_report, que o formulário do E2.11 (PR 4, em produção) já usa.
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos. Falha cedo, sem mudar nada. Só nomes de objetos na mensagem.
-- ===========================================================================
DO $$ BEGIN
  IF to_regprocedure('public.cell_reports_list(text[],uuid,uuid[],uuid[],date,date,text[],boolean,integer,integer)') IS NULL
     OR to_regprocedure('private.report_raise(text,jsonb)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_proc
                     WHERE oid = to_regprocedure('public.save_cell_report(uuid,jsonb,uuid[])') AND prosecdef) THEN
    RAISE EXCEPTION 'E2.12: falta a migration 1 deste passo ou a save_cell_report do E2.11.';
  END IF;
END $$;

-- ===========================================================================
-- 1. A edição (RN-03, RN-05, RN-08 a RN-13, RN-15, RN-16 do E2.11; DA-3, DA-4, DA-9 de lá). _report só
--    com as chaves que mudam (PATCH); _participant_ids é o conjunto final (com os excluídos), ou nulo
--    para não mexer. Sem _report_id, recusa (o lançamento é a submit_cell_report).
-- ===========================================================================
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
  SELECT a.kind, a.member_id INTO _actor FROM private.current_actor() a;      -- 0: 42501 sem pessoa
  _member := _actor.kind = 'member';
  IF _member THEN
    PERFORM public.viewer_member_id();                                          -- portão do E2.03, antes de tudo
  END IF;
  -- 0. Sem id, não há o que editar (E2.12, DT-10: o lançamento de transição da DA-12 do E2.11 saiu).
  IF _report_id IS NULL THEN
    PERFORM private.report_raise('report_id_required');                         -- técnica
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
-- 2. Pós-condições: definer, search_path fixo, sem EXECUTE para anon, com EXECUTE para authenticated e
--    service_role, e o corpo sem a submit_cell_report.
-- ===========================================================================
DO $$
DECLARE
  _p regprocedure := 'public.save_cell_report(uuid,jsonb,uuid[])'::regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = _p)
     OR NOT (SELECT coalesce(proconfig @> ARRAY['search_path=public'], false) FROM pg_proc WHERE oid = _p)
     OR has_function_privilege('anon', _p, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', _p, 'EXECUTE')
     OR NOT has_function_privilege('service_role', _p, 'EXECUTE')
     OR (SELECT prosrc FROM pg_proc WHERE oid = _p) LIKE '%submit_cell_report%'
     OR (SELECT prosrc FROM pg_proc WHERE oid = _p) NOT LIKE '%report_id_required%' THEN
    RAISE EXCEPTION 'E2.12: save_cell_report diferente do desenho (modo, search_path, privilégios ou corpo).';
  END IF;
END $$;
