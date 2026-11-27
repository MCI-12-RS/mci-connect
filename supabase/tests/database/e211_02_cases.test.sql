-- GERADO por supabase/tests/fixtures/generate-report-rules-cases.mjs a partir de
-- supabase/tests/fixtures/report-rules-cases.json (e dos casos de horário de cell-rules-cases.json).
-- NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-report-rules-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.11 (PR 2), DT-07 / DT-08 / DT-17: as regras puras do lançamento e da edição (semana, reunião,
-- datas aceitas, futuro no minuto, reunião no segundo, situação da conferência) e a entrada normalizada
-- (oferta, visitantes, horário), com o "agora" fixado pelo caso e a sessão em UTC, America/Sao_Paulo, Asia/Tokyo.
-- Spec: docs/specs/e2-11-lancamento-relatorio.md, RN-04 a RN-09, RN-12, RN-13, RN-16, RN-18, RN-19.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(126);

-- Lançamento: semana|fim|reunião|situação|datas aceitas|código|data e horário finais.
CREATE FUNCTION pg_temp.launch(_now timestamptz, _day text, _mt time, _held boolean, _date date, _time time,
                               _has boolean) RETURNS text LANGUAGE sql AS $$
  WITH x AS (SELECT public.sp_local(_now) AS lo),
       w AS (SELECT lo, public.week_start(lo::date) AS ws FROM x),
       m AS (SELECT lo, ws, private.report_meeting_at(ws, public.weekday_index(_day), _mt) AS mt FROM w)
  SELECT concat_ws('|', m.ws, m.ws + 6, to_char(m.mt, 'YYYY-MM-DD"T"HH24:MI'),
                   private.report_launch_status(m.lo, m.mt, _has),
                   array_to_string(private.report_launch_dates(m.lo, m.mt), ','),
                   coalesce(r.code, 'ok'), r.final_date || ' ' || to_char(r.final_time, 'HH24:MI'))
    FROM m, private.report_launch_rule(m.lo, m.mt, _held, _date, _time, _has) r
$$;

-- Edição: datas aceitas|código.
CREATE FUNCTION pg_temp.edit(_now timestamptz, _stored date, _date date, _time time, _changed boolean)
RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|', array_to_string(private.report_edit_dates(public.sp_local(_now), _stored), ','),
                   coalesce(private.report_edit_rule(public.sp_local(_now), _stored, _date, _time, _changed), 'ok'))
$$;

-- O código do app_error de uma chamada (ou 'ok').
CREATE FUNCTION pg_temp.code_of(_detail text) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'code' ELSE 'sem código' END $$;

-- Oferta pela API (RN-13): a entrada normalizada e a conferência da célula realizada.
CREATE FUNCTION pg_temp.offering(_v jsonb) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _i private.report_input_t := private.report_input(jsonb_build_object('offering', _v));
  _detail text;
BEGIN
  PERFORM private.report_assert_extras('{}'::text[], true, false, _i.offering, _i.offering_ok, true, NULL, false);
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS _detail = PG_EXCEPTION_DETAIL;
  RETURN pg_temp.code_of(_detail);
END $$;

-- Visitantes (RN-12): os nomes gravados, ou o código (com o índice do nome longo).
CREATE FUNCTION pg_temp.visitors(_v jsonb, _count_only boolean) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _i private.report_input_t := private.report_input(jsonb_build_object('visitors', _v));
  _detail text;
BEGIN
  PERFORM private.report_assert_extras(_i.visitors, _i.visitors_ok, true, 0, true, false, NULL, false);
  RETURN 'ok:' || CASE WHEN _count_only THEN 'n=' || cardinality(_i.visitors) ELSE array_to_json(_i.visitors)::text END;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS _detail = PG_EXCEPTION_DETAIL;
  RETURN 'code:' || pg_temp.code_of(_detail) || coalesce(':' || (_detail::jsonb ->> 'index'), '');
