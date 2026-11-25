-- E2.04 (PR 1): estrutura e grants da migration 1 (funções de regra, índices únicos
-- parciais e RPC de discípulos).
-- Spec: docs/specs/e2-04-validacoes-membro.md, "Funções de regra (migration 1)",
-- "Unicidade (migration 1)", "Seletor de líder com os discípulos (AQ-4)",
-- "Verificações obrigatórias" (Estrutura e grants), DT-03, DT-14, DT-16, DT-18.
-- Os CHECKs, o NOT NULL e os triggers da migration 2 são cobertos no PR 2.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(83);

-- ---------------------------------------------------------------------------
-- Funções de regra: existem, são IMMUTABLE (CHECKs e índices exigem), com EXECUTE
-- para authenticated e service_role e sem anon.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE rule_fns (sig text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO rule_fns VALUES
  ('public.placeholder_email_domains()'), ('public.placeholder_email_domain()'),
  ('public.is_placeholder_email(text)'), ('public.is_valid_email(text)'),
  ('public.normalize_person_name(text)'), ('public.is_valid_person_name(text)'),
  ('public.member_has_login_identifier(text,text,text)'), ('public.birth_date_problem(date,date)');

SELECT ok(to_regprocedure(f.sig) IS NOT NULL, 'existe: ' || f.sig) FROM rule_fns f ORDER BY f.sig;
SELECT is((SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(f.sig)), 'i'::"char",
  'IMMUTABLE: ' || f.sig) FROM rule_fns f ORDER BY f.sig;
SELECT ok(has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')
          AND has_function_privilege('service_role', to_regprocedure(f.sig), 'EXECUTE'),
  'authenticated e service_role executam: ' || f.sig) FROM rule_fns f ORDER BY f.sig;
SELECT ok(NOT has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE'),
  'anon não executa: ' || f.sig) FROM rule_fns f ORDER BY f.sig;
-- PARALLEL SAFE e search_path vazio: as funções que entram em índices e CHECKs não dependem do
-- caminho de busca de quem grava.
SELECT ok((SELECT p.proparallel = 's' AND p.proconfig @> ARRAY['search_path=""']
             FROM pg_proc p WHERE p.oid = to_regprocedure(f.sig)),
  'PARALLEL SAFE e search_path vazio: ' || f.sig) FROM rule_fns f ORDER BY f.sig;

-- ---------------------------------------------------------------------------
-- member_account_email: só service_role (o e-mail da conta é gerado pelo servidor).
-- ---------------------------------------------------------------------------
SELECT ok(to_regprocedure('public.member_account_email(uuid)') IS NOT NULL, 'existe: member_account_email(uuid)');
SELECT is((SELECT provolatile FROM pg_proc WHERE oid = 'public.member_account_email(uuid)'::regprocedure), 'i'::"char",
  'member_account_email é IMMUTABLE');
SELECT ok(has_function_privilege('service_role', 'public.member_account_email(uuid)', 'EXECUTE'),
  'member_account_email: service_role executa');
SELECT ok(NOT has_function_privilege('authenticated', 'public.member_account_email(uuid)', 'EXECUTE'),
  'member_account_email: authenticated não executa');
SELECT ok(NOT has_function_privilege('anon', 'public.member_account_email(uuid)', 'EXECUTE'),
  'member_account_email: anon não executa');
SELECT is(public.member_account_email('11111111-2222-3333-4444-555555555555'),
  '11111111-2222-3333-4444-555555555555@mci12fakemail.com',
  'DA-1: o e-mail da conta é o id do membro no domínio de geração');

-- ---------------------------------------------------------------------------
-- Internas: _member_values_in_use e private.member_rule_violations sem authenticated.
-- ---------------------------------------------------------------------------
SELECT ok(to_regprocedure('public._member_values_in_use(uuid,text,text,text,boolean)') IS NOT NULL,
  'existe: _member_values_in_use');
SELECT ok(NOT has_function_privilege('authenticated', 'public._member_values_in_use(uuid,text,text,text,boolean)', 'EXECUTE'),
  '_member_values_in_use: authenticated não executa');
SELECT ok(NOT has_function_privilege('anon', 'public._member_values_in_use(uuid,text,text,text,boolean)', 'EXECUTE'),
  '_member_values_in_use: anon não executa');
SELECT ok(has_function_privilege('service_role', 'public._member_values_in_use(uuid,text,text,text,boolean)', 'EXECUTE'),
  '_member_values_in_use: service_role executa');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public']
             FROM pg_proc WHERE oid = 'public._member_values_in_use(uuid,text,text,text,boolean)'::regprocedure),
  '_member_values_in_use é SECURITY DEFINER com search_path fixo');

SELECT ok(to_regprocedure('private.member_rule_violations()') IS NOT NULL, 'existe: private.member_rule_violations');
SELECT ok(NOT has_function_privilege('authenticated', 'private.member_rule_violations()', 'EXECUTE'),
  'member_rule_violations: authenticated não executa');
SELECT ok(NOT has_function_privilege('anon', 'private.member_rule_violations()', 'EXECUTE'),
  'member_rule_violations: anon não executa');
