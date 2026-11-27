-- E2.05 (PR 1) — Auditoria: estrutura, regras do banco e privilégios.
-- Spec: docs/specs/e2-05-auditoria-autor.md ("Verificações obrigatórias": estrutura e privilégios;
-- RN-09, RN-10, RN-14, RN-16, RN-17; DT-01, DT-05, DT-07, DT-13, DT-14).
--   - tipos, colunas, valores padrão e FKs de autoria;
--   - os CHECKs de autoria recusam as combinações inválidas, também como postgres em replica;
--   - INSERT, UPDATE, DELETE e TRUNCATE em events dão 42501 para authenticated (inclusive o
--     Administrador) e para service_role; _log_event por /rpc dá 42501 para os dois;
--   - as funções private do passo sem EXECUTE para anon, authenticated e service_role; as
--     públicas novas sem anon; nenhum trigger de dados engole erro;
--   - os triggers antigos saíram; as views com a autoria no fim; events_view security_invoker;
--   - o job de guarda no pg_cron.
-- Rodar com: supabase test db
BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(47);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2050100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2050100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.cols(_rel text) RETURNS text[] LANGUAGE sql STABLE AS
$$ SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = _rel::regclass AND attnum > 0 AND NOT attisdropped $$;
-- Executa _sql com o papel _role (e o usuário _n, se houver); devolve o SQLSTATE ou 'ok'.
CREATE FUNCTION pg_temp.as_role(_role text, _n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN json_build_object('role', _role)
           ELSE json_build_object('sub', pg_temp.u(_n), 'role', _role) END::text, true);
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RAISE EXCEPTION 'e2050100_ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN CASE WHEN SQLERRM = 'e2050100_ok' THEN 'ok' ELSE _state END;
  END;
END $$;
-- Tenta _sql como postgres em replica, numa subtransação desfeita; devolve o SQLSTATE ou 'ok'.
CREATE FUNCTION pg_temp.replica(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL session_replication_role = replica';
    EXECUTE _sql;
    RAISE EXCEPTION 'e2050100_ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    EXECUTE 'SET LOCAL session_replication_role = origin';
    RETURN CASE WHEN SQLERRM = 'e2050100_ok' THEN 'ok' ELSE _state END;
  END;
END $$;

-- Massa: Ana (Administrador, com conta) e um registro de cada tabela.
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pg_temp.u(1), 'e2050100-1@teste.invalid', now());
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp, auth_user_id, role_id)
VALUES (pg_temp.m(1), 'Ana Estrutura', 'F', true, false, '51920500001', pg_temp.u(1),
        (SELECT id FROM public.roles WHERE is_system));
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
VALUES ('d2050100-0000-0000-0000-000000000001', pg_temp.m(1), pg_temp.m(1), pg_temp.m(1), 'Domingo', '00:00');

-- ===========================================================================
-- 1. Tipos e colunas (DT-01, DT-02, DT-03) — 9
-- ===========================================================================
SELECT is(enum_range(NULL::public.author_kind)::text[], ARRAY['member', 'system', 'legacy', 'unknown'],
  'author_kind: member, system, legacy e unknown (RN-09)');
SELECT is(enum_range(NULL::public.event_actor_kind)::text[], ARRAY['member', 'system', 'none'],
  'event_actor_kind: member, system e none (AQ-6)');
SELECT ok('role' = ANY (enum_range(NULL::public.event_entity)::text[]), 'event_entity ganha role (RN-15)');
SELECT is(
  (SELECT array_agg(t || '.' || c ORDER BY t, c)
     FROM unnest(ARRAY['members', 'cells', 'cell_reports']) t
    CROSS JOIN unnest(ARRAY['created_by', 'created_by_kind', 'created_by_legacy', 'updated_by', 'updated_by_kind',
                            'updated_by_legacy', 'deleted_by_kind', 'deleted_by_legacy']) c
    WHERE NOT (c = ANY (pg_temp.cols('public.' || t)))),
  NULL, 'DT-01: as oito colunas de autoria nas três tabelas');
