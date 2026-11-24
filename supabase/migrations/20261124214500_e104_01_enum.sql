-- E1.04 (PR 1, migration 1 de 2) — Valor 'login_blocked' na ação da auditoria.
-- Ver docs/specs/e1-04-sign-in.md no repositório apps-mci (RN-15, DT-11).
--
-- Separada da migration 2 porque um valor novo de enum não pode ser usado na
-- mesma transação que o cria. A sign_in_attempt grava eventos com
-- action = 'login_blocked'.
--
-- Pode rodar de novo sem erro (IF NOT EXISTS).

ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'login_blocked';
