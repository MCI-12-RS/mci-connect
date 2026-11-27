-- E2.11 (PR 2): o lançamento do relatório pela submit_cell_report.
-- Spec: docs/specs/e2-11-lancamento-relatorio.md (repositório apps-mci), "Escrita (migration 3)",
-- "submit_cell_report (lançamento)", "Formato dos erros (AQ-2)" e "Verificações obrigatórias (para o
-- QA)", PR 2; RN-01 a RN-13, RN-15, RN-20; DA-1, DA-2, DA-6 a DA-8, DA-10, DA-12; DT-05, DT-06, DT-09.
--
-- Cobre, com o código, o campo, a mensagem e os detalhes do spec:
--   - estrutura e privilégios da RPC;
--   - RN-02 e DA-8: quem lança, na ordem (42501, cell_required, célula invisível, excluída, sem direito,
--     inativa);
--   - RN-08, RN-09, RN-12, RN-13: os campos (data, horário, tema, motivo, oferta, visitantes, observações,
--     tetos);
--   - RN-10 e RN-11: participantes (excluído, invisível, inexistente, limite; os automáticos, isentos);
--   - RN-04 a RN-07: semana atual, futuro, reunião que não aconteceu, antes da reunião, um por semana
--     (com o relatório só para quem o vê);
--   - RN-20: as combinações do critério e pares vizinhos da ordem;
--   - RN-14 e RN-15: o retrato e os automáticos pelo servidor, a normalização, um evento create;
--   - DT-06: a repetição (mesmo conteúdo, conteúdo diferente, outro autor, excluído, sem permissão);
--   - a service role e o lançamento de transição da save_cell_report (DA-12).
--
-- O "agora" é o da transação: as datas são escolhidas a partir de sp_today() (as células se reúnem no
-- domingo às 00:00, menos C3, no sábado às 23:59, e C6, no domingo às 00:01). Autocontido: cria a
-- própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Ids fictícios e utilitários.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2110300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2110300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2110300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2110300-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.ws(_weeks_ago int DEFAULT 0) RETURNS date LANGUAGE sql STABLE AS
$$ SELECT public.week_start(public.sp_today()) - 7 * _weeks_ago $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192113' || lpad(_n::text, 4, '0') $$;

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
SELECT pg_temp.u(n), 'e211-03-' || n || '@teste.invalid' FROM generate_series(1, 18) n;
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

SELECT plan(89);

-- ===========================================================================
-- 1. Estrutura e privilégios
-- ===========================================================================
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=public'] FROM pg_proc
            WHERE oid = 'public.submit_cell_report(uuid,jsonb,uuid[])'::regprocedure),
  'DT-05: submit_cell_report é definer com search_path fixo');
SELECT ok(has_function_privilege('authenticated', 'public.submit_cell_report(uuid,jsonb,uuid[])', 'EXECUTE')
          AND has_function_privilege('service_role', 'public.submit_cell_report(uuid,jsonb,uuid[])', 'EXECUTE')
          AND NOT has_function_privilege('anon', 'public.submit_cell_report(uuid,jsonb,uuid[])', 'EXECUTE'),
  'submit_cell_report: EXECUTE para authenticated e service_role, não para anon');
SELECT is(pg_get_function_result('public.submit_cell_report(uuid,jsonb,uuid[])'::regprocedure),
  'TABLE(report_id uuid, outcome report_submit_outcome, same_content boolean)', 'contrato do retorno');
SELECT is(enum_range(NULL::public.report_submit_outcome)::text, '{created,replayed}', 'report_submit_outcome');

-- ===========================================================================
-- 2. RN-02 e DA-8: quem lança, na ordem
-- ===========================================================================
SELECT is(pg_temp.sub('15', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) ->> 'code', '42501',
  'RN-02: Hugo, sem nenhuma permissão de lançar: 42501');
SELECT is(pg_temp.sub('15', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) ->> 'message', 'Você não tem permissão para esta ação.',
  'RN-02: com a mensagem do E2.02');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) - 'cell_id') -> 'detail',
  '{"code": "cell_required", "field": "cell_id"}'::jsonb, 'DA-8: sem a célula: cell_required no campo cell_id');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"cell_id": "não é id"}') ->> 'code',
  'cell_required', 'DA-8: célula ilegível: cell_required');
