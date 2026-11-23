-- E1.08 (PR 2): cells_view, cell_reports_view e cell_report_participants_view.
-- Spec: docs/specs/e1-08-paginacao-servidor.md (repositório apps-mci).
--
-- Cobre:
--   - RN-05 (escopo inalterado): por persona, os ids de cada view são os mesmos
--     que a pessoa lê na tabela sob o RLS atual; e a members_view continua
--     igual à tabela members (regressão do PR 1);
--   - RN-06 (nomes de referência): nomes de líder, timóteo, anfitrião e G12 da
--     célula, do líder da célula do relatório e dos participantes aparecem
--     mesmo fora do escopo, sem que esses cadastros apareçam na members_view;
--   - colunas calculadas: G12, dia da semana, último relatório, semana,
--     contagens e busca (RN-04);
--   - grants e opções das views (só leitura, só para usuários logados).
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: npx supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(145);

-- ---------------------------------------------------------------------------
-- Ids fixos da massa: a(uth), b (roles), c (membros), d (células), e (relatórios).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a1080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b1080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c1080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d1080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e1080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

CREATE FUNCTION pg_temp.ms(VARIADIC _n int[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(pg_temp.m(x)), '{}') FROM unnest(_n) x $$;
CREATE FUNCTION pg_temp.cs(VARIADIC _n int[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(pg_temp.c(x)), '{}') FROM unnest(_n) x $$;
CREATE FUNCTION pg_temp.rs(VARIADIC _n int[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(pg_temp.r(x)), '{}') FROM unnest(_n) x $$;

-- Entra como o usuário do Auth número _n (a role é trocada fora, com SET LOCAL ROLE).
CREATE FUNCTION pg_temp.login(_n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
$$;

-- RN-05: ids das views = ids das tabelas sob RLS, para quem está logado agora.
-- Inclui a members_view (regressão do PR 1).
CREATE FUNCTION pg_temp.parity(_who text) RETURNS SETOF text LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEXT set_eq(
    'SELECT id FROM public.cells_view',
    'SELECT id FROM public.cells',
    _who || ': cells_view = cells sob RLS (RN-05)');
  RETURN NEXT set_eq(
    'SELECT id FROM public.cell_reports_view',
    'SELECT id FROM public.cell_reports',
    _who || ': cell_reports_view = cell_reports sob RLS (RN-05)');
  RETURN NEXT set_eq(
    'SELECT report_id, member_id FROM public.cell_report_participants_view',
    'SELECT report_id, member_id FROM public.cell_report_participants',
    _who || ': cell_report_participants_view = cell_report_participants sob RLS (RN-05)');
  RETURN NEXT set_eq(
    'SELECT id FROM public.members_view',
    'SELECT id FROM public.members',
    _who || ': members_view = members sob RLS (regressão do PR 1)');
END $$;

-- ---------------------------------------------------------------------------
-- Massa. Triggers desligados (níveis e cônjuges explícitos; datas fixas).
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e108pr2-' || n || '@teste.local' FROM generate_series(1, 9) n;
-- 1 P1, 2 P2, 3 P3, 4 P4, 5 P3b, 6 P4b, 7 P5, 8 sem cadastro de membro, 9 pastor

INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'Teste E108 P1 view_members'),
  (pg_temp.role(2), 'Teste E108 P2 view_all_church'),
  (pg_temp.role(3), 'Teste E108 P3 view_own_ministry'),
  (pg_temp.role(4), 'Teste E108 P4 view_own_reports'),
  (pg_temp.role(5), 'Teste E108 P3b view_own_ministry + view_own_reports'),
  (pg_temp.role(6), 'Teste E108 P4b view_all_reports'),
  (pg_temp.role(9), 'Teste E108 pastor view_own_ministry');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(1), 'view_members'),
  (pg_temp.role(2), 'view_all_church'),
  (pg_temp.role(3), 'view_own_ministry'),
  (pg_temp.role(4), 'view_own_reports'),
  (pg_temp.role(5), 'view_own_ministry'),
  (pg_temp.role(5), 'view_own_reports'),
  (pg_temp.role(6), 'view_all_reports'),
  (pg_temp.role(9), 'view_own_ministry');

-- Árvore:
--   Pastores Paulo (01) e Priscila (02), casados.
--   Ministério A: André (03, G12) e Ana (04, G12), casados.
--     André → Antônio (06) → Arthur (08); André → Alberto (07)
--     Ana → Amanda (09); Ana → João da Silva (14)
--   Ministério B: Bruno (05, G12) → Bento (10) → Bia (13, inativa);
--     Bruno → Breno (11); Bruno → Hélio (15)
--   Xavier (12): sem líder e sem ser pastor (nível 0).
INSERT INTO public.members
  (id, name, gender, is_pastor, g12_level, leader_id, spouse_id, is_active, auth_user_id, role_id)
VALUES
  (pg_temp.m(1),  'Paulo Pastor',      'M', true,  0, NULL,          pg_temp.m(2), true,  pg_temp.u(9), pg_temp.role(9)),
  (pg_temp.m(2),  'Priscila Pastora',  'F', true,  0, NULL,          pg_temp.m(1), true,  pg_temp.u(1), pg_temp.role(1)),
  (pg_temp.m(3),  'André Gonçalves',   'M', false, 1, pg_temp.m(1),  pg_temp.m(4), true,  NULL,         NULL),
  (pg_temp.m(4),  'Ana Gonçalves',     'F', false, 1, pg_temp.m(2),  pg_temp.m(3), true,  NULL,         NULL),
  (pg_temp.m(5),  'Bruno Brandão',     'M', false, 1, pg_temp.m(1),  NULL,         true,  pg_temp.u(2), pg_temp.role(2)),
  (pg_temp.m(6),  'Antônio Araújo',    'M', false, 2, pg_temp.m(3),  NULL,         true,  NULL,         NULL),
  (pg_temp.m(7),  'Alberto Alves',     'M', false, 2, pg_temp.m(3),  NULL,         true,  pg_temp.u(4), pg_temp.role(4)),
  (pg_temp.m(8),  'Arthur Assis',      'M', false, 3, pg_temp.m(6),  NULL,         true,  pg_temp.u(3), pg_temp.role(3)),
  (pg_temp.m(9),  'Amanda Azevedo',    'F', false, 2, pg_temp.m(4),  NULL,         true,  pg_temp.u(5), pg_temp.role(5)),
  (pg_temp.m(10), 'Bento Barros',      'M', false, 2, pg_temp.m(5),  NULL,         true,  pg_temp.u(7), NULL),
  (pg_temp.m(11), 'Breno Batista',     'M', false, 2, pg_temp.m(5),  NULL,         true,  pg_temp.u(6), pg_temp.role(6)),
  (pg_temp.m(12), 'Xavier Xisto',      'M', false, 0, NULL,          NULL,         true,  NULL,         NULL),
  (pg_temp.m(13), 'Bia Bastos',        'F', false, 3, pg_temp.m(10), NULL,         false, NULL,         NULL),
  (pg_temp.m(14), 'João da Silva',     'M', false, 2, pg_temp.m(4),  NULL,         true,  NULL,         NULL),
  (pg_temp.m(15), 'Hélio Hospedeiro',  'M', false, 2, pg_temp.m(5),  NULL,         true,  NULL,         NULL);

INSERT INTO public.cells
  (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time,
   street, number, neighborhood, city, state, created_at)
VALUES
  -- 01: ministério A, anfitrião do ministério B.
  (pg_temp.c(1),  pg_temp.m(6),  pg_temp.m(8),  pg_temp.m(15), 'Evangelística', 'Segunda', '20:00',
   'Rua das Flores', '100', 'Centro', 'Porto Alegre', 'RS', '2026-11-01 10:00-03'),
  -- 02: ministério B; só o anfitrião (Alberto) é do ministério A.
  (pg_temp.c(2),  pg_temp.m(10), pg_temp.m(11), pg_temp.m(7),  'Discipulado',   'Terça',   '19:30',
   'Av. Brasil', '200', 'São João', 'Porto Alegre', 'RS', '2026-11-02 10:00-03'),
  -- 03: sem timóteo, sem anfitrião e sem endereço.
  (pg_temp.c(3),  pg_temp.m(7),  NULL,          NULL,          'Evangelística', 'Quarta',  '20:00',
   NULL, NULL, NULL, NULL, NULL, '2026-11-03 10:00-03'),
  -- 04: líder do ministério B, timóteo do ministério A (abaixo do cônjuge do G12), anfitriã inativa.
  (pg_temp.c(4),  pg_temp.m(11), pg_temp.m(9),  pg_temp.m(13), 'Macrocélula',   'Sábado',  '16:00',
   'Rua Ipê', '40', 'Ipiranga', 'Canoas', 'RS', '2026-11-04 10:00-03'),
  -- 05: líder sem líder e sem ser pastor.
  (pg_temp.c(5),  pg_temp.m(12), NULL,          NULL,          'Evangelística', 'Domingo', '18:00',
   NULL, NULL, NULL, NULL, NULL, '2026-11-05 10:00-03'),
  -- 06: líder pastor; anfitriã é a cônjuge do G12 A.
  (pg_temp.c(6),  pg_temp.m(1),  NULL,          pg_temp.m(4),  'Discipulado',   'Sexta',   '20:00',
   NULL, NULL, NULL, NULL, NULL, '2026-11-06 10:00-03'),
  -- 07: dia desconhecido; líder inativa.
  (pg_temp.c(7),  pg_temp.m(13), pg_temp.m(10), NULL,          'Evangelística', 'Feriado', '20:00',
   NULL, NULL, NULL, NULL, NULL, '2026-11-07 10:00-03'),
  -- 08: sem líder, sem timóteo, sem anfitrião, sem horário.
  (pg_temp.c(8),  NULL,          NULL,          NULL,          'Evangelística', 'Quinta',  NULL,
   NULL, NULL, NULL, NULL, NULL, '2026-11-08 10:00-03'),
  -- 09: líder é o próprio G12; anfitrião João da Silva.
  (pg_temp.c(9),  pg_temp.m(3),  NULL,          pg_temp.m(14), 'Evangelística', 'Quinta',  '20:00',
   'Rua São José', '9', 'Jardim Botânico', 'Porto Alegre', 'RS', '2026-11-09 10:00-03'),
  -- 10: líder abaixo da cônjuge do G12.
  (pg_temp.c(10), pg_temp.m(14), NULL,          NULL,          'Discipulado',   'Quarta',  '19:00',
   'Rua Ágata', '5', 'Glória', 'Porto Alegre', 'RS', '2026-11-10 10:00-03');

-- Datas: 2026-11-01, 08, 15 e 22 são domingos.
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, observations, visitors, was_held) VALUES
  (pg_temp.r(1),  pg_temp.c(1),  '2026-11-02', '20:00', 'Fé',        NULL, ARRAY['Visitante Um', 'Visitante Dois'], true),
  (pg_temp.r(2),  pg_temp.c(1),  '2026-11-09', '20:00', 'Esperança', NULL, NULL,                       true),
  (pg_temp.r(3),  pg_temp.c(2),  '2026-11-10', '19:30', 'Amor',      NULL, '{}',                       true),
  (pg_temp.r(4),  pg_temp.c(3),  '2026-11-18', '20:00', 'Graça',     NULL, '{}',                       true),
  (pg_temp.r(5),  pg_temp.c(4),  '2026-11-21', '16:00', 'Perdão',    NULL, '{}',                       true),
  (pg_temp.r(6),  pg_temp.c(5),  '2026-11-15', '18:00', 'Oração',    NULL, '{}',                       true),
  (pg_temp.r(7),  pg_temp.c(6),  '2026-11-20', '20:00', 'Família',   NULL, '{}',                       true),
  (pg_temp.r(8),  pg_temp.c(7),  '2026-11-17', '20:00', 'Missão',    NULL, '{}',                       true),
  (pg_temp.r(9),  pg_temp.c(6),  '2026-11-13', '20:00', NULL,        'Chuva forte', '{}',              false),
  (pg_temp.r(10), pg_temp.c(10), '2026-11-18', '19:00', 'Salvação',  'Observação sobre Gonçalves', ARRAY['José Visitante'], true),
  (pg_temp.r(11), pg_temp.c(2),  '2026-11-15', '19:30', 'Comunhão',  NULL, '{}',                       true);

INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  (pg_temp.r(1),  pg_temp.m(6)),  (pg_temp.r(1),  pg_temp.m(8)),  (pg_temp.r(1),  pg_temp.m(15)),
  (pg_temp.r(2),  pg_temp.m(6)),  (pg_temp.r(2),  pg_temp.m(10)),
  (pg_temp.r(3),  pg_temp.m(10)), (pg_temp.r(3),  pg_temp.m(11)), (pg_temp.r(3),  pg_temp.m(7)),
  (pg_temp.r(4),  pg_temp.m(7)),
  (pg_temp.r(5),  pg_temp.m(11)), (pg_temp.r(5),  pg_temp.m(9)),  (pg_temp.r(5),  pg_temp.m(13)),
  (pg_temp.r(6),  pg_temp.m(12)),
  (pg_temp.r(7),  pg_temp.m(1)),  (pg_temp.r(7),  pg_temp.m(4)),
  (pg_temp.r(8),  pg_temp.m(13)), (pg_temp.r(8),  pg_temp.m(10)),
  (pg_temp.r(10), pg_temp.m(14)), (pg_temp.r(10), pg_temp.m(9)),
  (pg_temp.r(11), pg_temp.m(10));

SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- 1. Grants, dono e opções das views (risco 2) — 30 verificações
-- ===========================================================================
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.cells_view'::regclass),
  'postgres', 'cells_view: dono é postgres (ignora o RLS e repete o predicado)');
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.cell_reports_view'::regclass),
  'postgres', 'cell_reports_view: dono é postgres');
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.cell_report_participants_view'::regclass),
  'postgres', 'cell_report_participants_view: dono é postgres');

