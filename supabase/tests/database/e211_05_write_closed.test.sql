-- E2.11 (PR 2): a escrita direta fechada e a conferência antes de preencher.
-- Spec: docs/specs/e2-11-lancamento-relatorio.md (repositório apps-mci), "Fim da escrita direta",
-- "Conferência antes de preencher e contexto da edição (migration 2)" e "Verificações obrigatórias (para o
-- QA)", PR 2; RN-01, RN-13, RN-18, RN-19; DA-5, DA-7, DA-8, DA-10, DA-11; DT-10, DT-11, DT-13, DT-15.
--
-- Cobre: os privilégios e as políticas (RN-01); a guarda para o próprio banco e a marca de manutenção
-- (DA-11), com a exclusão e a restauração do E2.01 passando; o que saiu e o que entrou no catálogo, a
-- ordem dos triggers e os grants; a oferta sem padrão e com CHECK (também em replica); a conferência
-- antes de preencher por persona, com o relatório da semana só para quem o vê.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Ids fictícios e utilitários.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2110500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2110500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2110500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2110500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.ws(_weeks_ago int DEFAULT 0) RETURNS date LANGUAGE sql STABLE AS
$$ SELECT public.week_start(public.sp_today()) - 7 * _weeks_ago $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192115' || lpad(_n::text, 4, '0') $$;

