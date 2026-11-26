#!/usr/bin/env bash
# E2.08 (PR 1): célula inativa × relatório novo, com duas conexões reais.
# Spec: docs/specs/e2-08-cadastro-celulas.md (repositório apps-mci), "Bloqueios e
# concorrência" e "Verificações obrigatórias (para o QA)"; RN-11 (c) e (d), DT-06.
#
# Cada cenário abre duas sessões do psql em paralelo. A primeira segura a trava
# com pg_sleep; a segunda começa no meio. Confere o resultado de cada uma, se a
# segunda esperou (ou não) e o estado final:
#   1. inativação segura × lançamento: o lançamento espera e recebe cell_inactive;
#   2. lançamento seguro × inativação: a inativação espera; no fim o relatório
#      existe e a célula está inativa;
#   3. troca da célula de um relatório × inativação da célula nova, nas duas
#      ordens (3a: inativação primeiro, recusada; 3b: troca primeiro, aceita);
#   4. reativação × lançamento: o lançamento espera e é aceito;
#   5. troca do tema de um relatório × inativação, nas duas ordens: nenhuma
#      espera, e as duas são aceitas (RN-11 d).
# Invariante (conferido em cada cenário): nenhum relatório novo entra numa
# célula que já estava inativa quando ele foi aceito (1 e 3a); o que foi aceito
# antes da inativação fica (2 e 3b).
#
# Usa só dados fictícios, gravados (as duas sessões precisam enxergá-los) e
# apagados no fim, mesmo se o script for interrompido.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e208_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e208conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f208c0de-<tipo>-...
U_PEDRO=f208c0de-0001-0000-0000-000000000001
U_CARLA=f208c0de-0001-0000-0000-000000000002
R_LE=f208c0de-0002-0000-0000-000000000001     # Pedro: igreja toda, editar célula e relatórios
R_PC=f208c0de-0002-0000-0000-000000000002     # Carla: só "Enviar Relatório das Próprias Células"
M_PASTOR=f208c0de-0003-0000-0000-000000000001
M_PEDRO=f208c0de-0003-0000-0000-000000000002
M_CARLA=f208c0de-0003-0000-0000-000000000003
M_ANDRE=f208c0de-0003-0000-0000-000000000004
M_CAIO=f208c0de-0003-0000-0000-000000000005
C1=f208c0de-0004-0000-0000-000000000001
C2=f208c0de-0004-0000-0000-000000000002
R1=f208c0de-0005-0000-0000-000000000001

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id::text LIKE 'f208c0de%');
DELETE FROM public.cell_reports WHERE id::text LIKE 'f208c0de%' OR cell_id::text LIKE 'f208c0de%';
DELETE FROM public.cells WHERE id::text LIKE 'f208c0de%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f208c0de%';
DELETE FROM public.members WHERE id::text LIKE 'f208c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f208c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f208c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f208c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f208c0de%' OR actor_user_id::text LIKE 'f208c0de%';
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
  ('$U_PEDRO', 'e208-conc-1@teste.invalid'), ('$U_CARLA', 'e208-conc-2@teste.invalid');
