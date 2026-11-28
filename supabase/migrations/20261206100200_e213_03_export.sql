-- E2.13 (PR 1, migration 3 de 3) — A exportação dos relatórios para Excel. Ver
-- docs/specs/e2-13-exportacao-excel.md no repositório apps-mci (Solução técnica: DT-01 a DT-10;
-- RN-01, RN-03 a RN-08, RN-10 a RN-14).
--
-- Conteúdo:
--   0. Pré-requisitos (E2.02, E2.03, E2.05, E2.06, E2.09, E2.10, E2.11, E2.12 e as migrations 1 e 2).
--   1. A permissão "Exportar Relatórios de Células" na função Líder (por nome) e, como documentação,
--      na Administrador (RN-01, DT-10). A Membro não recebe.
--   2. private.viewer_sees_reports_list(): quem tem a lista de Relatórios (a mesma regra do menu,
--      src/lib/access/access.ts).
--   3. private.cell_report_export_max_weeks() e private.cell_report_export_weeks(): as semanas da
--      exportação e as recusas de período (RN-03, DT-04), pelo relógio do servidor.
--   4. private.cell_report_export_rows(): as linhas, já filtradas e na ordem (RN-04 a RN-08, RN-10;
--      DT-05 a DT-07). Lê só a cell_reports_view e a cells_view de quem chama (escopo), mais o
--      was_held do relatório que quem exporta não vê (como a situação do E2.09) e o número da
--      célula. O WHERE é o do E2.12 (private.cell_report_filter_sql, alias v), aplicado depois de
--      calcular as linhas.
--   5. private.cell_report_export_labels(): os textos dos filtros do aviso, da aba "Informações" e do
--      evento (RN-03, RN-09, RN-11; DT-08), calculados aqui, com os nomes de agora.
--   6. public.cell_reports_export(): a RPC (definer, VOLATILE). Portão, permissão, semanas, linhas e o
--      evento "Exportação" numa transação só (RN-11, DT-09): sem evento, nenhuma linha sai. Sem
--      linhas, nem evento.
--   7. Privilégios e pós-condições.
--
-- Nenhuma tabela, view, trigger ou política muda. Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos
-- ===========================================================================
DO $$ BEGIN
  IF to_regprocedure('private.cell_report_filter_sql(private.cell_report_filter)') IS NULL         -- E2.12
     OR to_regprocedure('public.cell_report_filter_names(public.cell_filter_person, uuid[])') IS NULL
     OR to_regprocedure('public.cell_identity(uuid)') IS NULL                                     -- E2.10
     OR to_regprocedure('private.report_situation_rule(timestamp, boolean, integer, time, date[], boolean, tstzmultirange)') IS NULL
     OR to_regprocedure('private.report_week_counts(date, integer, time, tstzmultirange)') IS NULL  -- E2.09
     OR to_regclass('private.cell_active_periods') IS NULL
     OR to_regprocedure('public._del_raise(text, text, jsonb)') IS NULL                            -- E2.01
     OR to_regprocedure('public.viewer_member_id()') IS NULL                                       -- E2.03
     OR NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.permission_action'::regtype
                                            AND enumlabel = 'export_cell_reports')                 -- migration 1
     OR NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumtypid = 'public.event_action'::regtype
                                            AND enumlabel = 'export')
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.cells'::regclass
                                                 AND attname = 'code' AND NOT attisdropped) THEN   -- migration 2
    RAISE EXCEPTION 'E2.13 (migration 3) depende do E2.01 a E2.12 e das migrations 1 e 2 deste passo.';
  END IF;
END $$;

-- ===========================================================================
-- 1. A permissão nas funções semeadas (RN-01)
-- ===========================================================================
-- A Administrador já tem todas (role_effective_permissions); a linha é só documentação, como no
-- E2.02, e precisa da marca de manutenção (protect_role_permissions). A Líder é achada pelo nome
-- (roles_name_key), como no E2.02; renomeada, fica sem a permissão e a migration avisa.
DO $$
DECLARE
  _n integer;
