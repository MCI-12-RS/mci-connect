-- E2.09 (PR 1, migration 2) — Situação do relatório por célula (só leitura).
-- Ver docs/specs/e2-09-situacao-relatorio.md no repositório apps-mci
-- ("A regra (migration 2)", "A leitura (migration 2)", "Privilégios", "Desempenho";
-- RN-01 a RN-08; DA-1, DA-3, DA-5 a DA-8; DT-01, DT-02, DT-05 a DT-09).
--
-- 1. sp_local(timestamptz) e sp_instant(timestamp): o horário de Brasília num
--    lugar só (DT-08). sp_now() e sp_today() passam a chamar sp_local(now()),
--    com o mesmo resultado; o dashboard_summary também.
-- 2. Enum public.cell_report_status, na ordem da RN-04 (DT-05).
-- 3. Regra pura, em private, sem ler tabela (testada por tabela no pgTAP):
--    report_deadline (horário + 1 hora; sem horário, 00:00 do dia seguinte),
--    report_week_counts (a célula contava no prazo, ou no fim da semana quando o
--    prazo cai na semana seguinte; DA-1, DA-3, DA-5) e report_situation_rule
--    (RN-01, RN-04, RN-05, RN-07; DA-6).
-- 4. private.cell_report_situation(célula, …, momento): junta os relatórios não
--    excluídos das 5 semanas até a de referência (visíveis ou não, RN-03) e o
--    histórico, e aplica a regra (DT-01, DT-02). Definer, com EXECUTE para
--    authenticated: a cells_view a chama com o papel de quem consulta, sem
--    USAGE em private (DT-07). Os papéis da API continuam sem USAGE em private.
-- 5. cells_view: a do E2.08 (migration 1), com as mesmas colunas na mesma
--    ordem, mais report_status e report_missing_weeks no fim, por um LEFT JOIN
--    LATERAL a um agregado de uma linha: o planejador remove a junção quando
--    nenhuma das duas é pedida (DT-06). "Agora" = now(), o mesmo instante para
--    a página e para o total. O WHERE não muda (espelhado em "Cells view
--    policy"); continua security definer com security_barrier, dona postgres,
--    só com SELECT para authenticated.
-- 6. public.cells_report_situation(_at): a situação de todas as células
--    visíveis num momento qualquer (DA-7, DA-8). Definer só para alcançar a
--    função de private; o escopo é o da cells_view, pela sessão de quem chama.
-- 7. dashboard_summary(_at): mesma assinatura e colunas; cells_pending = as
--    células "Pendente" de cells_report_situation(_at) (RN-08, DT-09); o
--    "agora" por sp_local.
--
-- Pode rodar de novo sem erro: CREATE OR REPLACE, enum com guarda de
-- duplicate_object, grants idempotentes. O CREATE OR REPLACE VIEW falha (sem
-- mudar nada) se a view vigente tiver uma coluna a mais que esta definição.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos: migration 1; E2.01 PR 1 (índice da semana); E1.08
--    (week_start, weekday_index); E2.08 PR 1 (cells_view.can_submit_report com
--    a célula ativa).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('private.cell_active_periods') IS NULL
     OR to_regclass('public.cell_reports_cell_week_key') IS NULL
     OR to_regprocedure('public.weekday_index(text)') IS NULL
     OR to_regprocedure('public.week_start(date)') IS NULL
     OR to_regclass('public.cells_view') IS NULL
     OR pg_get_viewdef('public.cells_view'::regclass) !~ 'member_hierarchy' THEN
    RAISE EXCEPTION 'E2.09 (migration 2): falta a migration 1 deste passo, o PR 1 do E2.01, o E1.08 ou o E2.06.';
  END IF;
  -- A cells_view abaixo parte da do E2.08 PR 1 (can_submit_report só com a
  -- célula ativa). Sem ela, o CREATE OR REPLACE desfaria a regra do E2.08.
  IF pg_get_viewdef('public.cells_view'::regclass)
     !~ '\(c\.is_active AND \(\( SELECT (public\.)?viewer_has\(''edit_cell''' THEN
    RAISE EXCEPTION 'E2.09 (migration 2): a cells_view vigente não é a do E2.08 PR 1 (can_submit_report com a célula ativa); aplique antes a migration 20261126120000_e208_01_inactive_cell_reports.';
  END IF;
END $$;

-- ===========================================================================
-- 1. O horário de Brasília num lugar só (DT-08)
-- ===========================================================================
-- DT-14: as funções puras deste arquivo (sp_local, sp_instant, report_deadline,
-- report_week_counts e report_situation_rule) não têm SET search_path. São
-- SECURITY INVOKER (prosecdef = false, fixado no pgTAP), IMMUTABLE e só citam
-- objetos com o schema. Os operadores e tipos de pg_catalog com argumentos
-- exatos (date + integer, date + time, timestamp + interval, timestamp <
-- timestamp, date = date, integer * integer, date - integer) não podem ser
-- trocados por um homônimo em public: pg_catalog é lido antes (implícito, fora
-- do search_path), e a mesma assinatura esconde a de depois. O único
-- polimórfico, anymultirange @> anyelement, perderia para um
-- "public.@>(tstzmultirange, timestamptz)" exato (de quem tem CREATE em
-- public); por isso é escrito OPERATOR(pg_catalog.@>), e o tipo do literal,
-- pg_catalog.tstzmultirange (continua inlinável). AT TIME ZONE já vira
-- pg_catalog.timezone() no parser. Com o SET, cada chamada troca o
-- search_path e impede o inline: a situação de 1.350 células passava de
-- 145 ms só na regra; sem ele, 10 ms. A função definer (cell_report_situation)
-- e a RPC continuam com search_path vazio.
CREATE OR REPLACE FUNCTION public.sp_local(_at timestamptz)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT _at AT TIME ZONE 'America/Sao_Paulo' $$;

CREATE OR REPLACE FUNCTION public.sp_instant(_local timestamp)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT _local AT TIME ZONE 'America/Sao_Paulo' $$;

-- Mesma assinatura, mesmo resultado (E1.08); só passam por sp_local.
CREATE OR REPLACE FUNCTION public.sp_now()
RETURNS timestamp
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT public.sp_local(now()) $$;

CREATE OR REPLACE FUNCTION public.sp_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT public.sp_local(now())::date $$;

ALTER FUNCTION public.sp_local(timestamptz) OWNER TO postgres;
ALTER FUNCTION public.sp_instant(timestamp) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sp_local(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sp_instant(timestamp) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sp_local(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sp_instant(timestamp) TO authenticated, service_role;

-- ===========================================================================
-- 2. Os códigos da situação da semana (RN-04, RN-07; DT-05), na ordem da RN-04
-- ===========================================================================
DO $$
BEGIN
  CREATE TYPE public.cell_report_status AS ENUM
    ('sent_held', 'sent_not_held', 'not_yet', 'pending', 'next_week', 'no_meeting_day');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE public.cell_report_status IS
  'E2.09 (RN-04, RN-07): situação do relatório da semana. sent_held/sent_not_held = Enviado; not_yet = Ainda não ocorreu; pending = Pendente; next_week = Conta a partir da próxima semana; no_meeting_day = Sem dia da reunião.';

-- ===========================================================================
-- 3. A regra pura (sem ler tabela)
-- ===========================================================================
-- Prazo (RN-02, RN-07), em hora de Brasília: horário + 1 hora; sem horário,
-- 00:00 do dia seguinte. Em timestamp, 23:30 vira 00:30 do dia seguinte, e
-- sábado vira domingo.
CREATE OR REPLACE FUNCTION private.report_deadline(_week_start date, _weekday integer, _meeting_time time)
RETURNS timestamp
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE WHEN _meeting_time IS NULL
              THEN (_week_start + _weekday + 1)::timestamp
              ELSE (_week_start + _weekday) + _meeting_time + interval '1 hour' END
$$;

-- A semana conta (RN-06; DA-1, DA-3): a célula contava no prazo, ou no fim da
-- semana quando o prazo cai na semana seguinte. Sem linha no histórico, nunca
-- (DA-5).
CREATE OR REPLACE FUNCTION private.report_week_counts(
  _week_start date, _weekday integer, _meeting_time time, _periods tstzmultirange)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT coalesce(_periods, '{}'::pg_catalog.tstzmultirange)
         OPERATOR(pg_catalog.@>) public.sp_instant(least(private.report_deadline(_week_start, _weekday, _meeting_time),
                                    (_week_start + 7)::timestamp))
$$;

-- A regra (RN-01, RN-04, RN-05, RN-07; DA-6). Só recebe valores.
CREATE OR REPLACE FUNCTION private.report_situation_rule(
  _local_at       timestamp,          -- o momento de referência, em Brasília
  _is_active      boolean,
  _weekday        integer,            -- weekday_index(meeting_day); nulo = dia inválido
  _meeting_time   time,
  _report_weeks   date[],             -- domingos das semanas com relatório não excluído (a de referência e as 4 anteriores)
  _held_this_week boolean,            -- was_held do relatório da semana de referência
  _periods        tstzmultirange,     -- private.cell_active_periods; nulo = nunca contou (DA-5)
  OUT report_status public.cell_report_status,
  OUT report_missing_weeks smallint)
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  _ws date := public.week_start(_local_at::date);
  _k  integer;
BEGIN
  IF NOT coalesce(_is_active, false) THEN                                          -- RN-01: sem situação
    RETURN;
  END IF;
  IF _weekday IS NULL THEN                                                         -- RN-07
    report_status := 'no_meeting_day'::public.cell_report_status;
    RETURN;
  END IF;
  report_missing_weeks := 0;
  IF _ws = ANY (coalesce(_report_weeks, '{}'::date[])) THEN                        -- RN-04 (a); RN-05: zero
    report_status := CASE WHEN _held_this_week THEN 'sent_held' ELSE 'sent_not_held' END
                     ::public.cell_report_status;
    RETURN;
  END IF;
  report_status := CASE
    WHEN _local_at < private.report_deadline(_ws, _weekday, _meeting_time) THEN 'not_yet'     -- (b)
    WHEN private.report_week_counts(_ws, _weekday, _meeting_time, _periods) THEN 'pending'   -- (c)
    ELSE 'next_week' END::public.cell_report_status;                                          -- (d)
  FOR _k IN 1..4 LOOP                                                              -- RN-05: até "4 ou mais"
    EXIT WHEN (_ws - 7 * _k) = ANY (coalesce(_report_weeks, '{}'::date[]))
           OR NOT private.report_week_counts(_ws - 7 * _k, _weekday, _meeting_time, _periods);
    report_missing_weeks := _k;
  END LOOP;
END $$;

ALTER FUNCTION private.report_deadline(date, integer, time) OWNER TO postgres;
ALTER FUNCTION private.report_week_counts(date, integer, time, tstzmultirange) OWNER TO postgres;
ALTER FUNCTION private.report_situation_rule(timestamp, boolean, integer, time, date[], boolean, tstzmultirange) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.report_deadline(date, integer, time) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_week_counts(date, integer, time, tstzmultirange) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.report_situation_rule(timestamp, boolean, integer, time, date[], boolean, tstzmultirange)
  FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 4. Uma célula num momento (RN-02, RN-03, RN-06)
-- ===========================================================================
-- Definer: conta todos os relatórios não excluídos, visíveis ou não (RN-03), e
-- lê o histórico. Só é alcançada pela cells_view e por cells_report_situation
-- (DT-07): os papéis da API não têm USAGE em private, então não a acham pelo
-- nome. A expressão week_start(r.date) é a do índice único da semana
-- (cell_reports_cell_week_key): no máximo 5 entradas lidas.
CREATE OR REPLACE FUNCTION private.cell_report_situation(
  _cell_id uuid, _is_active boolean, _meeting_day text, _meeting_time time, _at timestamptz)
RETURNS TABLE (report_status public.cell_report_status, report_missing_weeks smallint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _local   timestamp := public.sp_local(coalesce(_at, now()));
  _ws      date := public.week_start(_local::date);
  _weeks   date[] := '{}';
  _held    boolean;
  _periods tstzmultirange;
BEGIN
  IF coalesce(_is_active, false) THEN                       -- a inativa não tem situação: nada a ler
    SELECT coalesce(array_agg(public.week_start(r.date)), '{}'),
           bool_or(r.was_held) FILTER (WHERE public.week_start(r.date) = _ws)
      INTO _weeks, _held
      FROM public.cell_reports r
     WHERE r.cell_id = _cell_id
       AND r.deleted_at IS NULL
       AND public.week_start(r.date) BETWEEN _ws - 28 AND _ws;   -- semanas posteriores não contam (RN-02)
    SELECT p.periods INTO _periods FROM private.cell_active_periods p WHERE p.cell_id = _cell_id;
  END IF;
  RETURN QUERY
    SELECT s.report_status, s.report_missing_weeks
      FROM private.report_situation_rule(_local, _is_active, public.weekday_index(_meeting_day),
                                         _meeting_time, _weeks, _held, _periods) s;
END $$;

ALTER FUNCTION private.cell_report_situation(uuid, boolean, text, time, timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.cell_report_situation(uuid, boolean, text, time, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.cell_report_situation(uuid, boolean, text, time, timestamptz)
  TO authenticated, service_role;

-- ===========================================================================
-- 5. cells_view (a do E2.08, migration 1; duas colunas no fim)
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
  -- Contrato do E1.08; não entra no cálculo da situação (DT-02).
  (SELECT max(r.date) FROM public.cell_reports r WHERE r.cell_id = c.id AND r.deleted_at IS NULL) AS last_report_date,
  public.search_normalize(concat_ws(' ',
    l.name, t.name, h.name, ll.name, tl.name, hl.name, c.street, c.neighborhood
  )) AS search_text,
  -- DT-07 do E2.08: o direito de lançar do E2.02 (can_submit_report(uuid)) com a célula ativa.
  c.is_active AND (
       (SELECT public.viewer_has('edit_cell'::public.permission_action))
    OR (SELECT public.viewer_has('submit_any_visible_report'::public.permission_action))
    OR (     (SELECT public.viewer_has('submit_own_cell_report'::public.permission_action))
         AND coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false))
  ) AS can_submit_report,
  coalesce((SELECT public.viewer_member_id()) IN (c.leader_id, c.timothy_id, c.host_id), false) AS is_mine,
  coalesce(l.is_pastor, false) AS leader_is_pastor,
  rs.report_status,                         -- RN-04, RN-07; nulo na célula inativa
  rs.report_missing_weeks                   -- RN-05: 0 a 4 ("4 ou mais"); nulo sem contagem (DA-6)
FROM public.cells c
LEFT JOIN public.members l ON l.id = c.leader_id
LEFT JOIN public.members t ON t.id = c.timothy_id
LEFT JOIN public.members h ON h.id = c.host_id
LEFT JOIN public.members ll ON ll.id = l.leader_id
LEFT JOIN public.members tl ON tl.id = t.leader_id
LEFT JOIN public.members hl ON hl.id = h.leader_id
LEFT JOIN private.member_hierarchy lhr ON lhr.member_id = c.leader_id
LEFT JOIN public.members g12 ON g12.id = lhr.g12_id
LEFT JOIN LATERAL (
  -- Um agregado sem GROUP BY devolve sempre uma linha: é o que deixa o
  -- planejador remover esta junção quando nenhuma das duas colunas é pedida
  -- (DT-06). "Agora" = now(), o início da transação: o mesmo instante para a
  -- página e para o total.
  SELECT max(s.report_status)        AS report_status,
         max(s.report_missing_weeks) AS report_missing_weeks
    FROM private.cell_report_situation(c.id, c.is_active, c.meeting_day, c.meeting_time, now()) s
) rs ON true
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

-- ===========================================================================
-- 6. A situação de todas as células visíveis num momento (DA-7, DA-8)
-- ===========================================================================
-- Definer só para alcançar a função de private. O escopo é o da cells_view,
-- pela sessão (auth.uid()) de quem chama. Sem as colunas novas da view, a
-- junção dela não roda: uma chamada por célula.
CREATE OR REPLACE FUNCTION public.cells_report_situation(_at timestamptz DEFAULT now())
RETURNS TABLE (cell_id uuid, report_status public.cell_report_status, report_missing_weeks smallint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT cv.id, s.report_status, s.report_missing_weeks
    FROM public.cells_view cv
    CROSS JOIN LATERAL private.cell_report_situation(cv.id, cv.is_active, cv.meeting_day,
                                                     cv.meeting_time, coalesce(_at, now())) s
$$;

COMMENT ON FUNCTION public.cells_report_situation(timestamptz) IS
  'E2.09: situação do relatório (RN-04, RN-05) de cada célula visível no momento _at (nulo = agora). Mesma regra da cells_view.report_status.';

ALTER FUNCTION public.cells_report_situation(timestamptz) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.cells_report_situation(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cells_report_situation(timestamptz) TO authenticated, service_role;

-- ===========================================================================
-- 7. dashboard_summary (E1.08): cells_pending pela situação (RN-08, DT-09)
-- ===========================================================================
-- _at só escolhe o momento considerado (testes e, no futuro, a navegação por
-- semana do E2.14). Os números de membros são sempre o estado atual.
--
-- Semana:
--   - reports_sent, visitors e cells_not_held: relatórios visíveis com data
--     entre o domingo e o sábado da semana;
--   - cells_pending (RN-08 do E2.09): as células visíveis com a situação da
--     semana "Pendente" no momento _at, pela mesma função da lista
--     (cells_report_situation): só ativas e não excluídas, com dia válido,
--     prazo de 1 hora depois do horário (sem horário, 00:00 do dia seguinte),
--     só as semanas que contam para a célula (RN-06) e sem nenhum relatório da
--     semana, visível ou não. Relatórios de semanas posteriores a _at não
--     contam.
-- Membros (estado atual, sobre members_view): sem mudança (E1.08).
CREATE OR REPLACE FUNCTION public.dashboard_summary(_at timestamptz DEFAULT now())
RETURNS TABLE (
  week_start date,
  week_end date,
  reports_sent bigint,
  cells_pending bigint,
  visitors bigint,
  cells_not_held bigint,
  members_total bigint,
  members_active bigint,
  members_inactive bigint,
  members_baptized bigint,
  members_not_baptized bigint,
  members_without_leader bigint,
  members_without_cell_link bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  -- Agora no horário de Brasília; _at nulo vale como agora.
  _local timestamp := public.sp_local(coalesce(_at, now()));
  _ws date := public.week_start(_local::date);
  _we date := _ws + 6;
BEGIN
  PERFORM public._dashboard_assert_access();

  RETURN QUERY
  SELECT
    _ws,
    _we,
    rep.reports_sent,
    pend.cells_pending,
    rep.visitors,
    rep.cells_not_held,
    mem.members_total,
    mem.members_active,
    mem.members_inactive,
    mem.members_baptized,
    mem.members_not_baptized,
    mem.members_without_leader,
    mem.members_without_cell_link
  FROM (
    SELECT
      count(*) AS reports_sent,
      coalesce(sum(rv.visitors_count), 0)::bigint AS visitors,
      count(*) FILTER (WHERE NOT rv.was_held) AS cells_not_held
    FROM public.cell_reports_view rv
    WHERE rv.date BETWEEN _ws AND _we
  ) rep
  CROSS JOIN (
    SELECT count(*) AS cells_pending
    FROM public.cells_report_situation(coalesce(_at, now())) s
    WHERE s.report_status = 'pending'::public.cell_report_status
  ) pend
  CROSS JOIN (
    SELECT
      count(*) AS members_total,
      count(*) FILTER (WHERE mv.is_active) AS members_active,
      count(*) FILTER (WHERE NOT mv.is_active) AS members_inactive,
      count(*) FILTER (WHERE mv.is_baptized) AS members_baptized,
      count(*) FILTER (WHERE NOT mv.is_baptized) AS members_not_baptized,
      count(*) FILTER (
        WHERE mv.is_active AND NOT mv.is_pastor AND mv.leader_id IS NULL
      ) AS members_without_leader,
      count(*) FILTER (
        WHERE mv.is_active AND NOT mv.is_pastor
          AND NOT (mv.is_cell_leader OR mv.is_cell_timothy OR mv.is_cell_host
                   OR mv.attended_last_30_days)
      ) AS members_without_cell_link
    FROM public.members_view mv
  ) mem;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dashboard_summary(timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(timestamptz) TO authenticated;
