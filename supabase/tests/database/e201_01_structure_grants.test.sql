-- E2.01 (PR 1): estrutura, grants e integridade garantida pelo banco.
-- Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), seções
-- "Modelo de dados e migrations", "Integridade garantida pelo banco",
-- "Contratos" e "Verificações obrigatórias (para o QA)".
--
-- Cobre:
--   - views novas (members_deleted_view, cells_deleted_view,
--     cell_reports_deleted_view): dono postgres, security_barrier, definer,
--     só SELECT para authenticated, nada para anon e PUBLIC, colunas na ordem
--     do contrato; views do E1.08 com cell_deleted/member_deleted no fim;
--   - as 9 RPCs: EXECUTE só para authenticated (nada para anon e PUBLIC),
--     SECURITY DEFINER (a set_cell_report_participants saiu no E2.11: a save_cell_report a absorveu),
--     search_path fixo; funções públicas novas sem anon; _del_* e funções de
--     trigger sem EXECUTE para authenticated;
--   - private.member_access_suspensions sem privilégio para anon,
--     authenticated e service_role, com RLS e sem políticas;
--   - colunas, CHECKs e FKs (NO ACTION; role_id continua SET NULL);
--   - índices parciais com o mesmo nome do E1.08, índices de excluídos,
--     índice único da semana e do e-mail da conta;
--   - violações diretas como postgres (critério de pronto 2): autor sem data,
--     duas semanas iguais não excluídas (também com replica), exclusão física
--     com referência;
--   - triggers novos e o valor 'restore' do enum event_action.
--
-- Fora deste arquivo: "depois da migration 5, DELETE e TRUNCATE dão 42501"
-- está em e201_06_no_physical_delete.test.sql (PR 2). As exclusões físicas do
-- fim deste arquivo rodam como postgres, que mantém o DELETE, e conferem as FKs.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(177);

CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2010100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2010100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2010100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

-- Colunas de uma relação, na ordem.
CREATE FUNCTION pg_temp.cols(_rel regclass) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_agg(attname::text ORDER BY attnum)
    FROM pg_attribute WHERE attrelid = _rel AND attnum > 0 AND NOT attisdropped
$$;

-- Ação de exclusão (confdeltype) da FK de _rel sobre a coluna _col.
CREATE FUNCTION pg_temp.fk_del(_rel regclass, _col text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(c.confdeltype::text, ',' ORDER BY c.conname)
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = _col
   WHERE c.conrelid = _rel AND c.contype = 'f' AND c.conkey = ARRAY[a.attnum]
$$;
CREATE FUNCTION pg_temp.fk_name(_rel regclass, _col text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT string_agg(c.conname::text, ',' ORDER BY c.conname)
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attname = _col
   WHERE c.conrelid = _rel AND c.contype = 'f' AND c.conkey = ARRAY[a.attnum]
$$;

-- Predicado de um índice (NULL = índice total).
CREATE FUNCTION pg_temp.idx_pred(_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT pg_get_expr(i.indpred, i.indrelid)
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = _name
$$;
CREATE FUNCTION pg_temp.idx_def(_name text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT pg_get_indexdef(c.oid)
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relname = _name
$$;

-- ===========================================================================
-- 1. Views novas: dono, opções e grants (critério de pronto 1) — 33
-- ===========================================================================
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = v::regclass), 'postgres',
          v || ': dono é postgres (repete o predicado de escopo, RN-15)')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT ok((SELECT 'security_barrier=true' = ANY(reloptions) FROM pg_class WHERE oid = v::regclass),
          v || ': security_barrier')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT ok((SELECT NOT coalesce('security_invoker=true' = ANY(reloptions), false)
             FROM pg_class WHERE oid = v::regclass),
          v || ': security definer (não trocar para invoker; risco 12)')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT ok(has_table_privilege('authenticated', v, 'SELECT'), v || ': SELECT para authenticated')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT ok(NOT has_table_privilege('authenticated', v, 'INSERT')
          AND NOT has_table_privilege('authenticated', v, 'UPDATE')
          AND NOT has_table_privilege('authenticated', v, 'DELETE')
          AND NOT has_table_privilege('authenticated', v, 'TRUNCATE')
          AND NOT has_table_privilege('authenticated', v, 'REFERENCES')
          AND NOT has_table_privilege('authenticated', v, 'TRIGGER'),
          v || ': authenticated só lê (sem INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER)')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT ok(NOT has_table_privilege('anon', v, 'SELECT')
          AND NOT has_table_privilege('anon', v, 'INSERT')
          AND NOT has_table_privilege('anon', v, 'UPDATE')
          AND NOT has_table_privilege('anon', v, 'DELETE'),
          v || ': nada para anon')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT ok(NOT EXISTS (
            SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
             WHERE c.oid = v::regclass AND a.grantee = 0),
          v || ': nada para PUBLIC')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

SELECT is(
  (SELECT array_agg(DISTINCT a.privilege_type::text ORDER BY a.privilege_type::text)
     FROM pg_class c, aclexplode(c.relacl) a
    WHERE c.oid = v::regclass AND a.grantee = 'authenticated'::regrole),
  ARRAY['SELECT'],
  v || ': a ACL de authenticated é exatamente SELECT')
  FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view',
                    'public.cell_reports_deleted_view']) v;

