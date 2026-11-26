-- E2.08 (PR 1, migration 1) — A célula inativa não recebe relatório novo.
-- Ver docs/specs/e2-08-cadastro-celulas.md no repositório apps-mci
-- ("Célula inativa e relatório (migration 1)", "Bloqueios e concorrência";
-- RN-01, RN-11 (c) e (d), RN-14; DA-5 a DA-7; DT-06, DT-07).
--
-- 1. enforce_cell_report_active_cell() e o trigger ac_enforce_cell_report_active
--    (BEFORE INSERT OR UPDATE OF cell_id em cell_reports): recusa com
--    cell_inactive o relatório novo, ou a troca de célula, para uma célula
--    inativa. Vale para todos os papéis (inclusive service_role e postgres);
--    só a carga em replica passa por fora. Roda depois do a0_ (permissão), do
--    aa_ (excluído) e do ab_ (escopo), pela ordem alfabética: a célula que a
--    pessoa não vê nunca revela a situação (DA-7). SECURITY DEFINER porque o
--    FOR SHARE sob o RLS exigiria a política de UPDATE de cells.
--    O FOR SHARE na célula conflita com o UPDATE que inativa (FOR NO KEY
--    UPDATE): quem chega depois espera, e em READ COMMITTED relê a versão
--    gravada (DT-06). Editar, excluir e restaurar um relatório que já existe
--    não passam por aqui (RN-11 d, DA-5).
-- 2. cells_view.can_submit_report passa a "c.is_active AND (a regra do
--    E2.02)" (DT-07, AQ-7). A view é a do E2.06 (migration 2), com as mesmas
--    colunas, na mesma ordem; continua security definer com security_barrier,
--    dona postgres, só com SELECT para authenticated. O WHERE não muda
--    (espelhado em "Cells view policy"). can_submit_report(uuid) continua
--    sendo só o direito de lançar (permissão e escopo).
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE, DROP TRIGGER IF EXISTS antes
-- do CREATE, grants idempotentes. O CREATE OR REPLACE VIEW falha (sem mudar
-- nada) se a view vigente tiver uma coluna a mais que esta definição.

DO $$
BEGIN
  IF to_regprocedure('public._del_raise(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.can_submit_report(uuid)') IS NULL
     OR to_regclass('public.cells_view') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.cells_view'::regclass
                       AND attname = 'can_submit_report' AND NOT attisdropped)
     OR pg_get_viewdef('public.cells_view'::regclass) !~ 'member_hierarchy' THEN
    RAISE EXCEPTION 'E2.08 (migration 1) depende do E2.01, do PR 1 do E2.02 e da migration 2 do E2.06.';
  END IF;
END $$;

-- ===========================================================================
-- 1. RN-11 (c): a célula inativa não recebe relatório novo (DT-06)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.enforce_cell_report_active_cell()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _active boolean;
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;                                   -- relatório já excluído: só fora da API
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cell_id IS NOT DISTINCT FROM OLD.cell_id THEN
    RETURN NEW;                                   -- RN-11 (d): editar o que já existe
  END IF;
  -- FOR SHARE conflita com o UPDATE que inativa (FOR NO KEY UPDATE); o
  -- FOR KEY SHARE do aa_ (E2.01) não conflita. Depois da espera, em READ
  -- COMMITTED, a linha lida é a versão gravada pela outra transação.
  SELECT c.is_active INTO _active
    FROM public.cells c
   WHERE c.id = NEW.cell_id
     FOR SHARE;
  IF _active IS FALSE THEN
    PERFORM public._del_raise('cell_inactive',
      'Esta célula está inativa e não recebe relatórios.',
      jsonb_build_object('cell_id', NEW.cell_id));
  END IF;
  RETURN NEW;                                     -- célula inexistente: a FK recusa
END $$;

ALTER FUNCTION public.enforce_cell_report_active_cell() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_cell_report_active_cell() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_cell_report_active_cell() TO service_role;

DROP TRIGGER IF EXISTS ac_enforce_cell_report_active ON public.cell_reports;
CREATE TRIGGER ac_enforce_cell_report_active
  BEFORE INSERT OR UPDATE OF cell_id ON public.cell_reports
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cell_report_active_cell();

-- ===========================================================================
-- 2. cells_view (a do E2.06, migration 2; só muda can_submit_report)
-- ===========================================================================
CREATE OR REPLACE VIEW public.cells_view
WITH (security_barrier = true, security_invoker = false) AS
SELECT
  c.id,
  c.leader_id,
  c.timothy_id,
  c.host_id,
  c.type,
  c.meeting_day,
  c.meeting_time,
  c.street,
  c.number,
  c.complement,
  c.neighborhood,
  c.city,
  c.state,
  c.zip_code,
  c.is_active,
  c.created_at,
  c.updated_at,
  public.weekday_index(c.meeting_day) AS meeting_weekday,
  l.name AS leader_name,
  l.gender AS leader_gender,
  lhr.g12_level AS leader_g12_level,
  t.name AS timothy_name,
  h.name AS host_name,
  lhr.g12_id AS g12_leader_id,
  g12.name AS g12_leader_name,
  (SELECT max(r.date) FROM public.cell_reports r WHERE r.cell_id = c.id AND r.deleted_at IS NULL) AS last_report_date,
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text,
  -- DT-07: o direito de lançar do E2.02 (can_submit_report(uuid)) com a célula ativa.
  c.is_active AND (
       (SELECT public.viewer_has('edit_cell'::public.permission_action))
    OR (SELECT public.viewer_has('submit_any_visible_report'::public.permission_action))
    OR (     (SELECT public.viewer_has('submit_own_cell_report'::public.permission_action))
         AND coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false))
  ) AS can_submit_report,
  coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false) AS is_mine,
  coalesce(l.is_pastor, false) AS leader_is_pastor
FROM public.cells c
LEFT JOIN public.members l ON l.id = c.leader_id
LEFT JOIN public.members t ON t.id = c.timothy_id
LEFT JOIN public.members h ON h.id = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
LEFT JOIN private.member_hierarchy lhr ON lhr.member_id = c.leader_id
LEFT JOIN public.members g12 ON g12.id = lhr.g12_id
WHERE (
     (SELECT public.viewer_has('view_all_church'::public.permission_action))
  OR (     (SELECT public.viewer_has('view_own_ministry'::public.permission_action))
       AND (   c.leader_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.timothy_id IN (SELECT public.viewer_ministry_member_ids())
            OR c.host_id IN (SELECT public.viewer_ministry_member_ids())) )
  OR c.leader_id = (SELECT public.viewer_member_id())
  OR c.timothy_id = (SELECT public.viewer_member_id())
  OR c.host_id = (SELECT public.viewer_member_id())
)
AND c.deleted_at IS NULL;   -- espelhado em "Cells view policy"

ALTER VIEW public.cells_view OWNER TO postgres;
REVOKE ALL ON public.cells_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cells_view TO authenticated;
