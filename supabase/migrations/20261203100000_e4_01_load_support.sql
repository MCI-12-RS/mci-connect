-- E4 (PR 1) — Preparação do destino para a carga do legado (E4.02) e o
-- pré-requisito do backfill (E4.07). Ver docs/specs/e4-carga.md no
-- repositório apps-mci ("Modelo de dados e migrations (PR 1)": DT-01 a DT-03).
--
-- Conteúdo:
--   0. Guarda de pré-requisito (hierarquia do E2.06, períodos do E2.09).
--   1. legacy_id em members, cells e cell_reports (DT-01): o Id do legado,
--      único inclusive entre os excluídos (os excluídos do legado também
--      migram, D1), positivo. Em members, SELECT por coluna para
--      authenticated (não é sensível; trava por coluna do E1.08).
--   2. Só a carga grava legacy_id (DT-02): o trigger zy_keep_legacy_id,
--      nas três tabelas, anula a coluna no INSERT e devolve o valor antigo no
--      UPDATE, para todo papel (inclusive postgres e service_role), sem erro.
--      A carga, a adoção e a limpeza rodam em session_replication_role =
--      replica, onde ele não dispara.
--   3. orphan_row (DT-03, backlog do E2.06): uma exclusão física em replica
--      não dispara a cascata da FK e deixa linha órfã em
--      private.member_hierarchy e private.cell_active_periods. As duas listas
--      de problemas passam a acusá-la, e os dois recálculos a apagam.
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE e constraints por nome.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('private.member_hierarchy') IS NULL
     OR to_regprocedure('private.member_hierarchy_expected()') IS NULL
     OR to_regclass('private.cell_active_periods') IS NULL
     OR to_regprocedure('private.legacy_authorship(text,timestamp,text,timestamp,boolean,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'e4_01_load_support depende do E2.06 (hierarquia), do E2.09 (períodos) e do E2.05 (autoria do legado).';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. legacy_id (DT-01)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS legacy_id integer', _t);
    BEGIN
      EXECUTE format('ALTER TABLE public.%1$I ADD CONSTRAINT %2$I UNIQUE (legacy_id)', _t, _t || '_legacy_id_key');
    EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('ALTER TABLE public.%1$I ADD CONSTRAINT %2$I CHECK (legacy_id > 0)', _t, _t || '_legacy_id_check');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    EXECUTE format($c$COMMENT ON COLUMN public.%I.legacy_id IS
      'E4.02 (DT-01): o Id do registro no legado (g12app-net). Gravado só pela carga, em replica (DT-02: '
      'o trigger zy_keep_legacy_id descarta o valor vindo de qualquer outro caminho). Nulo: cadastrado no novo.'$c$, _t);
  END LOOP;
END $$;

-- Não é sensível: segue a regra do comentário de members (trava por coluna do E1.08).
GRANT SELECT (legacy_id) ON public.members TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Só a carga grava legacy_id (DT-02)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.keep_legacy_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.legacy_id := NULL;
  ELSE
    NEW.legacy_id := OLD.legacy_id;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.keep_legacy_id() IS
  'E4.02 (DT-02): legacy_id só pela carga do legado, em replica. Fora dela, o INSERT grava nulo e o UPDATE mantém o valor.';

ALTER FUNCTION public.keep_legacy_id() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.keep_legacy_id() FROM PUBLIC, anon, authenticated, service_role;

