-- E2.08 (PR 2, migration 2) — Regras do cadastro de células.
-- Ver docs/specs/e2-08-cadastro-celulas.md no repositório apps-mci
-- ("Funções de regra e listas (migration 2)", "Integridade do tipo (a)",
-- "Escrita", "Formato dos erros"; RN-01 a RN-07, RN-11, RN-13, RN-14;
-- DA-1 a DA-4, DA-8, DA-12; DT-01 a DT-05, DT-13).
--
-- 0. Guarda de pré-requisitos (E2.01 PR 2 e E2.02 PR 1).
-- 1. Listas únicas e funções de regra (IMMUTABLE, EXECUTE para authenticated
--    e service_role, sem anon): cell_weekdays(), cell_types(),
--    cell_default_type(), normalize_meeting_time(time),
--    is_valid_meeting_time(time). weekday_index passa a ler cell_weekdays(),
--    com o mesmo resultado e os mesmos grants.
-- 2. private.cell_rule_violations(): uma linha (rule, cell_id) por violação
--    do tipo (a). Sem grants: roda como postgres (guarda, SQL Editor, E4.09).
-- 3. Dados existentes: os segundos do horário saem (DA-4); o resto para na
--    guarda, com só as regras e os ids (os logs do Actions são públicos).
-- 4. Padrões, NOT NULL e CHECKs (valem também em replica e para as células
--    excluídas, DA-3).
-- 5. Triggers BEFORE em cells, pela ordem alfabética (RN-14):
--      a0_check_insert_permission (E2.01) < a0_normalize_cell (novo, INVOKER,
--      nunca recusa) < aa_enforce_cell_links (E2.01) < ab_enforce_cell_scope
--      (E2.02) < ad_enforce_cell_rules (novo, definer: recusa pelo _del_raise,
--      que não tem EXECUTE para authenticated).
--    Os dois valem para todos os papéis; só a carga em replica passa por fora,
--    e ali valem os NOT NULL e os CHECKs.
--
-- O ab_enforce_cell_scope (E2.02) vem antes: (b) só confere quem entra com
-- valor não nulo; (c) é a célula continuar visível. Se esvaziar um papel
-- tirar a célula da vista de quem grava, a recusa é a do escopo
-- (would_leave_scope); senão, é *_required, do ad_ (conferido na tarefa 5).
--
-- Pode rodar de novo sem erro: os triggers novos saem antes das correções e
-- voltam no fim; CREATE OR REPLACE; CHECKs em DO com guarda de
-- duplicate_object; ALTER COLUMN idempotentes.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.cells'::regclass
                  AND tgname = 'a0_check_insert_permission' AND NOT tgisinternal)
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.cells'::regclass
                     AND tgname = 'ab_enforce_cell_scope' AND NOT tgisinternal)
     OR to_regprocedure('public._del_raise(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'E2.08 (migration 2) depende do PR 2 do E2.01 e do PR 1 do E2.02.';
  END IF;
END $$;

DROP TRIGGER IF EXISTS a0_normalize_cell ON public.cells;
DROP TRIGGER IF EXISTS ad_enforce_cell_rules ON public.cells;

-- ===========================================================================
-- 1. Listas únicas e funções de regra (DT-02, DT-03, DT-05)
-- ===========================================================================
-- A tabela de casos (supabase/tests/fixtures/cell-rules-cases.json) repete os
-- valores; o pgTAP gerado e o Vitest conferem os dois lados. Mudar uma lista
-- não revalida as linhas antigas (risco 5): confira antes com
-- private.cell_rule_violations().

-- Os sete dias, na ordem de weekday_index (0 = domingo).
CREATE OR REPLACE FUNCTION public.cell_weekdays()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT ARRAY['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']::text[] $$;

CREATE OR REPLACE FUNCTION public.cell_types()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT ARRAY['Evangelística', 'Discipulado', 'Macrocélula']::text[] $$;

-- P-CEL-03: o padrão da coluna e da normalização.
CREATE OR REPLACE FUNCTION public.cell_default_type()
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT 'Evangelística'::text $$;

-- E1.08: mesma assinatura e mesmo resultado; agora lê a lista única.
CREATE OR REPLACE FUNCTION public.weekday_index(_meeting_day text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT array_position(public.cell_weekdays(), _meeting_day) - 1 $$;

-- RN-06: só hora e minutos. make_time preserva o 24:00, que a regra recusa
-- (date_trunc sobre interval o transformaria em 00:00). Nulo fica nulo.
CREATE OR REPLACE FUNCTION public.normalize_meeting_time(_t time)
RETURNS time
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT make_time(extract(hour FROM _t)::int, extract(minute FROM _t)::int, 0) $$;

-- RN-06: minutos cheios e menos de 24:00. Nulo dá nulo (o NOT NULL cuida).
CREATE OR REPLACE FUNCTION public.is_valid_meeting_time(_t time)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT _t < time '24:00' AND extract(second FROM _t) = 0 $$;

REVOKE ALL ON FUNCTION public.cell_weekdays() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cell_types() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cell_default_type() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.normalize_meeting_time(time) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_valid_meeting_time(time) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cell_weekdays() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cell_types() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cell_default_type() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.normalize_meeting_time(time) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_valid_meeting_time(time) TO authenticated, service_role;
-- weekday_index mantém os grants de antes (a cells_view e o dashboard_summary
-- a chamam com o papel de quem consulta).
REVOKE ALL ON FUNCTION public.weekday_index(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.weekday_index(text) TO authenticated, service_role;

-- ===========================================================================
-- 2. Violações do tipo (a) (DT-01, RN-13)
-- ===========================================================================
-- As condições espelham os NOT NULL e os CHECKs da seção 4, que valem também
-- para as células excluídas (DA-3). A pessoa excluída num papel só conta nas
-- células não excluídas (RN-04; não cabe em CHECK). Devolve só regra e id.
CREATE OR REPLACE FUNCTION private.cell_rule_violations()
RETURNS TABLE (rule text, cell_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT v.rule, v.cell_id
    FROM (
      SELECT 'leader_required'::text AS rule, c.id AS cell_id FROM public.cells c WHERE c.leader_id IS NULL
      UNION ALL
      SELECT 'timothy_required', c.id FROM public.cells c WHERE c.timothy_id IS NULL
      UNION ALL
      SELECT 'host_required', c.id FROM public.cells c WHERE c.host_id IS NULL
      UNION ALL
      SELECT DISTINCT 'person_deleted', c.id
        FROM public.cells c
        JOIN public.members m ON m.id IN (c.leader_id, c.timothy_id, c.host_id)
       WHERE c.deleted_at IS NULL AND m.deleted_at IS NOT NULL
      UNION ALL
      SELECT 'cell_type_invalid', c.id FROM public.cells c
       WHERE c.type IS NULL OR NOT (c.type = ANY (public.cell_types()))
      UNION ALL
      SELECT 'meeting_day_required', c.id FROM public.cells c
       WHERE nullif(btrim(c.meeting_day), '') IS NULL
      UNION ALL
      SELECT 'meeting_day_invalid', c.id FROM public.cells c
       WHERE nullif(btrim(c.meeting_day), '') IS NOT NULL AND public.weekday_index(c.meeting_day) IS NULL
      UNION ALL
      SELECT 'meeting_time_required', c.id FROM public.cells c WHERE c.meeting_time IS NULL
      UNION ALL
      SELECT 'meeting_time_invalid', c.id FROM public.cells c
       WHERE c.meeting_time IS NOT NULL AND NOT public.is_valid_meeting_time(c.meeting_time)
    ) v
$$;

REVOKE ALL ON FUNCTION private.cell_rule_violations() FROM PUBLIC, anon, authenticated, service_role;

-- ===========================================================================
-- 3. Dados existentes (DA-4) e guarda (DT-13). Um bloco só: se a guarda
--    falha, a correção é desfeita.
-- ===========================================================================
DO $$
DECLARE
  _report text;
BEGIN
  -- 3.1 Os segundos não contam (RN-06). Só nas linhas afetadas; a Auditoria
  --     registra a alteração sem autor. Os totais não mudam.
  UPDATE public.cells c
     SET meeting_time = public.normalize_meeting_time(c.meeting_time)
   WHERE c.meeting_time < time '24:00' AND extract(second FROM c.meeting_time) <> 0;

  -- 3.2 Guarda: o que sobrou fora do tipo (a) pede decisão do usuário (RN-13).
  SELECT string_agg(g.rule || ': ' || g.ids, '; ' ORDER BY g.rule)
    INTO _report
    FROM (SELECT v.rule, string_agg(v.cell_id::text, ', ' ORDER BY v.cell_id) AS ids
            FROM private.cell_rule_violations() v
           GROUP BY v.rule) g;
  IF _report IS NOT NULL THEN
    RAISE EXCEPTION 'E2.08: células fora das regras do tipo (a). Corrija e publique de novo. %', _report;
  END IF;
END $$;

-- ===========================================================================
-- 4. Padrões, NOT NULL e CHECKs (RN-02, RN-05, RN-06, RN-07; DT-01, DT-05)
-- ===========================================================================
ALTER TABLE public.cells
  ALTER COLUMN meeting_day  DROP DEFAULT,                          -- P-CEL-02
  ALTER COLUMN meeting_time DROP DEFAULT,
  ALTER COLUMN type         SET DEFAULT public.cell_default_type(),  -- P-CEL-03
  ALTER COLUMN leader_id    SET NOT NULL,                          -- RN-02
  ALTER COLUMN timothy_id   SET NOT NULL,
  ALTER COLUMN host_id      SET NOT NULL,
  ALTER COLUMN meeting_day  SET NOT NULL,                          -- RN-05
  ALTER COLUMN meeting_time SET NOT NULL,                          -- RN-06
  ALTER COLUMN type         SET NOT NULL;                          -- RN-07 (já era)

DO $$
BEGIN
  ALTER TABLE public.cells ADD CONSTRAINT cells_type_check
    CHECK (type = ANY (public.cell_types()));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.cells ADD CONSTRAINT cells_meeting_day_check
    CHECK (public.weekday_index(meeting_day) IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.cells ADD CONSTRAINT cells_meeting_time_check
    CHECK (public.is_valid_meeting_time(meeting_time));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ===========================================================================
-- 5. Triggers (RN-01, RN-14; DT-04)
-- ===========================================================================

-- 5.1 a0_normalize_cell: tira os segundos e, no cadastro, resolve o tipo e a
--     situação enviados como nulo (DA-1, DA-2). Nunca recusa. INVOKER: só
--     mexe em NEW e chama funções imutáveis. Roda antes do carimbo de autoria
--     (E2.05), então "19:30:45" sobre 19:30 não é alteração.
CREATE OR REPLACE FUNCTION public.normalize_cell_input()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.meeting_time := public.normalize_meeting_time(NEW.meeting_time);   -- RN-06
  IF TG_OP = 'INSERT' THEN
    NEW.type      := coalesce(NEW.type, public.cell_default_type());     -- RN-07, DA-1
    NEW.is_active := coalesce(NEW.is_active, true);                      -- RN-11, DA-2
  END IF;
  RETURN NEW;
END;
$$;

-- Função de trigger: sem EXECUTE pela API (o trigger dispara mesmo assim).
REVOKE ALL ON FUNCTION public.normalize_cell_input() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a0_normalize_cell
  BEFORE INSERT OR UPDATE OF meeting_time ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public.normalize_cell_input();

-- 5.2 ad_enforce_cell_rules: as regras, na ordem da tela (RN-14). Confere a
--     linha inteira (depois da publicação, toda linha já está dentro do tipo
--     (a)). is_active e deleted_at não estão na lista de colunas: inativar,
--     reativar, excluir e restaurar não disparam. SECURITY DEFINER porque
--     recusa pelo _del_raise (sem EXECUTE para authenticated). Não lê tabela.
CREATE OR REPLACE FUNCTION public.enforce_cell_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NEW;                                   -- só fora da API: valem os CHECKs
  END IF;

  -- RN-02
  IF NEW.leader_id IS NULL THEN
    PERFORM public._del_raise('leader_required', 'Escolha o líder da célula.',
                              jsonb_build_object('field', 'leader_id'));
  END IF;
  IF NEW.timothy_id IS NULL THEN
    PERFORM public._del_raise('timothy_required', 'Escolha o timóteo da célula.',
                              jsonb_build_object('field', 'timothy_id'));
  END IF;
  IF NEW.host_id IS NULL THEN
    PERFORM public._del_raise('host_required', 'Escolha o anfitrião da célula.',
                              jsonb_build_object('field', 'host_id'));
  END IF;

  -- RN-07 (DA-1: na edição, nulo ou vazio é recusado)
  IF NEW.type IS NULL OR NOT (NEW.type = ANY (public.cell_types())) THEN
    PERFORM public._del_raise('cell_type_invalid',
      'Tipo de célula inválido. Escolha Evangelística, Discipulado ou Macrocélula.',
      jsonb_build_object('field', 'type'));
  END IF;

  -- RN-05 (DA-12: vazio ou só espaços é "sem dia"; o resto, sem tirar espaços)
  IF nullif(btrim(NEW.meeting_day), '') IS NULL THEN
    PERFORM public._del_raise('meeting_day_required', 'Escolha o dia da semana.',
                              jsonb_build_object('field', 'meeting_day'));
  ELSIF public.weekday_index(NEW.meeting_day) IS NULL THEN
    PERFORM public._del_raise('meeting_day_invalid',
      'Dia da semana inválido. Escolha de domingo a sábado.',
      jsonb_build_object('field', 'meeting_day'));
  END IF;

  -- RN-06 (os segundos já saíram no a0_; sobra o 24:00)
  IF NEW.meeting_time IS NULL THEN
    PERFORM public._del_raise('meeting_time_required', 'Informe o horário.',
                              jsonb_build_object('field', 'meeting_time'));
  ELSIF NOT public.is_valid_meeting_time(NEW.meeting_time) THEN
    PERFORM public._del_raise('meeting_time_invalid',
      'Horário inválido. Informe a hora e os minutos, entre 00:00 e 23:59.',
      jsonb_build_object('field', 'meeting_time'));
  END IF;

  -- RN-11: a célula nova sempre começa ativa (DA-2: nulo já virou ativa)
  IF TG_OP = 'INSERT' AND NEW.is_active IS FALSE THEN
    PERFORM public._del_raise('cell_new_inactive', 'Uma célula nova sempre começa ativa.',
                              jsonb_build_object('field', 'is_active'));
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_cell_rules() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ad_enforce_cell_rules
  BEFORE INSERT OR UPDATE OF leader_id, timothy_id, host_id, type, meeting_day, meeting_time
  ON public.cells
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cell_rules();
