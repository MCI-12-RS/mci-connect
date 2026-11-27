-- E2.01 (PR 2): fim da exclusão física pela API (migration 5).
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), RN-01,
-- RN-13, DT-02, "Integridade garantida pelo banco", "Verificações
-- obrigatórias" (depois da migration 5) e tarefa 6.
--
-- Cobre:
--   - privilégios: members, cells e cell_reports sem DELETE e sem TRUNCATE
--     para authenticated, anon e PUBLIC; cell_report_participants com DELETE
--     para authenticated (RN-13) e sem TRUNCATE; a service_role mantém DELETE e
--     TRUNCATE em members e cells, só DELETE em cell_reports e nenhum dos dois em
--     participantes (E2.11 PR 2);
--   - políticas: nenhuma de DELETE (ou ALL) em members, cells e cell_reports; a
--     de participantes continua;
--   - comportamento: DELETE e TRUNCATE nas três tabelas dão 42501 para o
--     administrador (todas as permissões) e para anon; TRUNCATE de
--     participantes dá 42501; nada é apagado;
--   - o que continua: a retirada de um participante não excluído pela política
--     de DELETE; a recusa da retirada de um participante excluído (trigger); a
--     exclusão lógica pelas RPCs.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(41);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2010600-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b2010600-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010600-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010600-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010600-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Roda _sql como _role ('authenticated' com o usuário _n, 'anon' ou
-- 'service_role') e devolve o resultado: state, rows, message e o código de
-- regra (app_error), sem deixar a role trocada.
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
    RETURN jsonb_build_object('state', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg,
      'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                   THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;

-- Contagens da massa e do banco inteiro (como postgres).
CREATE FUNCTION pg_temp.counts() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.members), (SELECT count(*) FROM public.cells),
    (SELECT count(*) FROM public.cell_reports), (SELECT count(*) FROM public.cell_report_participants),
    (SELECT count(*) FROM public.members WHERE deleted_at IS NOT NULL))
$$;

-- ---------------------------------------------------------------------------
-- Massa (postgres, triggers ligados)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, encrypted_password)
SELECT pg_temp.u(n), 'e201-06-' || n || '@teste.invalid', extensions.crypt('Senha#' || n, extensions.gen_salt('bf', 4))
  FROM generate_series(1, 2) n;
-- 1 Ana (todas as permissões), 2 Lino (edit_cell: retira participantes).
INSERT INTO public.roles (id, name) VALUES
  (pg_temp.role(1), 'E201-06 AD'), (pg_temp.role(2), 'E201-06 LE');
INSERT INTO public.role_permissions (role_id, permission)
SELECT pg_temp.role(1), p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(2), 'view_all_church'), (pg_temp.role(2), 'edit_cell'),
  (pg_temp.role(2), 'edit_cell_report');  -- E2.02 (DA-5): retirar participante exige edit_cell_report

-- E2.04 (DT-23): todo cadastro novo tem um identificador real (RN-08).
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192016' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Pedro Pastor E201-06', 'M', true, false, pg_temp.mob(1));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, mobile_whatsapp) VALUES
  (pg_temp.m(2), 'Ana Admin E201-06', 'F', pg_temp.m(1), true, pg_temp.u(1), pg_temp.role(1), pg_temp.mob(2)),
  (pg_temp.m(3), 'Lino Lider E201-06', 'M', pg_temp.m(1), true, pg_temp.u(2), pg_temp.role(2), pg_temp.mob(3)),
  (pg_temp.m(4), 'Caio Celula',        'M', pg_temp.m(1), true, NULL, NULL, pg_temp.mob(4)),
  (pg_temp.m(5), 'Fabio Folha',        'M', pg_temp.m(1), true, NULL, NULL, pg_temp.mob(5)),
  (pg_temp.m(6), 'Paula Participante', 'F', pg_temp.m(1), true, NULL, NULL, pg_temp.mob(6)),
  (pg_temp.m(7), 'Sara Saiu',          'F', pg_temp.m(1), true, NULL, NULL, pg_temp.mob(7));

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1), pg_temp.m(4), pg_temp.m(4), pg_temp.m(4), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(2), pg_temp.m(4), pg_temp.m(4), pg_temp.m(4), 'Discipulado',   'Quinta', '20:00');
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
  (pg_temp.r(1), pg_temp.c(1), public.sp_today(), '20:00', 'Com participantes', true),
  (pg_temp.r(2), pg_temp.c(2), public.sp_today(), '20:00', 'Sem participantes', true);
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  (pg_temp.r(1), pg_temp.m(4)), (pg_temp.r(1), pg_temp.m(6)), (pg_temp.r(1), pg_temp.m(7));
-- Sara foi excluída depois de participar (RN-13).
UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(7);

