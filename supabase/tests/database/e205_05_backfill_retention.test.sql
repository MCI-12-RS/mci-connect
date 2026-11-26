-- E2.05 (PR 1) — Auditoria: eventos e registros de antes deste passo (migration 5) e prazo de guarda.
-- Spec: docs/specs/e2-05-auditoria-autor.md ("Verificações obrigatórias": RN-12, RN-13, RN-16,
-- RN-17, RN-20; DA-2, DA-3; DT-11, DT-14, DT-20).
-- A massa "antiga" (eventos no formato de antes e registros sem autoria) é montada dentro da
-- transação do teste: sem os NOT NULL e os CHECKs da migration 5, em replica, como estava em
-- produção antes deste passo. O ROLLBACK do fim devolve tudo.
-- Rodar com: supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(31);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2050500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2050500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2050500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2050500-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '519205' || lpad((_n + 500)::text, 5, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.ev_of(_id uuid) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('entity', entity, 'action', action, 'actor', actor_kind, 'label', entity_label,
                                      'desc', description, 'changes', changes, 'fields', changed_fields,
                                      'v1', metadata #>> '{v1,description}') ORDER BY occurred_at, seq)
    FROM public.events WHERE entity_id = _id
$$;
CREATE FUNCTION pg_temp.au(_table text, _id uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id = $1', _table) INTO _r USING _id;
  RETURN jsonb_build_object('ck', _r -> 'created_by_kind', 'cb', _r -> 'created_by', 'uk', _r -> 'updated_by_kind',
                            'ub', _r -> 'updated_by', 'u', _r -> 'updated_at', 'dk', _r -> 'deleted_by_kind', 'db', _r -> 'deleted_by');
END $$;

-- ---------------------------------------------------------------------------
-- 0. Como estava antes deste passo: sem as regras da migration 5
-- ---------------------------------------------------------------------------
ALTER TABLE public.events ALTER COLUMN actor_kind DROP NOT NULL;
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by_kind DROP NOT NULL, ALTER COLUMN created_by_kind DROP DEFAULT', _t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I, DROP CONSTRAINT %I, DROP CONSTRAINT %I', _t,
                   _t || '_created_authorship_check', _t || '_updated_authorship_check', _t || '_deleted_authorship_check');
  END LOOP;
END $$;

-- Massa antiga: 2 Ana e 3 Davi (com conta), 5 Otávio, 6 Paula (sem evento), 7 Zeca (excluído por Ana, E2.01),
-- 8 Wagner (excluído pela chave secreta), 10 Vera (cadastrada por uma conta sem cadastro), 11 Sérgio (sem autor).
SET LOCAL session_replication_role = replica;
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT pg_temp.u(n), 'e205-05-' || n || '@teste.invalid', now() FROM unnest(ARRAY[2, 3, 99]) n;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, leader_id, mobile_whatsapp, auth_user_id, role_id,
                            created_at, updated_at, deleted_at, deleted_by)
VALUES
  (pg_temp.m(2), 'Ana Antiga', 'F', true, false, NULL, pg_temp.mob(2), pg_temp.u(2), pg_temp.role('Administrador'), now() - interval '40 days', now() - interval '40 days', NULL, NULL),
  (pg_temp.m(3), 'Davi Antigo', 'M', false, true, pg_temp.m(2), pg_temp.mob(3), pg_temp.u(3), pg_temp.role('Líder'), now() - interval '39 days', now() - interval '39 days', NULL, NULL),
  (pg_temp.m(5), 'Otávio Antigo', 'M', false, true, pg_temp.m(3), pg_temp.mob(5), NULL, NULL, now() - interval '30 days', now() - interval '1 day', NULL, NULL),
  (pg_temp.m(6), 'Paula Antiga', 'F', false, true, pg_temp.m(3), pg_temp.mob(6), NULL, NULL, now() - interval '30 days', now() - interval '2 days', NULL, NULL),
  (pg_temp.m(7), 'Zeca Antigo', 'M', false, true, pg_temp.m(3), pg_temp.mob(7), NULL, NULL, now() - interval '30 days', now() - interval '3 days', now() - interval '3 days', pg_temp.m(2)),
  (pg_temp.m(8), 'Wagner Antigo', 'M', false, true, pg_temp.m(3), pg_temp.mob(8), NULL, NULL, now() - interval '30 days', now() - interval '4 days', now() - interval '4 days', NULL),
  (pg_temp.m(10), 'Vera Antiga', 'F', false, true, pg_temp.m(3), pg_temp.mob(10), NULL, NULL, now() - interval '30 days', now() - interval '30 days', NULL, NULL),
  (pg_temp.m(11), 'Sérgio Antigo', 'M', false, true, pg_temp.m(3), pg_temp.mob(11), NULL, NULL, now() - interval '30 days', now() - interval '30 days', NULL, NULL);
UPDATE public.members SET created_by_kind = NULL WHERE id::text LIKE 'c2050500%';
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time, created_at, updated_at, created_by_kind)
VALUES (pg_temp.c(1), pg_temp.m(3), pg_temp.m(5), pg_temp.m(6), 'Domingo', '19:00', now() - interval '20 days', now() - interval '10 days', NULL);
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, offering, created_at, updated_at, created_by_kind) VALUES
  (pg_temp.r(1), pg_temp.c(1), '2026-11-02', '19:30', 'Fé', 80, '2026-11-02 22:00-03', '2026-11-03 10:00-03', NULL),
  (pg_temp.r(2), pg_temp.c(1), '2026-11-09', '19:30', 'Paz', 0, '2026-11-09 22:00-03', '2026-11-09 22:00:20-03', NULL);
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (pg_temp.r(1), pg_temp.m(5)), (pg_temp.r(2), pg_temp.m(5));