SELECT ok((SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.cells_view'::regclass),
  'cells_view: security_barrier=true');
SELECT ok((SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.cell_reports_view'::regclass),
  'cell_reports_view: security_barrier=true');
SELECT ok((SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = 'public.cell_report_participants_view'::regclass),
  'cell_report_participants_view: security_barrier=true');

SELECT ok((SELECT 'security_invoker=false' = ANY(reloptions) FROM pg_class WHERE oid = 'public.cells_view'::regclass),
  'cells_view: security_invoker=false');
SELECT ok((SELECT 'security_invoker=false' = ANY(reloptions) FROM pg_class WHERE oid = 'public.cell_reports_view'::regclass),
  'cell_reports_view: security_invoker=false');
SELECT ok((SELECT 'security_invoker=false' = ANY(reloptions) FROM pg_class WHERE oid = 'public.cell_report_participants_view'::regclass),
  'cell_report_participants_view: security_invoker=false');

SELECT ok(NOT has_table_privilege('anon', 'public.cells_view', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'cells_view: anon sem nenhum privilégio');
SELECT ok(NOT has_table_privilege('anon', 'public.cell_reports_view', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'cell_reports_view: anon sem nenhum privilégio');
SELECT ok(NOT has_table_privilege('anon', 'public.cell_report_participants_view', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'cell_report_participants_view: anon sem nenhum privilégio');

SELECT ok(has_table_privilege('authenticated', 'public.cells_view', 'SELECT'),
  'cells_view: authenticated com SELECT');
SELECT ok(has_table_privilege('authenticated', 'public.cell_reports_view', 'SELECT'),
  'cell_reports_view: authenticated com SELECT');
SELECT ok(has_table_privilege('authenticated', 'public.cell_report_participants_view', 'SELECT'),
  'cell_report_participants_view: authenticated com SELECT');

SELECT ok(NOT has_table_privilege('authenticated', 'public.cells_view', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'cells_view: authenticated sem INSERT/UPDATE/DELETE/TRUNCATE');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cell_reports_view', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'cell_reports_view: authenticated sem INSERT/UPDATE/DELETE/TRUNCATE');
SELECT ok(NOT has_table_privilege('authenticated', 'public.cell_report_participants_view', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'cell_report_participants_view: authenticated sem INSERT/UPDATE/DELETE/TRUNCATE');

SELECT is_empty($$ SELECT 1 FROM pg_class, aclexplode(relacl) a
                    WHERE oid = 'public.cells_view'::regclass AND a.grantee = 0 $$,
  'cells_view: nada concedido a PUBLIC');
SELECT is_empty($$ SELECT 1 FROM pg_class, aclexplode(relacl) a
                    WHERE oid = 'public.cell_reports_view'::regclass AND a.grantee = 0 $$,
  'cell_reports_view: nada concedido a PUBLIC');
SELECT is_empty($$ SELECT 1 FROM pg_class, aclexplode(relacl) a
                    WHERE oid = 'public.cell_report_participants_view'::regclass AND a.grantee = 0 $$,
  'cell_report_participants_view: nada concedido a PUBLIC');

-- Comportamento: anon não lê; authenticated não escreve pelas views.
SET LOCAL ROLE anon;
SELECT throws_ok('SELECT 1 FROM public.cells_view', '42501', NULL, 'anon: SELECT em cells_view é negado');
SELECT throws_ok('SELECT 1 FROM public.cell_reports_view', '42501', NULL, 'anon: SELECT em cell_reports_view é negado');
SELECT throws_ok('SELECT 1 FROM public.cell_report_participants_view', '42501', NULL, 'anon: SELECT em cell_report_participants_view é negado');
RESET ROLE;

SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT throws_ok(format('UPDATE public.cells_view SET street = %L WHERE id = %L', 'Rua X', pg_temp.c(1)),
  NULL, NULL, 'authenticated: UPDATE pela cells_view falha');
SELECT throws_ok(format('DELETE FROM public.cell_reports_view WHERE id = %L', pg_temp.r(1)),
  NULL, NULL, 'authenticated: DELETE pela cell_reports_view falha');
SELECT throws_ok(format('INSERT INTO public.cell_report_participants_view (report_id, member_id) VALUES (%L, %L)',
                        pg_temp.r(9), pg_temp.m(1)),
  NULL, NULL, 'authenticated: INSERT pela cell_report_participants_view falha');
RESET ROLE;
SELECT is((SELECT street FROM public.cells WHERE id = pg_temp.c(1)), 'Rua das Flores',
  'a tentativa de escrita pela view não alterou a célula');

SELECT has_index('public', 'cell_reports', 'cell_reports_cell_id_date_idx',
  'índice cell_reports (cell_id, date DESC)');
SELECT has_index('public', 'cell_report_participants', 'cell_report_participants_member_id_idx',
  'índice cell_report_participants (member_id)');

-- ===========================================================================
-- 2. Contrato de colunas (ordem fixada no spec; risco 5) — 3 verificações
-- ===========================================================================
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.cells_view'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['id', 'leader_id', 'timothy_id', 'host_id', 'type', 'meeting_day', 'meeting_time',
        'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'zip_code',
        'is_active', 'created_at', 'updated_at',
        'meeting_weekday', 'leader_name', 'leader_gender', 'leader_g12_level', 'timothy_name',
        'host_name', 'g12_leader_id', 'g12_leader_name', 'last_report_date', 'search_text'],
  'cells_view: colunas na ordem do spec');
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.cell_reports_view'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['id', 'cell_id', 'date', 'time', 'theme', 'observations', 'visitors', 'offering',
        'was_held', 'reason_not_held', 'created_at', 'updated_at',
        'week_start', 'visitors_count', 'participants_count', 'cell_type', 'cell_is_active',
        'cell_leader_id', 'cell_leader_name', 'cell_timothy_id', 'cell_host_id', 'cell_street',
        'cell_number', 'cell_complement', 'cell_neighborhood', 'cell_meeting_day',
        'cell_meeting_time', 'search_text', 'cell_deleted'],
  'cell_reports_view: colunas na ordem do spec (cell_deleted no fim, E2.01 AQ-4)');
SELECT is(
  (SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.cell_report_participants_view'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['report_id', 'member_id', 'member_name', 'member_deleted'],
  'cell_report_participants_view: colunas na ordem do spec (member_deleted no fim, E2.01 AQ-5)');

-- ===========================================================================
-- 3. Paridade por persona (RN-05) e o que cada uma vê — 9 personas
-- ===========================================================================

-- P1: view_members (Priscila) — 4 + 3
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P1 view_members');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), 'P1: vê todas as células');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), 'P1: vê todos os relatórios');
SELECT is((SELECT count(*)::int FROM public.cell_report_participants_view WHERE report_id::text LIKE 'e1080000%'),
  20, 'P1: vê todas as 20 participações');
RESET ROLE;

-- P2: view_all_church (Bruno) — 4 + 2
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P2 view_all_church');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), 'P2: vê todas as células');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), 'P2: vê todos os relatórios');
RESET ROLE;

-- P3: view_own_ministry (Arthur, ministério A) — 4 + 5
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P3 view_own_ministry');
SELECT set_eq($$ SELECT id FROM public.members_view WHERE id::text LIKE 'c1080000%' $$,
  pg_temp.ms(3, 4, 6, 7, 8, 9, 14), 'P3: membros do ministério A, inclusive a cônjuge do G12 e a subárvore dela');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(1, 2, 3, 4, 6, 9, 10),
  'P3: células com líder, timóteo ou anfitrião no ministério (02 e 06 só pelo anfitrião; 03 sem timóteo/anfitrião; 10 abaixo da cônjuge do G12)');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(1, 2, 4, 5, 10),
  'P3: relatórios das células com líder ou timóteo no ministério (sem os das células 02 e 06, vistas só pelo anfitrião)');
SELECT is_empty(format('SELECT 1 FROM public.cell_report_participants_view WHERE report_id IN (%L, %L, %L)',
                       pg_temp.r(3), pg_temp.r(11), pg_temp.r(7)),
  'P3: participantes dos relatórios fora do escopo não aparecem');
SELECT is((SELECT count(*)::int FROM public.cell_report_participants_view WHERE report_id::text LIKE 'e1080000%'),
  11, 'P3: participações dos 5 relatórios visíveis (3 + 2 + 1 + 3 + 2)');
RESET ROLE;

-- P3b: view_own_ministry + view_own_reports (Amanda, abaixo da cônjuge do G12) — 4 + 2
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P3b view_own_ministry + view_own_reports');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(1, 2, 3, 4, 6, 9, 10), 'P3b: mesmas células de P3 (mesmo ministério)');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(1, 2, 4, 5, 10), 'P3b: view_own_reports não acrescenta relatórios além do ministério');
RESET ROLE;

-- P4: só view_own_reports (Alberto; achado 3: vê só a própria célula) — 4 + 4
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P4 view_own_reports');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(3), 'P4: só a célula que lidera (a 02, em que é só anfitrião, não aparece)');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(4), 'P4: só os relatórios da própria célula (achado 3)');
SELECT is_empty(format('SELECT 1 FROM public.cell_reports_view WHERE cell_id = %L', pg_temp.c(1)),
  'P4: não vê os relatórios da célula 01, embora o líder dela seja do seu ministério (achado 3)');
SELECT set_eq($$ SELECT id FROM public.members_view WHERE id::text LIKE 'c1080000%' $$,
  pg_temp.ms(7), 'P4: na members_view só o próprio cadastro');
RESET ROLE;

-- P4b: só view_all_reports (Breno) — 4 + 3
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P4b view_all_reports');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(2, 4), 'P4b: só as células em que é líder (04) ou timóteo (02)');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), 'P4b: todos os relatórios');
SELECT is((SELECT count(*)::int FROM public.cell_report_participants_view WHERE report_id::text LIKE 'e1080000%'),
  20, 'P4b: todas as participações');
RESET ROLE;

-- P5: sem permissão; líder da célula 02 e timóteo da 07 (Bento) — 4 + 3
SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('P5 sem permissão');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(2, 7), 'P5: a célula que lidera e a de que é timóteo');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(3, 8, 11), 'P5: os relatórios dessas duas células');
SELECT set_eq($$ SELECT id FROM public.members_view WHERE id::text LIKE 'c1080000%' $$,
  pg_temp.ms(10), 'P5: na members_view só o próprio cadastro');
