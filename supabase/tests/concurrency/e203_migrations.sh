#!/usr/bin/env bash
# E2.03 (PRs 1 e 4), critério de pronto 1: as migrations e203_01 a e203_05 rodam de novo sem erro, num banco que já as
# tem (idempotência), e a segunda rodada não deixa senha em auth.users. Cada rodada é desfeita (ROLLBACK), então o
# banco fica como estava. Use SÓ no banco local do Supabase.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e203_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
FAILS=0
for f in "$DIR"/*_e203_0[1-5]_*.sql; do
  OUT=$({ echo 'BEGIN;'; cat "$f"; echo; echo 'SELECT count(*) FROM auth.users WHERE coalesce(encrypted_password, '"''"') <> '"''"';'; echo 'ROLLBACK;'; } \
        | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1)
  RC=$?
  if [ $RC -eq 0 ] && ! echo "$OUT" | grep -q 'ERROR'; then echo "  PASS  roda de novo sem erro: $(basename "$f")"
  else echo "  FAIL  $(basename "$f"): $(echo "$OUT" | grep -m1 'ERROR')"; FAILS=$((FAILS + 1)); fi
done
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: as cinco migrations rodam de novo sem erro"; exit 0; fi
echo "RESULTADO: $FAILS migration(ões) falharam ao rodar de novo"; exit 1
