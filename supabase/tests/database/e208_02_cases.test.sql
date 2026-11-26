-- GERADO por supabase/tests/fixtures/generate-cell-rules-cases.mjs a partir de
-- supabase/tests/fixtures/cell-rules-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-cell-rules-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.08 (PR 2), AQ-4 / DT-02 / DT-17: as listas do banco iguais às do JSON e cada caso de dia,
-- tipo e horário gravado ou recusado como o JSON diz, como postgres (as regras valem para todos
-- os papéis, RN-01). Cada tentativa roda numa subtransação desfeita no fim.
-- Spec: docs/specs/e2-08-cadastro-celulas.md, RN-05, RN-06, RN-07, DA-1, DA-8, DA-12.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(43);

-- Uma tentativa de gravação, sempre desfeita: devolve 'stored:<valor>' (o RETURNING),
-- 'code:<app_error>' ou 'sqlstate:<SQLSTATE>'.
CREATE FUNCTION pg_temp.attempt(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _r text;
  _state text;
  _hint text;
  _detail text;
BEGIN
  BEGIN
    EXECUTE _sql INTO _r;
    RAISE EXCEPTION USING ERRCODE = 'MCI00', MESSAGE = 'stored:' || coalesce(_r, 'NULL');
  EXCEPTION
    WHEN SQLSTATE 'MCI00' THEN RETURN SQLERRM;
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _hint = PG_EXCEPTION_HINT, _detail = PG_EXCEPTION_DETAIL;
      IF _hint = 'app_error' THEN RETURN 'code:' || (_detail::jsonb ->> 'code'); END IF;
      RETURN 'sqlstate:' || _state;
  END;
END $$;

-- Massa: uma pessoa nos três papéis (RN-03) e uma célula para as edições.
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp)
VALUES ('e2080200-0000-0000-0000-000000000001'::uuid, 'Casos Célula', 'M', true, false, '(51) 99208-0201');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
VALUES ('e2080200-0000-0000-0000-0000000000c1'::uuid, 'e2080200-0000-0000-0000-000000000001'::uuid, 'e2080200-0000-0000-0000-000000000001'::uuid, 'e2080200-0000-0000-0000-000000000001'::uuid, 'Quarta', '20:00');

-- DT-02: as listas do banco são as do JSON.
SELECT is(public.cell_weekdays(), ARRAY['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']::text[],
  'DT-02: cell_weekdays() é a lista do JSON (0 = domingo)');
SELECT is(public.cell_types(), ARRAY['Evangelística', 'Discipulado', 'Macrocélula']::text[],
  'DT-02: cell_types() é a lista do JSON');
SELECT is(public.cell_default_type(), 'Evangelística',
  'DT-05: cell_default_type() é o tipo padrão do JSON');
SELECT is(ARRAY(SELECT public.weekday_index(d) FROM unnest(ARRAY['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']::text[]) d),
  ARRAY[0, 1, 2, 3, 4, 5, 6],
  'DT-02: weekday_index segue a ordem da lista');

