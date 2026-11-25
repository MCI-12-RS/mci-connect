-- E2.02 (PR 6, migration 5): leitura e escrita diretas de funções fechadas.
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), tarefa 18,
-- RN-23, DA-9, DT-11, DT-18, "Políticas de RLS" (roles, role_permissions),
-- "Leituras para a tela" (coluna members.role_id), "Verificações obrigatórias
-- (para o QA)" (RN-23) e o critério de pronto 10.
--
-- Cobre:
--   - privilégios e políticas de roles e role_permissions: anon sem nada,
--     authenticated só com SELECT, uma política de SELECT por tabela (view_roles
--     ou manage_roles) e nenhuma de escrita;
--   - Pedro (Líder, sem view_roles) lê 0 linhas das duas tabelas e recebe 42501
--     ao gravar nelas; Rita (Administrador), Gil (manage_roles) e Vera
--     (view_roles) leem; anon recebe 42501;
--   - members.role_id sem SELECT para authenticated: ler, filtrar ou devolver a
--     coluna dá 42501, inclusive para a Administrador;
--   - members_view.role_id: nula para quem não atribui funções (Pedro e Vera)
--     em outra pessoa; preenchida no próprio cadastro e para quem tem
--     assign_role (Ana) ou manage_roles (Rita e Gil). A view continua definer,
--     com security_barrier, dona postgres, e a coluna no mesmo lugar e tipo;
--   - escrita da coluna: UPDATE de role_id com RETURNING id (o PATCH do
--     MemberForm) por quem atribui e cobre a função; INSERT sem RETURNING com
--     a função escolhida (create-user-admin) e com a padrão preenchida pelo
--     banco; check_member_insert;
--   - roles_view, my_access, role_options, save_role e delete_role continuam
--     respondendo (definer);
--   - conferência do catálogo: nenhuma função INVOKER do schema public lê
--     roles ou role_permissions, as que citam role_id são só os dois triggers
--     de gravação, e nenhuma política de outra tabela nem view security_invoker
--     lê as duas tabelas ou a coluna.
--
-- "A migration roda duas vezes sem erro" está em
-- supabase/tests/concurrency/e202_migrations.sh (passo 1), que roda o arquivo.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(74);

-- ---------------------------------------------------------------------------
-- Ids fictícios: a(uth), c (membros).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2027000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2027000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
-- O id da função pelo nome. Lê de uma cópia (role_ids), porque as sondas rodam
-- como authenticated e, desde o PR 6, quem não tem view_roles lê roles vazia.
CREATE TEMP TABLE role_ids (name text PRIMARY KEY, id uuid);
GRANT SELECT ON pg_temp.role_ids TO authenticated;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM pg_temp.role_ids WHERE name = _name $$;

-- Entra como o usuário do Auth número _n (a role é trocada fora, com SET LOCAL ROLE).
CREATE FUNCTION pg_temp.login(_n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
$$;

-- Privilégios de tabela de _grantee (0 = PUBLIC) em _rel, em ordem alfabética.
CREATE FUNCTION pg_temp.privs(_rel regclass, _grantee oid) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(a.privilege_type ORDER BY a.privilege_type), '{}')
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid = _rel AND a.grantee = _grantee
$$;

-- ---------------------------------------------------------------------------
-- Massa: Samuel (pastor, sem conta) → Pedro (G12, Líder) → André (Membro).
-- Rita (Administrador), Ana (atribui funções), Gil (gerencia funções) e Vera
-- (só visualiza funções), todos discípulos de Samuel e com a igreja toda.
-- A conta 8 fica livre para o cadastro (como a create-user-admin).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e202-07-' || n || '@teste.invalid' FROM generate_series(2, 8) n;

-- Funções de teste (como postgres). Ana cobre a Membro e a Básica.
INSERT INTO public.roles (id, name) VALUES
  ('b2027000-0000-0000-0000-000000000001', 'E202-07 Atribui'),
  ('b2027000-0000-0000-0000-000000000002', 'E202-07 Gerencia'),
  ('b2027000-0000-0000-0000-000000000003', 'E202-07 Visualiza'),
  ('b2027000-0000-0000-0000-000000000004', 'E202-07 Básica');
INSERT INTO pg_temp.role_ids SELECT name, id FROM public.roles;
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role('E202-07 Atribui'), permission FROM public.role_permissions
 WHERE role_id = pg_temp.role('Membro')
UNION
SELECT pg_temp.role('E202-07 Atribui'), p::public.permission_action
  FROM unnest(ARRAY['view_all_church', 'assign_role', 'edit_member', 'view_dashboard']) p
