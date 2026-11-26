-- E2.09 (PR 1): histórico dos períodos ativos da célula (migration 1, e209_01_active_periods).
-- Spec: docs/specs/e2-09-situacao-relatorio.md (repositório apps-mci), "Histórico dos períodos ativos
-- (migration 1)", "Privilégios", "Bloqueios e concorrência", "Verificações obrigatórias (para o QA)"
-- (e209_01); RN-06, RN-10; DA-2 a DA-5; DT-03, DT-04.
--
-- Cobre:
--   - estrutura: a tabela em private, PK, FK em cascata, RLS sem políticas, sem privilégio para os
--     papéis da API; o trigger AFTER INSERT OR UPDATE OF is_active, deleted_at; a função de trigger
--     definer com search_path fixo e sem EXECUTE para authenticated; sem USAGE em private para a API;
--   - o trigger: cadastro abre [agora, ∞); inativar fecha em agora; reativar abre um período novo;
--     inativar e reativar na mesma transação não deixam buraco; delete_cell fecha; restore_cell reabre a
--     ativa e não reabre a inativa; outra coluna, ou is_active com o mesmo valor, não muda nada. O
--     cadastro inativo não existe desde o E2.08 (cell_new_inactive): a recusa não deixa linha;
--   - RN-06 pela API: authenticated não lê nem grava a tabela; created_at no passado (no cadastro ou
--     depois) não muda o histórico;
--   - Auditoria: inativar gera o mesmo evento de antes e nenhum da tabela nova; o trigger não grava em
--     cells (uma só versão nova da linha);
--   - backfill: ativa, inativa, excluída quando ativa, excluída quando inativa, excluída antes do
--     cadastro; segunda chamada cria 0 linhas e não muda nada;
--   - replica: a célula sem linha aparece como missing_row e o backfill corrige; período aberto em
--     célula inativa = open_but_not_counting; ativa com período fechado = not_open;
--   - invariante: cell_active_period_problems() vazia no fim.
-- (A reexecução da migration fica em supabase/tests/concurrency/e209_migrations.sh.)
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(44);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2090100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2090100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2090100-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192091' || lpad(_n::text, 4, '0') $$;

-- Executa _sql como o membro _n (authenticated); devolve '00000' ou o código (app_error ou SQLSTATE).
CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text; _detail text; _hint text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN '00000';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN CASE WHEN _hint = 'app_error' AND _detail LIKE '{%' THEN _detail::jsonb ->> 'code' ELSE _state END;
  END;
END $$;

CREATE FUNCTION pg_temp.periods(_cell uuid) RETURNS tstzmultirange LANGUAGE sql STABLE AS
$$ SELECT periods FROM private.cell_active_periods WHERE cell_id = _cell $$;
CREATE FUNCTION pg_temp.set_periods(_cell uuid, _p tstzmultirange) RETURNS void LANGUAGE sql AS
$$ UPDATE private.cell_active_periods SET periods = _p WHERE cell_id = _cell $$;
CREATE FUNCTION pg_temp.from_now() RETURNS tstzmultirange LANGUAGE sql STABLE AS
$$ SELECT tstzmultirange(tstzrange(now(), NULL)) $$;

-- ---------------------------------------------------------------------------
-- Massa: Samuel (pastor), Pedro (Líder, de Samuel), André (de Pedro), Caio e Carla (de André),
-- Rita (Administrador, de Samuel). Células K1 a K6 de André (timóteo Caio, anfitriã Carla).
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email) SELECT pg_temp.u(n), 'e2091-' || n || '@teste.invalid' FROM generate_series(1, 6) n;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1), 'Samuel Periodo', 'M', true,  NULL,          false, pg_temp.u(1), pg_temp.role('Líder'),         true, pg_temp.mob(1));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(2), 'Pedro Periodo',  'M', false, pg_temp.m(1), true, pg_temp.u(2), pg_temp.role('Líder'),         true, pg_temp.mob(2)),
  (pg_temp.m(6), 'Rita Periodo',   'F', false, pg_temp.m(1), true, pg_temp.u(6), pg_temp.role('Administrador'), true, pg_temp.mob(6));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(3), 'Andre Periodo',  'M', false, pg_temp.m(2), true, pg_temp.u(3), pg_temp.role('Líder'),         true, pg_temp.mob(3));
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(4), 'Caio Periodo',   'M', false, pg_temp.m(3), true, pg_temp.u(4), pg_temp.role('Membro'),        true, pg_temp.mob(4)),
  (pg_temp.m(5), 'Carla Periodo',  'F', false, pg_temp.m(3), true, pg_temp.u(5), pg_temp.role('Membro'),        true, pg_temp.mob(5));

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
SELECT pg_temp.c(n), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), 'Evangelística', 'Quarta', '20:00'
  FROM generate_series(1, 6) n;