BEGIN
  PERFORM set_config('app.role_maintenance', 'on', true);
  INSERT INTO public.role_permissions (role_id, permission)
  SELECT r.id, 'export_cell_reports'::public.permission_action
    FROM public.roles r
   WHERE r.is_system OR r.name = 'Líder'
  ON CONFLICT (role_id, permission) DO NOTHING;
  PERFORM set_config('app.role_maintenance', 'off', true);
  SELECT count(*) INTO _n FROM public.roles r WHERE r.name = 'Líder' AND NOT r.is_system;
  IF _n = 0 THEN
    RAISE NOTICE 'E2.13: a função "Líder" não existe; ninguém além da Administrador recebeu "Exportar Relatórios de Células".';
  END IF;
END $$;

-- ===========================================================================
-- 2. Quem tem a lista de Relatórios (RN-01; AQ-6 da UX)
-- ===========================================================================
-- A mesma regra do item "Relatórios" do menu (MENU_RULES em src/lib/access/access.ts): ver pessoas,
-- ver relatórios ou poder lançar algum. Mudou uma, mude a outra.
CREATE OR REPLACE FUNCTION private.viewer_sees_reports_list()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT public.viewer_has('view_all_church'::public.permission_action)
      OR public.viewer_has('view_own_ministry'::public.permission_action)
      OR public.viewer_has('view_all_reports'::public.permission_action)
      OR public.viewer_has('view_own_reports'::public.permission_action)
      OR public.viewer_has('submit_own_cell_report'::public.permission_action)
      OR public.viewer_has('submit_any_visible_report'::public.permission_action)
      OR public.viewer_has('edit_cell'::public.permission_action)
$$;

-- ===========================================================================
-- 3. As semanas da exportação (RN-03, DT-04)
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.cell_report_export_max_weeks()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT 13 $$;

-- As semanas que têm pelo menos um dia no Período, inteiras, até a semana atual. Recusas, na ordem
-- da RN-03: sem De ou sem Até (também datas invertidas, que a lista desliga: DA-6 do E2.12), mais de
-- 13 semanas e período que ainda não começou. As semanas depois da atual não contam no limite.
CREATE OR REPLACE FUNCTION private.cell_report_export_weeks(
  _date_from date, _date_to date, _at timestamptz,
  OUT first_week date, OUT last_week date, OUT week_count integer, OUT current_week date)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
BEGIN
  current_week := public.week_start(public.sp_local(coalesce(_at, now()))::date);
  IF _date_from IS NULL OR _date_to IS NULL OR _date_from > _date_to THEN
    PERFORM public._del_raise('export_period_required',
      'Para exportar, informe o período (De e Até) ou use um atalho de semana.');
  END IF;
  first_week := public.week_start(_date_from);
  IF first_week > current_week THEN
    PERFORM public._del_raise('export_period_not_started',
      'O período escolhido ainda não começou. Escolha um período até esta semana.');
  END IF;
  last_week := least(public.week_start(_date_to), current_week);
  week_count := (last_week - first_week) / 7 + 1;
  IF week_count > private.cell_report_export_max_weeks() THEN
    PERFORM public._del_raise('export_period_too_long',
      'A exportação aceita até 13 semanas. Diminua o período.',
      jsonb_build_object('max_weeks', private.cell_report_export_max_weeks()));
  END IF;
END $$;