UNION ALL
SELECT pg_temp.role('E202-07 Gerencia'), p::public.permission_action
  FROM unnest(ARRAY['manage_roles', 'view_all_church']) p
UNION ALL
SELECT pg_temp.role('E202-07 Visualiza'), p::public.permission_action
  FROM unnest(ARRAY['view_roles', 'view_all_church']) p
UNION ALL
SELECT pg_temp.role('E202-07 Básica'), 'view_dashboard'::public.permission_action;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active) VALUES
  (pg_temp.m(1), 'Samuel E20207', 'M', true,  NULL,         false, NULL,         NULL,                           true);
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active) VALUES
  (pg_temp.m(2), 'Pedro E20207',  'M', false, pg_temp.m(1), true,  pg_temp.u(2), pg_temp.role('Líder'),         true),
  (pg_temp.m(4), 'Rita E20207',   'F', false, pg_temp.m(1), true,  pg_temp.u(4), pg_temp.role('Administrador'), true),
  (pg_temp.m(5), 'Ana E20207',    'F', false, pg_temp.m(1), true,  pg_temp.u(5), pg_temp.role('E202-07 Atribui'),   true),
  (pg_temp.m(6), 'Gil E20207',    'M', false, pg_temp.m(1), true,  pg_temp.u(6), pg_temp.role('E202-07 Gerencia'),  true),
  (pg_temp.m(7), 'Vera E20207',   'F', false, pg_temp.m(1), true,  pg_temp.u(7), pg_temp.role('E202-07 Visualiza'), true);
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active) VALUES
  (pg_temp.m(3), 'André E20207',  'M', false, pg_temp.m(2), true,  pg_temp.u(3), pg_temp.role('Membro'),        true);

-- Contagens de referência, lidas como dono das tabelas.
CREATE TEMP TABLE ref AS
  SELECT (SELECT count(*) FROM public.roles)::int AS roles_n,
         (SELECT count(*) FROM public.role_permissions)::int AS perms_n;
GRANT SELECT ON pg_temp.ref TO authenticated;

