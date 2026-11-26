-- E2.08 (PR 1): a célula inativa não recebe relatório novo.
-- Spec: docs/specs/e2-08-cadastro-celulas.md (repositório apps-mci),
-- "Célula inativa e relatório (migration 1)" e "Verificações obrigatórias
-- (para o QA)", PR 1; RN-01, RN-11 (c) e (d), RN-14; DA-5 a DA-7; DT-06, DT-07.
--
-- Cobre:
--   - estrutura: o trigger ac_enforce_cell_report_active (BEFORE INSERT OR
--     UPDATE OF cell_id), a função definer sem EXECUTE para anon e
--     authenticated, a ordem dos triggers BEFORE e a cells_view com as mesmas
--     colunas, na mesma ordem;
--   - RN-11 (c): Carla, Pedro, a service role e o postgres recebem
--     cell_inactive (código, mensagem e cell_id, sem field); em replica a carga
--     passa; passar para C1 inativa um relatório de C2 é recusado;
--   - RN-11 (d), DA-5, DA-6: editar, excluir, restaurar e mexer nos
--     participantes de relatório de C1 inativa são aceitos;
--   - DA-7: sem permissão de lançar, 42501; quem não vê C1,
--     not_found_or_deleted; quem vê e não tem o direito,
--     report_submit_not_allowed;
--   - cells_view.can_submit_report falso para C1 inativa e igual a
--     "is_active AND can_submit_report(id)" para todas as pessoas (DT-07);
--     my_access().can_submit_some_report de Carla;
--   - reativada, C1 volta a aceitar.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Ids fictícios (usuário do Auth, membro, célula, relatório).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2080000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- Executa _sql e devolve estado, linhas, código de regra, mensagem e detalhe.
-- _as: número do membro (authenticated), 'service_role' ou 'postgres'.
CREATE FUNCTION pg_temp.run_as(_as text, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text; _detail text; _hint text; _rows bigint;
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
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('state', '00000', 'code', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg, 'hint', nullif(_hint, ''),
      'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ELSE to_jsonb(nullif(_detail, '')) END,
      'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                   THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.run_as(_n::text, _sql) $$;
CREATE FUNCTION pg_temp.code(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.try(_n, _sql) ->> 'code' $$;

-- Valor escalar (texto) como o usuário n; erro vira 'ERR <estado>'.
CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RETURN 'ERR ' || _state;
  END;
END $$;

-- INSERT de relatório da semana atual na célula dada.
CREATE FUNCTION pg_temp.ins(_cell uuid) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format($i$INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme)
                   VALUES (%L, public.sp_today(), '23:59', true, 'tema')$i$, _cell) $$;

-- Paridade da coluna (DT-07): ids da cells_view com can_submit_report, contra
-- is_active AND can_submit_report(id), como o usuário n. Devolve '' se iguais.
CREATE FUNCTION pg_temp.submit_mismatch(_n int) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, $q$
    SELECT coalesce(string_agg(v.id::text, ',' ORDER BY v.id), '')
      FROM public.cells_view v
     WHERE v.id::text LIKE 'd2080000%'
       AND v.can_submit_report IS DISTINCT FROM (v.is_active AND public.can_submit_report(v.id))$q$) $$;

-- ---------------------------------------------------------------------------
-- Massa (a do E2.02, "Massa de exemplo", que o E2.08 usa): 17 pessoas, C1 e C2.
--   C1: líder André, timóteo Caio, anfitriã Carla (ministério de Pedro).
--   C2: líder Diego, timóteo Hugo, anfitrião Caio.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e208-' || n || '@teste.invalid' FROM generate_series(1, 17) n;

CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192084' || lpad(_n::text, 4, '0') $$;
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
 (pg_temp.m(17),'Ester Massa','F',false,NULL, false,pg_temp.u(17),pg_temp.role('Membro'),true, pg_temp.mob(17));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
 (pg_temp.c(1), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Quarta', '20:00'),
 (pg_temp.c(2), pg_temp.m(14), pg_temp.m(15), pg_temp.m(9), 'Evangelística', 'Quinta', '20:00');
-- R1: C1, semana passada (em replica, por causa da semana atual). R4: C2, esta
-- semana. R5: C1, esta semana, lançado antes da inativação (a 1ª das duas
-- chamadas do lançamento de hoje, leitura técnica 7).
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES
 (pg_temp.r(1), pg_temp.c(1), public.week_start(public.sp_today()) - 4, '20:00', true, 'R1');
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (pg_temp.r(1), pg_temp.m(9));
SET LOCAL session_replication_role = origin;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES
 (pg_temp.r(4), pg_temp.c(2), public.sp_today(), '23:59', true, 'R4'),
 (pg_temp.r(5), pg_temp.c(1), public.sp_today(), '23:59', true, 'R5');

SELECT plan(89);

-- ===========================================================================
-- Estrutura
-- ===========================================================================
SELECT has_trigger('public', 'cell_reports', 'ac_enforce_cell_report_active', 'o trigger ac_enforce_cell_report_active existe');
SELECT is((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
            WHERE t.tgrelid = 'public.cell_reports'::regclass AND t.tgname = 'ac_enforce_cell_report_active'),
  'CREATE TRIGGER ac_enforce_cell_report_active BEFORE INSERT OR UPDATE OF cell_id ON public.cell_reports FOR EACH ROW EXECUTE FUNCTION enforce_cell_report_active_cell()',
  'DT-06: BEFORE INSERT OR UPDATE OF cell_id, por linha');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'public.enforce_cell_report_active_cell()'::regprocedure), true,
  'a função é SECURITY DEFINER');