CREATE TEMP TABLE before_counts AS SELECT pg_temp.counts() AS v;

-- ===========================================================================
-- 1. Privilégios e políticas — 16 verificações
-- ===========================================================================
SELECT ok(NOT has_table_privilege(g, t, 'DELETE') AND NOT has_table_privilege(g, t, 'TRUNCATE'),
          g || ': sem DELETE e sem TRUNCATE em ' || t || ' (RN-01, DT-02)')
  FROM unnest(ARRAY['authenticated', 'anon']) g,
       unnest(ARRAY['public.members', 'public.cells', 'public.cell_reports']) t;

SELECT is_empty($$
  SELECT c.relname, a.privilege_type
    FROM pg_class c, aclexplode(c.relacl) a
   WHERE c.oid IN ('public.members'::regclass, 'public.cells'::regclass,
                   'public.cell_reports'::regclass, 'public.cell_report_participants'::regclass)
     AND a.grantee = 0
     AND a.privilege_type IN ('DELETE', 'TRUNCATE') $$,
  'PUBLIC: sem DELETE e sem TRUNCATE nas quatro tabelas');

SELECT ok(NOT has_table_privilege('authenticated', 'public.cell_report_participants', 'DELETE'),
  'authenticated: sem DELETE em cell_report_participants (E2.11: a retirada é pela save_cell_report)');
SELECT ok(NOT has_table_privilege(g, 'public.cell_report_participants', 'TRUNCATE'),
          g || ': sem TRUNCATE em cell_report_participants')
  FROM unnest(ARRAY['authenticated', 'anon']) g;

-- E2.11 PR 2: TRUNCATE revogado em cell_reports e participantes (não passa pela guarda de linha).
SELECT ok(has_table_privilege('service_role', t, 'DELETE')
          AND has_table_privilege('service_role', t, 'TRUNCATE') = (t <> 'public.cell_reports'),
          'service_role: DELETE mantido em ' || t || CASE WHEN t = 'public.cell_reports' THEN ', sem TRUNCATE (E2.11)' ELSE ' e TRUNCATE' END)
  FROM unnest(ARRAY['public.members', 'public.cells', 'public.cell_reports']) t;
SELECT ok(NOT has_table_privilege('service_role', 'public.cell_report_participants', 'DELETE')
          AND NOT has_table_privilege('service_role', 'public.cell_report_participants', 'TRUNCATE'),
  'service_role: sem DELETE e sem TRUNCATE em public.cell_report_participants (E2.11: só as RPCs gravam)');

SELECT is_empty($$
  SELECT tablename, policyname FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('members', 'cells', 'cell_reports')
     AND cmd IN ('DELETE', 'ALL') $$,
  'members, cells e cell_reports: nenhuma política de DELETE (ou ALL)');
SELECT is(
  ARRAY(SELECT policyname::text FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'cell_report_participants' AND cmd = 'DELETE'),
  '{}'::text[],
  'cell_report_participants: sem política de DELETE (E2.11: a retirada é pela save_cell_report)');

-- ===========================================================================
-- 2. Administrador (todas as permissões): DELETE e TRUNCATE recusados — 8 verificações
-- ===========================================================================
SELECT is(pg_temp.try('authenticated', 1, format('DELETE FROM public.members WHERE id = %L', pg_temp.m(5))) ->> 'state',
  '42501', 'administrador: DELETE de membro sem vínculos → 42501 (RN-01)');
SELECT is(pg_temp.try('authenticated', 1, format('DELETE FROM public.cells WHERE id = %L', pg_temp.c(2))) ->> 'state',
  '42501', 'administrador: DELETE de célula → 42501');
SELECT is(pg_temp.try('authenticated', 1, format('DELETE FROM public.cell_reports WHERE id = %L', pg_temp.r(2))) ->> 'state',
  '42501', 'administrador: DELETE de relatório sem participantes → 42501');
