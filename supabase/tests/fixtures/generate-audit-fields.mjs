#!/usr/bin/env node
// E2.05 (DT-06): gera o pgTAP da lista única de campos da Auditoria a partir de
// audit-fields.json. O mesmo JSON alimenta os rótulos da tela (PR 4, src/lib/audit/fields.ts).
//
//   node supabase/tests/fixtures/generate-audit-fields.mjs           # grava o SQL
//   node supabase/tests/fixtures/generate-audit-fields.mjs --stdout  # só imprime
//
// Um teste do Vitest (src/test/audit-fields-sync.test.ts) falha se o SQL gravado ficar diferente do
// que esta saída produz, ou se o JSON divergir da carga da migration e205_02_schema.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const FIELDS_PATH = join(here, 'audit-fields.json')
export const SQL_PATH = join(here, '..', 'database', 'e205_02_audit_fields.test.sql')

const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const arr = (list) => `ARRAY[${list.map(lit).join(', ')}]::text[]`
const sorted = (list) => [...list].sort()

// As colunas do UPDATE OF de um trigger, em ordem alfabética.
const triggerCols = (table, trigger) =>
  `(SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t ` +
  `JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) ` +
  `WHERE t.tgrelid = 'public.${table}'::regclass AND t.tgname = ${lit(trigger)})`

export function generate(d) {
  const checks = []
  const values = []
  for (const [entity, fields] of Object.entries(d.entities)) {
    fields.forEach((f, i) => values.push(`(${lit(entity)}, ${lit(f.field)}, ${f.show_values}, ${lit(f.value_type)}, ${i + 1})`))
  }
  checks.push(
    `SELECT results_eq(\n  $$ SELECT entity::text, field, show_values, value_type, position::int FROM private.audit_fields ORDER BY entity::text, position $$,\n` +
      `  $$ SELECT * FROM (VALUES\n    ${values.join(',\n    ')}\n  ) v (entity, field, show_values, value_type, position) ORDER BY entity, position $$,\n` +
      `  'DT-06: private.audit_fields é igual ao JSON (campo, valor, tipo e ordem)');`,
  )
  for (const [table, t] of Object.entries(d.tables)) {
    const fields = t.entity ? d.entities[t.entity].map((f) => f.field) : []
    checks.push(
      `SELECT is(\n  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a\n` +
        `    WHERE a.attrelid = 'public.${table}'::regclass AND a.attnum > 0 AND NOT a.attisdropped\n` +
        `      AND a.attname::text <> ALL (${arr([...fields, ...t.not_data])})),\n  NULL,\n` +
        `  ${lit(`classificação: toda coluna de ${table} está na lista de campos ou na de "não é dado"`)});`,
    )
    checks.push(
      `SELECT is(\n  (SELECT array_agg(c ORDER BY c) FROM unnest(${arr([...fields, ...t.not_data])}) c\n` +
        `    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.${table}'::regclass\n` +
        `                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),\n  NULL,\n` +
        `  ${lit(`classificação: as duas listas de ${table} só citam colunas que existem`)});`,
    )
    if (t.entity && table !== 'roles') {
      checks.push(
        `SELECT is(${triggerCols(table, 'zz_stamp_authorship')},\n  ${arr(sorted([...fields, ...d.authorship_columns]))},\n` +
          `  ${lit(`DT-05: o UPDATE OF do zz_stamp_authorship de ${table} é a lista mais as colunas de autoria e de exclusão`)});`,
      )
      checks.push(
        `SELECT is(${triggerCols(table, 'aa_audit_record')},\n  ${arr(sorted([...fields, 'deleted_at']))},\n` +
          `  ${lit(`DT-06: o UPDATE OF do aa_audit_record de ${table} é a lista mais deleted_at`)});`,
      )
    }
  }
  checks.push(
    `SELECT is(${triggerCols('roles', 'aa_audit_role')},\n  ${arr(sorted([...d.entities.role.map((f) => f.field), 'is_default']))},\n` +
      `  'RN-15: o UPDATE OF do aa_audit_role é a lista da função mais is_default (a troca da padrão)');`,
  )
  return `-- GERADO por supabase/tests/fixtures/generate-audit-fields.mjs a partir de
-- supabase/tests/fixtures/audit-fields.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-audit-fields.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.05 (PR 1), DT-06: a lista única de campos (private.audit_fields) igual ao JSON; o teste de
-- classificação (toda coluna das seis tabelas é dado ou está na lista de "não é dado"); o UPDATE OF
-- dos triggers igual à lista (risco 2). Spec: docs/specs/e2-05-auditoria-autor.md, RN-04, RN-13 c,
-- RN-20 b. Rodar com: supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(${checks.length});

${checks.join('\n\n')}

SELECT * FROM finish();
ROLLBACK;
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sql = generate(JSON.parse(readFileSync(FIELDS_PATH, 'utf8')))
  if (process.argv.includes('--stdout')) process.stdout.write(sql)
  else writeFileSync(SQL_PATH, sql)
}