SELECT is(
  (SELECT array_agg(table_name || '.' || column_name || ':' || is_nullable || ':' || coalesce(column_default, '-')
                    ORDER BY table_name, column_name)
     FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('members', 'cells', 'cell_reports')
      AND column_name IN ('created_at', 'updated_at', 'created_by_kind')),
  ARRAY['cell_reports.created_at:YES:now()', 'cell_reports.created_by_kind:NO:''system''::author_kind', 'cell_reports.updated_at:YES:-',
        'cells.created_at:YES:now()', 'cells.created_by_kind:NO:''system''::author_kind', 'cells.updated_at:YES:-',
        'members.created_at:YES:now()', 'members.created_by_kind:NO:''system''::author_kind', 'members.updated_at:YES:-'],
  'DT-02/DT-03: created_at e updated_at anuláveis, updated_at sem padrão; created_by_kind NOT NULL, padrão system (gravação sem trigger)');
SELECT is(
  (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
    WHERE contype = 'f' AND conrelid IN ('public.members'::regclass, 'public.cells'::regclass, 'public.cell_reports'::regclass)
      AND (conname LIKE '%created_by_fkey' OR conname LIKE '%updated_by_fkey') AND confdeltype = 'a'),
  ARRAY['cell_reports_created_by_fkey', 'cell_reports_updated_by_fkey', 'cells_created_by_fkey', 'cells_updated_by_fkey',
        'members_created_by_fkey', 'members_updated_by_fkey'],
  'DT-01: FKs created_by e updated_by → members, sem cascata');
SELECT is(
  (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
    WHERE contype = 'c' AND conrelid IN ('public.members'::regclass, 'public.cells'::regclass, 'public.cell_reports'::regclass)
      AND (conname LIKE '%authorship_check' OR conname LIKE '%legacy_names_check')),
  ARRAY['cell_reports_created_authorship_check', 'cell_reports_deleted_authorship_check', 'cell_reports_legacy_names_check',
        'cell_reports_updated_authorship_check', 'cells_created_authorship_check', 'cells_deleted_authorship_check',
        'cells_legacy_names_check', 'cells_updated_authorship_check', 'members_created_authorship_check',
        'members_deleted_authorship_check', 'members_legacy_names_check', 'members_updated_authorship_check'],
  'RN-09: os quatro CHECKs de autoria nas três tabelas');
SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['actor_kind', 'changes', 'tx_id', 'seq', 'search_text']) c
    WHERE NOT (c = ANY (pg_temp.cols('public.events')))),
  NULL, 'DT-10: events ganha actor_kind, changes, tx_id, seq e search_text');
SELECT is(
  (SELECT array_agg(indexrelid::regclass::text ORDER BY indexrelid::regclass::text) FROM pg_index
    WHERE indrelid = 'public.events'::regclass AND NOT indisprimary),
  ARRAY['events_action_idx', 'events_actor_idx', 'events_occurred_at_seq_idx', 'events_record_idx', 'events_search_trgm_idx'],
  'DT-12: índices da Auditoria paginada (occurred_at, seq), do histórico (entity, entity_id, occurred_at, seq) e da busca (trigramas, risco 4)');

-- ===========================================================================
-- 2. CHECKs de autoria, como postgres em replica (RN-09, RN-10) — 10
-- ===========================================================================
SELECT is(pg_temp.replica(format($$UPDATE public.members SET created_by_kind = 'member', created_by = NULL WHERE id = %L$$, pg_temp.m(1))),
  '23514', 'CHECK: cadastro "member" sem o id do autor é recusado');
SELECT is(pg_temp.replica(format($$UPDATE public.members SET created_by_kind = 'system', created_by = %L WHERE id = %L$$, pg_temp.m(1), pg_temp.m(1))),
  '23514', 'CHECK: cadastro "system" com o id de um membro é recusado');
SELECT is(pg_temp.replica(format($$UPDATE public.members SET created_by_kind = 'legacy', created_by_legacy = NULL WHERE id = %L$$, pg_temp.m(1))),
  '23514', 'CHECK: cadastro do legado sem o nome é recusado');
SELECT is(pg_temp.replica(format($$UPDATE public.members SET created_by_kind = 'member', created_by = %L, created_at = NULL WHERE id = %L$$, pg_temp.m(1), pg_temp.m(1))),
  '23514', 'CHECK: "data não registrada" só no legado ou sem autor conhecido (RN-10 d)');
