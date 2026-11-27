#!/usr/bin/env node
// E3.03 (tarefa 5): a tabela de casos do MD5 da senha do legado.
//
// O legado calcula o MD5 no navegador pelo pacote `md5` 2.3.0, sobre a senha
// exatamente como foi digitada (UTF-8, hexadecimal minúsculo, sem normalizar).
// O novo confere com md5(text) do Postgres (DT-03 do spec E3). Três lugares
// precisam dizer o mesmo:
//   1. o pacote `md5` 2.3.0 (devDependency exata): a referência do legado;
//   2. supabase/tests/fixtures/legacy-md5-cases.json: os casos, com o MD5 que o
//      pacote calcula (null quando o pacote não calcula: surrogate isolado);
//   3. supabase/tests/database/e3_02_md5_cases.test.sql: o pgTAP, gerado do
//      JSON (md5() do banco = o do pacote, e a entrada pela sign_in_attempt com
//      a credencial carregada pela add_legacy_credential).
//
//   node supabase/tests/fixtures/generate-legacy-md5-cases.mjs            # grava o JSON e o SQL
//   node supabase/tests/fixtures/generate-legacy-md5-cases.mjs --json     # só imprime o JSON
//   node supabase/tests/fixtures/generate-legacy-md5-cases.mjs --stdout   # só imprime o SQL
//
// O Vitest src/test/legacy-md5-cases-sync.test.ts falha se o JSON ou o SQL
// gravados ficarem diferentes do que esta saída produz.
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const md5 = require('md5')
const md5Version = require('md5/package.json').version

const here = dirname(fileURLToPath(import.meta.url))
export const JSON_PATH = join(here, 'legacy-md5-cases.json')
export const SQL_PATH = join(here, '..', 'database', 'e3_02_md5_cases.test.sql')

// Os casos. `db: false`: o texto não chega ao banco (DA-1: U+0000 ou surrogate
// isolado; a sign-in responde 401 antes da RPC). `wrong`: variações que não
// podem entrar (conferidas antes da senha certa). `unusable`: a carga recusa
// (RN-01 c).
const CASES = [
  { id: 'ascii', description: 'ASCII simples', password: 'Senha123', wrong: ['senha123', 'Senha123 '] },
  { id: 'cedilha_composto', description: '"ç" composto (U+00E7), a forma comum do teclado', password: 'Graça2024!',
    wrong: ['Graca2024!', 'Graça2024!'] },
  { id: 'cedilha_decomposto', description: '"c" + cedilha combinante (U+0327): outro MD5, sem normalizar', password: 'Graça2024!',
    wrong: ['Graça2024!'] },
  { id: 'espacos_pontas', description: 'espaços nas pontas: a senha como veio, sem tirar espaços', password: ' mesa azul ',
    wrong: ['mesa azul', ' mesa azul'] },
  { id: 'maiusculas', description: 'maiúsculas diferenciam', password: 'MesaAzul', wrong: ['mesaazul', 'MESAAZUL'] },
  { id: 'emoji', description: 'emoji (fora do BMP, par UTF-16, 4 bytes em UTF-8)', password: 'fé 🙏 2024', wrong: ['fé  2024'] },
  { id: 'd11_123456', description: 'a senha inicial 123456', password: '123456', wrong: ['1234567'] },
  { id: 'letras_72', description: '72 letras (72 bytes, o limite do bcrypt)', password: 'a'.repeat(72), wrong: ['a'.repeat(71)] },
  { id: 'letras_80', description: '80 letras sem acento (acima de 72 bytes, RN-05)', password: 'b'.repeat(80),
    wrong: ['b'.repeat(72), 'b'.repeat(79)] },
  { id: 'cedilha_40', description: '40 "ç" = 80 bytes', password: 'ç'.repeat(40), wrong: ['ç'.repeat(36)] },
  { id: 'vazio', description: 'texto vazio: o MD5 que a carga recusa (RN-01 c)', password: '', unusable: true },
  { id: 'surrogate_isolado', description: 'surrogate isolado: o pacote não calcula; nunca confere (RN-02, DA-1)',
    password: 'abc\ud800', db: false },
  { id: 'nul', description: 'U+0000: o banco não guarda; nunca confere (DA-1)', password: 'abc\u0000', db: false },
]

