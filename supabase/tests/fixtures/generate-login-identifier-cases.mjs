#!/usr/bin/env node
// E1.04 (AQ-3): gera o pgTAP de private.parse_login_identifier a partir da tabela
// única de casos (login-identifier-cases.json). O mesmo JSON alimenta o Vitest do
// classifyIdentifier (PR 2).
//
//   node supabase/tests/fixtures/generate-login-identifier-cases.mjs           # grava o SQL
//   node supabase/tests/fixtures/generate-login-identifier-cases.mjs --stdout  # só imprime
//
// Um teste do Vitest (src/test/login-identifier-cases-sync.test.ts) falha se o SQL
// gravado ficar diferente do que esta saída produz.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CASES_PATH = join(here, 'login-identifier-cases.json')
export const SQL_PATH = join(here, '..', 'database', 'e104_02_parse_identifier.test.sql')

const FORMATS = ['empty', 'email', 'mobile', 'cpf', 'cpf_or_mobile', 'unknown']

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

export function generate(cases) {
  const rows = []
  for (const c of cases) {
    if (!FORMATS.includes(c.format)) throw new Error(`formato desconhecido em ${c.id}: ${c.format}`)
    const dbFormat = c.format === 'unknown' ? 'invalid' : c.format
    rows.push(
      `  (${lit(c.id)}, ${lit(c.input)}, ${lit(dbFormat)}, ${lit(c.email)}, ${lit(c.cpf)}, ${lit(c.mobile)}, ` +
        `${lit(c.mobileKey)}, ${c.masked === undefined ? 'false' : 'true'}, ${lit(c.masked)})`,
    )
  }
  const n = cases.length
  return `-- GERADO por supabase/tests/fixtures/generate-login-identifier-cases.mjs a partir de
-- supabase/tests/fixtures/login-identifier-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-login-identifier-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E1.04 (PR 1), AQ-3: private.parse_login_identifier sobre a tabela única de casos
-- (formato, formas normalizadas e máscara). A tela roda o classifyIdentifier sobre o mesmo JSON.
-- Spec: docs/specs/e1-04-sign-in.md, "Busca pelo cadastro" (passo 1), RN-02 a RN-04, DA-4, AQ-5.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(${n * 2});

CREATE TEMP TABLE login_cases (
  id text, input text, format text, email text, cpf text, mobile text, mobile_key text,
  check_mask boolean, masked text
) ON COMMIT DROP;

INSERT INTO login_cases VALUES
${rows.join(',\n')};

-- Formato e formas normalizadas: uma asserção por caso.
SELECT is(
  (SELECT jsonb_build_object('format', p.format, 'email', p.email, 'cpf', p.cpf, 'mobile', p.mobile, 'mobile_key', p.mobile_key)
     FROM private.parse_login_identifier(c.input) p),
  jsonb_build_object('format', c.format, 'email', c.email, 'cpf', c.cpf, 'mobile', c.mobile, 'mobile_key', c.mobile_key),
  'AQ-3 ' || c.id || ': formato e formas normalizadas de [' || left(c.input, 40) || ']'
) FROM login_cases c ORDER BY c.id;

-- Máscara da Auditoria (AQ-5): só nos casos que a trazem.
SELECT is(
  CASE WHEN c.check_mask THEN (SELECT p.masked FROM private.parse_login_identifier(c.input) p) ELSE NULL END,
  CASE WHEN c.check_mask THEN c.masked ELSE NULL END,
  'AQ-5 ' || c.id || ': máscara de [' || left(c.input, 40) || ']'
) FROM login_cases c ORDER BY c.id;

SELECT * FROM finish();

ROLLBACK;
`
}

export function readCases() {
  return JSON.parse(readFileSync(CASES_PATH, 'utf8')).cases
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = generate(readCases())
  if (process.argv.includes('--stdout')) process.stdout.write(sql)
  else {
    writeFileSync(SQL_PATH, sql)
    console.log(`gravado: ${SQL_PATH}`)
  }
}
