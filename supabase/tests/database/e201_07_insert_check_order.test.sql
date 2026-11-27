-- E2.01 (PR 2): ordem das conferências no INSERT (migration 6).
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), "Triggers
-- (última barreira)", "Políticas de RLS", DT-10 e DT-27.
--
-- A permissão de inserir é a primeira conferência no INSERT:
--   - members: regra 1 de enforce_member_write_rules (aa_);
--   - cells: trigger a0_check_insert_permission, com a mesma função da política de INSERT;
--   - cell_reports e cell_report_participants (E2.11 PR 2): sem INSERT para a API; a permissão é a
--     primeira conferência dentro de submit_cell_report e save_cell_report;
--   - anon: sem INSERT, UPDATE, DELETE e TRUNCATE nas quatro tabelas.
--
-- Cobre, com registros excluídos na massa:
--   - sem a permissão, 42501 (ordem das conferências), também nos casos das
--     RN-06, RN-07, RN-11, RN-18 e da semana de cell_reports;
--   - submit_own_cell_report: a célula de outra pessoa dá 42501; a própria,
--     a recusa de regra;
--   - participantes: a função repete o efeito do RLS que a política antiga
--     tinha (matriz pessoa × relatório comparada com a expressão antiga, sob o
--     RLS de quem grava);
--   - anon: 42501 de privilégio nas quatro tabelas;
--   - regressão: com a permissão, as recusas de regra continuam iguais, e os
--     INSERTs válidos funcionam (também como service_role, que continua
--     passando pelos triggers de regra, DT-27);
--   - UPDATE e DELETE: o USING filtra antes dos triggers (0 linhas, sem regra);
--   - catálogo: política e trigger usam a mesma função; a0_ é o primeiro BEFORE;
--     grants das funções novas.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Datas relativas à semana atual (domingo a sábado, America/Sao_Paulo).
-- Rodar com: supabase test db

BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(87);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2010700-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b2010700-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010700-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010700-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010700-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Roda _sql como _role ('authenticated' com o usuário _n, 'anon' ou
-- 'service_role') e devolve state, rows, message e code (o código de regra do
-- app_error, ou o SQLSTATE), sem deixar a role trocada.
CREATE FUNCTION pg_temp.try(_role text, _n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  _state text; _msg text; _detail text; _hint text; _rows bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', _role)::text END,
      true);
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('state', '00000', 'rows', _rows, 'code', '00000');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg,
      'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                   THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