SELECT is(pg_temp.replica(format($$UPDATE public.members SET created_by_kind = 'legacy', created_by_legacy = 'AdminUser', created_at = NULL WHERE id = %L$$, pg_temp.m(1))),
  'ok', 'CHECK: cadastro do legado sem data é aceito (RN-10 d)');
SELECT is(pg_temp.replica(format($$UPDATE public.members SET updated_at = now(), updated_by_kind = NULL WHERE id = %L$$, pg_temp.m(1))),
  '23514', 'CHECK: data de alteração sem o tipo do autor é recusada');
SELECT is(pg_temp.replica(format($$UPDATE public.members SET updated_at = NULL, updated_by_kind = 'system' WHERE id = %L$$, pg_temp.m(1))),
  '23514', 'CHECK: tipo de autor da alteração sem a data é recusado');
SELECT is(pg_temp.replica(format($$UPDATE public.cells SET deleted_by_kind = 'system' WHERE id = %L$$, 'd2050100-0000-0000-0000-000000000001')),
  '23514', 'CHECK: tipo de autor da exclusão sem exclusão é recusado');
SELECT is(pg_temp.replica(format($$UPDATE public.cells SET deleted_at = now(), deleted_by_kind = 'legacy', deleted_by_legacy = '  ' WHERE id = %L$$, 'd2050100-0000-0000-0000-000000000001')),
  '23514', 'CHECK: nome do legado só com espaços é recusado (vazio vira nulo antes)');
SELECT is(pg_temp.replica(format($$UPDATE public.cells SET deleted_at = now(), deleted_by_kind = 'member', deleted_by = NULL WHERE id = %L$$, 'd2050100-0000-0000-0000-000000000001')),
  '23514', 'CHECK: exclusão "member" sem o id de quem excluiu é recusada');

-- ===========================================================================
-- 3. Eventos imutáveis pela API (RN-16, DT-13) — 9
-- ===========================================================================
SELECT is(
  (SELECT array_agg(r || ':' || p ORDER BY r, p)
     FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
    CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
    WHERE has_table_privilege(r, 'public.events', p)),
  NULL, 'RN-16: nenhum papel da API tem INSERT, UPDATE, DELETE ou TRUNCATE em events');
SELECT ok(has_table_privilege('authenticated', 'public.events', 'SELECT') AND NOT has_table_privilege('anon', 'public.events', 'SELECT'),
  'RN-18: authenticated lê events (sob a política); anon não');
SELECT is(pg_temp.as_role('authenticated', 1, $$INSERT INTO public.events (action, entity, description) VALUES ('update', 'member', 'forjado')$$),
  '42501', 'RN-16: o Administrador não cria evento pela API');
SELECT is(pg_temp.as_role('authenticated', 1, $$UPDATE public.events SET description = 'forjado'$$),
  '42501', 'RN-16: o Administrador não altera evento pela API');
SELECT is(pg_temp.as_role('authenticated', 1, $$DELETE FROM public.events$$),
  '42501', 'RN-16: o Administrador não apaga evento pela API');
SELECT is(pg_temp.as_role('service_role', NULL, $$INSERT INTO public.events (action, entity, description) VALUES ('update', 'member', 'forjado')$$),
  '42501', 'RN-16: a chave secreta não cria evento');
SELECT is(pg_temp.as_role('service_role', NULL, $$DELETE FROM public.events$$),
  '42501', 'RN-16: a chave secreta não apaga evento');
SELECT is(pg_temp.as_role('service_role', NULL, $$TRUNCATE public.events$$),
  '42501', 'RN-16: a chave secreta não esvazia events');
SELECT is(
  (SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
    WHERE has_function_privilege(r, 'public._log_event(public.event_action,public.event_entity,uuid,text,text,text[],jsonb,boolean,text,uuid)', 'EXECUTE')),
  NULL, 'DT-13: _log_event só para postgres (a chave secreta não cria evento por /rpc)');