RESET ROLE;

-- Usuário do Auth sem cadastro de membro — 4 + 3
SELECT pg_temp.login(8);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('Usuário sem cadastro de membro');
SELECT is_empty($$ SELECT 1 FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  'Sem cadastro: nenhuma célula');
SELECT is_empty($$ SELECT 1 FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  'Sem cadastro: nenhum relatório');
SELECT is_empty($$ SELECT 1 FROM public.cell_report_participants_view WHERE report_id::text LIKE 'e1080000%' $$,
  'Sem cadastro: nenhum participante');
RESET ROLE;

-- Pastor com view_own_ministry (Paulo; get_ministry_root nulo) — 4 + 2
SELECT pg_temp.login(9);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.parity('Pastor view_own_ministry');
SELECT set_eq($$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' $$,
  pg_temp.cs(6), 'Pastor: só a própria célula');
SELECT set_eq($$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' $$,
  pg_temp.rs(7, 9), 'Pastor: os relatórios da própria célula');
RESET ROLE;

-- ===========================================================================
-- 4. RN-06: nomes de referência fora do escopo
-- ===========================================================================

-- P3 (ministério A)
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT is((SELECT host_name FROM public.cells_view WHERE id = pg_temp.c(1)), 'Hélio Hospedeiro',
  'RN-06/P3: célula 01 mostra o nome do anfitrião de outro ministério');