-- Atalhos: código como o usuário _n (authenticated), como anon e como service_role.
CREATE FUNCTION pg_temp.code(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.try('authenticated', _n, _sql) ->> 'code' $$;

-- INSERTs usados várias vezes.
CREATE FUNCTION pg_temp.ins_member(_name text, _email text DEFAULT NULL, _leader uuid DEFAULT NULL,
                                   _spouse uuid DEFAULT NULL, _auth uuid DEFAULT NULL) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT format('INSERT INTO public.members (name, gender, email, leader_id, has_leadership, spouse_id, auth_user_id)
                 VALUES (%L, %L, %L, %L, %L, %L, %L)',
                _name, 'M', _email, _leader, _leader IS NOT NULL, _spouse, _auth)
$$;
CREATE FUNCTION pg_temp.ins_cell(_leader uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format('INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
                 VALUES (%L, %L, %L, %L, %L, %L)', _leader, _leader, _leader, 'Evangelística', 'Quarta', '20:00')
$$;
CREATE FUNCTION pg_temp.ins_report(_cell uuid, _date date DEFAULT NULL) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('INSERT INTO public.cell_reports (cell_id, date, time, theme, was_held)
                 VALUES (%L, %L, %L, %L, true)', _cell, coalesce(_date, public.sp_today()), '20:00', 'Tema E201-07')
$$;
-- E2.11: o lançamento e a edição pelas RPCs (a data do relatório é hoje, às 00:00, depois da reunião).
CREATE FUNCTION pg_temp.sub_report(_cell uuid, _date date DEFAULT NULL) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT format('SELECT * FROM public.submit_cell_report(gen_random_uuid(), %L::jsonb)',
                jsonb_build_object('cell_id', _cell, 'date', coalesce(_date, public.sp_today()), 'time', '00:00',
                                   'theme', 'Tema E201-07', 'offering', 0))
$$;
CREATE FUNCTION pg_temp.save_parts(_report uuid, _ids uuid[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format('SELECT * FROM public.save_cell_report(%L, %L::jsonb, %L::uuid[])', _report, '{}', _ids)
$$;
CREATE FUNCTION pg_temp.ins_part(_report uuid, _member uuid) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT format('INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (%L, %L)', _report, _member)
$$;

-- ---------------------------------------------------------------------------
-- Massa (postgres, triggers ligados)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password)
SELECT pg_temp.u(n), 'e201-07-' || n || '@teste.invalid', extensions.crypt('Senha#' || n, extensions.gen_salt('bf', 4))
  FROM generate_series(1, 10) n;
-- Pessoas (usuário n → função n):
--   1 Alice (todas as permissões)
--   2 Nilo (só view_members: não cadastra, não lança)
--   3 Clara (create_member)       4 Caio (create_cell)
--   5 Yara (submit_own_cell_report, líder de c1 e c2 e c6)
--   6 Lucas (edit_cell)           7 Edu (edit_own_data, timóteo de c7)
--   8 Sofia (submit_any_visible_report)
--  10 conta do membro excluído Xavier (sem função)
INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'E201-07 AD'), (pg_temp.role(2), 'E201-07 NP'), (pg_temp.role(3), 'E201-07 CM'),
  (pg_temp.role(4), 'E201-07 CC'), (pg_temp.role(5), 'E201-07 YL'), (pg_temp.role(6), 'E201-07 LE'),
  (pg_temp.role(7), 'E201-07 ED'), (pg_temp.role(8), 'E201-07 SA');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(2), 'view_all_church'),
  (pg_temp.role(3), 'view_all_church'), (pg_temp.role(3), 'create_member'),
  -- E2.02 (RN-19): cobre a função padrão (Membro) para cadastrar sem escolher função
  (pg_temp.role(3), 'view_dashboard'), (pg_temp.role(3), 'view_own_ministry'), (pg_temp.role(3), 'edit_own_data'),
  (pg_temp.role(3), 'submit_own_cell_report'),
  (pg_temp.role(4), 'view_all_church'), (pg_temp.role(4), 'create_cell'),
  (pg_temp.role(5), 'submit_own_cell_report'), (pg_temp.role(5), 'view_own_reports'),
  (pg_temp.role(6), 'view_all_church'), (pg_temp.role(6), 'edit_cell'), (pg_temp.role(6), 'edit_cell_report'),
  (pg_temp.role(7), 'edit_own_data'),
  (pg_temp.role(8), 'view_all_church'), (pg_temp.role(8), 'submit_any_visible_report');

-- E2.04 (DT-23): todo cadastro novo tem um identificador real (RN-08).
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192017' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Paulo Pastor E201-07', 'M', true, false, pg_temp.mob(1));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(21), 'Alice Admin',     'F', pg_temp.m(1), true, NULL, pg_temp.u(1), pg_temp.role(1), pg_temp.mob(21)),
  (pg_temp.m(22), 'Nilo Nada',       'M', pg_temp.m(1), true, NULL, pg_temp.u(2), pg_temp.role(2), pg_temp.mob(22)),
  (pg_temp.m(23), 'Clara Cadastro',  'F', pg_temp.m(1), true, NULL, pg_temp.u(3), pg_temp.role(3), pg_temp.mob(23)),
  (pg_temp.m(24), 'Caio Celulas',    'M', pg_temp.m(1), true, NULL, pg_temp.u(4), pg_temp.role(4), pg_temp.mob(24)),
  (pg_temp.m(25), 'Yara Lider',      'F', pg_temp.m(1), true, NULL, pg_temp.u(5), pg_temp.role(5), pg_temp.mob(25)),
  (pg_temp.m(26), 'Lucas Edita',     'M', pg_temp.m(1), true, NULL, pg_temp.u(6), pg_temp.role(6), pg_temp.mob(26)),
  (pg_temp.m(27), 'Edu Proprio',     'M', pg_temp.m(1), true, NULL, pg_temp.u(7), pg_temp.role(7), pg_temp.mob(27)),
  (pg_temp.m(28), 'Sofia Envia',     'F', pg_temp.m(1), true, NULL, pg_temp.u(8), pg_temp.role(8), pg_temp.mob(28)),
  (pg_temp.m(31), 'Otavio Outro',    'M', pg_temp.m(1), true, NULL, NULL, NULL, pg_temp.mob(31)),
  (pg_temp.m(40), 'Pia Participa',   'F', pg_temp.m(1), true, NULL, NULL, NULL, pg_temp.mob(40)),
  (pg_temp.m(41), 'Rui Participa',   'M', pg_temp.m(1), true, NULL, NULL, NULL, pg_temp.mob(41)),
  -- excluídos (marcados abaixo): Xavier tem conta; Zilda e Wagner não
  (pg_temp.m(10), 'Xavier Excluido', 'M', pg_temp.m(1), true, 'xavier.e20107@teste.invalid', pg_temp.u(10), NULL, pg_temp.mob(10)),
  (pg_temp.m(11), 'Zilda Excluida',  'F', pg_temp.m(1), true, NULL, NULL, NULL, pg_temp.mob(11)),
  (pg_temp.m(12), 'Wagner Excluido', 'M', pg_temp.m(1), true, NULL, NULL, NULL, pg_temp.mob(12));

-- c1 e c2 e c6: de Yara; c3, c4, c5 e c8: de Otávio; c7: de Otávio com Edu de timóteo.
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1), pg_temp.m(25), pg_temp.m(25), pg_temp.m(25), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(2), pg_temp.m(25), pg_temp.m(25), pg_temp.m(25), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(3), pg_temp.m(31), pg_temp.m(31), pg_temp.m(31), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(4), pg_temp.m(31), pg_temp.m(31), pg_temp.m(31), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(5), pg_temp.m(31), pg_temp.m(31), pg_temp.m(31), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(6), pg_temp.m(25), pg_temp.m(25), pg_temp.m(25), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(7), pg_temp.m(31), pg_temp.m(27), pg_temp.m(31), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(8), pg_temp.m(31), pg_temp.m(31), pg_temp.m(31), 'Evangelística', 'Quarta', '20:00');
-- E2.11: a reunião desta semana é hoje às 00:00 (o lançamento só é aceito depois dela, RN-06).
UPDATE public.cells SET meeting_day = (public.cell_weekdays())[EXTRACT(dow FROM public.sp_today())::int + 1],
                        meeting_time = '00:00'
 WHERE id IN (SELECT pg_temp.c(k) FROM generate_series(1, 8) k);

