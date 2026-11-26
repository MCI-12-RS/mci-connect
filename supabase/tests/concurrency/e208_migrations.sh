#!/usr/bin/env bash
# E2.08 (PR 1), critério de pronto 1: a migration e208_01 roda de novo sem erro num banco que já a tem
# (idempotência), e a segunda rodada deixa o trigger e a cells_view como estavam. A rodada é desfeita
# (ROLLBACK), então o banco fica como estava. Use SÓ no banco local do Supabase.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e208_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
STATE="SELECT md5(pg_get_viewdef('public.cells_view'::regclass) || (SELECT string_agg(tgname || pg_get_triggerdef(oid), ',' ORDER BY tgname)
         FROM pg_trigger WHERE tgrelid = 'public.cell_reports'::regclass AND NOT tgisinternal));"
FAILS=0
for f in "$DIR"/*_e208_01_*.sql; do
  OUT=$({ echo 'BEGIN;'; echo "$STATE"; cat "$f"; echo; echo "$STATE"; echo 'ROLLBACK;'; } \
        | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v NOTICE)
  RC=$?
  if [ $RC -eq 0 ] && ! echo "$OUT" | grep -q 'ERROR' && [ "$(echo "$OUT" | sort -u | wc -l)" -eq 1 ]; then
    echo "  PASS  roda de novo sem erro e sem mudar nada: $(basename "$f")"
  else echo "  FAIL  $(basename "$f"): $(echo "$OUT" | head -3)"; FAILS=$((FAILS + 1)); fi
done
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: a migration roda de novo sem erro"; exit 0; fi
echo "RESULTADO: $FAILS migration(ões) falharam ao rodar de novo"; exit 1