SELECT is_empty(format('SELECT 1 FROM public.members_view WHERE id = %L', pg_temp.m(15)),
  'RN-06/P3: o anfitrião de outro ministério não aparece em Membros');
SELECT results_eq(
  format('SELECT leader_name, timothy_name, host_name, g12_leader_name FROM public.cells_view WHERE id = %L', pg_temp.c(2)),
  $$ VALUES ('Bento Barros'::text, 'Breno Batista'::text, 'Alberto Alves'::text, 'Bruno Brandão'::text) $$,
  'RN-06/P3: célula 02 (vista pelo anfitrião) mostra líder, timóteo e G12 do ministério B');
SELECT is_empty(format('SELECT 1 FROM public.members_view WHERE id IN (%L, %L, %L)', pg_temp.m(10), pg_temp.m(11), pg_temp.m(5)),
  'RN-06/P3: líder, timóteo e G12 da célula 02 não aparecem em Membros');
SELECT is((SELECT host_name FROM public.cells_view WHERE id = pg_temp.c(4)), 'Bia Bastos',
  'RN-06/P3: anfitriã inativa e de outro ministério aparece pelo nome');
RESET ROLE;

-- P4 (só a própria célula)
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT is((SELECT g12_leader_name FROM public.cells_view WHERE id = pg_temp.c(3)), 'André Gonçalves',
  'RN-06/P4: a célula mostra o nome do G12');