-- Relatórios da semana atual (antes das exclusões).
--   r1: c4, excluído              r2: c3 (célula excluída)
--   r3: c2 (Yara)                 r4: c1 (Yara, célula excluída)
--   r5: c2 (Yara), excluído       r6: c5 (semana ocupada)
--   r7: c4                        r8: c7 (Edu é timóteo)
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
  (pg_temp.r(2), pg_temp.c(3), public.sp_today(), '20:00', 'Célula excluída', true),
  (pg_temp.r(3), pg_temp.c(2), public.sp_today(), '20:00', 'Yara', true),
  (pg_temp.r(4), pg_temp.c(1), public.sp_today(), '20:00', 'Yara, célula excluída', true),
  (pg_temp.r(6), pg_temp.c(5), public.sp_today(), '20:00', 'Semana ocupada', true),
  (pg_temp.r(7), pg_temp.c(4), public.sp_today(), '20:00', 'Otávio', true),
  (pg_temp.r(8), pg_temp.c(7), public.sp_today(), '20:00', 'Edu', true);
-- Relatórios já excluídos convivem com um não excluído na semana (índice parcial).
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, deleted_at) VALUES
  (pg_temp.r(1), pg_temp.c(4), public.sp_today(), '20:00', 'Excluído', true, now()),
  (pg_temp.r(5), pg_temp.c(2), public.sp_today(), '20:00', 'Yara, excluído', true, now());
-- Wagner participou de r7 antes de ser excluído.
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  (pg_temp.r(7), pg_temp.m(12)), (pg_temp.r(7), pg_temp.m(40));

-- E2.11: a oferta não tem mais padrão e é obrigatória na edição da célula realizada (RN-13).
UPDATE public.cell_reports SET offering = 0 WHERE offering IS NULL;

