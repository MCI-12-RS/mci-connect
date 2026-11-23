-- E2.01 (PR 1, migration 1 de 4) — Valor 'restore' na ação da auditoria.
-- Ver docs/specs/e2-01-exclusao-logica.md no repositório apps-mci (AQ-9, DT-16).
--
-- Separada das demais porque um valor novo de enum não pode ser usado na mesma
-- transação que o cria. A migration 4 grava eventos com action = 'restore'.
--
-- Pode rodar de novo sem erro (IF NOT EXISTS).

ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'restore';
