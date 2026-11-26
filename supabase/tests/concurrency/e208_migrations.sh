#!/usr/bin/env bash
# E2.08, critério de pronto 1 e 3: as migrations e208_01 e e208_02 rodam de novo sem erro num banco que
# já as tem (idempotência), e a segunda rodada deixa o que elas criam como estava; a guarda da e208_02
# para com as regras e os ids, sem dado pessoal e sem mudar nada. Toda rodada é desfeita (ROLLBACK), então
# o banco fica como estava. Use SÓ no banco local do Supabase.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e208_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
# Migration 1: a cells_view e os triggers de cell_reports.
STATE1="SELECT md5(pg_get_viewdef('public.cells_view'::regclass) || (SELECT string_agg(tgname || pg_get_triggerdef(oid), ',' ORDER BY tgname)
         FROM pg_trigger WHERE tgrelid = 'public.cell_reports'::regclass AND NOT tgisinternal));"
# Migration 2: triggers, constraints, padrões e NOT NULL de cells, e as funções novas.
STATE2="SELECT md5(
  (SELECT string_agg(tgname || pg_get_triggerdef(oid), ',' ORDER BY tgname) FROM pg_trigger
    WHERE tgrelid = 'public.cells'::regclass AND NOT tgisinternal)
  || (SELECT string_agg(conname || pg_get_constraintdef(oid), ',' ORDER BY conname) FROM pg_constraint
    WHERE conrelid = 'public.cells'::regclass)
  || (SELECT string_agg(attname || attnotnull::text || coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), ',' ORDER BY attnum)
        FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = 'public.cells'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
  || (SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ',' ORDER BY p.oid::regprocedure::text)
        FROM pg_proc p WHERE p.proname IN ('cell_weekdays', 'cell_types', 'cell_default_type', 'weekday_index',
          'normalize_meeting_time', 'is_valid_meeting_time', 'cell_rule_violations', 'normalize_cell_input', 'enforce_cell_rules')));"
FAILS=0
rerun() {
  local f=$1 state=$2
  OUT=$({ echo 'BEGIN;'; echo "$state"; cat "$f"; echo; echo "$state"; echo 'ROLLBACK;'; } \
        | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v NOTICE)
  RC=$?
  if [ $RC -eq 0 ] && ! echo "$OUT" | grep -q 'ERROR' && [ "$(echo "$OUT" | sort -u | wc -l)" -eq 1 ]; then
    echo "  PASS  roda de novo sem erro e sem mudar nada: $(basename "$f")"
  else echo "  FAIL  $(basename "$f"): $(echo "$OUT" | head -3)"; FAILS=$((FAILS + 1)); fi
}
for f in "$DIR"/*_e208_01_*.sql; do rerun "$f" "$STATE1"; done
M2=$(ls "$DIR"/*_e208_02_*.sql)
rerun "$M2" "$STATE2"

# Guarda (RN-13, DT-13): com uma célula sem timóteo e uma com horário com segundos, a migration falha
# com a regra e o id, sem o nome de ninguém, e nada muda (nem a correção dos segundos).
GUARD=$(cat <<SQL
BEGIN;
ALTER TABLE public.cells ALTER COLUMN timothy_id DROP NOT NULL;
ALTER TABLE public.cells DROP CONSTRAINT cells_meeting_time_check;
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp)
  VALUES ('e2080f00-0000-0000-0000-000000000001', 'Guarda Nomesecreto', 'M', true, false, '51992080901');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time) VALUES
  ('e2080f00-0000-0000-0000-0000000000c1', 'e2080f00-0000-0000-0000-000000000001', NULL,
   'e2080f00-0000-0000-0000-000000000001', 'Quarta', '20:00'),
  ('e2080f00-0000-0000-0000-0000000000c2', 'e2080f00-0000-0000-0000-000000000001', 'e2080f00-0000-0000-0000-000000000001',
   'e2080f00-0000-0000-0000-000000000001', 'Quarta', '19:30:45');
SET LOCAL session_replication_role = origin;
$(cat "$M2")
ROLLBACK;
SQL
)
OUT=$(echo "$GUARD" | $PSQL -X -q -At 2>&1 | grep -v NOTICE)
if echo "$OUT" | grep -q 'E2.08: células fora das regras do tipo (a)' \
   && echo "$OUT" | grep -q 'timothy_required: e2080f00-0000-0000-0000-0000000000c1' \
   && ! echo "$OUT" | grep -q 'e2080f00-0000-0000-0000-0000000000c2' \
   && ! echo "$OUT" | grep -q 'Nomesecreto'; then
  echo "  PASS  guarda: para com a regra e o id, sem nome; a célula com segundos não aparece (corrigida antes)"
else echo "  FAIL  guarda: $(echo "$OUT" | grep ERROR | head -2)"; FAILS=$((FAILS + 1)); fi
LEFT=$(echo "SELECT count(*) FROM public.cells WHERE id::text LIKE 'e2080f00%';" | $PSQL -X -q -At 2>&1)
if [ "$LEFT" = "0" ]; then echo "  PASS  guarda: nada ficou gravado"
else echo "  FAIL  guarda: sobrou $LEFT célula(s)"; FAILS=$((FAILS + 1)); fi

if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: as migrations rodam de novo sem erro e a guarda para sem mudar nada"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
