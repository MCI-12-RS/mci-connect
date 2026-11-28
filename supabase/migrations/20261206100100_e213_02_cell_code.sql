-- E2.13 (PR 1, migration 2 de 3) — O número da célula ("Célula #", RN-14). Ver
-- docs/specs/e2-13-exportacao-excel.md no repositório apps-mci (Solução técnica: DT-11).
--
-- Conteúdo:
--   0. Pré-requisitos (E2.05 e E4.02: legacy_id e o carimbo). Falha cedo, sem mudar nada.
--   1. private.cell_code_seq: a sequência dos números dados pelo novo, a partir de 10001, acima de
--      qualquer Id de célula do legado até o cutover (conferir antes: risco 6 do spec).
--   2. cells.issued_code: o número dado pelo novo. Preenchido aqui nas células que já existem e não
--      vieram do legado, na ordem de cadastro, sem triggers (replica: nada de Auditoria, carimbo ou
--      regra de célula).
--   3. cells.code: GENERATED ALWAYS AS (coalesce(legacy_id, issued_code)) STORED, o número da
--      planilha. UNIQUE (inclusive excluídas): um Id do legado que colida com um número do novo faz
--      a carga falhar, nunca repete o número.
--   4. O trigger zx_keep_cell_code (BEFORE INSERT OR UPDATE, definer): no INSERT o número vem da
--      sequência, e o enviado é descartado; no UPDATE volta ao valor antigo. Sem erro, para todo
--      papel, inclusive postgres e service role (como o legacy_id do E4.02). Em replica não roda: a
--      célula carregada do legado usa o legacy_id.
--   5. private.cell_code_problems(): o que a reconciliação exige vazio (no_code: célula gravada em
--      replica sem legacy_id; legacy_in_issued_range: Id do legado na faixa do novo).
--   6. Pós-condições.
--
-- O nome "number" já é o número do endereço: por isso "code". As colunas não entram nas views
-- (Q-6: o número só aparece na planilha) e não são dado da Auditoria (not_data do
-- audit-fields.json). Pode rodar de novo sem erro.

-- ===========================================================================
-- 0. Pré-requisitos
-- ===========================================================================
DO $$ BEGIN
  IF to_regprocedure('public.keep_legacy_id()') IS NULL                              -- E4.02
     OR NOT EXISTS (SELECT 1 FROM pg_attribute
                     WHERE attrelid = 'public.cells'::regclass AND attname = 'legacy_id' AND NOT attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                     WHERE tgrelid = 'public.cells'::regclass AND tgname = 'zz_stamp_authorship') THEN  -- E2.05
    RAISE EXCEPTION 'E2.13 (migration 2) depende do E2.05 e do E4.02 (legacy_id) em produção.';
  END IF;
END $$;

-- ===========================================================================
-- 1. A sequência
-- ===========================================================================
CREATE SEQUENCE IF NOT EXISTS private.cell_code_seq AS integer START WITH 10001 MINVALUE 10001 NO CYCLE;
ALTER SEQUENCE private.cell_code_seq OWNER TO postgres;
REVOKE ALL ON SEQUENCE private.cell_code_seq FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SEQUENCE private.cell_code_seq IS
  'E2.13 (RN-14, DT-11): números das células cadastradas no novo, acima de qualquer Id de célula do legado. Só o trigger zx_keep_cell_code a usa. Nunca reinicie.';

-- ===========================================================================
-- 2. issued_code e o preenchimento das células que já existem
-- ===========================================================================
ALTER TABLE public.cells ADD COLUMN IF NOT EXISTS issued_code integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.cells'::regclass AND conname = 'cells_issued_code_key') THEN
    ALTER TABLE public.cells ADD CONSTRAINT cells_issued_code_key UNIQUE (issued_code);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.cells'::regclass AND conname = 'cells_issued_code_check') THEN
    ALTER TABLE public.cells ADD CONSTRAINT cells_issued_code_check CHECK (issued_code >= 10001);
  END IF;
END $$;

COMMENT ON COLUMN public.cells.issued_code IS
  'E2.13 (RN-14, DT-11): o número dado pelo novo (private.cell_code_seq), gravado só pelo trigger zx_keep_cell_code, que descarta o valor vindo de qualquer caminho e nunca o muda. Nulo na célula do legado (vale o legacy_id).';

-- SET, e não set_config(): no Supabase, o papel das migrations só pode mudar este parâmetro pelo
-- comando SET (como o E2.05). Volta ao padrão logo depois do bloco; se o bloco falhar, a migration
-- para inteira.
SET session_replication_role = replica;

DO $$
DECLARE
  _base integer;
  _n integer;
