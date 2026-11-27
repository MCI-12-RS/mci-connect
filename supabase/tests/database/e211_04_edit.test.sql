-- E2.11 (PR 2): a edição do relatório pela save_cell_report (reescrita, definer, mesmo contrato do E2.05).
-- Spec: docs/specs/e2-11-lancamento-relatorio.md (repositório apps-mci), "save_cell_report (edição)",
-- "Formato dos erros (AQ-2)" e "Verificações obrigatórias (para o QA)", PR 2; RN-03, RN-05, RN-08 a
-- RN-11, RN-15, RN-16, RN-20; DA-3, DA-4, DA-9; DT-12, DT-13; risco 11.
--
-- Cobre: quem edita (RN-03); o que muda e a Auditoria (changed, um evento, nenhum sem mudança); a semana
-- do relatório e o futuro (RN-16, RN-05); os tetos só nos campos que vieram (DA-4); as trocas de situação
-- (RN-09, DA-3); participantes que entram e saem, as pessoas registradas fixas (RN-10, RN-11), também
-- contra a gravação de manutenção; a service role; o contexto da edição (DT-13).
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Ids fictícios e utilitários.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2110400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2110400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2110400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2110400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.ws(_weeks_ago int DEFAULT 0) RETURNS date LANGUAGE sql STABLE AS
$$ SELECT public.week_start(public.sp_today()) - 7 * _weeks_ago $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192114' || lpad(_n::text, 4, '0') $$;

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
SELECT pg_temp.u(n), 'e211-04-' || n || '@teste.invalid' FROM generate_series(1, 18) n;
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

SELECT plan(54);

-- ---------------------------------------------------------------------------
-- Relatórios da massa (gravação de manutenção, com a marca do DA-11; os de semanas passadas e os "do
-- legado" em replica). O retrato vem da célula pelo trigger.
--   R10: C1, semana passada, realizada, com Fábio. R11: C1, esta semana, realizada, com Gabriel.
--   R12: C2, semana passada, "Não houve célula" do legado (com tema, oferta e Diego como participante).
--   R13: C7, semana passada, realizada, com Bruno (excluído depois). R14: C7, duas semanas atrás, do
--   legado, sem tema e sem oferta, com observações acima do teto. R15: C5 (excluída). R16: excluído.
--   R17: C4 (inativa). R18: C6, semana passada, com Débora (que Pedro não vê).
-- ---------------------------------------------------------------------------
SET LOCAL mci.cell_report_write = 'on';
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, reason_not_held, offering, observations, deleted_at) VALUES
 (pg_temp.r(10), pg_temp.c(1), pg_temp.ws(1), '00:00', true, 'Antigo', NULL, 0, NULL, NULL),
 (pg_temp.r(11), pg_temp.c(1), pg_temp.ws(), '00:00', true, 'Semana', NULL, 5, NULL, NULL),
 (pg_temp.r(12), pg_temp.c(2), pg_temp.ws(1), '00:00', false, 'antigo tema', 'Chuva', 0, NULL, NULL),
 (pg_temp.r(13), pg_temp.c(7), pg_temp.ws(1), '00:00', true, 'Com Bruno', NULL, 0, NULL, NULL),
 (pg_temp.r(14), pg_temp.c(7), pg_temp.ws(2), '00:00', true, NULL, NULL, NULL, repeat('o', 4500), NULL),
 (pg_temp.r(15), pg_temp.c(5), pg_temp.ws(1), '00:00', true, 'Da excluída', NULL, 0, NULL, NULL),
 (pg_temp.r(16), pg_temp.c(1), pg_temp.ws(2), '00:00', true, 'Excluído', NULL, 0, NULL, now()),
 (pg_temp.r(17), pg_temp.c(4), pg_temp.ws(1), '00:00', true, 'Da inativa', NULL, 0, NULL, NULL),
 (pg_temp.r(18), pg_temp.c(6), pg_temp.ws(1), '00:01', true, 'Com Débora', NULL, 0, NULL, NULL);
