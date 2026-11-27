#!/usr/bin/env bash
# E2.01 (exclusão lógica): cenários de concorrência com duas conexões reais.
# Spec: docs/specs/e2-01-exclusao-logica.md (repositório apps-mci), "Bloqueios e
# concorrência" e "Verificações obrigatórias (para o QA)", RN-20.
#
# Cada cenário abre duas sessões do psql em paralelo. A primeira segura a trava
# com pg_sleep; a segunda começa no meio e precisa esperar. No fim, o estado é
# conferido: só uma das operações vale, a outra recebe a mensagem amigável (ou
# 40P01 nos casos aceitos pelo spec), e nada aponta para um excluído (RN-06).
#
#   1. duas exclusões do mesmo membro: uma esperando a outra; as duas no mesmo
#      instante (líder do membro = um terceiro); e as duas no mesmo instante
#      quando um dos administradores é o líder do membro (1c);
#   2. exclusão de Gil × Gil escolhido como líder de Hugo, nas duas ordens;
#   3. dois administradores que se excluem (em sequência e ao mesmo tempo);
#   4. restauração de relatório × relatório novo na mesma semana, nas duas ordens;
#   5. restauração de célula × exclusão do anfitrião, nas duas ordens;
#   6. (extra) restauração de Bruno × exclusão do líder dele, nas duas ordens.
#
# Usa só dados fictícios, gravados (as duas sessões precisam enxergá-los) e
# apagados no fim, mesmo se o script for interrompido.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e201_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e201conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f201c0de-<tipo>-...
U1=f201c0de-0001-0000-0000-000000000001   # AD Ana (auth)
U2=f201c0de-0001-0000-0000-000000000002   # AD Beto (auth)
U3=f201c0de-0001-0000-0000-000000000003   # LE Lia (auth)
RAD=f201c0de-0002-0000-0000-000000000001
RLE=f201c0de-0002-0000-0000-000000000002
M_AD1=f201c0de-0003-0000-0000-000000000001
M_AD2=f201c0de-0003-0000-0000-000000000002
M_LE=f201c0de-0003-0000-0000-000000000003
M_PASTOR=f201c0de-0003-0000-0000-000000000010
M_BRUNO=f201c0de-0003-0000-0000-000000000020
M_GIL=f201c0de-0003-0000-0000-000000000021
M_HUGO=f201c0de-0003-0000-0000-000000000022
M_OLD=f201c0de-0003-0000-0000-000000000023   # líder anterior de Hugo
M_HOST=f201c0de-0003-0000-0000-000000000024
M_LEADER=f201c0de-0003-0000-0000-000000000025
C1=f201c0de-0004-0000-0000-000000000001
R1=f201c0de-0005-0000-0000-000000000001
R2=f201c0de-0005-0000-0000-000000000002

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.cell_report_participants WHERE report_id::text LIKE 'f201c0de%' OR member_id::text LIKE 'f201c0de%';
DELETE FROM public.cell_reports WHERE id::text LIKE 'f201c0de%' OR cell_id::text LIKE 'f201c0de%';
DELETE FROM public.cells WHERE id::text LIKE 'f201c0de%';
DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE 'f201c0de%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f201c0de%';  -- E2.04: CHECK de liderança
DELETE FROM public.members WHERE id::text LIKE 'f201c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f201c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f201c0de%';
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f201c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f201c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f201c0de%' OR actor_user_id::text LIKE 'f201c0de%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Base: dois administradores, uma LE e um pastor. Cada cenário cria o resto.
base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('$U1', 'e201-conc-1@teste.invalid'), ('$U2', 'e201-conc-2@teste.invalid'), ('$U3', 'e201-conc-3@teste.invalid');
INSERT INTO public.roles (id, name) VALUES ('$RAD', 'E201 Conc AD'), ('$RLE', 'E201 Conc LE');
INSERT INTO public.role_permissions (role_id, permission)
SELECT '$RAD', p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('$RLE', 'view_all_church'), ('$RLE', 'edit_member'), ('$RLE', 'delete_member'), ('$RLE', 'edit_cell'),
  ('$RLE', 'create_cell'), ('$RLE', 'delete_cell'), ('$RLE', 'delete_cell_report'), ('$RLE', 'edit_cell_report');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES
  ('$M_PASTOR', 'E201 Conc Pastor', 'M', true, false, '$M_PASTOR@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, email) VALUES
  ('$M_AD1', 'E201 Conc Ana Admin',  'F', '$M_PASTOR', true, '$U1', '$RAD', '$M_AD1@teste.invalid'),
  ('$M_AD2', 'E201 Conc Beto Admin', 'M', '$M_PASTOR', true, '$U2', '$RAD', '$M_AD2@teste.invalid'),
  ('$M_LE',  'E201 Conc Lia LE',     'F', '$M_PASTOR', true, '$U3', '$RLE', '$M_LE@teste.invalid'),
  ('$M_OLD', 'E201 Conc Olavo',      'M', '$M_PASTOR', true, NULL,  NULL, '$M_OLD@teste.invalid');
COMMIT;
SQL
}