END $$;

-- Horário (RN-08, RN-06 do E2.08).
CREATE FUNCTION pg_temp.report_time(_v jsonb) RETURNS text LANGUAGE sql AS $$
  SELECT CASE WHEN NOT i.time_ok THEN 'code:report_time_invalid'
              WHEN i."time" IS NULL THEN 'code:report_time_required'
              ELSE 'stored:' || i."time"::text END
    FROM private.report_input(jsonb_build_object('time', _v)) i
$$;

-- DA-4, DA-5: os limites do banco são os do JSON.
SELECT is(row(l.theme, l.reason, l.observations, l.visitor_name, l.visitors, l.participants, l.offering_max)::text,
  '(300,2000,4000,150,1000,1000,999999.99)',
  'DA-4/DA-5: private.report_limits() é a lista do JSON')
  FROM private.report_limits() l;

-- Sessão em UTC.
SET LOCAL TIME ZONE 'UTC';
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-25 20:00',
  'L01 (UTC): RN-06: a reunião da semana é aceita (sexta, C1 de quarta)');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-27', '10:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-27 10:00',
  'L02 (UTC): RN-05: o próprio minuto de agora');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-27', '10:01', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-27 10:01',
  'L03 (UTC): RN-05: um minuto depois');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-28', '09:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-28 09:00',
  'L04 (UTC): RN-05: amanhã');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '19:59', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_before_meeting|2026-11-25 19:59',
  'L05 (UTC): RN-06: antes da reunião, no mesmo dia');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-24', '21:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_before_meeting|2026-11-24 21:00',
  'L06 (UTC): RN-06: dia anterior ao da célula');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-21', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_not_current_week|2026-11-21 20:00',
  'L07 (UTC): RN-04: sábado da semana passada');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', true),
  '2026-11-22|2026-11-28|2026-11-25T20:00|already_sent|2026-11-25,2026-11-26,2026-11-27|report_week_taken|2026-11-25 20:00',
  'L08 (UTC): RN-07: a semana já tem relatório');
