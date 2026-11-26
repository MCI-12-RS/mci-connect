-- E1.08 (PR 5): trava da máscara, com a leitura de members por coluna.
-- Spec: docs/specs/e1-08-paginacao-servidor.md (repositório apps-mci): RN-11,
-- RN-12, tarefa 10, risco 4 e critério de pronto 11.
--
-- Cobre:
--   - privilégios: anon e authenticated sem SELECT de tabela em members;
--     authenticated com SELECT em cada coluna não sensível e sem SELECT nas 8
--     sensíveis; anon sem nenhuma coluna; service_role com a tabela inteira;
--     INSERT e UPDATE de tabela mantidos para authenticated; DELETE retirado
--     pela migration 5 do E2.01 (exclusão só pelas RPCs);
--   - guarda do risco 4 (a trava falha fechada): toda coluna de members, lida
--     do catálogo, ou é sensível ou tem SELECT para authenticated. Uma coluna
--     nova sem GRANT faz este teste falhar; o §8 demonstra isso com uma coluna
--     criada dentro da transação;
--   - amarração das listas de colunas sensíveis: as colunas sem SELECT são
--     exatamente as que a members_view devolve nulas a quem não tem
--     view_sensitive_data e as que a regra 6 de enforce_member_write_rules
--     preserva;
--   - comportamento como authenticated: ler, filtrar ou ordenar por coluna
--     sensível, select *, RETURNING com coluna sensível e copiar uma coluna
--     sensível para outra dão 42501; ler as colunas liberadas, UPDATE por id e
--     INSERT sem RETURNING funcionam (é o que o front e a create-user-admin
--     fazem); DELETE por id dá 42501 e não tira ninguém da tabela (E2.01);
--   - regressões que dependem de leitura interna da tabela: regras 5 e 6,
--     g12_level, cônjuge, totais e auditoria; members_view, member_names,
--     dashboard_*, ministry_tree_nodes e as views de células e relatórios;
--   - anon: nada de members.
--
-- E2.02 (PR 6, migration 5, RN-23): a role_id saiu da lista de legíveis e é
-- uma categoria própria (pg_temp.role_columns): sem SELECT para authenticated
-- e mascarada na members_view pela função ("Atribuir Função" ou "Gerenciar
-- Funções"), não por view_sensitive_data. Toda coluna continua com uma decisão:
-- legível, sensível ou da função. O comportamento da role_id por persona está
-- em e202_07_close_roles.test.sql.
--
-- A lista das 8 colunas sensíveis está na members_view, na regra 6, em
-- src/lib/members/fields.ts e na trava (migration do PR 5). Mudou uma, mude as
-- outras e este teste.
--
-- Colunas novas: a guarda e a amarração olham o catálogo, então uma coluna nova
-- com o GRANT (como deleted_at e deleted_by no E2.01, DT-22) continua passando.
-- Desde a migration 5 do E2.01, authenticated não tem DELETE em members: as
-- verificações de DELETE dos §1 e §5 esperam a recusa (42501), e o membro
-- continua na tabela.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db (ou psql no banco local).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(129);

-- ---------------------------------------------------------------------------
-- Ids fixos da massa: a(uth), b (roles), c (membros), d (células), e (relatórios).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a1085000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b1085000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c1085000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d1085000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e1085000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Entra como o usuário do Auth número _n (a role é trocada fora, com SET LOCAL ROLE).
CREATE FUNCTION pg_temp.login(_n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
$$;

-- As 8 colunas sensíveis (RN-11), em ordem alfabética.
CREATE FUNCTION pg_temp.sensitive_columns() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['complement', 'cpf', 'email', 'mobile_whatsapp', 'number', 'phone', 'street', 'zip_code'] $$;

-- As 20 colunas não sensíveis que a trava libera (lista do spec, PR 5, sem a
-- role_id desde o E2.02 PR 6 e sem as cinco calculadas desde o E2.06 PR 1).
CREATE FUNCTION pg_temp.readable_columns() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['id', 'name', 'gender', 'birth_date', 'instagram', 'avatar_url', 'notes',
                'neighborhood', 'city', 'state', 'is_pastor', 'has_leadership', 'leader_id', 'spouse_id',
                'is_baptized', 'baptism_date', 'is_active', 'auth_user_id', 'created_at', 'updated_at'] $$;

-- A coluna da função (E2.02 PR 6, RN-23): sem SELECT, mascarada na view por
-- "Atribuir Função"/"Gerenciar Funções".
CREATE FUNCTION pg_temp.role_columns() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['role_id'] $$;

-- Todas as colunas sem SELECT para authenticated (sensíveis e da função), em ordem alfabética.
CREATE FUNCTION pg_temp.locked_columns() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT array_agg(c ORDER BY c) FROM unnest(pg_temp.sensitive_columns() || pg_temp.role_columns()) c $$;

-- As colunas atuais de members, lidas do catálogo.
CREATE FUNCTION pg_temp.member_columns() RETURNS SETOF text LANGUAGE sql STABLE AS $$
  SELECT attname::text
    FROM pg_attribute
   WHERE attrelid = 'public.members'::regclass AND attnum > 0 AND NOT attisdropped
$$;

-- SELECT de _role na coluna; false se a coluna não existir (falha limpa, sem erro).
CREATE FUNCTION pg_temp.can_select(_role text, _column text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM pg_temp.member_columns() c WHERE c = _column)
     AND has_column_privilege(_role, 'public.members', _column, 'SELECT')
$$;

-- Colunas de members sem SELECT para _role, em ordem alfabética.
CREATE FUNCTION pg_temp.unreadable_columns(_role text) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(c ORDER BY c), '{}')
    FROM pg_temp.member_columns() c
   WHERE NOT has_column_privilege(_role, 'public.members', c, 'SELECT')
$$;

-- Risco 4: colunas que não são sensíveis nem da função e mesmo assim ficaram
-- sem SELECT para authenticated (o esperado é nenhuma).
CREATE FUNCTION pg_temp.ungranted_non_sensitive() RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(c ORDER BY c), '{}')
    FROM unnest(pg_temp.unreadable_columns('authenticated')) c
   WHERE c <> ALL (pg_temp.locked_columns())
