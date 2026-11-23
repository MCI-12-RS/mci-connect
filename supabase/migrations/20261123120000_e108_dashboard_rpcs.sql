-- E1.08 (PR 3) — Dashboard calculado no banco.
-- Ver docs/specs/e1-08-paginacao-servidor.md no repositório apps-mci (RN-08 e RN-09).
--
-- 1. _dashboard_assert_access(): a checagem de acesso ao dashboard (RN-09) num
--    lugar só. Quem não tem view_dashboard nem view_own_ministry_dashboard
--    recebe o erro 42501.
-- 2. dashboard_summary(_at): os cards da semana e os cards gerais de membros,
--    numa linha só. A semana vai de domingo a sábado e "agora" é o horário de
--    Brasília, independentemente do relógio do navegador.
-- 3. dashboard_cells_by_type(): as células visíveis por tipo.
-- 4. dashboard_g12_ranking(): o ranking de células por casal G12, contando cada
--    célula uma vez só (male_cells e female_cells já acumulam a subárvore).
--
-- As quatro funções são SECURITY INVOKER e leem só das views do E1.08
-- (members_view, cells_view e cell_reports_view), nunca das tabelas: herdam o
-- escopo de quem consulta (RN-05), a máscara e, no futuro, a exclusão lógica
-- (E2.01) e a flag de consolidado, sem repetir nenhuma dessas regras aqui.
--
-- Em plpgsql, as colunas de RETURNS TABLE viram variáveis e colidiriam com os
-- nomes de coluna das views (name, visitors, week_start...). Por isso toda
-- coluna é qualificada com o apelido da tabela.
--
-- Nada de tabela, coluna ou view nova. Só CREATE OR REPLACE FUNCTION e grants:
-- a migration pode rodar de novo sem erro.

-- ---------------------------------------------------------------------------
-- 1. Acesso ao dashboard (RN-09)
-- ---------------------------------------------------------------------------
-- O coalesce garante que um NULL inesperado nunca libere o acesso.
CREATE OR REPLACE FUNCTION public._dashboard_assert_access()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT coalesce(
       public.viewer_has('view_dashboard'::public.permission_action)
       OR public.viewer_has('view_own_ministry_dashboard'::public.permission_action),
       false) THEN
    RAISE EXCEPTION 'Você não tem permissão para ver o dashboard.' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. dashboard_summary
-- ---------------------------------------------------------------------------
-- _at só escolhe a semana considerada (testes e, no futuro, a navegação por
-- semana do E2.14). Os números de membros são sempre o estado atual e não
-- dependem de _at.
--
-- Semana (relatórios e células sem relatório):
--   - reports_sent, visitors e cells_not_held: relatórios visíveis com data
--     entre o domingo e o sábado da semana;
--   - cells_pending (RN-08 a e d): células ativas e visíveis, com dia da
--     semana conhecido, cujo horário de reunião na semana já chegou (sem
--     horário, conta só a partir das 23:59:59 do dia) e que não têm nenhum
--     relatório na semana, visível ou não. O "<=" é proposital: uma célula de
--     segunda às 20:00 entra às 20:00, não às 19:59.
--     Limite conhecido: last_report_date é o último relatório de todos os
--     tempos. Com _at numa semana passada, uma célula que tem relatório numa
--     semana posterior não entra na conta, mesmo sem relatório na semana
--     consultada. Para a semana atual o valor é exato. A navegação por semana
--     (E2.14) ou a situação do relatório (report_status, E2.09) trocam este
--     cálculo.
-- Membros (estado atual, sobre members_view):
--   - total, ativos e inativos;
--   - batizados e não batizados, entre todos (ativos e inativos);
--   - sem liderança: ativos, não pastores e sem líder;
--   - sem vínculo celular (RN-08 c, MEM-14): ativos, não pastores, que não são
--     líder, timóteo nem anfitrião de célula e não participaram de relatório
--     nos últimos 30 dias (em qualquer célula, visível ou não).
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
  _local timestamp := coalesce(_at, now()) AT TIME ZONE 'America/Sao_Paulo';
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
    FROM public.cells_view cv
    WHERE cv.is_active
      AND cv.meeting_weekday IS NOT NULL
      AND (_ws + cv.meeting_weekday) + coalesce(cv.meeting_time, '23:59:59'::time) <= _local
      AND coalesce(cv.last_report_date, '-infinity'::date) < _ws
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

