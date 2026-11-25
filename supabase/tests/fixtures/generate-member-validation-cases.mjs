#!/usr/bin/env node
// E2.04 (AQ-2, DT-17): gera o pgTAP das funções de regra do cadastro de membro a partir da
// tabela única de casos (member-validation-cases.json). O mesmo JSON alimenta o Vitest da
// tela (src/lib/members/*, PR 3).
//
//   node supabase/tests/fixtures/generate-member-validation-cases.mjs           # grava o SQL
//   node supabase/tests/fixtures/generate-member-validation-cases.mjs --stdout  # só imprime
//
// Um teste do Vitest (src/test/member-validation-cases-sync.test.ts) falha se o SQL gravado
// ficar diferente do que esta saída produz.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CASES_PATH = join(here, 'member-validation-cases.json')
export const SQL_PATH = join(here, '..', 'database', 'e204_01_functions_cases.test.sql')

// Literal SQL em texto. Controles (tabulação, quebra de linha) vão em E'...' com escapes.
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL'
  const s = String(v)
  if (/[\u0000-\u001f\\]/.test(s)) {
    const esc = s
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "''")
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
    return `E'${esc}'`
  }
  return `'${s.replace(/'/g, "''")}'`
}
const bool = (v) => (v ? 'true' : 'false')

export function generate(c) {
  const rows = (list, fn) => list.map((x) => `  (${fn(x)})`).join(',\n')
  const n =
    1 + // lista de domínios
    1 + // domínio de geração
    c.name.length * 2 +
    c.email.length * 3 +
    c.mobile.length * 2 +
    c.cpf.length * 2 +
    c.birthDate.length +
    c.identifier.length
  const domains = `ARRAY[${c.placeholderEmailDomains.map(lit).join(', ')}]::text[]`
  return `-- GERADO por supabase/tests/fixtures/generate-member-validation-cases.mjs a partir de
-- supabase/tests/fixtures/member-validation-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-member-validation-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.04 (PR 1), AQ-2 / DT-17 / DT-18: as funções de regra sobre a tabela única de casos
-- (nome, e-mail, domínios fictícios, celular, CPF, nascimento com "hoje" fixo e identificador
-- de login). A tela roda o mesmo JSON no Vitest (PR 3).
-- Spec: docs/specs/e2-04-validacoes-membro.md, RN-02, RN-04, RN-05, RN-06, RN-07, RN-08,
-- RN-09, RN-15, DA-3, DA-5, DA-12, DA-13.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(${n});

-- DT-18: a lista de domínios fictícios do banco é a do JSON, e o de geração está nela.
SELECT is(public.placeholder_email_domains(), ${domains},
  'DT-18: placeholder_email_domains() é a lista do JSON');
SELECT ok(public.placeholder_email_domain() = ${lit(c.generationDomain)}
          AND public.placeholder_email_domain() = ANY (public.placeholder_email_domains()),
  'DT-18: o domínio de geração é o do JSON e está na lista');

-- RN-02, DA-12: nome.
CREATE TEMP TABLE name_cases (id text, input text, normalized text, valid boolean) ON COMMIT DROP;
INSERT INTO name_cases VALUES
${rows(c.name, (x) => `${lit(x.id)}, ${lit(x.input)}, ${lit(x.normalized)}, ${bool(x.valid)}`)};
SELECT is(public.normalize_person_name(x.input), x.normalized,
  'RN-02 ' || x.id || ': normalize_person_name') FROM name_cases x ORDER BY x.id;
SELECT is(public.is_valid_person_name(x.input), x.valid,
  'RN-02 ' || x.id || ': is_valid_person_name') FROM name_cases x ORDER BY x.id;

-- RN-04, RN-05, DA-3: e-mail (normalize_email do E2.01, is_valid_email e is_placeholder_email).
CREATE TEMP TABLE email_cases (id text, input text, normalized text, valid boolean, placeholder boolean) ON COMMIT DROP;
INSERT INTO email_cases VALUES
${rows(c.email, (x) => `${lit(x.id)}, ${lit(x.input)}, ${lit(x.normalized)}, ${bool(x.valid)}, ${bool(x.placeholder)}`)};
SELECT is(public.normalize_email(x.input), x.normalized,
  'RN-04 ' || x.id || ': normalize_email') FROM email_cases x ORDER BY x.id;
SELECT is(public.is_valid_email(public.normalize_email(x.input)), x.valid,
  'RN-04 ' || x.id || ': is_valid_email') FROM email_cases x ORDER BY x.id;
SELECT is(public.is_placeholder_email(x.input), x.placeholder,
  'RN-05 ' || x.id || ': is_placeholder_email') FROM email_cases x ORDER BY x.id;

-- RN-06, RN-09, DA-5: celular (leitura do E1.04 e chave do 9º dígito).
CREATE TEMP TABLE mobile_cases (id text, input text, normalized text, match_key text) ON COMMIT DROP;
INSERT INTO mobile_cases VALUES
${rows(c.mobile, (x) => `${lit(x.id)}, ${lit(x.input)}, ${lit(x.normalized)}, ${lit(x.matchKey)}`)};
SELECT is(public.normalize_mobile(x.input), x.normalized,
  'RN-06 ' || x.id || ': normalize_mobile') FROM mobile_cases x ORDER BY x.id;
SELECT is(public.mobile_match_key(x.input), x.match_key,
  'RN-09 ' || x.id || ': mobile_match_key') FROM mobile_cases x ORDER BY x.id;

-- RN-07: CPF.
CREATE TEMP TABLE cpf_cases (id text, input text, digits text, valid boolean) ON COMMIT DROP;
INSERT INTO cpf_cases VALUES
${rows(c.cpf, (x) => `${lit(x.id)}, ${lit(x.input)}, ${lit(x.digits)}, ${bool(x.valid)}`)};
SELECT is(public.normalize_digits(x.input), x.digits,
  'RN-07 ' || x.id || ': normalize_digits') FROM cpf_cases x ORDER BY x.id;
SELECT is(public.is_valid_cpf(public.normalize_digits(x.input)), x.valid,
  'RN-07 ' || x.id || ': is_valid_cpf') FROM cpf_cases x ORDER BY x.id;

-- RN-15, DA-13: nascimento com o "hoje" fixo de cada caso.
CREATE TEMP TABLE birth_cases (id text, today date, birth date, problem text) ON COMMIT DROP;
INSERT INTO birth_cases VALUES
${rows(c.birthDate, (x) => `${lit(x.id)}, ${lit(x.today)}::date, ${lit(x.birth)}::date, ${lit(x.problem)}`)};
SELECT is(public.birth_date_problem(x.birth, x.today), x.problem,
  'RN-15 ' || x.id || ': birth_date_problem(' || coalesce(x.birth::text, 'NULL') || ', hoje ' || x.today || ')')
  FROM birth_cases x ORDER BY x.id;

-- RN-08: identificador de login.
CREATE TEMP TABLE identifier_cases (id text, email text, mobile text, cpf text, has_identifier boolean) ON COMMIT DROP;
INSERT INTO identifier_cases VALUES
${rows(c.identifier, (x) => `${lit(x.id)}, ${lit(x.email)}, ${lit(x.mobile)}, ${lit(x.cpf)}, ${bool(x.hasIdentifier)}`)};
SELECT is(public.member_has_login_identifier(x.email, x.mobile, x.cpf), x.has_identifier,
  'RN-08 ' || x.id || ': member_has_login_identifier') FROM identifier_cases x ORDER BY x.id;

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
    console.log(`gravado: ${SQL_PATH}`)
  }
}
