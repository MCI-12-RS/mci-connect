-- E2.05 (PR 1, migration 2 de 6) — Auditoria: estrutura. Ver docs/specs/e2-05-auditoria-autor.md
-- no repositório apps-mci ("DDL de referência (migration 2)", "Lista única de campos",
-- "Integridade garantida pelo banco"; RN-01, RN-03, RN-09, RN-10, RN-13, RN-16, RN-18;
-- DT-01 a DT-03, DT-06, DT-10, DT-12, DT-13, DT-21).
--
-- Conteúdo:
--   0. Guarda de pré-requisito (E2.02, E1.04, E2.03 e E2.04). Falha cedo, sem mudar nada.
--   1. Colunas de autoria em members, cells e cell_reports (DT-01), ainda sem NOT NULL e sem
--      CHECK (a migration 5 preenche e depois liga as regras). created_at e updated_at passam a
--      anuláveis (DT-02, DT-03); updated_at perde o valor padrão: só o carimbo a define.
--      FKs created_by e updated_by → members, sem cascata e sem índice (DT-21).
--   2. GRANT SELECT por coluna das colunas novas de members (trava por coluna do E1.08). Nenhuma
--      é sensível: são lidas por quem lê a linha, como o deleted_by (DA-11).
--   3. private.audit_fields: a lista única do que é dado (DT-06), com a carga. A mesma lista está
--      em supabase/tests/fixtures/audit-fields.json (o pgTAP gerado confere as duas).
--   4. events: actor_kind, changes, tx_id, seq e search_text (DT-10, DT-12); os índices da
--      Auditoria paginada, do histórico de um registro e da busca (pg_trgm, risco 4); nenhuma escrita
--      pela API (DT-13).
--   5. public.legacy_author_label(text): o nome do autor do legado como a tela mostra (RN-10 b).
--
-- Entre esta migration e a 3, os triggers antigos continuam gravando: os eventos ficam sem
-- actor_kind e são convertidos pela 5.
--
-- Pode rodar de novo sem erro.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.save_role(uuid,text,text,public.permission_action[],boolean,timestamptz)') IS NULL
     OR to_regprocedure('public.my_access()') IS NULL
     OR to_regclass('private.sign_in_throttle') IS NULL                       -- E1.04 (e o pg_cron)
     OR to_regclass('private.account_passwords') IS NULL                      -- E2.03
     OR to_regprocedure('private.assert_gate()') IS NULL                      -- E2.03 (PR 4, portão)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                     WHERE tgname = 'a0_normalize_member'
                       AND tgrelid = 'public.members'::regclass) THEN         -- E2.04
    RAISE EXCEPTION 'E2.05 depende do E2.02, do E1.04, do E2.03 e do E2.04 em produção.';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. Autoria (DT-01): o mesmo bloco para as três tabelas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    EXECUTE format($f$
      ALTER TABLE public.%1$I
        ADD COLUMN IF NOT EXISTS created_by        uuid,
        ADD COLUMN IF NOT EXISTS created_by_kind   public.author_kind,
        ADD COLUMN IF NOT EXISTS created_by_legacy text,
        ADD COLUMN IF NOT EXISTS updated_by        uuid,
        ADD COLUMN IF NOT EXISTS updated_by_kind   public.author_kind,
        ADD COLUMN IF NOT EXISTS updated_by_legacy text,
        ADD COLUMN IF NOT EXISTS deleted_by_kind   public.author_kind,
        ADD COLUMN IF NOT EXISTS deleted_by_legacy text,
        ALTER COLUMN created_at DROP NOT NULL,
        ALTER COLUMN updated_at DROP NOT NULL,
        ALTER COLUMN updated_at DROP DEFAULT
    $f$, _t);
    BEGIN
      EXECUTE format('ALTER TABLE public.%1$I ADD CONSTRAINT %2$I FOREIGN KEY (created_by) REFERENCES public.members (id)',
                     _t, _t || '_created_by_fkey');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%1$I ADD CONSTRAINT %2$I FOREIGN KEY (updated_by) REFERENCES public.members (id)',
                     _t, _t || '_updated_by_fkey');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END;
$$;