-- Eventos no formato de antes (os triggers e o _log_event antigos).
INSERT INTO public.events (occurred_at, actor_user_id, actor_label, action, entity, entity_id, entity_label, description, changed_fields, metadata, success, error_reason)
VALUES
  (now() - interval '30 days', pg_temp.u(2), 'Ana Antiga', 'create', 'member', pg_temp.m(5), 'Otávio Antigo', 'Criou o membro Otávio Antigo', NULL,
   jsonb_build_object('name', 'Otávio Antigo', 'leader_id', pg_temp.m(3), 'is_pastor', false), true, NULL),
  (now() - interval '5 days', pg_temp.u(2), 'Ana Antiga', 'update', 'member', pg_temp.m(5), 'Otávio Antigo', 'Atualizou o membro Otávio Antigo',
   ARRAY['name', 'mobile_whatsapp', 'g12_level'], '{"name": {"from": "Otávio", "to": "Otávio Antigo"}}', true, NULL),
  (now() - interval '1 day', pg_temp.u(3), 'Davi Antigo', 'update', 'member', pg_temp.m(5), 'Otávio Antigo', 'Atualizou o membro Otávio Antigo',
   ARRAY['leader_id', 'is_active'], jsonb_build_object('leader_id', jsonb_build_object('from', pg_temp.m(2), 'to', pg_temp.m(3)),
                                                         'is_active', jsonb_build_object('from', 'true', 'to', 'false')), true, NULL),
  (now() - interval '30 days', pg_temp.u(2), 'Ana Antiga', 'create', 'member', pg_temp.m(7), 'Zeca Antigo', 'Criou o membro Zeca Antigo', NULL, NULL, true, NULL),
  (now() - interval '3 days', pg_temp.u(2), 'Ana Antiga', 'delete', 'member', pg_temp.m(7), 'Zeca Antigo', 'Excluiu o membro Zeca Antigo', ARRAY['deleted_at'], '{"op": "soft_delete"}', true, NULL),
  (now() - interval '4 days', NULL, NULL, 'delete', 'member', pg_temp.m(8), 'Wagner Antigo', 'Excluiu o membro Wagner Antigo', ARRAY['deleted_at'], '{"op": "soft_delete"}', true, NULL),
  (now() - interval '30 days', pg_temp.u(99), NULL, 'create', 'member', pg_temp.m(10), 'Vera Antiga', 'Criou o membro Vera Antiga', NULL, NULL, true, NULL),
  (now() - interval '30 days', NULL, NULL, 'create', 'member', pg_temp.m(11), 'Sérgio Antigo', 'Criou o membro Sérgio Antigo', NULL, NULL, true, NULL),
  (now() - interval '20 days', pg_temp.u(2), 'Ana Antiga', 'create', 'cell', pg_temp.c(1), 'célula de Davi Antigo', 'Criou a célula de Davi Antigo', NULL, NULL, true, NULL),
  (now() - interval '10 days', pg_temp.u(3), 'Davi Antigo', 'update', 'cell', pg_temp.c(1), 'célula de Davi Antigo', 'Atualizou a célula de Davi Antigo',
   ARRAY['meeting_time', 'is_active'], '{"meeting_time": {"from": "19:00:00", "to": "20:00:00"}, "is_active": {"from": "true", "to": "false"}}', true, NULL),
  ('2026-11-02 22:00-03', pg_temp.u(3), 'Davi Antigo', 'create', 'cell_report', pg_temp.r(1), 'relatório da célula de Davi Antigo em 2026-11-02',
   'Registrou o relatório da célula de Davi Antigo em 2026-11-02', NULL, NULL, true, NULL),
  ('2026-11-02 22:00:05-03', pg_temp.u(3), 'Davi Antigo', 'create', 'cell_report_participant', pg_temp.r(1), 'relatório da célula de Davi Antigo em 2026-11-02',
   'Adicionou Otávio Antigo ao relatório da célula de Davi Antigo em 2026-11-02', NULL, jsonb_build_object('report_id', pg_temp.r(1), 'member_id', pg_temp.m(5)), true, NULL),
  ('2026-11-03 10:00-03', pg_temp.u(2), 'Ana Antiga', 'delete', 'cell_report_participant', pg_temp.r(1), 'relatório da célula de Davi Antigo em 2026-11-02',
   'Removeu Paula Antiga do relatório da célula de Davi Antigo em 2026-11-02', NULL, jsonb_build_object('report_id', pg_temp.r(1), 'member_id', pg_temp.m(6)), true, NULL),
  ('2026-11-02 23:00-03', pg_temp.u(3), 'Davi Antigo', 'update', 'cell_report', pg_temp.r(1), 'relatório da célula de Davi Antigo em 2026-11-02',
   'Atualizou o relatório da célula de Davi Antigo em 2026-11-02', ARRAY['offering'], '{"offering": {"from": "50.00", "to": "80.00"}}', true, NULL),
  ('2026-11-09 22:00-03', pg_temp.u(3), 'Davi Antigo', 'create', 'cell_report', pg_temp.r(2), 'relatório da célula de Davi Antigo em 2026-11-09',
   'Registrou o relatório da célula de Davi Antigo em 2026-11-09', NULL, NULL, true, NULL),
  ('2026-11-09 22:00:20-03', pg_temp.u(3), 'Davi Antigo', 'create', 'cell_report_participant', pg_temp.r(2), 'relatório da célula de Davi Antigo em 2026-11-09',
   'Adicionou Otávio Antigo ao relatório da célula de Davi Antigo em 2026-11-09', NULL, jsonb_build_object('report_id', pg_temp.r(2), 'member_id', pg_temp.m(5)), true, NULL),
  (now() - interval '2 days', pg_temp.u(2), 'Ana Antiga', 'login', 'auth', pg_temp.m(2), 'Ana Antiga', 'Login realizado', NULL, '{"identifier_type": "cpf"}', true, NULL),
  (now() - interval '2 days', NULL, NULL, 'login_failed', 'auth', NULL, NULL, 'Falha no login', NULL, '{"reason": "not_found"}', false, 'Identificação não encontrada'),
  (now() - interval '2 days', NULL, NULL, 'update', 'member', pg_temp.m(6), 'Paula Antiga', 'Formato estranho', NULL, NULL, true, NULL);
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();