UPDATE public.members SET deleted_at = now() WHERE id IN (pg_temp.m(10), pg_temp.m(11), pg_temp.m(12));
UPDATE public.cells SET deleted_at = now() WHERE id IN (pg_temp.c(1), pg_temp.c(3));

-- ===========================================================================
-- 1. Catálogo: a mesma função na política e no trigger — 19 verificações
-- ===========================================================================
-- cells continua com a política e o trigger; relatórios e participantes ficaram sem INSERT para a API
-- (E2.11 PR 2, RN-01): sem política de INSERT, sem o a0_check_insert_permission e sem as funções dele.
SELECT is(
  (SELECT with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = 'cells' AND cmd = 'INSERT'),
  '(viewer_can_insert_cell() AND (deleted_at IS NULL) AND (deleted_by IS NULL))',
  'cells: a política de INSERT usa a função de permissão');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND cmd <> 'SELECT'),
          t || ': sem política de escrita (E2.11: só as RPCs gravam)')
  FROM unnest(ARRAY['cell_reports', 'cell_report_participants']) t;

SELECT ok(pg_get_functiondef('public.enforce_insert_permission()'::regprocedure) LIKE '%public.viewer_can_insert_cell()%',
          'enforce_insert_permission chama public.viewer_can_insert_cell() (a mesma função da política)');
SELECT ok(pg_get_functiondef('public.enforce_insert_permission()'::regprocedure) NOT LIKE '%' || f || '%',
          'enforce_insert_permission não tem mais o ramo de ' || f || ' (E2.11)')
  FROM unnest(ARRAY['viewer_can_insert_cell_report(', 'viewer_can_insert_cell_report_participant(']) f;

SELECT is(
  (SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
    WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'a0_check_insert_permission'),
  'CREATE TRIGGER a0_check_insert_permission BEFORE INSERT ON public.cells FOR EACH ROW EXECUTE FUNCTION enforce_insert_permission()',
  'cells: trigger a0_check_insert_permission, BEFORE INSERT, por linha');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = ('public.' || tb)::regclass
                        AND t.tgname = 'a0_check_insert_permission'),
          tb || ': sem a0_check_insert_permission (E2.11: sem INSERT para a API)')
  FROM unnest(ARRAY['cell_reports', 'cell_report_participants']) tb;

-- A ordem dos triggers BEFORE da mesma linha é alfabética.
SELECT is(
  (SELECT min(t.tgname COLLATE "C")::text FROM pg_trigger t
    WHERE t.tgrelid = ('public.' || tb)::regclass AND NOT t.tgisinternal
      AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1 AND (t.tgtype & 4) = 4),
  f, tb || ': ' || f || ' é o primeiro BEFORE INSERT')
  FROM (VALUES ('cells', 'a0_check_insert_permission'), ('cell_reports', 'a0_guard_cell_report_write'),
               ('cell_report_participants', 'a0_guard_cell_report_write'),
               -- E2.04 (DT-04): a0_normalize_member vem antes de todos, mas só normaliza e nunca recusa.
               ('members', 'a0_normalize_member')) v(tb, f);
SELECT is(
  (SELECT min(t.tgname COLLATE "C")::text FROM pg_trigger t
    WHERE t.tgrelid = 'public.members'::regclass AND NOT t.tgisinternal
      AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1 AND (t.tgtype & 4) = 4
      AND t.tgname <> 'a0_normalize_member'),
  'aa_enforce_member_write_rules',
  'members: aa_enforce_member_write_rules é o primeiro BEFORE INSERT que recusa (depois do a0_ do E2.04)');

SELECT ok(NOT p.prosecdef AND p.proconfig = ARRAY['search_path=public'],
  'enforce_insert_permission: INVOKER (enxerga quem grava), search_path fixo')
  FROM pg_proc p WHERE p.oid = 'public.enforce_insert_permission()'::regprocedure;
SELECT ok(p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public']
          AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0),
          p.oid::regprocedure::text || ': STABLE, definer, search_path fixo; EXECUTE só para authenticated (sem anon e PUBLIC)')
  FROM pg_proc p
 WHERE p.oid = 'public.viewer_can_insert_cell()'::regprocedure;