SELECT is_empty(format('SELECT 1 FROM public.members_view WHERE id = %L', pg_temp.m(3)),
  'RN-06/P4: o G12 não aparece em Membros');
SELECT is((SELECT cell_leader_name FROM public.cell_reports_view WHERE id = pg_temp.r(4)), 'Alberto Alves',
  'RN-06/P4: o relatório mostra o líder da célula');
RESET ROLE;

-- P4b (todos os relatórios, nenhum membro além de si)
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT is((SELECT cell_leader_name FROM public.cell_reports_view WHERE id = pg_temp.r(1)), 'Antônio Araújo',
  'RN-06/P4b: o relatório mostra o líder de uma célula que ele não vê');
SELECT is_empty(format('SELECT 1 FROM public.cells_view WHERE id = %L', pg_temp.c(1)),
  'RN-06/P4b: a célula 01 não está no seu escopo de células');
SELECT is_empty(format('SELECT 1 FROM public.members_view WHERE id IN (%L, %L, %L)', pg_temp.m(6), pg_temp.m(8), pg_temp.m(15)),
  'RN-06/P4b: o líder e os participantes do relatório 01 não aparecem em Membros');
SELECT results_eq(
  format('SELECT member_id, member_name FROM public.cell_report_participants_view WHERE report_id = %L ORDER BY member_name', pg_temp.r(1)),
  format($$ VALUES (%L::uuid, 'Antônio Araújo'::text), (%L::uuid, 'Arthur Assis'::text), (%L::uuid, 'Hélio Hospedeiro'::text) $$,
         pg_temp.m(6), pg_temp.m(8), pg_temp.m(15)),
  'RN-06/P4b: participantes do relatório 01 com o nome, em ordem alfabética');