-- ===========================================================================
-- 1. Estrutura e privilégios — 12
-- ===========================================================================
SELECT has_table('private', 'cell_active_periods', 'a tabela fica em private');
SELECT col_is_pk('private', 'cell_active_periods', 'cell_id', 'PK em cell_id: uma linha por célula');
SELECT is((SELECT confdeltype::text FROM pg_constraint
            WHERE conrelid = 'private.cell_active_periods'::regclass AND contype = 'f'
              AND confrelid = 'public.cells'::regclass), 'c', 'FK para cells com ON DELETE CASCADE');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.cell_active_periods'::regclass), 'RLS ligado');
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'private' AND tablename = 'cell_active_periods'),
  0, 'RLS sem políticas');
SELECT is((SELECT array_agg(r ORDER BY r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
            WHERE has_table_privilege(r, 'private.cell_active_periods', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  NULL, 'nenhum privilégio para anon, authenticated e service_role');
SELECT matches((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
                 WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'trg_cell_active_period'),
  'AFTER INSERT OR UPDATE OF is_active, deleted_at ON public\.cells FOR EACH ROW EXECUTE FUNCTION track_cell_active_period\(\)',
  'trg_cell_active_period: AFTER INSERT OR UPDATE OF is_active, deleted_at, por linha');
SELECT ok((SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
            WHERE oid = 'public.track_cell_active_period()'::regprocedure),
  'track_cell_active_period: security definer com search_path vazio');
SELECT ok(NOT has_function_privilege('authenticated', 'public.track_cell_active_period()', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.track_cell_active_period()', 'EXECUTE'),
  'track_cell_active_period: sem EXECUTE para anon e authenticated');
SELECT ok(NOT has_schema_privilege('anon', 'private', 'USAGE') AND NOT has_schema_privilege('authenticated', 'private', 'USAGE'),
  'risco 7: anon e authenticated sem USAGE em private');
SELECT is((SELECT array_agg(r || ':' || f ORDER BY r, f)
             FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
                  unnest(ARRAY['private.backfill_cell_active_periods()', 'private.cell_active_period_problems()']) f
            WHERE has_function_privilege(r, f, 'EXECUTE')),
  NULL, 'backfill e invariante sem EXECUTE para os papéis da API');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'private.cell_active_periods'::regclass AND NOT tgisinternal),
  0, 'a tabela não tem trigger (nem de Auditoria)');

-- ===========================================================================
-- 2. O trigger (RN-06; DA-2, DA-3) — 14
-- ===========================================================================
SELECT is(pg_temp.periods(pg_temp.c(1)), pg_temp.from_now(), 'cadastro ativo abre [agora, ∞)');

SELECT is(pg_temp.try(6, format($$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active)
                                  VALUES (%L, %L, %L, %L, 'Evangelística', 'Quarta', '20:00', false)$$,
                                 pg_temp.c(90), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5))),
  'cell_new_inactive', 'E2.08: o cadastro inativo é recusado ...');
SELECT is(pg_temp.periods(pg_temp.c(90)), NULL, '... e não deixa linha no histórico');

-- Inativar fecha em agora; gravar o mesmo valor ou outra coluna não muda nada.
SELECT pg_temp.set_periods(pg_temp.c(2), '{[2026-01-01 00:00-03,)}');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(2);
SELECT is(pg_temp.periods(pg_temp.c(2)), tstzmultirange(tstzrange('2026-01-01 00:00-03', now())), 'inativar fecha o período em agora');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(2);
SELECT is(pg_temp.periods(pg_temp.c(2)), tstzmultirange(tstzrange('2026-01-01 00:00-03', now())), 'gravar is_active com o mesmo valor não muda nada');
UPDATE public.cells SET meeting_time = '19:00' WHERE id = pg_temp.c(1);
SELECT is(pg_temp.periods(pg_temp.c(1)), pg_temp.from_now(), 'mudar outra coluna não muda nada');

