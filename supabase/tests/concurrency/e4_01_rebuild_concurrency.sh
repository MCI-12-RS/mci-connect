#!/usr/bin/env bash
# E4 (PR 1), QA: private.rebuild_member_hierarchy() (a trava exclusiva members:leader-tree da carga) junto de
# trocas de líder reais, com duas ou mais conexões. Spec: docs/specs/e4-carga.md, DT-03 e risco 3.
#   1. troca de líder aberta (com 200 abaixo) e o rebuild chega depois: o rebuild espera o commit e termina;
#   2. rebuild aberto e a troca de líder chega depois: a troca espera;
#   3. 12 rodadas com rebuild e trocas de líder disputando: nenhum deadlock (40P01) nem erro;
#   4. no fim, member_hierarchy_drift() vazia, totais conferidos e nenhum órfão.
# Dados fictícios, gravados e apagados no fim. Só no banco local.
# Uso: PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e4_01_rebuild_concurrency.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e401conc.XXXXXX")
FAILS=0
q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (esperado '$3', obtido '$2')"; FAILS=$((FAILS+1)); fi; }
now_ms() { date +%s%3N; }

P=f4010c00-0000-0000-0001-000000000001     # pastor
A=f4010c00-0000-0000-0001-000000000002     # G12 com 200 abaixo
B=f4010c00-0000-0000-0001-000000000003     # G12 sem ninguém

cleanup() {
  $PSQL -X -q >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.members WHERE id::text LIKE 'f4010c00%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT
cleanup

# Massa com os triggers ligados (líder antes do discípulo): 1 pastor, 2 G12, 50 filhos e 150 netos de A.
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL' || { echo "falha na massa"; exit 1; }
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp)
VALUES ('f4010c00-0000-0000-0001-000000000001', 'Pastor Concorrente', 'M', true, false, '51940110001');
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, mobile_whatsapp) VALUES
  ('f4010c00-0000-0000-0001-000000000002', 'Alfa Concorrente', 'M', false, 'f4010c00-0000-0000-0001-000000000001', '51940110002'),
  ('f4010c00-0000-0000-0001-000000000003', 'Beta Concorrente', 'F', false, 'f4010c00-0000-0000-0001-000000000001', '51940110003');
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, mobile_whatsapp)
SELECT ('f4010c00-0000-0000-0002-' || lpad(i::text, 12, '0'))::uuid, 'Filho' || i || ' Concorrente', 'M', false,
       'f4010c00-0000-0000-0001-000000000002', '5194012' || lpad(i::text, 4, '0')
  FROM generate_series(1, 50) i;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, mobile_whatsapp)
SELECT ('f4010c00-0000-0000-0003-' || lpad(i::text, 12, '0'))::uuid, 'Neto' || i || ' Concorrente', 'F', false,
       ('f4010c00-0000-0000-0002-' || lpad(((i - 1) % 50 + 1)::text, 12, '0'))::uuid, '5194013' || lpad(i::text, 4, '0')
  FROM generate_series(1, 150) i;
SQL
check "massa: 203 membros" "$(q "SELECT count(*) FROM public.members WHERE id::text LIKE 'f4010c00%'")" "203"
check "massa: drift vazia" "$(q "SELECT count(*) FROM private.member_hierarchy_drift()")" "0"

# 1. A troca de líder segura a trava por 3 s; o rebuild chega 1 s depois.
$PSQL -X -q -v ON_ERROR_STOP=1 >"$TMP/s1.out" 2>"$TMP/s1.err" <<SQL &
BEGIN; UPDATE public.members SET leader_id = '$B' WHERE id = '$A'; SELECT pg_sleep(3); COMMIT;
SQL
PID1=$!
sleep 1
T0=$(now_ms)
$PSQL -X -q -At -v ON_ERROR_STOP=1 -c "SELECT private.rebuild_member_hierarchy()" >"$TMP/r1.out" 2>"$TMP/r1.err"; RC=$?
T1=$(now_ms); wait $PID1
check "1. rebuild terminou sem erro" "$RC" "0"
[ $((T1 - T0)) -ge 1500 ] && R=esperou || R="não esperou ($((T1 - T0)) ms)"
check "1. rebuild esperou o commit da troca de líder" "$R" "esperou"
check "1. drift vazia" "$(q "SELECT count(*) FROM private.member_hierarchy_drift()")" "0"
check "1. Beta passou a ter 201 discípulos (o rebuild viu a troca commitada, 1 + 200)" "$(q "SELECT total_disciples FROM private.member_hierarchy WHERE member_id = '$B'")" "201"
check "1. nível dos netos recalculado (4: Alfa agora está sob Beta)" "$(q "SELECT count(*) FROM private.member_hierarchy h JOIN public.members m ON m.id = h.member_id WHERE m.name LIKE 'Neto%' AND h.g12_level = 4")" "150"

# 2. O rebuild segura a trava por 3 s (a transação continua aberta); a troca de líder chega 1 s depois.
$PSQL -X -q -v ON_ERROR_STOP=1 >"$TMP/s2.out" 2>"$TMP/s2.err" <<SQL &
BEGIN; SELECT private.rebuild_member_hierarchy(); SELECT pg_sleep(3); COMMIT;
SQL
PID2=$!
sleep 1
T0=$(now_ms)
$PSQL -X -q -At -v ON_ERROR_STOP=1 -c "UPDATE public.members SET leader_id = '$P' WHERE id = '$A'" >"$TMP/u2.out" 2>"$TMP/u2.err"; RC=$?
T1=$(now_ms); wait $PID2
check "2. troca de líder terminou sem erro" "$RC" "0"
[ $((T1 - T0)) -ge 1500 ] && R=esperou || R="não esperou ($((T1 - T0)) ms)"
check "2. a troca esperou o rebuild" "$R" "esperou"
check "2. drift vazia" "$(q "SELECT count(*) FROM private.member_hierarchy_drift()")" "0"
check "2. Alfa de volta com 200 discípulos" "$(q "SELECT total_disciples FROM private.member_hierarchy WHERE member_id = '$A'")" "200"

# 3. Rodadas disputando (4 trocas e 4 rebuilds em paralelo por rodada), sem deadlock.
for round in $(seq 1 12); do
  for k in 1 2 3 4; do
    if [ $((k % 2)) -eq 0 ]; then NEW=$B; else NEW=$P; fi
    $PSQL -X -q -At -c "UPDATE public.members SET leader_id = '$NEW' WHERE id = '$A'" >>"$TMP/loop.out" 2>>"$TMP/loop.err" &
    $PSQL -X -q -At -c "SELECT private.rebuild_member_hierarchy()" >>"$TMP/loop.out" 2>>"$TMP/loop.err" &
  done
  wait
done
check "3. nenhum erro nas 96 chamadas concorrentes (40P01 e outros)" "$(grep -ci 'error' "$TMP/loop.err" 2>/dev/null || true)" "0"
check "3. drift vazia depois das rodadas" "$(q "SELECT count(*) FROM private.member_hierarchy_drift()")" "0"
check "3. o pastor tem 202 discípulos (Alfa, Beta e os 200), qualquer que seja o líder final de Alfa" \
  "$(q "SELECT total_disciples FROM private.member_hierarchy WHERE member_id = '$P'")" "202"
check "3. nenhuma linha órfã" "$(q "SELECT count(*) FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id)")" "0"

[ "$FAILS" -eq 0 ] && echo "TUDO OK" || { echo "$FAILS falha(s)"; head -5 "$TMP"/*.err 2>/dev/null; exit 1; }