$$;

-- Colunas de _cols com o mesmo valor em _before e _after, em ordem alfabética.
CREATE FUNCTION pg_temp.unchanged(_before jsonb, _after jsonb, _cols text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(c ORDER BY c), '{}') FROM unnest(_cols) c WHERE _before -> c = _after -> c
$$;

-- Colunas mascaradas para quem está logado: as que têm valor na linha da tabela
-- (_table_row, lida pelo dono) e vêm nulas, ou não vêm, na members_view.
CREATE FUNCTION pg_temp.masked_columns(_id uuid, _table_row jsonb) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(array_agg(t.key ORDER BY t.key), '{}')
    FROM jsonb_each(_table_row) t
   WHERE t.value <> 'null'::jsonb
     AND coalesce((SELECT to_jsonb(v) -> t.key FROM public.members_view v WHERE v.id = _id), 'null'::jsonb)
         = 'null'::jsonb
$$;

-- Uma verificação por coluna: authenticated lê as não sensíveis e não lê as
-- sensíveis nem a da função.
CREATE FUNCTION pg_temp.column_privilege_checks() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  _c text;
BEGIN
  FOREACH _c IN ARRAY pg_temp.readable_columns() LOOP
    RETURN NEXT ok(pg_temp.can_select('authenticated', _c),
      format('authenticated: SELECT na coluna não sensível members.%s', _c));
  END LOOP;
  FOREACH _c IN ARRAY pg_temp.sensitive_columns() LOOP
    RETURN NEXT ok(NOT has_column_privilege('authenticated', 'public.members', _c, 'SELECT'),
      format('authenticated: sem SELECT na coluna sensível members.%s (RN-11)', _c));
  END LOOP;
  FOREACH _c IN ARRAY pg_temp.role_columns() LOOP
    RETURN NEXT ok(NOT has_column_privilege('authenticated', 'public.members', _c, 'SELECT'),
      format('authenticated: sem SELECT na coluna da função members.%s (RN-23, E2.02 PR 6)', _c));
  END LOOP;
END $$;

-- Uma verificação por coluna sensível: ler a coluna na tabela dá 42501.
CREATE FUNCTION pg_temp.sensitive_reads_denied(_who text) RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  _c text;
BEGIN
  FOREACH _c IN ARRAY pg_temp.sensitive_columns() LOOP
    RETURN NEXT throws_ok(format('SELECT %I FROM public.members', _c), '42501', NULL,
      format('%s: SELECT %s FROM members → 42501 (RN-11)', _who, _c));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- Massa. Triggers desligados: níveis, cônjuges e totais explícitos.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e108pr5-' || n || '@teste.local' FROM generate_series(1, 8) n;
-- 1 P1 (sistema), 2 P2 (igreja toda, edita, sem dados sensíveis), 3 P3
-- (ministério, dados sensíveis, edita), 4 só o próprio cadastro, 5 cadastra sem
-- ver dados sensíveis, 6 sem função (P5), 7 conta livre para o cadastro (como a
-- create-user-admin), 8 conta da Xênia (nunca entra).

INSERT INTO public.roles (id, name, is_system) VALUES
  (pg_temp.role(1), 'Teste E108 PR5 P1 sistema',                      false),
  (pg_temp.role(2), 'Teste E108 PR5 P2 igreja toda, edita',           false),
  (pg_temp.role(3), 'Teste E108 PR5 P3 ministério, sensível, edita',  false),
  (pg_temp.role(4), 'Teste E108 PR5 próprio cadastro',                false),
  (pg_temp.role(5), 'Teste E108 PR5 cadastra sem dados sensíveis',    false);
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(1), 'view_all_church'),
  (pg_temp.role(1), 'view_sensitive_data'),
  (pg_temp.role(1), 'edit_member'),
  (pg_temp.role(1), 'delete_member'),
  (pg_temp.role(1), 'create_member'),
  (pg_temp.role(1), 'view_dashboard'),
  (pg_temp.role(2), 'view_all_church'),
  (pg_temp.role(2), 'edit_member'),
  (pg_temp.role(3), 'view_own_ministry'),
  (pg_temp.role(3), 'view_sensitive_data'),
  (pg_temp.role(3), 'edit_member'),
  (pg_temp.role(4), 'edit_own_data'),
  (pg_temp.role(5), 'create_member'),
  (pg_temp.role(5), 'view_all_church'),
  -- E2.02 (RN-19): quem cadastra sem escolher função precisa cobrir a função padrão (Membro).
  (pg_temp.role(5), 'view_dashboard'),
  (pg_temp.role(5), 'view_own_ministry'),
  (pg_temp.role(5), 'edit_own_data'),
  (pg_temp.role(5), 'submit_own_cell_report');

-- Árvore (nível entre parênteses):
--   Pastores Paulo (01) e Priscila (02, P1), casados.
--   Ministério A: André (03, G12, P3) e Ana (04, G12), casados.
--     André → Antônio (06, só o próprio cadastro), Marcos (08), Edite (09), Lia (15)
--     Ana → Xênia (07, com todas as colunas preenchidas), casada com Marcos
--   Ministério B: Bruno (05, G12, P2) → Bento (10), Bia (11), Davi (12),
--     Clara (13, cadastra), Pedro (14, sem função), Nuno (16), Rui (17)
INSERT INTO public.members
  (id, name, gender, is_pastor, leader_id, spouse_id, is_active, has_leadership, auth_user_id, role_id)