SELECT ok(to_regprocedure(f) IS NULL, f || ': removida no E2.11 (sem escrita direta)')
  FROM unnest(ARRAY['public.viewer_can_insert_cell_report(uuid)',
                    'public.viewer_can_insert_cell_report_participant(uuid)']) f;
SELECT ok(NOT has_function_privilege('authenticated', f, 'EXECUTE')
          AND NOT has_function_privilege('anon', f, 'EXECUTE')
          AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                           WHERE p.oid = f::regprocedure AND a.grantee = 0),
          f || ': função de trigger sem EXECUTE para PUBLIC, anon e authenticated')
  FROM unnest(ARRAY['public.enforce_insert_permission()', 'public.enforce_member_write_rules()']) f;

-- ===========================================================================
-- 2. anon: privilégio — 8 verificações
-- ===========================================================================
SELECT ok(NOT has_table_privilege('anon', 'public.' || t, 'INSERT, UPDATE, DELETE, TRUNCATE'),
          'anon: sem INSERT, UPDATE, DELETE e TRUNCATE em ' || t)
  FROM unnest(ARRAY['members', 'cells', 'cell_reports', 'cell_report_participants']) t;

SELECT ok(r ->> 'state' = '42501' AND r ->> 'message' LIKE 'permission denied for table%',
          'anon: INSERT em ' || t || ' → 42501 de privilégio, antes dos triggers')
  FROM (VALUES
    ('members',                  pg_temp.try('anon', NULL, pg_temp.ins_member('Anon', 'xavier.e20107@teste.invalid'))),
    ('cells',                    pg_temp.try('anon', NULL, pg_temp.ins_cell(pg_temp.m(11)))),
    ('cell_reports',             pg_temp.try('anon', NULL, pg_temp.ins_report(pg_temp.c(3)))),
    ('cell_report_participants', pg_temp.try('anon', NULL, pg_temp.ins_part(pg_temp.r(1), pg_temp.m(11))))) v(t, r);

-- ===========================================================================
-- 3. members — 13 verificações
-- ===========================================================================
-- Sem create_member: 42501 antes de qualquer regra.
SELECT is(pg_temp.code(2, pg_temp.ins_member('Nova Pessoa', 'xavier.e20107@teste.invalid')), '42501',
  'sem create_member: caso da RN-18 → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.ins_member('Nova Pessoa', 'XAVIER.E20107@teste.invalid')), '42501',
  'sem create_member: caso da RN-18, e-mail em maiúsculas → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.ins_member('Nova Pessoa', NULL, pg_temp.m(11))), '42501',
  'sem create_member: caso da RN-06 (líder) → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.ins_member('Nova Pessoa', NULL, NULL, pg_temp.m(11))), '42501',
  'sem create_member: caso da RN-06 (cônjuge) → 42501 (ordem das conferências)');
SELECT is(pg_temp.try('authenticated', 2, pg_temp.ins_member('Nova Pessoa', NULL, NULL, NULL, pg_temp.u(2))) ->> 'message',
  'Você não tem permissão para esta ação.',
  'sem create_member: a regra 1 vem antes da regra 2 (conta de acesso)');
SELECT is(pg_temp.code(10, pg_temp.ins_member('Nova Pessoa')), '42501',
  'membro excluído (Xavier, com conta): INSERT → 42501 (sem permissão nenhuma, RN-14)');

-- Com create_member: as recusas de regra continuam iguais.
SELECT is(pg_temp.code(3, pg_temp.ins_member('Nova Pessoa', 'xavier.e20107@teste.invalid')), 'deleted_account_email',
  'create_member: e-mail da conta de um excluído → deleted_account_email (RN-18)');
SELECT is(pg_temp.code(3, pg_temp.ins_member('Nova Pessoa', NULL, pg_temp.m(11))), 'deleted_member_chosen',
  'create_member: líder excluído → deleted_member_chosen (RN-06)');
SELECT is(pg_temp.code(3, pg_temp.ins_member('Nova Pessoa', NULL, NULL, pg_temp.m(11))), 'deleted_member_chosen',
  'create_member: cônjuge excluído → deleted_member_chosen (RN-06)');
