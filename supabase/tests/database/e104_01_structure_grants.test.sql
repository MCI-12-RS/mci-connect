-- E1.04 (PR 1): estrutura, grants, funções de normalização e funções internas.
-- Spec: docs/specs/e1-04-sign-in.md, "Modelo de dados e migrations", "Integridade e privilégios",
-- "Busca pelo cadastro" (passo 1 e índices), "Origem confiável" (DT-06), RN-02 a RN-04, RN-11.
--
-- Cobre:
--   - grants: sign_in_* só com EXECUTE para service_role (nem anon, nem authenticated);
--     funções de private sem EXECUTE para anon, authenticated e service_role; a tabela
--     private.sign_in_throttle sem privilégios para ninguém da API e com RLS ligado;
--   - o valor login_blocked do enum, o job e-104-sign-in-purge, a chave no Vault;
--   - normalize_mobile, mobile_match_key, is_valid_cpf, is_placeholder_email (DT-08);
--   - os três índices da busca, com o EXPLAIN anexado (diag);
--   - private.sign_in_origin_key (IPv4, IPv4 mapeado, IPv6 por /64) e private.sign_in_key;
--   - private.sign_in_purge (retenção, RN-11) e sign_in_discard_link (DA-13).
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(113);

-- ---------------------------------------------------------------------------
-- 1. Enum, tabela de controle, job, Vault
-- ---------------------------------------------------------------------------
SELECT ok('login_blocked' = ANY (enum_range(NULL::public.event_action)::text[]),
  'DT-11: event_action tem login_blocked');

SELECT has_table('private', 'sign_in_throttle', 'DT-03: private.sign_in_throttle existe');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.sign_in_throttle'::regclass), true,
  'Integridade: a tabela de controle tem RLS ligado (sem políticas)');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private' AND tablename = 'sign_in_throttle'), 0,
  'Integridade: a tabela de controle não tem políticas');
SELECT is((SELECT data_type FROM information_schema.columns
            WHERE table_schema = 'private' AND table_name = 'sign_in_throttle' AND column_name = 'key_hash'), 'bytea',
  'RN-11: key_hash é bytea (HMAC), nunca a chave em claro');
SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname) FROM pg_attribute a
            WHERE a.attrelid = 'private.sign_in_throttle'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  ARRAY['blocked_until', 'expires_at', 'failures', 'key_hash', 'kind']::text[],
  'RN-11: a tabela só tem kind, key_hash, failures, blocked_until e expires_at (nenhuma coluna de dado pessoal)');

SELECT is((SELECT count(*)::int FROM (
              SELECT r, p FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                     unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
               WHERE has_table_privilege(r, 'private.sign_in_throttle', p)) x), 0,
  'Integridade: anon, authenticated e service_role não têm nenhum privilégio na tabela de controle');
SELECT is((SELECT count(*)::int FROM pg_attribute a, unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE a.attrelid = 'private.sign_in_throttle'::regclass AND a.attnum > 0 AND NOT a.attisdropped
              AND (has_column_privilege(r, 'private.sign_in_throttle', a.attname, 'SELECT')
                OR has_column_privilege(r, 'private.sign_in_throttle', a.attname, 'UPDATE')
                OR has_column_privilege(r, 'private.sign_in_throttle', a.attname, 'INSERT'))), 0,
  'Integridade: nem por coluna');
SELECT is((SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_schema_privilege(r, 'private', 'USAGE')), 0,
  'Integridade: o schema private não tem USAGE para anon, authenticated nem service_role');

SELECT is((SELECT count(*)::int FROM cron.job WHERE jobname = 'e104-sign-in-purge'), 1,
  'RN-11: o job e104-sign-in-purge está agendado');
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'e104-sign-in-purge'), '*/10 * * * *',
  'RN-11: de 10 em 10 minutos');