VALUES
  (pg_temp.m(1),  'Paulo Pastor',      'M', true, NULL,         pg_temp.m(2), true, false, NULL,         NULL),
  (pg_temp.m(2),  'Priscila Pastora',  'F', true, NULL,         pg_temp.m(1), true, false, pg_temp.u(1), pg_temp.role(1)),
  (pg_temp.m(3),  'André Alves',       'M', false, pg_temp.m(1), pg_temp.m(4), true, true,  pg_temp.u(3), pg_temp.role(3)),
  (pg_temp.m(4),  'Ana Alves',         'F', false, pg_temp.m(2), pg_temp.m(3), true, true,  NULL,         NULL),
  (pg_temp.m(5),  'Bruno Borges',      'M', false, pg_temp.m(1), NULL,         true, true,  pg_temp.u(2), pg_temp.role(2)),
  (pg_temp.m(6),  'Antônio Araújo',    'M', false, pg_temp.m(3), NULL,         true, true,  pg_temp.u(4), pg_temp.role(4)),
  (pg_temp.m(7),  'Xênia Completa',    'F', false, pg_temp.m(4), pg_temp.m(8), true, true,  pg_temp.u(8), pg_temp.role(4)),
  (pg_temp.m(8),  'Marcos Moura',      'M', false, pg_temp.m(3), pg_temp.m(7), true, true,  NULL,         NULL),
  (pg_temp.m(9),  'Edite Edição',      'F', false, pg_temp.m(3), NULL,         true, true,  NULL,         NULL),
  (pg_temp.m(10), 'Bento Barros',      'M', false, pg_temp.m(5), NULL,         true, true,  NULL,         NULL),
  (pg_temp.m(11), 'Bia Barros',        'F', false, pg_temp.m(5), NULL,         true, true,  NULL,         NULL),
  (pg_temp.m(12), 'Davi Delete',       'M', false, pg_temp.m(5), NULL,         true, true,  NULL,         NULL),
  (pg_temp.m(13), 'Clara Cadastro',    'F', false, pg_temp.m(5), NULL,         true, true,  pg_temp.u(5), pg_temp.role(5)),
  (pg_temp.m(14), 'Pedro Sem Função',  'M', false, pg_temp.m(5), NULL,         true, true,  pg_temp.u(6), NULL),
  (pg_temp.m(15), 'Lia Lista',         'F', false, pg_temp.m(3), NULL,         true, true,  NULL,         NULL),
  (pg_temp.m(16), 'Nuno Notas',        'M', false, pg_temp.m(5), NULL,         true, true,  NULL,         NULL),
  (pg_temp.m(17), 'Rui Retorno',       'M', false, pg_temp.m(5), NULL,         true, true,  NULL,         NULL);

-- Dados sensíveis (fictícios; os CPFs têm dígitos verificadores válidos).
UPDATE public.members SET email = 'priscila.pr5@teste.invalid', cpf = '10850000289', mobile_whatsapp = '51990000002'
 WHERE id = pg_temp.m(2);
UPDATE public.members SET email = 'antonio.pr5@teste.invalid', cpf = '10850000602', mobile_whatsapp = '51990000006',
                          street = 'Rua do Antônio', number = '6', zip_code = '90000-006'
 WHERE id = pg_temp.m(6);
-- Xênia: todas as colunas de members preenchidas (base da amarração da máscara).
UPDATE public.members SET
  email = 'xenia.pr5@teste.invalid', cpf = '10850000793', mobile_whatsapp = '51990000007', phone = '5133330007',
  street = 'Rua Sigilosa', number = '700', complement = 'Apto 7', zip_code = '90000-007',
  birth_date = '1990-07-07', notes = 'Observação da Xênia', instagram = '@xenia.pr5',
  avatar_url = 'https://exemplo.invalid/xenia.png', neighborhood = 'Centro', city = 'Porto Alegre', state = 'RS',
  is_baptized = true, baptism_date = '2010-07-07'
 WHERE id = pg_temp.m(7);
UPDATE public.members SET email = 'edite.pr5@teste.invalid', cpf = '10850000955', mobile_whatsapp = '51990000009'
 WHERE id = pg_temp.m(9);
UPDATE public.members SET
  email = 'lia.pr5@teste.invalid', cpf = '10850001501', mobile_whatsapp = '51990000015', phone = '5133330015',
  street = 'Rua da Lia', number = '15', complement = 'Casa', zip_code = '90000-015',
  birth_date = '1985-05-15', notes = 'Notas da Lia', instagram = '@lia.pr5', avatar_url = 'https://exemplo.invalid/lia.png',
  neighborhood = 'Centro', city = 'Porto Alegre', state = 'RS', is_baptized = true, baptism_date = '2005-05-15'
 WHERE id = pg_temp.m(15);
UPDATE public.members SET cpf = '10850009820', email = 'rui.pr5@teste.invalid' WHERE id = pg_temp.m(17);

-- Uma célula (Antônio lidera, Marcos é timóteo, Edite é anfitriã) e um relatório com a Xênia.
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time,
                          neighborhood, city, state, is_active)
VALUES (pg_temp.c(1), pg_temp.m(6), pg_temp.m(8), pg_temp.m(9), 'Evangelística', 'Segunda', '20:00',
        'Centro', 'Porto Alegre', 'RS', true);
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, visitors)
VALUES (pg_temp.r(1), pg_temp.c(1), '2026-11-02', '20:00', true, 'Tema PR5', ARRAY['Visitante PR5']);
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (pg_temp.r(1), pg_temp.m(7));

SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- Os valores sensíveis da Xênia, lidos como dono da tabela (P1 compara com a view).
CREATE TEMP TABLE xenia_sensitive AS
  SELECT email, cpf, mobile_whatsapp, phone, street, number, complement, zip_code
    FROM public.members WHERE id = pg_temp.m(7);
GRANT SELECT ON pg_temp.xenia_sensitive TO authenticated, service_role;
-- A linha inteira da Xênia, lida como dono da tabela (base da amarração).
CREATE TEMP TABLE xenia_row AS SELECT to_jsonb(m) AS j FROM public.members m WHERE id = pg_temp.m(7);
GRANT SELECT ON pg_temp.xenia_row TO authenticated;

-- As 18 colunas de dados que um editor envia no formulário (sem id, conta,
-- função, colunas calculadas nem o bloco ministerial).
CREATE FUNCTION pg_temp.personal_columns() RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT ARRAY['avatar_url', 'baptism_date', 'birth_date', 'city', 'complement', 'cpf', 'email', 'gender',
                'instagram', 'mobile_whatsapp', 'name', 'neighborhood', 'notes', 'number', 'phone', 'state',
                'street', 'zip_code'] $$;

-- ===========================================================================
-- 1. Privilégios — 47 verificações
-- ===========================================================================
SELECT ok(NOT has_table_privilege('authenticated', 'public.members', 'SELECT'),
  'authenticated: sem SELECT de tabela em members (RN-11, PR 5)');
SELECT ok(NOT has_table_privilege('anon', 'public.members', 'SELECT'),
  'anon: sem SELECT de tabela em members');
SELECT is_empty($$ SELECT 1 FROM pg_class, aclexplode(relacl) a
                    WHERE oid = 'public.members'::regclass AND a.grantee = 0 AND a.privilege_type = 'SELECT' $$,
  'PUBLIC: sem SELECT de tabela em members');
SELECT ok(has_table_privilege('service_role', 'public.members', 'SELECT'),
  'service_role: SELECT de tabela em members (Edge Functions leem a linha inteira)');
SELECT ok(has_table_privilege('authenticated', 'public.members', 'INSERT'),
  'authenticated: INSERT de tabela mantido (create-user-admin grava com a sessão de quem chama)');
SELECT ok(has_table_privilege('authenticated', 'public.members', 'UPDATE'),
  'authenticated: UPDATE de tabela mantido (MemberForm)');
SELECT ok(NOT has_table_privilege('authenticated', 'public.members', 'DELETE'),
  'authenticated: sem DELETE de tabela (E2.01, migration 5: exclusão só pelas RPCs)');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.members'::regclass),
  'members: o RLS continua ligado');

SELECT * FROM pg_temp.column_privilege_checks();   -- 20 + 8 + 1

SELECT is(
  ARRAY(SELECT c FROM pg_temp.member_columns() c WHERE has_column_privilege('anon', 'public.members', c, 'SELECT')),
  '{}'::text[], 'anon: sem SELECT em nenhuma coluna de members');
SELECT is_empty($$ SELECT 1 FROM pg_attribute, aclexplode(attacl) a
                    WHERE attrelid = 'public.members'::regclass AND a.grantee = 0 $$,
  'PUBLIC: nenhum privilégio de coluna em members');
SELECT is_empty($$ SELECT attname, a.grantee::regrole
                     FROM pg_attribute, aclexplode(attacl) a
                    WHERE attrelid = 'public.members'::regclass
                      AND attname = ANY (pg_temp.sensitive_columns())
                      AND a.privilege_type = 'SELECT' $$,
  'Colunas sensíveis: nenhum GRANT SELECT de coluna, para nenhum papel');
SELECT is(
  ARRAY(SELECT c FROM unnest(pg_temp.sensitive_columns()) c
         WHERE NOT has_column_privilege('service_role', 'public.members', c, 'SELECT')),
  '{}'::text[], 'service_role: lê as 8 colunas sensíveis (create-user-admin)');
SELECT ok(obj_description('public.members'::regclass, 'pg_class') ~ 'GRANT SELECT \(coluna\)',
  'members: o comentário da tabela documenta a regra do GRANT por coluna');

-- ===========================================================================
-- 2. Guarda do risco 4 (falha fechada) — 3 verificações
-- ===========================================================================
SELECT is(pg_temp.ungranted_non_sensitive(), '{}'::text[],
  'Risco 4: toda coluna de members (do catálogo) é sensível, é a da função ou tem SELECT para authenticated. '
  || 'Coluna nova não sensível? GRANT SELECT (coluna) ON public.members TO authenticated na migration que a cria');
SELECT is(pg_temp.unreadable_columns('authenticated'), pg_temp.locked_columns(),
  'Risco 4: as colunas sem SELECT para authenticated são exatamente as 8 sensíveis e a role_id');
SELECT is(
  ARRAY(SELECT c FROM unnest(pg_temp.locked_columns()) c
         WHERE c NOT IN (SELECT pg_temp.member_columns()) ORDER BY c),
  '{}'::text[], 'As 8 colunas sensíveis e a role_id da lista existem em members');

-- ===========================================================================
-- 3. Amarração das listas: trava × máscara da members_view × regra 6 — 9 verificações
-- ===========================================================================
SELECT is(
  ARRAY(SELECT c FROM unnest(pg_temp.readable_columns() || pg_temp.sensitive_columns() || pg_temp.role_columns()) c
         WHERE c <> 'updated_at'   -- E2.05: nula até a primeira alteração
           AND coalesce((SELECT j FROM pg_temp.xenia_row) -> c, 'null'::jsonb) = 'null'::jsonb ORDER BY c),
  '{}'::text[], 'massa: a Xênia tem as 29 colunas (20 liberadas, 8 sensíveis e a role_id) preenchidas (updated_at nula sem alteração, E2.05)');

