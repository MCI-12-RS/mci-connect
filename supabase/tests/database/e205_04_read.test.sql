-- E2.05 (PR 1) — Auditoria: leitura (autoria nas views, legado, events_view e histórico).
-- Spec: docs/specs/e2-05-auditoria-autor.md ("Verificações obrigatórias": RN-07, RN-08, RN-10,
-- RN-11, RN-18, RN-19; AQ-1 a AQ-3; DA-4, DA-6, DA-11; DT-12, DT-15, DT-17).
-- Rodar com: supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(35);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2050400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2050400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2050400-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '519204' || lpad(_n::text, 5, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.api(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _detail text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    IF _sql ~* '^\s*(select|with)' THEN EXECUTE _sql INTO _out; ELSE EXECUTE _sql; _out := '{"ok": true}'::jsonb; END IF;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN coalesce(_out, 'null'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', _state, 'code', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'code' END);
  END;
END $$;
CREATE FUNCTION pg_temp.authorship(_n int, _view text, _id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.api(_n, format($q$SELECT coalesce(jsonb_agg(jsonb_build_object(
           'created_kind', created_by_kind, 'created_name', created_by_name,
           'updated_kind', updated_by_kind, 'updated_name', updated_by_name)), '[]') FROM public.%I WHERE id = %L$q$, _view, _id))
$$;

-- ---------------------------------------------------------------------------
-- Massa: 1 Samuel (pastor, Administrador)  2 Ana (Administrador)  3 Davi (Líder, G12)
--        4 Caio (Membro, de Davi)  5 Otávio, 6 Paula (de Davi)  9 Bruno (de Samuel: fora do escopo de Caio)
--        16 Telma (Administrador, de Samuel; será excluída)
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e205-04-' || n || '@teste.invalid', now() FROM unnest(ARRAY[1, 2, 3, 4, 16]) n;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp, auth_user_id, role_id)
VALUES (pg_temp.m(1), 'Samuel Pastor', 'M', true, false, pg_temp.mob(1), pg_temp.u(1), pg_temp.role('Administrador'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, auth_user_id, role_id) VALUES
  (pg_temp.m(2), 'Ana Auditora', 'F', pg_temp.m(1), true, pg_temp.mob(2), pg_temp.u(2), pg_temp.role('Administrador')),
  (pg_temp.m(3), 'Davi Duarte', 'M', pg_temp.m(1), true, pg_temp.mob(3), pg_temp.u(3), pg_temp.role('Líder')),
  (pg_temp.m(9), 'Bruno Brito', 'M', pg_temp.m(1), true, pg_temp.mob(9), NULL, NULL),
  (pg_temp.m(16), 'Telma Torres', 'F', pg_temp.m(1), true, pg_temp.mob(16), pg_temp.u(16), pg_temp.role('Administrador'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, auth_user_id, role_id) VALUES
  (pg_temp.m(4), 'Caio Lima', 'M', pg_temp.m(3), true, pg_temp.mob(4), pg_temp.u(4), pg_temp.role('Membro')),
  (pg_temp.m(6), 'Paula Prado', 'F', pg_temp.m(3), true, pg_temp.mob(6), NULL, NULL);
SELECT pg_temp.api(2, format($$INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp)
                               VALUES (%L, 'Otávio Reis', 'M', %L, true, %L)$$, pg_temp.m(5), pg_temp.m(3), pg_temp.mob(5)));
SELECT pg_temp.api(16, format($$UPDATE public.members SET notes = 'Telma passou aqui' WHERE id = %L$$, pg_temp.m(6)));
SELECT pg_temp.api(2, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(16)));
SELECT pg_temp.api(2, format($$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
                               VALUES (%L, %L, %L, %L, 'Domingo', '00:00')$$, pg_temp.c(1), pg_temp.m(3), pg_temp.m(5), pg_temp.m(6)));
SELECT pg_temp.api(3, format($$SELECT to_jsonb(r) FROM public.save_cell_report(NULL,
                               jsonb_build_object('cell_id', %L::uuid, 'date', public.sp_today(), 'time', '19:30', 'theme', 'Fé'),
                               ARRAY[%L, %L]::uuid[]) r$$, pg_temp.c(1), pg_temp.m(4), pg_temp.m(5)));
CREATE TEMP TABLE rep AS SELECT id FROM public.cell_reports WHERE cell_id = pg_temp.c(1);

-- ===========================================================================
-- 1. RN-07, RN-08: a autoria nas views, para quem vê o registro — 9
-- ===========================================================================
SELECT is(pg_temp.authorship(4, 'members_view', pg_temp.m(5)),
  '[{"created_kind": "member", "created_name": "Ana Auditora", "updated_kind": null, "updated_name": null}]'::jsonb,
  'RN-07/RN-08: Caio vê quem cadastrou Otávio (Ana, fora do escopo dele), e nenhuma alteração');
SELECT is(pg_temp.authorship(4, 'members_view', pg_temp.m(6)),
  '[{"created_kind": "system", "created_name": null, "updated_kind": "member", "updated_name": "Telma Torres"}]'::jsonb,
  'RN-08/RN-09: o nome de quem alterou aparece mesmo com a autora excluída; cadastro "Sistema" sem nome');
SELECT is(pg_temp.authorship(4, 'members_view', pg_temp.m(9)), '[]'::jsonb,
  'RN-07: Bruno está fora do escopo de Caio: nada da autoria dele');
SELECT is(pg_temp.authorship(4, 'cells_view', pg_temp.c(1)),
  '[{"created_kind": "member", "created_name": "Ana Auditora", "updated_kind": null, "updated_name": null}]'::jsonb,
  'RN-07: a célula de Davi, com quem cadastrou');
SELECT is(pg_temp.authorship(4, 'cell_reports_view', (SELECT id FROM rep)),
  '[{"created_kind": "member", "created_name": "Davi Duarte", "updated_kind": null, "updated_name": null}]'::jsonb,
  'RN-07/RN-04 d: o relatório, com quem enviou e sem alteração (os participantes do envio fazem parte dele)');
UPDATE public.members SET name = 'Ana Souza Auditora' WHERE id = pg_temp.m(2);
SELECT is(pg_temp.authorship(4, 'members_view', pg_temp.m(5)) -> 0 ->> 'created_name', 'Ana Souza Auditora',
  'RN-08: aparece o nome atual do autor');
SELECT is((SELECT actor_label FROM public.events WHERE entity = 'member' AND entity_id = pg_temp.m(5) AND action = 'create'), 'Ana Auditora',
  'RN-08/RN-20 c: o evento antigo mantém o nome de então');
SELECT is(pg_temp.api(4, format($$SELECT to_jsonb(array_agg(c)) FROM jsonb_object_keys((SELECT to_jsonb(v) FROM public.members_view v WHERE id = %L)) c
                                  WHERE c IN ('created_by', 'updated_by')$$, pg_temp.m(5))), 'null'::jsonb,
  'DA-11/RN-08: nenhuma coluna da view expõe o id do autor');
SELECT ok((SELECT created_by = pg_temp.m(2) FROM public.members WHERE id = pg_temp.m(5)),
  'DA-11: a tabela guarda o id do membro autor (como o deleted_by)');

-- ===========================================================================
-- 2. RN-10, RN-11: autoria do legado (legacy_authorship, DT-17) — 12
-- ===========================================================================
CREATE TEMP TABLE leg (k text, created_by text, created_on timestamp, updated_by text, updated_on timestamp, is_deleted boolean, want jsonb);
INSERT INTO leg VALUES
  ('mesmo nome, 30 s', 'AdminUser', '2024-01-10 10:00', 'AdminUser', '2024-01-10 10:00:30', false,
   '{"c": "2024-01-10T13:00:00+00:00", "ck": "legacy", "cl": "AdminUser", "u": null, "uk": null, "ul": null, "d": null, "dk": null, "dl": null}'),
  ('mesmo nome, 1 min', 'Joana', '2024-01-10 10:00', 'Joana', '2024-01-10 10:01', false,
   '{"c": "2024-01-10T13:00:00+00:00", "ck": "legacy", "cl": "Joana", "u": null, "uk": null, "ul": null, "d": null, "dk": null, "dl": null}'),
  ('mesmo nome, 2 min', 'Joana', '2024-01-10 10:00', 'Joana', '2024-01-10 10:02', false,
   '{"c": "2024-01-10T13:00:00+00:00", "ck": "legacy", "cl": "Joana", "u": "2024-01-10T13:02:00+00:00", "uk": "legacy", "ul": "Joana", "d": null, "dk": null, "dl": null}'),
  ('outro nome, 30 s', ' Joana ', '2024-01-10 10:00', 'Pedro', '2024-01-10 10:00:30', false,
   '{"c": "2024-01-10T13:00:00+00:00", "ck": "legacy", "cl": "Joana", "u": "2024-01-10T13:00:30+00:00", "uk": "legacy", "ul": "Pedro", "d": null, "dk": null, "dl": null}'),
  ('nomes vazios', '  ', '2024-01-10 10:00', '', '2024-02-01 08:00', false,
   '{"c": "2024-01-10T13:00:00+00:00", "ck": "unknown", "cl": null, "u": "2024-02-01T11:00:00+00:00", "uk": "unknown", "ul": null, "d": null, "dk": null, "dl": null}'),
  ('datas nulas', 'Joana', NULL, 'Pedro', NULL, false,
   '{"c": null, "ck": "legacy", "cl": "Joana", "u": null, "uk": null, "ul": null, "d": null, "dk": null, "dl": null}'),
  ('excluído', 'Joana', '2024-01-10 10:00', 'Pedro', '2024-03-01 09:00', true,
   '{"c": "2024-01-10T13:00:00+00:00", "ck": "legacy", "cl": "Joana", "u": "2024-03-01T12:00:00+00:00", "uk": "legacy", "ul": "Pedro", "d": "2024-03-01T12:00:00+00:00", "dk": "legacy", "dl": "Pedro"}'),
  ('excluído sem datas', NULL, NULL, NULL, NULL, true,
   '{"c": null, "ck": "unknown", "cl": null, "u": null, "uk": null, "ul": null, "d": "2026-01-01T03:00:00+00:00", "dk": "unknown", "dl": null}');
SELECT is((SELECT jsonb_build_object('c', l.created_at, 'ck', l.created_by_kind, 'cl', l.created_by_legacy,
                                     'u', l.updated_at, 'uk', l.updated_by_kind, 'ul', l.updated_by_legacy,
                                     'd', l.deleted_at, 'dk', l.deleted_by_kind, 'dl', l.deleted_by_legacy)
             FROM private.legacy_authorship(x.created_by, x.created_on, x.updated_by, x.updated_on, x.is_deleted,
                                            '2026-01-01 00:00-03'::timestamptz) l),
  x.want, 'RN-10/RN-11/DA-4: legacy_authorship — ' || x.k)
  FROM leg x ORDER BY x.k;

-- Carga em replica (E4.06): sem evento, e os CHECKs aceitam o que a função devolve.
CREATE TEMP TABLE ev_before AS SELECT count(*) AS n FROM public.events;
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp,
                            created_at, created_by_kind, created_by_legacy, updated_at, updated_by_kind, updated_by_legacy)
SELECT pg_temp.m(17), 'Lauro Legado', 'M', pg_temp.m(3), true, pg_temp.mob(17),
       l.created_at, l.created_by_kind, l.created_by_legacy, l.updated_at, l.updated_by_kind, l.updated_by_legacy
  FROM private.legacy_authorship('AdminUser', NULL, 'João Antigo', '2024-05-05 10:00', false, now()) l;
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp,
                            created_at, created_by_kind, created_by_legacy, updated_at, updated_by_kind, updated_by_legacy,
                            deleted_at, deleted_by_kind, deleted_by_legacy)
SELECT pg_temp.m(18), 'Marta Legado', 'F', pg_temp.m(3), true, pg_temp.mob(18), l.*
  FROM private.legacy_authorship('Joana', '2024-01-10 10:00', 'Maria Antiga', '2024-06-01 10:00', true, now()) l;
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp,
                            created_at, created_by_kind, created_by_legacy, updated_at, updated_by_kind, updated_by_legacy,
                            deleted_at, deleted_by_kind, deleted_by_legacy)
SELECT pg_temp.m(19), 'Noé Legado', 'M', pg_temp.m(3), true, pg_temp.mob(19), l.*
  FROM private.legacy_authorship('Joana', '2024-01-10 10:00', NULL, '2024-06-01 10:00', true, now()) l;
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();
SELECT is((SELECT count(*) FROM public.events), (SELECT n FROM ev_before), 'RN-10 e: a carga em replica não grava evento');
SELECT is(pg_temp.api(4, format($$SELECT to_jsonb(v) - ARRAY(SELECT k FROM jsonb_object_keys(to_jsonb(v)) k
                                    WHERE k NOT IN ('created_at', 'created_by_kind', 'created_by_name', 'updated_by_kind', 'updated_by_name'))
                                  FROM public.members_view v WHERE id = %L$$, pg_temp.m(17))),
  '{"created_at": null, "created_by_kind": "legacy", "created_by_name": "Administrador", "updated_by_kind": "legacy", "updated_by_name": "João Antigo"}'::jsonb,
  'RN-10 b/d: "AdminUser" vira "Administrador" na view; cadastro sem data ("data não registrada")');
SELECT is(pg_temp.api(2, format($$SELECT jsonb_agg(jsonb_build_object('kind', deleted_by_kind, 'name', deleted_by_name) ORDER BY name)
                                  FROM public.members_deleted_view WHERE id IN (%L, %L, %L)$$, pg_temp.m(18), pg_temp.m(19), pg_temp.m(16))),
  '[{"kind": "legacy", "name": "Maria Antiga"}, {"kind": "unknown", "name": null}, {"kind": "member", "name": "Ana Souza Auditora"}]'::jsonb,
  'RN-11: "Excluídos" com quem excluiu no legado, "autor não registrado" sem nome, e o membro do novo');

-- ===========================================================================
-- 3. RN-18: events_view — 9
-- ===========================================================================
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(count(*)) FROM public.events_view') ->> 'error', '42501',
  'RN-18: Caio (sem "Visualizar Auditoria") recebe 42501, inclusive na contagem');