-- ===========================================================================
-- 1. Privilégios e políticas — 16
-- ===========================================================================
SELECT is(pg_temp.privs('public.roles', 'anon'::regrole), '{}'::text[], 'roles: anon sem nenhum privilégio');
SELECT is(pg_temp.privs('public.role_permissions', 'anon'::regrole), '{}'::text[], 'role_permissions: anon sem nenhum privilégio');
SELECT is(pg_temp.privs('public.roles', 'authenticated'::regrole), ARRAY['SELECT'], 'roles: authenticated só com SELECT');
SELECT is(pg_temp.privs('public.role_permissions', 'authenticated'::regrole), ARRAY['SELECT'], 'role_permissions: authenticated só com SELECT');
SELECT is(pg_temp.privs('public.roles', 0) || pg_temp.privs('public.role_permissions', 0), '{}'::text[], 'roles e role_permissions: PUBLIC sem privilégio');
SELECT ok(has_table_privilege('service_role', 'public.roles', 'SELECT,INSERT,UPDATE,DELETE')
          AND has_table_privilege('service_role', 'public.role_permissions', 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role: privilégios mantidos nas duas tabelas');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.roles'::regclass)
          AND (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.role_permissions'::regclass),
  'roles e role_permissions: RLS ligado');
SELECT set_eq($$ SELECT tablename::text, cmd::text, roles::text FROM pg_policies
                 WHERE schemaname = 'public' AND tablename IN ('roles', 'role_permissions') $$,
  $$ VALUES ('roles', 'SELECT', '{authenticated}'), ('role_permissions', 'SELECT', '{authenticated}') $$,
  'Políticas: só uma de SELECT por tabela, para authenticated; nenhuma de escrita (DA-9)');
SELECT ok((SELECT bool_and(qual ~ 'view_roles' AND qual ~ 'manage_roles') FROM pg_policies
            WHERE schemaname = 'public' AND tablename IN ('roles', 'role_permissions')),
  'Políticas de SELECT: view_roles ou manage_roles');
SELECT ok(NOT has_column_privilege('authenticated', 'public.members', 'role_id', 'SELECT'),
  'members.role_id: authenticated sem SELECT (DT-11)');
SELECT ok(NOT has_column_privilege('anon', 'public.members', 'role_id', 'SELECT'),
  'members.role_id: anon sem SELECT');
SELECT ok(has_column_privilege('authenticated', 'public.members', 'role_id', 'UPDATE')
          AND has_column_privilege('authenticated', 'public.members', 'role_id', 'INSERT'),
  'members.role_id: authenticated continua com INSERT e UPDATE (MemberForm e create-user-admin)');
SELECT ok(has_column_privilege('service_role', 'public.members', 'role_id', 'SELECT'),
  'members.role_id: service_role lê');
SELECT is((SELECT reloptions FROM pg_class WHERE oid = 'public.members_view'::regclass),
  ARRAY['security_barrier=true', 'security_invoker=false'],
  'members_view: security_barrier e security definer (security_invoker=false)');
SELECT ok(pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.members_view'::regclass)) = 'postgres'
          AND pg_temp.privs('public.members_view', 'authenticated'::regrole) = ARRAY['SELECT']
          AND pg_temp.privs('public.members_view', 'anon'::regrole) = '{}',
  'members_view: dona postgres, só SELECT para authenticated, nada para anon');
SELECT is((SELECT attnum::int || ' ' || format_type(atttypid, atttypmod) FROM pg_attribute
            WHERE attrelid = 'public.members_view'::regclass AND attname = 'role_id'),
  '24 uuid', 'members_view.role_id: mesma posição (24) e tipo (uuid)');

-- ===========================================================================
-- 2. Conferência do catálogo — 4
-- ===========================================================================
-- Limite: a busca é textual (prosrc) e só no schema public, onde estão as
-- funções chamadas com o papel de quem consulta. Em private não há função
-- com EXECUTE para authenticated.
SELECT is(ARRAY(SELECT p.proname::text FROM pg_proc p
                 WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef
                   AND p.prosrc ~ '\m(roles|role_permissions)\M' ORDER BY 1),
  '{}'::text[], 'Nenhuma função INVOKER do public lê roles ou role_permissions');
SELECT is(ARRAY(SELECT p.proname::text FROM pg_proc p
                 WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef
                   AND p.prosrc ~ '\mrole_id\M' ORDER BY 1),
  ARRAY['check_member_insert', 'enforce_member_write_rules'],
  'As funções INVOKER que citam role_id são só as de gravação (NEW/OLD e INSERT, sem leitura)');
SELECT is_empty($$ SELECT tablename, policyname FROM pg_policies
                    WHERE tablename NOT IN ('roles', 'role_permissions')
                      AND coalesce(qual, '') || coalesce(with_check, '') ~ '\m(roles|role_permissions|role_id)\M' $$,
  'Nenhuma política de outra tabela lê roles, role_permissions ou role_id');
SELECT is_empty($$ SELECT c.relname FROM pg_class c
                    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('v', 'm')
                      AND 'security_invoker=true' = ANY (coalesce(c.reloptions, '{}'))
                      AND pg_get_viewdef(c.oid) ~ '\m(roles|role_permissions|role_id)\M' $$,
  'Nenhuma view security_invoker lê roles, role_permissions ou role_id');

-- ===========================================================================
-- 3. Pedro (Líder, sem view_roles): lê vazio e não grava — 13
-- ===========================================================================
SELECT ok(NOT ('view_roles' = ANY (SELECT permission::text FROM public.role_permissions WHERE role_id = pg_temp.role('Líder'))),
  'massa: a Líder semeada não tem view_roles');
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.roles), 0, 'Pedro: select * from roles volta vazio (critério de pronto 10)');
SELECT is((SELECT count(*)::int FROM public.role_permissions), 0, 'Pedro: role_permissions volta vazia');
SELECT throws_ok($$ INSERT INTO public.roles (name) VALUES ('E202-07 Pedro cria') $$, '42501', NULL,
  'Pedro: INSERT em roles → 42501');
SELECT throws_ok(format($$ UPDATE public.roles SET description = 'x' WHERE id = %L $$, pg_temp.role('Líder')), '42501', NULL,
  'Pedro: UPDATE em roles → 42501');
SELECT throws_ok(format($$ DELETE FROM public.roles WHERE id = %L $$, pg_temp.role('E202-07 Básica')), '42501', NULL,
  'Pedro: DELETE em roles → 42501');
SELECT throws_ok(format($$ INSERT INTO public.role_permissions (role_id, permission) VALUES (%L, 'view_roles') $$, pg_temp.role('Líder')), '42501', NULL,
  'Pedro: INSERT em role_permissions (dar-se view_roles) → 42501');
SELECT throws_ok(format($$ UPDATE public.role_permissions SET permission = 'view_roles' WHERE role_id = %L $$, pg_temp.role('Líder')), '42501', NULL,
  'Pedro: UPDATE em role_permissions → 42501');
SELECT throws_ok(format($$ DELETE FROM public.role_permissions WHERE role_id = %L $$, pg_temp.role('Membro')), '42501', NULL,
  'Pedro: DELETE em role_permissions → 42501');
