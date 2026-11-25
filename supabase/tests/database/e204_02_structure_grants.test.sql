-- E2.04 (PR 2): estrutura e grants da migration 2 (CHECKs, NOT NULL, índices, triggers novos e
-- sua ordem, funções e EXECUTE).
-- Spec: docs/specs/e2-04-validacoes-membro.md, "Integridade do tipo (a) (migration 2)",
-- "Ordem dos triggers BEFORE de members", "Verificações obrigatórias" (Estrutura e grants),
-- DT-02, DT-04, DT-06, DA-6, DA-1, AQ-4.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(61);

-- ---------------------------------------------------------------------------
-- CHECKs e NOT NULL (nomes e definição), valendo também para os excluídos (DA-6).
-- ---------------------------------------------------------------------------
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conrelid = 'public.members'::regclass AND c.contype = 'c' AND c.conname = x.n),
  'CHECK existe: ' || x.n)
  FROM (VALUES ('members_email_check'), ('members_email_not_placeholder_check'), ('members_cpf_check'),
               ('members_leadership_check'), ('members_leader_not_self_check'), ('members_spouse_not_self_check'),
               ('members_baptism_check'), ('members_gender_check')) x(n);
SELECT ok((SELECT c.convalidated FROM pg_constraint c WHERE c.conrelid = 'public.members'::regclass AND c.conname = x.n),
  'CHECK validado (vale para as linhas existentes): ' || x.n)
  FROM (VALUES ('members_email_check'), ('members_cpf_check'), ('members_leadership_check'), ('members_baptism_check')) x(n);