SELECT is(pg_temp.try('authenticated', 3, pg_temp.ins_member('Nova Pessoa', NULL, NULL, NULL, pg_temp.u(3))) ->> 'message',
  'Não é permitido vincular o próprio acesso a outro cadastro.',
  'create_member: a regra 2 (conta de acesso) continua igual');
SELECT is(pg_temp.try('authenticated', 3, pg_temp.ins_member('Nina Nova E201-07', 'nina.e20107@teste.invalid', pg_temp.m(1))),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'create_member: cadastro válido funciona');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.ins_member('Sergio Service E201-07', 'sergio.e20107@teste.invalid', pg_temp.m(1))),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'service_role: cadastro válido funciona');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.ins_member('Sergio Service E201-07', NULL, pg_temp.m(11))) ->> 'code',
  'deleted_member_chosen',
  'service_role: líder excluído continua recusado (DT-27)');

-- ===========================================================================
-- 4. cells — 5 verificações
-- ===========================================================================
SELECT is(pg_temp.code(2, pg_temp.ins_cell(pg_temp.m(11))), '42501',
  'sem create_cell: caso da RN-06 (líder) → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(10, pg_temp.ins_cell(pg_temp.m(11))), '42501',
  'membro excluído: INSERT de célula → 42501');
SELECT is(pg_temp.code(4, pg_temp.ins_cell(pg_temp.m(11))), 'deleted_member_chosen',
  'create_cell: líder excluído → deleted_member_chosen (RN-06)');
SELECT is(pg_temp.try('authenticated', 4, pg_temp.ins_cell(pg_temp.m(31))),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'create_cell: célula válida funciona');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.ins_cell(pg_temp.m(31))),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'service_role: célula válida funciona');

-- ===========================================================================
-- 5. cell_reports — 16 verificações
-- ===========================================================================
-- E2.11: o lançamento é só pela submit_cell_report; a permissão é o primeiro passo (RN-20 item 1, DA-8).
-- Sem permissão de lançar (Nilo): 42501 antes das recusas de célula e de semana.
SELECT is(pg_temp.code(2, pg_temp.sub_report(pg_temp.c(3))), '42501',
  'sem permissão de lançar: caso da RN-06 (célula) → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.sub_report(pg_temp.c(5))), '42501',
  'sem permissão de lançar: caso da semana única → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.sub_report(pg_temp.c(4), public.sp_today() - 14)), '42501',
  'sem permissão de lançar: caso da semana atual → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(7, pg_temp.sub_report(pg_temp.c(3))), '42501',
  'edit_own_data sem ser líder ou timóteo: caso da RN-06 (célula de outra pessoa) → 42501');

-- submit_own_cell_report (Yara).
SELECT is(pg_temp.code(5, pg_temp.sub_report(pg_temp.c(3))), 'not_found_or_deleted',
  'submit_own_cell_report: célula excluída de outra pessoa, que ela não vê → not_found_or_deleted (DA-7 do E2.11)');
SELECT is(pg_temp.code(5, pg_temp.sub_report(pg_temp.c(1))), 'cell_deleted',
  'submit_own_cell_report: a própria célula excluída → cell_deleted (quem tem direito recebe a regra)');
SELECT is(pg_temp.code(5, pg_temp.sub_report(pg_temp.c(4))), 'not_found_or_deleted',
  'submit_own_cell_report: célula invisível de outra pessoa, caso da semana única → not_found_or_deleted (E2.02, RN-13; a permissão vem antes, as recusas de escopo depois)');
SELECT is(pg_temp.try('authenticated', 5, pg_temp.sub_report(pg_temp.c(6))),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'submit_own_cell_report: relatório válido da própria célula funciona');

-- Com permissão em qualquer célula: as recusas de regra (agora da RPC).
SELECT is(pg_temp.code(6, pg_temp.sub_report(pg_temp.c(3))), 'cell_deleted',
  'edit_cell: célula excluída → cell_deleted (RN-06)');
SELECT is(pg_temp.code(8, pg_temp.sub_report(pg_temp.c(3))), 'cell_deleted',
  'submit_any_visible_report: célula excluída → cell_deleted');
SELECT is(pg_temp.code(6, pg_temp.sub_report(pg_temp.c(5))), 'report_week_taken',
  'edit_cell: semana já ocupada → report_week_taken (E2.11, RN-07)');