SELECT results_eq(
  format('SELECT member_name FROM public.cell_report_participants_view WHERE report_id = %L ORDER BY member_name', pg_temp.r(5)),
  $$ VALUES ('Amanda Azevedo'::text), ('Bia Bastos'::text), ('Breno Batista'::text) $$,
  'RN-06/P4b: participante inativo aparece pelo nome');
RESET ROLE;

-- P5 (sem permissão)
SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format('SELECT timothy_name, host_name FROM public.cells_view WHERE id = %L', pg_temp.c(2)),
  $$ VALUES ('Breno Batista'::text, 'Alberto Alves'::text) $$,
  'RN-06/P5: a própria célula mostra timóteo e anfitrião');
SELECT is((SELECT leader_name FROM public.cells_view WHERE id = pg_temp.c(7)), 'Bia Bastos',
  'RN-06/P5: a célula em que é timóteo mostra a líder (inativa, fora do escopo)');
SELECT results_eq(
  format('SELECT member_name FROM public.cell_report_participants_view WHERE report_id = %L ORDER BY member_name', pg_temp.r(3)),
  $$ VALUES ('Alberto Alves'::text), ('Bento Barros'::text), ('Breno Batista'::text) $$,
  'RN-06/P5: participantes do relatório da própria célula com o nome');
SELECT is((SELECT count(*)::int FROM public.members_view WHERE id::text LIKE 'c1080000%'), 1,
  'RN-06/P5: nenhum desses nomes vira cadastro visível');
RESET ROLE;

-- ===========================================================================
-- 5. Colunas calculadas (como P1)
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;