SELECT is(pg_temp.api(3, 'SELECT to_jsonb(e) FROM public.events_view e LIMIT 1') ->> 'error', '42501',
  'RN-18: Davi (Líder) também');
SELECT is(pg_temp.api(4, $$SELECT to_jsonb(count(*)) FROM public.events_view WHERE id = '00000000-0000-0000-0000-000000000000'$$) ->> 'error', '42501',
  'RN-18: o portão sai mesmo sem linha nenhuma no filtro');
SELECT ok((pg_temp.api(2, 'SELECT to_jsonb(count(*)) FROM public.events_view'))::text::int > 0, 'RN-18: Ana (Administrador) lê a Auditoria');

-- Período em datas de Brasília: o evento das 23:59 de sábado fica no sábado.
INSERT INTO public.events (occurred_at, actor_kind, action, entity, entity_id, entity_label, description) VALUES
  ('2026-11-21 23:59:00-03', 'system', 'update', 'member', pg_temp.m(9), 'Bruno Brito', 'Alterou o membro Bruno Brito'),
  ('2026-11-22 00:01:00-03', 'system', 'update', 'member', pg_temp.m(9), 'Bruno Brito', 'Alterou o membro Bruno Brito');
SELECT is(pg_temp.api(2, $$SELECT jsonb_agg(occurred_on ORDER BY occurred_at) FROM public.events_view
                           WHERE entity_label = 'Bruno Brito' AND occurred_on BETWEEN '2026-11-21' AND '2026-11-21'$$),
  '["2026-11-21"]'::jsonb, 'RN-18: o período usa a data de Brasília (o evento das 23:59 de sábado é do sábado)');
