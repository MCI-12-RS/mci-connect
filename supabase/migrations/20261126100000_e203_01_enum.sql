-- E2.03 (PR 1, migration 1 de 4) — Ações novas da Auditoria de senha.
-- Ver docs/specs/e2-03-senha.md no repositório apps-mci (RN-17, DT-14 e
-- "Auditoria" da Solução técnica).
--
-- Separada das migrations seguintes porque um valor novo de enum não pode ser
-- usado na mesma transação que o cria. O 'password_changed' já existe.
--
--   password_reset            Senha redefinida
--   password_reset_refused    Redefinição de senha recusada
--   password_change_failed    Falha na troca de senha (senha atual incorreta)
--   password_change_blocked   Troca de senha bloqueada por excesso de tentativas
--   password_change_required  Troca de senha exigida (login ou publicação)
--
-- Pode rodar de novo sem erro (IF NOT EXISTS).

ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'password_reset';
ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'password_reset_refused';
ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'password_change_failed';
ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'password_change_blocked';
ALTER TYPE public.event_action ADD VALUE IF NOT EXISTS 'password_change_required';