-- ===========================================================================
-- 4. As linhas (RN-04 a RN-08, RN-10; DT-05 a DT-07)
-- ===========================================================================
-- Devolve o número de linhas e um jsonb com uma lista por linha, na ordem da RN-08. A tupla
-- (contrato da tela, "Contratos" do spec):
--    0 semana (o domingo)       6 número do endereço       12 nº de participantes
--    1 número da célula (code)  7 bairro                   13 nº de visitantes
--    2 G12: pastors|name|none   8 situação                 14 motivo de "Não houve célula"
--    3 nome do G12              9 data (só realizada)      15 observações
--    4 líder                   10 horário HH:MM            16 célula excluída
--    5 rua                     11 oferta
-- situação: held, not_held, not_sent (Relatório não enviado), not_yet (Ainda não ocorreu).
--
-- (a) os relatórios da cell_reports_view (escopo pelo retrato, sem excluídos) com data nas semanas;
-- (b) cada célula da cells_view (visível, não excluída) em cada semana sem relatório visível dela:
--     com o relatório que quem exporta não vê, a situação dele (was_held lido da tabela, como a
--     situação do E2.09, P-SIT-12), sem nenhum dado; sem relatório, na semana atual, a situação do
--     E2.09 (report_situation_rule: not_yet ou pending), e numa semana passada, "não enviado" se a
--     semana contava (report_week_counts, com o histórico de cell_active_periods).
-- Os filtros (o WHERE do E2.12, alias v) valem sobre as duas partes juntas, depois do cálculo: nenhum
-- filtro traz uma linha que (a) e (b) não trariam. Em (b), as colunas do filtro são as da célula
-- atual: o líder, o G12 do líder, o tipo, a busca só no nome do líder e o was_held do relatório
-- invisível (nulo sem relatório: a Reunião tira a linha). O Período já vem trocado pelas semanas.
CREATE OR REPLACE FUNCTION private.cell_report_export_rows(
  _f private.cell_report_filter, _first_week date, _last_week date, _at timestamptz,
  OUT row_count bigint, OUT rows jsonb)
LANGUAGE plpgsql
VOLATILE
SET search_path = ''
AS $$
DECLARE
  _local timestamp := public.sp_local(coalesce(_at, now()));
  _current date := public.week_start(public.sp_local(coalesce(_at, now()))::date);
