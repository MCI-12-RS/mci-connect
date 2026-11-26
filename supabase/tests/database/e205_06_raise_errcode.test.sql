-- E2.05 (PR 2, QA): nenhuma função de public ou private levanta P0001 por RAISE EXCEPTION sem ERRCODE.
-- O front (src/lib/cell-reports/report-form.ts, RAISED_BY_TRIGGER) mostra no toast o texto de todo P0001;
-- um RAISE sem ERRCODE na gravação de membro, célula ou relatório vazaria texto técnico.
-- Exceção conhecida: enforce_insert_permission (ramo inalcançável, tabela não prevista).
-- Rodar com: supabase test db
BEGIN;
SELECT plan(1);

SELECT is(
  (SELECT coalesce(string_agg(DISTINCT p.proname, ', ' ORDER BY p.proname), '')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.proname <> 'enforce_insert_permission'
      AND EXISTS (
        SELECT 1
          FROM regexp_matches(p.prosrc, 'RAISE\s+EXCEPTION\M([^;]*);', 'gi') AS m(parts)
         WHERE m.parts[1] !~* 'ERRCODE'
      )),
  '',
  'todo RAISE EXCEPTION das funções tem ERRCODE (nenhum P0001 por omissão)'
);

SELECT * FROM finish();
ROLLBACK;