-- ===========================================================================
-- 1. DT-11: conversão dos eventos antigos — 12
-- ===========================================================================
SELECT is(private.audit_convert_v1_events(), 1, 'DT-11: converte tudo; um evento de dados fora de todo formato conhecido (o aviso conta)');
SELECT is((SELECT count(*)::int FROM public.events WHERE actor_kind IS NULL), 0, 'DT-11: nenhum evento fica sem actor_kind');
SELECT is(pg_temp.ev_of(pg_temp.m(5)),
  jsonb_build_array(
    jsonb_build_object('entity', 'member', 'action', 'create', 'actor', 'member', 'label', 'Otávio Antigo', 'desc', 'Cadastrou o membro Otávio Antigo',
                       'changes', '{"fields": []}'::jsonb, 'fields', NULL, 'v1', 'Criou o membro Otávio Antigo'),
    jsonb_build_object('entity', 'member', 'action', 'update', 'actor', 'member', 'label', 'Otávio Antigo', 'desc', 'Alterou o membro Otávio Antigo',
                       'changes', '{"fields": [{"field": "name", "from": "Otávio", "to": "Otávio Antigo"}, {"field": "mobile_whatsapp"}]}'::jsonb,
                       'fields', ARRAY['name', 'mobile_whatsapp'], 'v1', 'Atualizou o membro Otávio Antigo'),
    jsonb_build_object('entity', 'member', 'action', 'update', 'actor', 'member', 'label', 'Otávio Antigo', 'desc', 'Alterou o membro Otávio Antigo',
                       'changes', jsonb_build_object('fields', jsonb_build_array(
                         jsonb_build_object('field', 'leader_id', 'from', 'Ana Antiga', 'to', 'Davi Antigo', 'from_id', pg_temp.m(2), 'to_id', pg_temp.m(3)),
                         jsonb_build_object('field', 'is_active', 'from', true, 'to', false))),
                       'fields', ARRAY['leader_id', 'is_active'], 'v1', 'Atualizou o membro Otávio Antigo')),
  'DT-11/RN-20: membro: "Cadastrou"/"Alterou", campos da lista no tipo dela, referências com o nome de hoje, campo calculado fora');