-- ===========================================================================
-- 4. Privilégios das funções e das views — 8
-- ===========================================================================
SELECT is(
  (SELECT array_agg(p.oid::regprocedure::text || ' → ' || r ORDER BY p.oid::regprocedure::text, r)
     FROM pg_proc p
    CROSS JOIN unnest(ARRAY['anon', 'authenticated', 'service_role']) r
    WHERE p.pronamespace = 'private'::regnamespace
      AND (p.proname LIKE 'audit\_%' OR p.proname IN ('current_actor', 'stamp_authorship', 'legacy_authorship'))
      AND has_function_privilege(r, p.oid, 'EXECUTE')),
  NULL, 'as funções private do passo sem EXECUTE para anon, authenticated e service_role');
SELECT cmp_ok((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'private'::regnamespace
                AND (p.proname LIKE 'audit\_%' OR p.proname IN ('current_actor', 'stamp_authorship', 'legacy_authorship'))),
  '>=', 25, 'a lista das private do passo não está vazia (o teste acima confere alguma coisa)');
SELECT is(
  (SELECT array_agg(f ORDER BY f) FROM unnest(ARRAY['public.save_cell_report(uuid,jsonb,uuid[])',
                                                    'public.audit_record_label(public.event_entity,uuid)',
                                                    'public.audit_assert_access()', 'public.legacy_author_label(text)']) f
    WHERE has_function_privilege('anon', f, 'EXECUTE') OR NOT has_function_privilege('authenticated', f, 'EXECUTE')),
  NULL, 'as públicas novas: EXECUTE para authenticated, nada para anon');
SELECT is(
  (SELECT array_agg(f ORDER BY f) FROM unnest(ARRAY['public.audit_record_label(public.event_entity,uuid)',
                                                    'public.audit_assert_access()']) f
    WHERE has_function_privilege('service_role', f, 'EXECUTE')),
  NULL, 'as RPCs novas são só da sessão do usuário (sem service_role; a save_cell_report passou a ter no E2.11, RN-01)');
SELECT is(
  (SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
    WHERE p.pronamespace = 'private'::regnamespace
      AND p.proname IN ('stamp_authorship', 'audit_record_change', 'audit_participant_change', 'audit_role_change',
                        'audit_role_delete', 'audit_role_permission_change', 'audit_write')
      AND p.prosrc ~* 'WHEN\s+OTHERS'),
  NULL, 'DT-07/RN-14: nenhum trigger de dados nem a escrita do evento engole erro (sem EXCEPTION WHEN OTHERS)');
SELECT is((SELECT reloptions FROM pg_class WHERE oid = 'public.events_view'::regclass), ARRAY['security_invoker=false'],
  'DT-25: events_view é security definer, sem security_barrier (o portão é audit_assert_access; os filtros usam os índices)');
SELECT ok(has_table_privilege('authenticated', 'public.events_view', 'SELECT')
          AND NOT has_table_privilege('authenticated', 'public.events_view', 'INSERT')
          AND NOT has_table_privilege('anon', 'public.events_view', 'SELECT'),
  'events_view: só SELECT para authenticated, nada para anon');
SELECT is(pg_temp.cols('public.events_view'),
  ARRAY['id', 'occurred_at', 'occurred_on', 'seq', 'actor_kind', 'actor_label', 'action', 'entity', 'entity_id',
        'entity_label', 'description', 'changed_fields', 'changes', 'metadata', 'success', 'error_reason', 'search_text'],
  'AQ-2: as colunas da events_view, sem actor_user_id');

-- ===========================================================================
-- 5. Triggers e views (DT-02, DT-05, AQ-1) — 9
-- ===========================================================================
SELECT is(
  (SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN ('trg_log_member_event', 'trg_log_cell_event', 'trg_log_cell_report_event',
                                          'trg_log_cell_report_participant_event', 'update_members_updated_at',
                                          'update_cell_reports_updated_at')),
  NULL, 'saem os triggers antigos de Auditoria e de updated_at de membros e relatórios');
SELECT ok(EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.roles'::regclass AND tgname = 'update_roles_updated_at'),
  'o update_roles_updated_at fica (versão da função para a save_role)');
