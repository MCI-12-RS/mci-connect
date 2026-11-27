#!/usr/bin/env bash
# E2.10 (PR 1), critérios de pronto 1 e 2 das tarefas de banco (docs/specs/e2-10-listagem-celulas.md, Tarefas):
#   a. as migrations e210_01 e e210_02 rodam de novo sem erro num banco que já as tem, e a segunda rodada
#      deixa as funções, os tipos, o índice e os privilégios como estavam;
#   b. a cells_view e a cell_reports_view ficam iguais (nenhuma das duas é recriada): a definição, o dono,
#      as opções e os privilégios antes e depois das duas migrations, a partir de um banco sem elas;
#   c. a guarda da migration 1 falha num banco sem o E2.09 (sem o enum cell_report_status), sem mudar nada;
#   d. a guarda da migration 2 falha sem a migration 1;
#   e. a pós-condição da migration 1 falha se uma função da API tiver EXECUTE para anon.
# Toda rodada é desfeita (ROLLBACK), então o banco fica como estava. Use SÓ no banco local.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e210_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
M1=$(ls "$DIR"/*_e210_01_*.sql)
M2=$(ls "$DIR"/*_e210_02_*.sql)

FNS="'cells_list', 'cells_list_count', 'cell_filter_options', 'cell_filter_names', 'cell_recent_reports', 'cell_identity',
     'first_distinct_ids', 'cell_filter_normalize', 'cell_filter_sql'"
STATE="SELECT 'STATE ' || md5(
  coalesce((SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ','
                              ORDER BY p.oid::regprocedure::text)
              FROM pg_proc p WHERE p.proname IN ($FNS)), '-')
  || coalesce((SELECT string_agg(t.typname || coalesce(array_to_string(t.typacl, ' '), ''), ',' ORDER BY t.typname)
                 FROM pg_type t WHERE t.typname IN ('cell_filter_person', 'cell_filter')), '-')
  || coalesce((SELECT pg_get_indexdef(to_regclass('public.cells_created_at_idx'))), '-'));"
VIEWS="SELECT 'VIEWS ' || md5(string_agg(c.relname || pg_get_viewdef(c.oid) || c.relowner::regrole::text
                                       || coalesce(array_to_string(c.relacl, ' '), '-') || coalesce(array_to_string(c.reloptions, ' '), '-'),
                                       ',' ORDER BY c.relname))
         FROM pg_class c WHERE c.oid IN ('public.cells_view'::regclass, 'public.cell_reports_view'::regclass);"
DROP_ALL="DROP FUNCTION public.cell_recent_reports(uuid, integer); DROP FUNCTION public.cell_identity(uuid);
DROP FUNCTION public.cells_list(text[], uuid[], uuid[], text, text, text, text[], integer[], boolean, public.cell_report_status[], integer[], date, date, integer, integer);
DROP FUNCTION public.cells_list_count(text[], uuid[], uuid[], text, text, text, text[], integer[], boolean, public.cell_report_status[], integer[], date, date);
DROP FUNCTION public.cell_filter_options(public.cell_filter_person, text[], integer, integer);
DROP FUNCTION public.cell_filter_names(public.cell_filter_person, uuid[]);
DROP FUNCTION public.first_distinct_ids(uuid[], integer);
DROP FUNCTION private.cell_filter_sql(private.cell_filter);
DROP FUNCTION private.cell_filter_normalize(text[], uuid[], uuid[], text, text, text, text[], integer[], boolean, public.cell_report_status[], integer[], date, date);
DROP TYPE private.cell_filter; DROP TYPE public.cell_filter_person; DROP INDEX public.cells_created_at_idx;"

fail=0
run() { { echo "BEGIN;"; cat; echo "ROLLBACK;"; } | $PSQL -X -At -q -v ON_ERROR_STOP=1 2>&1; }
ok()  { echo "ok   - $1"; }
bad() { echo "FAIL - $1"; echo "$2" | sed 's/^/       /' | head -8; fail=1; }

# a. idempotência
out=$( { echo "$STATE"; cat "$M1" "$M2"; echo "$STATE"; } | run )
s=$(echo "$out" | grep '^STATE ' | sort -u | wc -l)
if ! echo "$out" | grep -q 'ERROR' && [ "$(echo "$out" | grep -c '^STATE ')" = 2 ] && [ "$s" = 1 ]; then
  ok "a. as duas migrations rodam de novo sem erro e sem mudar nada"
else bad "a. segunda rodada" "$out"; fi

# b. a partir de um banco sem elas: rodam, e as duas views ficam iguais
out=$( { echo "$DROP_ALL"; echo "$VIEWS"; echo "$STATE"; cat "$M1" "$M2"; echo "$VIEWS"; } | run )
v=$(echo "$out" | grep '^VIEWS ' | sort -u | wc -l)
if ! echo "$out" | grep -q 'ERROR' && [ "$(echo "$out" | grep -c '^VIEWS ')" = 2 ] && [ "$v" = 1 ] \
   && echo "$out" | grep -q '^STATE '; then
  ok "b. de um banco sem elas, as duas rodam e a cells_view e a cell_reports_view ficam iguais"
else bad "b. views" "$out"; fi

# c. guarda da migration 1 sem o E2.09
out=$( { echo "ALTER TYPE public.cell_report_status RENAME TO cell_report_status_e210_x;"; cat "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.10: faltam pré-requisitos'; then
  ok "c. a guarda da migration 1 falha sem o E2.09"
else bad "c. guarda 1" "$out"; fi

# d. guarda da migration 2 sem a migration 1
out=$( { echo "$DROP_ALL"; cat "$M2"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.10: falta a migration 1 deste passo'; then
  ok "d. a guarda da migration 2 falha sem a migration 1"
else bad "d. guarda 2" "$out"; fi

# e. pós-condição: EXECUTE para anon numa função da API
out=$( { echo "GRANT EXECUTE ON FUNCTION public.cell_filter_names(public.cell_filter_person, uuid[]) TO anon;";
         sed '/^REVOKE ALL ON FUNCTION public.cell_filter_names/,/;$/d' "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.10: .*cell_filter_names'; then
  ok "e. a pós-condição falha com EXECUTE para anon"
else bad "e. pós-condição" "$out"; fi

exit $fail