# Sessão como o usuário do Auth $1 (vazio = postgres), com o SQL $2.
session() {
  {
    echo '\set VERBOSITY verbose'
    if [ -n "$1" ]; then
      echo "SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false) \\g /dev/null"
      echo "SET ROLE authenticated;"
    fi
    echo "$2"
  } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
}

# Duas sessões: a primeira começa, a segunda entra $5 segundos depois.
pair() { # nome uidA sqlA uidB sqlB [atraso]
  ( session "$2" "$3" > "$TMP/$1.A" ) &
  sleep "${6:-1}"
  ( session "$4" "$5" > "$TMP/$1.B" ) &
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

invariant() {
  check "RN-06: nada da massa aponta para um excluído" "
    SELECT NOT EXISTS (
      SELECT 1 FROM public.members m JOIN public.members x ON x.id IN (m.leader_id, m.spouse_id)
       WHERE m.id::text LIKE 'f201c0de%' AND m.deleted_at IS NULL AND x.deleted_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.cells c JOIN public.members x ON x.id IN (c.leader_id, c.timothy_id, c.host_id)
       WHERE c.id::text LIKE 'f201c0de%' AND c.deleted_at IS NULL AND x.deleted_at IS NOT NULL)"
}

show() { echo "  sessão A: $(outcome "$TMP/$1.A")"; echo "  sessão B: $(outcome "$TMP/$1.B")"; }

WEEK="public.week_start(public.sp_today())"

# ---------------------------------------------------------------------------
echo "== 1. Duas exclusões do mesmo membro (A segura a trava; B espera)"
base
q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES ('$M_BRUNO', 'E201 Conc Bruno', 'M', '$M_AD1', true, '$M_BRUNO@teste.invalid')" >/dev/null
pair s1 "$U1" "BEGIN; SELECT public.delete_member('$M_BRUNO'); SELECT pg_sleep($HOLD); COMMIT;" \
        "$U2" "SELECT public.delete_member('$M_BRUNO');"
show s1
check "A exclui Bruno" "SELECT $([[ "$(outcome "$TMP/s1.A")" == OK* ]] && echo true || echo false)"
check "B recebe not_found_or_deleted (\"Este cadastro não existe ou já foi excluído.\")" \
  "SELECT $(grep -q 'not_found_or_deleted' "$TMP/s1.B" && grep -q 'Este cadastro não existe ou já foi excluído.' "$TMP/s1.B" && echo true || echo false)"
check "só a primeira exclusão vale: autor = Ana" "SELECT deleted_by = '$M_AD1' FROM public.members WHERE id = '$M_BRUNO'"
check "um evento de exclusão só" "SELECT count(*) = 1 FROM public.events WHERE entity_id = '$M_BRUNO' AND action = 'delete'"
invariant

# Duas exclusões de Bruno no mesmo instante, $2 rodadas; o líder de Bruno é $1.
same_instant_deletes() {
  local leader=$1 rounds=$2 label=$3 i pair_out deadlocks=0
  for i in $(seq 1 "$rounds"); do
    base
    q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES ('$M_BRUNO', 'E201 Conc Bruno', 'M', '$leader', true, '$M_BRUNO@teste.invalid')" >/dev/null
    T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
    pair s1b "$U1" "SELECT pg_sleep_until('$T'); SELECT public.delete_member('$M_BRUNO');" \
             "$U2" "SELECT pg_sleep_until('$T'); SELECT public.delete_member('$M_BRUNO');" 0
    pair_out="$(outcome "$TMP/s1b.A" | cut -c1-5)/$(outcome "$TMP/s1b.B" | cut -c1-5)"
    echo "  rodada $i: A=$(outcome "$TMP/s1b.A" | cut -c1-45) / B=$(outcome "$TMP/s1b.B" | cut -c1-45)"
    check "$label, rodada $i: estado válido (uma exclusão, um evento)" \
      "SELECT (SELECT count(*) FROM public.events WHERE entity_id = '$M_BRUNO' AND action = 'delete') = 1
          AND (SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_BRUNO')"
    check "$label, rodada $i: a segunda recebe not_found_or_deleted (sem 40P01)" \
      "SELECT $( { [ "$pair_out" = "OK/22023" ] || [ "$pair_out" = "22023/OK" ]; } && grep -qh 'not_found_or_deleted' "$TMP/s1b.A" "$TMP/s1b.B" && echo true || echo false)"
  done
}
echo "== 1b. Duas exclusões do mesmo membro no mesmo instante; o líder dele é um terceiro (5 rodadas)"
same_instant_deletes "$M_OLD" 5 "1b"
echo "== 1c. Idem, mas a administradora Ana (sessão A) é a líder do membro (10 rodadas)"
same_instant_deletes "$M_AD1" 10 "1c"

# ---------------------------------------------------------------------------
echo "== 2a. Exclusão de Gil (trava primeiro) × Gil como líder de Hugo"
base
q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES
     ('$M_GIL', 'E201 Conc Gil', 'M', '$M_AD1', true, '$M_GIL@teste.invalid'), ('$M_HUGO', 'E201 Conc Hugo', 'M', '$M_OLD', true, '$M_HUGO@teste.invalid')" >/dev/null
pair s2a "$U1" "BEGIN; SELECT public.delete_member('$M_GIL'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U3" "UPDATE public.members SET leader_id = '$M_GIL' WHERE id = '$M_HUGO';"
show s2a
check "Gil é excluído" "SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_GIL'"
check "a troca de líder é recusada com deleted_member_chosen (RN-06)" \
  "SELECT $(grep -q '"code": "deleted_member_chosen"' "$TMP/s2a.B" && echo true || echo false)"
check "Hugo continua com o líder anterior" "SELECT leader_id = '$M_OLD' FROM public.members WHERE id = '$M_HUGO'"
invariant

echo "== 2b. Gil como líder de Hugo (trava primeiro) × exclusão de Gil"
base
q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES
     ('$M_GIL', 'E201 Conc Gil', 'M', '$M_AD1', true, '$M_GIL@teste.invalid'), ('$M_HUGO', 'E201 Conc Hugo', 'M', '$M_OLD', true, '$M_HUGO@teste.invalid')" >/dev/null
pair s2b "$U3" "BEGIN; UPDATE public.members SET leader_id = '$M_GIL' WHERE id = '$M_HUGO'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U1" "SELECT public.delete_member('$M_GIL');"
show s2b
check "Hugo passa a ter Gil como líder" "SELECT leader_id = '$M_GIL' FROM public.members WHERE id = '$M_HUGO'"
check "a exclusão de Gil é recusada com member_has_links (RN-04), listando Hugo" \
  "SELECT $(grep -q '"code": "member_has_links"' "$TMP/s2b.B" && grep -q "$M_HUGO" "$TMP/s2b.B" && echo true || echo false)"
check "Gil não é excluído" "SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_GIL'"
invariant

# ---------------------------------------------------------------------------
echo "== 3. Dois administradores que se excluem (A trava primeiro)"
base
pair s3 "$U1" "BEGIN; SELECT public.delete_member('$M_AD2'); SELECT pg_sleep($HOLD); COMMIT;" \
        "$U2" "SELECT public.delete_member('$M_AD1');"
show s3
check "Ana exclui Beto" "SELECT deleted_at IS NOT NULL AND deleted_by = '$M_AD1' FROM public.members WHERE id = '$M_AD2'"
check "Beto, excluído na espera, recebe 42501 (DT-21)" "SELECT $(grep -q '42501' "$TMP/s3.B" && echo true || echo false)"
check "Ana continua (sempre sobra um administrador)" "SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_AD1'"
invariant

echo "== 3b. Dois administradores que se excluem no mesmo instante (5 rodadas)"
for i in 1 2 3 4 5; do
  base
  T=$(q "SELECT (clock_timestamp() + interval '2 seconds')::text")
  pair s3b "$U1" "SELECT pg_sleep_until('$T'); SELECT public.delete_member('$M_AD2');" \
           "$U2" "SELECT pg_sleep_until('$T'); SELECT public.delete_member('$M_AD1');" 0
  echo "  rodada $i: A=$(outcome "$TMP/s3b.A" | cut -c1-50) / B=$(outcome "$TMP/s3b.B" | cut -c1-50)"
  check "rodada $i: exatamente um dos dois excluído; o outro recebe 42501" \
    "SELECT (SELECT count(*) FROM public.members WHERE id IN ('$M_AD1', '$M_AD2') AND deleted_at IS NOT NULL) = 1
        AND $(grep -q '42501' "$TMP/s3b.A" "$TMP/s3b.B" && ! grep -q '40P01' "$TMP/s3b.A" "$TMP/s3b.B" && echo true || echo false)"
done

# ---------------------------------------------------------------------------
echo "== 4a. Restauração do relatório R (trava primeiro) × relatório S na mesma semana"
base
q "INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
     VALUES ('$C1', '$M_OLD', '$M_OLD', '$M_OLD', 'Evangelística', 'Domingo', '00:00');
   SET LOCAL mci.cell_report_write = 'on';  -- E2.11 (DA-11): a massa grava direto, com a marca
   INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, offering)
     VALUES ('$R1', '$C1', $WEEK, '00:00', 'R', true, 0)" >/dev/null
session "$U1" "SELECT public.delete_cell_report('$R1');" >/dev/null
pair s4a "$U1" "BEGIN; SELECT public.restore_cell_report('$R1'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U3" "SELECT * FROM public.submit_cell_report('$R2', jsonb_build_object('cell_id', '$C1', 'date', $WEEK, 'time', '00:00', 'theme', 'S', 'offering', 0));"
show s4a
check "R é restaurado" "SELECT deleted_at IS NULL FROM public.cell_reports WHERE id = '$R1'"
check "S é recusado com report_week_taken (E2.11: o lançamento é pela submit_cell_report)" \
  "SELECT $(grep -q '"code": "report_week_taken"' "$TMP/s4a.B" && grep -q 'O relatório para esta semana já foi enviado.' "$TMP/s4a.B" && echo true || echo false)"
check "só um relatório não excluído na semana" \
  "SELECT count(*) = 1 FROM public.cell_reports WHERE cell_id = '$C1' AND deleted_at IS NULL"

echo "== 4b. Relatório S (trava primeiro) × restauração do relatório R na mesma semana"
base
q "INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
     VALUES ('$C1', '$M_OLD', '$M_OLD', '$M_OLD', 'Evangelística', 'Domingo', '00:00');
   SET LOCAL mci.cell_report_write = 'on';  -- E2.11 (DA-11): a massa grava direto, com a marca
   INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, offering)
     VALUES ('$R1', '$C1', $WEEK, '00:00', 'R', true, 0)" >/dev/null