SELECT is(pg_temp.sub('14', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) -> 'detail',
  '{"code": "not_found_or_deleted", "entity": "cell"}'::jsonb, 'RN-02/DA-7: Diego não vê C1: tratada como inexistente');
SELECT is(pg_temp.sub('14', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) ->> 'message',
  'Esta célula não existe ou já foi excluída.', 'RN-02: com a mensagem do E2.01');
SELECT is(pg_temp.sub('14', gen_random_uuid(), pg_temp.held(pg_temp.c(5))) ->> 'code', 'not_found_or_deleted',
  'DA-7: Diego, que não vê a excluída C5, não fica sabendo que ela foi excluída');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(5))) -> 'detail',
  jsonb_build_object('code', 'cell_deleted', 'cell_id', pg_temp.c(5)), 'RN-02: Pedro, que vê C5: cell_deleted');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(5))) ->> 'message',
  'Esta célula foi excluída e não recebe relatórios.', 'RN-02: com a mensagem');
SELECT is(pg_temp.sub('10', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) -> 'detail',
  jsonb_build_object('code', 'report_submit_not_allowed', 'cell_id', pg_temp.c(1)),
  'RN-02: Fábio vê C1, mas não é pessoa dela: report_submit_not_allowed');
SELECT is(pg_temp.sub('10', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) ->> 'message',
  'Você não pode enviar o relatório desta célula.', 'RN-02: com a mensagem');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(4))) -> 'detail',
  jsonb_build_object('code', 'cell_inactive', 'cell_id', pg_temp.c(4)), 'RN-02: C4 inativa: cell_inactive');
-- A ordem: cada recusa de cima vence a de baixo.
SELECT is(pg_temp.sub('10', gen_random_uuid(), pg_temp.held(pg_temp.c(4))) ->> 'code', 'report_submit_not_allowed',
  'DA-8: sem direito numa célula inativa: report_submit_not_allowed vem antes de cell_inactive');
SELECT is(pg_temp.sub('15', gen_random_uuid(), pg_temp.held(pg_temp.c(5)) - 'cell_id') ->> 'code', '42501',
  'DA-8: sem permissão e sem célula: 42501 vem antes de cell_required');

-- ===========================================================================
-- 3. RN-08, RN-09, RN-12, RN-13: campos (passos 9 a 11)
-- ===========================================================================
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) - 'date') -> 'detail',
  '{"code": "report_date_required", "field": "date"}'::jsonb, 'RN-08: sem data');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"date": "2026-02-30"}') ->> 'code',
  'report_date_invalid', 'RN-08: data inexistente pela API: "Data inválida."');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"date": "abc"}') ->> 'message',
  'Data inválida.', 'RN-08: data ilegível');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) - 'time') -> 'detail',
  '{"code": "report_time_required", "field": "time"}'::jsonb, 'RN-08: sem horário');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"time": "25:00"}') ->> 'message',
  'Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.', 'RN-08: horário inválido');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"theme": "   "}') -> 'detail',
  '{"code": "theme_required", "field": "theme"}'::jsonb, 'RN-08: tema só com espaços');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1), jsonb_build_object('theme', repeat('t', 301)))) -> 'detail',
  '{"code": "theme_too_long", "field": "theme", "max": 300}'::jsonb, 'DA-4: tema com 301 caracteres');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) - 'offering') -> 'detail',
  '{"code": "offering_required", "field": "offering"}'::jsonb, 'RN-13: célula realizada sem oferta');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"offering": -5}') ->> 'message',
  'A oferta não pode ser negativa.', 'RN-13: oferta negativa');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"offering": 10.555}') ->> 'code',
  'offering_invalid', 'RN-13/DT-15: três casas decimais (conferido antes do numeric(10,2))');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"offering": 1000000}') -> 'detail',
  '{"code": "offering_too_large", "field": "offering", "max": 999999.99}'::jsonb, 'DA-5: acima de R$ 999.999,99');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"visitors": "Maria, João"}') ->> 'code',
  'visitors_invalid', 'RN-12: visitantes que não são uma lista');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1), jsonb_build_object('visitors', jsonb_build_array('Ana', repeat('v', 151))))) -> 'detail',
  '{"code": "visitor_name_too_long", "field": "visitors", "index": 1, "max": 150}'::jsonb, 'RN-12: nome longo, com o índice');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1), jsonb_build_object('observations', repeat('o', 4001)))) ->> 'code',
  'observations_too_long', 'DA-4: observações com 4001 caracteres');
