#!/usr/bin/env bash
# E2.11 (PR 1): o retrato do relatório × troca das pessoas da célula, com duas conexões reais.
# Spec: docs/specs/e2-11-lancamento-relatorio.md (repositório apps-mci), "Retrato (migration 1)" (DT-02,
# ponto 4: uma leitura da célula com FOR SHARE), "Bloqueios e concorrência" e "Verificações obrigatórias
# (para o QA)", PR 1; RN-14, RN-07.
#
# No PR 1 a escrita direta ainda existe (o PR 2 a fecha); os cenários usam o INSERT direto de quem pode
# lançar (Pedro: igreja toda e "Editar Célula"):
#   1. troca das três pessoas e do tipo de C1 segura × lançamento: o lançamento espera e o retrato é
#      todo de depois;
#   2. lançamento seguro × troca das três pessoas: a troca espera e o retrato é todo de antes;
#   3. troca só do timóteo segura × lançamento: o retrato tem o timóteo novo e as outras pessoas iguais;
#   4. dois lançamentos da mesma célula e semana: um aceito, o outro recusado; um relatório só.
# Invariante (em cada cenário): nenhum relatório com retrato misturado (todas as pessoas e o tipo de
# antes ou todas de depois) e nenhuma célula com dois relatórios na mesma semana.
#
# Usa só dados fictícios, gravados (as duas sessões precisam enxergá-los) e apagados no fim, mesmo se o
# script for interrompido.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e211_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e211conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f211c0de-<tipo>-...
U_PEDRO=f211c0de-0001-0000-0000-000000000001
U_CARLA=f211c0de-0001-0000-0000-000000000002
R_LE=f211c0de-0002-0000-0000-000000000001     # Pedro: igreja toda, editar célula e relatórios
R_PC=f211c0de-0002-0000-0000-000000000002     # Carla: só "Enviar Relatório das Próprias Células"
M_PASTOR=f211c0de-0003-0000-0000-000000000001
M_PEDRO=f211c0de-0003-0000-0000-000000000002
M_CARLA=f211c0de-0003-0000-0000-000000000003
M_ANDRE=f211c0de-0003-0000-0000-000000000004
M_CAIO=f211c0de-0003-0000-0000-000000000005
M_DIEGO=f211c0de-0003-0000-0000-000000000006
M_HUGO=f211c0de-0003-0000-0000-000000000007
M_LUCAS=f211c0de-0003-0000-0000-000000000008
C1=f211c0de-0004-0000-0000-000000000001
C2=f211c0de-0004-0000-0000-000000000002
R1=f211c0de-0005-0000-0000-000000000001

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id::text LIKE 'f211c0de%');
DELETE FROM public.cell_reports WHERE id::text LIKE 'f211c0de%' OR cell_id::text LIKE 'f211c0de%';
DELETE FROM public.cells WHERE id::text LIKE 'f211c0de%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f211c0de%';
DELETE FROM public.members WHERE id::text LIKE 'f211c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f211c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f211c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f211c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f211c0de%' OR actor_user_id::text LIKE 'f211c0de%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Base: o pastor, Pedro (LE), Carla (anfitriã de C1), André (líder) e Caio
# (timóteo). C1 e C2 ativas, sem relatório.
base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('$U_PEDRO', 'e211-conc-1@teste.invalid'), ('$U_CARLA', 'e211-conc-2@teste.invalid');
INSERT INTO public.roles (id, name) VALUES ('$R_LE', 'E211 Conc LE'), ('$R_PC', 'E211 Conc PC');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('$R_LE', 'view_all_church'), ('$R_LE', 'edit_cell'), ('$R_LE', 'edit_cell_report'), ('$R_LE', 'view_all_reports'),
  ('$R_PC', 'submit_own_cell_report');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES
  ('$M_PASTOR', 'E211 Conc Pastor', 'M', true, false, '$M_PASTOR@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, email) VALUES
  ('$M_PEDRO', 'E211 Conc Pedro', 'M', '$M_PASTOR', true, '$U_PEDRO', '$R_LE', '$M_PEDRO@teste.invalid'),
  ('$M_CARLA', 'E211 Conc Carla', 'F', '$M_PASTOR', true, '$U_CARLA', '$R_PC', '$M_CARLA@teste.invalid'),
  ('$M_ANDRE', 'E211 Conc Andre', 'M', '$M_PASTOR', true, NULL, NULL, '$M_ANDRE@teste.invalid'),
  ('$M_CAIO',  'E211 Conc Caio',  'M', '$M_PASTOR', true, NULL, NULL, '$M_CAIO@teste.invalid'),
  ('$M_DIEGO', 'E211 Conc Diego', 'M', '$M_PASTOR', true, NULL, NULL, '$M_DIEGO@teste.invalid'),
  ('$M_HUGO',  'E211 Conc Hugo',  'M', '$M_PASTOR', true, NULL, NULL, '$M_HUGO@teste.invalid'),
  ('$M_LUCAS', 'E211 Conc Lucas', 'M', '$M_PASTOR', true, NULL, NULL, '$M_LUCAS@teste.invalid');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  ('$C1', '$M_ANDRE', '$M_CAIO', '$M_CARLA', 'Evangelística', 'Quarta', '20:00'),
  ('$C2', '$M_ANDRE', '$M_CAIO', '$M_ANDRE', 'Evangelística', 'Quinta', '20:00');
COMMIT;
SQL
}

# Sessão como o usuário do Auth $1 (vazio = postgres), com o SQL $2. Grava a
# saída em $3 e o tempo (s) em $3.t.
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