-- G12 da célula
SELECT results_eq(
  format('SELECT g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(1)),
  format($$ VALUES (%L::uuid, 'André Gonçalves'::text, 2) $$, pg_temp.m(3)),
  'G12: líder abaixo do G12 → o G12 (André)');
SELECT results_eq(
  format('SELECT g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(9)),
  format($$ VALUES (%L::uuid, 'André Gonçalves'::text, 1) $$, pg_temp.m(3)),
  'G12: líder que é o próprio G12 → ele mesmo');
SELECT results_eq(
  format('SELECT g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(10)),
  format($$ VALUES (%L::uuid, 'Ana Gonçalves'::text, 2) $$, pg_temp.m(4)),
  'G12: líder abaixo da cônjuge do G12 → a cônjuge (Ana)');
SELECT results_eq(
  format('SELECT g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(4)),
  format($$ VALUES (%L::uuid, 'Bruno Brandão'::text, 2) $$, pg_temp.m(5)),
  'G12: célula do ministério B → Bruno');
SELECT results_eq(
  format('SELECT g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(6)),
  $$ VALUES (NULL::uuid, NULL::text, 0) $$,
  'G12: líder pastor → nulo, com leader_g12_level 0 (a tela mostra "Pastores")');
SELECT results_eq(
  format('SELECT g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(5)),
  $$ VALUES (NULL::uuid, NULL::text, 0) $$,
  'G12: líder sem líder (nível 0, não pastor) → nulo');
SELECT results_eq(
  format('SELECT leader_name, g12_leader_id, g12_leader_name, leader_g12_level FROM public.cells_view WHERE id = %L', pg_temp.c(8)),
  $$ VALUES (NULL::text, NULL::uuid, NULL::text, NULL::int) $$,
  'G12: célula sem líder → tudo nulo (a tela mostra "—")');

-- Nomes e gênero do líder
SELECT results_eq(
  format('SELECT leader_name, leader_gender, timothy_name, host_name FROM public.cells_view WHERE id = %L', pg_temp.c(1)),
  $$ VALUES ('Antônio Araújo'::text, 'M'::text, 'Arthur Assis'::text, 'Hélio Hospedeiro'::text) $$,
  'cells_view: nomes do líder, do timóteo e do anfitrião e o gênero do líder');
SELECT results_eq(
  format('SELECT leader_name, timothy_name, host_name FROM public.cells_view WHERE id = %L', pg_temp.c(3)),
  $$ VALUES ('Alberto Alves'::text, NULL::text, NULL::text) $$,
  'cells_view: célula sem timóteo e sem anfitrião');

-- Dia da semana
SELECT results_eq(
  format('SELECT meeting_day, meeting_weekday FROM public.cells_view WHERE id IN (%L, %L, %L, %L, %L) ORDER BY meeting_weekday NULLS LAST',
         pg_temp.c(5), pg_temp.c(1), pg_temp.c(10), pg_temp.c(4), pg_temp.c(7)),
  $$ VALUES ('Domingo'::text, 0), ('Segunda'::text, 1), ('Quarta'::text, 3), ('Sábado'::text, 6), ('Feriado'::text, NULL::int) $$,
  'meeting_weekday: Domingo = 0 … Sábado = 6; dia desconhecido → nulo');

-- Último relatório
SELECT is((SELECT last_report_date FROM public.cells_view WHERE id = pg_temp.c(1)), '2026-11-09'::date,
  'last_report_date: o mais recente dos relatórios da célula');
SELECT is((SELECT last_report_date FROM public.cells_view WHERE id = pg_temp.c(8)), NULL::date,
  'last_report_date: célula sem relatório → nulo');

-- Relatórios: semana, visitantes, participantes e dados da célula
SELECT results_eq(
  format('SELECT date, week_start FROM public.cell_reports_view WHERE id IN (%L, %L, %L, %L) ORDER BY date',
         pg_temp.r(1), pg_temp.r(3), pg_temp.r(11), pg_temp.r(5)),
  $$ VALUES ('2026-11-02'::date, '2026-11-01'::date), ('2026-11-10'::date, '2026-11-08'::date),
            ('2026-11-15'::date, '2026-11-15'::date), ('2026-11-21'::date, '2026-11-15'::date) $$,
  'week_start: domingo da semana (domingo é o próprio dia; sábado volta 6 dias)');
SELECT results_eq(
  format('SELECT visitors_count FROM public.cell_reports_view WHERE id IN (%L, %L, %L, %L) ORDER BY date',
         pg_temp.r(1), pg_temp.r(2), pg_temp.r(3), pg_temp.r(10)),
  $$ VALUES (2), (0), (0), (1) $$,
  'visitors_count: dois nomes = 2; NULL = 0; vazio = 0; um nome = 1');
SELECT results_eq(
  format('SELECT participants_count FROM public.cell_reports_view WHERE id IN (%L, %L, %L, %L) ORDER BY date',
         pg_temp.r(1), pg_temp.r(9), pg_temp.r(11), pg_temp.r(5)),
  $$ VALUES (3::bigint), (0::bigint), (1::bigint), (3::bigint) $$,
  'participants_count: 3; nenhum = 0; 1; 3 (inclui participante inativo)');
SELECT results_eq(
  format('SELECT id, participants_count FROM public.cell_reports_view WHERE id = ANY(%L::uuid[]) ORDER BY date',
         pg_temp.rs(2, 10)),
  format($$ VALUES (%L::uuid, 2::bigint), (%L::uuid, 2::bigint) $$, pg_temp.r(2), pg_temp.r(10)),
  'participants_count pela segunda consulta do hook (id = ANY(ids da página))');
SELECT results_eq(
  format($$ SELECT cell_type, cell_is_active, cell_leader_id, cell_leader_name, cell_timothy_id, cell_host_id,
                   cell_street, cell_number, cell_complement, cell_neighborhood, cell_meeting_day, cell_meeting_time
              FROM public.cell_reports_view WHERE id = %L $$, pg_temp.r(1)),
  format($$ VALUES ('Evangelística'::text, true, %L::uuid, 'Antônio Araújo'::text, %L::uuid, %L::uuid,
                    'Rua das Flores'::text, '100'::text, NULL::text, 'Centro'::text, 'Segunda'::text, '20:00'::time) $$,
         pg_temp.m(6), pg_temp.m(8), pg_temp.m(15)),
  'cell_reports_view: dados atuais da célula');
SELECT results_eq(
  format('SELECT was_held, theme, observations, reason_not_held FROM public.cell_reports_view WHERE id = %L', pg_temp.r(9)),
  $$ VALUES (false, NULL::text, 'Chuva forte'::text, NULL::text) $$,
  'cell_reports_view: relatório de célula que não houve');

-- Busca (RN-04): sem acento, minúscula, com os campos do spec.
SELECT is(
  (SELECT count(*)::int FROM public.cells_view
    WHERE id::text LIKE 'd1080000%' AND search_text IS DISTINCT FROM public.search_normalize(search_text)),
  0, 'cells_view.search_text: já normalizado (sem acento, minúsculo)');
SELECT is(
  (SELECT count(*)::int FROM public.cell_reports_view
    WHERE id::text LIKE 'e1080000%' AND search_text IS DISTINCT FROM public.search_normalize(search_text)),
  0, 'cell_reports_view.search_text: já normalizado (sem acento, minúsculo)');
SELECT set_eq(
  $$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%'
       AND search_text ILIKE '%joao%' AND search_text ILIKE '%silva%' $$,
  pg_temp.cs(9, 10),
  'busca de células "joao silva": acha João da Silva como anfitrião (09) e como líder (10)');
SELECT set_eq(
  $$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' AND search_text ILIKE '%goncalves%' $$,
  pg_temp.cs(1, 2, 3, 4, 6, 9, 10),
  'busca de células "Gonçalves": pelo líder (09), anfitrião (06), líder do líder (01, 03, 10), do timóteo (04) e do anfitrião (02)');
SELECT set_eq(
  $$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' AND search_text ILIKE '%arthur%' $$,
  pg_temp.cs(1),
  'busca de células: pelo nome do timóteo');
SELECT set_eq(
  $$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' AND search_text ILIKE '%flores%' $$,
  pg_temp.cs(1),
  'busca de células: pela rua');
SELECT set_eq(
  $$ SELECT id FROM public.cells_view WHERE id::text LIKE 'd1080000%' AND search_text ILIKE '%botanico%' $$,
  pg_temp.cs(9),
  'busca de células: pelo bairro, sem acento');
SELECT set_eq(
  $$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%'
       AND search_text ILIKE '%joao%' AND search_text ILIKE '%salvacao%' $$,
  pg_temp.rs(10),
  'busca de relatórios "joao salvacao": líder da célula e tema, sem acento');
SELECT set_eq(
  $$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' AND search_text ILIKE '%antonio%' $$,
  pg_temp.rs(1, 2),
  'busca de relatórios: pelo nome do líder da célula');
SELECT set_eq(
  $$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' AND search_text ILIKE '%graca%' $$,
  pg_temp.rs(4),
  'busca de relatórios: pelo tema, sem acento');
SELECT is_empty(
  $$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%'
       AND (search_text ILIKE '%visitante%' OR search_text ILIKE '%chuva%') $$,
  'busca de relatórios: visitantes e observações não são pesquisáveis (só líder e tema)');
RESET ROLE;

-- P3 vê a célula 02 (pelo anfitrião), mas nenhum relatório dela; a data do
-- último relatório considera relatórios fora do escopo (decisão do spec).
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT is((SELECT last_report_date FROM public.cells_view WHERE id = pg_temp.c(2)), '2026-11-15'::date,
  'last_report_date/P3: considera relatórios que P3 não vê');
SELECT is_empty(format('SELECT 1 FROM public.cell_reports_view WHERE cell_id = %L', pg_temp.c(2)),
  'last_report_date/P3: os relatórios da célula 02 não estão no escopo de P3');
SELECT is_empty(
  $$ SELECT id FROM public.cell_reports_view WHERE id::text LIKE 'e1080000%' AND search_text ILIKE '%bento%' $$,
  'busca/P3: buscar o líder de uma célula fora do escopo não revela relatórios');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