-- Views do E1.08 continuam só leitura para authenticated, sem anon (regressão).
SELECT ok(has_table_privilege('authenticated', v, 'SELECT')
          AND NOT has_table_privilege('authenticated', v, 'INSERT')
          AND NOT has_table_privilege('authenticated', v, 'UPDATE')
          AND NOT has_table_privilege('authenticated', v, 'DELETE')
          AND NOT has_table_privilege('anon', v, 'SELECT'),
          v || ': continua só SELECT para authenticated e nada para anon (regressão do E1.08)')
  FROM unnest(ARRAY['public.members_view', 'public.cells_view', 'public.cell_reports_view',
                    'public.cell_report_participants_view']) v;

-- ===========================================================================
-- 2. Colunas das views (contrato; colunas novas no fim, risco 5 do E1.08) — 9
-- ===========================================================================
SELECT is(pg_temp.cols('public.members_deleted_view'),
  ARRAY['id','name','gender','is_active','is_pastor','neighborhood','city',
        'leader_id','leader_name','leader_deleted','role_id','role_name',
        'restore_role_name','role_reset_on_restore','has_account','sensitive_visible',
        'email','cpf','mobile_whatsapp','deleted_at','deleted_by','deleted_by_name','search_text','deleted_by_kind'],
  'members_deleted_view: colunas do contrato (AQ-3, AQ-7), na ordem (deleted_by_kind do E2.05 no fim)');
SELECT is(pg_temp.cols('public.cells_deleted_view'),
  ARRAY['id','type','meeting_day','meeting_weekday','meeting_time','street','number',
        'neighborhood','city','is_active','leader_id','leader_name','leader_deleted',
        'timothy_id','timothy_name','timothy_deleted','host_id','host_name','host_deleted',
        'deleted_at','deleted_by','deleted_by_name','search_text','deleted_by_kind'],
  'cells_deleted_view: colunas do contrato (AQ-3), na ordem (deleted_by_kind do E2.05 no fim)');
SELECT is(pg_temp.cols('public.cell_reports_deleted_view'),
  ARRAY['id','cell_id','date','time','was_held','theme','reason_not_held','week_start',
        'cell_leader_id','cell_leader_name','cell_deleted','week_taken',
        'deleted_at','deleted_by','deleted_by_name','search_text','deleted_by_kind'],
  'cell_reports_deleted_view: colunas do contrato (AQ-3), na ordem (deleted_by_kind do E2.05 no fim)');

SELECT is((pg_temp.cols('public.cell_reports_view'))[array_length(pg_temp.cols('public.cell_reports_view'), 1) - 19],
  'cell_deleted', 'cell_reports_view: cell_deleted é a última coluna antes das quatro da autoria do E2.05, das onze do retrato do E2.11 e das quatro do E2.12 (AQ-4)');