BEGIN
  EXECUTE format($q$
    WITH weeks AS (
      SELECT ($2 + 7 * g)::date AS ws
        FROM generate_series(0, ($3 - $2) / 7) AS g
    ),
    vr AS MATERIALIZED (
      SELECT v.id, v.cell_id, v.week_start AS ws, v.date, v."time", v.was_held, v.reason_not_held,
             v.observations, v.offering, v.participants_count, v.visitors_count, v.search_text,
             v.snapshot_leader_id, v.snapshot_leader_name, v.snapshot_leader_is_pastor,
             v.snapshot_leader_g12_level, v.snapshot_g12_leader_id, v.snapshot_g12_leader_name,
             v.snapshot_cell_type, v.cell_deleted
        FROM public.cell_reports_view v
       WHERE v.date >= $2 AND v.date <= $3 + 6
    ),
    cw AS (
      SELECT cv.id AS cell_id, w.ws, cv.leader_id, cv.leader_name, cv.leader_is_pastor,
             cv.leader_g12_level, cv.g12_leader_id, cv.g12_leader_name, cv.type, cv.is_active,
             public.weekday_index(cv.meeting_day) AS wd, cv.meeting_time,
             r.was_held AS other_held, p.periods
        FROM public.cells_view cv
       CROSS JOIN weeks w
        LEFT JOIN public.cell_reports r
               ON r.cell_id = cv.id AND r.deleted_at IS NULL AND public.week_start(r.date) = w.ws
        LEFT JOIN private.cell_active_periods p ON p.cell_id = cv.id
       WHERE NOT EXISTS (SELECT 1 FROM vr WHERE vr.cell_id = cv.id AND vr.ws = w.ws)
    ),
    cs AS (
      SELECT cw.*,
             CASE
               WHEN cw.other_held IS NOT NULL THEN CASE WHEN cw.other_held THEN 'held' ELSE 'not_held' END
               WHEN cw.ws = $4 THEN
                 (SELECT CASE s.report_status WHEN 'not_yet' THEN 'not_yet' WHEN 'pending' THEN 'not_sent' END
                    FROM private.report_situation_rule($5, cw.is_active, cw.wd, cw.meeting_time,
                                                       '{}'::date[], NULL, cw.periods) s)
               WHEN cw.wd IS NOT NULL
                    AND coalesce(private.report_week_counts(cw.ws, cw.wd, cw.meeting_time, cw.periods), false)
                 THEN 'not_sent'
             END AS situation
        FROM cw
    ),
    u AS (
      SELECT vr.cell_id, vr.ws, vr.date, vr.search_text, vr.snapshot_leader_id,
             vr.snapshot_g12_leader_id, vr.snapshot_cell_type, vr.was_held,
             vr.snapshot_leader_name AS leader_name, vr.snapshot_leader_is_pastor AS leader_is_pastor,
             vr.snapshot_leader_g12_level AS leader_level, vr.snapshot_g12_leader_name AS g12_name_raw,
             CASE WHEN vr.was_held THEN 'held' ELSE 'not_held' END AS situation,
             CASE WHEN vr.was_held THEN vr.date END AS out_date,
             CASE WHEN vr.was_held THEN to_char(vr."time", 'HH24:MI') END AS out_time,
             CASE WHEN vr.was_held THEN vr.offering END AS out_offering,
             CASE WHEN vr.was_held THEN vr.participants_count END AS out_participants,
             CASE WHEN vr.was_held THEN vr.visitors_count END AS out_visitors,
             CASE WHEN NOT vr.was_held THEN vr.reason_not_held END AS out_reason,
             vr.observations AS out_observations,
             coalesce(vr.cell_deleted, false) AS out_deleted
        FROM vr
      UNION ALL
      SELECT cs.cell_id, cs.ws, cs.ws, public.search_normalize(cs.leader_name), cs.leader_id,
             cs.g12_leader_id, cs.type, cs.other_held,
             cs.leader_name, cs.leader_is_pastor, cs.leader_g12_level, cs.g12_leader_name,
             cs.situation, NULL::date, NULL::text, NULL::numeric, NULL::bigint, NULL::integer,
             NULL::text, NULL::text, false
        FROM cs
       WHERE cs.situation IS NOT NULL
    ),
    g AS (
      SELECT u.*,
             CASE WHEN u.leader_is_pastor OR u.leader_level = 0 THEN 'pastors'
                  WHEN u.leader_level IS NULL THEN 'none'
                  WHEN coalesce(u.g12_name_raw, CASE WHEN u.leader_level = 1 THEN u.leader_name END) IS NOT NULL
                    THEN 'name'
                  ELSE 'none' END AS g12_kind
        FROM u
    ),
    v AS (
      SELECT g.*,
             CASE WHEN g.g12_kind = 'name'
                  THEN coalesce(g.g12_name_raw, CASE WHEN g.leader_level = 1 THEN g.leader_name END) END AS g12_name,
             CASE g.g12_kind WHEN 'pastors' THEN 0 WHEN 'name' THEN 1 ELSE 2 END AS g12_rank
        FROM g
    )
    SELECT count(*),
           coalesce(jsonb_agg(jsonb_build_array(
                      v.ws, c.code, v.g12_kind, v.g12_name, v.leader_name, c.street, c.number,
                      c.neighborhood, v.situation, v.out_date, v.out_time, v.out_offering,
                      v.out_participants, v.out_visitors, v.out_reason, v.out_observations, v.out_deleted)
                    ORDER BY v.ws, v.g12_rank,
                             public.search_normalize(v.g12_name) COLLATE "C", v.g12_name COLLATE "C",
                             v.snapshot_g12_leader_id,
                             public.search_normalize(v.leader_name) COLLATE "C", v.leader_name COLLATE "C",
                             v.snapshot_leader_id, c.code NULLS LAST, v.cell_id),
                    '[]'::jsonb)
      FROM v
      JOIN public.cells c ON c.id = v.cell_id
     WHERE %s
  $q$, private.cell_report_filter_sql(_f))
    INTO row_count, rows
    USING _f, _first_week, _last_week, _current, _local;
END $$;

