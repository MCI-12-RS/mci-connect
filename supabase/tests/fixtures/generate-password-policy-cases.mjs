#!/usr/bin/env node
// E2.03 (tarefa 5): gera o pgTAP da política de senha a partir da tabela única de casos
// (password-policy-cases.json), a mesma que o Vitest da tela lê (PR 2).
//
//   node supabase/tests/fixtures/generate-password-policy-cases.mjs           # grava o SQL
//   node supabase/tests/fixtures/generate-password-policy-cases.mjs --stdout  # só imprime
//
// Um teste do Vitest (src/test/password-policy-cases-sync.test.ts) falha se o SQL gravado
// ficar diferente do que esta saída produz.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const CASES_PATH = join(here, 'password-policy-cases.json')
export const SQL_PATH = join(here, '..', 'database', 'e203_02_policy.test.sql')

const CONTEXTS = ['policy', 'login', 'initial', 'change_voluntary', 'change_forced']
const lit = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

export function generate(cases) {
  const seen = new Set()
  const rows = cases.map((c) => {
    if (!CONTEXTS.includes(c.context)) throw new Error(`contexto desconhecido em ${c.id}: ${c.context}`)
    if (seen.has(c.id)) throw new Error(`id duplicado: ${c.id}`)
    seen.add(c.id)
    const p = c.personal ?? {}
    return (
      `  (${lit(c.id)}, ${lit(c.context)}, ${lit(c.password)}, ${lit(p.cpf)}, ${lit(p.mobile)}, ` +
      `${lit(p.birth_date)}::date, ${lit(p.email)}, ${lit(c.current_password)}, ${lit(c.confirmation)}, ` +
      `${lit(c.expected)}, ${lit(c.field)}, ${c.server_only ? 'true' : 'false'})`
    )
  })
  const count = (ctxs) => cases.filter((c) => ctxs.includes(c.context)).length
  const plan = count(['policy', 'login']) * 2 + count(['initial', 'change_voluntary', 'change_forced']) + 4
  return `-- GERADO por supabase/tests/fixtures/generate-password-policy-cases.mjs a partir de
-- supabase/tests/fixtures/password-policy-cases.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-password-policy-cases.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.03 (PR 1, tarefa 5): a política de senha (RN-13), a senha inicial (RN-07) e as trocas (RN-10 a RN-13)
-- sobre a tabela única de casos, inclusive os server_only (a lista de senhas comuns, só do banco).
--   policy e login: private.password_policy_violation e public.check_password_policy (service_role);
--   initial:        public.set_initial_password (conta nova, sem senha);
--   change_*:       public.change_own_password (voluntária com a senha atual certa; obrigatória com a marca).
-- Cada caso de initial e de change_* roda num subbloco que é desfeito (a massa não acumula).
-- Spec: docs/specs/e2-03-senha.md, RN-07, RN-10, RN-11, RN-13, DA-4 a DA-7, UX-08.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(${plan});

CREATE TEMP TABLE policy_cases (
  id text, context text, password text, cpf text, mobile text, birth_date date, email text,
  current_password text, confirmation text, expected text, field text, server_only boolean
) ON COMMIT DROP;

INSERT INTO policy_cases VALUES
${rows.join(',\n')};

-- Chamada como service_role (o papel da Edge Function).
CREATE FUNCTION pg_temp.as_service(_sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _msg text; _detail text; _hint text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state, 'message', _msg, 'hint', nullif(_hint, ''),
                              'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb END);
  END;
END $$;

-- Senha inicial de um caso: o código de erro (app_error) ou 'ok:<senha gravada>:<motivo da marca>'.
CREATE FUNCTION pg_temp.run_initial(_c policy_cases) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _uid uuid := gen_random_uuid(); _r jsonb; _out text;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (_uid, 'e203-ini-' || replace(_uid::text, '-', '') || '@teste.invalid', now());
    _r := pg_temp.as_service(format('SELECT to_jsonb(public.set_initial_password(%L, %L, %L, %L, %L, %L::date, %L))',
                                    _uid, gen_random_uuid(), _c.password, _c.cpf, _c.mobile, _c.birth_date, _c.email));
    IF _r ? 'error' THEN
      _out := CASE WHEN _r ->> 'hint' = 'app_error' THEN _r -> 'detail' ->> 'code' ELSE 'ERR ' || (_r ->> 'error') END
              || '|vault=' || (SELECT count(*) FROM private.account_passwords WHERE auth_user_id = _uid);
    ELSE
      SELECT 'ok|' || (CASE WHEN extensions.crypt('123456', p.password_hash) = p.password_hash THEN '123456'
                            WHEN extensions.crypt(_c.password, p.password_hash) = p.password_hash THEN 'digitada' ELSE 'outra' END)
             || '|' || coalesce(p.must_change_reason, '-') || '|' || coalesce(p.temp_expires_at::text, 'sem validade')
        INTO _out FROM private.account_passwords p WHERE p.auth_user_id = _uid;
    END IF;
    RAISE EXCEPTION '%', _out USING ERRCODE = 'E2030';
  EXCEPTION WHEN SQLSTATE 'E2030' THEN
    GET STACKED DIAGNOSTICS _out = MESSAGE_TEXT;
  END;
  RETURN _out;
END $$;

-- Troca de um caso: result|code|field (a senha atual certa vai para o cofre; a obrigatória leva a marca).
CREATE FUNCTION pg_temp.run_change(_c policy_cases) RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  _uid uuid := gen_random_uuid(); _mid uuid := gen_random_uuid(); _sid uuid := gen_random_uuid();
  _cur text := CASE WHEN coalesce(_c.current_password, '') = '' THEN 'Caminho2024' ELSE _c.current_password END;
  _r jsonb; _out text;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, email_confirmed_at)
    VALUES (_uid, 'e203-chg-' || replace(_uid::text, '-', '') || '@teste.invalid', now());
    INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, is_active, auth_user_id, cpf, mobile_whatsapp, birth_date, email)
    VALUES (_mid, 'Caso ' || _c.id, 'M', true, false, true, _uid, _c.cpf,
            CASE WHEN _c.cpf IS NULL AND _c.email IS NULL THEN '51900000000' ELSE _c.mobile END,
            _c.birth_date, _c.email);
    INSERT INTO auth.sessions (id, user_id) VALUES (_sid, _uid);
    PERFORM private.write_password(_uid, _mid, _cur, NULL);
    IF _c.context = 'change_forced' THEN
      PERFORM private.set_must_change(_uid, 'reset', now() + interval '7 days');
    END IF;
    _r := pg_temp.as_service(format('SELECT public.change_own_password(%L, %L, %L, %L, %L, %L, %L, %L)',
            _uid, _sid, CASE _c.context WHEN 'change_forced' THEN 'forced' ELSE 'voluntary' END,
            CASE _c.context WHEN 'change_forced' THEN NULL ELSE _c.current_password END,
            _c.password, _c.confirmation, '203.0.113.7', gen_random_uuid()));
    _out := coalesce(_r ->> 'result', 'ERR ' || (_r ->> 'error') || ' ' || (_r ->> 'message'))
            || '|' || coalesce(_r ->> 'code', '-') || '|' || coalesce(_r ->> 'field', '-');
    RAISE EXCEPTION '%', _out USING ERRCODE = 'E2030';
  EXCEPTION WHEN SQLSTATE 'E2030' THEN
    GET STACKED DIAGNOSTICS _out = MESSAGE_TEXT;
  END;
  RETURN _out;
END $$;

-- ---------------------------------------------------------------------------
-- policy e login: o ponto único da política, e a função que a Edge Function chama.
-- ---------------------------------------------------------------------------
SELECT is(private.password_policy_violation(c.password, c.cpf, c.mobile, c.birth_date, c.email), c.expected,
  'RN-13 ' || c.id || ': private.password_policy_violation' || CASE WHEN c.server_only THEN ' (server_only)' ELSE '' END)
FROM policy_cases c WHERE c.context IN ('policy', 'login') ORDER BY c.id;

SELECT is(pg_temp.as_service(format('SELECT to_jsonb(public.check_password_policy(%L, %L, %L, %L::date, %L))',
                                    c.password, c.cpf, c.mobile, c.birth_date, c.email)) #>> '{}', c.expected,
  'RN-13 ' || c.id || ': public.check_password_policy como service_role')
FROM policy_cases c WHERE c.context IN ('policy', 'login') ORDER BY c.id;

-- ---------------------------------------------------------------------------
-- initial (RN-07): vazia ou exatamente 123456 grava 123456 sem a política; o resto passa pela política.
-- A marca é "initial", sem validade. Recusada: nada no cofre.
-- ---------------------------------------------------------------------------
-- Um comando por caso (\\gexec): o teto de 5 s da senha (DT-19 do E1.04) conta desde o início do comando,
-- e todos os casos num comando só somariam o custo do bcrypt e da Auditoria de cada cadastro.
SELECT format($q$SELECT is(pg_temp.run_initial(c),
  CASE WHEN c.expected IS NOT NULL THEN c.expected || '|vault=0'
       ELSE 'ok|' || CASE WHEN c.password IN ('', '123456') THEN '123456' ELSE 'digitada' END || '|initial|sem validade' END,
  'RN-07 ' || c.id || ': set_initial_password')
FROM policy_cases c WHERE c.id = %L$q$, c.id)
FROM policy_cases c WHERE c.context = 'initial' ORDER BY c.id \\gexec

-- ---------------------------------------------------------------------------
-- change_voluntary e change_forced (RN-10 a RN-13, DA-7): vazios, política, "igual à atual", confirmação.
-- ---------------------------------------------------------------------------
SELECT format($q$SELECT is(pg_temp.run_change(c),
  CASE WHEN c.expected IS NULL THEN 'ok|-|-'
       WHEN c.expected = 'empty_fields' THEN 'empty_fields|-|-'
       ELSE 'invalid|' || c.expected || '|' || c.field END,
  'RN-13 ' || c.id || ': change_own_password (' || c.context || ')')
FROM policy_cases c WHERE c.id = %L$q$, c.id)
FROM policy_cases c WHERE c.context IN ('change_voluntary', 'change_forced') ORDER BY c.id \\gexec

-- ---------------------------------------------------------------------------
-- Conferência de sincronia da própria tabela (o Vitest confere o SQL gerado).
-- ---------------------------------------------------------------------------
SELECT ok((SELECT count(*) FROM policy_cases WHERE server_only) >= 1, 'a tabela traz casos server_only (a lista de senhas comuns)');
SELECT ok((SELECT count(DISTINCT context) FROM policy_cases) = 5, 'a tabela cobre os cinco contextos');
SELECT is((SELECT count(*)::int FROM private.common_passwords), (SELECT count(*)::int FROM private.common_passwords WHERE password = private.fold_password(password)),
  'a lista de senhas comuns está na forma dobrada (minúscula, sem acento)');
SELECT ok((SELECT count(*) FROM private.common_passwords) >= 1000, 'a lista de senhas comuns tem pelo menos 1.000 entradas');

SELECT * FROM finish();

ROLLBACK;
`
}

export function readCases() {
  return JSON.parse(readFileSync(CASES_PATH, 'utf8')).cases
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = generate(readCases())
  if (process.argv.includes('--stdout')) process.stdout.write(out)
  else writeFileSync(SQL_PATH, out)
}
