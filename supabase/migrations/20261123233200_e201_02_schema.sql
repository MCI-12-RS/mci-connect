-- E2.01 (PR 1, migration 2 de 4) — Exclusão lógica: colunas, integridade e índices.
-- Ver docs/specs/e2-01-exclusao-logica.md no repositório apps-mci ("Modelo de
-- dados e migrations", DT-01, DT-03, DT-07, DT-13, DT-17, DT-22).
--
-- 0. Guarda: falha cedo, sem mudar nada, se houver dois relatórios não excluídos
--    da mesma célula na mesma semana (o índice único do item 7 não seria criado).
-- 1. deleted_at e deleted_by em members, cells e cell_reports, com o CHECK
--    "autor só com data" e a FK do autor para members (DT-01).
-- 2. FKs sem cascata nem SET NULL (DT-03): uma exclusão física que apagaria
--    histórico passa a falhar. members.role_id e members.auth_user_id continuam
--    ON DELETE SET NULL (funções são configuração; DA-2).
-- 3. normalize_email e normalize_digits: a única normalização de e-mail,
--    celular e CPF (DT-17), usada pela RN-16 (e), pela RN-18 e, no E2.04, pelos
--    índices únicos.
-- 4. Índices de lista do E1.08 passam a parciais (WHERE deleted_at IS NULL),
--    com o MESMO nome (os testes do E1.08 conferem o nome).
-- 5. Índices das listas de excluídos (deleted_at DESC, id).
-- 6. Índice do e-mail da conta de um excluído (RN-18).
-- 7. Um relatório não excluído por célula e semana (REL-03, DEL-03), antecipado
--    do E2.11: cell_reports_cell_week_key.
-- 8. Schema private e a tabela das credenciais suspensas (RN-14, DT-13), fora
--    da API.
-- 9. SELECT por coluna de deleted_at e deleted_by em members (DT-22): o PR 5 do
--    E1.08 trocou o SELECT de tabela por SELECT por coluna; o GRANT por coluna
--    é inofensivo se o SELECT de tabela ainda existir.
--
-- Pode rodar de novo sem erro: IF NOT EXISTS, CREATE OR REPLACE e blocos DO
-- que só mudam o que ainda não está no estado final.

-- ---------------------------------------------------------------------------
-- 0. Guarda de duplicatas da semana (antes de qualquer mudança)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _has_deleted_at boolean;
  _sql text;
  _groups int;
  _list text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.cell_reports'::regclass
       AND attname = 'deleted_at' AND attnum > 0 AND NOT attisdropped
  ) INTO _has_deleted_at;

  _sql := $q$
    SELECT count(*)::int,
           string_agg(format('(cell_id %s, semana %s, ids %s)', d.cell_id, d.week, d.ids),
                      '; ' ORDER BY d.cell_id, d.week)
      FROM (
        SELECT r.cell_id, public.week_start(r.date) AS week,
               array_agg(r.id ORDER BY r.created_at, r.id)::text AS ids
          FROM public.cell_reports r
  $q$
  || CASE WHEN _has_deleted_at THEN ' WHERE r.deleted_at IS NULL ' ELSE ' ' END
  || $q$
         GROUP BY r.cell_id, public.week_start(r.date)
        HAVING count(*) > 1
      ) d
  $q$;

  EXECUTE _sql INTO _groups, _list;

  IF _groups > 0 THEN
    RAISE EXCEPTION 'E2.01: % grupo(s) de relatórios não excluídos da mesma célula na mesma semana; '
                    'o índice cell_reports_cell_week_key não pode ser criado e nada foi alterado. '
                    'Resolva antes: %', _groups, _list
      USING ERRCODE = 'unique_violation';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 1. Colunas, CHECK e FK do autor (DT-01)
-- ---------------------------------------------------------------------------
-- deleted_by é o membro que excluiu, via viewer_member_id(). Fica nulo quando a
-- exclusão vem da service role ou do legado (E4.02).
ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.cells
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;
ALTER TABLE public.cell_reports
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (deleted_by) REFERENCES public.members (id)',
        _t, _t || '_deleted_by_fkey');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (deleted_by IS NULL OR deleted_at IS NOT NULL)',
        _t, _t || '_deleted_by_check');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END
$$;

COMMENT ON COLUMN public.members.deleted_at IS
  'Exclusão lógica (E2.01). Preenchido só pelas RPCs delete_member/restore_member.';
COMMENT ON COLUMN public.members.deleted_by IS
  'Membro que excluiu (viewer_member_id()); nulo quando vem da service role ou do legado.';
COMMENT ON COLUMN public.cells.deleted_at IS
  'Exclusão lógica (E2.01). Preenchido só pelas RPCs delete_cell/restore_cell.';
COMMENT ON COLUMN public.cells.deleted_by IS
  'Membro que excluiu (viewer_member_id()); nulo quando vem da service role ou do legado.';
COMMENT ON COLUMN public.cell_reports.deleted_at IS
  'Exclusão lógica (E2.01). Preenchido só pelas RPCs delete_cell_report/restore_cell_report.';
COMMENT ON COLUMN public.cell_reports.deleted_by IS
  'Membro que excluiu (viewer_member_id()); nulo quando vem da service role ou do legado.';

