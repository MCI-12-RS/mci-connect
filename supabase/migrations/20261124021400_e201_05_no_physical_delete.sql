-- E2.01 (PR 2, migration 5) — Exclusão lógica: fim da exclusão física pela API.
-- Ver docs/specs/e2-01-exclusao-logica.md no repositório apps-mci (RN-01,
-- DT-02, "Integridade garantida pelo banco", "Implantação" e tarefa 6).
--
-- A partir daqui, membros, células e relatórios só são excluídos (e
-- restaurados) pelas RPCs delete_* e restore_* da migration 4, que marcam
-- deleted_at e deleted_by. Esta migration:
--   1. retira as políticas de DELETE de members, cells e cell_reports;
--   2. tira DELETE e TRUNCATE dessas três tabelas de PUBLIC, anon e
--      authenticated (o TRUNCATE não passa pelo RLS, então só o privilégio
--      o impede);
--   3. tira o TRUNCATE de cell_report_participants dos mesmos papéis.
--
-- Fica como está:
--   - a política de DELETE de cell_report_participants: a retirada de um
--     participante não excluído continua física (RN-13), e o trigger
--     aa_enforce_participant_rules recusa a de um participante excluído;
--   - os privilégios da service_role (Edge Functions e manutenção). Uma
--     exclusão física feita por ela continua barrada pelas FKs NO ACTION
--     enquanto houver referência (DT-03).
--
-- Vai ao ar junto com o front que exclui pelas RPCs (risco 7 do spec): entre o
-- "Deploy: banco" e o promote, a exclusão pela tela antiga recebe 42501 e nada
-- é apagado.
--
-- Pode rodar de novo sem erro: DROP POLICY IF EXISTS e REVOKE.

-- 1. Políticas de DELETE ------------------------------------------------------
DROP POLICY IF EXISTS "Users with delete_member can delete" ON public.members;
DROP POLICY IF EXISTS "Users with delete_cell can delete" ON public.cells;
DROP POLICY IF EXISTS "Cell reports delete policy" ON public.cell_reports;

-- 2. DELETE e TRUNCATE nas três tabelas --------------------------------------
REVOKE DELETE, TRUNCATE ON public.members, public.cells, public.cell_reports
  FROM PUBLIC, anon, authenticated;

-- 3. TRUNCATE em participantes -------------------------------------------------
REVOKE TRUNCATE ON public.cell_report_participants FROM PUBLIC, anon, authenticated;