COMMENT ON COLUMN public.members.updated_at IS
  'E2.05 (DT-02): a última alteração de dados (RN-04), definida só pelo carimbo zz_stamp_authorship. Nula: só o cadastro.';
COMMENT ON COLUMN public.cells.updated_at IS
  'E2.05 (DT-02): a última alteração de dados (RN-04), definida só pelo carimbo zz_stamp_authorship. Nula: só o cadastro.';
COMMENT ON COLUMN public.cell_reports.updated_at IS
  'E2.05 (DT-02): a última alteração de dados (RN-04, inclusive participantes), definida só pelo carimbo. Nula: só o envio.';

-- ---------------------------------------------------------------------------
-- 2. Colunas novas de members legíveis por quem lê a linha (trava por coluna do E1.08)
-- ---------------------------------------------------------------------------
GRANT SELECT (created_by, created_by_kind, created_by_legacy, updated_by, updated_by_kind,
              updated_by_legacy, deleted_by_kind, deleted_by_legacy) ON public.members TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Lista única de campos de dados (DT-06)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.audit_fields (
  entity      public.event_entity NOT NULL,
  field       text     NOT NULL,                     -- nome da coluna; é a chave estável da tela
  show_values boolean  NOT NULL,                     -- RN-20 (b): antes → depois
  value_type  text     NOT NULL CHECK (value_type IN
                ('text', 'text_list', 'boolean', 'date', 'time', 'number', 'member', 'role', 'cell')),
  position    smallint NOT NULL,                     -- ordem em "Campos alterados"
  PRIMARY KEY (entity, field),
  UNIQUE (entity, position)
);
ALTER TABLE private.audit_fields ENABLE ROW LEVEL SECURITY;          -- sem políticas
REVOKE ALL ON TABLE private.audit_fields FROM PUBLIC, anon, authenticated, service_role;

-- A carga (igual a supabase/tests/fixtures/audit-fields.json). Reescrita inteira a cada execução.
DELETE FROM private.audit_fields;
INSERT INTO private.audit_fields (entity, field, show_values, value_type, position)
SELECT x.entity::public.event_entity, x.field, x.show_values, x.value_type, x.position
  FROM (VALUES
    ('member', 'name',            true,  'text',      1),
    ('member', 'gender',          true,  'text',      2),
    ('member', 'birth_date',      false, 'date',      3),
    ('member', 'cpf',             false, 'text',      4),
    ('member', 'email',           false, 'text',      5),
    ('member', 'mobile_whatsapp', false, 'text',      6),
    ('member', 'phone',           false, 'text',      7),
    ('member', 'instagram',       false, 'text',      8),
    ('member', 'avatar_url',      false, 'text',      9),
    ('member', 'notes',           false, 'text',      10),
    ('member', 'zip_code',        false, 'text',      11),
    ('member', 'street',          false, 'text',      12),
    ('member', 'number',          false, 'text',      13),
    ('member', 'complement',      false, 'text',      14),
    ('member', 'neighborhood',    false, 'text',      15),
    ('member', 'city',            false, 'text',      16),
    ('member', 'state',           false, 'text',      17),
    ('member', 'leader_id',       true,  'member',    18),
    ('member', 'has_leadership',  true,  'boolean',   19),
    ('member', 'is_pastor',       true,  'boolean',   20),
    ('member', 'spouse_id',       true,  'member',    21),
    ('member', 'is_baptized',     true,  'boolean',   22),
    ('member', 'baptism_date',    false, 'date',      23),
    ('member', 'is_active',       true,  'boolean',   24),
    ('member', 'role_id',         true,  'role',      25),
    ('cell', 'leader_id',         true,  'member',    1),
    ('cell', 'timothy_id',        true,  'member',    2),
    ('cell', 'host_id',           true,  'member',    3),
    ('cell', 'type',              true,  'text',      4),
    ('cell', 'meeting_day',       true,  'text',      5),
    ('cell', 'meeting_time',      true,  'time',      6),
    ('cell', 'neighborhood',      true,  'text',      7),
    ('cell', 'city',              true,  'text',      8),
    ('cell', 'zip_code',          false, 'text',      9),
    ('cell', 'street',            false, 'text',      10),
    ('cell', 'number',            false, 'text',      11),
    ('cell', 'complement',        false, 'text',      12),
    ('cell', 'state',             false, 'text',      13),
    ('cell', 'is_active',         true,  'boolean',   14),
    ('cell_report', 'cell_id',         true,  'cell',      1),
    ('cell_report', 'date',            true,  'date',      2),
    ('cell_report', 'time',            true,  'time',      3),
    ('cell_report', 'was_held',        true,  'boolean',   4),
    ('cell_report', 'theme',           true,  'text',      5),
    ('cell_report', 'reason_not_held', true,  'text',      6),
    ('cell_report', 'offering',        true,  'number',    7),
    ('cell_report', 'observations',    false, 'text',      8),
    ('cell_report', 'visitors',        false, 'text_list', 9),
    ('role', 'name',              true,  'text',      1),
    ('role', 'description',       false, 'text',      2)
  ) AS x (entity, field, show_values, value_type, position);