session "$U1" "SELECT public.delete_cell_report('$R1');" >/dev/null
pair s4b "$U3" "BEGIN; SELECT * FROM public.submit_cell_report('$R2', jsonb_build_object('cell_id', '$C1', 'date', $WEEK, 'time', '00:00', 'theme', 'S', 'offering', 0)); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U1" "SELECT public.restore_cell_report('$R1');"
show s4b
check "S é gravado" "SELECT deleted_at IS NULL FROM public.cell_reports WHERE id = '$R2'"
check "a restauração de R é recusada com restore_week_taken, apontando S" \
  "SELECT $(grep -q '"code": "restore_week_taken"' "$TMP/s4b.B" && grep -q "$R2" "$TMP/s4b.B" && echo true || echo false)"
check "R continua excluído; só um relatório não excluído na semana" \
  "SELECT (SELECT deleted_at IS NOT NULL FROM public.cell_reports WHERE id = '$R1')
      AND (SELECT count(*) = 1 FROM public.cell_reports WHERE cell_id = '$C1' AND deleted_at IS NULL)"

# ---------------------------------------------------------------------------
setup5() {
  base
  q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES
       ('$M_HOST', 'E201 Conc Quintino', 'M', '$M_AD1', true, '$M_HOST@teste.invalid'), ('$M_LEADER', 'E201 Conc Rui', 'M', '$M_AD1', true, '$M_LEADER@teste.invalid');
     INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time)
       VALUES ('$C1', '$M_LEADER', '$M_LEADER', '$M_HOST', 'Evangelística', 'Terça', '20:00')" >/dev/null
  session "$U1" "SELECT public.delete_cell('$C1');" >/dev/null
}
echo "== 5a. Exclusão do anfitrião (trava primeiro) × restauração da célula"
setup5
pair s5a "$U1" "BEGIN; SELECT public.delete_member('$M_HOST'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U2" "SELECT public.restore_cell('$C1');"
show s5a
check "o anfitrião é excluído" "SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_HOST'"
check "a restauração relê e recusa com restore_person_deleted" \
  "SELECT $(grep -q '"code": "restore_person_deleted"' "$TMP/s5a.B" && echo true || echo false)"