-- Reativar abre um período novo.
SELECT pg_temp.set_periods(pg_temp.c(2), '{[2026-01-01 00:00-03,2026-02-01 00:00-03)}');
UPDATE public.cells SET is_active = true WHERE id = pg_temp.c(2);
SELECT is(pg_temp.periods(pg_temp.c(2)), '{[2026-01-01 00:00-03,2026-02-01 00:00-03)}'::tstzmultirange + pg_temp.from_now(),
  'reativar abre um período novo, sem mexer nos anteriores');

-- Inativar e reativar na mesma transação não deixa buraco.
SELECT pg_temp.set_periods(pg_temp.c(3), '{[2026-01-01 00:00-03,)}');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(3);
UPDATE public.cells SET is_active = true WHERE id = pg_temp.c(3);
SELECT is(pg_temp.periods(pg_temp.c(3)), '{[2026-01-01 00:00-03,)}'::tstzmultirange,
  'inativar e reativar na mesma transação: o período continua sem buraco');

-- delete_cell fecha; restore_cell reabre a ativa; a excluída quando inativa não reabre.
SELECT pg_temp.set_periods(pg_temp.c(4), '{[2026-01-01 00:00-03,)}');
SELECT is(pg_temp.try(6, format('SELECT public.delete_cell(%L)', pg_temp.c(4))), '00000', 'Rita exclui K4 pela RPC');
SELECT is(pg_temp.periods(pg_temp.c(4)), tstzmultirange(tstzrange('2026-01-01 00:00-03', now())), 'delete_cell fecha o período');
SELECT is(pg_temp.try(6, format('SELECT public.restore_cell(%L)', pg_temp.c(4))), '00000', 'Rita restaura K4 pela RPC');
SELECT ok(upper_inf(pg_temp.periods(pg_temp.c(4))), 'restore_cell reabre o período da célula ativa');

UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(5);
SELECT is(pg_temp.try(6, format('SELECT public.delete_cell(%L)', pg_temp.c(5))), '00000', 'Rita exclui K5, inativa');
SELECT is(pg_temp.try(6, format('SELECT public.restore_cell(%L)', pg_temp.c(5))), '00000', 'Rita restaura K5');
SELECT ok((SELECT deleted_at IS NULL AND NOT is_active FROM public.cells WHERE id = pg_temp.c(5))
          AND NOT upper_inf(pg_temp.periods(pg_temp.c(5))),
  'restore_cell da excluída quando inativa: ela continua inativa e o período não abre');

-- ===========================================================================
-- 3. RN-06 pela API: ninguém informa o momento — 4
-- ===========================================================================
SELECT is(pg_temp.try(6, 'SELECT count(*) FROM private.cell_active_periods'), '42501',
  'authenticated (Administrador) não lê private.cell_active_periods');
SELECT is(pg_temp.try(6, format($$UPDATE private.cell_active_periods SET periods = '{(,)}' WHERE cell_id = %L$$, pg_temp.c(1))),
  '42501', 'authenticated (Administrador) não grava private.cell_active_periods');
SELECT pg_temp.try(6, format($$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, created_at)
                              VALUES (%L, %L, %L, %L, 'Evangelística', 'Quarta', '20:00', '2025-01-01 00:00-03')$$,
                             pg_temp.c(10), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5)));
SELECT is(pg_temp.periods(pg_temp.c(10)), pg_temp.from_now(),
  'RN-06: célula cadastrada pela API com created_at no passado começa a contar no momento do cadastro');
SELECT pg_temp.try(6, format($$UPDATE public.cells SET created_at = '2020-01-01 00:00-03' WHERE id = %L$$, pg_temp.c(10)));
SELECT is(pg_temp.periods(pg_temp.c(10)), pg_temp.from_now(),
  'RN-06: mudar created_at depois não muda o histórico');

-- ===========================================================================
-- 4. Auditoria (RN-04 do E2.05): o trigger não grava em cells nem gera evento — 2
-- ===========================================================================
CREATE TEMP TABLE audit0 AS
SELECT (SELECT count(*) FROM public.events WHERE entity_id = pg_temp.c(6)) AS ev,
       pg_stat_get_xact_tuples_updated('public.cells'::regclass) AS upd;
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(6);
SELECT is((SELECT count(*) FROM public.events WHERE entity_id = pg_temp.c(6)) - (SELECT ev FROM audit0), 1::bigint,
  'inativar gera um evento, como antes deste passo; nenhum da tabela nova');