INSERT INTO public.cell_report_participants (report_id, member_id)
SELECT pg_temp.r(10), x FROM unnest(pg_temp.ids(7, 9, 10, 12)) x
UNION ALL SELECT pg_temp.r(11), x FROM unnest(pg_temp.ids(7, 9, 11, 12)) x
UNION ALL SELECT pg_temp.r(12), pg_temp.m(14)
UNION ALL SELECT pg_temp.r(13), x FROM unnest(pg_temp.ids(7, 9, 12, 18)) x
UNION ALL SELECT pg_temp.r(18), x FROM unnest(pg_temp.ids(7, 9, 12, 13)) x;
SET LOCAL session_replication_role = origin;
SET LOCAL mci.cell_report_write = '';

-- ===========================================================================
-- 1. Estrutura e RN-03: quem edita
-- ===========================================================================
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc
            WHERE oid = 'public.save_cell_report(uuid,jsonb,uuid[])'::regprocedure)
          AND has_function_privilege('authenticated', 'public.save_cell_report(uuid,jsonb,uuid[])', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.save_cell_report(uuid,jsonb,uuid[])', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.save_cell_report(uuid,jsonb,uuid[])', 'EXECUTE'),
  'DT-05: save_cell_report passou a definer, com EXECUTE para authenticated e service_role');
SELECT is(pg_get_function_result('public.save_cell_report(uuid,jsonb,uuid[])'::regprocedure),
  'TABLE(report_id uuid, changed boolean)', 'o contrato do E2.05 não muda');
SELECT is(pg_temp.save('12', pg_temp.r(11), '{"theme": "Carla edita"}') ->> 'code', '42501',
  'RN-03: Carla, que só lança, não edita (nem o relatório em que está registrada)');
SELECT is(pg_temp.save('14', pg_temp.r(10), '{"theme": "x"}') -> 'detail',
  '{"code": "not_found_or_deleted", "entity": "cell_report"}'::jsonb, 'RN-03: Diego não vê R10: tratado como inexistente');
SELECT is(pg_temp.save('3', pg_temp.r(16), '{"theme": "x"}') ->> 'message',
  'Este relatório não existe ou já foi excluído.', 'RN-03: relatório excluído');
SELECT is(pg_temp.save('3', pg_temp.r(15), '{"theme": "x"}') -> 'detail',
  jsonb_build_object('code', 'report_cell_deleted', 'cell_id', pg_temp.c(5)), 'RN-03: relatório de célula excluída');
SELECT is(pg_temp.save('3', pg_temp.r(17), '{"theme": "Corrigido"}') -> 'rows' -> 0 ->> 'changed', 'true',
  'RN-03 (RN-11 d do E2.08): o relatório de célula inativa é editado');

-- ===========================================================================
-- 2. RN-15 e RN-16: o que muda, a Auditoria e a semana do relatório
-- ===========================================================================
CREATE TEMP TABLE ev10 AS SELECT pg_temp.nev(pg_temp.r(10)) AS n;
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"theme": "  Novo tema  "}') -> 'rows',
  jsonb_build_array(jsonb_build_object('report_id', pg_temp.r(10), 'changed', true)), 'RN-16: Pedro muda o tema de R10 (semana passada)');
SELECT is((SELECT jsonb_build_object('theme', theme, 'parts', pg_temp.parts(id), 'by', updated_by) FROM public.cell_reports WHERE id = pg_temp.r(10)),
  jsonb_build_object('theme', 'Novo tema', 'parts', pg_temp.ids(7, 9, 10, 12), 'by', pg_temp.m(3)),
  'RN-16: o tema sem as pontas; participantes iguais; "Alterado por" Pedro');
SELECT is((SELECT jsonb_build_object('n', count(*), 'action', min(action::text), 'fields', min(changes ->> 'fields'))
             FROM public.events WHERE entity = 'cell_report' AND entity_id = pg_temp.r(10)) - 'fields'
          || jsonb_build_object('n', pg_temp.nev(pg_temp.r(10)) - (SELECT n FROM ev10)),
  '{"n": 1, "action": "update"}'::jsonb, 'RN-15: um evento update');
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"theme": "Novo tema"}', pg_temp.ids(12, 10, 9, 7)) -> 'rows' -> 0 ->> 'changed', 'false',
  'RN-15: sem mudança (o conjunto final igual, em outra ordem): changed = false');