/** O MD5 do pacote do legado, ou null quando ele não calcula (lança). */
export function legacyMd5(password) {
  try {
    return md5(password)
  } catch {
    return null
  }
}

const utf8Hex = (s) => Buffer.from(s, 'utf8').toString('hex')

/** Escapa tudo o que não é ASCII visível: o JSON fica legível e sem ambiguidade (ç composto × decomposto). */
function asciiJson(value) {
  return JSON.stringify(value, null, 2).replace(/[^\x20-\x7e\n]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

export function buildJson() {
  const cases = CASES.map((c) => ({
    id: c.id,
    description: c.description,
    password: c.password,
    bytes: legacyMd5(c.password) === null ? null : Buffer.byteLength(c.password, 'utf8'),
    md5: legacyMd5(c.password),
    db: c.db !== false,
    unusable: c.unusable === true,
    wrong: c.wrong ?? [],
  }))
  return asciiJson({ generator: 'supabase/tests/fixtures/generate-legacy-md5-cases.mjs', md5_package: md5Version, cases }) + '\n'
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
// O texto em SQL pelos bytes UTF-8: nada depende do encoding do arquivo.
const txt = (s) => `convert_from(decode(${lit(utf8Hex(s))}, 'hex'), 'UTF8')`

export function generateSql(json) {
  const { cases } = JSON.parse(json)
  const db = cases.filter((c) => c.db)
  const usable = db.filter((c) => !c.unusable)
  const nWrong = usable.reduce((n, c) => n + c.wrong.length, 0)
  // md5 por caso + carga por caso + (ok e credential) por caso utilizável + 1 por variação errada
  // + credencial descartada (≤ 72 bytes) ou mantida (> 72) por caso utilizável + 2 do fim.
  const plan = db.length + db.length + usable.length * 2 + nWrong + usable.length + 2
  const rows = db.map(
    (c, i) =>
      `  (${i + 1}, ${lit(c.id)}, ${txt(c.password)}, ${lit(c.md5)}, ${c.bytes}, ${c.unusable}, ` +
      `ARRAY[${c.wrong.map(txt).join(', ')}]::text[])`,
  )
  return `-- GERADO por supabase/tests/fixtures/generate-legacy-md5-cases.mjs a partir de
-- supabase/tests/fixtures/legacy-md5-cases.json (MD5 do pacote md5 ${md5Version}, o do legado).
-- NÃO EDITE À MÃO: mude o gerador e rode
--   node supabase/tests/fixtures/generate-legacy-md5-cases.mjs
-- (o Vitest src/test/legacy-md5-cases-sync.test.ts falha se este arquivo ficar desatualizado).
--
-- E3.03 (tarefa 5), RN-01, RN-02, RN-05, DT-03, DT-04: para cada caso que chega ao banco,
--   - md5() do Postgres = o MD5 do pacote do legado (UTF-8, hexadecimal minúsculo, sem normalizar);
--   - a carga (add_legacy_credential) com esse MD5: created (ou unusable_md5 no texto vazio);
--   - as variações erradas não entram (Senha incorreta, credencial mantida);
--   - a senha certa entra pela sign_in_attempt com credential = legacy; até 72 bytes a credencial
--     some (a senha vai para o cofre), acima dela fica, marcada como usada (DA-2).
-- Os casos com db = false (surrogate isolado, U+0000) não chegam ao banco (DA-1: a sign-in
-- responde 401 antes da RPC; Vitest do contrato).
-- Spec: docs/specs/e3-login-legado.md. Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(${plan});

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a3020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c3020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE TEMP SEQUENCE origin_seq;
CREATE FUNCTION pg_temp.att(_identifier text, _password text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _s bigint := nextval('origin_seq');
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    _out := public.sign_in_attempt(_identifier, _password, '198.19.' || ((_s / 250) % 250) || '.' || (_s % 250 + 1));
    EXECUTE 'RESET ROLE';
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    RETURN jsonb_build_object('error', _state);
  END;
END $$;

CREATE TEMP TABLE md5_cases (n int, id text, password text, md5 text, bytes int, unusable boolean, wrong text[]) ON COMMIT DROP;
INSERT INTO md5_cases VALUES
${rows.join(',\n')};

SELECT is(current_setting('server_encoding'), 'UTF8', 'DT-03: o banco é UTF8 (o md5 é sobre os bytes UTF-8)');

-- Massa: um pastor e um membro com conta (sem senha no cofre) por caso.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e3md5-' || n || '@exemplo.com', now() FROM md5_cases;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, email)
VALUES (pg_temp.m(0), 'Pastor Casos', 'M', true, NULL, false, true, 'e3md5-0@exemplo.com');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, email)
SELECT pg_temp.m(n), 'Pessoa Caso', 'F', pg_temp.m(0), true, true, pg_temp.u(n), 'e3md5-' || n || '@exemplo.com' FROM md5_cases;

-- 1. md5() do banco = o do pacote do legado.
SELECT is(md5(c.password), c.md5, 'DT-03 ' || c.id || ': md5() do Postgres = md5 ${md5Version}')
  FROM md5_cases c ORDER BY c.n;

-- 2. A carga com o MD5 do pacote.
SELECT is(private.add_legacy_credential(pg_temp.m(c.n), c.md5),
          CASE WHEN c.unusable THEN 'unusable_md5' ELSE 'created' END,
          'RN-01 ' || c.id || ': a carga ' || CASE WHEN c.unusable THEN 'recusa o MD5 do texto vazio' ELSE 'cria a credencial' END)
  FROM md5_cases c ORDER BY c.n;

-- 3. As variações erradas não entram, e a credencial continua.
SELECT is(pg_temp.att('e3md5-' || c.n || '@exemplo.com', w.pw) ->> 'result', 'invalid',
          'RN-02 ' || c.id || ': a variação ' || w.k || ' não entra')
  FROM md5_cases c, unnest(c.wrong) WITH ORDINALITY AS w(pw, k)
 WHERE NOT c.unusable ORDER BY c.n, w.k;
DELETE FROM private.sign_in_throttle;

-- 4. A senha certa entra pela credencial legada.
CREATE TEMP TABLE md5_results ON COMMIT DROP AS
SELECT c.n, pg_temp.att('e3md5-' || c.n || '@exemplo.com', c.password) AS r
  FROM md5_cases c WHERE NOT c.unusable ORDER BY c.n;
SELECT is(r.r ->> 'result', 'ok', 'RN-04 ' || c.id || ': a senha certa entra')
  FROM md5_cases c JOIN md5_results r USING (n) ORDER BY c.n;
SELECT is(r.r ->> 'credential', 'legacy', 'RN-13 a ' || c.id || ': pela credencial legada')
  FROM md5_cases c JOIN md5_results r USING (n) ORDER BY c.n;

-- 5. Até 72 bytes a senha vai para o cofre e a credencial some; acima, fica (usada, DA-2).
SELECT is((SELECT jsonb_build_object('hash', l.legacy_hash IS NOT NULL, 'used', l.used_at IS NOT NULL,
                                     'vault', p.password_hash IS NOT NULL)
             FROM private.legacy_credentials l
             LEFT JOIN private.account_passwords p ON p.auth_user_id = pg_temp.u(c.n)
            WHERE l.member_id = pg_temp.m(c.n)),
          jsonb_build_object('hash', c.bytes > 72, 'used', true, 'vault', c.bytes <= 72),
          'RN-04, DA-2 ' || c.id || ': ' || CASE WHEN c.bytes > 72 THEN 'acima de 72 bytes a credencial fica, usada'
                                                ELSE 'a senha vai para o cofre e a credencial some' END)
  FROM md5_cases c WHERE NOT c.unusable ORDER BY c.n;

SELECT is((SELECT count(*)::int FROM private.legacy_credential_problems()), 0, 'Reconciliação: legacy_credential_problems() vazia');

SELECT * FROM finish();

ROLLBACK;
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const json = buildJson()
  if (process.argv.includes('--json')) process.stdout.write(json)
  else if (process.argv.includes('--stdout')) process.stdout.write(generateSql(json))
  else {
    writeFileSync(JSON_PATH, json)
    writeFileSync(SQL_PATH, generateSql(json))
    console.log(`gravados: ${JSON_PATH} e ${SQL_PATH}`)
  }
}
