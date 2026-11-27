#!/usr/bin/env bash
# E2.12 (PR 1), QA: as quatro RPCs novas e a server_weeks pela API de verdade (PostgREST + JWT local):
# tipos errados, valores extremos, argumentos desconhecidos, anon e a recusa da save_cell_report sem id.
# Cada caso diz o status HTTP esperado (e, quando importa, o código do erro). Só no banco local.
#
# Uso (pista A):
#   set -a; . .worktrees/env/lane-a.env; set +a
#   CF_IP=10.9.9.9 supabase/tests/concurrency/e212_api_inputs.sh
# Precisa da função sign-in servida e do administrador do E2E (seed-admin.sh).
set -uo pipefail
: "${VITE_SUPABASE_URL:?}" "${VITE_SUPABASE_PUBLISHABLE_KEY:?}" "${E2E_ADMIN_EMAIL:?}" "${E2E_ADMIN_PASSWORD:?}"
case "$VITE_SUPABASE_URL" in http://127.0.0.1:*|http://localhost:*) ;; *) echo "só no banco local"; exit 2;; esac
KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

TOKEN=$(curl -s -m 30 -X POST "$VITE_SUPABASE_URL/functions/v1/sign-in" -H "apikey: $KEY" -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' -H "CF-Connecting-IP: ${CF_IP:-10.9.9.9}" \
  -d "{\"identifier\":\"$E2E_ADMIN_EMAIL\",\"password\":\"$E2E_ADMIN_PASSWORD\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).session.access_token)}catch(e){console.log("")}})')
[ -n "$TOKEN" ] || { echo "sem token (sign-in não respondeu)"; exit 2; }

pass=0; fail=0
# check <descrição> <função> <corpo> <status esperado> [trecho esperado na resposta]
check() {
  local out status
  out=$(curl -s -m 20 -w '\n%{http_code}' -X POST "$VITE_SUPABASE_URL/rest/v1/rpc/$2" -H "apikey: $KEY" \
        -H "Authorization: Bearer ${AUTH:-$TOKEN}" -H 'Content-Type: application/json' -d "$3")
  status=${out##*$'\n'}; out=${out%$'\n'*}
  if [ "$status" = "$4" ] && { [ -z "${5:-}" ] || [[ "$out" == *"$5"* ]]; }; then pass=$((pass+1))
  else fail=$((fail+1)); echo "FALHOU: $1 (status $status, esperado $4 ${5:+com '$5'}): ${out:0:160}"; fi
}

check "lista sem filtros"                 cell_reports_list        '{}' 200
check "total sem filtros"                 cell_reports_list_count  '{}' 200
check "_leader_ids como texto"            cell_reports_list        '{"_leader_ids":"abc"}' 400 22P02
check "_leader_ids com uuid inválido"     cell_reports_list        '{"_leader_ids":["xyz"]}' 400 22P02
check "_leader_ids com números"           cell_reports_list        '{"_leader_ids":[1,2]}' 400 22P02
check "_g12_ids como objeto"              cell_reports_list_count  '{"_g12_ids":{"a":1}}' 400 22P02
check "_limit texto"                      cell_reports_list        '{"_limit":"x"}' 400 22P02
check "_limit fora do inteiro"            cell_reports_list        '{"_limit":99999999999}' 400 22003
check "_limit decimal"                    cell_reports_list        '{"_limit":2.5}' 400 22P02
check "_limit nulo"                       cell_reports_list        '{"_limit":null}' 200
check "_offset gigante"                   cell_reports_list        '{"_offset":2147483647}' 200 '[]'
check "data impossível"                   cell_reports_list        '{"_date_from":"2026-13-45"}' 400 22008
check "data infinity"                     cell_reports_list_count  '{"_date_from":"infinity"}' 200 0
check "_held texto"                       cell_reports_list        '{"_held":"talvez"}' 400 22P02
check "_search com injeção"               cell_reports_list        '{"_search":["%'"'"'); DROP TABLE members;--%"]}' 200
check "_search como objeto"               cell_reports_list        '{"_search":{"a":1}}' 400 22P02
check "_types com nulo e inválido"        cell_reports_list        '{"_types":[null,"Foo"]}' 200
check "_cell_id inválido"                 cell_reports_list        '{"_cell_id":"nao-e-uuid"}' 400 22P02
check "argumento desconhecido"            cell_reports_list        '{"_foo":1}' 404 PGRST202
check "opções: _person fora do enum"      cell_report_filter_options '{"_person":"x"}' 400 22P02
check "opções: _person ausente"           cell_report_filter_options '{}' 404 PGRST202
check "opções: leader"                    cell_report_filter_options '{"_person":"leader"}' 200
check "nomes: id inexistente"             cell_report_filter_names '{"_person":"g12","_ids":["ffffffff-0000-0000-0000-000000000000"]}' 200 '[]'
check "nomes: ids como texto"             cell_report_filter_names '{"_person":"g12","_ids":"abc"}' 400 22P02
check "server_weeks"                      server_weeks             '{}' 200 this_week_start
check "server_weeks com texto"            server_weeks             '{"_at":"ontem"}' 400 22007
check "save_cell_report sem id (null)"    save_cell_report         '{"_report_id":null,"_report":{}}' 400 report_id_required
check "save_cell_report com dados e sem id" save_cell_report       '{"_report_id":null,"_report":{"theme":"x","offering":1},"_participant_ids":[]}' 400 report_id_required
check "save_cell_report id inexistente"   save_cell_report         '{"_report_id":"ffffffff-0000-0000-0000-000000000000","_report":{}}' 400 not_found_or_deleted
AUTH=$KEY
check "anon: lista"                       cell_reports_list        '{}' 401
check "anon: total"                       cell_reports_list_count  '{}' 401
check "anon: opções"                      cell_report_filter_options '{"_person":"leader"}' 401
check "anon: nomes"                       cell_report_filter_names '{"_person":"leader","_ids":[]}' 401
check "anon: server_weeks"                server_weeks             '{}' 401
check "anon: save_cell_report"            save_cell_report         '{"_report_id":null,"_report":{}}' 401

echo "e212_api_inputs: $pass passaram, $fail falharam"
[ "$fail" = 0 ]