SELECT is(pg_temp.sub('3', gen_random_uuid(), '{"was_held": false}'::jsonb || jsonb_build_object('cell_id', pg_temp.c(1))) -> 'detail',
  '{"code": "reason_required", "field": "reason_not_held"}'::jsonb, 'RN-09: "Não houve célula" sem motivo');
SELECT is(pg_temp.sub('3', gen_random_uuid(), jsonb_build_object('cell_id', pg_temp.c(1), 'was_held', false, 'reason_not_held', repeat('m', 2001))) ->> 'code',
  'reason_too_long', 'DA-4: motivo com 2001 caracteres');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || '{"was_held": "talvez"}') -> 'detail',
  '{"code": "was_held_invalid", "field": "was_held"}'::jsonb, 'situação ilegível pela API (técnica)');

-- ===========================================================================
-- 4. RN-10 e RN-11: participantes (passo 10)
-- ===========================================================================
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)), ARRAY[pg_temp.m(18)]) -> 'detail',
  jsonb_build_object('code', 'deleted_member_chosen', 'field', 'participant_ids', 'member_id', pg_temp.m(18)),
  'RN-10: Bruno, excluído, escolhido: deleted_member_chosen');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)), ARRAY[pg_temp.m(15)]) -> 'detail',
  jsonb_build_object('code', 'person_not_visible', 'field', 'participant_ids', 'member_id', pg_temp.m(15)),
  'RN-10: Pedro escolhe Hugo, que não vê: person_not_visible');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)), ARRAY[pg_temp.m(15)]) ->> 'message',
  'Você só pode escolher pessoas que você vê.', 'RN-10: com a mensagem');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)), ARRAY[gen_random_uuid()]) ->> 'code',
  'participant_not_found', 'RN-10: id que não é de ninguém (técnica)');
SELECT is(pg_temp.rpc('3', format('SELECT * FROM public.submit_cell_report(gen_random_uuid(), %L::jsonb, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 998)))',
                                  pg_temp.held(pg_temp.c(1)))) -> 'detail',
  '{"code": "too_many_participants", "field": "participant_ids", "max": 1000}'::jsonb,
  'RN-10: 998 escolhidos e os 3 automáticos passam de 1000');
-- ===========================================================================
-- 5. RN-04, RN-05, RN-06: datas (passos 12 a 14)
-- ===========================================================================
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || jsonb_build_object('date', pg_temp.ws() - 1)) -> 'detail',
  jsonb_build_object('code', 'report_not_current_week', 'week_start', pg_temp.ws(), 'week_end', pg_temp.ws() + 6),
  'RN-04: sábado da semana passada: report_not_current_week, com a semana');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || jsonb_build_object('date', pg_temp.ws() - 1)) ->> 'message',
  'O relatório precisa ser da semana atual, de ' || to_char(pg_temp.ws(), 'DD/MM/YYYY') || ' a ' || to_char(pg_temp.ws() + 6, 'DD/MM/YYYY') || '.',
  'RN-04: com a mensagem');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || jsonb_build_object(
            'date', (date_trunc('minute', public.sp_now()) + interval '1 minute')::date,
            'time', to_char(date_trunc('minute', public.sp_now()) + interval '1 minute', 'HH24:MI'))) -> 'detail',
  '{"code": "report_in_future", "field": "date_time"}'::jsonb, 'RN-05: um minuto depois de agora');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(3))) -> 'detail',
  jsonb_build_object('code', 'meeting_not_yet', 'meeting_at', to_char(pg_temp.ws() + 6, 'YYYY-MM-DD') || 'T23:59'),
  'RN-06: C3 (sábado, 23:59): a reunião desta semana ainda não aconteceu');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(3))) ->> 'message',
  'A reunião desta semana ainda não aconteceu. O relatório pode ser enviado a partir de sábado, '
    || to_char(pg_temp.ws() + 6, 'DD/MM/YYYY') || ', às 23:59.', 'RN-06: com a mensagem');