SELECT is(pg_temp.ev_of(pg_temp.c(1)) -> 1,
  '{"entity": "cell", "action": "update", "actor": "member", "label": "Célula de Davi Antigo", "desc": "Alterou a célula de Davi Antigo",
    "changes": {"fields": [{"field": "meeting_time", "from": "19:00:00", "to": "20:00:00"}, {"field": "is_active", "from": true, "to": false}]},
    "fields": ["meeting_time", "is_active"], "v1": "Atualizou a célula de Davi Antigo"}'::jsonb,
  'DT-11: célula: "Alterou", "Célula de …" no registro, hora e situação no tipo da lista');
SELECT is(pg_temp.ev_of(pg_temp.r(1)),
  '[{"entity": "cell_report", "action": "create", "actor": "member", "label": "Relatório de 02/11/2026 da célula de Davi Antigo",
     "desc": "Enviou o relatório de 02/11/2026 da célula de Davi Antigo", "changes": {"fields": []}, "fields": null,
     "v1": "Registrou o relatório da célula de Davi Antigo em 2026-11-02"},
    {"entity": "cell_report", "action": "update", "actor": "member", "label": "Relatório de 02/11/2026 da célula de Davi Antigo",
     "desc": "Incluiu Otávio Antigo no relatório de 02/11/2026 da célula de Davi Antigo",
     "changes": {"fields": [], "participants": {"added": [{"id": "c2050500-0000-0000-0000-000000000005", "name": "Otávio Antigo"}], "removed": []}},
     "fields": null, "v1": "Adicionou Otávio Antigo ao relatório da célula de Davi Antigo em 2026-11-02"},
    {"entity": "cell_report", "action": "update", "actor": "member", "label": "Relatório de 02/11/2026 da célula de Davi Antigo",
     "desc": "Alterou o relatório de 02/11/2026 da célula de Davi Antigo", "changes": {"fields": [{"field": "offering", "from": 50.00, "to": 80.00}]},
     "fields": ["offering"], "v1": "Atualizou o relatório da célula de Davi Antigo em 2026-11-02"},
    {"entity": "cell_report", "action": "update", "actor": "member", "label": "Relatório de 02/11/2026 da célula de Davi Antigo",
     "desc": "Retirou Paula Antiga do relatório de 02/11/2026 da célula de Davi Antigo",
     "changes": {"fields": [], "participants": {"added": [], "removed": [{"id": "c2050500-0000-0000-0000-000000000006", "name": "Paula Antiga"}]}},
     "fields": null, "v1": "Removeu Paula Antiga do relatório da célula de Davi Antigo em 2026-11-02"}]'::jsonb,
  'DT-11/P-AUD-24: relatório: "Enviou", dd/mm/aaaa, e os participantes viram alterações do relatório ("Incluiu", "Retirou")');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity = 'cell_report_participant' AND entity_id::text LIKE 'e2050500%'), 0,
  'RN-20 f: nenhum evento de participante fica como entidade própria');