SELECT is((SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.members'::regclass AND a.attname = 'gender'),
  true, 'RN-03: gender é NOT NULL');
SELECT is((SELECT a.attnotnull FROM pg_attribute a WHERE a.attrelid = 'public.members'::regclass AND a.attname = 'has_leadership'),
  true, 'has_leadership continua NOT NULL');
SELECT is((SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
            WHERE d.adrelid = 'public.members'::regclass
              AND d.adnum = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.members'::regclass AND attname = 'has_leadership')),
  NULL, 'DT-06: has_leadership sem default (omitido vira nulo e o a0_ resolve)');
-- Os CHECKs não têm exceção de deleted_at: um excluído também é recusado (DA-6).
SELECT ok(pg_get_constraintdef(c.oid) NOT ILIKE '%deleted_at%', 'DA-6: o CHECK não tem exceção para excluídos: ' || c.conname)
  FROM pg_constraint c WHERE c.conrelid = 'public.members'::regclass AND c.conname IN
  ('members_email_check', 'members_cpf_check', 'members_leadership_check', 'members_baptism_check');

-- Os três índices únicos parciais, com os nomes.
SELECT ok(EXISTS (SELECT 1 FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = 'members' AND i.indexname = x.n
                    AND i.indexdef ILIKE '%UNIQUE%' AND i.indexdef ILIKE '%deleted_at IS NULL%'),
  'índice único parcial (não excluídos): ' || x.n)
  FROM (VALUES ('members_email_key'), ('members_mobile_key'), ('members_cpf_key')) x(n);

-- ---------------------------------------------------------------------------
-- Triggers BEFORE: existem, habilitados, e disparam na ordem alfabética (DT-04).
-- ---------------------------------------------------------------------------
SELECT ok((SELECT t.tgenabled = 'O' AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1
             FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = x.n),
  'trigger BEFORE por linha, habilitado: ' || x.n)
  FROM (VALUES ('a0_normalize_member'), ('aa_enforce_member_write_rules'), ('ab_enforce_member_links'),
               ('ac_enforce_member_scope'), ('ad_enforce_member_rules'), ('compute_member_g12_level')) x(n);
SELECT is((SELECT array_agg(t.tgname::text ORDER BY t.tgname::text COLLATE "C")
             FROM pg_trigger t
            WHERE t.tgrelid = 'public.members'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2
              AND t.tgname IN ('a0_normalize_member', 'aa_enforce_member_write_rules', 'ab_enforce_member_links',
                               'ac_enforce_member_scope', 'ad_enforce_member_rules', 'compute_member_g12_level')),
  ARRAY['a0_normalize_member', 'aa_enforce_member_write_rules', 'ab_enforce_member_links',
        'ac_enforce_member_scope', 'ad_enforce_member_rules', 'compute_member_g12_level'],
  'a0_ < aa_ < ab_ < ac_ < ad_ < compute_member_g12_level (ordem de disparo, por nome)');
SELECT is((SELECT count(*)::int FROM pg_trigger t
            WHERE t.tgrelid = 'public.members'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2
              AND t.tgname COLLATE "C" < 'a0_normalize_member'), 0,
  'nenhum trigger BEFORE de members dispara antes do a0_');
SELECT is((SELECT count(*)::int FROM pg_trigger t
            WHERE t.tgrelid = 'public.members'::regclass AND NOT t.tgisinternal AND (t.tgtype & 2) = 2
              AND t.tgname COLLATE "C" > 'ad_enforce_member_rules' AND t.tgname COLLATE "C" < 'compute_member_g12_level'), 0,
  'nada entre o ad_ e o compute_member_g12_level');
-- Eventos de cada trigger novo: INSERT e UPDATE OF (as colunas que as regras leem).
SELECT ok((t.tgtype & 4) = 4 AND (t.tgtype & 16) = 16, 'INSERT e UPDATE: ' || t.tgname)
  FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname IN ('a0_normalize_member', 'ad_enforce_member_rules');
SELECT ok(pg_get_triggerdef(t.oid) ~ 'UPDATE OF .*deleted_at', 'ad_ também dispara na exclusão e na restauração (UPDATE OF deleted_at)')
  FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = 'ad_enforce_member_rules';
SELECT ok(pg_get_triggerdef(t.oid) ~ 'UPDATE OF .*has_leadership.*', 'a0_ lê has_leadership (derivação, RN-11)')
  FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = 'a0_normalize_member';
-- Não é um trigger de "valor mudou só se": recusa e normalização valem para qualquer papel
-- (sem WHEN, sem exceção de papel).
SELECT ok(pg_get_triggerdef(t.oid) NOT ILIKE '% WHEN %', 'sem cláusula WHEN: ' || t.tgname)
  FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname IN ('a0_normalize_member', 'ad_enforce_member_rules');
-- Em replica só os CHECKs e os índices valem: o trigger é do tipo ORIGIN ('O'), não 'A'.
SELECT is((SELECT t.tgenabled::text FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = x.n),
  'O', 'RN-01: ' || x.n || ' não dispara em replica (a carga do legado passa só pelos CHECKs e índices)')
  FROM (VALUES ('a0_normalize_member'), ('ad_enforce_member_rules')) x(n);

-- Não há trigger antigo de cônjuge duplicado.
SELECT is((SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND NOT t.tgisinternal
            AND t.tgname ILIKE '%spouse%'), 1, 'DT-15: um só trigger de cônjuge simétrico');

-- ---------------------------------------------------------------------------
-- Funções dos triggers: privilégios e segurança.
-- ---------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege(r, p.oid, 'EXECUTE'),
  'sem EXECUTE para ' || r || ': ' || p.oid::regprocedure::text)
  FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated')) q(r)
 WHERE p.oid IN ('public.normalize_member_input()'::regprocedure, 'public.enforce_member_rules()'::regprocedure);
SELECT is((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.normalize_member_input()'::regprocedure), false,
  'a0_: SECURITY INVOKER (só lê NEW e OLD)');
SELECT is((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.enforce_member_rules()'::regprocedure), true,
  'ad_: SECURITY DEFINER (a subida da árvore e a unicidade enxergam o que quem grava não vê)');
SELECT ok((SELECT p.proconfig @> ARRAY['search_path=public'] FROM pg_proc p WHERE p.oid = 'public.enforce_member_rules()'::regprocedure),
  'ad_: search_path fixo');

-- ---------------------------------------------------------------------------
-- Funções novas e anteriores: grants (spec "Estrutura e grants").
-- ---------------------------------------------------------------------------
SELECT ok(has_function_privilege('service_role', 'public.member_account_email(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('authenticated', 'public.member_account_email(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.member_account_email(uuid)', 'EXECUTE'),
  'member_account_email: só service_role');
SELECT ok(NOT has_function_privilege('authenticated', 'public._member_values_in_use(uuid,text,text,text,boolean)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public._member_values_in_use(uuid,text,text,text,boolean)', 'EXECUTE'),
  '_member_values_in_use: sem EXECUTE para authenticated nem anon');
SELECT ok(NOT has_function_privilege('authenticated', 'private.member_rule_violations()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'private.member_rule_violations()', 'EXECUTE')
          AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
  'private.member_rule_violations: sem EXECUTE para authenticated e o schema private fechado');
SELECT ok(NOT has_function_privilege('anon', 'public.member_descendants_among(uuid,uuid[])', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.member_descendants_among(uuid,uuid[])', 'EXECUTE'),
  'member_descendants_among: authenticated sim, anon não');
SELECT ok(NOT has_function_privilege('anon', 'public.check_member_insert(jsonb)', 'EXECUTE')
          AND has_function_privilege('authenticated', 'public.check_member_insert(jsonb)', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.check_member_insert(jsonb)', 'EXECUTE'),
  'check_member_insert: authenticated e service_role, sem anon');
SELECT is((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = 'public.check_member_insert(jsonb)'::regprocedure), false,
  'check_member_insert: INVOKER (o ensaio roda com as permissões de quem chama)');

-- As funções de regra continuam IMMUTABLE (CHECKs e índices as exigem).
SELECT is((SELECT p.provolatile FROM pg_proc p WHERE p.oid = to_regprocedure(f)), 'i'::"char", 'IMMUTABLE: ' || f)
  FROM unnest(ARRAY['public.is_valid_email(text)', 'public.is_placeholder_email(text)', 'public.normalize_email(text)',
                    'public.is_valid_cpf(text)', 'public.normalize_digits(text)', 'public.normalize_mobile(text)',
                    'public.mobile_match_key(text)']) f;

-- ---------------------------------------------------------------------------
-- A guarda da migration 2 não mexe em nada quando não há violação: a função está vazia no banco
-- de teste (a massa deste arquivo é só a do banco local) e as colunas existem como esperado.
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM private.member_rule_violations()), 0,
  'invariante: private.member_rule_violations() sem linhas');

SELECT * FROM finish();

ROLLBACK;