-- ---------------------------------------------------------------------------
-- 4. Eventos (DT-10, DT-12, DT-13)
-- ---------------------------------------------------------------------------
-- tx_id sem valor padrão no ADD (as linhas de antes ficam nulas, sem reescrever com o id da
-- transação da migration); o padrão vem logo depois.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS actor_kind public.event_actor_kind,         -- NOT NULL na migration 5
  ADD COLUMN IF NOT EXISTS changes    jsonb,
  ADD COLUMN IF NOT EXISTS tx_id      xid8,
  ADD COLUMN IF NOT EXISTS seq        bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE public.events ALTER COLUMN tx_id SET DEFAULT pg_current_xact_id();
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS search_text text GENERATED ALWAYS AS (
    public.search_normalize(
      coalesce(CASE WHEN actor_kind = 'system' THEN 'Sistema' END, actor_label, '')
      || ' ' || coalesce(entity_label, '') || ' ' || coalesce(description, ''))) STORED;

COMMENT ON COLUMN public.events.tx_id IS
  'E2.05 (DT-08): a transação que gravou o evento. Um evento por transação e registro: as gravações seguintes se fundem nele.';
COMMENT ON COLUMN public.events.changes IS
  'E2.05 (DT-10): fields (campos, com os nomes de então), participants, permissions e default_role.';

DROP INDEX IF EXISTS public.events_occurred_at_idx;
CREATE INDEX IF NOT EXISTS events_occurred_at_seq_idx ON public.events (occurred_at DESC, seq DESC);
DROP INDEX IF EXISTS public.events_entity_idx;
CREATE INDEX IF NOT EXISTS events_record_idx ON public.events (entity, entity_id, occurred_at DESC, seq DESC);
-- events_action_idx e events_actor_idx ficam (filtro de ação; o log_auth_event do E1.04 usa o segundo).
-- Risco 4: a busca da Auditoria (ilike por palavra em search_text) passou da meta no volume de
-- referência (cerca de 1 s com 300 mil eventos); o índice de trigramas a leva para dezenas de ms.
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS events_search_trgm_idx ON public.events USING gin (search_text extensions.gin_trgm_ops);

-- Ninguém escreve em events pela API, nem a chave secreta (RN-16). Só a leitura fica, sob a
-- política de SELECT ("Visualizar Auditoria"). Só o dono (postgres) grava, pelas funções definer.
REVOKE ALL ON TABLE public.events FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.events TO authenticated, service_role;
DO $$
DECLARE
  _seq text := pg_get_serial_sequence('public.events', 'seq');
BEGIN
  IF _seq IS NOT NULL THEN
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', _seq);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Nome do autor do legado, como a tela mostra (RN-10 b)
-- ---------------------------------------------------------------------------
-- Sem dado de ninguém: entra na lista fechada do portão (pgTAP e203_06_gate). EXECUTE para
-- authenticated e service_role: as views chamam a função com o papel de quem consulta.
CREATE OR REPLACE FUNCTION public.legacy_author_label(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN btrim(_name) = 'AdminUser' THEN 'Administrador' ELSE nullif(btrim(_name), '') END
$$;
REVOKE ALL ON FUNCTION public.legacy_author_label(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.legacy_author_label(text) TO authenticated, service_role;
