-- E2.11 (PR 1, migration 1 de 3) — Retrato do relatório e visibilidade pelo retrato. Ver
-- docs/specs/e2-11-lancamento-relatorio.md no repositório apps-mci ("Retrato (migration 1)",
-- "Integridade garantida pelo banco", "Visibilidade pelo retrato (migration 1)"; RN-14, RN-16,
-- RN-21; DT-01, DT-02).
--
-- Conteúdo:
--   0. Guarda de pré-requisitos e de nomes. Falha cedo, sem mudar nada.
--   1. As quatro colunas do retrato em cell_reports (líder, timóteo, anfitrião e tipo).
--   2. Preenchimento dos relatórios que já existem (inclusive os excluídos e os de célula excluída)
--      com as pessoas e o tipo atuais da célula, em replica: não é alteração (RN-04 c do E2.05), não
--      gera evento e não muda updated_at.
--   3. Guarda: nenhum relatório sem retrato válido (só ids na mensagem).
--   4. NOT NULL, FKs sem cascata, CHECK do tipo e índices parciais.
--   5. public.cell_report_snapshot() e o trigger ad_cell_report_snapshot: o retrato vem sempre da
--      célula gravada (uma leitura com FOR SHARE), e o retrato e a célula não mudam depois.
--   6. public.viewer_sees_report_people(...): a regra do relatório por linha, pelas pessoas registradas.
--   7. As views, a partir da definição vigente (20261127200300_e205_04_read.sql para a
--      cell_reports_view e a cell_reports_deleted_view; 20261125140200_e202_03_read.sql para a
--      cell_report_participants_view): o WHERE pelo retrato, as colunas antigas na mesma ordem e as
--      novas no fim. Continuam security definer com security_barrier (armadilha do E1.08).
--   8. Políticas de SELECT e UPDATE de cell_reports pelo retrato, e a visibilidade do relatório dentro de
--      viewer_can_insert_cell_report_participant (a terceira forma do mesmo predicado).
--   9. Sai public.cell_in_viewer_ministry(uuid), sem uso depois do item 8. A viewer_is_cell_person fica:
--      a can_submit_report (sobre a célula, não o relatório) ainda a usa.
--  10. Pós-condições.
--
-- Predicados canônicos do relatório depois desta migration (mudou um, mude os três; o pgTAP de paridade
-- do E2.02 e o e211_01 comparam):
--   | Forma               | Expressão                                                                  |
--   |---------------------|----------------------------------------------------------------------------|
--   | Views (em conjunto) | all_reports OR all_church OR eu ∈ retrato OR ((ministry OR own_reports)    |
--   |                     | AND alguma pessoa do retrato ∈ viewer_ministry_member_ids())               |
--   | Políticas e RPCs    | viewer_sees_report_people(snapshot_leader_id, snapshot_timothy_id,         |
--   |                     | snapshot_host_id)                                                          |
--
-- As mensagens das guardas trazem só ids e nomes de regra (os logs do Actions são públicos).
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos e nomes
-- ===========================================================================
DO $$
BEGIN
  IF to_regprocedure('public.viewer_scope_contains_any(uuid[])') IS NULL            -- E2.02 PR 1
     OR to_regprocedure('public.viewer_sees_cell_people(uuid,uuid,uuid)') IS NULL
     OR to_regprocedure('public.can_submit_report(uuid)') IS NULL
     OR to_regprocedure('private.current_actor()') IS NULL                            -- E2.05 PR 1
     OR to_regprocedure('public.save_cell_report(uuid,jsonb,uuid[])') IS NULL
     OR to_regclass('private.member_hierarchy') IS NULL                               -- E2.06 PR 1
     OR to_regprocedure('public.cell_types()') IS NULL                                -- E2.08 PR 2
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.cell_reports'::regclass
                     AND tgname = 'ac_enforce_cell_report_active')                    -- E2.08 PR 1
     OR to_regprocedure('public.sp_instant(timestamp without time zone)') IS NULL     -- E2.09
     OR has_table_privilege('authenticated', 'public.cell_reports', 'DELETE') THEN    -- E2.01 PR 2
    RAISE EXCEPTION 'E2.11 depende do E2.01, E2.02, E2.05, E2.06, E2.08 e E2.09 em produção.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.cell_reports'::regclass
              AND attname IN ('leader_id', 'timothy_id', 'host_id', 'cell_type') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'E2.11: cell_reports já tem colunas de retrato com outro nome (E4.02?).';
  END IF;