-- P2, sem view_sensitive_data nem "Atribuir Função"
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.masked_columns(pg_temp.m(7), (SELECT j FROM pg_temp.xenia_row)),
  pg_temp.unreadable_columns('authenticated'),
  'Amarração/P2: as colunas que a members_view mascara = as colunas sem SELECT na tabela (RN-11, RN-23)');
SELECT is((SELECT sensitive_visible FROM public.members_view WHERE id = pg_temp.m(7)), false,
  'P2: sensitive_visible = false para a Xênia');
RESET ROLE;

-- P1, com view_sensitive_data e sem "Atribuir Função": só a função fica mascarada.
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.masked_columns(pg_temp.m(7), (SELECT j FROM pg_temp.xenia_row)), pg_temp.role_columns(),
  'Amarração/P1: com view_sensitive_data, a members_view mascara só a role_id (RN-11b; RN-23, sem assign_role)');
SELECT results_eq(
  format($$ SELECT email, cpf, mobile_whatsapp, phone, street, number, complement, zip_code
              FROM public.members_view WHERE id = %L $$, pg_temp.m(7)),
  'SELECT * FROM pg_temp.xenia_sensitive',
  'P1: a members_view devolve os 8 valores reais, iguais aos da tabela (RN-11b, RN-14)');
RESET ROLE;

-- Regra 6 × trava: P2 (edit_member sem view_sensitive_data) envia as 18 colunas
-- de dados da Lia; as que ficam iguais são exatamente as colunas sem SELECT.
CREATE TEMP TABLE lia_before AS SELECT to_jsonb(m) AS j FROM public.members m WHERE id = pg_temp.m(15);
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$
  UPDATE public.members SET
    name = 'Lia Lista Alterada', gender = 'M', birth_date = '1991-02-02', notes = 'Notas novas',
    instagram = '@lia.nova', avatar_url = 'https://exemplo.invalid/lia-nova.png',
    neighborhood = 'Bairro Novo', city = 'Canoas', state = 'SC', baptism_date = '2012-02-02',
    email = 'lia.nova@teste.invalid', cpf = '10850009901', mobile_whatsapp = '51990009999', phone = '5133339999',
    street = 'Rua Nova', number = '999', complement = 'Fundos', zip_code = '99999-999'
   WHERE id = %L $$, pg_temp.m(15)),
  'P2: UPDATE das 18 colunas de dados da Lia, por id, é aceito');
RESET ROLE;
SELECT is(
  pg_temp.unchanged((SELECT j FROM pg_temp.lia_before),
                    (SELECT to_jsonb(m) FROM public.members m WHERE id = pg_temp.m(15)),
                    pg_temp.personal_columns()),
  pg_temp.sensitive_columns(),
  'Amarração/regra 6: sem view_sensitive_data, as colunas preservadas = as sensíveis, sem SELECT na tabela (RN-12)');

-- P3, com view_sensitive_data: o mesmo UPDATE troca todas as 18.
DROP TABLE pg_temp.lia_before;
CREATE TEMP TABLE lia_before AS SELECT to_jsonb(m) AS j FROM public.members m WHERE id = pg_temp.m(15);
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$
  UPDATE public.members SET
    name = 'Lia Lista Terceira', gender = 'F', birth_date = '1992-03-03', notes = 'Notas terceiras',
    instagram = '@lia.terceira', avatar_url = 'https://exemplo.invalid/lia-3.png',
    neighborhood = 'Bairro Três', city = 'Gravataí', state = 'PR', baptism_date = '2013-03-03',
    email = 'lia.terceira@teste.invalid', cpf = '10850009740', mobile_whatsapp = '51990003333', phone = '5133333333',
    street = 'Rua Três', number = '333', complement = 'Sala 3', zip_code = '33333-333'
   WHERE id = %L $$, pg_temp.m(15)),
  'P3 (com view_sensitive_data): UPDATE das 18 colunas da Lia, do seu ministério, é aceito');
RESET ROLE;
SELECT is(
  pg_temp.unchanged((SELECT j FROM pg_temp.lia_before),
                    (SELECT to_jsonb(m) FROM public.members m WHERE id = pg_temp.m(15)),
                    pg_temp.personal_columns()),
  '{}'::text[],
  'Regra 6: com view_sensitive_data, nenhuma das 18 colunas é preservada (RN-12)');

-- ===========================================================================
-- 4. Leitura como authenticated — 19 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT cpf FROM public.members', '42501', NULL,
  'P1: SELECT cpf FROM members → 42501, mesmo com view_sensitive_data (critério de pronto 11)');
SELECT * FROM pg_temp.sensitive_reads_denied('P1');   -- 8
SELECT throws_ok('SELECT * FROM public.members', '42501', NULL,
  'P1: SELECT * FROM members → 42501 (critério de pronto 11)');
SELECT lives_ok('SELECT id, name FROM public.members',
  'P1: SELECT id, name FROM members funciona');
SELECT set_eq(
  $$ SELECT id FROM public.members WHERE id::text LIKE 'c1085000%' $$,
  $$ SELECT id FROM public.members_view WHERE id::text LIKE 'c1085000%' $$,
  'P1: as linhas da tabela (sob RLS) continuam iguais às da members_view');
SELECT is((SELECT count(*)::int FROM public.members WHERE id::text LIKE 'c1085000%'), 17,
  'P1: count(*) em members funciona com o GRANT por coluna (17 da massa)');