SELECT throws_ok('TRUNCATE public.role_permissions', '42501', NULL, 'Pedro: TRUNCATE → 42501');
SELECT is((SELECT count(*)::int FROM public.roles_view), 0, 'Pedro: roles_view vazia (sem Visualizar Funções)');
SELECT is((SELECT role_name FROM public.my_access()), 'Líder', 'Pedro: my_access devolve a própria função');
RESET ROLE;
SELECT ok((SELECT count(*)::int FROM public.roles) = (SELECT roles_n FROM pg_temp.ref)
          AND (SELECT count(*)::int FROM public.role_permissions) = (SELECT perms_n FROM pg_temp.ref)
          AND NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = pg_temp.role('Líder') AND permission = 'view_roles'),
  'Pedro: nada mudou nas duas tabelas');

-- ===========================================================================
-- 4. Quem lê as tabelas: Rita, Gil e Vera — 6
-- ===========================================================================
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.roles), (SELECT roles_n FROM pg_temp.ref), 'Rita (Administrador): lê todas as funções');
SELECT is((SELECT count(*)::int FROM public.role_permissions), (SELECT perms_n FROM pg_temp.ref), 'Rita: lê todas as permissões');
RESET ROLE;
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.roles), (SELECT roles_n FROM pg_temp.ref), 'Gil (Gerenciar Funções): lê as funções');
SELECT throws_ok(format($$ UPDATE public.roles SET description = 'x' WHERE id = %L $$, pg_temp.role('E202-07 Básica')), '42501', NULL,
  'Gil: mesmo com Gerenciar Funções, UPDATE direto → 42501 (só por save_role)');
RESET ROLE;
SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.role_permissions), (SELECT perms_n FROM pg_temp.ref), 'Vera (Visualizar Funções): lê as permissões');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT id FROM public.roles', '42501', NULL, 'anon: SELECT em roles → 42501');
RESET ROLE;

-- ===========================================================================
-- 5. members.role_id na tabela — 6
-- ===========================================================================
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT role_id FROM public.members', '42501', NULL, 'Pedro: select role_id from members → 42501 (RN-23)');
SELECT throws_ok(format($$ SELECT role_id FROM public.members WHERE id = %L $$, pg_temp.m(2)), '42501', NULL,
  'Pedro: nem a própria role_id pela tabela (a própria vem de my_access)');
SELECT throws_ok(format($$ SELECT id FROM public.members WHERE role_id = %L $$, pg_temp.role('Membro')), '42501', NULL,
  'Pedro: filtrar por role_id → 42501');
RESET ROLE;
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT role_id FROM public.members', '42501', NULL, 'Rita: select role_id from members → 42501 (leitura só pela view)');
SELECT throws_ok(format($$ UPDATE public.members SET notes = 'x' WHERE id = %L RETURNING role_id $$, pg_temp.m(3)), '42501', NULL,
  'Rita: UPDATE … RETURNING role_id → 42501');
SELECT lives_ok('SELECT id, name, leader_id FROM public.members', 'Rita: as colunas liberadas continuam legíveis');
RESET ROLE;

-- ===========================================================================
-- 6. members_view.role_id por persona — 11
-- ===========================================================================
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.members_view WHERE id = pg_temp.m(3)), 1, 'Pedro vê o André (seu ministério)');
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(3)), NULL, 'Pedro: a role_id do André vem nula (RN-23)');
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(2)), pg_temp.role('Líder'), 'Pedro: a própria role_id vem preenchida');
SELECT is((SELECT count(*)::int FROM public.members_view WHERE role_id IS NOT NULL AND id <> pg_temp.m(2)), 0,
  'Pedro: nenhuma role_id de outra pessoa sai pela view');
RESET ROLE;
SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(3)), NULL, 'Vera (só Visualizar Funções): a role_id do André vem nula');
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(7)), pg_temp.role('E202-07 Visualiza'), 'Vera: a própria vem preenchida');
RESET ROLE;
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(3)), pg_temp.role('Membro'), 'Ana (Atribuir Função): vê a role_id do André');
RESET ROLE;
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(3)), pg_temp.role('Membro'), 'Gil (Gerenciar Funções): vê a role_id do André');
RESET ROLE;
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(2)), pg_temp.role('Líder'), 'Rita (Administrador): vê a role_id do Pedro');
SELECT is((SELECT count(*)::int FROM public.members_view WHERE id::text LIKE 'c2027000%' AND role_id IS NULL AND id <> pg_temp.m(1)), 0,
  'Rita: todas as role_id da massa preenchidas (fora o Samuel, sem função)');