SELECT is((SELECT proconfig FROM pg_proc WHERE oid = 'public.enforce_cell_report_active_cell()'::regprocedure),
  ARRAY['search_path=public'], 'a função fixa o search_path');
SELECT is(has_function_privilege('authenticated', 'public.enforce_cell_report_active_cell()', 'EXECUTE'), false,
  'sem EXECUTE para authenticated');
SELECT is(has_function_privilege('anon', 'public.enforce_cell_report_active_cell()', 'EXECUTE'), false,
  'sem EXECUTE para anon');
SELECT is(
  (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
    WHERE t.tgrelid = 'public.cell_reports'::regclass AND NOT t.tgisinternal
      AND (t.tgtype & 2) <> 0                                   -- BEFORE
      AND t.tgname IN ('a0_check_insert_permission', 'aa_enforce_cell_report_rules', 'ab_enforce_cell_report_scope',
                       'ac_enforce_cell_report_active', 'enforce_cell_report_current_week_trigger',
                       'enforce_unique_weekly_cell_report_trigger')),
  ARRAY['a0_check_insert_permission', 'aa_enforce_cell_report_rules', 'ab_enforce_cell_report_scope',
        'ac_enforce_cell_report_active', 'enforce_cell_report_current_week_trigger',
        'enforce_unique_weekly_cell_report_trigger'],
  'RN-14, DA-7: ac_ dispara depois do ab_ (escopo) e antes dos triggers de semana');
SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attnum) FROM pg_attribute a
    WHERE a.attrelid = 'public.cells_view'::regclass AND a.attnum > 0 AND NOT a.attisdropped),
  ARRAY['id','leader_id','timothy_id','host_id','type','meeting_day','meeting_time','street','number','complement',
        'neighborhood','city','state','zip_code','is_active','created_at','updated_at','meeting_weekday','leader_name',
        'leader_gender','leader_g12_level','timothy_name','host_name','g12_leader_id','g12_leader_name',
        'last_report_date','search_text','can_submit_report','is_mine','leader_is_pastor',
        'report_status','report_missing_weeks'],
  'cells_view: as mesmas colunas, na mesma ordem (o E2.09 acrescenta duas no fim)');
SELECT is((SELECT reloptions FROM pg_class WHERE oid = 'public.cells_view'::regclass),
  ARRAY['security_barrier=true', 'security_invoker=false'], 'cells_view: security definer com security_barrier');
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.cells_view'::regclass), 'postgres',
  'cells_view: dona postgres');
SELECT is(has_table_privilege('anon', 'public.cells_view', 'SELECT'), false, 'cells_view: sem SELECT para anon');
SELECT is(
  ARRAY[has_table_privilege('authenticated', 'public.cells_view', 'SELECT'),
        has_table_privilege('authenticated', 'public.cells_view', 'INSERT'),
        has_table_privilege('authenticated', 'public.cells_view', 'UPDATE'),
        has_table_privilege('authenticated', 'public.cells_view', 'DELETE')],
  ARRAY[true, false, false, false], 'cells_view: só SELECT para authenticated');

-- Antes da inativação: Carla lança C1 pela view e pela função; a paridade vale.
SELECT is(pg_temp.val(12, format('SELECT can_submit_report::text FROM public.cells_view WHERE id = %L', pg_temp.c(1))), 'true',
  'C1 ativa: Carla (anfitriã) pode lançar');