SELECT throws_ok(format('SELECT id FROM public.members WHERE cpf = %L', '10850000793'), '42501', NULL,
  'P1: filtrar por coluna sensível (WHERE cpf = …) → 42501');
SELECT throws_ok('SELECT id FROM public.members ORDER BY email LIMIT 1', '42501', NULL,
  'P1: ordenar por coluna sensível (ORDER BY email) → 42501');
SELECT throws_ok('SELECT m.id FROM public.members m JOIN public.members s ON s.mobile_whatsapp = m.mobile_whatsapp', '42501', NULL,
  'P1: juntar por coluna sensível → 42501');
RESET ROLE;

-- O próprio membro: a tabela não devolve o próprio CPF; a members_view devolve (RN-11a).
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT cpf FROM public.members WHERE auth_user_id = auth.uid()', '42501', NULL,
  'Próprio cadastro: SELECT cpf na tabela → 42501');
SELECT is((SELECT cpf FROM public.members_view WHERE id = pg_temp.m(6)), '10850000602',
  'Próprio cadastro: a members_view devolve o próprio CPF (RN-11a)');
RESET ROLE;

-- P5 (sem função): o RLS continua valendo por cima do GRANT de coluna.
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT set_eq($$ SELECT id FROM public.members $$, ARRAY[pg_temp.m(14)],
  'P5: SELECT id FROM members devolve só o próprio cadastro (RLS inalterado)');
RESET ROLE;

-- ===========================================================================
-- 5. Escrita como authenticated — 18 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$ UPDATE public.members SET notes = 'notas PR5' WHERE id = %L $$, pg_temp.m(16)),
  'P1: UPDATE … WHERE id = … funciona (MemberForm)');
SELECT results_eq(
  format($$ UPDATE public.members SET instagram = '@nuno.pr5' WHERE id = %L RETURNING id $$, pg_temp.m(16)),
  format($$ VALUES (%L::uuid) $$, pg_temp.m(16)),
  'P1: UPDATE … RETURNING id funciona');
SELECT throws_ok(format($$ UPDATE public.members SET notes = 'x' WHERE id = %L RETURNING cpf $$, pg_temp.m(16)), '42501', NULL,
  'P1: UPDATE … RETURNING cpf → 42501');
SELECT throws_ok(format($$ UPDATE public.members SET notes = 'x' WHERE id = %L RETURNING * $$, pg_temp.m(16)), '42501', NULL,
  'P1: UPDATE … RETURNING * → 42501 (return=representation sem select= no PostgREST)');
SELECT throws_ok(format($$ UPDATE public.members SET notes = 'x' WHERE cpf = %L $$, '10850000793'), '42501', NULL,
  'P1: UPDATE … WHERE cpf = … → 42501');
SELECT throws_ok(format($$ UPDATE public.members SET notes = cpf WHERE id = %L $$, pg_temp.m(16)), '42501', NULL,
  'P1: copiar uma coluna sensível para uma legível (SET notes = cpf) → 42501');
SELECT lives_ok(format($$ UPDATE public.members SET cpf = '10850002222' WHERE id = %L $$, pg_temp.m(16)),
  'P1: gravar uma coluna sensível sem lê-la (SET cpf = valor) funciona');
SELECT throws_ok(format($$ DELETE FROM public.members WHERE id = %L $$, pg_temp.m(12)), '42501', NULL,
  'P1 (delete_member): DELETE … WHERE id = … → 42501 (E2.01: exclusão só pelas RPCs)');
SELECT throws_ok(format($$ DELETE FROM public.members WHERE id = %L RETURNING cpf $$, pg_temp.m(17)), '42501', NULL,
  'P1: DELETE … RETURNING cpf → 42501 (sem DELETE de tabela desde o E2.01)');
RESET ROLE;

SELECT results_eq(
  format($$ SELECT notes, instagram, cpf FROM public.members WHERE id = %L $$, pg_temp.m(16)),
  $$ VALUES ('notas PR5'::text, '@nuno.pr5'::text, '10850002222'::text) $$,
  'P1: as escritas por id gravaram (notes, instagram e o CPF, que P1 vê)');
SELECT isnt_empty(format($$ SELECT 1 FROM public.members WHERE id = %L $$, pg_temp.m(12)),
  'P1: o DELETE … WHERE id recusado não tirou o membro da tabela');
SELECT isnt_empty(format($$ SELECT 1 FROM public.members WHERE id = %L $$, pg_temp.m(17)),
  'P1: o DELETE … RETURNING cpf recusado não excluiu nada');

-- Cadastro como a create-user-admin faz: INSERT com a sessão de quem chama, sem
-- RETURNING, por quem tem create_member e não vê dados sensíveis (RN-12).
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$
  INSERT INTO public.members
    (id, name, gender, leader_id, has_leadership, is_active, email, cpf, mobile_whatsapp, phone,
     street, number, complement, zip_code, neighborhood, city, state, auth_user_id)
  VALUES (%L, 'Nina Nova', 'F', %L, true, true, 'nina.pr5@teste.invalid', '10850002060', '51990000020', '5133330020',
          'Rua Nova', '20', 'Casa', '90000-020', 'Centro', 'Porto Alegre', 'RS', %L) $$,
  pg_temp.m(20), pg_temp.m(5), pg_temp.u(7)),
  'Cadastro (create_member, sem view_sensitive_data): INSERT sem RETURNING funciona');
SELECT results_eq(
  format($$ INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp)
            VALUES (%L, 'Otto Outro', 'M', %L, true, true, '51910850021') RETURNING id $$, pg_temp.m(21), pg_temp.m(5)),
  format($$ VALUES (%L::uuid) $$, pg_temp.m(21)),
  'Cadastro: INSERT … RETURNING id funciona');