SELECT is((SELECT metadata -> 'v1' FROM public.events WHERE entity_id = pg_temp.r(1) AND metadata #>> '{v1,entity}' = 'cell_report_participant' AND metadata #>> '{v1,action}' = 'delete'),
  '{"action": "delete", "entity": "cell_report_participant", "entity_label": "relatório da célula de Davi Antigo em 2026-11-02",
    "description": "Removeu Paula Antiga do relatório da célula de Davi Antigo em 2026-11-02", "changed_fields": null}'::jsonb,
  'DT-11: o original fica em metadata.v1');
SELECT is((SELECT jsonb_agg(jsonb_build_object('a', action, 'k', actor_kind) ORDER BY action::text) FROM public.events
            WHERE entity = 'auth' AND occurred_at > now() - interval '3 days' AND occurred_at < now() - interval '1 day'
              AND (actor_user_id = pg_temp.u(2) OR error_reason = 'Identificação não encontrada')),
  '[{"a": "login", "k": "member"}, {"a": "login_failed", "k": "none"}]'::jsonb,
  'AQ-6: login com autor é "member"; sem autor, na autenticação, "none"');
SELECT is((SELECT actor_kind::text || '|' || description FROM public.events WHERE entity_id = pg_temp.m(8) AND action = 'delete'),
  'system|Excluiu o membro Wagner Antigo', 'DA-2: evento de dados sem autor é "Sistema"');
SELECT is((SELECT description || '|' || coalesce(metadata::text, '-') FROM public.events WHERE entity_id = pg_temp.m(6)),
  'Formato estranho|-', 'DT-11: o que não casa fica como está, sem metadata.v1');
SELECT is((SELECT count(*)::int FROM public.events WHERE entity <> 'auth' AND (description ~ '\d{4}-\d{2}-\d{2}' OR entity_label ~ '\d{4}-\d{2}-\d{2}')), 0,
  'RN-20 e: nenhuma descrição ou registro convertido com data aaaa-mm-dd');
CREATE TEMP TABLE conv1 AS SELECT md5(string_agg(to_jsonb(e)::text, ';' ORDER BY e.id)) AS h FROM public.events e;
SELECT is(private.audit_convert_v1_events(), 0, 'DT-11: rodar de novo não encontra nada a converter');