SELECT matches((SELECT command FROM cron.job WHERE jobname = 'e104-sign-in-purge'), 'private\.sign_in_purge\(\)',
  'RN-11: o job chama private.sign_in_purge()');

SELECT is((SELECT count(*)::int FROM vault.decrypted_secrets WHERE name = 'sign_in_throttle_key'), 1,
  'DT-04: a chave do HMAC está no Vault (um segredo sign_in_throttle_key)');
SELECT matches((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sign_in_throttle_key'), '^[0-9a-f]{64}$',
  'DT-04: 32 bytes aleatórios em hexadecimal');

-- ---------------------------------------------------------------------------
-- 2. Grants das RPCs e das funções internas
-- ---------------------------------------------------------------------------
SELECT is(has_function_privilege('service_role', 'public.sign_in_attempt(text, text, text)', 'EXECUTE'), true,
  'Grants: service_role executa sign_in_attempt');
SELECT is(has_function_privilege('anon', 'public.sign_in_attempt(text, text, text)', 'EXECUTE'), false,
  'Grants: anon não executa sign_in_attempt');
SELECT is(has_function_privilege('authenticated', 'public.sign_in_attempt(text, text, text)', 'EXECUTE'), false,
  'Grants: authenticated não executa sign_in_attempt');
SELECT is(has_function_privilege('service_role', 'public.sign_in_record_login(uuid, uuid, text, text, text)', 'EXECUTE'), true,
  'Grants: service_role executa sign_in_record_login');
SELECT is(has_function_privilege('anon', 'public.sign_in_record_login(uuid, uuid, text, text, text)', 'EXECUTE'), false,
  'Grants: anon não executa sign_in_record_login');
SELECT is(has_function_privilege('authenticated', 'public.sign_in_record_login(uuid, uuid, text, text, text)', 'EXECUTE'), false,
  'Grants: authenticated não executa sign_in_record_login');
SELECT is(has_function_privilege('service_role', 'public.sign_in_discard_link(uuid)', 'EXECUTE'), true,
  'Grants: service_role executa sign_in_discard_link');
SELECT is(has_function_privilege('anon', 'public.sign_in_discard_link(uuid)', 'EXECUTE'), false,
  'Grants: anon não executa sign_in_discard_link');
SELECT is(has_function_privilege('authenticated', 'public.sign_in_discard_link(uuid)', 'EXECUTE'), false,
  'Grants: authenticated não executa sign_in_discard_link');

-- Nenhuma função public.sign_in_* escapa da regra (inclui as que o backend acrescentar).
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'sign\_in\_%'
              AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))), 0,
  'Grants: nenhuma public.sign_in_* tem EXECUTE para anon ou authenticated');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname LIKE 'sign\_in\_%' AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')), 0,
  'Grants: toda public.sign_in_* tem EXECUTE para service_role');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('sign_in_attempt', 'sign_in_record_login', 'sign_in_discard_link')
              AND p.prosecdef AND 'search_path=public' = ANY (p.proconfig)), 3,
  'DT-10: as três RPCs são SECURITY DEFINER com search_path = public');
SELECT ok((SELECT bool_or(c LIKE 'lock_timeout=%3s') FROM pg_proc p, unnest(p.proconfig) c
            WHERE p.oid = 'public.sign_in_attempt(text, text, text)'::regprocedure),
  'P-LOG-12: sign_in_attempt tem SET lock_timeout = 3s');