SELECT is(pg_temp.launch('2026-11-25T19:59:59-03:00', 'Quarta', '20:00', true, '2026-11-25', '19:59', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|not_yet||meeting_not_yet|2026-11-25 19:59',
  'L09 (UTC): RN-06: às 19:59:59 a reunião das 20:00 ainda não aconteceu');
SELECT is(pg_temp.launch('2026-11-25T20:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:00',
  'L10 (UTC): RN-06: o próprio momento da reunião');
SELECT is(pg_temp.launch('2026-11-25T20:30:30-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:30',
  'L11 (UTC): RN-05: 20:30 aceito às 20:30:30');
SELECT is(pg_temp.launch('2026-11-25T20:30:30-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:31', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|report_in_future|2026-11-25 20:31',
  'L12 (UTC): RN-05: 20:31 recusado às 20:30:30');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', false, '2026-11-27', '09:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-25 20:00',
  'L13 (UTC): RN-09: ''Não houve célula'' grava a reunião da semana; a data enviada é ignorada');
SELECT is(pg_temp.launch('2026-11-25T19:00:00-03:00', 'Quarta', '20:00', false, NULL, NULL, false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|not_yet||meeting_not_yet|2026-11-25 20:00',
  'L14 (UTC): RN-06/RN-09: ''Não houve célula'' antes da reunião');
SELECT is(pg_temp.launch('2026-11-25T19:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '18:00', true),
  '2026-11-22|2026-11-28|2026-11-25T20:00|already_sent||report_week_taken|2026-11-25 18:00',
  'L15 (UTC): RN-19/RN-20: (a) vem antes de (b)');
SELECT is(pg_temp.launch('2026-11-29T00:02:00-03:00', 'Sábado', '22:00', true, '2026-11-28', '22:00', false),
  '2026-11-29|2026-12-05|2026-12-05T22:00|not_yet||report_not_current_week|2026-11-28 22:00',
  'L16 (UTC): RN-04: aberto no sábado 23:50, enviado no domingo 00:02');
SELECT is(pg_temp.launch('2026-11-28T23:50:00-03:00', 'Sábado', '22:00', true, '2026-11-28', '22:00', false),
  '2026-11-22|2026-11-28|2026-11-28T22:00|can_submit|2026-11-28|ok|2026-11-28 22:00',
  'L17 (UTC): RN-06: célula de sábado, no sábado às 23:50');
SELECT is(pg_temp.launch('2026-11-29T03:00:00Z', 'Domingo', '10:00', true, '2026-11-29', '00:00', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|not_yet||meeting_not_yet|2026-11-29 00:00',
  'L18 (UTC): Virada às 03:00 UTC de domingo: já é a semana nova');
SELECT is(pg_temp.launch('2026-11-29T02:59:59Z', 'Sábado', '22:00', true, '2026-11-28', '23:59', false),
  '2026-11-22|2026-11-28|2026-11-28T22:00|can_submit|2026-11-28|ok|2026-11-28 23:59',
  'L19 (UTC): Virada: às 02:59:59 UTC ainda é sábado 23:59:59 em Brasília');
SELECT is(pg_temp.launch('2026-11-29T09:59:00-03:00', 'Domingo', '10:00', true, '2026-11-29', '09:59', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|not_yet||meeting_not_yet|2026-11-29 09:59',
  'L20 (UTC): RN-06: célula de domingo às 10:00, às 09:59');
SELECT is(pg_temp.launch('2026-11-29T10:00:00-03:00', 'Domingo', '10:00', true, '2026-11-29', '10:00', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|can_submit|2026-11-29|ok|2026-11-29 10:00',
  'L21 (UTC): RN-06: célula de domingo às 10:00, às 10:00');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quinta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-26T20:00|can_submit|2026-11-26,2026-11-27|report_before_meeting|2026-11-25 20:00',
  'L22 (UTC): RN-06: o dia mudou para quinta no meio da semana; vale o novo');
SELECT is(pg_temp.launch('2026-11-27T23:30:00-03:00', 'Quarta', '20:00', true, '2026-11-28', '00:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-28 00:30',
  'L23 (UTC): Aparelho em Lisboa (já é sábado lá): o dia é o de Brasília');
SELECT is(pg_temp.launch('2026-11-25T20:30:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:30',
  'L24 (UTC): Aparelho em Manaus (19:30 lá): vale o horário de Brasília');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-18', '2026-11-19', '20:00', true),
  '2026-11-15,2026-11-16,2026-11-17,2026-11-18,2026-11-19,2026-11-20,2026-11-21|ok',
  'E01 (UTC): RN-16: muda dentro da semana do relatório (semana passada)');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-18', '2026-11-22', '20:00', true),
  '2026-11-15,2026-11-16,2026-11-17,2026-11-18,2026-11-19,2026-11-20,2026-11-21|report_week_locked',
  'E02 (UTC): RN-16: para o domingo seguinte');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-14', '20:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|report_week_locked',
  'E03 (UTC): RN-16: para outra semana');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-27', '10:01', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|report_in_future',
  'E04 (UTC): RN-05: na edição, quando o momento muda');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-27', '10:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E05 (UTC): RN-05: o próprio minuto');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-27', '2026-11-27', '23:00', false),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E06 (UTC): RN-05: o momento não mudou (relatório antigo fica)');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-24', '2026-11-23', '19:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E07 (UTC): RN-16: antes do horário atual da célula é aceito na edição');

-- Sessão em America/Sao_Paulo.
SET LOCAL TIME ZONE 'America/Sao_Paulo';
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-25 20:00',
  'L01 (America/Sao_Paulo): RN-06: a reunião da semana é aceita (sexta, C1 de quarta)');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-27', '10:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-27 10:00',
  'L02 (America/Sao_Paulo): RN-05: o próprio minuto de agora');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-27', '10:01', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-27 10:01',
  'L03 (America/Sao_Paulo): RN-05: um minuto depois');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-28', '09:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-28 09:00',
  'L04 (America/Sao_Paulo): RN-05: amanhã');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '19:59', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_before_meeting|2026-11-25 19:59',
  'L05 (America/Sao_Paulo): RN-06: antes da reunião, no mesmo dia');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-24', '21:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_before_meeting|2026-11-24 21:00',
  'L06 (America/Sao_Paulo): RN-06: dia anterior ao da célula');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-21', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_not_current_week|2026-11-21 20:00',
  'L07 (America/Sao_Paulo): RN-04: sábado da semana passada');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', true),
  '2026-11-22|2026-11-28|2026-11-25T20:00|already_sent|2026-11-25,2026-11-26,2026-11-27|report_week_taken|2026-11-25 20:00',
  'L08 (America/Sao_Paulo): RN-07: a semana já tem relatório');