-- ---------------------------------------------------------------------------
-- 3. dashboard_cells_by_type
-- ---------------------------------------------------------------------------
-- Todas as células visíveis, ativas e inativas, como o dashboard faz hoje
-- (o E2.14 decide se as inativas continuam entrando).
CREATE OR REPLACE FUNCTION public.dashboard_cells_by_type()
RETURNS TABLE (
  cell_type text,
  total bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM public._dashboard_assert_access();

  RETURN QUERY
  SELECT cv.type, count(*)
    FROM public.cells_view cv
   GROUP BY cv.type
   ORDER BY cv.type;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. dashboard_g12_ranking (RN-08 b)
-- ---------------------------------------------------------------------------
-- Uma linha por casal G12, a partir dos membros ativos e visíveis:
--   - base: os membros de nível 1 (g12_level = 1);
--   - cônjuge: o spouse_id, se também estiver entre os ativos e visíveis; senão
--     o G12 aparece sozinho (o id de um cônjuge invisível não sai daqui);
--   - couple_key: "<menor id>|<maior id>" do casal, ou só o id sem cônjuge
--     (mesma chave do ranking que era calculado no front);
--   - name: o homem do casal; sem homem, o integrante de nível 1; com os dois
--     de nível 1 e do mesmo gênero, o de menor id. spouse_name é o outro, ou
--     nulo. A regra não depende de qual dos dois é a linha de partida, então as
--     linhas dos dois cônjuges de nível 1 concordam;
--   - células: a soma de male_cells e female_cells só dos integrantes de nível
--     1 do casal (um cônjuge de outro nível só dá o nome). Esses totais já
--     acumulam a subárvore inteira, então nenhuma célula conta duas vezes;
--   - casais com 0 células também aparecem;
--   - ordem: total de células (maior primeiro), nome e couple_key.
CREATE OR REPLACE FUNCTION public.dashboard_g12_ranking()
RETURNS TABLE (
  couple_key text,
  name text,
  spouse_name text,
  male_cells bigint,
  female_cells bigint,
  total_cells bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  PERFORM public._dashboard_assert_access();

  RETURN QUERY
  WITH active AS MATERIALIZED (
    -- Uma única leitura da members_view.
    SELECT
      mv.id,
      mv.name,
      mv.spouse_id,
      mv.g12_level,
      coalesce(mv.gender = 'M', false) AS is_male,
      coalesce(mv.male_cells, 0) AS male_cells,
      coalesce(mv.female_cells, 0) AS female_cells
    FROM public.members_view mv
    WHERE mv.is_active
  ),
  g12 AS (
    SELECT
      a.id,
      a.name,
      a.is_male,
      a.male_cells,
      a.female_cells,
      s.id AS spouse_id,
      s.name AS spouse_name,
      s.is_male AS spouse_is_male,
      s.g12_level AS spouse_level
    FROM active a
    LEFT JOIN active s ON s.id = a.spouse_id
    WHERE a.g12_level = 1
  ),
  pairs AS (
    SELECT
      CASE
        WHEN g.spouse_id IS NULL THEN g.id::text
        ELSE least(g.id, g.spouse_id)::text || '|' || greatest(g.id, g.spouse_id)::text
      END AS couple_key,
      -- O cônjuge vem primeiro? O homem primeiro; empatado, o de nível 1
      -- (g.id sempre é de nível 1); empatado de novo, o de menor id.
      CASE
        WHEN g.spouse_id IS NULL THEN false
        WHEN g.spouse_is_male <> g.is_male THEN g.spouse_is_male
        WHEN g.spouse_level <> 1 THEN false
        ELSE g.spouse_id < g.id
      END AS spouse_first,
      g.name,
      g.spouse_name,
      g.male_cells,
      g.female_cells
    FROM g12 g
  ),
  couples AS (
    SELECT
      p.couple_key,
      min(CASE WHEN p.spouse_first THEN p.spouse_name ELSE p.name END) AS name,
      min(CASE WHEN p.spouse_first THEN p.name ELSE p.spouse_name END) AS spouse_name,
      sum(p.male_cells) AS male_cells,
      sum(p.female_cells) AS female_cells
    FROM pairs p
    GROUP BY p.couple_key
  )
  SELECT
    c.couple_key,
    c.name,
    c.spouse_name,
    c.male_cells,
    c.female_cells,
    c.male_cells + c.female_cells
  FROM couples c
  ORDER BY c.male_cells + c.female_cells DESC, c.name, c.couple_key;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- O Supabase concede EXECUTE a anon por default privileges: o REVOKE explícito
-- deixa as quatro funções só para usuários logados. _dashboard_assert_access
-- precisa de EXECUTE para authenticated porque as RPCs são SECURITY INVOKER e
-- a chamam com o papel de quem consulta.
REVOKE EXECUTE ON FUNCTION public._dashboard_assert_access() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_summary(timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_cells_by_type() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.dashboard_g12_ranking() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public._dashboard_assert_access() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_summary(timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_cells_by_type() TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_g12_ranking() TO authenticated;