-- ===========================================================================
-- 2. RN-12 e DA-3: a autoria dos registros que já existem — 11
-- ===========================================================================
SET LOCAL session_replication_role = replica;
SELECT private.audit_backfill_authorship();
SET LOCAL session_replication_role = origin;
SELECT is(pg_temp.au('members', pg_temp.m(5)),
  jsonb_build_object('ck', 'member', 'cb', pg_temp.m(2), 'uk', 'member', 'ub', pg_temp.m(3),
                     'u', (SELECT to_jsonb(occurred_at) FROM public.events WHERE entity_id = pg_temp.m(5) AND changed_fields @> '{leader_id}'),
                     'dk', NULL, 'db', NULL),
  'RN-12: Otávio: cadastro de Ana (o evento de cadastro), última alteração de Davi (o último evento)');
SELECT is(pg_temp.au('members', pg_temp.m(6)) - 'u',
  '{"ck": "unknown", "cb": null, "uk": "system", "ub": null, "dk": null, "db": null}'::jsonb,
  'RN-12: Paula: sem evento de cadastro, "autor não registrado"; a última alteração é o evento que há (sem autor: "Sistema")');
SELECT is(pg_temp.au('members', pg_temp.m(7)) - 'u',
  jsonb_build_object('ck', 'member', 'cb', pg_temp.m(2), 'uk', 'member', 'ub', pg_temp.m(2), 'dk', 'member', 'db', pg_temp.m(2)),
  'RN-12: Zeca (excluído por Ana, E2.01): exclusão "member" pelo deleted_by; a última alteração é a exclusão');
SELECT is(pg_temp.au('members', pg_temp.m(8)) - 'u',
  '{"ck": "unknown", "cb": null, "uk": "system", "ub": null, "dk": "system", "db": null}'::jsonb,
  'RN-12: Wagner (excluído sem autor): exclusão "Sistema", pelo último delete');
SELECT is(pg_temp.au('members', pg_temp.m(10)),
  '{"ck": "unknown", "cb": null, "uk": null, "ub": null, "u": null, "dk": null, "db": null}'::jsonb,
  'RN-12: Vera: a conta do evento de cadastro não leva a nenhum cadastro: "autor não registrado"; sem evento de alteração, só o cadastro');
SELECT is(pg_temp.au('members', pg_temp.m(11)) ->> 'ck', 'system', 'DA-2: Sérgio: o evento de cadastro sem autor dá "Sistema"');
SELECT is(pg_temp.au('cells', pg_temp.c(1)) - 'u',
  jsonb_build_object('ck', 'member', 'cb', pg_temp.m(2), 'uk', 'member', 'ub', pg_temp.m(3), 'dk', NULL, 'db', NULL),
  'RN-12: a célula, com quem cadastrou e quem alterou');
SELECT is(pg_temp.au('cell_reports', pg_temp.r(1)),
  jsonb_build_object('ck', 'member', 'cb', pg_temp.m(3), 'uk', 'member', 'ub', pg_temp.m(2), 'u', to_jsonb('2026-11-03 10:00-03'::timestamptz), 'dk', NULL, 'db', NULL),
  'RN-12/DA-3: o relatório 1: enviado por Davi; a retirada de Ana depois conta como a última alteração');
SELECT is(pg_temp.au('cell_reports', pg_temp.r(2)),
  jsonb_build_object('ck', 'member', 'cb', pg_temp.m(3), 'uk', NULL, 'ub', NULL, 'u', NULL, 'dk', NULL, 'db', NULL),
  'DA-3: o relatório 2: os participantes de Davi até 60 s depois do envio fazem parte dele (só "Enviado por")');