BEGIN
  IF current_setting('session_replication_role') <> 'replica' THEN
    RAISE EXCEPTION 'E2.13 migration 2: precisa rodar com session_replication_role = replica.';
  END IF;
  -- Na ordem de cadastro (RN-14), a partir do maior número já dado; rodar de novo não muda nada.
  _base := greatest(coalesce((SELECT max(c.issued_code) FROM public.cells c), 10000),
                    (SELECT CASE WHEN s.is_called THEN s.last_value ELSE s.last_value - 1 END
                       FROM private.cell_code_seq s));
  WITH o AS (
    SELECT c.id, row_number() OVER (ORDER BY c.created_at NULLS FIRST, c.id) AS rn
      FROM public.cells c
     WHERE c.issued_code IS NULL AND c.legacy_id IS NULL)
  UPDATE public.cells c SET issued_code = _base + o.rn::integer FROM o WHERE c.id = o.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    PERFORM setval('private.cell_code_seq', _base + _n, true);
  END IF;
END $$;

SET session_replication_role = DEFAULT;

-- ===========================================================================
-- 3. code: o número da planilha
-- ===========================================================================
ALTER TABLE public.cells
  ADD COLUMN IF NOT EXISTS code integer GENERATED ALWAYS AS (coalesce(legacy_id, issued_code)) STORED;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.cells'::regclass AND conname = 'cells_code_key') THEN
    ALTER TABLE public.cells ADD CONSTRAINT cells_code_key UNIQUE (code);
  END IF;
END $$;

COMMENT ON COLUMN public.cells.code IS
  'E2.13 (RN-14, DT-11): o número da célula na planilha ("Célula #"): o Id do legado ou, na célula do novo, o issued_code. Nunca muda e nunca é reaproveitado.';

-- ===========================================================================
-- 4. O trigger
-- ===========================================================================
-- Definer: só o dono usa a sequência (os papéis da API não têm privilégio nela). zx_ roda antes do
-- zy_keep_legacy_id e do zz_stamp_authorship; não depende deles (só mexe em issued_code).
CREATE OR REPLACE FUNCTION public.keep_cell_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.issued_code := nextval('private.cell_code_seq');
  ELSE
    NEW.issued_code := OLD.issued_code;
  END IF;
  RETURN NEW;
END $$;

COMMENT ON FUNCTION public.keep_cell_code() IS
  'E2.13 (RN-14, DT-11): o número da célula do novo vem só da sequência, no INSERT; o UPDATE mantém o valor. O enviado é descartado, sem erro.';

ALTER FUNCTION public.keep_cell_code() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.keep_cell_code() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS zx_keep_cell_code ON public.cells;
CREATE TRIGGER zx_keep_cell_code BEFORE INSERT OR UPDATE ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public.keep_cell_code();

-- ===========================================================================
-- 5. O que a reconciliação exige vazio
-- ===========================================================================
CREATE OR REPLACE FUNCTION private.cell_code_problems()
RETURNS TABLE (cell_id uuid, problem text, legacy_id integer, issued_code integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT c.id, 'no_code', c.legacy_id, c.issued_code
    FROM public.cells c WHERE c.code IS NULL
  UNION ALL
  SELECT c.id, 'legacy_in_issued_range', c.legacy_id, c.issued_code
    FROM public.cells c WHERE c.legacy_id >= 10001
$$;

COMMENT ON FUNCTION private.cell_code_problems() IS
  'E2.13 (DT-11): no_code (célula gravada em replica sem legacy_id) e legacy_in_issued_range (Id do legado na faixa dos números do novo). A reconciliação do E4 exige vazio.';

ALTER FUNCTION private.cell_code_problems() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.cell_code_problems() FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 6. Pós-condições
-- ===========================================================================
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.cell_code_problems() p WHERE p.problem = 'no_code') THEN
    RAISE EXCEPTION 'E2.13 migration 2: há célula sem número depois do preenchimento.';
  END IF;
  IF (SELECT max(c.issued_code) FROM public.cells c) >
     (SELECT s.last_value FROM private.cell_code_seq s) THEN
    RAISE EXCEPTION 'E2.13 migration 2: a sequência ficou atrás do maior número dado.';
  END IF;
  IF has_sequence_privilege('authenticated', 'private.cell_code_seq', 'USAGE')
     OR has_sequence_privilege('service_role', 'private.cell_code_seq', 'USAGE')
     OR has_function_privilege('authenticated', 'public.keep_cell_code()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'private.cell_code_problems()', 'EXECUTE') THEN
    RAISE EXCEPTION 'E2.13 migration 2: privilégios diferentes do desenho.';
  END IF;
END $$;