SELECT is(pg_temp.sub('3', gen_random_uuid(), jsonb_build_object('cell_id', pg_temp.c(3), 'was_held', false, 'reason_not_held', 'Chuva')) ->> 'code',
  'meeting_not_yet', 'RN-06/RN-09: "Não houve célula" antes da reunião também');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(6))) -> 'detail',
  jsonb_build_object('code', 'report_before_meeting', 'field', 'date_time', 'meeting_at', to_char(pg_temp.ws(), 'YYYY-MM-DD') || 'T00:01'),
  'RN-06: C6 (domingo, 00:01) às 00:00: antes da reunião');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(6))) ->> 'message',
  'O relatório não pode ser de antes da reunião da célula nesta semana (domingo, ' || to_char(pg_temp.ws(), 'DD/MM/YYYY') || ', às 00:01).',
  'RN-06: com a mensagem');

-- RN-20: as combinações do critério.
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || jsonb_build_object('theme', '', 'date', pg_temp.ws() + 13)) ->> 'code',
  'theme_required', 'RN-20: sem tema e com data de outra semana: o tema vem primeiro');
SELECT is(pg_temp.sub('10', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || jsonb_build_object('date', pg_temp.ws() + 13)) ->> 'code',
  'report_submit_not_allowed', 'RN-20: sem direito e com data futura: report_submit_not_allowed');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(1)) || jsonb_build_object('offering', -1, 'date', pg_temp.ws() - 1)) ->> 'code',
  'offering_negative', 'RN-20: preenchimento (2) antes da semana atual (4)');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(3)) || jsonb_build_object('date', pg_temp.ws() - 1)) ->> 'code',
  'report_not_current_week', 'RN-20: semana atual (4) antes da reunião que não aconteceu (6)');

-- ===========================================================================
-- 6. Lançamento aceito: retrato, automáticos, normalização, Auditoria (RN-11, RN-12, RN-14, RN-15)
-- ===========================================================================
SELECT is(pg_temp.sub('3', pg_temp.r(1), pg_temp.held(pg_temp.c(1)) || jsonb_build_object(
            'theme', '  Fé e obras  ', 'time', '00:00:45', 'observations', '', 'offering', '12.50',
            'visitors', jsonb_build_array(' Maria ', '', '  João   da  Silva ', 'Maria'),
            'snapshot_leader_id', pg_temp.m(15), 'id', gen_random_uuid()),
          ARRAY[pg_temp.m(10), pg_temp.m(9), pg_temp.m(10), NULL]),
  jsonb_build_object('code', 'ok', 'rows', jsonb_build_array(jsonb_build_object('report_id', pg_temp.r(1), 'outcome', 'created', 'same_content', NULL))),
  'RN-02: Pedro lança C1 (com Fábio, Caio repetido e um nulo): created');
SELECT is((SELECT jsonb_build_object('theme', theme, 'time', "time", 'obs', observations, 'offering', offering, 'visitors', visitors,
                                     'snap', ARRAY[snapshot_leader_id, snapshot_timothy_id, snapshot_host_id], 'type', snapshot_cell_type)
             FROM public.cell_reports WHERE id = pg_temp.r(1)),
  jsonb_build_object('theme', 'Fé e obras', 'time', '00:00:00', 'obs', NULL, 'offering', 12.50,
                     'visitors', jsonb_build_array('Maria', 'João da Silva', 'Maria'),
                     'snap', ARRAY[pg_temp.m(7), pg_temp.m(9), pg_temp.m(12)], 'type', 'Evangelística'),
  'RN-08/RN-12/RN-14: textos sem as pontas, horário sem segundos, visitantes normalizados, retrato da célula (o enviado é ignorado)');