CREATE TEMP TABLE bf1 AS SELECT md5(string_agg(to_jsonb(m)::text, ';' ORDER BY m.id)) AS h FROM public.members m;
SET LOCAL session_replication_role = replica;
SELECT private.audit_backfill_authorship();
SET LOCAL session_replication_role = origin;
SELECT is((SELECT md5(string_agg(to_jsonb(m)::text, ';' ORDER BY m.id)) FROM public.members m), (SELECT h FROM bf1),
  'RN-12: rodar de novo não muda nada (só preenche o que está vazio)');
SELECT is((SELECT md5(string_agg(to_jsonb(e)::text, ';' ORDER BY e.id)) FROM public.events e), (SELECT h FROM conv1),
  'DT-11: e os eventos continuam iguais');

-- As regras da migration 5 voltam e valem para a massa convertida.
DO $$
DECLARE _t text;
BEGIN
  ALTER TABLE public.events ALTER COLUMN actor_kind SET NOT NULL;
  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_by_kind SET DEFAULT ''system'', ALTER COLUMN created_by_kind SET NOT NULL', _t);
    EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
          (created_by_kind = 'member') = (created_by IS NOT NULL)
      AND (created_by_kind = 'legacy') = (created_by_legacy IS NOT NULL)
      AND (created_at IS NOT NULL OR created_by_kind IN ('legacy', 'unknown')))$c$, _t, _t || '_created_authorship_check');
    EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
          (updated_at IS NULL) = (updated_by_kind IS NULL)
      AND coalesce(updated_by_kind = 'member', false) = (updated_by IS NOT NULL)
      AND coalesce(updated_by_kind = 'legacy', false) = (updated_by_legacy IS NOT NULL))$c$, _t, _t || '_updated_authorship_check');
    EXECUTE format($c$ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (
          (deleted_at IS NOT NULL OR (deleted_by_kind IS NULL AND deleted_by_legacy IS NULL))
      AND (deleted_by_kind IS NULL OR (deleted_by_kind = 'member') = (deleted_by IS NOT NULL))
      AND (deleted_by_kind IS NULL OR (deleted_by_kind = 'legacy') = (deleted_by_legacy IS NOT NULL))
      AND (deleted_by_legacy IS NULL OR deleted_by_kind = 'legacy'))$c$, _t, _t || '_deleted_authorship_check');
  END LOOP;
END $$;
SELECT pass('RN-12: os NOT NULL e os CHECKs de autoria aceitam a massa convertida');

-- ===========================================================================
-- 3. RN-13: a última alteração é a do último evento; a autoria fica sem os eventos — 3
-- ===========================================================================
-- Correspondência: para cada registro alterado da massa, o último evento de alteração, exclusão ou
-- restauração tem o mesmo momento e o mesmo autor (os participantes do envio, DA-3, não contam).
CREATE FUNCTION pg_temp.mismatch() RETURNS SETOF text LANGUAGE sql AS $$
  WITH rec AS (
    SELECT 'member'::public.event_entity AS entity, id, updated_at, updated_by, updated_by_kind FROM public.members WHERE id::text LIKE 'c2050500%'
    UNION ALL SELECT 'cell', id, updated_at, updated_by, updated_by_kind FROM public.cells WHERE id::text LIKE 'd2050500%'
    UNION ALL SELECT 'cell_report', id, updated_at, updated_by, updated_by_kind FROM public.cell_reports WHERE id::text LIKE 'e2050500%'
  ), le AS (
    SELECT DISTINCT ON (e.entity, e.entity_id) e.entity, e.entity_id, e.occurred_at, e.actor_kind,
           (SELECT m.id FROM public.members m WHERE m.auth_user_id = e.actor_user_id LIMIT 1) AS member_id
      FROM public.events e
     WHERE e.action IN ('update', 'delete', 'restore')
       AND NOT (e.metadata #>> '{v1,entity}' = 'cell_report_participant'
                AND EXISTS (SELECT 1 FROM public.events c WHERE c.entity = e.entity AND c.entity_id = e.entity_id AND c.action = 'create'
                              AND c.actor_user_id IS NOT DISTINCT FROM e.actor_user_id
                              AND e.occurred_at BETWEEN c.occurred_at AND c.occurred_at + interval '60 seconds'))
     ORDER BY e.entity, e.entity_id, e.occurred_at DESC, e.seq DESC
  )
  SELECT r.entity || ':' || r.id
    FROM rec r LEFT JOIN le ON le.entity = r.entity AND le.entity_id = r.id
   WHERE r.updated_at IS DISTINCT FROM le.occurred_at
      OR r.updated_by IS DISTINCT FROM le.member_id
