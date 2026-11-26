-- E2.09 (PR 1, migration 1) — Histórico dos períodos em que cada célula conta.
-- Ver docs/specs/e2-09-situacao-relatorio.md no repositório apps-mci
-- ("Histórico dos períodos ativos (migration 1)", "Bloqueios e concorrência";
-- RN-06, RN-10; DA-2 a DA-5; DT-03, DT-04).
--
-- 1. private.cell_active_periods: uma linha por célula (inclusive as inativas e
--    as excluídas), com um tstzmultirange dos períodos em que ela estava ativa e
--    não excluída. Fora da API (RLS sem políticas, sem privilégio para anon,
--    authenticated e service_role) e fora da Auditoria.
-- 2. public.track_cell_active_period() e o trigger trg_cell_active_period
--    (AFTER INSERT OR UPDATE OF is_active, deleted_at em cells): abre o período
--    no cadastro, na reativação e na restauração e o fecha na inativação e na
--    exclusão, sempre com o relógio do servidor (now(), o início da transação,
--    DA-2). Nenhum valor da linha (created_at incluso) entra no histórico.
--    Períodos fechados no início e abertos no fim (DA-3). Não altera cells: não
--    gera evento, não muda updated_at, não dispara outro trigger.
-- 3. private.backfill_cell_active_periods(): o ponto de partida (RN-06, RN-10,
--    DA-4). Só cria as linhas que faltam; roda de novo sem mudar nada. Usado
--    aqui e pela carga do legado (E4.06), depois de carregar cells em replica.
-- 4. private.cell_active_period_problems(): o invariante (DA-5): toda célula
--    tem linha, e só a que conta agora tem o período aberto. A migration não
--    termina com problema, e a reconciliação (E4.09) exige zero.
--
-- O CREATE TRIGGER pega SHARE ROW EXCLUSIVE em cells até o fim da migration, e
-- o backfill roda depois dele: nenhuma célula gravada durante a publicação fica
-- sem linha. As mensagens das guardas trazem só ids (logs públicos).
--
-- Pode rodar de novo sem erro e sem mudar nada: IF NOT EXISTS, CREATE OR
-- REPLACE, DROP TRIGGER IF EXISTS antes do CREATE, grants idempotentes.

-- ---------------------------------------------------------------------------
-- 0. Pré-requisitos: E2.01 PR 1 (cells.deleted_at) e PostgreSQL 14+ (multirange).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('server_version_num')::int < 140000
     OR to_regnamespace('private') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.cells'::regclass
                       AND attname = 'deleted_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'E2.09 (migration 1) depende do PR 1 do E2.01 e do PostgreSQL 14 ou mais novo.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Os períodos em que a célula "contava": ativa e não excluída (RN-06, DT-03)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS private.cell_active_periods (
  cell_id uuid PRIMARY KEY REFERENCES public.cells (id) ON DELETE CASCADE,
  periods tstzmultirange NOT NULL DEFAULT '{}'
);

COMMENT ON TABLE private.cell_active_periods IS
  'E2.09 (RN-06): períodos em que a célula estava ativa e não excluída, gravados só pelo trigger trg_cell_active_period e pelo backfill. Fora da API e da Auditoria.';

ALTER TABLE private.cell_active_periods OWNER TO postgres;
ALTER TABLE private.cell_active_periods ENABLE ROW LEVEL SECURITY;   -- sem políticas
REVOKE ALL ON TABLE private.cell_active_periods FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. O servidor registra cada mudança, com o relógio dele (DA-2)
-- ---------------------------------------------------------------------------
-- Definer: a tabela fica em private, sem privilégio para os papéis da API. O
-- trigger dispara para qualquer papel sem EXECUTE (como os do E2.01).
-- Concorrência: roda depois do UPDATE que já travou a linha da célula; duas
-- mudanças da mesma célula se enfileiram nessa trava, e a linha do histórico é
-- sempre travada depois da célula (sem ciclo de espera).
CREATE OR REPLACE FUNCTION public.track_cell_active_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _was boolean := TG_OP = 'UPDATE' AND OLD.is_active AND OLD.deleted_at IS NULL;
  _is  boolean := NEW.is_active AND NEW.deleted_at IS NULL;
  _from_now tstzmultirange := tstzmultirange(tstzrange(now(), NULL));    -- [agora, ∞)
BEGIN
  IF TG_OP = 'UPDATE' AND _is = _was THEN
    RETURN NULL;                                     -- a célula continua contando, ou não
  END IF;
  INSERT INTO private.cell_active_periods AS p (cell_id, periods)
  VALUES (NEW.id, CASE WHEN _is THEN _from_now ELSE '{}'::tstzmultirange END)
  ON CONFLICT (cell_id) DO UPDATE
     SET periods = CASE WHEN _is THEN p.periods + _from_now   -- abre: cadastro, reativação, restauração
                        ELSE p.periods - _from_now END;        -- fecha: inativação, exclusão
  RETURN NULL;
END $$;

ALTER FUNCTION public.track_cell_active_period() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.track_cell_active_period() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_cell_active_period() TO service_role;

DROP TRIGGER IF EXISTS trg_cell_active_period ON public.cells;
CREATE TRIGGER trg_cell_active_period
  AFTER INSERT OR UPDATE OF is_active, deleted_at ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public.track_cell_active_period();

-- ---------------------------------------------------------------------------
-- 3. Ponto de partida (RN-06, RN-10; DT-04, DA-4)
-- ---------------------------------------------------------------------------
-- - ativa: desde o cadastro; created_at nulo (legado sem data) = desde sempre;
-- - inativa (excluída ou não): nenhuma semana anterior conta;
-- - excluída quando ativa: do cadastro até a exclusão (excluída antes do
--   cadastro, dado estranho: período vazio).
CREATE OR REPLACE FUNCTION private.backfill_cell_active_periods()
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH ins AS (
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
  SELECT count(*)::integer FROM ins
$$;

-- ---------------------------------------------------------------------------
-- 4. Invariante (DA-5): toda célula tem linha, e só a que conta agora tem o
--    período aberto.
-- ---------------------------------------------------------------------------
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
$$;

ALTER FUNCTION private.backfill_cell_active_periods() OWNER TO postgres;
ALTER FUNCTION private.cell_active_period_problems() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.backfill_cell_active_periods() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.cell_active_period_problems() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Backfill e guarda do invariante. Depois do trigger: o CREATE TRIGGER trava
--    as gravações em cells até o fim da migration.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  _ids uuid[];
BEGIN
  PERFORM private.backfill_cell_active_periods();
  SELECT array_agg(x.cell_id ORDER BY x.cell_id) INTO _ids
    FROM private.cell_active_period_problems() x;
  IF _ids IS NOT NULL THEN
    RAISE EXCEPTION 'E2.09: histórico de períodos ativos inconsistente nas células %', _ids;
  END IF;
END $$;
