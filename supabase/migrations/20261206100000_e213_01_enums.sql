-- E2.13 (PR 1, migration 1 de 3) — Exportação dos relatórios para Excel: valores novos de enum.
-- Ver docs/specs/e2-13-exportacao-excel.md no repositório apps-mci (Solução técnica: DT-09, DT-10).
--
-- Separada das migrations seguintes porque um valor novo de enum não pode ser usado na mesma
-- transação que o cria.
--
--   permission_action  export_cell_reports  "Exportar Relatórios de Células" (RN-01). A Administrador
--                                           a recebe sozinha (active_permissions); a Líder, na
--                                           migration 3.
--   event_action       export               "Exportação" (RN-11), da entidade cell_report.
--
-- Pode rodar de novo sem erro (IF NOT EXISTS).

ALTER TYPE public.permission_action ADD VALUE IF NOT EXISTS 'export_cell_reports';
ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'export';