-- RN-05, DA-12: dia da semana.
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Domingo'', ''20:00'') RETURNING meeting_day'), 'stored:Domingo',
  'RN-05 D01: "Domingo"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Segunda'', ''20:00'') RETURNING meeting_day'), 'stored:Segunda',
  'RN-05 D02: "Segunda"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Terça'', ''20:00'') RETURNING meeting_day'), 'stored:Terça',
  'RN-05 D03: "Terça"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''20:00'') RETURNING meeting_day'), 'stored:Quarta',
  'RN-05 D04: "Quarta"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quinta'', ''20:00'') RETURNING meeting_day'), 'stored:Quinta',
  'RN-05 D05: "Quinta"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Sexta'', ''20:00'') RETURNING meeting_day'), 'stored:Sexta',
  'RN-05 D06: "Sexta"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Sábado'', ''20:00'') RETURNING meeting_day'), 'stored:Sábado',
  'RN-05 D07: "Sábado"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Segunda-feira'', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_invalid',
  'RN-05 D08: "Segunda-feira"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''segunda'', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_invalid',
  'RN-05 D09: "segunda"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Terca'', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_invalid',
  'RN-05 D10: "Terca"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, '' Segunda'', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_invalid',
  'RN-05 D11: " Segunda"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Feriado'', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_invalid',
  'RN-05 D12: "Feriado"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, '''', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_required',
  'RN-05 D13: ""');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''  '', ''20:00'') RETURNING meeting_day'), 'code:meeting_day_required',
  'RN-05 D14: "  "');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, NULL, ''20:00'') RETURNING meeting_day'), 'code:meeting_day_required',
  'RN-05 D15: nulo');

-- RN-07, DA-1: tipo.
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''20:00'') RETURNING type'), 'stored:Evangelística',
  'RN-07 Y01: nulo (insert, omitido)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, NULL, ''Quarta'', ''20:00'') RETURNING type'), 'stored:Evangelística',
  'RN-07 Y02: nulo (insert)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Evangelística'', ''Quarta'', ''20:00'') RETURNING type'), 'stored:Evangelística',
  'RN-07 Y03: "Evangelística" (insert)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Discipulado'', ''Quarta'', ''20:00'') RETURNING type'), 'stored:Discipulado',
  'RN-07 Y04: "Discipulado" (insert)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Macrocélula'', ''Quarta'', ''20:00'') RETURNING type'), 'stored:Macrocélula',
  'RN-07 Y05: "Macrocélula" (insert)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Discipuladora'', ''Quarta'', ''20:00'') RETURNING type'), 'code:cell_type_invalid',
  'RN-07 Y06: "Discipuladora" (insert)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''evangelistica'', ''Quarta'', ''20:00'') RETURNING type'), 'code:cell_type_invalid',
  'RN-07 Y07: "evangelistica" (insert)');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, '''', ''Quarta'', ''20:00'') RETURNING type'), 'code:cell_type_invalid',
  'RN-07 Y08: "" (insert)');
SELECT is(pg_temp.attempt('UPDATE public.cells SET type = NULL WHERE id = ''e2080200-0000-0000-0000-0000000000c1''::uuid RETURNING type'), 'code:cell_type_invalid',
  'RN-07 Y09: nulo (update)');
SELECT is(pg_temp.attempt('UPDATE public.cells SET type = '''' WHERE id = ''e2080200-0000-0000-0000-0000000000c1''::uuid RETURNING type'), 'code:cell_type_invalid',
  'RN-07 Y10: "" (update)');
SELECT is(pg_temp.attempt('UPDATE public.cells SET type = ''Macrocélula'' WHERE id = ''e2080200-0000-0000-0000-0000000000c1''::uuid RETURNING type'), 'stored:Macrocélula',
  'RN-07 Y11: "Macrocélula" (update)');

-- RN-06, DA-8: horário (só os casos que chegam ao banco).
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''19:30''::time) RETURNING meeting_time::text'), 'stored:19:30:00',
  'RN-06 T02: "19:30"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''20''::time) RETURNING meeting_time::text'), 'sqlstate:22007',
  'RN-06 T05: "20"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''19:30:45''::time) RETURNING meeting_time::text'), 'stored:19:30:00',
  'RN-06 T07: "19:30:45"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''730''::time) RETURNING meeting_time::text'), 'sqlstate:22007',
  'RN-06 T08: "730"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''24:00''::time) RETURNING meeting_time::text'), 'code:meeting_time_invalid',
  'RN-06 T12: "24:00"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''25:00''::time) RETURNING meeting_time::text'), 'sqlstate:22008',
  'RN-06 T13: "25:00"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''19:60''::time) RETURNING meeting_time::text'), 'sqlstate:22008',
  'RN-06 T14: "19:60"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''00:00''::time) RETURNING meeting_time::text'), 'stored:00:00:00',
  'RN-06 T15: "00:00"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''23:59''::time) RETURNING meeting_time::text'), 'stored:23:59:00',
  'RN-06 T16: "23:59"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''23:59:59.999''::time) RETURNING meeting_time::text'), 'stored:23:59:00',
  'RN-06 T17: "23:59:59.999"');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', ''''::time) RETURNING meeting_time::text'), 'sqlstate:22007',
  'RN-06 T18: ""');
SELECT is(pg_temp.attempt('INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''e2080200-0000-0000-0000-000000000001''::uuid, ''Quarta'', NULL::time) RETURNING meeting_time::text'), 'code:meeting_time_required',
  'RN-06 T19: nulo');

SELECT is((SELECT count(*)::int FROM public.cells WHERE leader_id = 'e2080200-0000-0000-0000-000000000001'::uuid), 1,
  'nenhuma tentativa ficou gravada');

SELECT * FROM finish();

ROLLBACK;