-- Funções de private: sem EXECUTE para a API.
SELECT cmp_ok((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'private' AND (p.proname LIKE 'sign\_in\_%' OR p.proname = 'parse_login_identifier')), '>=', 5,
  'Estrutura: private tem parse_login_identifier, sign_in_key, sign_in_origin_key, sign_in_lookup e sign_in_purge (E3: sign_in_check_legacy saiu, DT-08)');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE n.nspname = 'private' AND (p.proname LIKE 'sign\_in\_%' OR p.proname = 'parse_login_identifier')
              AND has_function_privilege(r, p.oid, 'EXECUTE')), 0,
  'Grants: nenhuma função interna do login tem EXECUTE para anon, authenticated ou service_role');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'private' AND p.proname IN ('parse_login_identifier', 'sign_in_key', 'sign_in_origin_key',
                  'sign_in_lookup', 'sign_in_check_legacy', 'sign_in_purge')),
  ARRAY['parse_login_identifier', 'sign_in_key', 'sign_in_lookup', 'sign_in_origin_key', 'sign_in_purge']::text[],
  'Estrutura: as cinco funções internas do spec existem; o ponto vazio sign_in_check_legacy saiu no E3 (DT-08)');

-- Funções de normalização: authenticated e service_role, sem anon, IMMUTABLE (aparecem em índices).
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('normalize_mobile', 'mobile_match_key', 'is_valid_cpf', 'is_placeholder_email')),
  ARRAY['is_placeholder_email', 'is_valid_cpf', 'mobile_match_key', 'normalize_mobile']::text[],
  'DT-08: as quatro funções públicas de normalização existem');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname IN ('normalize_mobile', 'mobile_match_key')
              AND p.provolatile = 'i'), 2,
  'DT-08: normalize_mobile e mobile_match_key são IMMUTABLE (usadas em índices)');
SELECT is(has_function_privilege('anon', 'public.normalize_mobile(text)', 'EXECUTE'), false, 'DT-08: anon não executa normalize_mobile');
SELECT is(has_function_privilege('anon', 'public.mobile_match_key(text)', 'EXECUTE'), false, 'DT-08: anon não executa mobile_match_key');
SELECT is(has_function_privilege('anon', 'public.is_valid_cpf(text)', 'EXECUTE'), false, 'DT-08: anon não executa is_valid_cpf');
SELECT is(has_function_privilege('anon', 'public.is_placeholder_email(text)', 'EXECUTE'), false, 'DT-08: anon não executa is_placeholder_email');
SELECT is(has_function_privilege('authenticated', 'public.normalize_mobile(text)', 'EXECUTE'), true, 'DT-08: authenticated executa normalize_mobile (índices de members)');
SELECT is(has_function_privilege('authenticated', 'public.mobile_match_key(text)', 'EXECUTE'), true, 'DT-08: authenticated executa mobile_match_key');
SELECT is(has_function_privilege('service_role', 'public.normalize_mobile(text)', 'EXECUTE'), true, 'DT-08: service_role executa normalize_mobile');
SELECT is(has_function_privilege('service_role', 'public.is_valid_cpf(text)', 'EXECUTE'), true, 'DT-08: service_role executa is_valid_cpf');