SELECT is(pg_temp.api(2, $$SELECT to_jsonb(count(*)) FROM public.events_view WHERE search_text ILIKE '%otavio%'$$),
  (SELECT to_jsonb(count(*)) FROM public.events WHERE description ILIKE '%Otávio%' OR entity_label ILIKE '%Otávio%'),
  'RN-18/DA-6: a busca sem acento ("otavio") acha os eventos de Otávio');
SELECT ok((pg_temp.api(2, $$SELECT to_jsonb(count(*)) FROM public.events_view WHERE search_text ILIKE '%sistema%'$$))::text::int >= 2,
  'DA-6: a busca acha "Sistema" no autor dos eventos sem pessoa');
SELECT is(pg_temp.api(2, $$SELECT to_jsonb(array_agg(seq ORDER BY occurred_at DESC, seq DESC)) FROM public.events_view$$),
  (SELECT to_jsonb(array_agg(seq ORDER BY occurred_at DESC, seq DESC)) FROM public.events),
  'RN-18: a ordem estável (occurred_at desc, seq desc) com todos os eventos');
SELECT is(pg_temp.api(2, format($$SELECT jsonb_agg(action ORDER BY occurred_at DESC, seq DESC) FROM public.events_view
                                  WHERE entity = 'member' AND entity_id = %L AND action IN ('create', 'update', 'delete', 'restore')$$, pg_temp.m(16))),
  '["delete", "create"]'::jsonb, 'RN-19: o histórico de Telma: o cadastro e a exclusão, do mais recente para o mais antigo');

