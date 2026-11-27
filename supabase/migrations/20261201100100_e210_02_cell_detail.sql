-- E2.10 (PR 1, migration 2 de 2) — Os últimos relatórios do detalhe da célula e a identificação do
-- filtro Célula de Relatórios. Ver docs/specs/e2-10-listagem-celulas.md no repositório apps-mci
-- ("O detalhe e o filtro Célula (migration 2)", "Contratos"; RN-14, RN-17 a RN-20; DA-4, DA-9, DA-10;
-- DT-08 a DT-10).
--
-- Conteúdo:
--   0. Guarda: a migration 1 deste passo e as colunas da cell_reports_view usadas aqui.
--   1. public.cell_recent_reports(_cell_id, _limit) (invoker): até 10 relatórios visíveis da célula,
--      do mais recente, com o sinal da comparação de participantes e de visitantes contra o relatório
--      visível de célula realizada anterior (mesmo fora dos 10). A porta é a célula visível na
--      cells_view (DA-4); o conteúdo vem só da cell_reports_view, cuja visibilidade segue o retrato
--      do E2.11. Só números: nenhum nome de participante ou de visitante.
--   2. public.cell_identity(_cell_id) (invoker): a identificação atual da célula para o chip, só
--      quando quem consulta vê a célula ou algum relatório não excluído dela (DA-10). Os valores são
--      os atuais da célula (as colunas cell_* da cell_reports_view), e não os do retrato.
--   3. Privilégios e pós-condições.
--
-- As duas chamam o portão do E2.03 (viewer_member_id) antes de tudo. Nenhuma view muda.
--
-- Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos
-- ===========================================================================
DO $$ BEGIN
  IF to_regtype('public.cell_filter_person') IS NULL
     OR to_regprocedure('public.first_distinct_ids(uuid[], integer)') IS NULL
     OR EXISTS (SELECT 1
                  FROM unnest(ARRAY['cell_id', 'date', 'time', 'was_held', 'theme', 'reason_not_held',
                                    'observations', 'offering', 'participants_count', 'visitors_count',
                                    'cell_leader_name', 'cell_meeting_day', 'cell_meeting_time',
                                    'cell_deleted']) c(col)
                 WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
                                    WHERE attrelid = 'public.cell_reports_view'::regclass
                                      AND attname = c.col AND NOT attisdropped)) THEN
    RAISE EXCEPTION 'E2.10: falta a migration 1 deste passo ou colunas da cell_reports_view.';
  END IF;
END $$;

-- ===========================================================================
-- 1. Os últimos relatórios do detalhe (RN-17, RN-18, RN-20; DA-4, DA-9)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.cell_recent_reports(_cell_id uuid, _limit integer DEFAULT 10)
RETURNS TABLE (id uuid, date date, "time" time, was_held boolean, theme text, reason_not_held text,
               observations text, offering numeric, participants_count bigint, visitors_count integer,
               participants_trend smallint,    -- 1 maior, 0 igual, -1 menor, nulo sem comparação
               visitors_trend smallint)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  -- DA-4: a porta é a célula visível, como o próprio detalhe (RN-14). "id =" é leakproof: entra na
  -- view e usa cells_pkey.
  IF _cell_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.cells_view c WHERE c.id = _cell_id) THEN
    RETURN;
  END IF;

  RETURN QUERY
    WITH visible AS (
      SELECT r.id AS rid, r.date AS rdate, r."time" AS rtime, r.was_held AS rheld, r.theme AS rtheme,
             r.reason_not_held AS rreason, r.observations AS robs, r.offering::numeric AS roffering,
             r.participants_count AS rparts, r.visitors_count AS rvisitors
        FROM public.cell_reports_view r
       WHERE r.cell_id = _cell_id),                      -- leakproof: índice (cell_id, date DESC)
    compared AS (
      -- DA-9: contra o relatório visível de célula realizada imediatamente anterior, pela data, pelo
      -- horário e pelo id; "Não houve célula" fica fora da janela e sem comparação (P-LCE-14).
      SELECT v.rid,
             sign(v.rparts    - lag(v.rparts)    OVER w)::smallint AS ptrend,
             sign(v.rvisitors - lag(v.rvisitors) OVER w)::smallint AS vtrend
        FROM visible v
       WHERE v.rheld
      WINDOW w AS (ORDER BY v.rdate, v.rtime, v.rid))
    SELECT v.rid, v.rdate, v.rtime, v.rheld, v.rtheme, v.rreason, v.robs, v.roffering,
           v.rparts, v.rvisitors, c.ptrend, c.vtrend
      FROM visible v
      LEFT JOIN compared c ON c.rid = v.rid
     ORDER BY v.rdate DESC, v.rtime DESC, v.rid DESC
     LIMIT least(greatest(coalesce(_limit, 10), 1), 10);
END
$$;

-- ===========================================================================
-- 2. A identificação da célula no chip de Relatórios (RN-19, DA-10)
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.cell_identity(_cell_id uuid)
RETURNS TABLE (cell_id uuid, leader_name text, meeting_day text, meeting_time time, cell_deleted boolean)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public.viewer_member_id();                     -- o portão do E2.03 sempre
  IF _cell_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT x.cid, x.lname, x.mday, x.mtime, x.deleted
      FROM (SELECT c.id AS cid, c.leader_name AS lname, c.meeting_day AS mday,
                   c.meeting_time AS mtime, false AS deleted, 1 AS source
              FROM public.cells_view c
             WHERE c.id = _cell_id
            UNION ALL
            (SELECT r.cell_id, r.cell_leader_name, r.cell_meeting_day, r.cell_meeting_time,
                    r.cell_deleted, 2
               FROM public.cell_reports_view r
              WHERE r.cell_id = _cell_id
              LIMIT 1)) x
     ORDER BY x.source
     LIMIT 1;
END
$$;

-- ===========================================================================
-- 3. Privilégios e pós-condições
-- ===========================================================================
REVOKE ALL ON FUNCTION public.cell_recent_reports(uuid, integer), public.cell_identity(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cell_recent_reports(uuid, integer), public.cell_identity(uuid)
  TO authenticated;

DO $$
DECLARE
  _p regprocedure;
BEGIN
  FOREACH _p IN ARRAY ARRAY['public.cell_recent_reports(uuid, integer)'::regprocedure,
                            'public.cell_identity(uuid)'::regprocedure] LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = _p)
       OR NOT (SELECT coalesce(proconfig @> ARRAY['search_path=public'], false) FROM pg_proc WHERE oid = _p)
       OR NOT has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.10: % com modo de segurança, search_path ou EXECUTE diferentes do desenho.', _p;
    END IF;
  END LOOP;
END $$;