SELECT is((pg_temp.cols('public.cell_reports_view'))[array_length(pg_temp.cols('public.cell_reports_view'), 1) - 20],
  'search_text', 'cell_reports_view: as colunas do E1.08 continuam antes de cell_deleted');
SELECT is((pg_temp.cols('public.cell_report_participants_view')),
  ARRAY['report_id','member_id','member_name','member_deleted','member_visible','is_snapshot_person','member_is_active','member_gender'],
  'cell_report_participants_view: member_deleted, member_visible do E2.02 e, no fim, as três do E2.11 (AQ-5)');
SELECT ok(NOT ('deleted_at' = ANY(pg_temp.cols('public.members_view')))
          AND NOT ('deleted_by' = ANY(pg_temp.cols('public.members_view'))),
  'members_view: sem colunas de exclusão (já filtra os excluídos)');
SELECT ok(NOT ('deleted_at' = ANY(pg_temp.cols('public.cells_view')))
          AND NOT ('deleted_by' = ANY(pg_temp.cols('public.cells_view'))),
  'cells_view: sem colunas de exclusão');
SELECT is((pg_temp.cols('public.cells_view'))[array_length(pg_temp.cols('public.cells_view'), 1) - 9],
  'search_text', 'cells_view: nenhuma coluna de exclusão; as três do E2.02, as duas do E2.09 e as quatro do E2.05 vêm depois de search_text');
SELECT is((pg_temp.cols('public.cells_view'))[array_length(pg_temp.cols('public.cells_view'), 1) - 8 : array_length(pg_temp.cols('public.cells_view'), 1)],
  ARRAY['can_submit_report','is_mine','leader_is_pastor','report_status','report_missing_weeks',
        'created_by_kind','created_by_name','updated_by_kind','updated_by_name'],
  'cells_view: can_submit_report, is_mine e leader_is_pastor (E2.02), report_status e report_missing_weeks (E2.09) e as quatro da autoria (E2.05) no fim');

-- ===========================================================================
-- 3. RPCs: grants e propriedades (critério de pronto 1) — 54
-- ===========================================================================
SELECT ok(has_function_privilege('authenticated', f, 'EXECUTE'), f || ': EXECUTE para authenticated')
  FROM unnest(ARRAY[
    'public.check_member_deletion(uuid)', 'public.delete_member(uuid)', 'public.restore_member(uuid)',
    'public.delete_cell(uuid)', 'public.restore_cell(uuid)', 'public.delete_cell_report(uuid)',
    'public.restore_cell_report(uuid)', 'public.save_cell_report(uuid, jsonb, uuid[])',
    'public.find_deleted_member_matches(text, text, text)']) f;

SELECT ok(NOT has_function_privilege('anon', f, 'EXECUTE'), f || ': sem EXECUTE para anon')
  FROM unnest(ARRAY[
    'public.check_member_deletion(uuid)', 'public.delete_member(uuid)', 'public.restore_member(uuid)',
    'public.delete_cell(uuid)', 'public.restore_cell(uuid)', 'public.delete_cell_report(uuid)',
    'public.restore_cell_report(uuid)', 'public.save_cell_report(uuid, jsonb, uuid[])',
    'public.find_deleted_member_matches(text, text, text)']) f;

SELECT ok(NOT EXISTS (
            SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
             WHERE p.oid = f::regprocedure AND a.grantee = 0),
          f || ': sem EXECUTE para PUBLIC')
  FROM unnest(ARRAY[
    'public.check_member_deletion(uuid)', 'public.delete_member(uuid)', 'public.restore_member(uuid)',
    'public.delete_cell(uuid)', 'public.restore_cell(uuid)', 'public.delete_cell_report(uuid)',
    'public.restore_cell_report(uuid)', 'public.save_cell_report(uuid, jsonb, uuid[])',
    'public.find_deleted_member_matches(text, text, text)']) f;

SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = f::regprocedure),
          true,
          f || ': SECURITY DEFINER (DT-02; a save_cell_report absorveu a set_cell_report_participants no E2.11)')
  FROM unnest(ARRAY[
    'public.check_member_deletion(uuid)', 'public.delete_member(uuid)', 'public.restore_member(uuid)',
    'public.delete_cell(uuid)', 'public.restore_cell(uuid)', 'public.delete_cell_report(uuid)',
    'public.restore_cell_report(uuid)', 'public.save_cell_report(uuid, jsonb, uuid[])',
    'public.find_deleted_member_matches(text, text, text)']) f;

SELECT ok((SELECT 'search_path=public' = ANY(proconfig) FROM pg_proc WHERE oid = f::regprocedure),
          f || ': search_path fixo (public)')
  FROM unnest(ARRAY[
    'public.check_member_deletion(uuid)', 'public.delete_member(uuid)', 'public.restore_member(uuid)',
    'public.delete_cell(uuid)', 'public.restore_cell(uuid)', 'public.delete_cell_report(uuid)',
    'public.restore_cell_report(uuid)', 'public.save_cell_report(uuid, jsonb, uuid[])',
    'public.find_deleted_member_matches(text, text, text)']) f;

SELECT is((SELECT pg_get_function_result(f::regprocedure)), res, f || ': tipo de retorno do contrato')
  FROM (VALUES
    ('public.check_member_deletion(uuid)', 'jsonb'),
    ('public.delete_member(uuid)', 'void'),
    ('public.restore_member(uuid)',
     'TABLE(restored_without_leader boolean, previous_leader_name text, role_reset_to_default boolean, role_name text)'),
    ('public.delete_cell(uuid)', 'void'),
    ('public.restore_cell(uuid)', 'void'),
    ('public.delete_cell_report(uuid)', 'void'),
    ('public.restore_cell_report(uuid)', 'void'),
    ('public.save_cell_report(uuid, jsonb, uuid[])', 'TABLE(report_id uuid, changed boolean)'),
    ('public.find_deleted_member_matches(text, text, text)',
     'TABLE(member_id uuid, name text, deleted_at timestamp with time zone, matched_fields text[], is_account_email boolean)')
  ) AS t(f, res);

-- ===========================================================================
-- 4. Funções públicas novas e internas — 25
-- ===========================================================================
SELECT ok(has_function_privilege('authenticated', f, 'EXECUTE')
          AND NOT has_function_privilege('anon', f, 'EXECUTE'),
          f || ': EXECUTE para authenticated, sem anon')
  FROM unnest(ARRAY['public.viewer_covers_role(uuid)', 'public.viewer_sees_report_people(uuid,uuid,uuid)',
                    'public.normalize_email(text)', 'public.normalize_digits(text)']) f;

SELECT ok(has_function_privilege('service_role', f, 'EXECUTE'),
          f || ': EXECUTE para service_role (índices de members gravados pela create-user-admin)')
  FROM unnest(ARRAY['public.normalize_email(text)', 'public.normalize_digits(text)']) f;

SELECT is((SELECT provolatile FROM pg_proc WHERE oid = f::regprocedure), 'i'::"char",
          f || ': IMMUTABLE (usada em índice)')
  FROM unnest(ARRAY['public.normalize_email(text)', 'public.normalize_digits(text)']) f;

SELECT is(public.normalize_email('  Bruno@Exemplo.COM '), 'bruno@exemplo.com',
  'normalize_email: minúsculas e sem espaços nas pontas (DT-17)');
SELECT is(public.normalize_email('   '), NULL, 'normalize_email: vazio vira NULL (nunca combina dois cadastros sem dado)');
SELECT is(public.normalize_digits('(51) 99999-0000'), '51999990000', 'normalize_digits: só dígitos (celular)');
SELECT is(public.normalize_digits('529.982.247-25'), '52998224725', 'normalize_digits: só dígitos (CPF)');
SELECT is(public.normalize_digits('---'), NULL, 'normalize_digits: sem dígito vira NULL');