SELECT is(
  (SELECT array_agg(tgrelid::regclass::text || '.' || tgname ORDER BY tgrelid::regclass::text || '.' || tgname) FROM pg_trigger
    WHERE NOT tgisinternal AND tgname IN ('zz_stamp_authorship', 'aa_audit_record', 'aa_audit_participant', 'aa_audit_role',
                                          'zz_audit_role_delete', 'aa_audit_role_permission')),
  ARRAY['cell_report_participants.aa_audit_participant', 'cell_reports.aa_audit_record', 'cell_reports.zz_stamp_authorship',
        'cells.aa_audit_record', 'cells.zz_stamp_authorship', 'members.aa_audit_record', 'members.zz_stamp_authorship',
        'role_permissions.aa_audit_role_permission', 'roles.aa_audit_role', 'roles.zz_audit_role_delete'],
  'os triggers novos nas seis tabelas');
SELECT is(
  (SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c
    WHERE c.relname IN ('members', 'cells', 'cell_reports') AND c.relnamespace = 'public'::regnamespace
      AND (SELECT t.tgname FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
              AND (t.tgtype & 2) = 2 AND (t.tgtype & 1) = 1      -- BEFORE ... FOR EACH ROW
            ORDER BY t.tgname DESC LIMIT 1) = 'zz_stamp_authorship'),
  ARRAY['cell_reports', 'cells', 'members'],
  'DT-05: o carimbo é o último BEFORE de cada tabela (compara o valor final, já normalizado)');
SELECT is((pg_temp.cols('public.members_view'))[array_length(pg_temp.cols('public.members_view'), 1) - 5 : array_length(pg_temp.cols('public.members_view'), 1) - 2],
  ARRAY['created_by_kind', 'created_by_name', 'updated_by_kind', 'updated_by_name'], 'AQ-1: members_view com a autoria no fim (antes das duas colunas do E2.07)');
SELECT is((pg_temp.cols('public.cells_view'))[array_length(pg_temp.cols('public.cells_view'), 1) - 3 :],
  ARRAY['created_by_kind', 'created_by_name', 'updated_by_kind', 'updated_by_name'], 'AQ-1: cells_view com a autoria no fim');
SELECT is((pg_temp.cols('public.cell_reports_view'))[array_length(pg_temp.cols('public.cell_reports_view'), 1) - 14 : array_length(pg_temp.cols('public.cell_reports_view'), 1) - 11],
  ARRAY['created_by_kind', 'created_by_name', 'updated_by_kind', 'updated_by_name'], 'AQ-1: cell_reports_view com a autoria no fim (antes das onze colunas do retrato do E2.11)');
SELECT is(
  (SELECT array_agg(v ORDER BY v) FROM unnest(ARRAY['public.members_deleted_view', 'public.cells_deleted_view', 'public.cell_reports_deleted_view']) v
    WHERE (pg_temp.cols(v))[array_length(pg_temp.cols(v), 1)] <> 'deleted_by_kind'),
  NULL, 'RN-11: as três views de excluídos com deleted_by_kind no fim');
SELECT is(
  (SELECT array_agg(v ORDER BY v) FROM unnest(ARRAY['public.members_view', 'public.cells_view', 'public.cell_reports_view',
                                                    'public.members_deleted_view', 'public.cells_deleted_view',
                                                    'public.cell_reports_deleted_view']) v
    WHERE 'created_by' = ANY (pg_temp.cols(v)) OR 'updated_by' = ANY (pg_temp.cols(v))),
  NULL, 'DA-11/RN-08: nenhuma view expõe o id do autor do cadastro ou da alteração');

-- ===========================================================================
-- 6. Prazo de guarda (RN-17, DT-14) — 2
-- ===========================================================================
SELECT is((SELECT schedule FROM cron.job WHERE jobname = 'e205-audit-retention'), '20 6 * * *',
  'RN-17: o job e205-audit-retention roda todo dia às 06:20 UTC (03:20 de Brasília)');
SELECT is((SELECT command FROM cron.job WHERE jobname = 'e205-audit-retention'), 'SELECT private.audit_purge()',
  'RN-17: o job chama private.audit_purge()');

SELECT * FROM finish();
ROLLBACK;
