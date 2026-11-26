-- E2.05 (PR 1, migration 1 de 6) — Auditoria: tipos novos. Ver docs/specs/e2-05-auditoria-autor.md
-- no repositório apps-mci ("Modelo de dados e migrations", "Contratos"; DT-01, DT-10, DT-16).
--
-- Separada das demais porque um valor novo de enum não pode ser usado na transação que o cria.
--   - event_entity ganha 'role' (RN-15). O valor 'cell_report_participant' fica no enum, sem uso
--     a partir deste passo: a migration 5 converte os eventos antigos em eventos do relatório.
--   - author_kind: o tipo do autor do cadastro, da última alteração e da exclusão (RN-09).
--   - event_actor_kind: o tipo do autor do evento (AQ-6): 'none' é o login sem sessão.
--
-- Pode rodar de novo sem erro.

ALTER TYPE public.event_entity ADD VALUE IF NOT EXISTS 'role';

DO $$
BEGIN
  CREATE TYPE public.author_kind AS ENUM ('member', 'system', 'legacy', 'unknown');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  CREATE TYPE public.event_actor_kind AS ENUM ('member', 'system', 'none');
EXCEPTION WHEN duplicate_object THEN NULL;
END;
$$;
