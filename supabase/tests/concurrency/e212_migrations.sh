#!/usr/bin/env bash
# E2.12 (PR 1), critérios de pronto 1 a 3 das tarefas de banco (docs/specs/e2-12-listagem-relatorios.md, Tarefas):
#   a. as migrations e212_01 e e212_02 rodam de novo sem erro num banco que já as tem, e a segunda rodada
#      deixa as funções, o tipo, as duas views (cell_reports_view e cell_report_participants_view) e os
#      privilégios como estavam;
#   b. a guarda da migration 1 falha num banco sem o E2.11 (sem a submit_cell_report), sem mudar nada;
#   c. a guarda da migration 2 falha sem a migration 1;
#   d. a pós-condição da migration 1 falha se uma função da API tiver EXECUTE para anon;
#   e. a pós-condição da migration 2 falha se a save_cell_report voltar a chamar a submit_cell_report.
# Toda rodada é desfeita (ROLLBACK), então o banco fica como estava. Use SÓ no banco local.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e212_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
M1=$(ls "$DIR"/*_e212_01_*.sql)
M2=$(ls "$DIR"/*_e212_02_*.sql)

FNS="'cell_reports_list', 'cell_reports_list_count', 'cell_report_filter_options', 'cell_report_filter_names', 'server_weeks',
     'cell_report_filter_people', 'cell_report_filter_normalize', 'cell_report_filter_sql', 'save_cell_report'"
STATE="SELECT 'STATE ' || md5(
  coalesce((SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ','
                              ORDER BY p.oid::regprocedure::text)
              FROM pg_proc p WHERE p.proname IN ($FNS)), '-')
  || coalesce((SELECT string_agg(t.typname || coalesce(array_to_string(t.typacl, ' '), ''), ',' ORDER BY t.typname)
                 FROM pg_type t WHERE t.typname = 'cell_report_filter'), '-')
  || (SELECT string_agg(c.relname || pg_get_viewdef(c.oid) || c.relowner::regrole::text
                        || coalesce(array_to_string(c.relacl, ' '), '-') || coalesce(array_to_string(c.reloptions, ' '), '-'),
                        ',' ORDER BY c.relname)
        FROM pg_class c WHERE c.oid IN ('public.cell_reports_view'::regclass, 'public.cell_report_participants_view'::regclass)));"

fail=0
run() { { echo "BEGIN;"; cat; echo "ROLLBACK;"; } | $PSQL -X -At -q -v ON_ERROR_STOP=1 2>&1; }
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; echo "$2" | sed 's/^/       /' | head -8; fail=1; }

# a. idempotência
out=$( { echo "$STATE"; cat "$M1" "$M2"; echo "$STATE"; } | run )
s=$(echo "$out" | grep '^STATE ' | sort -u | wc -l)
if ! echo "$out" | grep -q 'ERROR' && [ "$(echo "$out" | grep -c '^STATE ')" = 2 ] && [ "$s" = 1 ]; then
  ok "a. as duas migrations rodam de novo sem erro e sem mudar nada (funções, tipo, views, privilégios)"
else bad "a. segunda rodada" "$out"; fi

# b. guarda da migration 1 sem o E2.11
out=$( { echo "ALTER FUNCTION public.submit_cell_report(uuid, jsonb, uuid[]) RENAME TO submit_cell_report_e212_x;"; cat "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.12 depende do'; then
  ok "b. a guarda da migration 1 falha sem o E2.11"
else bad "b. guarda 1" "$out"; fi

# c. guarda da migration 2 sem a migration 1
out=$( { echo "DROP FUNCTION public.cell_reports_list(text[], uuid, uuid[], uuid[], date, date, text[], boolean, integer, integer);"; cat "$M2"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.12: falta a migration 1 deste passo'; then
  ok "c. a guarda da migration 2 falha sem a migration 1"
else bad "c. guarda 2" "$out"; fi

# d. pós-condição 1: EXECUTE para anon numa função da API
out=$( { echo "GRANT EXECUTE ON FUNCTION public.cell_report_filter_names(public.cell_filter_person, uuid[]) TO anon;";
         sed '/^REVOKE ALL ON FUNCTION public.cell_report_filter_names/,/;$/d' "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.12: modo de segurança ou privilégios .*cell_report_filter_names'; then
  ok "d. a pós-condição da migration 1 falha com EXECUTE para anon"
else bad "d. pós-condição 1" "$out"; fi

# e. pós-condição 2: o corpo volta a lançar pela submit_cell_report
out=$( { sed "s/PERFORM private.report_raise('report_id_required');                         -- técnica/PERFORM private.report_raise('report_id_required'); PERFORM public.submit_cell_report(NULL, NULL);/" "$M2"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.12: save_cell_report diferente do desenho'; then
  ok "e. a pós-condição da migration 2 falha se o corpo chamar a submit_cell_report"
else bad "e. pós-condição 2" "$out"; fi

exit $fail
