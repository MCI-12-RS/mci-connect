#!/usr/bin/env bash
# E2.11 (PR 1), critério de pronto 1 e 2 e "Verificações obrigatórias" (migration roda de novo; a guarda
# falha com os ids, sem mudar nada; RN-21: o preenchimento dos relatórios que já existem, inclusive os
# excluídos e os de célula excluída, sem evento e sem mudar updated_at). Toda rodada é desfeita
# (ROLLBACK), então o banco fica como estava. Use SÓ no banco local do Supabase.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e211_migrations.sh
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
M1=$(ls "$DIR"/*_e211_01_*.sql)
FAILS=0
pass() { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILS=$((FAILS + 1)); }

# 1. Roda de novo sem erro e sem mudar nada (triggers, constraints, colunas, views, políticas e funções).
STATE="SELECT md5(
  (SELECT string_agg(tgname::text || tgenabled::text || pg_get_triggerdef(oid), ',' ORDER BY tgname) FROM pg_trigger
    WHERE tgrelid = 'public.cell_reports'::regclass AND NOT tgisinternal)
  || (SELECT string_agg(conname || pg_get_constraintdef(oid), ',' ORDER BY conname) FROM pg_constraint
    WHERE conrelid = 'public.cell_reports'::regclass)
  || (SELECT string_agg(attname || attnotnull::text, ',' ORDER BY attnum) FROM pg_attribute
    WHERE attrelid = 'public.cell_reports'::regclass AND attnum > 0 AND NOT attisdropped)
  || (SELECT string_agg(indexrelid::regclass::text || pg_get_indexdef(indexrelid), ',' ORDER BY indexrelid::regclass::text)
    FROM pg_index WHERE indrelid = 'public.cell_reports'::regclass)
  || pg_get_viewdef('public.cell_reports_view'::regclass) || pg_get_viewdef('public.cell_reports_deleted_view'::regclass)
  || pg_get_viewdef('public.cell_report_participants_view'::regclass)
  || (SELECT string_agg(policyname || coalesce(qual, '') || coalesce(with_check, ''), ',' ORDER BY policyname) FROM pg_policies
    WHERE tablename IN ('cell_reports', 'cell_report_participants'))
  || (SELECT string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(array_to_string(p.proacl, ' '), ''), ','
        ORDER BY p.oid::regprocedure::text)
      FROM pg_proc p WHERE p.proname IN ('cell_report_snapshot', 'viewer_sees_report_people',
        'viewer_can_insert_cell_report_participant', 'cell_in_viewer_ministry'))
  || (SELECT count(*) FROM public.cell_reports)::text || (SELECT count(*) FROM public.events)::text);"
OUT=$({ echo 'BEGIN;'; echo "$STATE"; cat "$M1"; echo; echo "$STATE"; echo 'ROLLBACK;'; } \
      | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v NOTICE)
RC=$?
if [ $RC -eq 0 ] && ! echo "$OUT" | grep -q 'ERROR' && [ "$(echo "$OUT" | sort -u | wc -l)" -eq 1 ]; then
  pass "roda de novo sem erro e sem mudar nada: $(basename "$M1")"
else fail "$(basename "$M1") na segunda rodada: $(echo "$OUT" | head -3)"; fi

# Volta ao estado de antes da migration para os relatórios da massa: sem o NOT NULL e sem o trigger (o
# que existia antes do E2.11). Os relatórios da massa entram com o retrato nulo.
PRE=$(cat <<'SQL'
ALTER TABLE public.cell_reports
  ALTER COLUMN snapshot_leader_id DROP NOT NULL, ALTER COLUMN snapshot_timothy_id DROP NOT NULL,
  ALTER COLUMN snapshot_host_id DROP NOT NULL, ALTER COLUMN snapshot_cell_type DROP NOT NULL;
ALTER TABLE public.cell_reports DISABLE TRIGGER ad_cell_report_snapshot;
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  ('e2110f00-0000-0000-0000-000000000001', 'Guarda Nomesecreto', 'M', true, false, '51992110901'),
  ('e2110f00-0000-0000-0000-000000000002', 'Guarda Timóteo', 'F', true, false, '51992110902'),
  ('e2110f00-0000-0000-0000-000000000003', 'Guarda Anfitrião', 'M', true, false, '51992110903');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, deleted_at) VALUES
  ('e2110f00-0000-0000-0000-0000000000c1', 'e2110f00-0000-0000-0000-000000000001', 'e2110f00-0000-0000-0000-000000000002',
   'e2110f00-0000-0000-0000-000000000003', 'Discipulado', 'Quarta', '20:00', NULL),
  ('e2110f00-0000-0000-0000-0000000000c2', 'e2110f00-0000-0000-0000-000000000003', 'e2110f00-0000-0000-0000-000000000001',
   'e2110f00-0000-0000-0000-000000000002', 'Macrocélula', 'Quarta', '20:00', now());
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, created_at, updated_at, updated_by_kind, deleted_at) VALUES
  ('e2110f00-0000-0000-0000-0000000000a1', 'e2110f00-0000-0000-0000-0000000000c1', '2026-01-07', '20:00', true, 'Tema secreto',
   '2026-01-08 10:00+00', '2026-01-09 10:00+00', 'system', NULL),
  ('e2110f00-0000-0000-0000-0000000000a2', 'e2110f00-0000-0000-0000-0000000000c1', '2026-01-14', '20:00', true, 'Tema secreto',
   '2026-01-15 10:00+00', NULL, NULL, '2026-01-16 10:00+00'),
  ('e2110f00-0000-0000-0000-0000000000a3', 'e2110f00-0000-0000-0000-0000000000c2', '2026-01-07', '20:00', false, NULL,
   '2026-01-08 10:00+00', NULL, NULL, NULL);
SET LOCAL session_replication_role = origin;
SQL
)

# 2. RN-21: o preenchimento dá às linhas (ativa, excluída e de célula excluída) as pessoas e o tipo atuais
#    da célula, sem evento e sem mudar updated_at; depois dele, o NOT NULL e o trigger voltam.
CHECK=$(cat <<'SQL'
SELECT string_agg(right(id::text, 2) || '=' || right(snapshot_leader_id::text, 1) || right(snapshot_timothy_id::text, 1)
                  || right(snapshot_host_id::text, 1) || ':' || snapshot_cell_type || ':' || coalesce(updated_at::text, '-'), ' ' ORDER BY id)
  FROM public.cell_reports WHERE id::text LIKE 'e2110f00%';
SELECT 'events=' || count(*) FROM public.events WHERE entity_id::text LIKE 'e2110f00%';
SELECT 'notnull=' || count(*) FROM pg_attribute WHERE attrelid = 'public.cell_reports'::regclass AND attnotnull
   AND attname IN ('snapshot_leader_id', 'snapshot_timothy_id', 'snapshot_host_id', 'snapshot_cell_type');
SELECT 'trigger=' || tgenabled::text FROM pg_trigger WHERE tgrelid = 'public.cell_reports'::regclass AND tgname = 'ad_cell_report_snapshot';
SQL
)
OUT=$({ echo 'BEGIN;'; echo "$PRE"; cat "$M1"; echo; echo "$CHECK"; echo 'ROLLBACK;'; } \
      | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v NOTICE)
WANT_ROWS="a1=123:Discipulado:2026-01-09 10:00:00+00 a2=123:Discipulado:- a3=312:Macrocélula:-"
if echo "$OUT" | grep -qx "$WANT_ROWS" && echo "$OUT" | grep -qx 'events=0' \
   && echo "$OUT" | grep -qx 'notnull=4' && echo "$OUT" | grep -qx 'trigger=A'; then
  pass "RN-21: ativa, excluída e de célula excluída com as pessoas e o tipo atuais; sem evento; updated_at igual; NOT NULL e trigger de volta"
else fail "RN-21 preenchimento: $(echo "$OUT" | head -6 | tr '\n' ' ')"; fi

# 3. Guarda: um relatório cuja célula não existe (só possível em replica, sem a FK) fica sem retrato; a
#    migration para com o id, sem o nome de ninguém nem o tema, e nada muda.
GUARD=$(cat <<SQL
BEGIN;
$PRE
SET LOCAL session_replication_role = replica;
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES
  ('e2110f00-0000-0000-0000-0000000000a9', 'e2110f00-0000-0000-0000-0000000000c9', '2026-01-21', '20:00', true, 'Tema secreto');
SET LOCAL session_replication_role = origin;
$(cat "$M1")
ROLLBACK;
SQL
)
OUT=$(echo "$GUARD" | $PSQL -X -q -At 2>&1 | grep -v NOTICE)
if echo "$OUT" | grep -q 'E2.11: relatórios sem retrato válido: {e2110f00-0000-0000-0000-0000000000a9}' \
   && ! echo "$OUT" | grep -q 'Nomesecreto' && ! echo "$OUT" | grep -q 'secreto'; then
  pass "guarda: para com o id do relatório sem retrato, sem nome nem tema"
else fail "guarda: $(echo "$OUT" | grep ERROR | head -2)"; fi
LEFT=$(echo "SELECT count(*) FROM public.cell_reports WHERE id::text LIKE 'e2110f00%';" | $PSQL -X -q -At 2>&1)
NN=$(echo "SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.cell_reports'::regclass AND attnotnull AND attname LIKE 'snapshot_%';" | $PSQL -X -q -At 2>&1)
if [ "$LEFT" = "0" ] && [ "$NN" = "4" ]; then pass "guarda: nada ficou gravado e o NOT NULL continua"
else fail "guarda: sobrou $LEFT relatório(s); NOT NULL em $NN coluna(s)"; fi

# 4. Guarda de nomes: com uma coluna de retrato com outro nome (E4.02?), a migration para cedo e nada muda.
OUT=$({ echo 'BEGIN;'; echo 'ALTER TABLE public.cell_reports RENAME COLUMN snapshot_cell_type TO cell_type;'; cat "$M1"; echo 'ROLLBACK;'; } \
      | $PSQL -X -q -At 2>&1 | grep -v NOTICE)
if echo "$OUT" | grep -q 'E2.11: cell_reports já tem colunas de retrato com outro nome'; then
  pass "guarda de nomes: para cedo se cell_reports já tem coluna de retrato com outro nome"
else fail "guarda de nomes: $(echo "$OUT" | grep ERROR | head -2)"; fi

if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: a migration roda de novo, preenche os existentes e a guarda para sem mudar nada"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
