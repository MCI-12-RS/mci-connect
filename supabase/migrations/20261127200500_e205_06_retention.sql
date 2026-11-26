-- E2.05 (PR 1, migration 6 de 6) — Auditoria: prazo de guarda. Ver
-- docs/specs/e2-05-auditoria-autor.md no repositório apps-mci ("Imutabilidade e prazo de guarda";
-- RN-16, RN-17; DA-9; DT-14; risco 6).
--
-- Conteúdo:
--   1. private.audit_retention(event_action): o prazo de cada ação. Compara o texto da ação
--      para não depender dos valores do enum; uma ação nova que não esteja nas listas fica 2 anos
--      (DA-9: guarda mais, nunca menos).
--        90 dias: login_failed, login_blocked, password_reset_refused, password_change_failed,
--                 password_change_blocked;
--        1 ano:   login, logout;
--        2 anos:  as demais (cadastro, alteração, exclusão e restauração de membros, células,
--                 relatórios e funções; senha redefinida, senha alterada e troca exigida).
--   2. private.audit_purge(): apaga em lotes curtos, sem trava longa, o que passou do prazo
--      (occurred_at < now() - prazo: em até 1 dia depois do fim, nunca antes). Só ela e as
--      migrations apagam eventos (RN-16).
--   3. O job e205-audit-retention no pg_cron do E1.04: todo dia às 03:20 de Brasília (06:20 UTC).
--      cron.schedule com o mesmo nome substitui o job.
--
-- A autoria dos registros e os dados de exclusão ficam nas tabelas e não dependem dos eventos
-- (RN-13 d). Pode rodar de novo sem erro.

CREATE OR REPLACE FUNCTION private.audit_retention(_action public.event_action)
RETURNS interval
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
           WHEN _action::text IN ('login_failed', 'login_blocked', 'password_reset_refused',
                                  'password_change_failed', 'password_change_blocked') THEN interval '90 days'
           WHEN _action::text IN ('login', 'logout') THEN interval '1 year'
           ELSE interval '2 years'
         END
$$;

CREATE OR REPLACE FUNCTION private.audit_purge()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _keep interval;
  _n integer;
  _total integer := 0;
BEGIN
  FOREACH _keep IN ARRAY ARRAY[interval '90 days', interval '1 year', interval '2 years'] LOOP
    LOOP                                                       -- lotes curtos, sem trava longa
      DELETE FROM public.events e
       WHERE e.id IN (SELECT x.id
                        FROM public.events x
                       WHERE x.occurred_at < now() - _keep
                         AND private.audit_retention(x.action) = _keep
                       ORDER BY x.occurred_at
                       LIMIT 5000);
      GET DIAGNOSTICS _n = ROW_COUNT;
      _total := _total + _n;
      EXIT WHEN _n < 5000;
    END LOOP;
  END LOOP;
  RETURN _total;
END;
$$;

REVOKE ALL ON FUNCTION private.audit_retention(public.event_action) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.audit_purge() FROM PUBLIC, anon, authenticated, service_role;

SELECT cron.schedule('e205-audit-retention', '20 6 * * *', 'SELECT private.audit_purge()');