SELECT is(pg_stat_get_xact_tuples_updated('public.cells'::regclass) - (SELECT upd FROM audit0), 1::bigint,
  'o trigger não grava em cells: uma só versão nova da linha (updated_at e Auditoria intactos)');

-- ===========================================================================
-- 5. Backfill (RN-06, RN-10; DA-4) e o invariante em replica (DA-5) — 11
-- ===========================================================================
SET LOCAL session_replication_role = replica;
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active, created_at, deleted_at, deleted_by) VALUES
  (pg_temp.c(21), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), 'Evangelística', 'Quarta', '20:00', true,  '2026-03-10 00:00-03', NULL, NULL),
  (pg_temp.c(22), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), 'Evangelística', 'Quarta', '20:00', false, '2026-03-10 00:00-03', NULL, NULL),
  (pg_temp.c(23), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), 'Evangelística', 'Quarta', '20:00', true,  '2026-03-10 00:00-03', '2026-04-01 00:00-03', pg_temp.m(6)),
  (pg_temp.c(24), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), 'Evangelística', 'Quarta', '20:00', false, '2026-03-10 00:00-03', '2026-04-01 00:00-03', pg_temp.m(6)),
  (pg_temp.c(25), pg_temp.m(3), pg_temp.m(4), pg_temp.m(5), 'Evangelística', 'Quarta', '20:00', true,  '2026-03-10 00:00-03', '2026-02-01 00:00-03', pg_temp.m(6));
SET LOCAL session_replication_role = origin;

SELECT is((SELECT array_agg(x.problem ORDER BY x.cell_id) FROM private.cell_active_period_problems() x
            WHERE x.cell_id::text LIKE 'd2090100%'),
  ARRAY['missing_row', 'missing_row', 'missing_row', 'missing_row', 'missing_row'],
  'DA-5: as células inseridas em replica não têm linha (missing_row)');
SELECT is(private.backfill_cell_active_periods(), 5, 'o backfill cria só as 5 linhas que faltam');
SELECT is(pg_temp.periods(pg_temp.c(21)), '{[2026-03-10 00:00-03,)}'::tstzmultirange, 'backfill: ativa conta desde o cadastro');
SELECT is(pg_temp.periods(pg_temp.c(22)), '{}'::tstzmultirange, 'backfill: inativa, nenhuma semana anterior conta');
SELECT is(pg_temp.periods(pg_temp.c(23)), '{[2026-03-10 00:00-03,2026-04-01 00:00-03)}'::tstzmultirange,
  'DA-4: excluída quando ativa conta do cadastro até a exclusão');
SELECT is(pg_temp.periods(pg_temp.c(24)), '{}'::tstzmultirange, 'DA-4: excluída quando inativa, nenhuma semana conta');
SELECT is(pg_temp.periods(pg_temp.c(25)), '{}'::tstzmultirange, 'excluída antes do cadastro: período vazio');
CREATE TEMP TABLE snap AS SELECT cell_id, periods FROM private.cell_active_periods;
SELECT is(private.backfill_cell_active_periods(), 0, 'a segunda chamada cria 0 linhas ...');
SELECT is_empty($$ (SELECT cell_id, periods FROM private.cell_active_periods EXCEPT SELECT cell_id, periods FROM pg_temp.snap)
                   UNION ALL
                   (SELECT cell_id, periods FROM pg_temp.snap EXCEPT SELECT cell_id, periods FROM private.cell_active_periods) $$,
  '... e não muda as existentes');

SELECT pg_temp.set_periods(pg_temp.c(22), '{(,)}');
SELECT pg_temp.set_periods(pg_temp.c(21), '{[2026-03-10 00:00-03,2026-04-01 00:00-03)}');
SELECT is((SELECT array_agg(x.problem || ':' || right(x.cell_id::text, 2) ORDER BY x.cell_id) FROM private.cell_active_period_problems() x
            WHERE x.cell_id::text LIKE 'd2090100%'),
  ARRAY['not_open:21', 'open_but_not_counting:22'],
  'invariante: ativa com período fechado = not_open; inativa com período aberto = open_but_not_counting');
SELECT pg_temp.set_periods(pg_temp.c(22), '{}');
SELECT pg_temp.set_periods(pg_temp.c(21), '{[2026-03-10 00:00-03,)}');

-- ===========================================================================
-- 6. Invariante no fim — 1
-- ===========================================================================
SELECT is_empty('SELECT * FROM private.cell_active_period_problems()', 'cell_active_period_problems() vazia no fim');

SELECT * FROM finish();
ROLLBACK;