END $$;

-- ===========================================================================
-- 1. Colunas (DT-01). Anuláveis só até o preenchimento abaixo.
-- ===========================================================================
-- Nenhuma delas recebe o trigger de autoria nem o de Auditoria (não são dado: RN-04 c do E2.05; o
-- teste de classificação do E2.05 as lista em "não é dado").
ALTER TABLE public.cell_reports
  ADD COLUMN IF NOT EXISTS snapshot_leader_id  uuid,
  ADD COLUMN IF NOT EXISTS snapshot_timothy_id uuid,
  ADD COLUMN IF NOT EXISTS snapshot_host_id    uuid,
  ADD COLUMN IF NOT EXISTS snapshot_cell_type  text;

-- ===========================================================================
-- 2. Relatórios que já existem (RN-21, P-REL-19)
-- ===========================================================================
-- Inclusive os excluídos e os de célula excluída: as pessoas e o tipo atuais da célula. O ALTER TABLE
-- acima segura cell_reports (ACCESS EXCLUSIVE) até o fim da migration: ninguém grava no meio.
SET LOCAL session_replication_role = replica;
UPDATE public.cell_reports r
   SET snapshot_leader_id  = c.leader_id,
       snapshot_timothy_id = c.timothy_id,
       snapshot_host_id    = c.host_id,
       snapshot_cell_type  = c.type
  FROM public.cells c
 WHERE c.id = r.cell_id
   AND r.snapshot_leader_id IS NULL;
SET LOCAL session_replication_role = origin;

-- ===========================================================================
-- 3. Guarda: nenhum relatório sem retrato válido
-- ===========================================================================
DO $$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(id ORDER BY id) INTO _ids
    FROM public.cell_reports
   WHERE snapshot_leader_id IS NULL OR snapshot_timothy_id IS NULL OR snapshot_host_id IS NULL
      OR snapshot_cell_type IS NULL OR NOT (snapshot_cell_type = ANY (public.cell_types()));
  IF _ids IS NOT NULL THEN
    RAISE EXCEPTION 'E2.11: relatórios sem retrato válido: %', _ids;
  END IF;
END $$;

-- ===========================================================================
-- 4. Integridade (valem também na carga em replica, menos as FKs)
-- ===========================================================================
ALTER TABLE public.cell_reports
  ALTER COLUMN snapshot_leader_id  SET NOT NULL,
  ALTER COLUMN snapshot_timothy_id SET NOT NULL,
  ALTER COLUMN snapshot_host_id    SET NOT NULL,
  ALTER COLUMN snapshot_cell_type  SET NOT NULL;

