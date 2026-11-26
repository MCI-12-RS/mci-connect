#!/usr/bin/env bash
# E2.09 (PR 1): o histórico dos períodos ativos com duas conexões reais.
# Spec: docs/specs/e2-09-situacao-relatorio.md (repositório apps-mci), "Bloqueios e concorrência" e
# "Verificações obrigatórias (para o QA)" (Concorrência); RN-06, DA-2, DT-03.
#
# Cada cenário abre duas sessões do psql em paralelo. A primeira segura a trava da célula com pg_sleep; a
# segunda começa no meio e espera. Cenários:
#   1a. inativação segura × reativação: vale a última; no fim a célula está ativa e o período aberto;
#   1b. reativação segura × inativação: no fim a célula está inativa e o período fechado;
#   2a. delete_cell segura × inativação: a inativação espera e, sob o RLS, não acha mais a célula (0 linhas);
#       período fechado;
#   2b. inativação segura × delete_cell: a exclusão espera e é aceita; período fechado;
#   3a. restore_cell (excluída quando inativa) segura × reativação: sob o RLS, a reativação não enxerga a
#       célula ainda excluída, não espera e não muda nada (0 linhas); no fim, restaurada, inativa e com o
#       período fechado;
#   3b. a reativação depois da restauração abre o período.
# No fim de cada cenário: private.cell_active_period_problems() vazia, período aberto só na célula ativa e
# não excluída, e uma linha só por célula.
#
# Usa só dados fictícios, gravados (as duas sessões precisam enxergá-los) e apagados no fim, mesmo se o
# script for interrompido.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e209_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e209conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

U_RITA=f209c0de-0001-0000-0000-000000000001
U_PEDRO=f209c0de-0001-0000-0000-000000000002
M_PASTOR=f209c0de-0003-0000-0000-000000000001
M_RITA=f209c0de-0003-0000-0000-000000000002
M_PEDRO=f209c0de-0003-0000-0000-000000000003
M_ANDRE=f209c0de-0003-0000-0000-000000000004
C1=f209c0de-0004-0000-0000-000000000001

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM private.cell_active_periods WHERE cell_id::text LIKE 'f209c0de%';
DELETE FROM public.cells WHERE id::text LIKE 'f209c0de%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f209c0de%';
DELETE FROM public.members WHERE id::text LIKE 'f209c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM auth.users WHERE id::text LIKE 'f209c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f209c0de%' OR actor_user_id::text LIKE 'f209c0de%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Base: o pastor, Rita (Administrador), Pedro (Líder, edita a célula) e André (líder de C1). C1 ativa,
# com o histórico "desde sempre".
base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('$U_RITA', 'e209-conc-1@teste.invalid'), ('$U_PEDRO', 'e209-conc-2@teste.invalid');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  ('$M_PASTOR', 'E209 Conc Pastor', 'M', true, false, '51992090001');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, mobile_whatsapp) VALUES
  ('$M_RITA',  'E209 Conc Rita',  'F', '$M_PASTOR', true, '$U_RITA',  (SELECT id FROM public.roles WHERE name = 'Administrador'), '51992090002'),
  ('$M_PEDRO', 'E209 Conc Pedro', 'M', '$M_PASTOR', true, '$U_PEDRO', (SELECT id FROM public.roles WHERE name = 'Líder'), '51992090003');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp) VALUES
  ('$M_ANDRE', 'E209 Conc Andre', 'M', '$M_PEDRO', true, '51992090004');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  ('$C1', '$M_ANDRE', '$M_ANDRE', '$M_ANDRE', 'Evangelística', 'Quarta', '20:00');
UPDATE private.cell_active_periods SET periods = '{(,)}' WHERE cell_id = '$C1';
COMMIT;
SQL
}

