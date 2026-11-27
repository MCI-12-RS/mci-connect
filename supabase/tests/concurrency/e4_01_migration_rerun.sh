#!/usr/bin/env bash
# E4 (PR 1), QA: a migration 20261203100000_e4_01_load_support.sql aplicada de novo num banco já migrado.
#   1. roda sem erro (duas vezes seguidas);
#   2. o catálogo fica igual (funções, triggers, constraints, privilégios);
#   3. o legacy_id já gravado continua lá (a migration não zera a coluna);
#   4. órfãs que existirem na hora (pós-condição da seção 4) são apagadas, sem falha.
# Usa dados fictícios gravados e apagados no fim. Só no banco local.
# Uso: PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e4_01_migration_rerun.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
MIG="$(cd "$(dirname "$0")/../.." && pwd)/migrations/20261203100000_e4_01_load_support.sql"
FAILS=0
q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1 (esperado '$3', obtido '$2')"; FAILS=$((FAILS+1)); fi; }

M=f4010a00-0000-0000-0000-000000000001
O1=f4010a00-0000-0000-0000-0000000000f1
C1=f4010a00-0000-0000-0000-0000000000c1

cleanup() {
  $PSQL -X -q >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.members WHERE id = '$M';
DELETE FROM private.member_hierarchy WHERE member_id IN ('$M', '$O1');
DELETE FROM private.cell_active_periods WHERE cell_id = '$C1';
COMMIT;
SQL
}
trap cleanup EXIT
cleanup

snapshot() {
  q "SELECT md5(string_agg(x, '|' ORDER BY x)) FROM (
       SELECT pg_get_functiondef(p.oid) || coalesce(p.proacl::text, '') || pg_get_userbyid(p.proowner) AS x
         FROM pg_proc p WHERE p.oid = ANY (ARRAY['public.keep_legacy_id()'::regprocedure,
           'private.rebuild_member_hierarchy()'::regprocedure, 'private.member_hierarchy_drift()'::regprocedure,
           'private.backfill_cell_active_periods()'::regprocedure, 'private.cell_active_period_problems()'::regprocedure])
       UNION ALL SELECT g.tgrelid::regclass::text || g.tgname || g.tgenabled::text || g.tgtype::text FROM pg_trigger g WHERE g.tgname = 'zy_keep_legacy_id'
       UNION ALL SELECT k.conrelid::regclass || k.conname || pg_get_constraintdef(k.oid) FROM pg_constraint k WHERE k.conname LIKE '%legacy_id%'
       UNION ALL SELECT a.attrelid::regclass || a.attname || coalesce(a.attacl::text, '') || a.atttypid::regtype FROM pg_attribute a
         WHERE a.attname = 'legacy_id' AND a.attrelid IN ('public.members'::regclass, 'public.cells'::regclass, 'public.cell_reports'::regclass)
       UNION ALL SELECT c.relname || coalesce(d.description, '') FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'legacy_id'
         LEFT JOIN pg_description d ON d.objoid = c.oid AND d.objsubid = a.attnum WHERE c.relname IN ('members', 'cells', 'cell_reports') AND c.relnamespace = 'public'::regnamespace
     ) s"
}

# Massa: um membro com legacy_id, uma órfã de hierarquia e uma de período (em replica, como a carga).
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, legacy_id, name, gender, is_pastor, has_leadership, mobile_whatsapp)
  VALUES ('$M', 987654, 'Reaplicar Teste', 'M', true, false, '5194010998');
INSERT INTO private.member_hierarchy (member_id) VALUES ('$M'), ('$O1');
INSERT INTO private.cell_active_periods (cell_id, periods) VALUES ('$C1', '{}'::tstzmultirange);
COMMIT;
SQL

BEFORE=$(snapshot)
$PSQL -X -q -v ON_ERROR_STOP=1 < "$MIG" >/dev/null 2>"${TMPDIR:-/tmp}/e401rerun.err"; check "1ª reaplicação sem erro" "$?" "0"
$PSQL -X -q -v ON_ERROR_STOP=1 < "$MIG" >/dev/null 2>>"${TMPDIR:-/tmp}/e401rerun.err"; check "2ª reaplicação sem erro" "$?" "0"
grep -i 'error' "${TMPDIR:-/tmp}/e401rerun.err" | head -5
check "catálogo igual (funções, trigger, constraints, grants, comentários)" "$(snapshot)" "$BEFORE"
check "legacy_id gravado continua 987654" "$(q "SELECT legacy_id FROM public.members WHERE id = '$M'")" "987654"
check "órfã de hierarquia apagada pela pós-condição" "$(q "SELECT count(*) FROM private.member_hierarchy WHERE member_id = '$O1'")" "0"
check "linha de célula inexistente (C1) apagada pela pós-condição" "$(q "SELECT count(*) FROM private.cell_active_periods WHERE cell_id = '$C1'")" "0"
check "member_hierarchy_drift() sem orphan_row" "$(q "SELECT count(*) FROM private.member_hierarchy_drift() WHERE problem = 'orphan_row'")" "0"
check "cell_active_period_problems() sem orphan_row" "$(q "SELECT count(*) FROM private.cell_active_period_problems() WHERE problem = 'orphan_row'")" "0"
rm -f "${TMPDIR:-/tmp}/e401rerun.err"
[ "$FAILS" -eq 0 ] && echo "TUDO OK" || { echo "$FAILS falha(s)"; exit 1; }
