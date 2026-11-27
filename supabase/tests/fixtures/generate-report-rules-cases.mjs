#!/usr/bin/env node
// E2.11 (DT-17): gera o pgTAP das regras puras do relatório a partir da tabela única de casos
// (report-rules-cases.json). O mesmo JSON alimenta o Vitest do formulário (PR 4).
//
//   node supabase/tests/fixtures/generate-report-rules-cases.mjs           # grava o SQL
//   node supabase/tests/fixtures/generate-report-rules-cases.mjs --stdout  # só imprime
//
// Um teste do Vitest (src/test/report-rules-cases-sync.test.ts) falha se o SQL gravado ficar
// diferente do que esta saída produz.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CASES_PATH = join(here, 'report-rules-cases.json')
export const CELL_CASES_PATH = join(here, 'cell-rules-cases.json')
export const SQL_PATH = join(here, '..', 'database', 'e211_02_cases.test.sql')

// As sessões em que os casos rodam: o resultado não pode depender do fuso da sessão (DT-08).
export const SESSION_ZONES = ['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const jlit = (v) => `${lit(JSON.stringify(v))}::jsonb`

// O texto que pg_temp.launch devolve: semana|fim|reunião|situação|datas|código|data e horário finais.
const launchExpected = (x) =>
  [x.expected.week_start, x.expected.week_end, x.expected.meeting_at, x.expected.status,
   x.expected.allowed_dates.join(','), x.expected.code ?? 'ok', x.expected.final].join('|')
const editExpected = (x) => [x.expected.allowed_dates.join(','), x.expected.code ?? 'ok'].join('|')

// Entrada dos visitantes: lista literal ou gerada (nome longo, muitos nomes).
const visitorsInput = (input) => {
  if (input && !Array.isArray(input) && typeof input === 'object') {
    if (input.repeat) return `jsonb_build_array(repeat(${lit(input.repeat)}, ${input.length}))`
    return `(SELECT jsonb_agg(${lit(input.repeat_names)}::text) FROM generate_series(1, ${input.count}))`
  }
  return jlit(input)
}
const visitorsExpected = (x) => {
  if (x.code) return `code:${x.code}${x.index !== undefined ? `:${x.index}` : ''}`
  if (typeof x.stored === 'string') return `ok:n=${x.input.count}`
  return `ok:${JSON.stringify(x.stored)}`
}
const visitorsCountOnly = (x) => !x.code && typeof x.stored === 'string'

// Horário do relatório pelos casos do E2.08 que chegam ao banco (RN-08): vazio é obrigatório,
// o gravado do E2.08 é o lido, e o resto é inválido.
const timeExpected = (t) => {
  if (t.input === null || String(t.input).trim() === '') return 'code:report_time_required'
  if (t.db && t.db.stored !== undefined) return `stored:${t.db.stored}`
  return 'code:report_time_invalid'
}

export function generate(c, cell) {
  const times = cell.meeting_time.filter((t) => t.db !== null)
  const z = SESSION_ZONES.length
  const n = 1 + z * (c.launch.length + c.edit.length) + c.offering.length + c.visitors.length + times.length
  const l = c.limits
  const perZone = SESSION_ZONES.map((zone) => `-- Sessão em ${zone}.
SET LOCAL TIME ZONE ${lit(zone)};
${c.launch
  .map(
    (x) =>
      `SELECT is(pg_temp.launch(${lit(x.now)}, ${lit(x.meeting_day)}, ${lit(x.meeting_time)}, ${x.was_held}, ${lit(x.date)}, ${lit(x.time)}, ${x.week_has_report}),
  ${lit(launchExpected(x))},
  ${lit(`${x.id} (${zone}): ${x.note ?? ''}`)});`,
  )
  .join('\n')}
${c.edit
  .map(
    (x) =>
      `SELECT is(pg_temp.edit(${lit(x.now)}, ${lit(x.stored_date)}, ${lit(x.date)}, ${lit(x.time)}, ${x.moment_changed}),
  ${lit(editExpected(x))},
  ${lit(`${x.id} (${zone}): ${x.note ?? ''}`)});`,
  )
  .join('\n')}`).join('\n\n')

  return `-- GERADO por supabase/tests/fixtures/generate-report-rules-cases.mjs a partir de
-- supabase/tests/fixtures/report-rules-cases.json (e dos casos de horário de cell-rules-cases.json).
-- NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-report-rules-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.11 (PR 2), DT-07 / DT-08 / DT-17: as regras puras do lançamento e da edição (semana, reunião,
-- datas aceitas, futuro no minuto, reunião no segundo, situação da conferência) e a entrada normalizada
-- (oferta, visitantes, horário), com o "agora" fixado pelo caso e a sessão em ${SESSION_ZONES.join(', ')}.
-- Spec: docs/specs/e2-11-lancamento-relatorio.md, RN-04 a RN-09, RN-12, RN-13, RN-16, RN-18, RN-19.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(${n});

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
  ${lit(`(${l.theme},${l.reason},${l.observations},${l.visitor_name},${l.visitors},${l.participants},${l.offering_max})`)},
  'DA-4/DA-5: private.report_limits() é a lista do JSON')
  FROM private.report_limits() l;

${perZone}

RESET TIME ZONE;

-- RN-13: oferta pela API.
${c.offering
  .map((x) => `SELECT is(pg_temp.offering(${jlit(x.api)}), ${lit(x.code ?? 'ok')}, ${lit(`RN-13 ${x.id}: ${JSON.stringify(x.api)}`)});`)
  .join('\n')}

-- RN-12: visitantes.
${c.visitors
  .map(
    (x) =>
      `SELECT is(pg_temp.visitors(${visitorsInput(x.input)}, ${visitorsCountOnly(x)}), ${lit(visitorsExpected(x))}, ${lit(`RN-12 ${x.id}`)});`,
  )
  .join('\n')}

-- RN-08: horário do relatório (casos do E2.08 que chegam ao banco).
${times
  .map((t) => `SELECT is(pg_temp.report_time(${jlit(t.input)}), ${lit(timeExpected(t))}, ${lit(`RN-08 ${t.id}: ${JSON.stringify(t.input)}`)});`)
  .join('\n')}

SELECT * FROM finish();

ROLLBACK;
`
}

export function readCases() {
  return [JSON.parse(readFileSync(CASES_PATH, 'utf8')), JSON.parse(readFileSync(CELL_CASES_PATH, 'utf8'))]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = generate(...readCases())
  if (process.argv.includes('--stdout')) process.stdout.write(sql)
  else {
    writeFileSync(SQL_PATH, sql)
    process.stdout.write(`gravado: ${SQL_PATH}\n`)
  }
}