SELECT is(pg_temp.parts(pg_temp.r(1)), pg_temp.ids(7, 9, 10, 12),
  'RN-11: os escolhidos (Fábio, inativo) e os três automáticos, sem repetir');
SELECT is((SELECT jsonb_build_object('action', action, 'n', jsonb_array_length(changes #> '{participants,sent}'),
                                     'snap', changes::text LIKE '%snapshot%')
             FROM public.events WHERE entity = 'cell_report' AND entity_id = pg_temp.r(1)),
  '{"action": "create", "n": 4, "snap": false}'::jsonb, 'RN-15: um evento create, com os 4 participantes e sem o retrato');
SELECT is(coalesce(current_setting('mci.cell_report_write', true), ''), '', 'DA-11: a marca volta ao valor de antes');

-- RN-07: a semana tem relatório.
SELECT is(pg_temp.sub('12', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) -> 'detail',
  jsonb_build_object('code', 'report_week_taken', 'week_start', pg_temp.ws(),
    'report', jsonb_build_object('id', pg_temp.r(1), 'date', pg_temp.ws(), 'time', '00:00', 'was_held', true, 'can_edit', false)),
  'RN-07/DA-10: Carla (registrada) vê qual é o relatório, sem "pode editar"');
SELECT is(pg_temp.sub('12', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) ->> 'message',
  'O relatório para esta semana já foi enviado.', 'RN-07: com a mensagem');
SELECT is(pg_temp.sub('7', gen_random_uuid(), jsonb_build_object('cell_id', pg_temp.c(1), 'was_held', false, 'reason_not_held', 'x')) -> 'detail' -> 'report' ->> 'can_edit',
  'true', 'RN-07: André (Editar Relatórios) recebe "pode editar"');
-- Rita troca as pessoas de C1: Diego passa a ver C1, mas não o relatório (retrato de André, Caio e Carla).
UPDATE public.cells SET leader_id = pg_temp.m(14), timothy_id = pg_temp.m(15), host_id = pg_temp.m(9) WHERE id = pg_temp.c(1);
SELECT is(pg_temp.sub('14', gen_random_uuid(), pg_temp.held(pg_temp.c(1))) -> 'detail',
  jsonb_build_object('code', 'report_week_taken', 'week_start', pg_temp.ws()),
  'RN-07/DA-10: Diego, que não vê o relatório, recebe só a primeira frase');
UPDATE public.cells SET leader_id = pg_temp.m(7), timothy_id = pg_temp.m(9), host_id = pg_temp.m(12) WHERE id = pg_temp.c(1);

-- RN-11: Pedro lança C2 (vê Caio, o anfitrião); Diego e Hugo, que ele não vê, entram como automáticos.
SELECT is(pg_temp.sub('3', pg_temp.r(2), pg_temp.held(pg_temp.c(2))) ->> 'code', 'ok', 'RN-02: Pedro lança C2 (Editar Célula, vê Caio)');
SELECT is(pg_temp.parts(pg_temp.r(2)), pg_temp.ids(9, 14, 15), 'RN-11: os automáticos entram mesmo fora do que Pedro vê');

-- RN-01: a service role escolhe qualquer pessoa não excluída (sem a visibilidade).
SELECT is(pg_temp.sub('service_role', pg_temp.r(5), pg_temp.held(pg_temp.c(7)), ARRAY[pg_temp.m(15)]) ->> 'code', 'ok',
  'RN-01: a service role lança C7 com Hugo escolhido');
SELECT is(pg_temp.parts(pg_temp.r(5)), pg_temp.ids(7, 9, 12, 15), 'RN-01/RN-11: Hugo e os três de C7');

-- RN-09: "Não houve célula" em C6, lançado por André, com o resto ignorado.
SELECT is(pg_temp.sub('7', pg_temp.r(3), jsonb_build_object('cell_id', pg_temp.c(6), 'was_held', false, 'reason_not_held', ' Chuva forte ',
            'date', pg_temp.ws() + 1, 'time', '05:00', 'theme', 'ignorado', 'offering', 50, 'visitors', jsonb_build_array('V'),
            'observations', 'ignorada'), ARRAY[pg_temp.m(18), pg_temp.m(15)]) ->> 'code',
  'ok', 'RN-09: "Não houve célula" ignora data, tema, oferta, visitantes, observações e participantes (mesmo excluído ou invisível)');
SELECT is((SELECT jsonb_build_object('date', date, 'time', "time", 'reason', reason_not_held, 'theme', theme, 'offering', offering,
                                     'visitors', visitors, 'obs', observations, 'type', snapshot_cell_type)
             FROM public.cell_reports WHERE id = pg_temp.r(3)),
  jsonb_build_object('date', pg_temp.ws(), 'time', '00:01:00', 'reason', 'Chuva forte', 'theme', NULL, 'offering', NULL,
                     'visitors', '[]'::jsonb, 'obs', NULL, 'type', 'Macrocélula'),
  'RN-09/DA-6: grava a reunião da semana e só o motivo (o retrato tem o tipo da célula)');
SELECT is(pg_temp.parts(pg_temp.r(3)), '{}'::uuid[], 'RN-09/RN-11: nenhum participante, nem os automáticos');

-- ===========================================================================
-- 7. Repetição do envio (DT-06, DA-1, DA-2, P-REL-29)
-- ===========================================================================
CREATE TEMP TABLE ev0 AS SELECT pg_temp.nev(pg_temp.r(1)) AS n;
SELECT is(pg_temp.sub('3', pg_temp.r(1), pg_temp.held(pg_temp.c(1)) || jsonb_build_object(
            'theme', 'Fé e obras', 'time', '00:00', 'offering', 12.5,
            'visitors', jsonb_build_array('Maria', 'João da Silva', 'Maria')),
          ARRAY[pg_temp.m(9), pg_temp.m(10)]) -> 'rows',
  jsonb_build_array(jsonb_build_object('report_id', pg_temp.r(1), 'outcome', 'replayed', 'same_content', true)),
  'DT-06: o mesmo envio de Pedro (normalizado igual, participantes como conjunto): replayed, igual');
SELECT is(pg_temp.sub('3', pg_temp.r(1), pg_temp.held(pg_temp.c(1)) || '{"theme": "Outro tema"}', ARRAY[pg_temp.m(9)]) -> 'rows',
  jsonb_build_array(jsonb_build_object('report_id', pg_temp.r(1), 'outcome', 'replayed', 'same_content', false)),
  'DT-06: com outro conteúdo: replayed, diferente');
SELECT is((SELECT theme FROM public.cell_reports WHERE id = pg_temp.r(1)), 'Fé e obras', 'DT-06: e nada muda no gravado');
SELECT is(pg_temp.nev(pg_temp.r(1)), (SELECT n FROM ev0), 'DT-06/RN-15: a repetição não gera evento');
SELECT is(pg_temp.sub('7', pg_temp.r(1), pg_temp.held(pg_temp.c(1))) -> 'detail',
  '{"code": "report_id_conflict"}'::jsonb, 'DA-2: André com o id de Pedro: report_id_conflict, sem nada do relatório');
SELECT is(pg_temp.sub('service_role', pg_temp.r(1), pg_temp.held(pg_temp.c(1))) ->> 'code', 'report_id_conflict',
  'DA-2: a service role com o id de Pedro também');
SELECT is(pg_temp.sub('15', pg_temp.r(1), pg_temp.held(pg_temp.c(1))) ->> 'code', 'report_id_conflict',
  'DA-2: Hugo (sem permissão) com o id de outro: só a recusa técnica');
-- Pedro perde a permissão: a repetição do que ele gravou continua respondendo (o que ele mesmo enviou).
UPDATE public.members SET role_id = pg_temp.role('Membro') WHERE id = pg_temp.m(3);
SELECT is(pg_temp.sub('3', pg_temp.r(1), pg_temp.held(pg_temp.c(1)) || '{"theme": "Fé e obras", "offering": 12.5}') -> 'rows' -> 0 ->> 'outcome',
  'replayed', 'P-REL-29: a repetição não confere a permissão de novo (a primeira tentativa foi aceita)');
SELECT is(pg_temp.sub('3', gen_random_uuid(), pg_temp.held(pg_temp.c(6))) ->> 'code', 'report_submit_not_allowed',
  'P-REL-29: sem a permissão, um envio novo é recusado');
UPDATE public.members SET role_id = pg_temp.role('Líder') WHERE id = pg_temp.m(3);
-- DA-1: o relatório da primeira tentativa foi excluído.
SELECT is(pg_temp.rpc('16', format('SELECT public.delete_cell_report(%L)', pg_temp.r(2))) ->> 'code', 'ok', 'Rita exclui o relatório de C2');
SELECT is(pg_temp.sub('3', pg_temp.r(2), pg_temp.held(pg_temp.c(2))) -> 'detail',
  '{"code": "not_found_or_deleted", "entity": "cell_report"}'::jsonb, 'DA-1: repetir o envio de um relatório já excluído');

-- Service role e o lançamento de transição (DA-12).
SELECT is(pg_temp.sub('service_role', pg_temp.r(4), jsonb_build_object('cell_id', pg_temp.c(2), 'was_held', false, 'reason_not_held', 'Viagem')) ->> 'code',
  'ok', 'RN-01: a service role lança (a semana de C2 ficou livre com a exclusão)');
SELECT is((SELECT created_by_kind::text FROM public.cell_reports WHERE id = pg_temp.r(4)), 'system', 'RN-15: autor "Sistema"');
SELECT is(pg_temp.sub('service_role', pg_temp.r(4), jsonb_build_object('cell_id', pg_temp.c(2), 'was_held', false, 'reason_not_held', 'Viagem')) -> 'rows' -> 0,
  jsonb_build_object('report_id', pg_temp.r(4), 'outcome', 'replayed', 'same_content', true), 'DT-06: a service role repete o próprio envio');
SELECT is(pg_temp.sub('14', pg_temp.r(4), jsonb_build_object('cell_id', pg_temp.c(2), 'was_held', false, 'reason_not_held', 'Viagem')) ->> 'code',
  'report_id_conflict', 'leitura técnica 6: um membro com o id gravado pela service role: report_id_conflict');
SELECT is(pg_temp.rpc('16', format('SELECT public.delete_cell_report(%L)', pg_temp.r(4))) ->> 'code', 'ok', 'Rita exclui o relatório da service role');
SELECT is(pg_temp.save('14', NULL, jsonb_build_object('cell_id', pg_temp.c(2), 'date', pg_temp.ws(), 'time', '00:00', 'theme', 'Pelo E2.05', 'offering', 0),
                       ARRAY[pg_temp.m(14)]) -> 'rows' -> 0 ->> 'changed',
  'true', 'DA-12: save_cell_report(NULL, …) ainda lança, com as regras (changed = true)');
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE cell_id = pg_temp.c(2) AND deleted_at IS NULL AND theme = 'Pelo E2.05'), 1,
  'DA-12: um relatório só');
SELECT is(pg_temp.save('14', NULL, jsonb_build_object('cell_id', pg_temp.c(2), 'date', pg_temp.ws(), 'time', '00:00', 'theme', 'De novo', 'offering', 0)) ->> 'code',
  'report_week_taken', 'DA-12: com as regras do lançamento (um por semana)');

-- ===========================================================================
-- 8. Invariantes
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM public.cell_reports WHERE snapshot_leader_id IS NULL OR snapshot_timothy_id IS NULL
            OR snapshot_host_id IS NULL OR snapshot_cell_type IS NULL), 0, 'nenhum relatório sem retrato');
SELECT is((SELECT count(*)::int FROM (SELECT cell_id, public.week_start(date) FROM public.cell_reports WHERE deleted_at IS NULL
            GROUP BY 1, 2 HAVING count(*) > 1) d), 0, 'nenhuma célula com dois relatórios não excluídos na mesma semana');

SELECT * FROM finish();
ROLLBACK;