-- Anon não consegue chamar a RPC (42501), nem pelo SET ROLE.
CREATE FUNCTION pg_temp.as_role(_role text, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    RETURN '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RESET ROLE;
    RETURN _state;
  END;
END $$;
SELECT is(pg_temp.as_role('anon', $q$SELECT public.sign_in_attempt('x@y.z', 'senha', '203.0.113.1')$q$), '42501',
  'Grants: anon chamando sign_in_attempt recebe 42501');
SELECT is(pg_temp.as_role('authenticated', $q$SELECT public.sign_in_attempt('x@y.z', 'senha', '203.0.113.1')$q$), '42501',
  'Grants: authenticated chamando sign_in_attempt recebe 42501');
SELECT is(pg_temp.as_role('authenticated', $q$SELECT public.sign_in_record_login(gen_random_uuid(), gen_random_uuid(), 'email', 'a***@b.c')$q$), '42501',
  'Grants: authenticated não grava "Login realizado" (RN-15 a)');
SELECT is(pg_temp.as_role('authenticated', $q$SELECT public.sign_in_discard_link(gen_random_uuid())$q$), '42501',
  'Grants: authenticated não descarta links');
SELECT is(pg_temp.as_role('service_role', $q$SELECT * FROM private.sign_in_throttle$q$), '42501',
  'Integridade: nem a service_role lê private.sign_in_throttle');
SELECT is(pg_temp.as_role('authenticated', $q$SELECT private.sign_in_purge()$q$), '42501',
  'Integridade: ninguém limpa as tentativas pela API');

-- ---------------------------------------------------------------------------
-- 3. normalize_mobile e mobile_match_key (RN-03)
-- ---------------------------------------------------------------------------
SELECT is(public.normalize_mobile('(51) 98888-7777'), '51988887777', 'RN-03: máscara some');
SELECT is(public.normalize_mobile('+55 (51) 98888-7777'), '51988887777', 'RN-03 b: 55 com 13 dígitos sai');
SELECT is(public.normalize_mobile('551988887777'), '1988887777', 'RN-03 b: 55 com 12 dígitos sai (sobram 10)');
SELECT is(public.normalize_mobile('55999991234'), '55999991234', 'RN-03 b: com 11 dígitos o 55 é o DDD de Santa Maria e fica');
SELECT is(public.normalize_mobile('5599991234'), '5599991234', 'RN-03 b: com 10 dígitos o 55 também fica');
SELECT is(public.normalize_mobile('051 98888-7777'), '51988887777', 'RN-03 a: zeros à esquerda saem');
SELECT is(public.normalize_mobile('00051988887777'), '51988887777', 'RN-03 a: vários zeros');
SELECT is(public.normalize_mobile('9888-7777'), NULL, 'RN-03 c: sem DDD (8 dígitos) não é celular');
SELECT is(public.normalize_mobile('98888-7777'), NULL, 'RN-03 c: 9 dígitos não é celular');
SELECT is(public.normalize_mobile('123456789012'), NULL, 'RN-03 c: 12 dígitos sem 55 não é celular');
SELECT is(public.normalize_mobile('519888877771'), NULL, 'RN-03 c: 12 dígitos que não começam por 55 não são celular');
SELECT is(public.normalize_mobile(''), NULL, 'RN-03: vazio vira NULL');
SELECT is(public.normalize_mobile(NULL), NULL, 'RN-03: NULL vira NULL');
SELECT is(public.normalize_mobile('sem número'), NULL, 'RN-03: texto sem dígitos vira NULL');
SELECT is(public.mobile_match_key('(51) 98888-7777'), '5188887777', 'RN-03 e: 11 dígitos com 9 depois do DDD perdem o 9');
SELECT is(public.mobile_match_key('(51) 8888-7777'), '5188887777', 'RN-03 e: a forma de 10 dígitos tem a mesma chave');
SELECT is(public.mobile_match_key('(51) 98877-6655'), public.mobile_match_key('(51) 8877-6655'), 'RN-03 e: Gabi, as duas formas, mesma chave');
SELECT is(public.mobile_match_key('51888877771'), '51888877771', 'RN-03 e: 11 dígitos sem 9 depois do DDD ficam como estão');
SELECT is(public.mobile_match_key('9888-7777'), NULL, 'RN-03: sem celular válido, a chave é NULL');

-- ---------------------------------------------------------------------------
-- 4. is_valid_cpf e is_placeholder_email (RN-04, RN-01)
-- ---------------------------------------------------------------------------
SELECT is(public.is_valid_cpf('52998224725'), true, 'RN-04: CPF de Ana é válido');
SELECT is(public.is_valid_cpf('01234567890'), true, 'RN-04: CPF de Léo é válido (zero à esquerda mantido)');
SELECT is(public.is_valid_cpf('00000000191'), true, 'RN-04: 000.000.001-91 é válido');
SELECT is(public.is_valid_cpf('12345678909'), true, 'RN-04: 123.456.789-09 é válido');
SELECT is(public.is_valid_cpf('51988887704'), true, 'RN-05: o CPF de Davi é válido');
SELECT is(public.is_valid_cpf('52998224726'), false, 'RN-04: dígito verificador errado');
SELECT is(public.is_valid_cpf('11111111111'), false, 'RN-04, P-LOG-16: todos os dígitos iguais não é CPF');
SELECT is(public.is_valid_cpf('00000000000'), false, 'RN-04: zeros não é CPF');
SELECT is(public.is_valid_cpf('5299822472'), false, 'RN-04: 10 dígitos');
SELECT is(public.is_valid_cpf('529982247255'), false, 'RN-04: 12 dígitos');
SELECT is(public.is_valid_cpf('529.982.247-25'), false, 'DT-08: recebe só dígitos; com máscara é false');
SELECT is(coalesce(public.is_valid_cpf(NULL), false), false, 'RN-04: NULL não é CPF');
SELECT is(public.is_placeholder_email('bruno_ab12cd@mci12fakemail.com'), true, 'RN-01: o domínio fictício atual');
SELECT is(public.is_placeholder_email('  BRUNO_AB12CD@MCI12FAKEMAIL.COM '), true, 'RN-01: sem diferenciar maiúsculas nem espaços');
SELECT is(public.is_placeholder_email('ana.souza@exemplo.com'), false, 'RN-01: e-mail real não é fictício');
SELECT is(public.is_placeholder_email('x@mci12fakemail.com.br'), false, 'RN-01: só o domínio exato');
SELECT is(public.is_placeholder_email('mci12fakemail.com@exemplo.com'), false, 'RN-01: o domínio é o depois do @');
SELECT is(coalesce(public.is_placeholder_email(NULL), false), false, 'RN-01: NULL não é fictício');

-- ---------------------------------------------------------------------------
-- 5. private.sign_in_origin_key (DT-06, DA-2) e private.sign_in_key (DT-04)
-- ---------------------------------------------------------------------------
SELECT is(private.sign_in_origin_key('203.0.113.7'::inet), '203.0.113.7', 'DT-06: IPv4 conta pelo endereço');
SELECT is(private.sign_in_origin_key('::ffff:203.0.113.7'::inet), '203.0.113.7', 'DT-06: IPv4 mapeado em IPv6 conta como o IPv4');
SELECT is(private.sign_in_origin_key('::ffff:203.0.113.7'::inet), private.sign_in_origin_key('203.0.113.7'::inet),
  'DT-06: o mapeado e o IPv4 caem na mesma linha');
SELECT isnt(private.sign_in_origin_key('::ffff:203.0.113.7'::inet), private.sign_in_origin_key('::ffff:203.0.113.8'::inet),
  'DT-06: dois IPv4 mapeados diferentes não dividem um /64 só');
SELECT is(private.sign_in_origin_key('2001:db8:abcd:12::1'::inet), '2001:db8:abcd:12::/64', 'DA-2: IPv6 conta pelo /64');
SELECT is(private.sign_in_origin_key('2001:db8:abcd:12:ffff:ffff:ffff:ffff'::inet), '2001:db8:abcd:12::/64',
  'DA-2: o outro extremo do mesmo /64');
SELECT isnt(private.sign_in_origin_key('2001:db8:abcd:13::1'::inet), private.sign_in_origin_key('2001:db8:abcd:12::1'::inet),
  'DA-2: outro /64, outra origem');
SELECT is(private.sign_in_origin_key('127.0.0.1'::inet), '127.0.0.1', 'DT-06: a origem local');

SELECT is(octet_length(private.sign_in_key('identifier', 'c:52998224725')), 32, 'DT-04: HMAC-SHA256 tem 32 bytes');
SELECT is(private.sign_in_key('identifier', 'c:52998224725'), private.sign_in_key('identifier', 'c:52998224725'),
  'DT-04: determinístico');
SELECT isnt(private.sign_in_key('identifier', 'c:52998224725'), private.sign_in_key('identifier', 'c:52998224726'),
  'DT-04: muda com a chave');
SELECT isnt(private.sign_in_key('identifier', 'x:igual'), private.sign_in_key('origin', 'x:igual'),
  'DT-04: o tipo entra no HMAC');
SELECT is(encode(private.sign_in_key('identifier', 'e:ana.souza@exemplo.com'), 'hex') LIKE '%' || encode(convert_to('ana.souza', 'UTF8'), 'hex') || '%', false,
  'RN-11: o hash não carrega a chave em claro');

-- ---------------------------------------------------------------------------
-- 6. Índices da busca (RN-01, ponto 6 do PO)
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'members'
            AND indexname IN ('members_login_email_idx', 'members_login_cpf_idx', 'members_login_mobile_idx')), 3,
  'Índices: os três índices de busca existem');