SELECT is(pg_temp.nev(pg_temp.r(10)) - (SELECT n FROM ev10), 1, 'RN-15: e nenhum evento novo');
SELECT is(pg_temp.save('3', pg_temp.r(10), jsonb_build_object('date', pg_temp.ws(1) + 3, 'time', '21:00')) -> 'rows' -> 0 ->> 'changed', 'true',
  'RN-16: a data muda dentro da semana do relatório (RN-04 e RN-06 não valem na edição)');
SELECT is(pg_temp.save('3', pg_temp.r(10), jsonb_build_object('date', pg_temp.ws())) -> 'detail',
  jsonb_build_object('code', 'report_week_locked', 'field', 'date', 'week_start', pg_temp.ws(1), 'week_end', pg_temp.ws(1) + 6),
  'RN-16: fora da semana do relatório: report_week_locked');
SELECT is(pg_temp.save('3', pg_temp.r(10), jsonb_build_object('date', pg_temp.ws())) ->> 'message',
  'Na edição, a data só pode mudar dentro da semana do relatório, de ' || to_char(pg_temp.ws(1), 'DD/MM/YYYY') || ' a '
    || to_char(pg_temp.ws(1) + 6, 'DD/MM/YYYY') || '.', 'RN-16: com a mensagem');
SELECT is(pg_temp.save('3', pg_temp.r(11), jsonb_build_object(
            'date', (date_trunc('minute', public.sp_now()) + interval '1 minute')::date,
            'time', to_char(date_trunc('minute', public.sp_now()) + interval '1 minute', 'HH24:MI'))) -> 'detail',
  '{"code": "report_in_future", "field": "date_time"}'::jsonb, 'RN-05: na edição, o futuro quando o momento muda');
SELECT is(pg_temp.save('3', pg_temp.r(10), jsonb_build_object('cell_id', pg_temp.c(7))) ->> 'code', 'report_cell_immutable',
  'RN-16: a célula não muda');
SELECT is(pg_temp.save('3', pg_temp.r(10), jsonb_build_object('cell_id', pg_temp.c(1), 'observations', 'Mesma célula')) ->> 'code', 'ok',
  'RN-16: a mesma célula no PATCH é aceita');
SELECT is(pg_temp.save('3', pg_temp.r(11), jsonb_build_object('theme', '', 'date', pg_temp.ws(1))) ->> 'code', 'theme_required',
  'RN-20: o preenchimento (tema) vem antes da semana do relatório');

-- DA-4: os tetos só nos campos que vieram; o que falta no relatório antigo é pedido (risco 11).
SELECT is(pg_temp.save('3', pg_temp.r(14), '{"offering": 0}') ->> 'code', 'theme_required',
  'risco 11: o relatório antigo sem tema pede o tema');
SELECT is(pg_temp.save('3', pg_temp.r(14), '{"theme": "Agora com tema"}') ->> 'code', 'offering_required',
  'risco 11: e a oferta');
SELECT is(pg_temp.save('3', pg_temp.r(14), '{"theme": "Agora com tema", "offering": 0}') ->> 'code', 'ok',
  'DA-4: as observações antigas acima do teto não impedem corrigir o tema');
SELECT is(pg_temp.save('3', pg_temp.r(14), jsonb_build_object('observations', repeat('o', 4001))) ->> 'code', 'observations_too_long',
  'DA-4: o campo que veio é conferido');

-- ===========================================================================
-- 3. RN-09: as trocas de situação
-- ===========================================================================
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"was_held": false}') -> 'detail',
  '{"code": "reason_required", "field": "reason_not_held"}'::jsonb, 'RN-09: passar para "Não houve célula" exige o motivo');
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"was_held": false, "reason_not_held": "Feriado"}') ->> 'code', 'ok',
  'RN-09: com o motivo, aceito');
