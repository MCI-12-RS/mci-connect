#!/usr/bin/env node
// E2.08 (AQ-4, DT-02, DT-17): gera o pgTAP das regras do cadastro de célula a partir da
// tabela única de casos (cell-rules-cases.json). O mesmo JSON alimenta o Vitest da tela
// (src/lib/cells/*).
//
//   node supabase/tests/fixtures/generate-cell-rules-cases.mjs           # grava o SQL
//   node supabase/tests/fixtures/generate-cell-rules-cases.mjs --stdout  # só imprime
//
// Um teste do Vitest (src/test/cell-rules-cases-sync.test.ts) falha se o SQL gravado ficar
// diferente do que esta saída produz.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CASES_PATH = join(here, 'cell-rules-cases.json')
export const SQL_PATH = join(here, '..', 'database', 'e208_02_cases.test.sql')

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const arr = (list) => `ARRAY[${list.map(lit).join(', ')}]::text[]`

// O resultado esperado de pg_temp.attempt: 'stored:<valor>', 'code:<app_error>' ou 'sqlstate:<SQLSTATE>'.
const expected = (db) =>
  db.stored !== undefined ? `stored:${db.stored}` : db.code !== undefined ? `code:${db.code}` : `sqlstate:${db.sqlstate}`

const LEADER = "'e2080200-0000-0000-0000-000000000001'::uuid"
const BASE_CELL = "'e2080200-0000-0000-0000-0000000000c1'::uuid"
const PEOPLE = `${LEADER}, ${LEADER}, ${LEADER}`

const daySql = (x) =>
  `INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (${PEOPLE}, ${lit(x.input)}, '20:00') RETURNING meeting_day`
const timeSql = (x) =>
  `INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (${PEOPLE}, 'Quarta', ${lit(x.input)}::time) RETURNING meeting_time::text`
const typeSql = (x) => {
  if (x.op === 'update') return `UPDATE public.cells SET type = ${lit(x.input)} WHERE id = ${BASE_CELL} RETURNING type`
  if (x.omit)
    return `INSERT INTO public.cells (leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES (${PEOPLE}, 'Quarta', '20:00') RETURNING type`
  return `INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (${PEOPLE}, ${lit(x.input)}, 'Quarta', '20:00') RETURNING type`
}

export function generate(c) {
  const dbTimes = c.meeting_time.filter((x) => x.db !== null)
  const n = 4 + c.meeting_day.length + c.type.length + dbTimes.length + 1
  const checks = (list, sqlOf, label) =>
    list
      .map(
        (x) =>
          `SELECT is(pg_temp.attempt(${lit(sqlOf(x))}), ${lit(expected(x.db))},\n  ${lit(`${label} ${x.id}: ${x.input === null ? 'nulo' : JSON.stringify(x.input)}${x.op ? ` (${x.op}${x.omit ? ', omitido' : ''})` : ''}`)});`,
      )
      .join('\n')
  return `-- GERADO por supabase/tests/fixtures/generate-cell-rules-cases.mjs a partir de
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

SELECT plan(${n});

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
VALUES (${LEADER}, 'Casos Célula', 'M', true, false, '(51) 99208-0201');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
VALUES (${BASE_CELL}, ${PEOPLE}, 'Quarta', '20:00');

-- DT-02: as listas do banco são as do JSON.
SELECT is(public.cell_weekdays(), ${arr(c.weekdays)},
  'DT-02: cell_weekdays() é a lista do JSON (0 = domingo)');
SELECT is(public.cell_types(), ${arr(c.types)},
  'DT-02: cell_types() é a lista do JSON');
SELECT is(public.cell_default_type(), ${lit(c.default_type)},
  'DT-05: cell_default_type() é o tipo padrão do JSON');
SELECT is(ARRAY(SELECT public.weekday_index(d) FROM unnest(${arr(c.weekdays)}) d),
  ARRAY[${c.weekdays.map((_, i) => i).join(', ')}],
  'DT-02: weekday_index segue a ordem da lista');

-- RN-05, DA-12: dia da semana.
${checks(c.meeting_day, daySql, 'RN-05')}

-- RN-07, DA-1: tipo.
${checks(c.type, typeSql, 'RN-07')}

-- RN-06, DA-8: horário (só os casos que chegam ao banco).
${checks(dbTimes, timeSql, 'RN-06')}

SELECT is((SELECT count(*)::int FROM public.cells WHERE leader_id = ${LEADER}), 1,
  'nenhuma tentativa ficou gravada');

SELECT * FROM finish();

ROLLBACK;
`
}

export function readCases() {
  return JSON.parse(readFileSync(CASES_PATH, 'utf8'))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = generate(readCases())
  if (process.argv.includes('--stdout')) process.stdout.write(sql)
  else {
    writeFileSync(SQL_PATH, sql)
    process.stdout.write(`gravado: ${SQL_PATH}\n`)
  }
}