SELECT is(pg_temp.launch('2026-11-25T19:59:59-03:00', 'Quarta', '20:00', true, '2026-11-25', '19:59', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|not_yet||meeting_not_yet|2026-11-25 19:59',
  'L09 (America/Sao_Paulo): RN-06: às 19:59:59 a reunião das 20:00 ainda não aconteceu');
SELECT is(pg_temp.launch('2026-11-25T20:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:00',
  'L10 (America/Sao_Paulo): RN-06: o próprio momento da reunião');
SELECT is(pg_temp.launch('2026-11-25T20:30:30-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:30',
  'L11 (America/Sao_Paulo): RN-05: 20:30 aceito às 20:30:30');
SELECT is(pg_temp.launch('2026-11-25T20:30:30-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:31', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|report_in_future|2026-11-25 20:31',
  'L12 (America/Sao_Paulo): RN-05: 20:31 recusado às 20:30:30');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', false, '2026-11-27', '09:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-25 20:00',
  'L13 (America/Sao_Paulo): RN-09: ''Não houve célula'' grava a reunião da semana; a data enviada é ignorada');
SELECT is(pg_temp.launch('2026-11-25T19:00:00-03:00', 'Quarta', '20:00', false, NULL, NULL, false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|not_yet||meeting_not_yet|2026-11-25 20:00',
  'L14 (America/Sao_Paulo): RN-06/RN-09: ''Não houve célula'' antes da reunião');
SELECT is(pg_temp.launch('2026-11-25T19:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '18:00', true),
  '2026-11-22|2026-11-28|2026-11-25T20:00|already_sent||report_week_taken|2026-11-25 18:00',
  'L15 (America/Sao_Paulo): RN-19/RN-20: (a) vem antes de (b)');
SELECT is(pg_temp.launch('2026-11-29T00:02:00-03:00', 'Sábado', '22:00', true, '2026-11-28', '22:00', false),
  '2026-11-29|2026-12-05|2026-12-05T22:00|not_yet||report_not_current_week|2026-11-28 22:00',
  'L16 (America/Sao_Paulo): RN-04: aberto no sábado 23:50, enviado no domingo 00:02');
SELECT is(pg_temp.launch('2026-11-28T23:50:00-03:00', 'Sábado', '22:00', true, '2026-11-28', '22:00', false),
  '2026-11-22|2026-11-28|2026-11-28T22:00|can_submit|2026-11-28|ok|2026-11-28 22:00',
  'L17 (America/Sao_Paulo): RN-06: célula de sábado, no sábado às 23:50');
SELECT is(pg_temp.launch('2026-11-29T03:00:00Z', 'Domingo', '10:00', true, '2026-11-29', '00:00', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|not_yet||meeting_not_yet|2026-11-29 00:00',
  'L18 (America/Sao_Paulo): Virada às 03:00 UTC de domingo: já é a semana nova');
SELECT is(pg_temp.launch('2026-11-29T02:59:59Z', 'Sábado', '22:00', true, '2026-11-28', '23:59', false),
  '2026-11-22|2026-11-28|2026-11-28T22:00|can_submit|2026-11-28|ok|2026-11-28 23:59',
  'L19 (America/Sao_Paulo): Virada: às 02:59:59 UTC ainda é sábado 23:59:59 em Brasília');
SELECT is(pg_temp.launch('2026-11-29T09:59:00-03:00', 'Domingo', '10:00', true, '2026-11-29', '09:59', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|not_yet||meeting_not_yet|2026-11-29 09:59',
  'L20 (America/Sao_Paulo): RN-06: célula de domingo às 10:00, às 09:59');
SELECT is(pg_temp.launch('2026-11-29T10:00:00-03:00', 'Domingo', '10:00', true, '2026-11-29', '10:00', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|can_submit|2026-11-29|ok|2026-11-29 10:00',
  'L21 (America/Sao_Paulo): RN-06: célula de domingo às 10:00, às 10:00');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quinta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-26T20:00|can_submit|2026-11-26,2026-11-27|report_before_meeting|2026-11-25 20:00',
  'L22 (America/Sao_Paulo): RN-06: o dia mudou para quinta no meio da semana; vale o novo');
SELECT is(pg_temp.launch('2026-11-27T23:30:00-03:00', 'Quarta', '20:00', true, '2026-11-28', '00:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-28 00:30',
  'L23 (America/Sao_Paulo): Aparelho em Lisboa (já é sábado lá): o dia é o de Brasília');
SELECT is(pg_temp.launch('2026-11-25T20:30:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:30',
  'L24 (America/Sao_Paulo): Aparelho em Manaus (19:30 lá): vale o horário de Brasília');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-18', '2026-11-19', '20:00', true),
  '2026-11-15,2026-11-16,2026-11-17,2026-11-18,2026-11-19,2026-11-20,2026-11-21|ok',
  'E01 (America/Sao_Paulo): RN-16: muda dentro da semana do relatório (semana passada)');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-18', '2026-11-22', '20:00', true),
  '2026-11-15,2026-11-16,2026-11-17,2026-11-18,2026-11-19,2026-11-20,2026-11-21|report_week_locked',
  'E02 (America/Sao_Paulo): RN-16: para o domingo seguinte');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-14', '20:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|report_week_locked',
  'E03 (America/Sao_Paulo): RN-16: para outra semana');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-27', '10:01', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|report_in_future',
  'E04 (America/Sao_Paulo): RN-05: na edição, quando o momento muda');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-27', '10:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E05 (America/Sao_Paulo): RN-05: o próprio minuto');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-27', '2026-11-27', '23:00', false),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E06 (America/Sao_Paulo): RN-05: o momento não mudou (relatório antigo fica)');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-24', '2026-11-23', '19:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E07 (America/Sao_Paulo): RN-16: antes do horário atual da célula é aceito na edição');

-- Sessão em Asia/Tokyo.
SET LOCAL TIME ZONE 'Asia/Tokyo';
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-25 20:00',
  'L01 (Asia/Tokyo): RN-06: a reunião da semana é aceita (sexta, C1 de quarta)');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-27', '10:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-27 10:00',
  'L02 (Asia/Tokyo): RN-05: o próprio minuto de agora');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-27', '10:01', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-27 10:01',
  'L03 (Asia/Tokyo): RN-05: um minuto depois');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-28', '09:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-28 09:00',
  'L04 (Asia/Tokyo): RN-05: amanhã');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '19:59', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_before_meeting|2026-11-25 19:59',
  'L05 (Asia/Tokyo): RN-06: antes da reunião, no mesmo dia');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-24', '21:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_before_meeting|2026-11-24 21:00',
  'L06 (Asia/Tokyo): RN-06: dia anterior ao da célula');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-21', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_not_current_week|2026-11-21 20:00',
  'L07 (Asia/Tokyo): RN-04: sábado da semana passada');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', true),
  '2026-11-22|2026-11-28|2026-11-25T20:00|already_sent|2026-11-25,2026-11-26,2026-11-27|report_week_taken|2026-11-25 20:00',
  'L08 (Asia/Tokyo): RN-07: a semana já tem relatório');