SELECT is((SELECT jsonb_build_object('held', was_held, 'theme', theme, 'offering', offering, 'visitors', visitors, 'obs', observations,
                                     'date', date, 'reason', reason_not_held, 'parts', pg_temp.parts(id))
             FROM public.cell_reports WHERE id = pg_temp.r(10)),
  jsonb_build_object('held', false, 'theme', NULL, 'offering', NULL, 'visitors', '[]'::jsonb, 'obs', NULL,
                     'date', pg_temp.ws(1) + 3, 'reason', 'Feriado', 'parts', '{}'::uuid[]),
  'RN-09: todos os participantes saem, tema, oferta, visitantes e observações são apagados; a data fica');
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"was_held": true}') ->> 'code', 'theme_required',
  'RN-09: voltar para célula realizada exige o tema');
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"was_held": true, "theme": "Voltou"}') ->> 'code', 'offering_required',
  'RN-09: e a oferta');
SELECT is(pg_temp.save('3', pg_temp.r(10), '{"was_held": true, "theme": "Voltou", "offering": 3}', pg_temp.ids(10)) ->> 'code', 'ok',
  'RN-09: com tema e oferta, aceito');
SELECT is((SELECT jsonb_build_object('reason', reason_not_held, 'parts', pg_temp.parts(id)) FROM public.cell_reports WHERE id = pg_temp.r(10)),
  jsonb_build_object('reason', NULL, 'parts', pg_temp.ids(7, 9, 10, 12)),
  'RN-09/RN-11: o motivo é apagado e as pessoas registradas entram, com Fábio escolhido');
-- DA-3: continua "Não houve célula".
SELECT is(pg_temp.save('3', pg_temp.r(12), '{"theme": "ignorado", "offering": 9, "visitors": ["V"]}', '{}'::uuid[]) -> 'rows' -> 0 ->> 'changed',
  'false', 'DA-3: no "Não houve célula", os outros campos e os participantes enviados são ignorados');
SELECT is((SELECT jsonb_build_object('theme', theme, 'offering', offering, 'parts', pg_temp.parts(id)) FROM public.cell_reports WHERE id = pg_temp.r(12)),
  jsonb_build_object('theme', 'antigo tema', 'offering', 0.00, 'parts', pg_temp.ids(14)),
  'RN-09: o do legado fica como está');
SELECT is(pg_temp.save('3', pg_temp.r(12), '{"reason_not_held": "Chuva forte"}') -> 'rows' -> 0 ->> 'changed', 'true',
  'RN-09: editar só o motivo não exige limpar o resto');
SELECT is(pg_temp.save('3', pg_temp.r(12), '{"was_held": true, "theme": "Houve", "offering": 0}') ->> 'code', 'ok',
  'RN-09: Pedro passa R12 para célula realizada');
SELECT is(pg_temp.parts(pg_temp.r(12)), pg_temp.ids(9, 14, 15),
  'RN-11: as pessoas registradas (Diego e Hugo, que Pedro não vê, e Caio) entram, isentas da visibilidade');
SELECT is(pg_temp.save('3', pg_temp.r(13), '{"was_held": false, "reason_not_held": "x"}') -> 'detail',
  jsonb_build_object('code', 'not_held_with_deleted_participant', 'field', 'was_held', 'member_ids', jsonb_build_array(pg_temp.m(18))),
  'RN-09: com participante excluído, a troca para "Não houve célula" é recusada');

-- ===========================================================================
-- 4. RN-10 e RN-11: participantes na edição
-- ===========================================================================
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', pg_temp.ids(7, 11, 12)) -> 'detail',
  jsonb_build_object('code', 'snapshot_participant_removal', 'field', 'participant_ids', 'member_id', pg_temp.m(9)),
  'RN-11: Caio, timóteo registrado, não sai da célula realizada');
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', pg_temp.ids(7, 11, 12)) ->> 'message',
  'O líder, o timóteo e o anfitrião registrados no relatório não podem ser retirados dos participantes.', 'RN-11: com a mensagem');
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', pg_temp.ids(7, 9, 12)) -> 'rows' -> 0 ->> 'changed', 'true',
  'RN-10: Gabriel sai');
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', pg_temp.ids(7, 9, 12, 15)) ->> 'code', 'person_not_visible',
  'RN-10: Hugo, que Pedro não vê, não entra');
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', pg_temp.ids(7, 9, 12, 18)) ->> 'code', 'deleted_member_chosen',
  'RN-10: Bruno, excluído, não entra');