check "a célula continua excluída" "SELECT deleted_at IS NOT NULL FROM public.cells WHERE id = '$C1'"
invariant

echo "== 5b. Restauração da célula (trava primeiro) × exclusão do anfitrião"
setup5
pair s5b "$U2" "BEGIN; SELECT public.restore_cell('$C1'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U1" "SELECT public.delete_member('$M_HOST');"
show s5b
check "a célula é restaurada" "SELECT deleted_at IS NULL FROM public.cells WHERE id = '$C1'"
check "a exclusão do anfitrião encontra a célula e recusa com member_has_links (RN-04)" \
  "SELECT $(grep -q '"code": "member_has_links"' "$TMP/s5b.B" && grep -q "$C1" "$TMP/s5b.B" && echo true || echo false)"
check "o anfitrião não é excluído" "SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_HOST'"
invariant

# ---------------------------------------------------------------------------
setup6() {
  base
  q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES ('$M_GIL', 'E201 Conc Gil', 'M', '$M_AD1', true, '$M_GIL@teste.invalid');
     INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES ('$M_BRUNO', 'E201 Conc Bruno', 'M', '$M_GIL', true, '$M_BRUNO@teste.invalid')" >/dev/null
  session "$U1" "SELECT public.delete_member('$M_BRUNO');" >/dev/null
}
echo "== 6a. (extra) Exclusão do líder Gil (trava primeiro) × restauração de Bruno"
setup6
pair s6a "$U1" "BEGIN; SELECT public.delete_member('$M_GIL'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U2" "SELECT * FROM public.restore_member('$M_BRUNO');"
show s6a
check "Gil é excluído e Bruno volta sem líder (DA-3)" \
  "SELECT (SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_GIL')
      AND (SELECT deleted_at IS NULL AND leader_id IS NULL AND NOT has_leadership FROM public.members WHERE id = '$M_BRUNO')"