session() {
  local start end
  start=$(date +%s.%N)
  {
    echo '\set VERBOSITY verbose'
    if [ -n "$1" ]; then
      echo "SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false) \\g /dev/null"
      echo "SET ROLE authenticated;"
    fi
    echo "$2"
  } | $PSQL -X -q -At -v ON_ERROR_STOP=0 > "$3" 2>&1
  end=$(date +%s.%N)
  echo "$end - $start" | bc > "$3.t"
}
pair() { # nome uidA sqlA uidB sqlB
  session "$2" "$3" "$TMP/$1.A" &
  sleep 1
  session "$4" "$5" "$TMP/$1.B" &
  wait
}
outcome() {
  local f=$1 err code
  err=$(grep -m1 -E '^(psql:.*)?ERROR:' "$f" | sed -E 's/.*ERROR: +//')
  if [ -z "$err" ]; then echo "OK"; return; fi
  code=$(grep -m1 '^DETAIL:' "$f" | sed -n 's/.*"code": "\([a-z_]*\)".*/\1/p')
  echo "${err%%:*}${code:+ $code} | ${err#*: }"
}
check() {
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
is_ok() { [[ "$(outcome "$1")" == OK* ]] && echo true || echo false; }
waited() { echo "$(cat "$1.t") >= $HOLD - 1 - 0.3" | bc | sed 's/1/true/;s/0/false/'; }
show() {
  echo "  sessão A: $(outcome "$TMP/$1.A") ($(cut -c1-4 "$TMP/$1.A.t") s)"
  echo "  sessão B: $(outcome "$TMP/$1.B") ($(cut -c1-4 "$TMP/$1.B.t") s)"
}
invariant() {
  check "invariante: cell_active_period_problems() vazia" "SELECT NOT EXISTS (SELECT 1 FROM private.cell_active_period_problems())"
  check "uma linha só para C1" "SELECT count(*) = 1 FROM private.cell_active_periods WHERE cell_id = '$C1'"
}
STATE="SELECT (c.is_active AND c.deleted_at IS NULL)::text || '/' || upper_inf(p.periods)::text FROM public.cells c JOIN private.cell_active_periods p ON p.cell_id = c.id WHERE c.id = '$C1'"

INACTIVATE="UPDATE public.cells SET is_active = false WHERE id = '$C1';"
REACTIVATE="UPDATE public.cells SET is_active = true WHERE id = '$C1';"

echo "== 1a. Inativação segura × reativação"
base
pair s1a "$U_PEDRO" "BEGIN; $INACTIVATE SELECT pg_sleep($HOLD); COMMIT;" "$U_PEDRO" "$REACTIVATE"
show s1a
check "A inativa e B reativa" "SELECT $(is_ok "$TMP/s1a.A") AND $(is_ok "$TMP/s1a.B")"
check "B esperou a inativação" "SELECT $(waited "$TMP/s1a.B")"
check "vale a última: ativa, período aberto" "SELECT ($STATE) = 'true/true'"
invariant

echo "== 1b. Reativação segura × inativação"
base
q "$INACTIVATE" >/dev/null
pair s1b "$U_PEDRO" "BEGIN; $REACTIVATE SELECT pg_sleep($HOLD); COMMIT;" "$U_PEDRO" "$INACTIVATE"
show s1b
check "A reativa e B inativa" "SELECT $(is_ok "$TMP/s1b.A") AND $(is_ok "$TMP/s1b.B")"
check "B esperou a reativação" "SELECT $(waited "$TMP/s1b.B")"
check "vale a última: inativa, período fechado" "SELECT ($STATE) = 'false/false'"
invariant

echo "== 2a. delete_cell segura × inativação"
base
pair s2a "$U_RITA" "BEGIN; SELECT public.delete_cell('$C1'); SELECT pg_sleep($HOLD); COMMIT;" "$U_PEDRO" "${INACTIVATE%;} RETURNING 'changed';"
show s2a
check "A exclui C1" "SELECT $(is_ok "$TMP/s2a.A")"
check "B esperou a exclusão" "SELECT $(waited "$TMP/s2a.B")"
check "B não muda nada (0 linhas)" "SELECT $(grep -q changed "$TMP/s2a.B" && echo false || echo true)"
check "C1 excluída, período fechado" "SELECT ($STATE) = 'false/false' AND (SELECT deleted_at IS NOT NULL FROM public.cells WHERE id = '$C1')"
invariant

echo "== 2b. Inativação segura × delete_cell"
base
pair s2b "$U_PEDRO" "BEGIN; $INACTIVATE SELECT pg_sleep($HOLD); COMMIT;" "$U_RITA" "SELECT public.delete_cell('$C1');"
show s2b
check "A inativa e B exclui" "SELECT $(is_ok "$TMP/s2b.A") AND $(is_ok "$TMP/s2b.B")"
check "B esperou a inativação" "SELECT $(waited "$TMP/s2b.B")"
check "C1 inativa e excluída, período fechado" \
  "SELECT ($STATE) = 'false/false' AND (SELECT deleted_at IS NOT NULL AND NOT is_active FROM public.cells WHERE id = '$C1')"
invariant

echo "== 3a. restore_cell (excluída quando inativa) segura × reativação"
base
q "$INACTIVATE" >/dev/null
$PSQL -X -q -At -v ON_ERROR_STOP=1 >/dev/null <<SQL
SELECT set_config('request.jwt.claims', '{"sub":"$U_RITA","role":"authenticated"}', false) \g /dev/null
SET ROLE authenticated;
SELECT public.delete_cell('$C1');
SQL
pair s3 "$U_RITA" "BEGIN; SELECT public.restore_cell('$C1'); SELECT pg_sleep($HOLD); COMMIT;" "$U_PEDRO" "${REACTIVATE%;} RETURNING 'changed';"
show s3
check "A restaura; B termina sem erro" "SELECT $(is_ok "$TMP/s3.A") AND $(is_ok "$TMP/s3.B")"
check "B não muda nada (0 linhas: a célula ainda está excluída no snapshot dela)" \
  "SELECT $(grep -q changed "$TMP/s3.B" && echo false || echo true)"
check "C1 restaurada e inativa, período fechado" \
  "SELECT ($STATE) = 'false/false' AND (SELECT deleted_at IS NULL FROM public.cells WHERE id = '$C1')"
invariant
echo "== 3b. Reativação depois da restauração"
session "$U_PEDRO" "$REACTIVATE" "$TMP/s3b.A"
check "C1 ativa, não excluída e com o período aberto" "SELECT ($STATE) = 'true/true'"
invariant

if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: todos os cenários terminam com o invariante"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