SELECT matches((SELECT indexdef FROM pg_indexes WHERE indexname = 'members_login_email_idx'), 'normalize_email\(',
  'Índices: o do e-mail é de expressão normalize_email(email)');
SELECT matches((SELECT indexdef FROM pg_indexes WHERE indexname = 'members_login_cpf_idx'), 'normalize_digits\(',
  'Índices: o do CPF é de expressão normalize_digits(cpf)');
SELECT matches((SELECT indexdef FROM pg_indexes WHERE indexname = 'members_login_mobile_idx'), 'mobile_match_key\(',
  'Índices: o do celular é de expressão mobile_match_key(mobile_whatsapp)');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE indexname IN ('members_login_email_idx', 'members_login_cpf_idx', 'members_login_mobile_idx')
            AND indexdef ~* '\mWHERE\M'), 0,
  'Índices: sem predicado (o segundo estágio procura os excluídos)');

-- EXPLAIN anexado: com a varredura sequencial desligada, cada consulta usa o índice dela.
CREATE FUNCTION pg_temp.explain_of(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _l text; _out text := '';
BEGIN
  FOR _l IN EXECUTE 'EXPLAIN (COSTS OFF) ' || _sql LOOP _out := _out || _l || E'\n'; END LOOP;
  RETURN _out;
END $$;
SET LOCAL enable_seqscan = off;
SELECT matches(pg_temp.explain_of($q$SELECT id FROM public.members WHERE public.normalize_email(email) = 'ana.souza@exemplo.com'$q$),
  'members_login_email_idx', 'Índices: a busca por e-mail usa members_login_email_idx');
SELECT matches(pg_temp.explain_of($q$SELECT id FROM public.members WHERE public.normalize_digits(cpf) = '52998224725'$q$),
  'members_login_cpf_idx', 'Índices: a busca por CPF usa members_login_cpf_idx');
SELECT matches(pg_temp.explain_of($q$SELECT id FROM public.members WHERE public.mobile_match_key(mobile_whatsapp) = '5188887777'
                                  AND public.normalize_mobile(mobile_whatsapp) = '51988887777'$q$),
  'members_login_mobile_idx', 'Índices: a busca por celular usa members_login_mobile_idx');
SELECT diag(E'EXPLAIN anexado ao PR (RN-01, ponto 6 do PO):\n'
  || pg_temp.explain_of($q$SELECT id FROM public.members WHERE public.normalize_email(email) = 'ana.souza@exemplo.com' AND deleted_at IS NULL$q$)
  || pg_temp.explain_of($q$SELECT id FROM public.members WHERE public.normalize_digits(cpf) = '52998224725' AND deleted_at IS NULL$q$)
  || pg_temp.explain_of($q$SELECT id FROM public.members WHERE public.mobile_match_key(mobile_whatsapp) = '5188887777' AND deleted_at IS NULL$q$));
RESET enable_seqscan;

-- ---------------------------------------------------------------------------
-- 7. Retenção: private.sign_in_purge (RN-11)
-- ---------------------------------------------------------------------------
INSERT INTO private.sign_in_throttle (kind, key_hash, failures, blocked_until, expires_at) VALUES
  ('origin',     private.sign_in_key('origin',     'o:198.18.0.1'), '{}', NULL, now() - interval '25 hours'),
  ('identifier', private.sign_in_key('identifier', 'e:velha@teste.invalid'), '{}', now() - interval '24 hours', now() - interval '24 hours'),
  ('origin',     private.sign_in_key('origin',     'o:198.18.0.2'), '{}', NULL, now() - interval '1 minute'),
  ('origin',     private.sign_in_key('origin',     'o:198.18.0.3'), ARRAY[now()], NULL, now() + interval '15 minutes'),
  ('identifier', private.sign_in_key('identifier', 'e:bloqueada@teste.invalid'), '{}', now() + interval '10 minutes', now() + interval '10 minutes');
SELECT private.sign_in_purge();
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle
            WHERE key_hash IN (private.sign_in_key('origin', 'o:198.18.0.1'), private.sign_in_key('identifier', 'e:velha@teste.invalid'),
                               private.sign_in_key('origin', 'o:198.18.0.2'))), 0,
  'RN-11: linhas com expires_at vencido (inclusive de 25 h atrás) são apagadas');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle
            WHERE key_hash IN (private.sign_in_key('origin', 'o:198.18.0.3'), private.sign_in_key('identifier', 'e:bloqueada@teste.invalid'))), 2,
  'RN-11: linhas ainda dentro do prazo (inclusive a bloqueada) ficam');