SELECT is(pg_temp.code(6, pg_temp.sub_report(pg_temp.c(4), public.sp_today() - 14)), 'report_not_current_week',
  'edit_cell: data de outra semana → report_not_current_week (E2.11, RN-04)');
SELECT is(pg_temp.code(7, pg_temp.sub_report(pg_temp.c(7), public.sp_today() - 14)), '42501',
  'edit_own_data como timóteo: não dá mais direito de lançar → 42501 (E2.02, RN-13)');
SELECT is(pg_temp.try('authenticated', 6, pg_temp.sub_report(pg_temp.c(8))),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'edit_cell: relatório válido funciona');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.sub_report(pg_temp.c(3))) ->> 'code', 'cell_deleted',
  'service_role: célula excluída continua recusada (DT-27)');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.sub_report(pg_temp.c(1), public.sp_today() - 14)) ->> 'code', 'cell_deleted',
  'service_role: chega à regra da célula (cell_deleted antes da semana)');

-- ===========================================================================
-- 6. cell_report_participants — 17 verificações
-- ===========================================================================
-- E2.11: incluir e retirar participantes depois do envio é edição (save_cell_report, RN-03); a DA-5 do
-- E2.02 terminou.
-- Sem permissão (Nilo).
SELECT is(pg_temp.code(2, pg_temp.save_parts(pg_temp.r(1), ARRAY[pg_temp.m(40)])), '42501',
  'sem permissão: caso da RN-07 (relatório) → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.save_parts(pg_temp.r(2), ARRAY[pg_temp.m(40)])), '42501',
  'sem permissão: caso da RN-11 (relatório) → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.save_parts(pg_temp.r(7), ARRAY[pg_temp.m(12), pg_temp.m(40), pg_temp.m(11)])), '42501',
  'sem permissão: caso da RN-06 (participante) → 42501 (ordem das conferências)');
SELECT is(pg_temp.code(2, pg_temp.ins_part(pg_temp.r(7), pg_temp.m(40)) || ' ON CONFLICT DO NOTHING'), '42501',
  'sem permissão: INSERT direto, par que já existe, com ON CONFLICT DO NOTHING → 42501 de privilégio');

-- Yara (só submit_own_cell_report): quem só lança não edita (RN-03 do E2.11).
SELECT is(pg_temp.code(5, pg_temp.save_parts(pg_temp.r(4), ARRAY[pg_temp.m(40)])), '42501',
  'submit_own_cell_report: relatório da própria célula excluída → 42501 (não edita)');
SELECT is(pg_temp.code(5, pg_temp.save_parts(pg_temp.r(5), ARRAY[pg_temp.m(40)])), '42501',
  'submit_own_cell_report: relatório excluído da própria célula → 42501 (não edita)');
SELECT is(pg_temp.code(5, pg_temp.save_parts(pg_temp.r(7), ARRAY[pg_temp.m(40)])), '42501',
  'submit_own_cell_report: relatório de célula de outra pessoa → 42501');
SELECT is(pg_temp.code(5, pg_temp.save_parts(pg_temp.r(3), ARRAY[pg_temp.m(25)])), '42501',
  'submit_own_cell_report: incluir participante no próprio relatório depois do envio → 42501 (fim da DA-5)');
SELECT is(pg_temp.code(5, pg_temp.ins_part(pg_temp.r(3), pg_temp.m(25))), '42501',
  'submit_own_cell_report: o INSERT direto também → 42501 de privilégio');

-- Com Editar Relatórios de Células (Lucas): as recusas de regra continuam iguais.
SELECT is(pg_temp.code(6, pg_temp.save_parts(pg_temp.r(1), ARRAY[pg_temp.m(41)])), 'not_found_or_deleted',
  'edit_cell_report: relatório excluído → not_found_or_deleted (RN-07)');
SELECT is(pg_temp.code(6, pg_temp.save_parts(pg_temp.r(2), ARRAY[pg_temp.m(41)])), 'report_cell_deleted',
  'edit_cell_report: relatório de célula excluída → report_cell_deleted (RN-11)');
SELECT is(pg_temp.code(6, pg_temp.save_parts(pg_temp.r(7), ARRAY[pg_temp.m(12), pg_temp.m(40), pg_temp.m(11)])),
  'deleted_member_chosen', 'edit_cell_report: membro excluído → deleted_member_chosen (RN-06)');