-- Executa _sql (SELECT) como _as (número do membro, 'service_role' ou 'postgres') e devolve as linhas
-- ({"code": "ok", "rows": [...]}) ou a recusa ({"code", "state", "message", "detail"}). A troca de papel
-- e de sessão é desfeita com a subtransação.
CREATE FUNCTION pg_temp.rpc(_as text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _msg text; _detail text; _hint text;
BEGIN
  BEGIN
    IF _as = 'service_role' THEN
      PERFORM set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
      EXECUTE 'SET LOCAL ROLE service_role';
    ELSIF _as <> 'postgres' THEN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', pg_temp.u(_as::int), 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) FROM (' || _sql || ') t' INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('code', 'ok', 'rows', _out);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg,
      'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ELSE to_jsonb(nullif(_detail, '')) END,
      'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                   THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
-- Executa um comando qualquer como o papel atual e devolve 'ok', o código do app_error ou o SQLSTATE.
CREATE FUNCTION pg_temp.exec_code(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _d text; _s text;
BEGIN
  EXECUTE _sql;
  RETURN 'ok';
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS _d = PG_EXCEPTION_DETAIL, _s = RETURNED_SQLSTATE;
  RETURN coalesce(CASE WHEN _d LIKE '{%' THEN _d::jsonb ->> 'code' END, _s);
END $$;
-- Lançamento e edição pelas RPCs.
CREATE FUNCTION pg_temp.sub(_as text, _id uuid, _r jsonb, _p uuid[] DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.rpc(_as, format('SELECT * FROM public.submit_cell_report(%L, %L::jsonb, %L::uuid[])', _id, _r, _p)) $$;
CREATE FUNCTION pg_temp.save(_as text, _id uuid, _r jsonb, _p uuid[] DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.rpc(_as, format('SELECT * FROM public.save_cell_report(%L, %L::jsonb, %L::uuid[])', _id, _r, _p)) $$;
-- Um relatório de célula realizada válido para a célula, nesta semana (domingo, 00:00).
CREATE FUNCTION pg_temp.held(_cell uuid, _extra jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT jsonb_build_object('cell_id', _cell, 'was_held', true, 'date', pg_temp.ws(), 'time', '00:00',
                             'theme', 'Tema da semana', 'offering', 10) || _extra $$;
-- Os participantes gravados (ordenados).
CREATE FUNCTION pg_temp.parts(_report uuid) RETURNS uuid[] LANGUAGE sql STABLE AS
$$ SELECT coalesce(array_agg(member_id ORDER BY member_id), '{}') FROM public.cell_report_participants WHERE report_id = _report $$;
CREATE FUNCTION pg_temp.ids(VARIADIC _n int[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS
$$ SELECT array_agg(pg_temp.m(x) ORDER BY pg_temp.m(x)) FROM unnest(_n) x $$;
-- Quantos eventos do relatório.
CREATE FUNCTION pg_temp.nev(_report uuid) RETURNS int LANGUAGE sql STABLE AS
$$ SELECT count(*)::int FROM public.events WHERE entity = 'cell_report' AND entity_id = _report $$;

-- ---------------------------------------------------------------------------
-- Massa (a do E2.02, "Massa de exemplo"), com as funções semeadas.
--   C1: líder André, timóteo Caio, anfitriã Carla; domingo, 00:00 (a reunião desta semana já passou).
--   C2: líder Diego, timóteo Hugo, anfitrião Caio; domingo, 00:00.
--   C3: como C1, no sábado às 23:59 (a reunião desta semana ainda não aconteceu).
--   C4: como C1, inativa. C5: como C1, excluída. C6: como C1, no domingo às 00:01. C7: como C1.
-- Pedro (Líder) vê André, Caio, Carla, Fábio e Gabriel; não vê Diego nem Hugo. Diego (Líder) não vê C1.
-- Fábio (Membro, inativo) vê C1, mas não é pessoa dela. Hugo não tem função. Bruno é excluído.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e211-05-' || n || '@teste.invalid' FROM generate_series(1, 18) n;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
 (pg_temp.m(1),'Samuel Massa','M',true,NULL, false,pg_temp.u(1),pg_temp.role('Líder'),true, pg_temp.mob(1)),
 (pg_temp.m(2),'Magda Massa','F',true,NULL, false,pg_temp.u(2),pg_temp.role('Líder'),true, pg_temp.mob(2)),
 (pg_temp.m(3),'Pedro Massa','M',false,pg_temp.m(1), true,pg_temp.u(3),pg_temp.role('Líder'),true, pg_temp.mob(3)),
 (pg_temp.m(4),'Paula Massa','F',false,pg_temp.m(2), true,pg_temp.u(4),pg_temp.role('Líder'),true, pg_temp.mob(4)),
 (pg_temp.m(5),'Tiago Massa','M',false,pg_temp.m(1), true,pg_temp.u(5),NULL,true, pg_temp.mob(5)),
 (pg_temp.m(6),'Tania Massa','F',false,pg_temp.m(2), true,pg_temp.u(6),NULL,true, pg_temp.mob(6)),
 (pg_temp.m(7),'Andre Massa','M',false,pg_temp.m(3), true,pg_temp.u(7),pg_temp.role('Líder'),true, pg_temp.mob(7)),
 (pg_temp.m(8),'Beatriz Massa','F',false,pg_temp.m(6), true,pg_temp.u(8),pg_temp.role('Membro'),true, pg_temp.mob(8)),
 (pg_temp.m(9),'Caio Massa','M',false,pg_temp.m(7), true,pg_temp.u(9),pg_temp.role('Membro'),true, pg_temp.mob(9)),
 (pg_temp.m(10),'Fabio Massa','M',false,pg_temp.m(7), true,pg_temp.u(10),pg_temp.role('Membro'),false, pg_temp.mob(10)),
 (pg_temp.m(11),'Gabriel Massa','M',false,pg_temp.m(10), true,pg_temp.u(11),NULL,true, pg_temp.mob(11)),
 (pg_temp.m(12),'Carla Massa','F',false,pg_temp.m(4), true,pg_temp.u(12),pg_temp.role('Membro'),true, pg_temp.mob(12)),
 (pg_temp.m(13),'Debora Massa','F',false,pg_temp.m(8), true,pg_temp.u(13),NULL,true, pg_temp.mob(13)),
 (pg_temp.m(14),'Diego Massa','M',false,pg_temp.m(5), true,pg_temp.u(14),pg_temp.role('Líder'),true, pg_temp.mob(14)),
 (pg_temp.m(15),'Hugo Massa','M',false,pg_temp.m(5), true,pg_temp.u(15),NULL,true, pg_temp.mob(15)),
 (pg_temp.m(16),'Rita Massa','F',false,pg_temp.m(6), true,pg_temp.u(16),pg_temp.role('Administrador'),true, pg_temp.mob(16)),
 (pg_temp.m(17),'Ester Massa','F',false,NULL, false,pg_temp.u(17),pg_temp.role('Membro'),true, pg_temp.mob(17)),
 (pg_temp.m(18),'Bruno Massa','M',false,pg_temp.m(7), true,pg_temp.u(18),pg_temp.role('Membro'),true, pg_temp.mob(18));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
 (pg_temp.c(1), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Domingo', '00:00'),
 (pg_temp.c(2), pg_temp.m(14), pg_temp.m(15), pg_temp.m(9), 'Discipulado', 'Domingo', '00:00'),
 (pg_temp.c(3), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Sábado', '23:59'),
 (pg_temp.c(4), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Domingo', '00:00'),
 (pg_temp.c(5), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Domingo', '00:00'),
 (pg_temp.c(6), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Macrocélula', 'Domingo', '00:01'),
 (pg_temp.c(7), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Domingo', '00:00');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(4);
UPDATE public.cells SET deleted_at = now() WHERE id = pg_temp.c(5);
UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(18);

SELECT plan(77);

-- Um relatório desta semana em C1, lançado por Pedro, e um da semana passada em C2 (manutenção).
SELECT is(pg_temp.sub('3', pg_temp.r(1), pg_temp.held(pg_temp.c(1))) ->> 'code', 'ok', 'preparação: Pedro lança C1');
SET LOCAL mci.cell_report_write = 'on';
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, offering)
VALUES (pg_temp.r(2), pg_temp.c(2), pg_temp.ws(1), '00:00', true, 'Semana passada', 0);
SET LOCAL session_replication_role = origin;
SET LOCAL mci.cell_report_write = '';

-- ===========================================================================
-- 1. RN-01: privilégios e políticas
-- ===========================================================================
SELECT ok(NOT has_table_privilege(g, 'public.cell_reports', p), g || ': sem ' || p || ' em cell_reports')
  FROM unnest(ARRAY['authenticated', 'service_role', 'anon']) g, unnest(ARRAY['INSERT', 'UPDATE', 'TRUNCATE']) p;
SELECT ok(NOT has_table_privilege(g, 'public.cell_report_participants', p), g || ': sem ' || p || ' em cell_report_participants')
  FROM unnest(ARRAY['authenticated', 'service_role', 'anon']) g, unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p;
SELECT ok(has_table_privilege('authenticated', t, 'SELECT'), 'authenticated continua lendo ' || t)
  FROM unnest(ARRAY['public.cell_reports', 'public.cell_report_participants']) t;
SELECT is_empty($$SELECT policyname FROM pg_policies WHERE schemaname = 'public'
                   AND tablename IN ('cell_reports', 'cell_report_participants') AND cmd <> 'SELECT'$$,
  'RN-01: nenhuma política de escrita em relatórios e participantes');
SELECT is(pg_temp.exec_code(format($q$SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claims', %L, true);
            INSERT INTO public.cell_reports (cell_id, date, time, theme, offering) VALUES (%L, %L, '00:00', 'Direto', 0)$q$,
          json_build_object('sub', pg_temp.u(16), 'role', 'authenticated'), pg_temp.c(7), pg_temp.ws())), '42501',
  'RN-01: Rita (Administradora) não insere relatório direto (42501 de privilégio)');
RESET ROLE;
SELECT is(pg_temp.exec_code(format($q$SET LOCAL ROLE authenticated;
            UPDATE public.cell_reports SET theme = 'Direto' WHERE id = %L$q$, pg_temp.r(1))), '42501',
  'RN-01: nem atualiza');
RESET ROLE;
SELECT is(pg_temp.exec_code(format($q$SET LOCAL ROLE service_role;
            DELETE FROM public.cell_report_participants WHERE report_id = %L$q$, pg_temp.r(1))), '42501',
  'RN-01: a service role não retira participante direto');
RESET ROLE;
SELECT is(pg_temp.exec_code(format($q$SET LOCAL ROLE service_role;
            INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (%L, %L)$q$, pg_temp.r(1), pg_temp.m(10))), '42501',
  'RN-01: nem inclui');
RESET ROLE;

-- ===========================================================================
-- 2. DT-10 e DA-11: a guarda para o próprio banco
-- ===========================================================================
SELECT is(pg_temp.exec_code(format($q$INSERT INTO public.cell_reports (cell_id, date, time, theme, offering) VALUES (%L, %L, '00:00', 'Sem marca', 0)$q$,
                                   pg_temp.c(7), pg_temp.ws())), '42501',
  'DA-11: postgres sem a marca não insere');
SELECT throws_ok(format($q$UPDATE public.cell_reports SET theme = 'Sem marca' WHERE id = %L$q$, pg_temp.r(1)), '42501',
  'Relatórios e participantes só são gravados pelas RPCs submit_cell_report e save_cell_report.',
  'DA-11: nem atualiza, com a mensagem da guarda');
SELECT is(pg_temp.exec_code(format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L', pg_temp.r(1), pg_temp.m(9))),
  '42501', 'DA-11: nem retira participante (a guarda vem antes da barreira dos registrados)');
SELECT is(pg_temp.exec_code(format('UPDATE public.cell_report_participants SET member_id = %L WHERE report_id = %L', pg_temp.m(10), pg_temp.r(1))),
  '42501', 'DA-11: nem troca participante (UPDATE)');
SET LOCAL mci.cell_report_write = 'on';
SELECT is(pg_temp.exec_code(format($q$UPDATE public.cell_reports SET theme = 'Com marca' WHERE id = %L$q$, pg_temp.r(2))), 'ok',
  'DA-11: com a marca, a manutenção grava (relatório de semana passada)');
SELECT is(pg_temp.exec_code(format($q$UPDATE public.cell_reports SET date = %L WHERE id = %L$q$, pg_temp.ws() - 14, pg_temp.r(2))), 'ok',
  'DA-11: e dispensa as regras de data (os triggers de semana saíram)');
SELECT is(pg_temp.exec_code(format($q$UPDATE public.cell_reports SET cell_id = %L WHERE id = %L$q$, pg_temp.c(7), pg_temp.r(2))),
  'report_cell_immutable', 'DA-11: mas o retrato e a célula continuam fixos');
SELECT is(pg_temp.exec_code(format($q$UPDATE public.cell_reports SET offering = -1 WHERE id = %L$q$, pg_temp.r(2))), '23514',
  'DT-15: e o CHECK da oferta vale');
SET LOCAL mci.cell_report_write = '';
-- Excluir e restaurar (E2.01) não mudam o conteúdo e passam pela guarda.
SELECT is(pg_temp.rpc('16', format('SELECT public.delete_cell_report(%L)', pg_temp.r(1))) ->> 'code', 'ok',
  'RN-01 (b): delete_cell_report continua');
SELECT is(pg_temp.rpc('16', format('SELECT public.restore_cell_report(%L)', pg_temp.r(1))) ->> 'code', 'ok',
  'RN-01 (b): restore_cell_report continua (sem as regras de data)');
SELECT is((SELECT deleted_at FROM public.cell_reports WHERE id = pg_temp.r(1)), NULL, 'o relatório voltou');

-- ===========================================================================
-- 3. Catálogo: o que sai, o que entra, a ordem dos triggers e os grants
-- ===========================================================================
SELECT ok(to_regprocedure(f) IS NULL, f || ' saiu (DT-11)')
  FROM unnest(ARRAY['public.set_cell_report_participants(uuid,uuid[])', 'public.enforce_cell_report_current_week()',
                    'public.enforce_unique_weekly_cell_report()', 'public.enforce_cell_report_scope()',
                    'public.enforce_participant_scope()', 'public.viewer_can_insert_cell_report(uuid)',
                    'public.viewer_can_insert_cell_report_participant(uuid)']) f;
SELECT is((SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
            WHERE tgrelid = 'public.cell_reports'::regclass AND NOT tgisinternal AND (tgtype & 2) = 2),
  ARRAY['a0_guard_cell_report_write', 'aa_enforce_cell_report_rules', 'ac_enforce_cell_report_active',
        'ad_cell_report_snapshot', 'zz_stamp_authorship'],
  'cell_reports: a guarda é o primeiro BEFORE; saíram o a0_check, o ab_ e os de semana');
SELECT is((SELECT array_agg(tgname::text ORDER BY tgname) FROM pg_trigger
            WHERE tgrelid = 'public.cell_report_participants'::regclass AND NOT tgisinternal AND (tgtype & 2) = 2),
  ARRAY['a0_guard_cell_report_write', 'aa_enforce_participant_rules', 'ac_keep_snapshot_participants'],
  'participantes: guarda → excluído → registrados');
SELECT is((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.cell_report_participants'::regclass
            AND tgname = 'a0_guard_cell_report_write'),
  'CREATE TRIGGER a0_guard_cell_report_write BEFORE INSERT OR DELETE OR UPDATE ON public.cell_report_participants FOR EACH ROW EXECUTE FUNCTION guard_cell_report_write()',
  'a guarda dos participantes cobre INSERT, UPDATE e DELETE');
SELECT ok((SELECT NOT prosecdef FROM pg_proc WHERE oid = 'public.guard_cell_report_write()'::regprocedure)
          AND (SELECT prosecdef FROM pg_proc WHERE oid = 'public.keep_snapshot_participants()'::regprocedure),
  'a guarda é invoker; a barreira dos registrados é definer');
SELECT ok(NOT has_function_privilege(g, f, 'EXECUTE'), g || ' sem EXECUTE em ' || f)
  FROM unnest(ARRAY['anon', 'authenticated']) g,
       unnest(ARRAY['public.guard_cell_report_write()', 'public.keep_snapshot_participants()']) f;
SELECT is((SELECT array_agg(p.oid::regprocedure::text ORDER BY p.oid::regprocedure::text)
             FROM pg_proc p
            WHERE p.pronamespace = 'private'::regnamespace AND p.proname LIKE 'report\_%'
              AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                   OR has_function_privilege('service_role', p.oid, 'EXECUTE'))), NULL,
  'as funções private.report_* não têm EXECUTE para a API');
SELECT cmp_ok((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'private'::regnamespace AND proname LIKE 'report\_%'), '>=', 15,
  'a lista das private.report_* não está vazia');
SELECT ok((SELECT bool_and(prosecdef AND proconfig @> ARRAY['search_path=public']
                           AND has_function_privilege('authenticated', oid, 'EXECUTE')
                           AND has_function_privilege('service_role', oid, 'EXECUTE')
                           AND NOT has_function_privilege('anon', oid, 'EXECUTE'))
             FROM pg_proc WHERE oid IN ('public.cell_report_launch_check(uuid)'::regprocedure,
                                        'public.cell_report_edit_context(uuid)'::regprocedure)),
  'DT-13: as leituras são definer, com search_path, para authenticated e service_role, não anon');
SELECT is((SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cell_reports'
            AND column_name = 'offering'), NULL, 'DT-15: a oferta não tem padrão');
SELECT is((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'cell_reports_offering_check'),
  'CHECK (((offering IS NULL) OR ((offering >= (0)::numeric) AND (offering <= 999999.99))))', 'DT-15/DA-5: o CHECK da oferta');
SET LOCAL session_replication_role = replica;
SELECT is(pg_temp.exec_code(format($q$UPDATE public.cell_reports SET offering = 1000000 WHERE id = %L$q$, pg_temp.r(2))), '23514',
  'DA-5: o CHECK da oferta vale também na carga (replica)');
SET LOCAL session_replication_role = origin;
SELECT is(enum_range(NULL::public.report_launch_status)::text,
  '{can_submit,already_sent,not_yet,cell_inactive,cell_deleted,not_found,not_allowed,no_permission}', 'report_launch_status');

-- ===========================================================================
-- 4. Conferência antes de preencher (RN-19, DA-8, DA-10, DT-13)
-- ===========================================================================
CREATE FUNCTION pg_temp.check(_as text, _cell uuid) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.rpc(_as, format('SELECT * FROM public.cell_report_launch_check(%L)', _cell)) -> 'rows' -> 0 $$;
SELECT is(pg_temp.check('15', pg_temp.c(1)) ->> 'status', 'no_permission', 'RN-19: Hugo, sem permissão de lançar');
SELECT is(pg_temp.check('14', pg_temp.c(1)) ->> 'status', 'not_found', 'RN-19: Diego não vê C1');
SELECT is(pg_temp.check('14', pg_temp.c(5)) ->> 'status', 'not_found', 'DA-7: nem a excluída C5');
SELECT is(pg_temp.check('3', pg_temp.c(5)) ->> 'status', 'cell_deleted', 'RN-19 (c): Pedro, C5 excluída');
SELECT is(pg_temp.check('10', pg_temp.c(1)) ->> 'status', 'not_allowed', 'RN-19: Fábio, sem direito em C1');
SELECT is(pg_temp.check('3', pg_temp.c(4)) ->> 'status', 'cell_inactive', 'RN-19 (c): C4 inativa');
SELECT is(pg_temp.check('3', pg_temp.c(3)) - 'server_now',
  jsonb_build_object('status', 'not_yet', 'today', public.sp_today(), 'week_start', pg_temp.ws(), 'week_end', pg_temp.ws() + 6,
                     'meeting_date', pg_temp.ws() + 6, 'meeting_time', '23:59:00', 'allowed_dates', NULL,
                     'existing_report_id', NULL, 'existing_date', NULL, 'existing_time', NULL, 'existing_was_held', NULL,
                     'existing_can_edit', NULL),
  'RN-19 (b): C3, a reunião desta semana ainda não aconteceu, com a reunião');
SELECT is(pg_temp.check('3', pg_temp.c(7)) - 'server_now',
  jsonb_build_object('status', 'can_submit', 'today', public.sp_today(), 'week_start', pg_temp.ws(), 'week_end', pg_temp.ws() + 6,
                     'meeting_date', pg_temp.ws(), 'meeting_time', '00:00:00',
                     'allowed_dates', (SELECT jsonb_agg(d::date ORDER BY d) FROM generate_series(pg_temp.ws(), public.sp_today(), interval '1 day') d),
                     'existing_report_id', NULL, 'existing_date', NULL, 'existing_time', NULL, 'existing_was_held', NULL,
                     'existing_can_edit', NULL),
  'RN-18: C7, pode lançar, com as datas da reunião até hoje');
SELECT is(pg_temp.check('12', pg_temp.c(1)) - 'server_now' - 'today' - 'week_start' - 'week_end' - 'allowed_dates',
  jsonb_build_object('status', 'already_sent', 'meeting_date', pg_temp.ws(), 'meeting_time', '00:00:00',
                     'existing_report_id', pg_temp.r(1), 'existing_date', pg_temp.ws(), 'existing_time', '00:00:00',
                     'existing_was_held', true, 'existing_can_edit', false),
  'RN-19 (a)/DA-10: Carla vê qual é o relatório da semana, sem "pode editar"');
SELECT is(pg_temp.check('7', pg_temp.c(1)) ->> 'existing_can_edit', 'true', 'DA-10: André pode editar');
UPDATE public.cells SET leader_id = pg_temp.m(14), timothy_id = pg_temp.m(15), host_id = pg_temp.m(9) WHERE id = pg_temp.c(1);
SELECT is(pg_temp.check('14', pg_temp.c(1)) - 'server_now' - 'today' - 'week_start' - 'week_end' - 'allowed_dates',
  jsonb_build_object('status', 'already_sent', 'meeting_date', pg_temp.ws(), 'meeting_time', '00:00:00',
                     'existing_report_id', NULL, 'existing_date', NULL, 'existing_time', NULL,
                     'existing_was_held', NULL, 'existing_can_edit', NULL),
  'DA-10: Diego (agora líder de C1) não vê o relatório (retrato de André): só "já foi enviado"');
SELECT is(pg_temp.check('service_role', pg_temp.c(1)) ->> 'existing_report_id', pg_temp.r(1)::text,
  'RN-01: a service role recebe o relatório da semana');
SELECT ok(abs(extract(epoch FROM ((pg_temp.check('3', pg_temp.c(7)) ->> 'server_now')::timestamptz - now()))) < 1,
  'AQ-6: server_now é o "agora" do servidor');

-- ===========================================================================
-- 5. Invariantes
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE snapshot_leader_id IS NULL OR snapshot_timothy_id IS NULL
            OR snapshot_host_id IS NULL OR snapshot_cell_type IS NULL), 0, 'nenhum relatório sem retrato');
SELECT is((SELECT count(*)::int FROM (SELECT cell_id, public.week_start(date) FROM public.cell_reports WHERE deleted_at IS NULL
            GROUP BY 1, 2 HAVING count(*) > 1) d), 0, 'nenhuma célula com dois relatórios não excluídos na mesma semana');

SELECT * FROM finish();
ROLLBACK;