SELECT ok(NOT has_function_privilege('authenticated', f, 'EXECUTE')
          AND NOT has_function_privilege('anon', f, 'EXECUTE'),
          f || ': interna, sem EXECUTE para authenticated e anon')
  FROM unnest(ARRAY['public._del_raise(text, text, jsonb)', 'public._del_lock_members(uuid, uuid)',
                    'public._del_member_blockers(uuid)', 'public._del_suspend_access(uuid, uuid)',
                    'public._del_resume_access(uuid)', 'public._del_lock_cell_week(uuid, date)',
                    'public.enforce_member_links()', 'public.enforce_cell_links()',
                    'public.enforce_cell_report_rules()', 'public.enforce_participant_rules()']) f;

SELECT ok(NOT has_function_privilege('anon', 'public.viewer_covers_role(uuid)', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.viewer_sees_report_people(uuid,uuid,uuid)', 'EXECUTE'),
  'helpers de escopo novos: nenhum EXECUTE para anon (critério de pronto 1)');

-- ===========================================================================
-- 5. Schema private e tabela das suspensões — 8
-- ===========================================================================
SELECT ok(NOT has_schema_privilege(r, 'private', 'USAGE'), 'schema private: sem USAGE para ' || r)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;

SELECT ok(NOT has_table_privilege(r, 'private.member_access_suspensions', 'SELECT')
          AND NOT has_table_privilege(r, 'private.member_access_suspensions', 'INSERT')
          AND NOT has_table_privilege(r, 'private.member_access_suspensions', 'UPDATE')
          AND NOT has_table_privilege(r, 'private.member_access_suspensions', 'DELETE'),
          'private.member_access_suspensions: nenhum privilégio para ' || r)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;

SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.member_access_suspensions'::regclass),
  'private.member_access_suspensions: RLS ligado');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private'
            AND tablename = 'member_access_suspensions'), 0,
  'private.member_access_suspensions: sem políticas');

-- ===========================================================================
-- 6. Colunas, CHECKs e FKs (DT-01, DT-03) — 21
-- ===========================================================================
SELECT has_column('public', t, 'deleted_at', t || ': deleted_at')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT col_type_is('public', t, 'deleted_at', 'timestamp with time zone', t || '.deleted_at é timestamptz')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT is(pg_temp.fk_name(('public.' || t)::regclass, 'deleted_by'), t || '_deleted_by_fkey',
          t || '.deleted_by → members(id) (DT-01)')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = ('public.' || t)::regclass
                     AND conname = t || '_deleted_by_check' AND contype = 'c'),
          t || ': CHECK autor só com data')
  FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t;

SELECT is(pg_temp.fk_del(rel::regclass, col), 'a',
          rel || '.' || col || ': FK NO ACTION, sem cascata nem SET NULL (DT-03, DEL-07)')
  FROM (VALUES ('public.members', 'leader_id'), ('public.members', 'spouse_id'),
               ('public.cell_reports', 'cell_id'), ('public.cell_report_participants', 'report_id'),
               ('public.cell_report_participants', 'member_id')) AS t(rel, col);
SELECT is(pg_temp.fk_del('public.members', 'role_id'), 'n',
  'members.role_id continua ON DELETE SET NULL (funções são configuração; DA-2)');
SELECT is(pg_temp.fk_name('public.members', 'leader_id'), 'members_leader_id_fkey',
  'members.leader_id: uma FK só, com o nome padrão');

SELECT ok(has_column_privilege('authenticated', 'public.members', c, 'SELECT'),
          'members.' || c || ': SELECT por coluna para authenticated (DT-22)')
  FROM unnest(ARRAY['deleted_at', 'deleted_by']) c;

-- ===========================================================================
-- 7. Índices (DT-07) — 9
-- ===========================================================================
SELECT is(pg_temp.idx_pred(n), '(deleted_at IS NULL)',
          n || ': parcial (WHERE deleted_at IS NULL), com o mesmo nome do E1.08')
  FROM unnest(ARRAY['members_name_id_idx', 'cell_reports_date_id_idx', 'cell_reports_cell_id_date_idx']) n;