SELECT is(pg_temp.try('authenticated', 6, pg_temp.save_parts(pg_temp.r(7), ARRAY[pg_temp.m(12), pg_temp.m(40), pg_temp.m(41)])),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'edit_cell_report: participante válido funciona');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.save_parts(pg_temp.r(8), ARRAY[pg_temp.m(41)])),
  '{"state": "00000", "rows": 1, "code": "00000"}'::jsonb,
  'service_role: participante válido funciona');
SELECT is(pg_temp.try('service_role', NULL, pg_temp.save_parts(pg_temp.r(1), ARRAY[pg_temp.m(41)])) ->> 'code',
  'not_found_or_deleted', 'service_role: relatório excluído continua recusado (DT-27)');

-- As funções da escrita direta saíram (E2.11 PR 2); a de células continua igual à regra do E2.02.
SELECT ok(to_regprocedure('public.set_cell_report_participants(uuid,uuid[])') IS NULL,
  'participantes: set_cell_report_participants removida (absorvida pela save_cell_report, E2.11)');
CREATE FUNCTION pg_temp.cell_mismatches() RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  _n int; _out text[] := '{}';
BEGIN
  FOREACH _n IN ARRAY ARRAY[1, 2, 3, 4, 5, 6, 7, 8, 10] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF public.viewer_can_insert_cell() IS DISTINCT FROM public.viewer_has('create_cell') THEN
      _out := _out || format('usuário %s: células', _n);
    END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;
  RETURN _out;
END $$;
SELECT is(pg_temp.cell_mismatches(), '{}'::text[],
  'células: viewer_can_insert_cell = regra do E2.02 (9 pessoas)');

-- ===========================================================================
-- 7. UPDATE e DELETE: o USING filtra antes dos triggers — 6 verificações
-- ===========================================================================
-- Relatórios e participantes (E2.11): sem UPDATE e DELETE para a API, 42501 de privilégio antes de tudo.
SELECT is(pg_temp.code(2, format('UPDATE public.cell_reports SET theme = %L WHERE id = %L', 'x', pg_temp.r(2))),
  '42501', 'sem edit_cell_report: PATCH direto no caso da RN-11 → 42501 de privilégio (E2.11)');
SELECT is(pg_temp.try('authenticated', 2, format('UPDATE public.cells SET leader_id = %L WHERE id = %L', pg_temp.m(11), pg_temp.c(4))),
  '{"state": "00000", "rows": 0, "code": "00000"}'::jsonb,
  'sem edit_cell: PATCH no caso da RN-06 (líder) volta com 0 linhas e sem erro');
SELECT is(pg_temp.try('authenticated', 2, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(11), pg_temp.m(40))),
  '{"state": "00000", "rows": 0, "code": "00000"}'::jsonb,
  'sem edit_member: PATCH de outra pessoa no caso da RN-06 (líder) volta com 0 linhas e sem erro');
SELECT is(pg_temp.code(2, format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
                                 pg_temp.r(7), pg_temp.m(12))),
  '42501', 'sem permissão: DELETE direto no caso da RN-13 → 42501 de privilégio (E2.11)');
-- Com a permissão, a regra continua (pela RPC).
SELECT is(pg_temp.code(6, pg_temp.save_parts(pg_temp.r(7), ARRAY[pg_temp.m(40), pg_temp.m(41)])),
  'deleted_participant_removal', 'edit_cell_report: retirar um participante excluído → deleted_participant_removal (RN-13)');
SELECT is(pg_temp.code(1, format('SELECT * FROM public.save_cell_report(%L, %L::jsonb)', pg_temp.r(2), '{"theme": "x"}')),
  'report_cell_deleted', 'edit_cell_report: editar o relatório de célula excluída → report_cell_deleted (RN-11)');

-- ===========================================================================
-- 8. Nada gravado pelas recusas — 2 verificações
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.members WHERE name = 'Nova Pessoa'), 0,
  'nenhum cadastro "Nova Pessoa" foi gravado pelas tentativas recusadas');
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE theme = 'Tema E201-07'), 2,
  'só os dois relatórios válidos foram gravados (Yara e Lucas)');

SELECT * FROM finish();
ROLLBACK;