SELECT ok(NOT has_function_privilege('service_role', 'private.member_rule_violations()', 'EXECUTE'),
  'member_rule_violations: service_role não executa (só postgres)');

-- ---------------------------------------------------------------------------
-- member_descendants_among (AQ-4) e os ajustes do E2.01.
-- ---------------------------------------------------------------------------
SELECT ok(to_regprocedure('public.member_descendants_among(uuid,uuid[])') IS NOT NULL, 'existe: member_descendants_among');
SELECT ok(has_function_privilege('authenticated', 'public.member_descendants_among(uuid,uuid[])', 'EXECUTE'),
  'member_descendants_among: authenticated executa');
SELECT ok(NOT has_function_privilege('anon', 'public.member_descendants_among(uuid,uuid[])', 'EXECUTE'),
  'member_descendants_among: anon não executa');
SELECT ok((SELECT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = 'public.member_descendants_among(uuid,uuid[])'::regprocedure),
  'member_descendants_among é STABLE e SECURITY DEFINER (filtra por viewer_sees_member)');
SELECT ok(has_function_privilege('authenticated', 'public.restore_member(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.restore_member(uuid)', 'EXECUTE'),
  'restore_member: authenticated sim, anon não');
SELECT ok(has_function_privilege('authenticated', 'public.find_deleted_member_matches(text,text,text)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.find_deleted_member_matches(text,text,text)', 'EXECUTE'),
  'find_deleted_member_matches: authenticated sim, anon não');
-- Nenhuma função nova do E2.04 vaza para PUBLIC.
SELECT is((SELECT count(*)::int FROM pg_proc p
            WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
              AND p.proname IN ('placeholder_email_domains', 'placeholder_email_domain', 'is_valid_email',
                                'normalize_person_name', 'is_valid_person_name', 'member_has_login_identifier',
                                'birth_date_problem', 'member_account_email', '_member_values_in_use',
                                'member_descendants_among', 'member_rule_violations')
              AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0,
  'nenhuma função do E2.04 tem EXECUTE para anon');

-- ---------------------------------------------------------------------------
-- Índices únicos parciais (RN-09, DT-03): nome, expressão e predicado deleted_at IS NULL.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE idx_expect (name text PRIMARY KEY, expr text) ON COMMIT DROP;
INSERT INTO idx_expect VALUES
  ('members_email_key', 'normalize_email(email)'),
  ('members_mobile_key', 'mobile_match_key(mobile_whatsapp)'),
  ('members_cpf_key', 'normalize_digits(cpf)');

SELECT ok(to_regclass('public.' || e.name) IS NOT NULL, 'existe o índice ' || e.name) FROM idx_expect e ORDER BY e.name;
SELECT ok((SELECT i.indisunique FROM pg_index i WHERE i.indexrelid = to_regclass('public.' || e.name)),
  e.name || ' é único') FROM idx_expect e ORDER BY e.name;
SELECT ok((SELECT i.indrelid = 'public.members'::regclass FROM pg_index i WHERE i.indexrelid = to_regclass('public.' || e.name)),
  e.name || ' é da tabela members') FROM idx_expect e ORDER BY e.name;
SELECT ok(position(e.expr IN pg_get_indexdef(to_regclass('public.' || e.name))) > 0,
  e.name || ' indexa ' || e.expr) FROM idx_expect e ORDER BY e.name;
SELECT ok(position('WHERE (deleted_at IS NULL)' IN pg_get_indexdef(to_regclass('public.' || e.name))) > 0,
  e.name || ' é parcial: WHERE deleted_at IS NULL') FROM idx_expect e ORDER BY e.name;
SELECT ok(to_regclass('public.' || n) IS NOT NULL, 'o índice de busca do E1.04 ' || n || ' continua (sem predicado)')
  FROM unnest(ARRAY['members_login_email_idx', 'members_login_cpf_idx', 'members_login_mobile_idx']) n ORDER BY n;
SELECT is((SELECT count(*)::int FROM pg_index i
            WHERE i.indrelid = 'public.members'::regclass
              AND i.indexrelid::regclass::text IN ('members_login_email_idx', 'members_login_cpf_idx', 'members_login_mobile_idx')
              AND i.indpred IS NOT NULL), 0,
  'os índices de busca do E1.04 não têm predicado (a sign-in procura excluídos)');

-- ---------------------------------------------------------------------------
-- Domínio fictício: a lista e o comportamento do E1.04 não mudaram.
-- ---------------------------------------------------------------------------
SELECT is(public.placeholder_email_domains(), ARRAY['mci12fakemail.com']::text[], 'lista de domínios fictícios');
SELECT ok(public.is_placeholder_email('x_ab12@MCI12fakemail.com ') AND NOT public.is_placeholder_email('x@exemplo.com')
          AND NOT public.is_placeholder_email(NULL),
  'is_placeholder_email: mesma regra do E1.04 (último @, sem diferenciar maiúsculas)');

SELECT * FROM finish();

ROLLBACK;