SELECT lives_ok($q$SELECT private.sign_in_purge()$q$, 'RN-11: a limpeza roda sem erro com a tabela quase vazia');
SELECT is((SELECT count(*)::int FROM private.sign_in_throttle
            WHERE key_hash = private.sign_in_key('origin', 'o:198.18.0.3')), 1,
  'RN-11: e é idempotente');

-- ---------------------------------------------------------------------------
-- 8. sign_in_discard_link (DA-13, risco 9)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, recovery_token)
VALUES ('a1040100-0000-0000-0000-000000000001', 'e104-discard@teste.invalid',
        extensions.crypt('Senha#1', extensions.gen_salt('bf', 10)), now(), 'token-pendente-de-teste');
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, recovery_token)
VALUES ('a1040100-0000-0000-0000-000000000002', 'e104-discard-outra@teste.invalid',
        extensions.crypt('Senha#2', extensions.gen_salt('bf', 10)), now(), 'token-da-outra-conta');
INSERT INTO auth.one_time_tokens (id, user_id, token_type, token_hash, relates_to) VALUES
  (gen_random_uuid(), 'a1040100-0000-0000-0000-000000000001', 'recovery_token', 'hash-e104-discard-1', 'e104-discard@teste.invalid'),
  (gen_random_uuid(), 'a1040100-0000-0000-0000-000000000002', 'recovery_token', 'hash-e104-discard-2', 'e104-discard-outra@teste.invalid');
SELECT lives_ok($q$SELECT public.sign_in_discard_link('a1040100-0000-0000-0000-000000000001')$q$,
  'DA-13: descartar o link da conta roda');
SELECT is((SELECT count(*)::int FROM auth.one_time_tokens WHERE user_id = 'a1040100-0000-0000-0000-000000000001' AND token_type = 'recovery_token'), 0,
  'DA-13: o token pendente da conta some de auth.one_time_tokens');
SELECT is((SELECT coalesce(recovery_token, '') FROM auth.users WHERE id = 'a1040100-0000-0000-0000-000000000001'), '',
  'DA-13: e auth.users.recovery_token é limpo');
SELECT is((SELECT count(*)::int FROM auth.one_time_tokens WHERE user_id = 'a1040100-0000-0000-0000-000000000002'), 1,
  'DA-13: o token de outra conta não é tocado');
SELECT is((SELECT recovery_token FROM auth.users WHERE id = 'a1040100-0000-0000-0000-000000000002'), 'token-da-outra-conta',
  'DA-13: nem o recovery_token de outra conta');

SELECT * FROM finish();

ROLLBACK;