# Duas sessões: a primeira começa, a segunda entra 1 s depois.
pair() { # nome uidA sqlA uidB sqlB
  session "$2" "$3" "$TMP/$1.A" &
  sleep 1
  session "$4" "$5" "$TMP/$1.B" &
  wait
}

# Resumo do resultado de uma sessão: OK, ou SQLSTATE + code do app_error.
outcome() {
  local f=$1 err code
  err=$(grep -m1 -E '^(psql:.*)?ERROR:' "$f" | sed -E 's/.*ERROR: +//')
  if [ -z "$err" ]; then echo "OK"; return; fi
  code=$(grep -m1 '^DETAIL:' "$f" | sed -n 's/.*"code": "\([a-z_]*\)".*/\1/p')
  echo "${err%%:*}${code:+ $code} | ${err#*: }"
}

check() { # descrição, SQL booleano
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
is_ok() { [[ "$(outcome "$1")" == OK* ]] && echo true || echo false; }
# A sessão B esperou a A (entrou 1 s depois; a A segura por $HOLD s).
waited() { echo "$(cat "$1.t") >= $HOLD - 1 - 0.3" | bc | sed 's/1/true/;s/0/false/'; }
no_wait() { echo "$(cat "$1.t") < 1.5" | bc | sed 's/1/true/;s/0/false/'; }

show() {
  echo "  sessão A: $(outcome "$TMP/$1.A") ($(cut -c1-4 "$TMP/$1.A.t") s)"
  echo "  sessão B: $(outcome "$TMP/$1.B") ($(cut -c1-4 "$TMP/$1.B.t") s)"
}


INS_C1="INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme) VALUES ('$C1', public.sp_today(), '23:59', true, 'conc');"
SWAP_ALL="UPDATE public.cells SET leader_id = '$M_DIEGO', timothy_id = '$M_HUGO', host_id = '$M_LUCAS', type = 'Macrocélula' WHERE id = '$C1';"
SWAP_TIM="UPDATE public.cells SET timothy_id = '$M_HUGO' WHERE id = '$C1';"
SNAP="SELECT snapshot_leader_id::text || ',' || snapshot_timothy_id || ',' || snapshot_host_id || ',' || snapshot_cell_type
        FROM public.cell_reports WHERE cell_id = '$C1' AND deleted_at IS NULL"
COUNT_C1="SELECT count(*) FROM public.cell_reports WHERE cell_id = '$C1' AND deleted_at IS NULL"
BEFORE="$M_ANDRE,$M_CAIO,$M_CARLA,Evangelística"
AFTER="$M_DIEGO,$M_HUGO,$M_LUCAS,Macrocélula"
invariant() {
  check "invariante: um relatório em C1 e o retrato inteiro de antes ou de depois" \
    "SELECT ($COUNT_C1) = 1 AND ($SNAP) IN ('$BEFORE', '$AFTER', '$M_ANDRE,$M_HUGO,$M_CARLA,Evangelística')"
}

# ---------------------------------------------------------------------------
echo "== 1. Troca das pessoas e do tipo de C1 segura × lançamento de Pedro"
base
pair s1 "" "BEGIN; $SWAP_ALL SELECT pg_sleep($HOLD); COMMIT;" \
        "$U_PEDRO" "$INS_C1"
show s1
check "A troca as pessoas de C1" "SELECT $(is_ok "$TMP/s1.A")"
check "B esperou a troca" "SELECT $(waited "$TMP/s1.B")"
check "B lança" "SELECT $(is_ok "$TMP/s1.B")"
check "o retrato é todo de depois (Diego, Hugo, Lucas, Macrocélula)" "SELECT ($SNAP) = '$AFTER'"
invariant

# ---------------------------------------------------------------------------
echo "== 2. Lançamento seguro de Pedro × troca das pessoas de C1"
base
pair s2 "$U_PEDRO" "BEGIN; $INS_C1 SELECT pg_sleep($HOLD); COMMIT;" \
        "" "$SWAP_ALL"
show s2
check "A lança" "SELECT $(is_ok "$TMP/s2.A")"
check "B esperou o lançamento (FOR SHARE na célula)" "SELECT $(waited "$TMP/s2.B")"
check "B troca as pessoas" "SELECT $(is_ok "$TMP/s2.B")"
check "o retrato é todo de antes (André, Caio, Carla, Evangelística); a célula ficou com as novas" \
  "SELECT ($SNAP) = '$BEFORE' AND (SELECT leader_id = '$M_DIEGO' FROM public.cells WHERE id = '$C1')"
invariant

# ---------------------------------------------------------------------------
echo "== 3. Troca só do timóteo segura × lançamento de Pedro"
base
pair s3 "" "BEGIN; $SWAP_TIM SELECT pg_sleep($HOLD); COMMIT;" \
        "$U_PEDRO" "$INS_C1"
show s3
check "B esperou a troca e lançou" "SELECT $(waited "$TMP/s3.B") AND $(is_ok "$TMP/s3.B")"
check "o retrato tem o timóteo novo e as outras pessoas iguais" \
  "SELECT ($SNAP) = '$M_ANDRE,$M_HUGO,$M_CARLA,Evangelística'"
invariant

# ---------------------------------------------------------------------------
echo "== 4. Dois lançamentos de C1 na mesma semana"
base
pair s4 "$U_PEDRO" "BEGIN; $INS_C1 SELECT pg_sleep($HOLD); COMMIT;" \
        "$U_PEDRO" "$INS_C1"
show s4
check "A lança" "SELECT $(is_ok "$TMP/s4.A")"
check "B esperou e foi recusado" "SELECT $(waited "$TMP/s4.B") AND NOT $(is_ok "$TMP/s4.B")"
invariant

echo
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: todos os cenários passaram"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