SELECT is(pg_temp.launch('2026-11-25T19:59:59-03:00', 'Quarta', '20:00', true, '2026-11-25', '19:59', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|not_yet||meeting_not_yet|2026-11-25 19:59',
  'L09 (Asia/Tokyo): RN-06: às 19:59:59 a reunião das 20:00 ainda não aconteceu');
SELECT is(pg_temp.launch('2026-11-25T20:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:00',
  'L10 (Asia/Tokyo): RN-06: o próprio momento da reunião');
SELECT is(pg_temp.launch('2026-11-25T20:30:30-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:30',
  'L11 (Asia/Tokyo): RN-05: 20:30 aceito às 20:30:30');
SELECT is(pg_temp.launch('2026-11-25T20:30:30-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:31', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|report_in_future|2026-11-25 20:31',
  'L12 (Asia/Tokyo): RN-05: 20:31 recusado às 20:30:30');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quarta', '20:00', false, '2026-11-27', '09:00', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|ok|2026-11-25 20:00',
  'L13 (Asia/Tokyo): RN-09: ''Não houve célula'' grava a reunião da semana; a data enviada é ignorada');
SELECT is(pg_temp.launch('2026-11-25T19:00:00-03:00', 'Quarta', '20:00', false, NULL, NULL, false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|not_yet||meeting_not_yet|2026-11-25 20:00',
  'L14 (Asia/Tokyo): RN-06/RN-09: ''Não houve célula'' antes da reunião');
SELECT is(pg_temp.launch('2026-11-25T19:00:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '18:00', true),
  '2026-11-22|2026-11-28|2026-11-25T20:00|already_sent||report_week_taken|2026-11-25 18:00',
  'L15 (Asia/Tokyo): RN-19/RN-20: (a) vem antes de (b)');
SELECT is(pg_temp.launch('2026-11-29T00:02:00-03:00', 'Sábado', '22:00', true, '2026-11-28', '22:00', false),
  '2026-11-29|2026-12-05|2026-12-05T22:00|not_yet||report_not_current_week|2026-11-28 22:00',
  'L16 (Asia/Tokyo): RN-04: aberto no sábado 23:50, enviado no domingo 00:02');
SELECT is(pg_temp.launch('2026-11-28T23:50:00-03:00', 'Sábado', '22:00', true, '2026-11-28', '22:00', false),
  '2026-11-22|2026-11-28|2026-11-28T22:00|can_submit|2026-11-28|ok|2026-11-28 22:00',
  'L17 (Asia/Tokyo): RN-06: célula de sábado, no sábado às 23:50');
SELECT is(pg_temp.launch('2026-11-29T03:00:00Z', 'Domingo', '10:00', true, '2026-11-29', '00:00', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|not_yet||meeting_not_yet|2026-11-29 00:00',
  'L18 (Asia/Tokyo): Virada às 03:00 UTC de domingo: já é a semana nova');
SELECT is(pg_temp.launch('2026-11-29T02:59:59Z', 'Sábado', '22:00', true, '2026-11-28', '23:59', false),
  '2026-11-22|2026-11-28|2026-11-28T22:00|can_submit|2026-11-28|ok|2026-11-28 23:59',
  'L19 (Asia/Tokyo): Virada: às 02:59:59 UTC ainda é sábado 23:59:59 em Brasília');
SELECT is(pg_temp.launch('2026-11-29T09:59:00-03:00', 'Domingo', '10:00', true, '2026-11-29', '09:59', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|not_yet||meeting_not_yet|2026-11-29 09:59',
  'L20 (Asia/Tokyo): RN-06: célula de domingo às 10:00, às 09:59');
SELECT is(pg_temp.launch('2026-11-29T10:00:00-03:00', 'Domingo', '10:00', true, '2026-11-29', '10:00', false),
  '2026-11-29|2026-12-05|2026-11-29T10:00|can_submit|2026-11-29|ok|2026-11-29 10:00',
  'L21 (Asia/Tokyo): RN-06: célula de domingo às 10:00, às 10:00');
SELECT is(pg_temp.launch('2026-11-27T10:00:00-03:00', 'Quinta', '20:00', true, '2026-11-25', '20:00', false),
  '2026-11-22|2026-11-28|2026-11-26T20:00|can_submit|2026-11-26,2026-11-27|report_before_meeting|2026-11-25 20:00',
  'L22 (Asia/Tokyo): RN-06: o dia mudou para quinta no meio da semana; vale o novo');
SELECT is(pg_temp.launch('2026-11-27T23:30:00-03:00', 'Quarta', '20:00', true, '2026-11-28', '00:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25,2026-11-26,2026-11-27|report_in_future|2026-11-28 00:30',
  'L23 (Asia/Tokyo): Aparelho em Lisboa (já é sábado lá): o dia é o de Brasília');
SELECT is(pg_temp.launch('2026-11-25T20:30:00-03:00', 'Quarta', '20:00', true, '2026-11-25', '20:30', false),
  '2026-11-22|2026-11-28|2026-11-25T20:00|can_submit|2026-11-25|ok|2026-11-25 20:30',
  'L24 (Asia/Tokyo): Aparelho em Manaus (19:30 lá): vale o horário de Brasília');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-18', '2026-11-19', '20:00', true),
  '2026-11-15,2026-11-16,2026-11-17,2026-11-18,2026-11-19,2026-11-20,2026-11-21|ok',
  'E01 (Asia/Tokyo): RN-16: muda dentro da semana do relatório (semana passada)');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-18', '2026-11-22', '20:00', true),
  '2026-11-15,2026-11-16,2026-11-17,2026-11-18,2026-11-19,2026-11-20,2026-11-21|report_week_locked',
  'E02 (Asia/Tokyo): RN-16: para o domingo seguinte');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-14', '20:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|report_week_locked',
  'E03 (Asia/Tokyo): RN-16: para outra semana');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-27', '10:01', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|report_in_future',
  'E04 (Asia/Tokyo): RN-05: na edição, quando o momento muda');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-25', '2026-11-27', '10:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E05 (Asia/Tokyo): RN-05: o próprio minuto');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-27', '2026-11-27', '23:00', false),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E06 (Asia/Tokyo): RN-05: o momento não mudou (relatório antigo fica)');
SELECT is(pg_temp.edit('2026-11-27T10:00:00-03:00', '2026-11-24', '2026-11-23', '19:00', true),
  '2026-11-22,2026-11-23,2026-11-24,2026-11-25,2026-11-26,2026-11-27|ok',
  'E07 (Asia/Tokyo): RN-16: antes do horário atual da célula é aceito na edição');

RESET TIME ZONE;

-- RN-13: oferta pela API.
SELECT is(pg_temp.offering('0'::jsonb), 'ok', 'RN-13 O01: 0');
SELECT is(pg_temp.offering('10.5'::jsonb), 'ok', 'RN-13 O02: 10.5');
SELECT is(pg_temp.offering('"10.55"'::jsonb), 'ok', 'RN-13 O03: "10.55"');
SELECT is(pg_temp.offering('10.555'::jsonb), 'offering_invalid', 'RN-13 O04: 10.555');
SELECT is(pg_temp.offering('-5'::jsonb), 'offering_negative', 'RN-13 O05: -5');
SELECT is(pg_temp.offering('1000000'::jsonb), 'offering_too_large', 'RN-13 O06: 1000000');
SELECT is(pg_temp.offering('999999.99'::jsonb), 'ok', 'RN-13 O07: 999999.99');
SELECT is(pg_temp.offering('"abc"'::jsonb), 'offering_invalid', 'RN-13 O08: "abc"');
SELECT is(pg_temp.offering('null'::jsonb), 'offering_required', 'RN-13 O09: null');
SELECT is(pg_temp.offering('""'::jsonb), 'offering_required', 'RN-13 O10: ""');
SELECT is(pg_temp.offering('-5.555'::jsonb), 'offering_invalid', 'RN-13 O11: -5.555');
SELECT is(pg_temp.offering('"NaN"'::jsonb), 'offering_invalid', 'RN-13 O12: "NaN"');
SELECT is(pg_temp.offering('"1e3"'::jsonb), 'ok', 'RN-13 O13: "1e3"');

-- RN-12: visitantes.
SELECT is(pg_temp.visitors('[" Maria ","","  João   da  Silva ","Silva, João","Maria"]'::jsonb, false), 'ok:["Maria","João da Silva","Silva, João","Maria"]', 'RN-12 V01');
SELECT is(pg_temp.visitors('[null,"   "]'::jsonb, false), 'ok:[]', 'RN-12 V02');
SELECT is(pg_temp.visitors('"Maria, João"'::jsonb, false), 'code:visitors_invalid', 'RN-12 V03');
SELECT is(pg_temp.visitors('[1]'::jsonb, false), 'code:visitors_invalid', 'RN-12 V04');
SELECT is(pg_temp.visitors(jsonb_build_array(repeat('a', 151)), false), 'code:visitor_name_too_long:0', 'RN-12 V05');
SELECT is(pg_temp.visitors((SELECT jsonb_agg('Visitante'::text) FROM generate_series(1, 1001)), false), 'code:too_many_visitors', 'RN-12 V06');
SELECT is(pg_temp.visitors((SELECT jsonb_agg('Visitante'::text) FROM generate_series(1, 1000)), true), 'ok:n=1000', 'RN-12 V07');

-- RN-08: horário do relatório (casos do E2.08 que chegam ao banco).
SELECT is(pg_temp.report_time('"19:30"'::jsonb), 'stored:19:30:00', 'RN-08 T02: "19:30"');
SELECT is(pg_temp.report_time('"20"'::jsonb), 'code:report_time_invalid', 'RN-08 T05: "20"');
SELECT is(pg_temp.report_time('"19:30:45"'::jsonb), 'stored:19:30:00', 'RN-08 T07: "19:30:45"');
SELECT is(pg_temp.report_time('"730"'::jsonb), 'code:report_time_invalid', 'RN-08 T08: "730"');
SELECT is(pg_temp.report_time('"24:00"'::jsonb), 'code:report_time_invalid', 'RN-08 T12: "24:00"');
SELECT is(pg_temp.report_time('"25:00"'::jsonb), 'code:report_time_invalid', 'RN-08 T13: "25:00"');
SELECT is(pg_temp.report_time('"19:60"'::jsonb), 'code:report_time_invalid', 'RN-08 T14: "19:60"');
SELECT is(pg_temp.report_time('"00:00"'::jsonb), 'stored:00:00:00', 'RN-08 T15: "00:00"');
SELECT is(pg_temp.report_time('"23:59"'::jsonb), 'stored:23:59:00', 'RN-08 T16: "23:59"');
SELECT is(pg_temp.report_time('"23:59:59.999"'::jsonb), 'stored:23:59:00', 'RN-08 T17: "23:59:59.999"');
SELECT is(pg_temp.report_time('""'::jsonb), 'code:report_time_required', 'RN-08 T18: ""');
SELECT is(pg_temp.report_time('null'::jsonb), 'code:report_time_required', 'RN-08 T19: null');

SELECT * FROM finish();

ROLLBACK;