SELECT ok(pg_temp.try('authenticated', 1, format('DELETE FROM public.members WHERE id = %L', pg_temp.m(5))) ->> 'message'
            LIKE 'permission denied for table members%',
  'administrador: a recusa do DELETE é de privilégio (antes do RLS e dos triggers)');
SELECT is(pg_temp.try('authenticated', 1, 'TRUNCATE public.members CASCADE') ->> 'state',
  '42501', 'administrador: TRUNCATE members → 42501');
SELECT is(pg_temp.try('authenticated', 1, 'TRUNCATE public.cells CASCADE') ->> 'state',
  '42501', 'administrador: TRUNCATE cells → 42501');
SELECT is(pg_temp.try('authenticated', 1, 'TRUNCATE public.cell_reports CASCADE') ->> 'state',
  '42501', 'administrador: TRUNCATE cell_reports → 42501');
SELECT is(pg_temp.try('authenticated', 1, 'TRUNCATE public.cell_report_participants') ->> 'state',
  '42501', 'administrador: TRUNCATE cell_report_participants → 42501');

-- ===========================================================================
-- 3. anon — 9 verificações
-- ===========================================================================
SELECT is(pg_temp.try('anon', NULL, format('DELETE FROM public.%I WHERE id = %L', t, id)) ->> 'state',
          '42501', 'anon: DELETE em ' || t || ' → 42501')
  FROM (VALUES ('members', pg_temp.m(5)), ('cells', pg_temp.c(2)), ('cell_reports', pg_temp.r(2))) v(t, id);
SELECT is(pg_temp.try('anon', NULL, format('DELETE FROM public.cell_report_participants WHERE report_id = %L', pg_temp.r(1))) ->> 'state',
  '42501', 'anon: DELETE em cell_report_participants → 42501');
SELECT is(pg_temp.try('anon', NULL, format('TRUNCATE public.%I CASCADE', t)) ->> 'state',
          '42501', 'anon: TRUNCATE ' || t || ' → 42501')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports', 'cell_report_participants']) t;

-- Nada foi apagado por nenhuma das tentativas acima.
SELECT is(pg_temp.counts(), (SELECT v FROM before_counts),
  'nada foi apagado: as contagens das quatro tabelas não mudaram');

-- ===========================================================================
-- 4. O que continua funcionando — 8 verificações
-- ===========================================================================
-- E2.11 PR 2: o DELETE direto de participante acabou (a retirada é pela save_cell_report).
SELECT is(pg_temp.try('authenticated', 2, format(
            'DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
            pg_temp.r(1), pg_temp.m(6))) ->> 'state',
  '42501',
  'edit_cell: DELETE direto de participante não excluído → 42501 de privilégio (E2.11)');
SELECT isnt_empty(format('SELECT 1 FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
                         pg_temp.r(1), pg_temp.m(6)),
  'o participante continua no relatório');
SELECT is(pg_temp.try('authenticated', 2, format(
            'DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
            pg_temp.r(1), pg_temp.m(7))) ->> 'state',
  '42501',
  'edit_cell: DELETE direto de participante excluído → 42501 de privilégio (E2.11)');

-- Exclusão lógica pelas RPCs.
SELECT is(pg_temp.try('authenticated', 1, format('SELECT public.delete_cell_report(%L)', pg_temp.r(2))) ->> 'state',
  '00000', 'administrador: delete_cell_report continua funcionando');
SELECT ok((SELECT deleted_at IS NOT NULL AND deleted_by = pg_temp.m(2) FROM public.cell_reports WHERE id = pg_temp.r(2)),
  'o relatório foi marcado (data e autor), sem sair da tabela (RN-01)');
SELECT is(pg_temp.try('authenticated', 1, format('SELECT public.delete_cell(%L)', pg_temp.c(2))) ->> 'state',
  '00000', 'administrador: delete_cell continua funcionando');
SELECT ok((SELECT deleted_at IS NOT NULL FROM public.cells WHERE id = pg_temp.c(2)),
  'a célula foi marcada, sem sair da tabela');

-- service_role: o privilégio continua (sem apagar nada).
SELECT is(pg_temp.try('service_role', NULL, 'DELETE FROM public.members WHERE false'),
  '{"state": "00000", "rows": 0}'::jsonb,
  'service_role: DELETE continua permitido (comando sem linhas)');

SELECT * FROM finish();
ROLLBACK;