INSERT INTO public.roles (id, name) VALUES ('$R_LE', 'E208 Conc LE'), ('$R_PC', 'E208 Conc PC');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('$R_LE', 'view_all_church'), ('$R_LE', 'edit_cell'), ('$R_LE', 'edit_cell_report'), ('$R_LE', 'view_all_reports'),
  ('$R_PC', 'submit_own_cell_report');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES
  ('$M_PASTOR', 'E208 Conc Pastor', 'M', true, false, '$M_PASTOR@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, email) VALUES
  ('$M_PEDRO', 'E208 Conc Pedro', 'M', '$M_PASTOR', true, '$U_PEDRO', '$R_LE', '$M_PEDRO@teste.invalid'),
  ('$M_CARLA', 'E208 Conc Carla', 'F', '$M_PASTOR', true, '$U_CARLA', '$R_PC', '$M_CARLA@teste.invalid'),
  ('$M_ANDRE', 'E208 Conc Andre', 'M', '$M_PASTOR', true, NULL, NULL, '$M_ANDRE@teste.invalid'),
  ('$M_CAIO',  'E208 Conc Caio',  'M', '$M_PASTOR', true, NULL, NULL, '$M_CAIO@teste.invalid');
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
is_inactive_refusal() {
  grep -q '"code": "cell_inactive"' "$1" && grep -q 'Esta célula está inativa e não recebe relatórios.' "$1" && echo true || echo false
}
# A sessão B esperou a A (entrou 1 s depois; a A segura por $HOLD s).
waited() { echo "$(cat "$1.t") >= $HOLD - 1 - 0.3" | bc | sed 's/1/true/;s/0/false/'; }
no_wait() { echo "$(cat "$1.t") < 1.5" | bc | sed 's/1/true/;s/0/false/'; }

show() {
  echo "  sessão A: $(outcome "$TMP/$1.A") ($(cut -c1-4 "$TMP/$1.A.t") s)"
  echo "  sessão B: $(outcome "$TMP/$1.B") ($(cut -c1-4 "$TMP/$1.B.t") s)"
}


INS_C1="INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme) VALUES ('$C1', public.sp_today(), '23:59', true, 'conc');"
INACTIVATE="UPDATE public.cells SET is_active = false WHERE id = '$C1';"
REACTIVATE="UPDATE public.cells SET is_active = true WHERE id = '$C1';"
COUNT_C1="SELECT count(*) FROM public.cell_reports WHERE cell_id = '$C1' AND deleted_at IS NULL"

# ---------------------------------------------------------------------------
echo "== 1. Inativação segura × lançamento de Carla"
base
pair s1 "$U_PEDRO" "BEGIN; $INACTIVATE SELECT pg_sleep($HOLD); COMMIT;" \
        "$U_CARLA" "$INS_C1"
show s1
check "A inativa C1" "SELECT $(is_ok "$TMP/s1.A")"
check "B esperou a inativação" "SELECT $(waited "$TMP/s1.B")"
check "B recebe cell_inactive, com a mensagem do spec" "SELECT $(is_inactive_refusal "$TMP/s1.B")"
check "nenhum relatório em C1; C1 inativa" "SELECT ($COUNT_C1) = 0 AND NOT (SELECT is_active FROM public.cells WHERE id = '$C1')"

# ---------------------------------------------------------------------------
echo "== 2. Lançamento seguro de Carla × inativação"
base
pair s2 "$U_CARLA" "BEGIN; $INS_C1 SELECT pg_sleep($HOLD); COMMIT;" \
        "$U_PEDRO" "$INACTIVATE"
show s2
check "A lança o relatório" "SELECT $(is_ok "$TMP/s2.A")"
check "B (inativação) esperou o lançamento" "SELECT $(waited "$TMP/s2.B")"
check "B inativa C1" "SELECT $(is_ok "$TMP/s2.B")"
check "no fim, o relatório existe e C1 está inativa (RN-11 d)" "SELECT ($COUNT_C1) = 1 AND NOT (SELECT is_active FROM public.cells WHERE id = '$C1')"

# ---------------------------------------------------------------------------
echo "== 3a. Inativação de C1 segura × troca da célula de um relatório de C2 para C1"
base
q "INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES ('$R1', '$C2', public.sp_today(), '23:59', true, 'R1')" >/dev/null
pair s3a "$U_PEDRO" "BEGIN; $INACTIVATE SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_PEDRO" "UPDATE public.cell_reports SET cell_id = '$C1' WHERE id = '$R1';"
show s3a
check "A inativa C1" "SELECT $(is_ok "$TMP/s3a.A")"
check "B esperou a inativação" "SELECT $(waited "$TMP/s3a.B")"
check "B recebe cell_inactive" "SELECT $(is_inactive_refusal "$TMP/s3a.B")"
check "o relatório continua em C2" "SELECT cell_id = '$C2' FROM public.cell_reports WHERE id = '$R1'"

echo "== 3b. Troca da célula segura × inativação de C1"
base
q "INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES ('$R1', '$C2', public.sp_today(), '23:59', true, 'R1')" >/dev/null
pair s3b "$U_PEDRO" "BEGIN; UPDATE public.cell_reports SET cell_id = '$C1' WHERE id = '$R1'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_PEDRO" "$INACTIVATE"
show s3b
check "A troca a célula do relatório" "SELECT $(is_ok "$TMP/s3b.A")"
check "B (inativação) esperou a troca" "SELECT $(waited "$TMP/s3b.B")"
check "B inativa C1" "SELECT $(is_ok "$TMP/s3b.B")"
check "no fim, o relatório é de C1 e C1 está inativa" \
  "SELECT (SELECT cell_id = '$C1' FROM public.cell_reports WHERE id = '$R1') AND NOT (SELECT is_active FROM public.cells WHERE id = '$C1')"

# ---------------------------------------------------------------------------
echo "== 4. Reativação segura × lançamento de Carla"
base
q "$INACTIVATE" >/dev/null
pair s4 "$U_PEDRO" "BEGIN; $REACTIVATE SELECT pg_sleep($HOLD); COMMIT;" \
        "$U_CARLA" "$INS_C1"
show s4
check "A reativa C1" "SELECT $(is_ok "$TMP/s4.A")"
check "B esperou a reativação" "SELECT $(waited "$TMP/s4.B")"
check "B é aceito" "SELECT $(is_ok "$TMP/s4.B")"
check "o relatório existe e C1 está ativa" "SELECT ($COUNT_C1) = 1 AND (SELECT is_active FROM public.cells WHERE id = '$C1')"

# ---------------------------------------------------------------------------
echo "== 5a. Troca do tema segura × inativação (sem espera)"
base
q "INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES ('$R1', '$C1', public.sp_today(), '23:59', true, 'R1')" >/dev/null
pair s5a "$U_PEDRO" "BEGIN; UPDATE public.cell_reports SET theme = 'novo tema' WHERE id = '$R1'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_PEDRO" "$INACTIVATE"
show s5a
check "A muda o tema" "SELECT $(is_ok "$TMP/s5a.A")"
check "B inativa C1 sem esperar" "SELECT $(is_ok "$TMP/s5a.B") AND $(no_wait "$TMP/s5a.B")"
check "no fim, o tema mudou e C1 está inativa" \
  "SELECT (SELECT theme = 'novo tema' FROM public.cell_reports WHERE id = '$R1') AND NOT (SELECT is_active FROM public.cells WHERE id = '$C1')"

echo "== 5b. Inativação segura × troca do tema (sem espera)"
base
q "INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES ('$R1', '$C1', public.sp_today(), '23:59', true, 'R1')" >/dev/null
pair s5b "$U_PEDRO" "BEGIN; $INACTIVATE SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_PEDRO" "UPDATE public.cell_reports SET theme = 'novo tema' WHERE id = '$R1';"
show s5b
check "A inativa C1" "SELECT $(is_ok "$TMP/s5b.A")"
check "B muda o tema sem esperar (RN-11 d)" "SELECT $(is_ok "$TMP/s5b.B") AND $(no_wait "$TMP/s5b.B")"
check "no fim, o tema mudou e C1 está inativa" \
  "SELECT (SELECT theme = 'novo tema' FROM public.cell_reports WHERE id = '$R1') AND NOT (SELECT is_active FROM public.cells WHERE id = '$C1')"

# ---------------------------------------------------------------------------
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: todos os cenários passaram"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