-- ---------------------------------------------------------------------------
-- 2. FKs sem cascata nem SET NULL (DT-03, DEL-07)
-- ---------------------------------------------------------------------------
-- A FK é localizada pela coluna (e não só pelo nome) e recriada com o nome
-- padrão e NO ACTION. Se já estiver assim, nada muda.
DO $$
DECLARE
  _spec text[];
  _specs text[] := ARRAY[
    ARRAY['members',                  'leader_id', 'members',      'members_leader_id_fkey'],
    ARRAY['members',                  'spouse_id', 'members',      'members_spouse_id_fkey'],
    ARRAY['cell_reports',             'cell_id',   'cells',        'cell_reports_cell_id_fkey'],
    ARRAY['cell_report_participants', 'report_id', 'cell_reports', 'cell_report_participants_report_id_fkey'],
    ARRAY['cell_report_participants', 'member_id', 'members',      'cell_report_participants_member_id_fkey']
  ];
  _fk record;
  _done boolean;
BEGIN
  FOREACH _spec SLICE 1 IN ARRAY _specs LOOP
    _done := false;
    FOR _fk IN
      SELECT c.conname, c.confdeltype, c.confupdtype
        FROM pg_constraint c
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attname = _spec[2]
       WHERE c.conrelid = format('public.%I', _spec[1])::regclass
         AND c.confrelid = format('public.%I', _spec[3])::regclass
         AND c.contype = 'f'
         AND c.conkey = ARRAY[a.attnum]
    LOOP
      IF NOT _done AND _fk.conname = _spec[4] AND _fk.confdeltype = 'a' AND _fk.confupdtype = 'a' THEN
        _done := true;
      ELSE
        EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', _spec[1], _fk.conname);
      END IF;
    END LOOP;

    IF NOT _done THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES public.%I (id)',
                     _spec[1], _spec[4], _spec[2], _spec[3]);
    END IF;
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- 3. Normalização de e-mail, celular e CPF (DT-17)
-- ---------------------------------------------------------------------------
-- Vazio vira NULL, para nunca combinar dois cadastros sem o dado.
CREATE OR REPLACE FUNCTION public.normalize_email(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT nullif(lower(btrim(_value)), '') $$;

-- Só os dígitos (celular e CPF).
CREATE OR REPLACE FUNCTION public.normalize_digits(_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT nullif(regexp_replace(coalesce(_value, ''), '\D', '', 'g'), '') $$;

-- Usadas em expressão de índice de members: quem grava na tabela (authenticated
-- pela API e service_role pela create-user-admin) precisa de EXECUTE.
REVOKE EXECUTE ON FUNCTION public.normalize_email(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.normalize_digits(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_email(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_digits(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Índices de lista do E1.08 passam a parciais, com o mesmo nome (DT-07)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _name text;
BEGIN
  FOREACH _name IN ARRAY ARRAY['members_name_id_idx', 'cell_reports_date_id_idx',
                               'cell_reports_cell_id_date_idx'] LOOP
    IF EXISTS (
      SELECT 1
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relnamespace = 'public'::regnamespace
         AND c.relname = _name
         AND i.indpred IS NULL
    ) THEN
      EXECUTE format('DROP INDEX public.%I', _name);
    END IF;
  END LOOP;
END
$$;

CREATE INDEX IF NOT EXISTS members_name_id_idx
  ON public.members (name, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cell_reports_date_id_idx
  ON public.cell_reports (date DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cell_reports_cell_id_date_idx
  ON public.cell_reports (cell_id, date DESC) WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Listas de excluídos (RN-15: da exclusão mais recente para a mais antiga)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS members_deleted_at_idx
  ON public.members (deleted_at DESC, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cells_deleted_at_idx
  ON public.cells (deleted_at DESC, id) WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS cell_reports_deleted_at_idx
  ON public.cell_reports (deleted_at DESC, id) WHERE deleted_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 6. RN-18: e-mail da conta de um excluído, consultado a cada cadastro novo
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS members_deleted_account_email_idx
  ON public.members (public.normalize_email(email))
  WHERE deleted_at IS NOT NULL AND auth_user_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. Um relatório não excluído por célula e semana (REL-03, DEL-03; RN-12,
--    RN-17, RN-20). A guarda do item 0 já conferiu as duplicatas.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS cell_reports_cell_week_key
  ON public.cell_reports (cell_id, public.week_start(date))
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 8. Credenciais suspensas (RN-14: "a senha fica guardada para uma eventual
--    restauração"; DT-13). Fora da API: o schema private não é exposto pelo
--    PostgREST, a tabela tem RLS sem políticas e nenhum privilégio para os
--    papéis da API. Só as funções _del_*_access (donas postgres) a usam.
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.member_access_suspensions (
  member_id             uuid PRIMARY KEY REFERENCES public.members (id),
  auth_user_id          uuid NOT NULL,
  encrypted_password    text,          -- o hash de auth.users, como estava
  previous_banned_until timestamptz,   -- normalmente nulo
  suspended_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE private.member_access_suspensions ENABLE ROW LEVEL SECURITY;  -- sem políticas
REVOKE ALL ON TABLE private.member_access_suspensions FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.member_access_suspensions IS
  'E2.01 (RN-14, DT-13): senha e banimento da conta de um membro excluído, guardados para a '
  'restauração. Escrita só por _del_suspend_access e _del_resume_access.';

-- ---------------------------------------------------------------------------
-- 9. SELECT por coluna das colunas novas de members (DT-22)
-- ---------------------------------------------------------------------------
-- Não são sensíveis. O RLS esconde as linhas excluídas, então para quem
-- consulta pela API elas sempre vêm nulas.
GRANT SELECT (deleted_at, deleted_by) ON public.members TO authenticated;