-- ===========================================================================
-- 4. RN-19: audit_record_label — 6
-- ===========================================================================
SELECT is(pg_temp.api(2, format('SELECT jsonb_agg(to_jsonb(t)) FROM public.audit_record_label(''member'', %L) t', pg_temp.m(5))),
  '[{"name": "Otávio Reis", "leader_name": null, "report_date": null, "deleted": false}]'::jsonb, 'AQ-3: o título de um membro');
SELECT is(pg_temp.api(2, format('SELECT jsonb_agg(to_jsonb(t)) FROM public.audit_record_label(''member'', %L) t', pg_temp.m(16))),
  '[{"name": "Telma Torres", "leader_name": null, "report_date": null, "deleted": true}]'::jsonb, 'AQ-3: de um membro excluído (o selo)');
SELECT is(pg_temp.api(2, format('SELECT jsonb_agg(to_jsonb(t)) FROM public.audit_record_label(''cell'', %L) t', pg_temp.c(1))),
  '[{"name": null, "leader_name": "Davi Duarte", "report_date": null, "deleted": false}]'::jsonb, 'AQ-3: de uma célula');
SELECT is(pg_temp.api(2, format('SELECT jsonb_agg(to_jsonb(t)) FROM public.audit_record_label(''cell_report'', %L) t', (SELECT id FROM rep))),
  jsonb_build_array(jsonb_build_object('name', NULL, 'leader_name', 'Davi Duarte', 'report_date', public.sp_today(), 'deleted', false)),
  'AQ-3: de um relatório');
SELECT is(pg_temp.api(2, format('SELECT jsonb_agg(to_jsonb(t)) FROM public.audit_record_label(''member'', %L) t', gen_random_uuid())),
  'null'::jsonb, 'AQ-3: registro inexistente: nenhuma linha');
SELECT is(pg_temp.api(4, format('SELECT jsonb_agg(to_jsonb(t)) FROM public.audit_record_label(''member'', %L) t', pg_temp.m(5))) ->> 'error',
  '42501', 'RN-19: sem "Visualizar Auditoria", 42501');

SELECT * FROM finish();
ROLLBACK;