DO $$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['members', 'cells', 'cell_reports'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS zy_keep_legacy_id ON public.%I', _t);
    EXECUTE format('CREATE TRIGGER zy_keep_legacy_id BEFORE INSERT OR UPDATE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.keep_legacy_id()', _t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. orphan_row (DT-03)
-- ---------------------------------------------------------------------------

-- Backfill e recálculo da carga (E4.07): apaga as linhas órfãs (membro que
-- não existe mais: exclusão física em replica, DT-03), cria as que faltam (a
-- carga em replica não dispara o AFTER INSERT), grava os valores do zero onde
-- diferem e zera os totais de excluídos (que ficam com a cadeia e o nível
-- congelados). Pega a trava exclusiva. Devolve quantas linhas mudaram.
CREATE OR REPLACE FUNCTION private.rebuild_member_hierarchy()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _orph integer;
  _ins integer;
  _upd integer;
  _del integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('members:leader-tree', 0));

  DELETE FROM private.member_hierarchy h
   WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
  GET DIAGNOSTICS _orph = ROW_COUNT;

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

  RETURN _orph + _ins + _upd + _del;
END $$;

-- Diferenças entre o guardado e o recálculo do zero. Precisa voltar vazia
-- (RN-08, RN-13 do E2.06): missing_row (membro sem linha), orphan_row (linha
-- sem membro, DT-03 do E4), value_mismatch (vivo com valor diferente do zero)
-- e deleted_with_totals (excluído com total).
CREATE OR REPLACE FUNCTION private.member_hierarchy_drift()
RETURNS TABLE (member_id uuid, problem text, stored jsonb, expected jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, 'missing_row', NULL::jsonb, NULL::jsonb
    FROM public.members m
   WHERE NOT EXISTS (SELECT 1 FROM private.member_hierarchy h WHERE h.member_id = m.id)
  UNION ALL
  SELECT h.member_id, 'orphan_row',
         jsonb_build_object('ancestor_ids', h.ancestor_ids, 'g12_level', h.g12_level,
                            'total_disciples', h.total_disciples, 'total_cells', h.total_cells,
                            'male_cells', h.male_cells, 'female_cells', h.female_cells),
         NULL::jsonb
    FROM private.member_hierarchy h
   WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id)
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

-- Backfill dos períodos ativos (E2.09) e limpeza das órfãs (DT-03): apaga as
-- linhas de célula que não existe mais e cria as que faltam. Devolve quantas
-- linhas mudaram (apagadas + criadas). As duas partes não se cruzam: a órfã
-- não tem célula, e a criada tem.
CREATE OR REPLACE FUNCTION private.backfill_cell_active_periods()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH orphans AS (
    DELETE FROM private.cell_active_periods p
     WHERE NOT EXISTS (SELECT 1 FROM public.cells c WHERE c.id = p.cell_id)
    RETURNING 1),
  ins AS (
    INSERT INTO private.cell_active_periods (cell_id, periods)
    SELECT c.id,
           CASE
             WHEN NOT c.is_active THEN '{}'::tstzmultirange
             WHEN c.deleted_at IS NULL
               THEN tstzmultirange(tstzrange(c.created_at, NULL))
             ELSE tstzmultirange(tstzrange(c.created_at, greatest(c.created_at, c.deleted_at)))
           END
      FROM public.cells c
     WHERE NOT EXISTS (SELECT 1 FROM private.cell_active_periods p WHERE p.cell_id = c.id)
    ON CONFLICT (cell_id) DO NOTHING
    RETURNING 1)
  SELECT ((SELECT count(*) FROM orphans) + (SELECT count(*) FROM ins))::integer
$$;

-- Invariante (DA-5 do E2.09; orphan_row do E4): toda célula tem linha, só a
-- que conta agora tem o período aberto, e não há linha sem célula.
CREATE OR REPLACE FUNCTION private.cell_active_period_problems()
RETURNS TABLE (problem text, cell_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE WHEN p.cell_id IS NULL THEN 'missing_row'
              WHEN c.is_active AND c.deleted_at IS NULL THEN 'not_open'
              ELSE 'open_but_not_counting' END,
         c.id
    FROM public.cells c
    LEFT JOIN private.cell_active_periods p ON p.cell_id = c.id
   WHERE p.cell_id IS NULL
      OR (c.is_active AND c.deleted_at IS NULL) IS DISTINCT FROM upper_inf(p.periods)
  UNION ALL
  SELECT 'orphan_row', p.cell_id
    FROM private.cell_active_periods p
   WHERE NOT EXISTS (SELECT 1 FROM public.cells c WHERE c.id = p.cell_id)
$$;

ALTER FUNCTION private.rebuild_member_hierarchy() OWNER TO postgres;
ALTER FUNCTION private.member_hierarchy_drift() OWNER TO postgres;
ALTER FUNCTION private.backfill_cell_active_periods() OWNER TO postgres;
ALTER FUNCTION private.cell_active_period_problems() OWNER TO postgres;
REVOKE ALL ON FUNCTION
  private.rebuild_member_hierarchy(),
  private.member_hierarchy_drift(),
  private.backfill_cell_active_periods(),
  private.cell_active_period_problems()
FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE private.member_hierarchy IS
  'Campos calculados da hierarquia (E2.06): cadeia, nível, G12 e totais, uma linha por membro. '
  'Só as funções _hierarchy_* e hierarchy_* escrevem; leitura pelo front só pelas views e pela '
  'ministry_tree_nodes. Depois de uma carga em replica: SELECT private.rebuild_member_hierarchy(); '
  '(que também apaga as linhas órfãs, E4 DT-03) e private.member_hierarchy_drift() precisa voltar vazia.';

-- ---------------------------------------------------------------------------
-- 4. Pós-condição: nada fica órfão nem fora do recálculo com os dados atuais.
--    Em produção as duas listas já voltam vazias (E2.06, E2.09); se houver
--    órfã, os recálculos acima a apagam.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM private.member_hierarchy h
              WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id)) THEN
    PERFORM private.rebuild_member_hierarchy();
  END IF;
  IF EXISTS (SELECT 1 FROM private.cell_active_periods p
              WHERE NOT EXISTS (SELECT 1 FROM public.cells c WHERE c.id = p.cell_id)) THEN
    PERFORM private.backfill_cell_active_periods();
  END IF;
  SELECT count(*) INTO _n FROM private.member_hierarchy_drift() WHERE problem = 'orphan_row';
  IF _n > 0 THEN
    RAISE EXCEPTION 'E4.01: % linha(s) órfã(s) em private.member_hierarchy depois do recálculo', _n;
  END IF;
  SELECT count(*) INTO _n FROM private.cell_active_period_problems() WHERE problem = 'orphan_row';
  IF _n > 0 THEN
    RAISE EXCEPTION 'E4.01: % linha(s) órfã(s) em private.cell_active_periods depois do backfill', _n;
  END IF;
END $$;
