#!/usr/bin/env bash
# E2.09, critério de pronto 1: as migrations e209_01 e e209_02 rodam de novo sem erro num banco que já as tem
# (idempotência), e a segunda rodada deixa o que elas criam (estrutura, privilégios e o histórico) como estava.
# A migration 1 cria a linha que falta de uma célula inserida em replica e para, só com ids, se o invariante
# (DA-5) não fechar. Toda rodada é desfeita (ROLLBACK), então o banco fica como estava. Use SÓ no banco local.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e209_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
M1=$(ls "$DIR"/*_e209_01_*.sql)
M2=$(ls "$DIR"/*_e209_02_*.sql)

# Migration 1: a tabela, o trigger, as funções (com os grants) e o histórico gravado.
STATE1="SELECT md5(
  (SELECT string_agg(attname || format_type(atttypid, atttypmod) || attnotnull::text, ',' ORDER BY attnum)
     FROM pg_attribute WHERE attrelid = 'private.cell_active_periods'::regclass AND attnum > 0 AND NOT attisdropped)
  || coalesce((SELECT array_to_string(relacl, ' ') FROM pg_class WHERE oid = 'private.cell_active_periods'::regclass), '-')
  || (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.cells'::regclass AND tgname = 'trg_cell_active_period')
  || (SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ','
                        ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p WHERE p.proname IN ('track_cell_active_period', 'backfill_cell_active_periods', 'cell_active_period_problems'))
  || coalesce((SELECT string_agg(cell_id::text || periods::text, ',' ORDER BY cell_id) FROM private.cell_active_periods), '-'));"
# Migration 2: a view, as funções (com os grants) e o enum.
STATE2="SELECT md5(
  pg_get_viewdef('public.cells_view'::regclass)
  || coalesce((SELECT array_to_string(relacl, ' ') FROM pg_class WHERE oid = 'public.cells_view'::regclass), '-')
  || (SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ','
                        ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p WHERE p.proname IN ('sp_local', 'sp_instant', 'sp_now', 'sp_today', 'report_deadline', 'report_week_counts',
          'report_situation_rule', 'cell_report_situation', 'cells_report_situation', 'dashboard_summary'))
  || array_to_string(enum_range(NULL::public.cell_report_status), ','));"
FAILS=0
rerun() {
  local f=$1 state=$2 out rc
  out=$({ echo 'BEGIN;'; echo "$state"; cat "$f"; echo; echo "$state"; echo 'ROLLBACK;'; } \
        | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v NOTICE)
  rc=$?
  if [ $rc -eq 0 ] && ! echo "$out" | grep -q 'ERROR' && [ "$(echo "$out" | sort -u | wc -l)" -eq 1 ]; then
    echo "  PASS  roda de novo sem erro e sem mudar nada: $(basename "$f")"
  else echo "  FAIL  $(basename "$f"): $(echo "$out" | head -3)"; FAILS=$((FAILS + 1)); fi
}
rerun "$M1" "$STATE1"
rerun "$M2" "$STATE2"

# Dados mínimos para as guardas (fictícios, em replica, desfeitos no ROLLBACK).
SEED="SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp)
  VALUES ('e2090f00-0000-0000-0000-000000000001', 'Guarda Nomesecreto', 'M', true, false, '51992090901');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  ('e2090f00-0000-0000-0000-0000000000c1', 'e2090f00-0000-0000-0000-000000000001', 'e2090f00-0000-0000-0000-000000000001',
   'e2090f00-0000-0000-0000-000000000001', 'Evangelística', 'Quarta', '20:00', true),
  ('e2090f00-0000-0000-0000-0000000000c2', 'e2090f00-0000-0000-0000-000000000001', 'e2090f00-0000-0000-0000-000000000001',
   'e2090f00-0000-0000-0000-000000000001', 'Evangelística', 'Quarta', '20:00', false);
SET LOCAL session_replication_role = origin;"

# DA-5: a célula sem linha (inserida em replica) ganha a linha na reexecução, sem erro.
OUT=$({ echo 'BEGIN;'; echo "$SEED"; cat "$M1"; echo;
        echo "SELECT string_agg(cell_id::text || '=' || upper_inf(periods)::text, ',' ORDER BY cell_id) FROM private.cell_active_periods WHERE cell_id::text LIKE 'e2090f00%';";
        echo 'ROLLBACK;'; } | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v NOTICE)
if [ "$OUT" = "e2090f00-0000-0000-0000-0000000000c1=true,e2090f00-0000-0000-0000-0000000000c2=false" ]; then
  echo "  PASS  backfill: a ativa sem linha abre o período, a inativa fica sem período"
else echo "  FAIL  backfill: $OUT"; FAILS=$((FAILS + 1)); fi

# Guarda do invariante: uma inativa com o período aberto para a migration, só com o id, sem nome.
OUT=$({ echo 'BEGIN;'; echo "$SEED";
        echo "INSERT INTO private.cell_active_periods VALUES ('e2090f00-0000-0000-0000-0000000000c2', '{(,)}');";
        cat "$M1"; echo; echo 'ROLLBACK;'; } | $PSQL -X -q -At 2>&1 | grep -v NOTICE)
if echo "$OUT" | grep -q 'E2.09: histórico de períodos ativos inconsistente nas células {e2090f00-0000-0000-0000-0000000000c2}' \
   && ! echo "$OUT" | grep -q 'Nomesecreto'; then
  echo "  PASS  guarda: para com o id da célula, sem nome"
else echo "  FAIL  guarda: $(echo "$OUT" | grep ERROR | head -2)"; FAILS=$((FAILS + 1)); fi
LEFT=$(echo "SELECT count(*) FROM public.cells WHERE id::text LIKE 'e2090f00%';" | $PSQL -X -q -At 2>&1)
if [ "$LEFT" = "0" ]; then echo "  PASS  guardas: nada ficou gravado"
else echo "  FAIL  guardas: sobrou $LEFT célula(s)"; FAILS=$((FAILS + 1)); fi

if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: as migrations rodam de novo sem erro e a guarda para sem mudar nada"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