SELECT is(pg_temp.idx_pred(n), '(deleted_at IS NOT NULL)', n || ': lista de excluídos (RN-15)')
  FROM unnest(ARRAY['members_deleted_at_idx', 'cells_deleted_at_idx', 'cell_reports_deleted_at_idx']) n;
SELECT ok(pg_temp.idx_def('cell_reports_cell_week_key') LIKE 'CREATE UNIQUE INDEX%(cell_id, week_start(date)) WHERE (deleted_at IS NULL)',
  'cell_reports_cell_week_key: único, (cell_id, week_start(date)), só não excluídos (RN-12, RN-17)');
SELECT ok(pg_temp.idx_def('members_deleted_account_email_idx') LIKE '%normalize_email(email)%WHERE ((deleted_at IS NOT NULL) AND (auth_user_id IS NOT NULL))',
  'members_deleted_account_email_idx: e-mail normalizado da conta de excluídos (RN-18)');
SELECT ok(pg_temp.idx_def('members_deleted_at_idx') LIKE '%(deleted_at DESC, id)%',
  'members_deleted_at_idx: ordem deleted_at DESC, id');

-- ===========================================================================
-- 8. Triggers e enum — 9
-- ===========================================================================
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgrelid = rel::regclass
                    AND tgname = trg AND tgenabled = 'O'),
          rel || ': trigger ' || trg || ' ativo')
  FROM (VALUES ('public.members', 'ab_enforce_member_links'),
               ('public.cells', 'aa_enforce_cell_links'),
               ('public.cell_reports', 'aa_enforce_cell_report_rules'),
               ('public.cell_report_participants', 'aa_enforce_participant_rules')) AS t(rel, trg);
SELECT ok(pg_get_triggerdef(t.oid) ~ 'UPDATE OF .*deleted_at',
          t.tgname || ': totais também em UPDATE OF deleted_at (DT-24; E2.06: os triggers da hierarquia)')
  FROM pg_trigger t WHERE t.tgname IN ('trg_member_hierarchy', 'trg_cell_hierarchy');
SELECT ok(pg_get_triggerdef(t.oid) LIKE 'CREATE TRIGGER aa_enforce_participant_rules BEFORE INSERT OR DELETE%',
          'aa_enforce_participant_rules: BEFORE INSERT OR DELETE (RN-13)')
  FROM pg_trigger t WHERE t.tgname = 'aa_enforce_participant_rules';
SELECT ok('restore' = ANY(enum_range(NULL::public.event_action)::text[]),
  'event_action tem o valor restore (AQ-9)');
SELECT ok((SELECT prosecdef FROM pg_proc WHERE oid = 'public._hierarchy_on_member()'::regprocedure)
          AND (SELECT 'search_path=public' = ANY(proconfig) FROM pg_proc
                WHERE oid = 'public._hierarchy_on_member()'::regprocedure),
  '_hierarchy_on_member: SECURITY DEFINER com search_path fixo (DT-24; E2.06 no lugar de refresh_member_stats_v2)');

-- ===========================================================================
-- 9. Violações diretas como postgres (critério de pronto 2) — 14
-- ===========================================================================
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, spouse_id, is_active) VALUES
  (pg_temp.m(1), 'E201 Est Líder',    'M', false, NULL, false,         NULL,         true),
  (pg_temp.m(2), 'E201 Est Discípulo','M', false, pg_temp.m(1), true, NULL,         true),
  (pg_temp.m(3), 'E201 Est Marido',   'M', false, NULL, false,         pg_temp.m(4), true),
  (pg_temp.m(4), 'E201 Est Esposa',   'F', false, NULL, false,         pg_temp.m(3), true),
  (pg_temp.m(5), 'E201 Est Solo',     'M', false, NULL, false,         NULL,         true);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1), pg_temp.m(1), pg_temp.m(1), pg_temp.m(1), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(2), pg_temp.m(5), pg_temp.m(5), pg_temp.m(5), 'Evangelística', 'Quinta', '20:00');
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held) VALUES
  (pg_temp.r(1), pg_temp.c(1), '2026-11-04', '20:00', 'Um', true);
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (pg_temp.r(1), pg_temp.m(2));