-- FKs sem cascata (NO ACTION), como o deleted_by (E2.01): o retrato pode apontar para membro excluído.
DO $$ BEGIN
  ALTER TABLE public.cell_reports ADD CONSTRAINT cell_reports_snapshot_leader_id_fkey
    FOREIGN KEY (snapshot_leader_id) REFERENCES public.members (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cell_reports ADD CONSTRAINT cell_reports_snapshot_timothy_id_fkey
    FOREIGN KEY (snapshot_timothy_id) REFERENCES public.members (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cell_reports ADD CONSTRAINT cell_reports_snapshot_host_id_fkey
    FOREIGN KEY (snapshot_host_id) REFERENCES public.members (id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cell_reports ADD CONSTRAINT cell_reports_snapshot_cell_type_check
    CHECK (snapshot_cell_type = ANY (public.cell_types()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Visibilidade e filtros do E2.12 (Líder, G12) pelas pessoas registradas.
CREATE INDEX IF NOT EXISTS cell_reports_snapshot_leader_idx
  ON public.cell_reports (snapshot_leader_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cell_reports_snapshot_timothy_idx
  ON public.cell_reports (snapshot_timothy_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS cell_reports_snapshot_host_idx
  ON public.cell_reports (snapshot_host_id) WHERE deleted_at IS NULL;

-- ===========================================================================
-- 5. Trigger do retrato (DT-02)
-- ===========================================================================
-- BEFORE INSERT OR UPDATE OF cell_id e das colunas do retrato, definer, para todos os papéis. Roda depois
-- do aa_ do E2.01 (célula excluída), do ab_ do E2.02 (escopo) e do ac_ do E2.08 (célula inativa, que já
-- trava a célula com FOR SHARE), e antes dos triggers de semana e do zz_stamp_authorship.
-- ENABLE ALWAYS: dispara também em replica (carga do E4 e massas de teste com datas passadas), mas ali só
-- completa, pela célula, as colunas do retrato que vieram nulas (o retrato do legado, quando vem, fica),
-- e no UPDATE não faz nada (a carga pode corrigir). É a mesma regra do preenchimento do item 2 (RN-21).
CREATE OR REPLACE FUNCTION public.cell_report_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _c record;
BEGIN
  IF current_setting('session_replication_role') = 'replica' THEN
    IF TG_OP = 'INSERT'
       AND (   NEW.snapshot_leader_id IS NULL OR NEW.snapshot_timothy_id IS NULL
            OR NEW.snapshot_host_id IS NULL OR NEW.snapshot_cell_type IS NULL) THEN
      SELECT c.leader_id, c.timothy_id, c.host_id, c.type INTO _c
        FROM public.cells c WHERE c.id = NEW.cell_id;
      IF FOUND THEN                     -- sem célula: o NOT NULL recusa (a FK não vale em replica)
        NEW.snapshot_leader_id  := coalesce(NEW.snapshot_leader_id, _c.leader_id);
        NEW.snapshot_timothy_id := coalesce(NEW.snapshot_timothy_id, _c.timothy_id);
        NEW.snapshot_host_id    := coalesce(NEW.snapshot_host_id, _c.host_id);
        NEW.snapshot_cell_type  := coalesce(NEW.snapshot_cell_type, _c.type);
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.cell_id IS DISTINCT FROM OLD.cell_id THEN                             -- RN-16
      PERFORM public._del_raise('report_cell_immutable', 'A célula de um relatório não pode ser trocada.',
                                jsonb_build_object('cell_id', OLD.cell_id));
    END IF;
    NEW.snapshot_leader_id  := OLD.snapshot_leader_id;                           -- RN-14: não muda
    NEW.snapshot_timothy_id := OLD.snapshot_timothy_id;
    NEW.snapshot_host_id    := OLD.snapshot_host_id;
    NEW.snapshot_cell_type  := OLD.snapshot_cell_type;
    RETURN NEW;
  END IF;

  -- INSERT: da célula gravada, nunca do que veio (P-REL-12). Uma leitura só, com FOR SHARE: a edição
  -- da célula (FOR NO KEY UPDATE) espera este relatório, ou este espera ela, e o retrato é todo de
  -- antes ou todo de depois. Depois da espera, em READ COMMITTED, a linha lida é a versão gravada.
  SELECT c.leader_id, c.timothy_id, c.host_id, c.type
    INTO _c
    FROM public.cells c
   WHERE c.id = NEW.cell_id
     FOR SHARE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('not_found_or_deleted', 'Esta célula não existe ou já foi excluída.',
                              '{"entity": "cell"}'::jsonb);
  END IF;
  NEW.snapshot_leader_id  := _c.leader_id;
  NEW.snapshot_timothy_id := _c.timothy_id;
  NEW.snapshot_host_id    := _c.host_id;
  NEW.snapshot_cell_type  := _c.type;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.cell_report_snapshot() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cell_report_snapshot() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS ad_cell_report_snapshot ON public.cell_reports;
CREATE TRIGGER ad_cell_report_snapshot
  BEFORE INSERT OR UPDATE OF cell_id, snapshot_leader_id, snapshot_timothy_id, snapshot_host_id, snapshot_cell_type
  ON public.cell_reports
  FOR EACH ROW EXECUTE FUNCTION public.cell_report_snapshot();
ALTER TABLE public.cell_reports ENABLE ALWAYS TRIGGER ad_cell_report_snapshot;

-- ===========================================================================
-- 6. A regra do relatório por linha (RN-14 a e b)
-- ===========================================================================
-- Responde só sobre quem consulta. viewer_scope_contains_any já é falsa sem "Visualizar Seu Ministério"
-- e sem "Visualizar Relatórios do Seu Ministério" (DT-28 do E2.02). Os viewer_has vêm primeiro: o
-- portão do E2.03 responde antes de qualquer leitura.
CREATE OR REPLACE FUNCTION public.viewer_sees_report_people(_leader uuid, _timothy uuid, _host uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.viewer_has('view_all_reports'::public.permission_action)
      OR public.viewer_has('view_all_church'::public.permission_action)
      OR coalesce(public.viewer_member_id() = ANY (ARRAY[_leader, _timothy, _host]), false)
      OR public.viewer_scope_contains_any(ARRAY[_leader, _timothy, _host])
$$;

ALTER FUNCTION public.viewer_sees_report_people(uuid, uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.viewer_sees_report_people(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_sees_report_people(uuid, uuid, uuid) TO authenticated, service_role;

-- ===========================================================================
-- 7. Views
-- ===========================================================================
-- cell_reports_view: o WHERE pelo retrato; search_text com o líder registrado (RN-14 d). As colunas
-- cell_* continuam as atuais da célula (endereço da linha, cell_identity do E2.10). Onze colunas novas
-- no fim (contrato do E2.12). Os nomes do retrato vêm pela chave, sem filtro de escopo nem de excluído
-- (nome de referência, RN-06 do E1.08; o excluído aparece só pelo nome, RN-09 c do E2.01). O G12 é o
-- de private.member_hierarchy do líder registrado (congelado para o excluído, P-HIE-13 do E2.06).
CREATE OR REPLACE VIEW public.cell_reports_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.id,
  r.cell_id,
  r.date,
  r.time,
  r.theme,
  r.observations,
  r.visitors,
  r.offering,
  r.was_held,
  r.reason_not_held,
  r.created_at,
  r.updated_at,
  public.week_start(r.date) AS week_start,
  coalesce(cardinality(r.visitors), 0) AS visitors_count,
  (SELECT count(*) FROM public.cell_report_participants p WHERE p.report_id = r.id) AS participants_count,
  c.type AS cell_type,
  c.is_active AS cell_is_active,
  c.leader_id AS cell_leader_id,
  cl.name AS cell_leader_name,
  c.timothy_id AS cell_timothy_id,
  c.host_id AS cell_host_id,
  c.street AS cell_street,
  c.number AS cell_number,
  c.complement AS cell_complement,
  c.neighborhood AS cell_neighborhood,
  c.meeting_day AS cell_meeting_day,
  c.meeting_time AS cell_meeting_time,
  public.search_normalize(concat_ws(' ', sl.name, r.theme)) AS search_text,   -- E2.11: o líder registrado
  c.deleted_at IS NOT NULL AS cell_deleted,
  r.created_by_kind,
  CASE r.created_by_kind WHEN 'member' THEN cby.name
                           WHEN 'legacy' THEN public.legacy_author_label(r.created_by_legacy) END AS created_by_name,
  r.updated_by_kind,
  CASE r.updated_by_kind WHEN 'member' THEN uby.name
                           WHEN 'legacy' THEN public.legacy_author_label(r.updated_by_legacy) END AS updated_by_name,
  -- E2.11 (RN-14, contrato do E2.12), no fim: o retrato.
  r.snapshot_leader_id,
  r.snapshot_timothy_id,
  r.snapshot_host_id,
  sl.name AS snapshot_leader_name,
  st.name AS snapshot_timothy_name,
  sh.name AS snapshot_host_name,
  r.snapshot_cell_type,
  slh.g12_level AS snapshot_leader_g12_level,
  coalesce(sl.is_pastor, false) AS snapshot_leader_is_pastor,
  slh.g12_id AS snapshot_g12_leader_id,
  sg12.name AS snapshot_g12_leader_name
FROM public.cell_reports r
LEFT JOIN public.members cby ON cby.id = r.created_by
LEFT JOIN public.members uby ON uby.id = r.updated_by
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
LEFT JOIN public.members sl ON sl.id = r.snapshot_leader_id
LEFT JOIN public.members st ON st.id = r.snapshot_timothy_id
LEFT JOIN public.members sh ON sh.id = r.snapshot_host_id
LEFT JOIN private.member_hierarchy slh ON slh.member_id = r.snapshot_leader_id
LEFT JOIN public.members sg12 ON sg12.id = slh.g12_id
WHERE (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
       AND (   r.snapshot_leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR r.snapshot_timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR r.snapshot_host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR r.snapshot_leader_id = (SELECT public.viewer_member_id())
  OR r.snapshot_timothy_id = (SELECT public.viewer_member_id())
  OR r.snapshot_host_id = (SELECT public.viewer_member_id())
)
AND r.deleted_at IS NULL;   -- espelhado em "Cell reports view policy"

ALTER VIEW public.cell_reports_view OWNER TO postgres;
REVOKE ALL ON public.cell_reports_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_view TO authenticated;

-- cell_reports_deleted_view: o mesmo WHERE pelo retrato, com o filtro de excluídos dela. As colunas não
-- mudam (o E2.12 decide o que a lista de excluídos mostra); o search_text passa ao líder registrado.
CREATE OR REPLACE VIEW public.cell_reports_deleted_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  r.id,
  r.cell_id,
  r.date,
  r.time,
  r.was_held,
  r.theme,
  r.reason_not_held,
  public.week_start(r.date) AS week_start,
  c.leader_id AS cell_leader_id,
  cl.name AS cell_leader_name,
  c.deleted_at IS NOT NULL AS cell_deleted,
  EXISTS (
    SELECT 1 FROM public.cell_reports o
     WHERE o.cell_id = r.cell_id
       AND public.week_start(o.date) = public.week_start(r.date)
       AND o.deleted_at IS NULL
  ) AS week_taken,
  r.deleted_at,
  r.deleted_by,
  CASE r.deleted_by_kind WHEN 'legacy' THEN public.legacy_author_label(r.deleted_by_legacy)
                           ELSE d.name END AS deleted_by_name,
  public.search_normalize(concat_ws(' ', sl.name, r.theme)) AS search_text,   -- E2.11: o líder registrado
  r.deleted_by_kind
FROM public.cell_reports r
JOIN public.cells c ON c.id = r.cell_id
LEFT JOIN public.members cl ON cl.id = c.leader_id
LEFT JOIN public.members sl ON sl.id = r.snapshot_leader_id
LEFT JOIN public.members d ON d.id = r.deleted_by
WHERE (SELECT public.viewer_has('manage_roles'::public.permission_action))
AND (
     (SELECT public.viewer_has('view_all_reports'::public.permission_action))
  OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (   (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
            OR (SELECT public.viewer_has('view_own_reports'::public.permission_action)))
       AND (   r.snapshot_leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR r.snapshot_timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR r.snapshot_host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR r.snapshot_leader_id = (SELECT public.viewer_member_id())
  OR r.snapshot_timothy_id = (SELECT public.viewer_member_id())
  OR r.snapshot_host_id = (SELECT public.viewer_member_id())
)
AND r.deleted_at IS NOT NULL;

ALTER VIEW public.cell_reports_deleted_view OWNER TO postgres;
REVOKE ALL ON public.cell_reports_deleted_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_reports_deleted_view TO authenticated;

-- cell_report_participants_view: acompanha o relatório (junta a cell_reports_view, herda o WHERE).
-- Colunas novas no fim: is_snapshot_person (o participante é uma das pessoas registradas) e, só para
-- quem quem consulta vê (member_visible), member_is_active e member_gender (nulas nos outros casos).
CREATE OR REPLACE VIEW public.cell_report_participants_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  p.report_id,
  p.member_id,
  m.name AS member_name,
  m.deleted_at IS NOT NULL AS member_deleted,
  v.member_visible,
  p.member_id IN (r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id) AS is_snapshot_person,
  CASE WHEN v.member_visible THEN m.is_active END AS member_is_active,
  CASE WHEN v.member_visible THEN m.gender END AS member_gender
FROM public.cell_report_participants p
JOIN public.cell_reports_view r ON r.id = p.report_id
LEFT JOIN public.members m ON m.id = p.member_id
CROSS JOIN LATERAL (
  SELECT coalesce(
        m.deleted_at IS NULL
    AND (    (SELECT public.viewer_has('view_all_church'::public.permission_action))
          OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
               AND m.id IN (SELECT public.viewer_ministry_member_ids()) )
          OR m.id = (SELECT public.viewer_member_id())),
    false) AS member_visible
) v;

ALTER VIEW public.cell_report_participants_view OWNER TO postgres;
REVOKE ALL ON public.cell_report_participants_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cell_report_participants_view TO authenticated;

-- ===========================================================================
-- 8. Políticas e a terceira forma (por id) pelo retrato
-- ===========================================================================
-- Os dois viewer_has em InitPlan (uma vez por consulta) antes da função de linha: o mesmo resultado de
-- viewer_sees_report_people, sem chamá-la por linha para quem vê todos os relatórios.
DROP POLICY IF EXISTS "Cell reports view policy" ON public.cell_reports;
CREATE POLICY "Cell reports view policy" ON public.cell_reports FOR SELECT TO authenticated
USING (
  (    (SELECT public.viewer_has('view_all_reports'::public.permission_action))
    OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
    OR public.viewer_sees_report_people(snapshot_leader_id, snapshot_timothy_id, snapshot_host_id) )
  AND deleted_at IS NULL                 -- espelhado na cell_reports_view
);

-- RN-14 do E2.02: "Editar Relatórios de Células", só em relatório visível. Sai no PR 2 (só as RPCs
-- gravam).
DROP POLICY IF EXISTS "Cell reports update policy" ON public.cell_reports;
CREATE POLICY "Cell reports update policy" ON public.cell_reports FOR UPDATE TO authenticated
USING (
  (SELECT public.viewer_has('edit_cell_report'::public.permission_action))
  AND (    (SELECT public.viewer_has('view_all_reports'::public.permission_action))
        OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
        OR public.viewer_sees_report_people(snapshot_leader_id, snapshot_timothy_id, snapshot_host_id) )
  AND deleted_at IS NULL
)
WITH CHECK (
  (SELECT public.viewer_has('edit_cell_report'::public.permission_action))
  AND (    (SELECT public.viewer_has('view_all_reports'::public.permission_action))
        OR (SELECT public.viewer_has('view_all_church'::public.permission_action))
        OR public.viewer_sees_report_people(snapshot_leader_id, snapshot_timothy_id, snapshot_host_id) )
  AND deleted_at IS NULL
);

-- A política de INSERT de participantes pergunta por esta função se o relatório é visível: o mesmo
-- predicado, pelo retrato. O resto do corpo é o do E2.02 (20261125140200_e202_03_read.sql).
CREATE OR REPLACE FUNCTION public.viewer_can_insert_cell_report_participant(_report_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cell_id uuid;
  _week date;
  _leader uuid;
  _timothy uuid;
  _host uuid;
BEGIN
  IF NOT (    public.viewer_has('edit_cell_report'::public.permission_action)
           OR public.viewer_has('edit_cell'::public.permission_action)
           OR public.viewer_has('submit_any_visible_report'::public.permission_action)
           OR public.viewer_has('submit_own_cell_report'::public.permission_action)) THEN
    RETURN false;
  END IF;

  SELECT r.cell_id, public.week_start(r.date), r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id
    INTO _cell_id, _week, _leader, _timothy, _host
    FROM public.cell_reports r
    JOIN public.cells c ON c.id = r.cell_id
   WHERE r.id = _report_id
     AND r.deleted_at IS NULL
     AND c.deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN true;          -- o aa_enforce_participant_rules responde
  END IF;

  -- Relatório visível (o WHERE da cell_reports_view, por id): pelo retrato (E2.11, RN-14).
  IF NOT public.viewer_sees_report_people(_leader, _timothy, _host) THEN
    RETURN false;
  END IF;

  RETURN public.viewer_has('edit_cell_report'::public.permission_action)
      OR (    _week = public.week_start(public.sp_today())
          AND public.can_submit_report(_cell_id));
END;
$$;

REVOKE ALL ON FUNCTION public.viewer_can_insert_cell_report_participant(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.viewer_can_insert_cell_report_participant(uuid) TO authenticated;

-- ===========================================================================
-- 9. Sai cell_in_viewer_ministry (sem uso depois do item 8)
-- ===========================================================================
-- Sem CASCADE: se algo ainda depender dela (política, view), a migration falha e nada muda. Uso em
-- corpo de função não aparece em pg_depend: a conferência é por prosrc.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'private')
                AND p.prosrc ~ 'cell_in_viewer_ministry'
                AND p.proname <> 'cell_in_viewer_ministry') THEN
    RAISE EXCEPTION 'E2.11: cell_in_viewer_ministry ainda é usada no corpo de outra função.';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.cell_in_viewer_ministry(uuid);

-- ===========================================================================
-- 10. Pós-condições
-- ===========================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
              AND tablename IN ('cell_reports', 'cell_report_participants')
              AND (coalesce(qual, '') ~ 'viewer_is_cell_person' OR coalesce(with_check, '') ~ 'viewer_is_cell_person')) THEN
    RAISE EXCEPTION 'E2.11: política de relatório ainda olha as pessoas atuais da célula.';
  END IF;
  IF has_function_privilege('authenticated', 'public.cell_report_snapshot()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.viewer_sees_report_people(uuid,uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'E2.11: privilégios das funções novas fora do desenho.';
  END IF;
END $$;