RESET ROLE;
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT is((SELECT role_id FROM public.members_view WHERE id = pg_temp.m(3)), pg_temp.role('Membro'), 'André (Membro): a própria role_id vem preenchida');
RESET ROLE;

-- ===========================================================================
-- 7. Escrita da coluna continua — 9
-- ===========================================================================
-- PATCH do MemberForm: update(payload).select("id").
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format($$ UPDATE public.members SET role_id = %L WHERE id = %L RETURNING id $$, pg_temp.role('E202-07 Básica'), pg_temp.m(3)),
  format($$ VALUES (%L::uuid) $$, pg_temp.m(3)),
  'Ana: UPDATE de role_id do André com RETURNING id funciona (MemberForm)');
RESET ROLE;
SELECT is((SELECT role_id FROM public.members WHERE id = pg_temp.m(3)), pg_temp.role('E202-07 Básica'), 'Ana: a função do André foi gravada');

SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT is((SELECT (public.role_options(pg_temp.m(3)))->>'reason'), 'no_permission', 'Pedro: role_options do André → no_permission (RN-23)');
SELECT is((SELECT (public.role_options(pg_temp.m(3)))->'current'), 'null'::jsonb, 'Pedro: e sem a função atual');
-- Cadastro sem função escolhida: o banco preenche a padrão (RN-19), sem RETURNING.
SELECT lives_ok(format($$ INSERT INTO public.members (id, name, gender, leader_id, has_leadership)
                          VALUES (%L, 'Novo do Pedro E20207', 'M', %L, true) $$, pg_temp.m(9), pg_temp.m(2)),
  'Pedro: INSERT sem RETURNING, sem função, funciona (o banco põe a padrão)');
RESET ROLE;
SELECT is((SELECT role_id FROM public.members WHERE id = pg_temp.m(9)), public.default_role_id(), 'Pedro: o cadastro novo ficou com a função padrão');

-- create-user-admin: insert com a sessão de quem chama, sem RETURNING, com a função escolhida.
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$ INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id)
                          VALUES (%L, 'Conta Nova E20207', 'F', %L, true, %L, %L) $$,
                        pg_temp.m(8), pg_temp.m(1), pg_temp.u(8), pg_temp.role('E202-07 Visualiza')),
  'Rita: INSERT sem RETURNING com role_id funciona (create-user-admin)');
SELECT lives_ok(format($$ SELECT public.check_member_insert(%L::jsonb) $$,
                        json_build_object('name', 'Ensaio E20207', 'gender', 'M', 'leader_id', pg_temp.m(1),
                                          'has_leadership', true, 'role_id', pg_temp.role('Membro'))),
  'Rita: check_member_insert com role_id continua respondendo');
RESET ROLE;
SELECT is((SELECT role_id FROM public.members WHERE id = pg_temp.m(8)), pg_temp.role('E202-07 Visualiza'), 'Rita: o cadastro novo ficou com a função escolhida');

-- ===========================================================================
-- 8. RPCs e views definer continuam — 9
-- ===========================================================================
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM public.roles_view), (SELECT roles_n FROM pg_temp.ref), 'Rita: roles_view lista todas as funções');
SELECT is((SELECT role_name FROM public.my_access()), 'Administrador', 'Rita: my_access devolve a própria função');
SELECT is((SELECT (public.role_options(pg_temp.m(2)))->'current'->>'name'), 'Líder', 'Rita: role_options do Pedro traz a função atual');
SELECT ok((SELECT jsonb_array_length((public.role_options(NULL))->'options') > 0), 'Rita: role_options do cadastro novo traz as opções');
CREATE TEMP TABLE new_role (id uuid);
GRANT ALL ON pg_temp.new_role TO authenticated;
SELECT lives_ok($$ INSERT INTO pg_temp.new_role
                   SELECT public.save_role(NULL, 'E202-07 Nova', NULL, ARRAY['view_dashboard']::public.permission_action[], false) $$,
  'Rita: save_role cria uma função (definer)');
SELECT is((SELECT count(*)::int FROM public.roles WHERE name = 'E202-07 Nova'), 1, 'Rita: e lê a função criada');
SELECT lives_ok($$ SELECT public.delete_role((SELECT id FROM pg_temp.new_role)) $$, 'Rita: delete_role exclui a função (definer)');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM public.roles WHERE name = 'E202-07 Nova'), 0, 'Rita: a função excluída saiu');
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT is((SELECT (public.role_options(pg_temp.m(3)))->>'editable'), 'true', 'Ana: role_options do André editável (atribui e cobre)');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