$$;
SELECT is(ARRAY(SELECT pg_temp.mismatch()), '{}'::text[], 'RN-13 b: na massa convertida, a última alteração é a do último evento');
-- Gravações novas sobre a massa (alteração, exclusão, restauração e participante).
SELECT set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(2), 'role', 'authenticated')::text, true);
UPDATE public.members SET notes = 'nova' WHERE id = pg_temp.m(6);
SELECT public.restore_member(pg_temp.m(8));
UPDATE public.cells SET neighborhood = 'Centro' WHERE id = pg_temp.c(1);
SELECT public.set_cell_report_participants(pg_temp.r(2), ARRAY[pg_temp.m(5), pg_temp.m(6)]);
SELECT set_config('request.jwt.claims', '', true);
SELECT is(ARRAY(SELECT pg_temp.mismatch()), '{}'::text[], 'RN-13 b: depois de alterações, restauração e participantes novos, continua igual');
CREATE TEMP TABLE au0 AS SELECT pg_temp.au('members', pg_temp.m(5)) AS a;
DELETE FROM public.events WHERE entity_id = pg_temp.m(5);
SELECT is(pg_temp.au('members', pg_temp.m(5)), (SELECT a FROM au0), 'RN-13 d: a autoria fica no registro depois que os eventos saem');

-- ===========================================================================
-- 4. RN-17: prazo de guarda — 4
-- ===========================================================================
DELETE FROM public.events;
INSERT INTO public.events (occurred_at, actor_kind, action, entity, description, success) VALUES
  (now() - interval '89 days', 'none', 'login_failed', 'auth', 'f89', false),
  (now() - interval '92 days', 'none', 'login_failed', 'auth', 'f92', false),
  (now() - interval '92 days', 'member', 'password_reset_refused', 'auth', 'r92', false),
  (now() - interval '360 days', 'member', 'login', 'auth', 'l360', true),
  (now() - interval '368 days', 'member', 'logout', 'auth', 'l368', true),
  (now() - interval '2 years' + interval '1 day', 'system', 'update', 'member', 'u729', true),
  (now() - interval '2 years' - interval '2 days', 'system', 'update', 'member', 'u732', true),
  (now() - interval '2 years' - interval '2 days', 'member', 'password_reset', 'auth', 'p732', true),
  (now() - interval '300 days', 'member', 'password_changed', 'auth', 'p300', true);
SELECT is(private.audit_purge(), 5, 'RN-17: a limpeza remove os 5 que passaram do prazo');
SELECT is((SELECT array_agg(description ORDER BY description) FROM public.events), ARRAY['f89', 'l360', 'p300', 'u729'],
  'RN-17: ficam a falha de 89 dias, o login de 360, a senha alterada de 300 e a alteração de 2 anos menos 1 dia');
SELECT is(ARRAY[private.audit_retention('login_blocked'), private.audit_retention('password_change_blocked'),
                private.audit_retention('logout'), private.audit_retention('password_change_required'), private.audit_retention('restore')],
  ARRAY[interval '90 days', interval '90 days', interval '1 year', interval '2 years', interval '2 years'],
  'RN-17/DA-9: os prazos por ação (as demais, 2 anos)');
SELECT is(private.audit_purge(), 0, 'RN-17: rodar de novo não remove mais nada');

SELECT * FROM finish();
ROLLBACK;
