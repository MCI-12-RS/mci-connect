-- GERADO por supabase/tests/fixtures/generate-legacy-md5-cases.mjs a partir de
-- supabase/tests/fixtures/legacy-md5-cases.json (MD5 do pacote md5 2.3.0, o do legado).
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

SELECT plan(69);

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
  (1, 'ascii', convert_from(decode('53656e6861313233', 'hex'), 'UTF8'), '10a9c136d796bab18d3e144092a4f20a', 8, false, ARRAY[convert_from(decode('73656e6861313233', 'hex'), 'UTF8'), convert_from(decode('53656e686131323320', 'hex'), 'UTF8')]::text[]),
  (2, 'cedilha_composto', convert_from(decode('477261c3a7613230323421', 'hex'), 'UTF8'), '2915f1e67e59d86d1346886617953647', 11, false, ARRAY[convert_from(decode('47726163613230323421', 'hex'), 'UTF8'), convert_from(decode('47726163cca7613230323421', 'hex'), 'UTF8')]::text[]),
  (3, 'cedilha_decomposto', convert_from(decode('47726163cca7613230323421', 'hex'), 'UTF8'), '3e6d9e6454cfa8e10a6ed58afc3b8ec4', 12, false, ARRAY[convert_from(decode('477261c3a7613230323421', 'hex'), 'UTF8')]::text[]),
  (4, 'espacos_pontas', convert_from(decode('206d65736120617a756c20', 'hex'), 'UTF8'), 'b448787fd66c1ad0bd363b294096e395', 11, false, ARRAY[convert_from(decode('6d65736120617a756c', 'hex'), 'UTF8'), convert_from(decode('206d65736120617a756c', 'hex'), 'UTF8')]::text[]),
  (5, 'maiusculas', convert_from(decode('4d657361417a756c', 'hex'), 'UTF8'), '744efdb23162dbab13e88e5b3d3ec843', 8, false, ARRAY[convert_from(decode('6d657361617a756c', 'hex'), 'UTF8'), convert_from(decode('4d455341415a554c', 'hex'), 'UTF8')]::text[]),
  (6, 'emoji', convert_from(decode('66c3a920f09f998f2032303234', 'hex'), 'UTF8'), '5c98c6e4ef9b1c2be412664f0622f79a', 13, false, ARRAY[convert_from(decode('66c3a9202032303234', 'hex'), 'UTF8')]::text[]),
  (7, 'd11_123456', convert_from(decode('313233343536', 'hex'), 'UTF8'), 'e10adc3949ba59abbe56e057f20f883e', 6, false, ARRAY[convert_from(decode('31323334353637', 'hex'), 'UTF8')]::text[]),
  (8, 'letras_72', convert_from(decode('616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161', 'hex'), 'UTF8'), '96b39b8b95e016c79d104d83395b8133', 72, false, ARRAY[convert_from(decode('6161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161616161', 'hex'), 'UTF8')]::text[]),
  (9, 'letras_80', convert_from(decode('6262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262', 'hex'), 'UTF8'), '491077e8636d39b017a545f6ad68d299', 80, false, ARRAY[convert_from(decode('626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262', 'hex'), 'UTF8'), convert_from(decode('62626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262626262', 'hex'), 'UTF8')]::text[]),
  (10, 'cedilha_40', convert_from(decode('c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7', 'hex'), 'UTF8'), '5fe95cfac9801f08fc35678c9f53561a', 80, false, ARRAY[convert_from(decode('c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7c3a7', 'hex'), 'UTF8')]::text[]),
  (11, 'vazio', convert_from(decode('', 'hex'), 'UTF8'), 'd41d8cd98f00b204e9800998ecf8427e', 0, true, ARRAY[]::text[]);

SELECT is(current_setting('server_encoding'), 'UTF8', 'DT-03: o banco é UTF8 (o md5 é sobre os bytes UTF-8)');

-- Massa: um pastor e um membro com conta (sem senha no cofre) por caso.
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e3md5-' || n || '@exemplo.com', now() FROM md5_cases;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, email)
VALUES (pg_temp.m(0), 'Pastor Casos', 'M', true, NULL, false, true, 'e3md5-0@exemplo.com');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, auth_user_id, email)
SELECT pg_temp.m(n), 'Pessoa Caso', 'F', pg_temp.m(0), true, true, pg_temp.u(n), 'e3md5-' || n || '@exemplo.com' FROM md5_cases;

-- 1. md5() do banco = o do pacote do legado.
SELECT is(md5(c.password), c.md5, 'DT-03 ' || c.id || ': md5() do Postgres = md5 2.3.0')
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