-- Autor sem data.
SELECT throws_ok(format('UPDATE public.members SET deleted_by = %L WHERE id = %L', pg_temp.m(1), pg_temp.m(5)),
  '23514', NULL, 'CHECK members: autor sem data é recusado (DEL-01)');
SELECT throws_ok(format('UPDATE public.cells SET deleted_by = %L WHERE id = %L', pg_temp.m(1), pg_temp.c(2)),
  '23514', NULL, 'CHECK cells: autor sem data é recusado');
SELECT throws_ok(format('UPDATE public.cell_reports SET deleted_by = %L WHERE id = %L', pg_temp.m(1), pg_temp.r(1)),
  '23514', NULL, 'CHECK cell_reports: autor sem data é recusado');
SELECT lives_ok(format('UPDATE public.cells SET deleted_at = now(), deleted_by = %L WHERE id = %L',
                       pg_temp.m(1), pg_temp.c(2)),
  'CHECK: data com autor é aceita');

-- Semana única (mesmo com replica, porque é índice).
SELECT throws_ok(format($$INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
                          VALUES (%L, %L, '2026-11-07', '20:00', 'Dois', true)$$, pg_temp.r(2), pg_temp.c(1)),
  '23505', NULL, 'índice único: dois relatórios não excluídos da mesma célula na mesma semana (mesmo com replica)');
SELECT lives_ok(format($$INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, deleted_at)
                         VALUES (%L, %L, '2026-11-07', '20:00', 'Dois excluído', true, now())$$, pg_temp.r(2), pg_temp.c(1)),
  'índice único parcial: um excluído na mesma semana é aceito (RN-12)');
SELECT lives_ok(format($$INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, deleted_at)
                         VALUES (%L, %L, '2026-11-05', '20:00', 'Três excluído', true, now())$$, pg_temp.r(3), pg_temp.c(1)),
  'índice único parcial: dois excluídos na mesma semana são aceitos');
SELECT throws_ok(format($$UPDATE public.cell_reports SET deleted_at = NULL WHERE id = %L$$, pg_temp.r(2)),
  '23505', NULL, 'índice único: desmarcar a exclusão com outro relatório na semana é recusado (última garantia da RN-17)');
SELECT lives_ok(format($$INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held)
                         VALUES (%L, %L, '2026-11-08', '20:00', 'Semana seguinte', true)$$, pg_temp.r(4), pg_temp.c(1)),
  'índice único: domingo seguinte é outra semana (limite domingo 00:00)');
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- FK do autor (as FKs não valem com replica: conferidas depois do origin).
-- E2.05: o carimbo devolve o deleted_by gravado; sem ele, a FK é o que recusa.
ALTER TABLE public.cells DISABLE TRIGGER zz_stamp_authorship;
SELECT throws_ok(format('UPDATE public.cells SET deleted_by = %L WHERE id = %L', gen_random_uuid(), pg_temp.c(2)),
  '23503', NULL, 'FK cells.deleted_by: o autor precisa ser um membro');
ALTER TABLE public.cells ENABLE TRIGGER zz_stamp_authorship;

-- Exclusão física com referência (FKs NO ACTION).
SELECT throws_ok(format('DELETE FROM public.members WHERE id = %L', pg_temp.m(1)),
  '23503', NULL, 'FK: exclusão física de membro com discípulo falha, sem SET NULL (DEL-07)');
SELECT throws_ok(format('DELETE FROM public.members WHERE id = %L', pg_temp.m(3)),
  '23503', NULL, 'FK: exclusão física de membro casado falha (cônjuge sem SET NULL)');
SELECT throws_ok(format('DELETE FROM public.cells WHERE id = %L', pg_temp.c(1)),
  '23503', NULL, 'FK: exclusão física de célula com relatórios falha (sem cascata)');
SELECT throws_ok(format('DELETE FROM public.cell_reports WHERE id = %L', pg_temp.r(1)),
  '23503', NULL, 'FK: exclusão física de relatório com participantes falha (sem cascata)');

SELECT * FROM finish();
ROLLBACK;