SELECT is(pg_temp.save('3', pg_temp.r(13), '{}', pg_temp.ids(7, 9, 12)) -> 'detail',
  jsonb_build_object('code', 'deleted_participant_removal', 'field', 'participant_ids', 'member_id', pg_temp.m(18)),
  'RN-10: Bruno, excluído, não sai');
SELECT is(pg_temp.save('3', pg_temp.r(18), '{}', pg_temp.ids(7, 9, 12)) ->> 'code', 'ok',
  'RN-10: Pedro retira Débora, que ele não vê (retirar não é escolher)');
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 1001))) ->> 'code',
  'too_many_participants', 'RN-10: mais de 1000 no conjunto final');
SELECT is(pg_temp.save('3', pg_temp.r(11), '{}', pg_temp.ids(7, 9, 12)) -> 'rows' -> 0 ->> 'changed', 'false',
  'RN-15: o mesmo conjunto: nada muda');

-- Barreira dos registrados para qualquer caminho (com a marca).
SET LOCAL mci.cell_report_write = 'on';
SELECT is(pg_temp.exec_code(format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L',
                                   pg_temp.r(11), pg_temp.m(9))),
  'snapshot_participant_removal', 'RN-11: nem a gravação de manutenção retira o registrado da célula realizada');
SET LOCAL mci.cell_report_write = '';

-- Service role (sem sessão): edita sem as regras de quem edita.
SELECT is(pg_temp.save('service_role', pg_temp.r(11), '{"observations": "Pelo sistema"}', pg_temp.ids(7, 9, 12, 15)) ->> 'code', 'ok',
  'RN-01: a service role edita e inclui Hugo (sem visibilidade)');
SELECT is((SELECT updated_by_kind::text FROM public.cell_reports WHERE id = pg_temp.r(11)), 'system', 'RN-15: "Alterado por" Sistema');

-- ===========================================================================
-- 5. Contexto da edição (RN-16, DT-13)
-- ===========================================================================
SELECT is(pg_temp.rpc('3', format('SELECT week_start, week_end, allowed_dates FROM public.cell_report_edit_context(%L)', pg_temp.r(13))) -> 'rows',
  jsonb_build_array(jsonb_build_object('week_start', pg_temp.ws(1), 'week_end', pg_temp.ws(1) + 6,
    'allowed_dates', (SELECT jsonb_agg(d::date ORDER BY d) FROM generate_series(pg_temp.ws(1), pg_temp.ws(1) + 6, interval '1 day') d))),
  'RN-16: a semana do relatório e os sete dias dela (semana passada)');
SELECT is(pg_temp.rpc('3', format('SELECT allowed_dates FROM public.cell_report_edit_context(%L)', pg_temp.r(11))) -> 'rows' -> 0 -> 'allowed_dates',
  (SELECT jsonb_agg(d::date ORDER BY d) FROM generate_series(pg_temp.ws(), public.sp_today(), interval '1 day') d),
  'RN-16/P-REL-22: nesta semana, até hoje');
SELECT is(pg_temp.rpc('14', format('SELECT 1 FROM public.cell_report_edit_context(%L)', pg_temp.r(13))) -> 'rows', '[]'::jsonb,
  'DT-13: nada para quem não vê o relatório');
SELECT is(pg_temp.rpc('3', format('SELECT 1 FROM public.cell_report_edit_context(%L)', pg_temp.r(16))) -> 'rows', '[]'::jsonb,
  'DT-13: nada para o relatório excluído');

-- ===========================================================================
-- 6. Invariantes
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE snapshot_leader_id IS NULL OR snapshot_timothy_id IS NULL
            OR snapshot_host_id IS NULL OR snapshot_cell_type IS NULL), 0, 'nenhum relatório sem retrato');
SELECT is((SELECT count(*)::int FROM (SELECT cell_id, public.week_start(date) FROM public.cell_reports WHERE deleted_at IS NULL
            GROUP BY 1, 2 HAVING count(*) > 1) d), 0, 'nenhuma célula com dois relatórios não excluídos na mesma semana');

SELECT * FROM finish();
ROLLBACK;
