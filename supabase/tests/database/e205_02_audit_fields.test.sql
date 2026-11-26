-- GERADO por supabase/tests/fixtures/generate-audit-fields.mjs a partir de
-- supabase/tests/fixtures/audit-fields.json. NÃO EDITE À MÃO: mude o JSON e rode
--   node supabase/tests/fixtures/generate-audit-fields.mjs
-- (um teste do Vitest falha se este arquivo ficar desatualizado).
--
-- E2.05 (PR 1), DT-06: a lista única de campos (private.audit_fields) igual ao JSON; o teste de
-- classificação (toda coluna das seis tabelas é dado ou está na lista de "não é dado"); o UPDATE OF
-- dos triggers igual à lista (risco 2). Spec: docs/specs/e2-05-auditoria-autor.md, RN-04, RN-13 c,
-- RN-20 b. Rodar com: supabase test db
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

SELECT results_eq(
  $$ SELECT entity::text, field, show_values, value_type, position::int FROM private.audit_fields ORDER BY entity::text, position $$,
  $$ SELECT * FROM (VALUES
    ('member', 'name', true, 'text', 1),
    ('member', 'gender', true, 'text', 2),
    ('member', 'birth_date', false, 'date', 3),
    ('member', 'cpf', false, 'text', 4),
    ('member', 'email', false, 'text', 5),
    ('member', 'mobile_whatsapp', false, 'text', 6),
    ('member', 'phone', false, 'text', 7),
    ('member', 'instagram', false, 'text', 8),
    ('member', 'avatar_url', false, 'text', 9),
    ('member', 'notes', false, 'text', 10),
    ('member', 'zip_code', false, 'text', 11),
    ('member', 'street', false, 'text', 12),
    ('member', 'number', false, 'text', 13),
    ('member', 'complement', false, 'text', 14),
    ('member', 'neighborhood', false, 'text', 15),
    ('member', 'city', false, 'text', 16),
    ('member', 'state', false, 'text', 17),
    ('member', 'leader_id', true, 'member', 18),
    ('member', 'has_leadership', true, 'boolean', 19),
    ('member', 'is_pastor', true, 'boolean', 20),
    ('member', 'spouse_id', true, 'member', 21),
    ('member', 'is_baptized', true, 'boolean', 22),
    ('member', 'baptism_date', false, 'date', 23),
    ('member', 'is_active', true, 'boolean', 24),
    ('member', 'role_id', true, 'role', 25),
    ('cell', 'leader_id', true, 'member', 1),
    ('cell', 'timothy_id', true, 'member', 2),
    ('cell', 'host_id', true, 'member', 3),
    ('cell', 'type', true, 'text', 4),
    ('cell', 'meeting_day', true, 'text', 5),
    ('cell', 'meeting_time', true, 'time', 6),
    ('cell', 'neighborhood', true, 'text', 7),
    ('cell', 'city', true, 'text', 8),
    ('cell', 'zip_code', false, 'text', 9),
    ('cell', 'street', false, 'text', 10),
    ('cell', 'number', false, 'text', 11),
    ('cell', 'complement', false, 'text', 12),
    ('cell', 'state', false, 'text', 13),
    ('cell', 'is_active', true, 'boolean', 14),
    ('cell_report', 'cell_id', true, 'cell', 1),
    ('cell_report', 'date', true, 'date', 2),
    ('cell_report', 'time', true, 'time', 3),
    ('cell_report', 'was_held', true, 'boolean', 4),
    ('cell_report', 'theme', true, 'text', 5),
    ('cell_report', 'reason_not_held', true, 'text', 6),
    ('cell_report', 'offering', true, 'number', 7),
    ('cell_report', 'observations', false, 'text', 8),
    ('cell_report', 'visitors', false, 'text_list', 9),
    ('role', 'name', true, 'text', 1),
    ('role', 'description', false, 'text', 2)
  ) v (entity, field, show_values, value_type, position) ORDER BY entity, position $$,
  'DT-06: private.audit_fields é igual ao JSON (campo, valor, tipo e ordem)');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
    WHERE a.attrelid = 'public.members'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname::text <> ALL (ARRAY['name', 'gender', 'birth_date', 'cpf', 'email', 'mobile_whatsapp', 'phone', 'instagram', 'avatar_url', 'notes', 'zip_code', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'leader_id', 'has_leadership', 'is_pastor', 'spouse_id', 'is_baptized', 'baptism_date', 'is_active', 'role_id', 'id', 'auth_user_id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy']::text[])),
  NULL,
  'classificação: toda coluna de members está na lista de campos ou na de "não é dado"');

SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['name', 'gender', 'birth_date', 'cpf', 'email', 'mobile_whatsapp', 'phone', 'instagram', 'avatar_url', 'notes', 'zip_code', 'street', 'number', 'complement', 'neighborhood', 'city', 'state', 'leader_id', 'has_leadership', 'is_pastor', 'spouse_id', 'is_baptized', 'baptism_date', 'is_active', 'role_id', 'id', 'auth_user_id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy']::text[]) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.members'::regclass
                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),
  NULL,
  'classificação: as duas listas de members só citam colunas que existem');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = 'zz_stamp_authorship'),
  ARRAY['avatar_url', 'baptism_date', 'birth_date', 'city', 'complement', 'cpf', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy', 'email', 'gender', 'has_leadership', 'instagram', 'is_active', 'is_baptized', 'is_pastor', 'leader_id', 'mobile_whatsapp', 'name', 'neighborhood', 'notes', 'number', 'phone', 'role_id', 'spouse_id', 'state', 'street', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'zip_code']::text[],
  'DT-05: o UPDATE OF do zz_stamp_authorship de members é a lista mais as colunas de autoria e de exclusão');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = 'aa_audit_record'),
  ARRAY['avatar_url', 'baptism_date', 'birth_date', 'city', 'complement', 'cpf', 'deleted_at', 'email', 'gender', 'has_leadership', 'instagram', 'is_active', 'is_baptized', 'is_pastor', 'leader_id', 'mobile_whatsapp', 'name', 'neighborhood', 'notes', 'number', 'phone', 'role_id', 'spouse_id', 'state', 'street', 'zip_code']::text[],
  'DT-06: o UPDATE OF do aa_audit_record de members é a lista mais deleted_at');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
    WHERE a.attrelid = 'public.cells'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname::text <> ALL (ARRAY['leader_id', 'timothy_id', 'host_id', 'type', 'meeting_day', 'meeting_time', 'neighborhood', 'city', 'zip_code', 'street', 'number', 'complement', 'state', 'is_active', 'id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy']::text[])),
  NULL,
  'classificação: toda coluna de cells está na lista de campos ou na de "não é dado"');

SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['leader_id', 'timothy_id', 'host_id', 'type', 'meeting_day', 'meeting_time', 'neighborhood', 'city', 'zip_code', 'street', 'number', 'complement', 'state', 'is_active', 'id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy']::text[]) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.cells'::regclass
                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),
  NULL,
  'classificação: as duas listas de cells só citam colunas que existem');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'zz_stamp_authorship'),
  ARRAY['city', 'complement', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy', 'host_id', 'is_active', 'leader_id', 'meeting_day', 'meeting_time', 'neighborhood', 'number', 'state', 'street', 'timothy_id', 'type', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'zip_code']::text[],
  'DT-05: o UPDATE OF do zz_stamp_authorship de cells é a lista mais as colunas de autoria e de exclusão');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'aa_audit_record'),
  ARRAY['city', 'complement', 'deleted_at', 'host_id', 'is_active', 'leader_id', 'meeting_day', 'meeting_time', 'neighborhood', 'number', 'state', 'street', 'timothy_id', 'type', 'zip_code']::text[],
  'DT-06: o UPDATE OF do aa_audit_record de cells é a lista mais deleted_at');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
    WHERE a.attrelid = 'public.cell_reports'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname::text <> ALL (ARRAY['cell_id', 'date', 'time', 'was_held', 'theme', 'reason_not_held', 'offering', 'observations', 'visitors', 'id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy', 'snapshot_leader_id', 'snapshot_timothy_id', 'snapshot_host_id', 'snapshot_cell_type']::text[])),
  NULL,
  'classificação: toda coluna de cell_reports está na lista de campos ou na de "não é dado"');

SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['cell_id', 'date', 'time', 'was_held', 'theme', 'reason_not_held', 'offering', 'observations', 'visitors', 'id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy', 'snapshot_leader_id', 'snapshot_timothy_id', 'snapshot_host_id', 'snapshot_cell_type']::text[]) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.cell_reports'::regclass
                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),
  NULL,
  'classificação: as duas listas de cell_reports só citam colunas que existem');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.cell_reports'::regclass AND t.tgname = 'zz_stamp_authorship'),
  ARRAY['cell_id', 'created_at', 'created_by', 'created_by_kind', 'created_by_legacy', 'date', 'deleted_at', 'deleted_by', 'deleted_by_kind', 'deleted_by_legacy', 'observations', 'offering', 'reason_not_held', 'theme', 'time', 'updated_at', 'updated_by', 'updated_by_kind', 'updated_by_legacy', 'visitors', 'was_held']::text[],
  'DT-05: o UPDATE OF do zz_stamp_authorship de cell_reports é a lista mais as colunas de autoria e de exclusão');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.cell_reports'::regclass AND t.tgname = 'aa_audit_record'),
  ARRAY['cell_id', 'date', 'deleted_at', 'observations', 'offering', 'reason_not_held', 'theme', 'time', 'visitors', 'was_held']::text[],
  'DT-06: o UPDATE OF do aa_audit_record de cell_reports é a lista mais deleted_at');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
    WHERE a.attrelid = 'public.roles'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname::text <> ALL (ARRAY['name', 'description', 'id', 'is_system', 'is_default', 'created_at', 'updated_at']::text[])),
  NULL,
  'classificação: toda coluna de roles está na lista de campos ou na de "não é dado"');

SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['name', 'description', 'id', 'is_system', 'is_default', 'created_at', 'updated_at']::text[]) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.roles'::regclass
                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),
  NULL,
  'classificação: as duas listas de roles só citam colunas que existem');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
    WHERE a.attrelid = 'public.cell_report_participants'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname::text <> ALL (ARRAY['report_id', 'member_id']::text[])),
  NULL,
  'classificação: toda coluna de cell_report_participants está na lista de campos ou na de "não é dado"');

SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['report_id', 'member_id']::text[]) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.cell_report_participants'::regclass
                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),
  NULL,
  'classificação: as duas listas de cell_report_participants só citam colunas que existem');

SELECT is(
  (SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
    WHERE a.attrelid = 'public.role_permissions'::regclass AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attname::text <> ALL (ARRAY['id', 'role_id', 'permission']::text[])),
  NULL,
  'classificação: toda coluna de role_permissions está na lista de campos ou na de "não é dado"');

SELECT is(
  (SELECT array_agg(c ORDER BY c) FROM unnest(ARRAY['id', 'role_id', 'permission']::text[]) c
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.role_permissions'::regclass
                       AND a.attname::text = c AND a.attnum > 0 AND NOT a.attisdropped)),
  NULL,
  'classificação: as duas listas de role_permissions só citam colunas que existem');

SELECT is((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_trigger t JOIN pg_attribute a ON a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[]) WHERE t.tgrelid = 'public.roles'::regclass AND t.tgname = 'aa_audit_role'),
  ARRAY['description', 'is_default', 'name']::text[],
  'RN-15: o UPDATE OF do aa_audit_role é a lista da função mais is_default (a troca da padrão)');

SELECT * FROM finish();
ROLLBACK;