SELECT throws_ok(
  format($$ INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, cpf)
            VALUES (%L, 'Rita Retorno', 'F', %L, true, true, '10850002141') RETURNING cpf $$, pg_temp.m(22), pg_temp.m(5)),
  '42501', NULL, 'Cadastro: INSERT … RETURNING cpf → 42501');
RESET ROLE;

SELECT results_eq(
  format($$ SELECT m.name, m.email, m.cpf, m.mobile_whatsapp, m.street, m.zip_code, m.auth_user_id, h.g12_level
              FROM public.members m JOIN private.member_hierarchy h ON h.member_id = m.id
             WHERE m.id = %L $$, pg_temp.m(20)),
  format($$ VALUES ('Nina Nova'::text, 'nina.pr5@teste.invalid'::text, '10850002060'::text, '51990000020'::text,
                    'Rua Nova'::text, '90000-020'::text, %L::uuid, 2) $$, pg_temp.u(7)),
  'Cadastro: todos os campos gravados, inclusive os sensíveis, com g12_level calculado (RN-12)');
SELECT is_empty(format($$ SELECT 1 FROM public.members WHERE id = %L $$, pg_temp.m(22)),
  'Cadastro: o INSERT … RETURNING cpf recusado não gravou nada');
SELECT ok(EXISTS (SELECT 1 FROM public.events
                   WHERE action = 'create' AND entity = 'member' AND entity_id = pg_temp.m(20)
                     AND actor_user_id = pg_temp.u(5) AND actor_label = 'Clara Cadastro'),
  'Cadastro: a auditoria registra o autor (actor_user_id e o nome)');

-- ===========================================================================
-- 6. Regressões que dependem de leitura interna da tabela — 28 verificações
-- ===========================================================================
-- Regra 6 (RN-12): edit_member sem view_sensitive_data troca o nome e não o CPF.
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$ UPDATE public.members SET name = 'Edite Renomeada', cpf = '10850009901' WHERE id = %L $$,
                       pg_temp.m(9)),
  'Regra 6/P2: UPDATE trocando nome e CPF é aceito');
RESET ROLE;
SELECT results_eq(format($$ SELECT name, cpf FROM public.members WHERE id = %L $$, pg_temp.m(9)),
  $$ VALUES ('Edite Renomeada'::text, '10850000955'::text) $$,
  'Regra 6/P2: o nome muda e o CPF continua o mesmo (RN-12)');

-- Com view_sensitive_data, troca o CPF (por um que nenhum outro cadastro usa:
-- o 10850009820 é do Rui, e o CPF é único desde o E2.04).
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$ UPDATE public.members SET cpf = '10850009073' WHERE id = %L $$, pg_temp.m(9)),
  'P3 com view_sensitive_data: UPDATE do CPF é aceito');
RESET ROLE;
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(9)), '10850009073',
  'P3 com view_sensitive_data: o CPF muda (RN-12)');

-- O próprio membro troca o próprio celular e não troca o próprio líder (regra 5).
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$ UPDATE public.members SET mobile_whatsapp = '51998887766' WHERE id = %L $$, pg_temp.m(6)),
  'Próprio cadastro: UPDATE do próprio celular é aceito');
SELECT throws_ok(format($$ UPDATE public.members SET leader_id = %L WHERE id = %L $$, pg_temp.m(5), pg_temp.m(6)),
  '22023', 'Você só pode alterar os seus dados pessoais. Não é permitido alterar: líder.',
  'Próprio cadastro sem edit_member: trocar o próprio líder → own_data_only, 22023 (regra 5; E2.02 AQ-5 tira do 42501)');
RESET ROLE;
SELECT is((SELECT mobile_whatsapp FROM public.members WHERE id = pg_temp.m(6)), '51998887766',
  'Próprio cadastro: o celular muda (RN-12)');

-- service_role: troca o CPF e lê a linha inteira.
SET LOCAL ROLE service_role;
SELECT lives_ok(format($$ UPDATE public.members SET cpf = '10850009669' WHERE id = %L $$, pg_temp.m(9)),
  'service_role: UPDATE do CPF é aceito');
SELECT results_eq(
  format($$ SELECT email, cpf, mobile_whatsapp FROM public.members WHERE id = %L $$, pg_temp.m(7)),
  'SELECT email, cpf, mobile_whatsapp FROM pg_temp.xenia_sensitive',
  'service_role: lê as colunas sensíveis na tabela (create-user-admin)');
RESET ROLE;
SELECT is((SELECT cpf FROM public.members WHERE id = pg_temp.m(9)), '10850009669',
  'service_role: o CPF muda (RN-12)');

-- Líder e cônjuge trocados como authenticated: g12_level, cônjuge, totais e auditoria.
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT lives_ok(format($$ UPDATE public.members SET leader_id = %L WHERE id = %L $$, pg_temp.m(6), pg_temp.m(10)),
  'P1: trocar o líder do Bento (do G12 Bruno para o Antônio, nível 2) é aceito');
SELECT lives_ok(format($$ UPDATE public.members SET spouse_id = %L WHERE id = %L $$, pg_temp.m(11), pg_temp.m(10)),
  'P1: definir a Bia como cônjuge do Bento é aceito');
RESET ROLE;
SELECT is((SELECT g12_level FROM private.member_hierarchy WHERE member_id = pg_temp.m(10)), 3,
  'hierarquia (E2.06): o Bento passa ao nível 3');
SELECT is((SELECT spouse_id FROM public.members WHERE id = pg_temp.m(11)), pg_temp.m(10),
  'sync_spouse_relationship: a Bia passa a ter o Bento como cônjuge');