SELECT is(pg_temp.val(12, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'true',
  'C1 ativa: o atalho "Novo relatório" aparece para Carla');

-- ===========================================================================
-- RN-11 (c): C1 inativa não recebe relatório novo
-- ===========================================================================
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(1);

CREATE TEMP TABLE res (k text PRIMARY KEY, v jsonb);
INSERT INTO res VALUES
  ('carla',   pg_temp.try(12, pg_temp.ins(pg_temp.c(1)))),
  ('pedro',   pg_temp.try(3,  pg_temp.ins(pg_temp.c(1)))),
  ('rita',    pg_temp.try(16, pg_temp.ins(pg_temp.c(1)))),
  ('service', pg_temp.run_as('service_role', pg_temp.ins(pg_temp.c(1)))),
  ('pg',      pg_temp.run_as('postgres', pg_temp.ins(pg_temp.c(1)))),
  ('move_pedro',   pg_temp.try(3, format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(1), pg_temp.r(4)))),
  ('move_service', pg_temp.run_as('service_role', format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(1), pg_temp.r(4)))),
  ('move_pg',      pg_temp.run_as('postgres', format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(1), pg_temp.r(4))));

SELECT is(v ->> 'code', 'cell_inactive', 'RN-11 (c): Carla (anfitriã) lança em C1 inativa: cell_inactive') FROM res WHERE k = 'carla';
SELECT is(v ->> 'state', '22023', 'RN-11 (c): a recusa é 22023 (regra), não 42501') FROM res WHERE k = 'carla';
SELECT is(v ->> 'hint', 'app_error', 'RN-11 (c): HINT app_error') FROM res WHERE k = 'carla';
SELECT is(v ->> 'message', 'Esta célula está inativa e não recebe relatórios.', 'RN-11 (c): a mensagem do spec') FROM res WHERE k = 'carla';
SELECT is(v -> 'detail', jsonb_build_object('code', 'cell_inactive', 'cell_id', pg_temp.c(1)),
  'RN-11 (c): o detalhe traz o código e o cell_id, sem field') FROM res WHERE k = 'carla';
SELECT is(v ->> 'code', 'cell_inactive', 'RN-11 (c): Pedro (Editar Célula) recebe cell_inactive') FROM res WHERE k = 'pedro';
SELECT is(v ->> 'code', 'cell_inactive', 'RN-11 (c): Rita (Administrador) recebe cell_inactive') FROM res WHERE k = 'rita';
SELECT is(v ->> 'code', 'cell_inactive', 'RN-01: a service role recebe cell_inactive') FROM res WHERE k = 'service';
SELECT is(v -> 'detail', jsonb_build_object('code', 'cell_inactive', 'cell_id', pg_temp.c(1)),
  'RN-01: a service role recebe o mesmo detalhe') FROM res WHERE k = 'service';
SELECT is(v ->> 'code', 'cell_inactive', 'RN-01: o postgres recebe cell_inactive') FROM res WHERE k = 'pg';
SELECT is((SELECT count(*)::int FROM public.cell_reports
            WHERE cell_id = pg_temp.c(1) AND public.week_start(date) = public.week_start(public.sp_today())), 1,
  'RN-11 (c): nada foi gravado (só o R5, lançado antes da inativação)');

SELECT is(v ->> 'code', 'cell_inactive', 'RN-11 (c): Pedro passa para C1 inativa um relatório de C2: cell_inactive') FROM res WHERE k = 'move_pedro';
SELECT is(v ->> 'code', 'cell_inactive', 'RN-11 (c): a service role, também') FROM res WHERE k = 'move_service';
SELECT is(v ->> 'code', 'cell_inactive', 'RN-11 (c): o postgres, também') FROM res WHERE k = 'move_pg';
SELECT is((SELECT cell_id FROM public.cell_reports WHERE id = pg_temp.r(4)), pg_temp.c(2), 'RN-11 (c): o relatório continua em C2');

-- Carga do legado: em replica, o trigger não roda e o relatório entra.
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme)
VALUES (pg_temp.r(9), pg_temp.c(1), public.week_start(public.sp_today()) - 14, '20:00', true, 'carga');
SET LOCAL session_replication_role = origin;
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE id = pg_temp.r(9)), 1,
  'RN-01: em replica (carga do legado), o relatório de célula inativa entra');

-- ===========================================================================
-- DA-7: as recusas de permissão e de escopo vêm antes; ninguém que não vê C1
-- descobre que ela está inativa.
-- ===========================================================================
SELECT is(pg_temp.code(15, pg_temp.ins(pg_temp.c(1))), '42501',
  'DA-7: Hugo, sem nenhuma permissão de lançar: 42501, não cell_inactive');
SELECT is(pg_temp.code(14, pg_temp.ins(pg_temp.c(1))), 'not_found_or_deleted',
  'DA-7: Diego (não vê C1): not_found_or_deleted, não cell_inactive');
SELECT is(pg_temp.code(10, pg_temp.ins(pg_temp.c(1))), 'report_submit_not_allowed',
  'DA-7: Fábio (vê C1, não é pessoa dela): report_submit_not_allowed, não cell_inactive');
SELECT is(pg_temp.code(14, format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(1), pg_temp.r(4))),
  'not_found_or_deleted', 'DA-7: Diego passa o relatório de C2 para C1 (que não vê): not_found_or_deleted');