-- ===========================================================================
-- 5. Os textos dos filtros (RN-03, RN-09, RN-11; DT-08)
-- ===========================================================================
-- Os mesmos textos dos chips da lista (src/lib/cell-reports/filter-texts.ts e filters.ts), na ordem
-- dos chips, sem De e Até, e a busca por último. Conferidos pela tabela de casos
-- supabase/tests/fixtures/report-export-cases.json (pgTAP e Vitest). Os nomes são os de agora, pelas
-- mesmas regras do E2.12: a pessoa que quem exporta não vê é "Pessoa indisponível"; a célula, pela
-- cell_identity (E2.10). _search_label é o texto digitado (até 100 caracteres), só quando a busca
-- vale (padrões não vazios); sem ele, os termos dos padrões.
CREATE OR REPLACE FUNCTION private.cell_report_export_labels(
  _cell_id uuid, _leader_ids uuid[], _g12_ids uuid[], _types text[], _held boolean,
  _search text[], _search_label text)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  _labels text[] := '{}';
  _cell record;
  _patterns text[];
  _text text;
BEGIN
  IF _cell_id IS NOT NULL THEN
    SELECT ci.leader_name, ci.meeting_day, ci.meeting_time INTO _cell
      FROM public.cell_identity(_cell_id) ci LIMIT 1;
    IF FOUND THEN
      _labels := _labels || concat_ws(' · ',
                   'Célula de ' || coalesce(nullif(_cell.leader_name, ''), 'Membro sem nome'),
                   nullif(_cell.meeting_day, ''),
                   to_char(_cell.meeting_time, 'HH24:MI'));
    ELSE
      _labels := _labels || 'Célula indisponível'::text;
    END IF;
  END IF;

  _labels := _labels || coalesce((
    SELECT array_agg('Líder: ' || coalesce(n.name, 'Pessoa indisponível') ORDER BY w.ord)
      FROM unnest(public.first_distinct_ids(_leader_ids, 10)) WITH ORDINALITY AS w(wid, ord)
      LEFT JOIN public.cell_report_filter_names('leader', _leader_ids) n ON n.id = w.wid), '{}');
  _labels := _labels || coalesce((
    SELECT array_agg('G12: ' || coalesce(n.name, 'Pessoa indisponível') ORDER BY w.ord)
      FROM unnest(public.first_distinct_ids(_g12_ids, 10)) WITH ORDINALITY AS w(wid, ord)
      LEFT JOIN public.cell_report_filter_names('g12', _g12_ids) n ON n.id = w.wid), '{}');

  _labels := _labels || coalesce((
    SELECT array_agg('Tipo: ' || t.x ORDER BY t.ord)
      FROM (SELECT x, min(i) AS ord FROM unnest(_types) WITH ORDINALITY AS u(x, i)
             WHERE x = ANY (public.cell_types()) GROUP BY x) t), '{}');

  IF _held IS NOT NULL THEN
    _labels := _labels || ('Reunião: ' || CASE WHEN _held THEN 'Célula realizada' ELSE 'Não houve célula' END);
  END IF;

  _patterns := (SELECT array_agg(s.p ORDER BY s.i)
                  FROM (SELECT t.p, t.i FROM unnest(_search) WITH ORDINALITY t(p, i)
                         WHERE coalesce(t.p, '') <> '' ORDER BY t.i LIMIT 5) s);
  IF _patterns IS NOT NULL THEN
    _text := nullif(btrim(left(coalesce(_search_label, ''), 100)), '');
    IF _text IS NULL THEN
      _text := array_to_string(ARRAY(SELECT replace(btrim(p, '%'), '\', '') FROM unnest(_patterns) p), ' ');
    END IF;
    _labels := _labels || ('Busca: “' || _text || '”');
  END IF;
  RETURN _labels;
END $$;

-- ===========================================================================
-- 6. A RPC (RN-01, RN-03, RN-11, RN-13; DT-01, DT-03, DT-09)
-- ===========================================================================
-- Definer: lê private (a situação, o histórico, o was_held invisível, o número) e grava o evento. As
-- linhas vêm só das views de quem chama, que filtram por auth.uid(). VOLATILE: o PostgREST chama numa
-- transação de escrita, e o evento e a resposta saem juntos (sem evento, nada sai). A resposta é um
-- jsonb só (o PostgREST corta SETOF em 1000 linhas).
CREATE OR REPLACE FUNCTION public.cell_reports_export(
  _search text[] DEFAULT NULL, _search_label text DEFAULT NULL, _cell_id uuid DEFAULT NULL,
  _leader_ids uuid[] DEFAULT NULL, _g12_ids uuid[] DEFAULT NULL,
  _date_from date DEFAULT NULL, _date_to date DEFAULT NULL,
  _types text[] DEFAULT NULL, _held boolean DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid;
  _w record;
  _f private.cell_report_filter;
  _r record;
  _labels text[];
  _weeks jsonb;
  _end date;
  _name text;
  _count text;
BEGIN
  _me := public.viewer_member_id();                        -- o portão do E2.03 sempre
  IF _me IS NULL
     OR NOT public.viewer_has('export_cell_reports'::public.permission_action)
     OR NOT private.viewer_sees_reports_list() THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;

  _w := private.cell_report_export_weeks(_date_from, _date_to, now());
  _end := _w.last_week + 6;
  _weeks := jsonb_build_object('start', _w.first_week, 'end', _end, 'count', _w.week_count);

  -- O filtro da lista (E2.12), com o Período trocado pelas semanas inteiras (RN-03).
  _f := private.cell_report_filter_normalize(_search, _cell_id, _leader_ids, _g12_ids,
                                             _w.first_week, _end, _types, _held);
  _r := private.cell_report_export_rows(_f, _w.first_week, _w.last_week, now());

  IF _r.row_count = 0 THEN                                 -- RN-13: sem arquivo e sem evento
    RETURN jsonb_build_object('result', 'empty', 'weeks', _weeks);
  END IF;

  _labels := private.cell_report_export_labels(_cell_id, _leader_ids, _g12_ids, _types, _held,
                                               _search, _search_label);
  SELECT m.name INTO _name FROM public.members m WHERE m.id = _me;
  _count := replace(to_char(_r.row_count, 'FM999,999,999'), ',', '.')
            || CASE WHEN _r.row_count = 1 THEN ' linha' ELSE ' linhas' END;

  -- RN-11: o evento, sem o conteúdo. Sem registro (entity_id nulo): não entra em "Ver histórico".
  INSERT INTO public.events (actor_user_id, actor_label, actor_kind, action, entity, entity_id,
                             entity_label, description, metadata, success)
  VALUES (auth.uid(), _name, 'member', 'export', 'cell_report', NULL, NULL,
          format('Exportou a planilha de relatórios de %s a %s (%s)',
                 to_char(_w.first_week, 'DD/MM/YYYY'), to_char(_end, 'DD/MM/YYYY'), _count),
          jsonb_build_object(
            'weeks', _weeks,
            'filters', to_jsonb(_labels),
            'rows', _r.row_count,
            'applied', jsonb_strip_nulls(jsonb_build_object(
              'search', _f.search, 'cell_id', _f.cell_id, 'leader_ids', _f.leader_ids,
              'g12_ids', _f.g12_ids, 'types', _f.types, 'held', _f.held))),
          true);

  RETURN jsonb_build_object(
    'result', 'ok',
    'weeks', _weeks,
    'filters', to_jsonb(_labels),
    'generated_by', _name,
    'generated_at', to_char(public.sp_local(now()), 'YYYY-MM-DD"T"HH24:MI'),
    'row_count', _r.row_count,
    'rows', _r.rows);
END $$;

COMMENT ON FUNCTION public.cell_reports_export(text[], text, uuid, uuid[], uuid[], date, date, text[], boolean) IS
  'E2.13: a planilha dos relatórios com os filtros da lista (as linhas em jsonb) e o evento "Exportação" numa transação. Ver o spec, "Contratos".';

-- ===========================================================================
-- 7. Privilégios e pós-condições
-- ===========================================================================
ALTER FUNCTION private.viewer_sees_reports_list() OWNER TO postgres;
ALTER FUNCTION private.cell_report_export_max_weeks() OWNER TO postgres;
ALTER FUNCTION private.cell_report_export_weeks(date, date, timestamptz) OWNER TO postgres;
ALTER FUNCTION private.cell_report_export_rows(private.cell_report_filter, date, date, timestamptz) OWNER TO postgres;
ALTER FUNCTION private.cell_report_export_labels(uuid, uuid[], uuid[], text[], boolean, text[], text) OWNER TO postgres;
ALTER FUNCTION public.cell_reports_export(text[], text, uuid, uuid[], uuid[], date, date, text[], boolean) OWNER TO postgres;

REVOKE ALL ON FUNCTION private.viewer_sees_reports_list(),
  private.cell_report_export_max_weeks(),
  private.cell_report_export_weeks(date, date, timestamptz),
  private.cell_report_export_rows(private.cell_report_filter, date, date, timestamptz),
  private.cell_report_export_labels(uuid, uuid[], uuid[], text[], boolean, text[], text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cell_reports_export(text[], text, uuid, uuid[], uuid[], date, date, text[], boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cell_reports_export(text[], text, uuid, uuid[], uuid[], date, date, text[], boolean)
  TO authenticated;

DO $$
DECLARE
  _rpc regprocedure := 'public.cell_reports_export(text[], text, uuid, uuid[], uuid[], date, date, text[], boolean)';
  _priv regprocedure[] := ARRAY[
    'private.viewer_sees_reports_list()'::regprocedure,
    'private.cell_report_export_max_weeks()'::regprocedure,
    'private.cell_report_export_weeks(date, date, timestamptz)'::regprocedure,
    'private.cell_report_export_rows(private.cell_report_filter, date, date, timestamptz)'::regprocedure,
    'private.cell_report_export_labels(uuid, uuid[], uuid[], text[], boolean, text[], text)'::regprocedure];
  _p regprocedure;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = _rpc)
     OR (SELECT provolatile FROM pg_proc WHERE oid = _rpc) <> 'v'
     OR NOT (SELECT coalesce(proconfig @> ARRAY['search_path=public'], false) FROM pg_proc WHERE oid = _rpc)
     OR NOT has_function_privilege('authenticated', _rpc, 'EXECUTE')
     OR has_function_privilege('anon', _rpc, 'EXECUTE')
     OR has_function_privilege('service_role', _rpc, 'EXECUTE') THEN
    RAISE EXCEPTION 'E2.13: modo de segurança ou privilégios da cell_reports_export diferentes do desenho.';
  END IF;
  FOREACH _p IN ARRAY _priv LOOP
    IF (SELECT prosecdef FROM pg_proc WHERE oid = _p)
       OR has_function_privilege('anon', _p, 'EXECUTE')
       OR has_function_privilege('authenticated', _p, 'EXECUTE')
       OR has_function_privilege('service_role', _p, 'EXECUTE') THEN
      RAISE EXCEPTION 'E2.13: modo de segurança ou privilégios das funções diferentes do desenho (%).', _p;
    END IF;
  END LOOP;
  IF has_schema_privilege('authenticated', 'private', 'USAGE')
     OR has_schema_privilege('anon', 'private', 'USAGE') THEN
    RAISE EXCEPTION 'E2.13: o schema private não pode ter USAGE para a API.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
                  WHERE r.is_system AND rp.permission = 'export_cell_reports')
     OR EXISTS (SELECT 1 FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
                 WHERE r.name = 'Membro' AND rp.permission = 'export_cell_reports') THEN
    RAISE EXCEPTION 'E2.13: a permissão nova nas funções semeadas diferente do desenho.';
  END IF;
END $$;
