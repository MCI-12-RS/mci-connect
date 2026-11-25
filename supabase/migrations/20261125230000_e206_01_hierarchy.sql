-- E2.06 (PR 1, migration 1) — Hierarquia e totais na mesma operação.
-- Ver docs/specs/e2-06-hierarquia-totais.md no repositório apps-mci
-- ("Modelo de dados e migrations", "Manutenção na mesma operação",
-- "Bloqueios e concorrência", "Formato dos erros", "Contratos"; RN-01, RN-03 a
-- RN-08, RN-12, RN-13; DA-2; DT-01 a DT-09).
--
-- 0. Guarda dos pré-requisitos (E2.01 PR 1, E2.02 PR 1) e dos dados sem topo
--    (DA-2). Falha cedo, sem mudar nada; as mensagens trazem só ids.
-- 1. private.member_hierarchy (uma linha por membro, inclusive os excluídos,
--    congelados), índices, RLS sem políticas e sem privilégios; o tipo
--    private.hierarchy_delta.
-- 2. Funções internas (private, sem grants) e de trigger (public, prefixo
--    _hierarchy_, sem EXECUTE para PUBLIC, anon, authenticated e service_role).
-- 3. Três triggers: ac_lock_member_tree (BEFORE, members), trg_member_hierarchy
--    (AFTER, members) e trg_cell_hierarchy (AFTER, cells).
-- 4. restore_member pega a trava da árvore antes das travas de identificador
--    (a ordem global abaixo). O resto do corpo é o da migration 1 do E2.04.
-- 5. Backfill (private.rebuild_member_hierarchy) e pós-condição
--    (private.member_hierarchy_drift vazia).
--
-- Os triggers e as funções antigas (compute_member_g12_level,
-- trg_refresh_stats_*) continuam até a migration 3: as views ainda leem as
-- colunas antigas de members, e as duas formas convivem (DT-10).
--
-- Ordem global de aquisição das travas (estende a do E2.01 e a do E2.04):
--   1. linhas de negócio (relatório, célula, membro gravado; FOR UPDATE das
--      RPCs de exclusão e restauração; FOR KEY SHARE das pessoas escolhidas);
--   2. a trava 'admin-members' (E2.02);
--   3. a trava da árvore 'members:leader-tree' (mesma chave do E2.04):
--      exclusiva na troca de líder (inclusive para nulo), na troca de sexo e
--      no recálculo do zero; compartilhada no resto que muda a árvore ou os
--      totais. Em members vem do BEFORE ac_lock_member_tree, que pega a
--      exclusiva sempre que o ad_enforce_member_rules pegaria (o ad_ só
--      reentra, nunca sobe de compartilhada para exclusiva); em cells, do
--      AFTER trg_cell_hierarchy;
--   4. as travas de identificador 'member-identifier:*' (E2.04);
--   5. as linhas de private.member_hierarchy, uma vez por gravação de linha,
--      em ordem de member_id;
--   6. os eventos da Auditoria.
--
-- Pode rodar de novo sem erro: CREATE ... IF NOT EXISTS, CREATE OR REPLACE,
-- DROP TRIGGER IF EXISTS antes de CREATE TRIGGER, tipo em DO com guarda de
-- duplicate_object; o backfill só grava o que difere.