-- ===========================================================================
-- RN-11 (d), DA-5, DA-6: o que já existe continua editável
-- ===========================================================================
SELECT is(pg_temp.try(3, format($s$UPDATE public.cell_reports SET theme = 'novo tema' WHERE id = %L$s$, pg_temp.r(1))),
  '{"state":"00000","code":"00000","rows":1}'::jsonb, 'RN-11 (d): Pedro muda o tema do relatório da semana passada de C1 inativa');
SELECT is(pg_temp.try(3, format($s$UPDATE public.cell_reports SET cell_id = %L, theme = 'outro' WHERE id = %L$s$, pg_temp.c(1), pg_temp.r(1))),
  '{"state":"00000","code":"00000","rows":1}'::jsonb, 'RN-11 (d): reenviar a mesma célula (cell_id sem mudança) é aceito');
SELECT is(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])', pg_temp.r(1), pg_temp.m(9), pg_temp.m(11))) ->> 'code',
  '00000', 'DA-6: Pedro inclui um participante no relatório de C1 inativa');
SELECT is(pg_temp.try(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(1), pg_temp.m(11))) ->> 'code',
  '00000', 'DA-6: Pedro retira um participante do relatório de C1 inativa');
SELECT is((SELECT array_agg(member_id) FROM public.cell_report_participants WHERE report_id = pg_temp.r(1)),
  ARRAY[pg_temp.m(11)], 'DA-6: os participantes ficaram como Pedro gravou');
SELECT is(pg_temp.try(12, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(5), pg_temp.m(7))) ->> 'code',
  '00000', 'DA-6: Carla grava os participantes do relatório desta semana, lançado antes da inativação');
SELECT is(pg_temp.try(3, format('SELECT public.delete_cell_report(%L)', pg_temp.r(1))) ->> 'code', '00000',
  'RN-11 (d): Pedro exclui o relatório de C1 inativa');
SELECT is(pg_temp.try(16, format('SELECT public.restore_cell_report(%L)', pg_temp.r(1))) ->> 'code', '00000',
  'DA-5: Rita restaura o relatório de C1 inativa (restaurar não é lançar)');
SELECT is((SELECT deleted_at IS NULL FROM public.cell_reports WHERE id = pg_temp.r(1)), true, 'DA-5: o relatório voltou');

-- ===========================================================================
-- cells_view.can_submit_report e my_access (DT-07, AQ-7)
-- ===========================================================================
SELECT is(pg_temp.val(n, format('SELECT can_submit_report::text FROM public.cells_view WHERE id = %L', pg_temp.c(1))), 'false',
  'C1 inativa: can_submit_report falso na cells_view para o usuário ' || n)
  FROM unnest(ARRAY[3, 7, 9, 12, 16]) n ORDER BY n;
SELECT is(pg_temp.val(12, format('SELECT public.can_submit_report(%L)::text', pg_temp.c(1))), 'true',
  'DT-07: can_submit_report(id) continua sendo só o direito de lançar (Carla)');
SELECT is(pg_temp.submit_mismatch(n), '', 'DT-07: cells_view.can_submit_report = is_active AND can_submit_report(id), usuário ' || n)
  FROM generate_series(1, 17) n ORDER BY n;
SELECT is(pg_temp.val(12, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'false',
  'RN-11 (c): só com C1 inativa, o atalho "Novo relatório" some para Carla');
SELECT is(pg_temp.val(9, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'true',
  'RN-11 (c): Caio continua com o atalho (anfitrião de C2, ativa)');

-- ===========================================================================
-- Reativada, C1 volta a aceitar
-- ===========================================================================
SELECT is(pg_temp.try(3, format('SELECT public.delete_cell_report(%L)', pg_temp.r(5))) ->> 'code', '00000',
  'preparação: Pedro exclui o R5 (libera a semana de C1)');
UPDATE public.cells SET is_active = true WHERE id = pg_temp.c(1);
SELECT is(pg_temp.try(12, pg_temp.ins(pg_temp.c(1))), '{"state":"00000","code":"00000","rows":1}'::jsonb,
  'RN-11: reativada, C1 aceita o relatório de Carla');
SELECT is(pg_temp.val(12, format('SELECT can_submit_report::text FROM public.cells_view WHERE id = %L', pg_temp.c(1))), 'true',
  'RN-11: reativada, a cells_view volta a dizer que Carla lança C1');
SELECT is(pg_temp.val(12, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'true',
  'RN-11: reativada, o atalho volta para Carla');
SELECT is(pg_temp.submit_mismatch(n), '', 'DT-07 (reativada): paridade da coluna, usuário ' || n)
  FROM generate_series(1, 17) n ORDER BY n;

SELECT * FROM finish();
ROLLBACK;