invariant

echo "== 6b. (extra) Restauração de Bruno (trava primeiro) × exclusão do líder Gil"
setup6
pair s6b "$U2" "BEGIN; SELECT * FROM public.restore_member('$M_BRUNO'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U1" "SELECT public.delete_member('$M_GIL');"
show s6b
check "Bruno volta com o líder Gil e a exclusão de Gil é recusada (member_has_links)" \
  "SELECT (SELECT deleted_at IS NULL AND leader_id = '$M_GIL' FROM public.members WHERE id = '$M_BRUNO')
      AND (SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_GIL')
      AND $(grep -q '"code": "member_has_links"' "$TMP/s6b.B" && echo true || echo false)"
invariant

# ---------------------------------------------------------------------------
cleanup
check "limpeza: nenhum dado do script ficou no banco" \
  "SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE 'f201c0de%')
        + (SELECT count(*) FROM public.cells WHERE id::text LIKE 'f201c0de%')
        + (SELECT count(*) FROM public.cell_reports WHERE id::text LIKE 'f201c0de%')
        + (SELECT count(*) FROM auth.users WHERE id::text LIKE 'f201c0de%')
        + (SELECT count(*) FROM public.roles WHERE id::text LIKE 'f201c0de%')
        + (SELECT count(*) FROM public.events WHERE entity_id::text LIKE 'f201c0de%' OR actor_user_id::text LIKE 'f201c0de%') = 0"

echo
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: todos os cenários terminaram num estado válido"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
