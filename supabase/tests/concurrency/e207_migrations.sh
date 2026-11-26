#!/usr/bin/env bash
# E2.07, critérios de pronto 1 e 2 das tarefas de banco (docs/specs/e2-07-filtros-membros.md, Tarefas):
#   a. as migrations e207_01 e e207_02 rodam de novo sem erro num banco que já as tem, e a segunda rodada
#      deixa a members_view, as funções e os privilégios como estavam;
#   b. a partir do estado anterior (a members_view do E2.05, com as quatro colunas de vínculo), as duas
#      rodam e deixam as colunas novas no fim;
#   c. a guarda falha num banco sem o E2.06 (sem private.member_hierarchy), sem mudar nada;
#   d. com uma view de teste sobre a members_view antiga, o DROP falha e nada muda;
#   e. a pós-condição falha se um privilégio da members_view for diferente do de antes.
# Toda rodada é desfeita (ROLLBACK), então o banco fica como estava. Use SÓ no banco local, sem outros
# testes rodando ao mesmo tempo (o DROP VIEW trava a members_view até o ROLLBACK).
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e207_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
M1=$(ls "$DIR"/*_e207_01_*.sql)
M2=$(ls "$DIR"/*_e207_02_*.sql)
OLD=$(ls "$DIR"/*_e205_04_read.sql)

# A members_view antes do E2.07 (a do E2.05), tirada da própria migration.
OLD_VIEW=$(awk '/^CREATE OR REPLACE VIEW public.members_view/{on=1} /^ALTER VIEW public.members_view OWNER TO postgres;/{print; on=0} on' "$OLD")
OLD_STATE="DROP FUNCTION public.members_list(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date, integer, integer);
DROP FUNCTION public.members_list_count(text[], uuid[], text, text, boolean, public.member_leadership_status[], boolean, integer[], public.member_cell_link[], date, date);
DROP VIEW public.members_view;
${OLD_VIEW}
REVOKE ALL ON public.members_view FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.members_view TO authenticated;"

STATE="SELECT 'STATE ' || md5(pg_get_viewdef('public.members_view'::regclass)
  || coalesce(array_to_string(c.relacl, ' '), '-') || coalesce(array_to_string(c.reloptions, ' '), '-')
  || (SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ','
                        ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p WHERE p.proname IN ('members_list', 'members_list_count', 'cell_links_or_none', 'sp_day_start',
                                            'text_key', 'member_filter_normalize', 'member_filter_sql', 'dashboard_summary')))
  FROM pg_class c WHERE c.oid = 'public.members_view'::regclass;"
COLS="SELECT 'COLS ' || string_agg(attname, ',' ORDER BY attnum DESC) FROM (SELECT attname, attnum FROM pg_attribute
       WHERE attrelid = 'public.members_view'::regclass AND attnum > 0 AND NOT attisdropped ORDER BY attnum DESC LIMIT 2) x;"

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

# b. a partir do estado anterior
out=$( { echo "$OLD_STATE"; cat "$M1" "$M2"; echo "$COLS"; } | run )
if ! echo "$out" | grep -q 'ERROR' && echo "$out" | grep -q '^COLS cell_links,leadership_status$'; then
  ok "b. do estado anterior (members_view do E2.05), as duas rodam e põem as colunas novas no fim"
else bad "b. estado anterior" "$out"; fi

# c. guarda
out=$( { echo "ALTER TABLE private.member_hierarchy RENAME TO member_hierarchy_e207_x;"; cat "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.07 depende do PR 1 do E2.06'; then
  ok "c. a guarda falha sem o E2.06"
else bad "c. guarda" "$out"; fi

# d. dependente da members_view antiga
out=$( { echo "$OLD_STATE"; echo "CREATE VIEW public.e207_dep AS SELECT id, is_cell_leader FROM public.members_view;"; cat "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  cannot drop view members_view because other objects depend on it'; then
  ok "d. com um dependente, o DROP falha (e a transação inteira é desfeita)"
else bad "d. dependente" "$out"; fi

# e. privilégio diferente
out=$( { echo "GRANT INSERT ON public.members_view TO authenticated;"; cat "$M1"; } | run )
if echo "$out" | grep -q 'ERROR:  E2.07: members_view com dono, opções ou privilégios diferentes de antes.'; then
  ok "e. a pós-condição falha com um privilégio diferente do de antes"
else bad "e. privilégio" "$out"; fi

exit $fail