SELECT is((SELECT total_disciples FROM private.member_hierarchy WHERE member_id = pg_temp.m(6)), 1,
  'hierarquia (E2.06): o Antônio passa a ter 1 discípulo');
SELECT ok(EXISTS (SELECT 1 FROM public.events
                   WHERE action = 'update' AND entity = 'member' AND entity_id = pg_temp.m(10)
                     AND actor_user_id = pg_temp.u(1) AND 'leader_id' = ANY (changed_fields)),
  'Auditoria: a troca de líder foi registrada com o autor');
SELECT ok(EXISTS (SELECT 1 FROM public.events
                   WHERE action = 'update' AND entity = 'member' AND entity_id = pg_temp.m(10)
                     AND actor_user_id = pg_temp.u(1) AND 'spouse_id' = ANY (changed_fields)),
  'Auditoria: a troca de cônjuge foi registrada com o autor');

-- Views e RPCs continuam respondendo como authenticated.
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT lives_ok('SELECT * FROM public.members_view LIMIT 5',
  'P1: SELECT * FROM members_view funciona');
SELECT results_eq(
  format($$ SELECT leader_name, timothy_name, host_name FROM public.cells_view WHERE id = %L $$, pg_temp.c(1)),
  $$ VALUES ('Antônio Araújo'::text, 'Marcos Moura'::text, 'Edite Renomeada'::text) $$,
  'P1: cells_view responde, com os nomes do líder, do timóteo e da anfitriã');
SELECT is((SELECT cell_leader_name FROM public.cell_reports_view WHERE id = pg_temp.r(1)), 'Antônio Araújo',
  'P1: cell_reports_view responde, com o nome do líder da célula');
SELECT is((SELECT member_name FROM public.cell_report_participants_view WHERE report_id = pg_temp.r(1)), 'Xênia Completa',
  'P1: cell_report_participants_view responde, com o nome do participante');
SELECT is((SELECT count(*)::int FROM public.dashboard_summary()), 1,
  'P1: dashboard_summary responde');
SELECT lives_ok('SELECT * FROM public.dashboard_cells_by_type()',
  'P1: dashboard_cells_by_type responde');
SELECT lives_ok('SELECT * FROM public.dashboard_g12_ranking()',
  'P1: dashboard_g12_ranking responde');
SELECT set_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L)', ARRAY[pg_temp.m(1), pg_temp.m(2)]),
  format($$ VALUES (%L::uuid, %L::uuid), (%L::uuid, NULL::uuid) $$, pg_temp.m(3), pg_temp.m(4), pg_temp.m(5)),
  'P1: ministry_tree_nodes responde (André & Ana e Bruno abaixo dos pastores)');
RESET ROLE;

SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format('SELECT id, name FROM public.member_names(%L) ORDER BY name', ARRAY[pg_temp.m(7), pg_temp.m(3)]),
  format($$ VALUES (%L::uuid, 'André Alves'::text), (%L::uuid, 'Xênia Completa'::text) $$, pg_temp.m(3), pg_temp.m(7)),
  'P2: member_names responde');
SELECT is((SELECT cpf FROM public.members_view WHERE id = pg_temp.m(7)), NULL,
  'P2: a members_view devolve o CPF da Xênia nulo (RN-11)');
RESET ROLE;

-- RN-11, critério de aceite: P3 com view_sensitive_data vê o CPF real de quem é do ministério.
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT is((SELECT cpf FROM public.members_view WHERE id = pg_temp.m(7)), '10850000793',
  'P3 com view_sensitive_data: vê o CPF real da Xênia, do seu ministério (RN-11b)');
RESET ROLE;

-- ===========================================================================
-- 7. anon — 5 verificações
-- ===========================================================================
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT id FROM public.members', '42501', NULL, 'anon: SELECT id FROM members → 42501');
SELECT throws_ok('SELECT count(*) FROM public.members', '42501', NULL, 'anon: SELECT count(*) FROM members → 42501');
SELECT throws_ok(format($$ UPDATE public.members SET name = 'x' WHERE id = %L $$, pg_temp.m(16)), '42501', NULL,
  'anon: UPDATE … WHERE id = … → 42501');
SELECT throws_ok('SELECT id FROM public.members_view', '42501', NULL, 'anon: SELECT id FROM members_view → 42501');
RESET ROLE;
SELECT is((SELECT name FROM public.members WHERE id = pg_temp.m(16)), 'Nuno Notas',
  'anon: o UPDATE recusado não alterou nada');

-- ===========================================================================
-- 8. A guarda do risco 4 pega uma coluna nova sem GRANT — 5 verificações
--    (a coluna só existe dentro desta transação)
-- ===========================================================================
ALTER TABLE public.members ADD COLUMN qa_e108_pr5_nova text;
SELECT is(pg_temp.ungranted_non_sensitive(), ARRAY['qa_e108_pr5_nova'],
  'Risco 4 (mutação): uma coluna nova sem GRANT é apontada pela guarda');
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok('SELECT qa_e108_pr5_nova FROM public.members', '42501', NULL,
  'Risco 4 (mutação): sem o GRANT, a coluna nova não é legível (falha fechada)');
RESET ROLE;
GRANT SELECT (qa_e108_pr5_nova) ON public.members TO authenticated;
SELECT is(pg_temp.ungranted_non_sensitive(), '{}'::text[],
  'Risco 4 (mutação): com o GRANT SELECT (coluna), a guarda volta a passar');
SET LOCAL ROLE authenticated;
SELECT lives_ok('SELECT qa_e108_pr5_nova FROM public.members',
  'Risco 4 (mutação): com o GRANT, a coluna nova é legível');
SELECT throws_ok('SELECT * FROM public.members', '42501', NULL,
  'Risco 4 (mutação): select * continua negado');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