-- ===========================================================================
-- 0. Pré-requisitos e guarda dos dados sem topo
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.members'::regclass
                  AND attname = 'deleted_at' AND NOT attisdropped)
     OR to_regnamespace('private') IS NULL
     OR to_regprocedure('public._del_raise(text, text, jsonb)') IS NULL
     OR to_regprocedure('public.viewer_tree_roots()') IS NULL
     OR to_regprocedure('public.get_ministry_root(uuid)') IS NOT NULL
     OR to_regprocedure('public._member_values_in_use(uuid, text, text, text, boolean)') IS NULL
     OR to_regprocedure('public.restore_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'E2.06 (migration 1) depende do PR 1 do E2.01, do PR 1 do E2.02 e do PR 1 do E2.04.';
  END IF;
END $$;

-- DA-2: membro não excluído cuja cadeia não chega a um topo (ciclo ou líder
-- excluído). Só ids na mensagem.
DO $$
DECLARE
  _ids uuid[];
BEGIN
  WITH RECURSIVE live AS (
    SELECT id, leader_id FROM public.members WHERE deleted_at IS NULL
  ),
  tree AS (
    SELECT id FROM live WHERE leader_id IS NULL
    UNION ALL
    SELECT l.id FROM tree t JOIN live l ON l.leader_id = t.id
  )
  SELECT array_agg(l.id ORDER BY l.id) INTO _ids
    FROM live l
   WHERE NOT EXISTS (SELECT 1 FROM tree t WHERE t.id = l.id);
  IF _ids IS NOT NULL THEN
    RAISE EXCEPTION 'E2.06: membros sem topo (ciclo ou líder excluído): %', _ids;
  END IF;
END $$;

-- ===========================================================================
-- 1. Tabela, tipo, índices e privilégios (DT-01, DT-02, DT-03)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS private.member_hierarchy (
  member_id       uuid PRIMARY KEY REFERENCES public.members (id) ON DELETE CASCADE,
  ancestor_ids    uuid[]  NOT NULL DEFAULT '{}',   -- RN-04: do topo ao líder direto
  g12_level       integer,                          -- RN-01: 0 pastor; nulo sem liderança ou sem topo
  g12_id          uuid GENERATED ALWAYS AS (        -- RN-04: logo abaixo do topo; o próprio no nível 1
                    CASE cardinality(ancestor_ids) WHEN 0 THEN NULL
                                                   WHEN 1 THEN member_id
                                                   ELSE ancestor_ids[2] END) STORED,
  total_disciples integer NOT NULL DEFAULT 0,       -- RN-05
  total_cells     integer NOT NULL DEFAULT 0,       -- RN-06: todas, inclusive de líder sem sexo
  male_cells      integer NOT NULL DEFAULT 0,
  female_cells    integer NOT NULL DEFAULT 0,
  CONSTRAINT member_hierarchy_level_check
    CHECK (g12_level IS NULL OR g12_level = cardinality(ancestor_ids)),
  CONSTRAINT member_hierarchy_not_own_ancestor_check
    CHECK (NOT member_id = ANY (ancestor_ids)),
  CONSTRAINT member_hierarchy_totals_check
    CHECK (total_disciples >= 0 AND male_cells >= 0 AND female_cells >= 0
           AND total_cells >= male_cells + female_cells)
);

COMMENT ON TABLE private.member_hierarchy IS
  'Campos calculados da hierarquia (E2.06): cadeia, nível, G12 e totais, uma linha por membro. '
  'Só as funções _hierarchy_* e hierarchy_* escrevem; leitura pelo front só pelas views e pela '
  'ministry_tree_nodes. Depois de uma carga em replica: SELECT private.rebuild_member_hierarchy(); '
  'e private.member_hierarchy_drift() precisa voltar vazia.';

-- "Abaixo de X" (E2.07, testes, troca de líder): ancestor_ids @> ARRAY[X].
CREATE INDEX IF NOT EXISTS member_hierarchy_ancestor_ids_idx
  ON private.member_hierarchy USING gin (ancestor_ids);
-- Filtros e ranking por G12 e por nível (E2.07, E2.10, E2.12, E2.14).
CREATE INDEX IF NOT EXISTS member_hierarchy_g12_id_idx
  ON private.member_hierarchy (g12_id) WHERE g12_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS member_hierarchy_g12_level_idx
  ON private.member_hierarchy (g12_level);

ALTER TABLE private.member_hierarchy OWNER TO postgres;
ALTER TABLE private.member_hierarchy ENABLE ROW LEVEL SECURITY;          -- sem políticas
REVOKE ALL ON TABLE private.member_hierarchy FROM PUBLIC, anon, authenticated, service_role;

-- Diferença a somar numa linha.
DO $$
BEGIN
  CREATE TYPE private.hierarchy_delta AS (
    member_id uuid, disciples integer, cells integer, male integer, female integer);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;

-- ===========================================================================
-- 2. Funções internas (private)
-- ===========================================================================

-- Cadeia a partir do líder, subindo por members (a fonte da verdade), só por
-- não excluídos, com a lista dos visitados (DT-08). resolved é falso num
-- ciclo, num líder excluído ou num id inexistente; aí ancestor_ids volta
-- vazio. Termina com qualquer dado.
CREATE OR REPLACE FUNCTION private.hierarchy_path(
  _leader_id uuid, OUT ancestor_ids uuid[], OUT resolved boolean, OUT visited uuid[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _cur uuid := _leader_id;
  _next uuid;
  _deleted timestamptz;
BEGIN
  visited := '{}';
  resolved := true;
  WHILE _cur IS NOT NULL LOOP
    IF _cur = ANY (visited) THEN
      resolved := false;                         -- ciclo
      EXIT;
    END IF;
    visited := visited || _cur;
    SELECT m.leader_id, m.deleted_at INTO _next, _deleted
      FROM public.members m WHERE m.id = _cur;
    IF NOT FOUND OR _deleted IS NOT NULL THEN
      resolved := false;                         -- líder excluído ou inexistente
      EXIT;
    END IF;
    _cur := _next;
  END LOOP;
  IF resolved THEN
    -- visited vai do líder direto ao topo; a cadeia vai do topo ao líder direto.
    ancestor_ids := ARRAY(SELECT visited[i] FROM generate_subscripts(visited, 1, true) AS i);
  ELSE
    ancestor_ids := '{}';
  END IF;
END $$;

-- RN-01: nulo sem topo; com líder, o tamanho da cadeia; topo pastor, 0; topo
-- sem liderança, nulo (P-HIE-01).
CREATE OR REPLACE FUNCTION private.hierarchy_level(
  _ancestor_ids uuid[], _resolved boolean, _has_leader boolean, _is_pastor boolean)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN NOT _resolved THEN NULL
    WHEN _has_leader THEN cardinality(_ancestor_ids)
    WHEN _is_pastor THEN 0
  END
$$;

-- A mesma diferença para cada id.
CREATE OR REPLACE FUNCTION private.hierarchy_spread(
  _ids uuid[], _disciples integer, _cells integer, _male integer, _female integer)
RETURNS private.hierarchy_delta[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(ROW(i, _disciples, _cells, _male, _female)::private.hierarchy_delta),
                  '{}'::private.hierarchy_delta[])
    FROM unnest(_ids) AS i
$$;

-- Erro amigável do recálculo (AQ-5): 22023, app_error, reason no DETAIL.
CREATE OR REPLACE FUNCTION private.hierarchy_fail(_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public._del_raise('hierarchy_update_failed',
    'Não foi possível salvar as alterações. Tente de novo.',
    jsonb_build_object('reason', _reason));
END $$;

-- Uma célula a mais (_sign = 1) ou a menos (-1) no líder e na cadeia guardada
-- dele, na divisão do sexo atual do líder. Líder excluído ou inexistente (só
-- por carga): nada, como no recálculo do zero.
CREATE OR REPLACE FUNCTION private.hierarchy_cell_spread(_leader_id uuid, _sign integer)
RETURNS private.hierarchy_delta[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _gender text;
  _deleted timestamptz;
  _anc uuid[];
BEGIN
  SELECT m.gender, m.deleted_at INTO _gender, _deleted FROM public.members m WHERE m.id = _leader_id;
  IF NOT FOUND OR _deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;
  SELECT h.ancestor_ids INTO _anc FROM private.member_hierarchy h WHERE h.member_id = _leader_id;
  IF NOT FOUND THEN
    PERFORM private.hierarchy_fail('missing_row');
  END IF;
  RETURN private.hierarchy_spread(_anc || _leader_id, 0, _sign,
           _sign * coalesce(_gender = 'M', false)::int,
           _sign * coalesce(_gender = 'F', false)::int);
END $$;

-- Soma as diferenças por id (os de cima comuns ao antes e ao depois se
-- anulam), ignora as que dão zero, trava as linhas em ordem de member_id e
-- grava (DT-05). Linha que falta ou total negativo: hierarchy_update_failed.
CREATE OR REPLACE FUNCTION private.hierarchy_apply(_deltas private.hierarchy_delta[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _net private.hierarchy_delta[];
  _n integer;
BEGIN
  SELECT array_agg(ROW(x.member_id, x.disciples, x.cells, x.male, x.female)::private.hierarchy_delta
                   ORDER BY x.member_id)
    INTO _net
    FROM (SELECT d.member_id, sum(d.disciples)::int AS disciples, sum(d.cells)::int AS cells,
                 sum(d.male)::int AS male, sum(d.female)::int AS female
            FROM unnest(_deltas) d
           GROUP BY d.member_id) x
   WHERE (x.disciples, x.cells, x.male, x.female) <> (0, 0, 0, 0);
  IF _net IS NULL THEN
    RETURN;
  END IF;
  -- Trava em ordem de id, numa leitura só (o LockRows fica acima do Sort).
  PERFORM 1 FROM private.member_hierarchy h
   WHERE h.member_id = ANY (ARRAY(SELECT (x).member_id FROM unnest(_net) x))
   ORDER BY h.member_id
     FOR UPDATE;
  BEGIN
    UPDATE private.member_hierarchy h
       SET total_disciples = h.total_disciples + x.disciples,
           total_cells     = h.total_cells     + x.cells,
           male_cells      = h.male_cells      + x.male,
           female_cells    = h.female_cells    + x.female
      FROM unnest(_net) x
     WHERE h.member_id = x.member_id;
    GET DIAGNOSTICS _n = ROW_COUNT;
  EXCEPTION WHEN check_violation THEN
    PERFORM private.hierarchy_fail('negative_total');
  END;
  IF _n <> cardinality(_net) THEN
    PERFORM private.hierarchy_fail('missing_row');
  END IF;
END $$;

-- Cadeia, nível e totais do zero para _root e a subárvore viva dele (troca de
-- líder e restauração). Os excluídos ficam de fora da descida (P-HIE-13).
CREATE OR REPLACE FUNCTION private.hierarchy_recompute_subtree(
  _root uuid, _ancestor_ids uuid[], _resolved boolean)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE sub AS (
    SELECT m.id, m.leader_id, m.is_pastor, m.is_active, m.gender, _ancestor_ids AS ancestor_ids
      FROM public.members m
     WHERE m.id = _root
    UNION ALL
    SELECT c.id, c.leader_id, c.is_pastor, c.is_active, c.gender, s.ancestor_ids || s.id
      FROM sub s
      JOIN public.members c ON c.leader_id = s.id
     WHERE c.deleted_at IS NULL
       AND NOT c.id = ANY (s.ancestor_ids || s.id)            -- guarda contra ciclo
  ),
  inside AS (                                                  -- a cadeia de cada um a partir de _root
    SELECT s.*, s.ancestor_ids[cardinality(_ancestor_ids) + 1 :] AS within FROM sub s
  ),
  disc AS (
    SELECT a AS id, count(*)::int AS n
      FROM inside i, unnest(i.within) a
     WHERE i.is_active
     GROUP BY a
  ),
  cel AS (
    SELECT o AS id, count(*)::int AS total,
           count(*) FILTER (WHERE l.gender = 'M')::int AS male,
           count(*) FILTER (WHERE l.gender = 'F')::int AS female
      FROM public.cells c
      JOIN inside l ON l.id = c.leader_id,
           unnest(l.within || l.id) o
     WHERE c.is_active AND c.deleted_at IS NULL
     GROUP BY o
  )
  UPDATE private.member_hierarchy h
     SET ancestor_ids    = CASE WHEN _resolved THEN i.ancestor_ids ELSE '{}'::uuid[] END,
         g12_level       = private.hierarchy_level(i.ancestor_ids, _resolved, i.leader_id IS NOT NULL, i.is_pastor),
         total_disciples = coalesce(d.n, 0),
         total_cells     = coalesce(c.total, 0),
         male_cells      = coalesce(c.male, 0),
         female_cells    = coalesce(c.female, 0)
    FROM inside i
    LEFT JOIN disc d ON d.id = i.id
    LEFT JOIN cel c ON c.id = i.id
   WHERE h.member_id = i.id
$$;

-- Os valores do zero para todos os membros não excluídos: a fórmula única da
-- RN-13 (backfill, carga do E4.07, reconciliação do E4.09 e prova dos testes).
-- Quem está "sem topo" (DA-2) recebe cadeia vazia e nível nulo, conta só as
-- próprias células e não soma para ninguém, como nos triggers.
CREATE OR REPLACE FUNCTION private.member_hierarchy_expected()
RETURNS TABLE (member_id uuid, ancestor_ids uuid[], g12_level integer, total_disciples integer,
               total_cells integer, male_cells integer, female_cells integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE
  live AS (
    SELECT m.id, m.leader_id, m.is_pastor, m.is_active, m.gender
      FROM public.members m WHERE m.deleted_at IS NULL
  ),
  tree AS (
    SELECT l.id, '{}'::uuid[] AS ancestor_ids FROM live l WHERE l.leader_id IS NULL
    UNION ALL
    SELECT c.id, t.ancestor_ids || t.id FROM tree t JOIN live c ON c.leader_id = t.id
    -- a partir dos topos não há ciclo alcançável: quem está num ciclo não tem topo
  ),
  paths AS (
    SELECT l.*, coalesce(t.ancestor_ids, '{}'::uuid[]) AS ancestor_ids, t.id IS NOT NULL AS resolved
      FROM live l LEFT JOIN tree t ON t.id = l.id
  ),
  disc AS (
    SELECT a AS id, count(*)::int AS n
      FROM paths p, unnest(p.ancestor_ids) a
     WHERE p.is_active
     GROUP BY a
  ),
  cel AS (
    SELECT o AS id, count(*)::int AS total,
           count(*) FILTER (WHERE l.gender = 'M')::int AS male,
           count(*) FILTER (WHERE l.gender = 'F')::int AS female
      FROM public.cells c
      JOIN paths l ON l.id = c.leader_id,
           unnest(l.ancestor_ids || l.id) o
     WHERE c.is_active AND c.deleted_at IS NULL
     GROUP BY o
  )
  SELECT p.id, p.ancestor_ids,
         private.hierarchy_level(p.ancestor_ids, p.resolved, p.leader_id IS NOT NULL, p.is_pastor),
         coalesce(d.n, 0), coalesce(c.total, 0), coalesce(c.male, 0), coalesce(c.female, 0)
    FROM paths p
    LEFT JOIN disc d ON d.id = p.id
    LEFT JOIN cel c ON c.id = p.id
$$;

-- Backfill e recálculo da carga (E4.07): cria as linhas que faltam (a carga
-- em replica não dispara o AFTER INSERT), grava os valores do zero onde
-- diferem e zera os totais de excluídos (que ficam com a cadeia e o nível
-- congelados). Pega a trava exclusiva. Devolve quantas linhas mudaram.
CREATE OR REPLACE FUNCTION private.rebuild_member_hierarchy()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _ins integer;
  _upd integer;
  _del integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:leader-tree', 0));

  INSERT INTO private.member_hierarchy (member_id)
  SELECT m.id FROM public.members m
   WHERE NOT EXISTS (SELECT 1 FROM private.member_hierarchy h WHERE h.member_id = m.id)
  ON CONFLICT (member_id) DO NOTHING;
  GET DIAGNOSTICS _ins = ROW_COUNT;

  UPDATE private.member_hierarchy h
     SET ancestor_ids    = e.ancestor_ids,
         g12_level       = e.g12_level,
         total_disciples = e.total_disciples,
         total_cells     = e.total_cells,
         male_cells      = e.male_cells,
         female_cells    = e.female_cells
    FROM private.member_hierarchy_expected() e
   WHERE h.member_id = e.member_id
     AND (h.ancestor_ids, h.g12_level, h.total_disciples, h.total_cells, h.male_cells, h.female_cells)
         IS DISTINCT FROM
         (e.ancestor_ids, e.g12_level, e.total_disciples, e.total_cells, e.male_cells, e.female_cells);
  GET DIAGNOSTICS _upd = ROW_COUNT;

  UPDATE private.member_hierarchy h
     SET total_disciples = 0, total_cells = 0, male_cells = 0, female_cells = 0
    FROM public.members m
   WHERE m.id = h.member_id
     AND m.deleted_at IS NOT NULL
     AND (h.total_disciples, h.total_cells, h.male_cells, h.female_cells) <> (0, 0, 0, 0);
  GET DIAGNOSTICS _del = ROW_COUNT;

  RETURN _ins + _upd + _del;
END $$;

-- Diferenças entre o guardado e o recálculo do zero. Precisa voltar vazia
-- (RN-08, RN-13): missing_row (membro sem linha), value_mismatch (vivo com
-- valor diferente do zero) e deleted_with_totals (excluído com total).
CREATE OR REPLACE FUNCTION private.member_hierarchy_drift()
RETURNS TABLE (member_id uuid, problem text, stored jsonb, expected jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, 'missing_row', NULL::jsonb, NULL::jsonb
    FROM public.members m
   WHERE NOT EXISTS (SELECT 1 FROM private.member_hierarchy h WHERE h.member_id = m.id)
  UNION ALL
  SELECT e.member_id, 'value_mismatch',
         jsonb_build_object('ancestor_ids', h.ancestor_ids, 'g12_level', h.g12_level,
                            'total_disciples', h.total_disciples, 'total_cells', h.total_cells,
                            'male_cells', h.male_cells, 'female_cells', h.female_cells),
         jsonb_build_object('ancestor_ids', e.ancestor_ids, 'g12_level', e.g12_level,
                            'total_disciples', e.total_disciples, 'total_cells', e.total_cells,
                            'male_cells', e.male_cells, 'female_cells', e.female_cells)
    FROM private.member_hierarchy_expected() e
    JOIN private.member_hierarchy h ON h.member_id = e.member_id
   WHERE (h.ancestor_ids, h.g12_level, h.total_disciples, h.total_cells, h.male_cells, h.female_cells)
         IS DISTINCT FROM
         (e.ancestor_ids, e.g12_level, e.total_disciples, e.total_cells, e.male_cells, e.female_cells)
  UNION ALL
  SELECT h.member_id, 'deleted_with_totals',
         jsonb_build_object('total_disciples', h.total_disciples, 'total_cells', h.total_cells,
                            'male_cells', h.male_cells, 'female_cells', h.female_cells),
         jsonb_build_object('total_disciples', 0, 'total_cells', 0, 'male_cells', 0, 'female_cells', 0)
    FROM private.member_hierarchy h
    JOIN public.members m ON m.id = h.member_id
   WHERE m.deleted_at IS NOT NULL
     AND (h.total_disciples, h.total_cells, h.male_cells, h.female_cells) <> (0, 0, 0, 0)
$$;

-- Lista de diferenças esperadas e saneamento (E4.04, E4.09): no_top (DA-2),
-- cell_leader_deleted (célula ativa e não excluída com líder excluído; o id é
-- o do líder) e no_leadership_with_disciples (P-HIE-02).
CREATE OR REPLACE FUNCTION private.member_hierarchy_problems()
RETURNS TABLE (problem text, member_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH RECURSIVE
  live AS (SELECT m.id, m.leader_id FROM public.members m WHERE m.deleted_at IS NULL),
  tree AS (
    SELECT l.id FROM live l WHERE l.leader_id IS NULL
    UNION ALL
    SELECT c.id FROM tree t JOIN live c ON c.leader_id = t.id
  )
  SELECT 'no_top', l.id
    FROM live l
   WHERE NOT EXISTS (SELECT 1 FROM tree t WHERE t.id = l.id)
  UNION ALL
  SELECT DISTINCT 'cell_leader_deleted', c.leader_id
    FROM public.cells c
    JOIN public.members l ON l.id = c.leader_id
   WHERE c.is_active AND c.deleted_at IS NULL AND l.deleted_at IS NOT NULL
  UNION ALL
  SELECT 'no_leadership_with_disciples', m.id
    FROM public.members m
   WHERE m.deleted_at IS NULL AND m.leader_id IS NULL AND NOT m.is_pastor
     AND EXISTS (SELECT 1 FROM public.members d WHERE d.leader_id = m.id AND d.deleted_at IS NULL)
  ORDER BY 1, 2
$$;

-- ===========================================================================
-- 3. Funções de trigger (public) e triggers
-- ===========================================================================

-- Trava da árvore (DT-05, DT-06). BEFORE, depois do escopo
-- (ac_enforce_member_scope) e antes das regras do E2.04 (ad_enforce_member_rules),
-- que pegam as travas de identificador. Exclusiva sempre que o líder muda
-- (inclusive para nulo, e na restauração com líder diferente) ou o sexo muda:
-- superconjunto do ad_, que só reentra.
CREATE OR REPLACE FUNCTION public._hierarchy_lock_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.leader_id IS DISTINCT FROM OLD.leader_id
                           OR NEW.gender IS DISTINCT FROM OLD.gender) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('members:leader-tree', 0));
  ELSIF TG_OP <> 'UPDATE'
     OR NEW.is_active  IS DISTINCT FROM OLD.is_active
     OR NEW.is_pastor  IS DISTINCT FROM OLD.is_pastor
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('members:leader-tree', 0));
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;

-- Membros (AFTER): a tabela "O que cada gravação faz" do spec.
CREATE OR REPLACE FUNCTION public._hierarchy_on_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _h    private.member_hierarchy;
  _p    record;                                 -- hierarchy_path: ancestor_ids, resolved, visited
  _back boolean;                                -- restauração
  _n    integer;
  _sm   integer := 0;
  _sf   integer := 0;
  _d    private.hierarchy_delta[] := '{}';
BEGIN
  IF TG_OP = 'INSERT' THEN
    _p := private.hierarchy_path(NEW.leader_id);
    INSERT INTO private.member_hierarchy (member_id, ancestor_ids, g12_level)
    VALUES (NEW.id,
            CASE WHEN NEW.deleted_at IS NULL THEN _p.ancestor_ids ELSE '{}'::uuid[] END,
            CASE WHEN NEW.deleted_at IS NULL THEN
              private.hierarchy_level(_p.ancestor_ids, _p.resolved, NEW.leader_id IS NOT NULL, NEW.is_pastor)
            END);
    IF NEW.is_active AND NEW.deleted_at IS NULL THEN
      PERFORM private.hierarchy_apply(private.hierarchy_spread(_p.ancestor_ids, 1, 0, 0, 0));
    END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN                      -- a linha já saiu pela FK; sobe por members
    IF OLD.is_active AND OLD.deleted_at IS NULL THEN
      _p := private.hierarchy_path(OLD.leader_id);
      PERFORM private.hierarchy_apply(private.hierarchy_spread(_p.ancestor_ids, -1, 0, 0, 0));
    END IF;
    RETURN NULL;
  END IF;

  IF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;                                -- excluído: congelado (P-HIE-13)
  END IF;
  IF NEW.leader_id IS NOT DISTINCT FROM OLD.leader_id
     AND NEW.is_pastor IS NOT DISTINCT FROM OLD.is_pastor
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
     AND NEW.gender IS NOT DISTINCT FROM OLD.gender
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at THEN
    RETURN NULL;                                -- nada da regra mudou (RN-07)
  END IF;

  SELECT * INTO _h FROM private.member_hierarchy WHERE member_id = NEW.id;
  IF NOT FOUND THEN
    PERFORM private.hierarchy_fail('missing_row');
  END IF;
  _back := OLD.deleted_at IS NOT NULL;

  -- 1. Sai o pacote antigo dos de cima antigos (o excluído não somava nada).
  IF NOT _back THEN
    _d := private.hierarchy_spread(_h.ancestor_ids,
            -(OLD.is_active::int + _h.total_disciples), -_h.total_cells, -_h.male_cells, -_h.female_cells);
  END IF;

  IF NEW.deleted_at IS NOT NULL THEN            -- 2a. exclusão: nada entra; a linha congela
    PERFORM private.hierarchy_apply(_d);
    RETURN NULL;
  END IF;

  IF NEW.leader_id IS DISTINCT FROM OLD.leader_id OR _back THEN
    -- 2b. Posição nova: a subárvore viva do zero, sob a trava exclusiva (na
    --     restauração com o mesmo líder, X é folha e a trava é compartilhada).
    _p := private.hierarchy_path(NEW.leader_id);
    IF NOT _p.resolved AND NOT _back THEN
      IF NEW.id = ANY (_p.visited) THEN         -- reserva do E2.04 (RN-13 de lá), mesma mensagem
        PERFORM public._del_raise('leader_cycle',
          'O líder escolhido é discípulo desta pessoa (direto ou indireto). Escolha outro líder.',
          '{"field": "leader_id"}'::jsonb);
      END IF;
      PERFORM private.hierarchy_fail('no_top');   -- DA-2
    END IF;
    PERFORM private.hierarchy_recompute_subtree(NEW.id, _p.ancestor_ids, _p.resolved);
    SELECT * INTO _h FROM private.member_hierarchy WHERE member_id = NEW.id;
  ELSE
    IF NEW.gender IS DISTINCT FROM OLD.gender THEN   -- 2c. sexo: as células próprias mudam de divisão
      SELECT count(*) INTO _n FROM public.cells c
       WHERE c.leader_id = NEW.id AND c.is_active AND c.deleted_at IS NULL;
      _sm := _n * (coalesce(NEW.gender = 'M', false)::int - coalesce(OLD.gender = 'M', false)::int);
      _sf := _n * (coalesce(NEW.gender = 'F', false)::int - coalesce(OLD.gender = 'F', false)::int);
      _d  := _d || ROW(NEW.id, 0, 0, _sm, _sf)::private.hierarchy_delta;
      _h.male_cells := _h.male_cells + _sm;
      _h.female_cells := _h.female_cells + _sf;
    END IF;
    IF NEW.is_pastor IS DISTINCT FROM OLD.is_pastor AND NEW.leader_id IS NULL THEN   -- 2d. RN-03
      UPDATE private.member_hierarchy
         SET g12_level = CASE WHEN NEW.is_pastor THEN 0 END
       WHERE member_id = NEW.id;
    END IF;
  END IF;

  -- 3. Entra o pacote novo nos de cima novos. Os comuns se anulam.
  _d := _d || private.hierarchy_spread(_h.ancestor_ids,
          NEW.is_active::int + _h.total_disciples, _h.total_cells, _h.male_cells, _h.female_cells);
  PERFORM private.hierarchy_apply(_d);
  RETURN NULL;
END $$;

-- Células (AFTER): ±1 célula na divisão do sexo do líder, no líder e em todos
-- acima dele. A trava compartilhada vem depois das travas de linha do E2.01.
CREATE OR REPLACE FUNCTION public._hierarchy_on_cell()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _old boolean := TG_OP <> 'INSERT' AND OLD.leader_id IS NOT NULL AND OLD.is_active AND OLD.deleted_at IS NULL;
  _new boolean := TG_OP <> 'DELETE' AND NEW.leader_id IS NOT NULL AND NEW.is_active AND NEW.deleted_at IS NULL;
  _d   private.hierarchy_delta[] := '{}';
BEGIN
  IF NOT (_old OR _new) OR (_old AND _new AND OLD.leader_id = NEW.leader_id) THEN
    RETURN NULL;
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('members:leader-tree', 0));
  IF _old THEN _d := _d || private.hierarchy_cell_spread(OLD.leader_id, -1); END IF;
  IF _new THEN _d := _d || private.hierarchy_cell_spread(NEW.leader_id,  1); END IF;
  PERFORM private.hierarchy_apply(_d);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS ac_lock_member_tree ON public.members;
CREATE TRIGGER ac_lock_member_tree
  BEFORE INSERT OR UPDATE OF leader_id, is_pastor, is_active, gender, deleted_at OR DELETE
  ON public.members FOR EACH ROW EXECUTE FUNCTION public._hierarchy_lock_member();

DROP TRIGGER IF EXISTS trg_member_hierarchy ON public.members;
CREATE TRIGGER trg_member_hierarchy
  AFTER INSERT OR UPDATE OF leader_id, is_pastor, is_active, gender, deleted_at OR DELETE
  ON public.members FOR EACH ROW EXECUTE FUNCTION public._hierarchy_on_member();

DROP TRIGGER IF EXISTS trg_cell_hierarchy ON public.cells;
CREATE TRIGGER trg_cell_hierarchy
  AFTER INSERT OR UPDATE OF leader_id, is_active, deleted_at OR DELETE
  ON public.cells FOR EACH ROW EXECUTE FUNCTION public._hierarchy_on_cell();

-- Privilégios: nenhuma função nova é executável pela API.
REVOKE ALL ON FUNCTION
  private.hierarchy_path(uuid),
  private.hierarchy_level(uuid[], boolean, boolean, boolean),
  private.hierarchy_spread(uuid[], integer, integer, integer, integer),
  private.hierarchy_fail(text),
  private.hierarchy_cell_spread(uuid, integer),
  private.hierarchy_apply(private.hierarchy_delta[]),
  private.hierarchy_recompute_subtree(uuid, uuid[], boolean),
  private.member_hierarchy_expected(),
  private.rebuild_member_hierarchy(),
  private.member_hierarchy_drift(),
  private.member_hierarchy_problems(),
  public._hierarchy_lock_member(),
  public._hierarchy_on_member(),
  public._hierarchy_on_cell()
FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 4. restore_member: a trava da árvore antes das travas de identificador
--    (ordem global 1 → 3 → 4). Exclusiva se o líder muda (o guardado foi
--    excluído e o cadastro volta sem líder), senão compartilhada. O resto é o
--    corpo da migration 1 do E2.04, sem mudança.
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.restore_member(_member_id uuid)
RETURNS TABLE(restored_without_leader boolean, previous_leader_name text, role_reset_to_default boolean, role_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _m public.members%ROWTYPE;
  _leader record;
  _new_leader uuid;
  _new_has_leadership boolean;
  _new_role uuid;
  _without_leader boolean := false;
  _previous_leader_name text;
  _role_reset boolean := false;
  _fields text[];
  _constraint text;
BEGIN
  IF NOT public.viewer_has('manage_roles'::public.permission_action) THEN
    RAISE EXCEPTION 'Você não tem permissão para esta ação.' USING ERRCODE = '42501';
  END IF;
  IF _member_id IS NULL THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  SELECT * INTO _m FROM public.members m WHERE m.id = _member_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  IF _m.deleted_at IS NULL THEN
    IF EXISTS (SELECT 1 FROM public.members_view v WHERE v.id = _member_id) THEN
      PERFORM public._del_raise('not_deleted', 'Este cadastro não está excluído.', '{"entity": "member"}'::jsonb);
    END IF;
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.members_deleted_view v WHERE v.id = _member_id) THEN
    PERFORM public._del_raise('not_found', 'Este cadastro não foi encontrado.', '{"entity": "member"}'::jsonb);
  END IF;
  -- (b) Quem restaura precisa cobrir a função dele (regra da RN-03). Voltar com
  -- a função padrão (função apagada) é livre, como no cadastro (E1.03).
  IF NOT public.viewer_covers_role(_m.role_id) THEN
    PERFORM public._del_raise('restore_role_above', 'Você não tem permissão para restaurar este membro.');
  END IF;
  -- (d) Líder guardado: travado com FOR KEY SHARE. Se ele foi excluído, o
  -- cadastro volta sem líder e com "Tem Liderança?" desligado (DA-3).
  _new_leader := _m.leader_id;
  _new_has_leadership := _m.has_leadership;
  IF _m.leader_id IS NOT NULL THEN
    SELECT l.id, l.name, l.deleted_at
      INTO _leader
      FROM public.members l
     WHERE l.id = _m.leader_id
     FOR KEY SHARE;
    IF NOT FOUND OR _leader.deleted_at IS NOT NULL THEN
      _new_leader := NULL;
      _new_has_leadership := false;
      _without_leader := true;
      _previous_leader_name := _leader.name;
    END IF;
  END IF;
  -- Trava da árvore (E2.06), antes das travas por valor de (e): o trigger
  -- ac_lock_member_tree só reentra.
  IF _new_leader IS DISTINCT FROM _m.leader_id THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('members:leader-tree', 0));
  ELSE
    PERFORM pg_advisory_xact_lock_shared(hashtextextended('members:leader-tree', 0));
  END IF;
  -- (a) Função apagada: quem tem conta e está sem função volta com a padrão (DA-2).
  _new_role := _m.role_id;
  IF _m.role_id IS NULL AND _m.auth_user_id IS NOT NULL THEN
    _new_role := public.default_role_id();
    _role_reset := _new_role IS NOT NULL;
  END IF;
  -- (e) Outro cadastro não excluído com o mesmo e-mail, celular (com a
  -- equivalência do 9º dígito) ou CPF, sob as travas por valor (DT-07). A
  -- mensagem cita o primeiro, na ordem e-mail, celular, CPF (DA-6 do E2.01).
  _fields := public._member_values_in_use(_member_id, _m.email, _m.mobile_whatsapp, _m.cpf, true);
  IF cardinality(_fields) > 0 THEN
    PERFORM public._del_raise('restore_value_in_use',
      'Não é possível restaurar: outro cadastro já usa este '
        || CASE _fields[1] WHEN 'email' THEN 'e-mail' WHEN 'mobile' THEN 'celular' ELSE 'CPF' END || '.',
      jsonb_build_object('fields', to_jsonb(_fields)));
  END IF;
  -- leader_id sempre no SET: os triggers de hierarquia (E2.06) recalculam a
  -- cadeia, o nível e os totais do restaurado.
  -- O cônjuge não volta (RN-05, RN-16 c): a exclusão já o deixou nulo.
  -- Reserva: um caminho sem as travas que grave o mesmo valor antes do commit
  -- esbarra nos índices members_{email,mobile,cpf}_key.
  BEGIN
    UPDATE public.members
       SET deleted_at = NULL,
           deleted_by = NULL,
           leader_id = _new_leader,
           has_leadership = _new_has_leadership,
           role_id = _new_role
     WHERE id = _member_id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS _constraint = CONSTRAINT_NAME;
    _fields := array_remove(ARRAY[
      CASE WHEN _constraint ILIKE '%email%' THEN 'email' END,
      CASE WHEN _constraint ILIKE '%mobile%' THEN 'mobile' END,
      CASE WHEN _constraint ILIKE '%cpf%' THEN 'cpf' END
    ], NULL);
    IF cardinality(_fields) = 0 THEN
      RAISE;
    END IF;
    PERFORM public._del_raise('restore_value_in_use',
      'Não é possível restaurar: outro cadastro já usa este '
        || CASE _fields[1] WHEN 'email' THEN 'e-mail' WHEN 'mobile' THEN 'celular' ELSE 'CPF' END || '.',
      jsonb_build_object('fields', to_jsonb(_fields)));
  END;
  -- DA-7 (RN-09 c, RN-10): o restaurado precisa continuar visível. Na prática,
  -- só falha para quem não vê a igreja toda quando o líder foi excluído.
  IF NOT public.viewer_sees_member(_member_id) THEN
    PERFORM public._del_raise('pastor_or_no_leadership_requires_church',
      'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.',
      '{"field": "leader_id"}'::jsonb);
  END IF;
  -- (f) A conta volta a funcionar, com a mesma senha.
  IF _m.auth_user_id IS NOT NULL THEN
    PERFORM public._del_resume_access(_member_id);
  END IF;
  restored_without_leader := _without_leader;
  previous_leader_name := _previous_leader_name;
  role_reset_to_default := _role_reset;
  role_name := (SELECT r.name FROM public.roles r WHERE r.id = _new_role);
  RETURN NEXT;
END;
$function$;

-- ===========================================================================
-- 5. Backfill e pós-condição
-- ===========================================================================
SELECT private.rebuild_member_hierarchy();

DO $$
DECLARE
  _ids uuid[];
BEGIN
  SELECT array_agg(d.member_id ORDER BY d.member_id) INTO _ids FROM private.member_hierarchy_drift() d;
  IF _ids IS NOT NULL THEN
    RAISE EXCEPTION 'E2.06: hierarquia diferente do recálculo do zero depois do backfill: %', _ids;
  END IF;
END $$;
