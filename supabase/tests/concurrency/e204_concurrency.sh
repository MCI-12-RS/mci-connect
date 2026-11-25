#!/usr/bin/env bash
# E2.04 (validações de membro): cenários de concorrência com conexões reais.
# Spec: docs/specs/e2-04-validacoes-membro.md (repositório apps-mci), "Bloqueios e concorrência"
# e "Verificações obrigatórias (para o QA)", RN-09, RN-13, DT-07, DT-08, DT-25.
#
# Cada cenário abre duas ou três sessões do psql em paralelo. Quando o cenário pede, a primeira
# segura a trava com pg_sleep e a segunda entra no meio; nos cenários "no mesmo instante", todas
# dormem até o mesmo pg_sleep_until. No fim, o estado é conferido e private.member_rule_violations()
# precisa estar sem linhas da massa.
#
#   1. dois INSERTs com o mesmo CPF: um aceito, o outro com value_in_use, sem 23505
#      (1a: A segura a trava; 1b: no mesmo instante, 5 rodadas);
#   2. Lúcia → Paulo × Paulo → Lúcia: um aceito; o outro leader_cycle ou 40P01 (DT-25); nunca os
#      dois aceitos (2a: A segura; 2b: no mesmo instante, 8 rodadas);
#   3. A → B, B → C e C → A em três conexões ao mesmo tempo (6 rodadas): no máximo duas aceitas;
#   4. restauração de Bruno × cadastro com o celular equivalente, nas duas ordens;
#   5. Caio troca o e-mail × cadastro com o e-mail antigo (em sequência e no mesmo instante).
#
# Usa só dados fictícios (f204c0de-...), gravados (as sessões precisam enxergá-los) e apagados no
# fim, mesmo se o script for interrompido.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e204_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e204conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

U_ANA=f204c0de-0001-0000-0000-000000000001
U_RITA=f204c0de-0001-0000-0000-000000000002
R_AD=f204c0de-0002-0000-0000-000000000001
M_PAS=f204c0de-0003-0000-0000-000000000001
M_ANA=f204c0de-0003-0000-0000-000000000002
M_RITA=f204c0de-0003-0000-0000-000000000003
M_LUCIA=f204c0de-0003-0000-0000-000000000011
M_PAULO=f204c0de-0003-0000-0000-000000000012
M_A=f204c0de-0003-0000-0000-000000000021
M_B=f204c0de-0003-0000-0000-000000000022
M_C=f204c0de-0003-0000-0000-000000000023
M_BRUNO=f204c0de-0003-0000-0000-000000000031
M_CAIO=f204c0de-0003-0000-0000-000000000041

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL WHERE id::text LIKE 'f204c0de%' OR name LIKE 'E204 Conc%';
DELETE FROM public.members WHERE id::text LIKE 'f204c0de%' OR name LIKE 'E204 Conc%';
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f204c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f204c0de%';
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f204c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f204c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f204c0de%' OR actor_user_id::text LIKE 'f204c0de%' OR entity_label LIKE 'E204 Conc%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Base: dois administradores (todas as permissões, menos as do E1.08 que não importam) e um pastor.
base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('$U_ANA', 'e204-conc-1@teste.invalid'), ('$U_RITA', 'e204-conc-2@teste.invalid');
INSERT INTO public.roles (id, name) VALUES ('$R_AD', 'E204 Conc AD');
INSERT INTO public.role_permissions (role_id, permission)
SELECT '$R_AD', p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES
  ('$M_PAS', 'E204 Conc Pastor', 'M', true, false, '$M_PAS@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, email) VALUES
  ('$M_ANA',  'E204 Conc Ana Admin',  'F', '$M_PAS', true, '$U_ANA',  '$R_AD', '$M_ANA@teste.invalid'),
  ('$M_RITA', 'E204 Conc Rita Admin', 'F', '$M_PAS', true, '$U_RITA', '$R_AD', '$M_RITA@teste.invalid');
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

# Duas sessões: a primeira começa, a segunda entra $6 segundos depois (padrão 1).
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
# Só a classe do resultado: OK, o code do app_error ou o SQLSTATE.
kind() { local o; o=$(outcome "$1"); if [ "$o" = OK ]; then echo OK; else o=${o%% |*}; echo "${o#* }"; fi; }

check() { # descrição, SQL booleano
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
ok_if() { # descrição, condição de shell
  if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; FAILS=$((FAILS + 1)); fi
}

invariant() {
  check "private.member_rule_violations() sem linhas da massa" "
    SELECT NOT EXISTS (SELECT 1 FROM private.member_rule_violations() v WHERE v.member_id::text LIKE 'f204c0de%')"
}
show() { echo "  sessão A: $(outcome "$TMP/$1.A")"; echo "  sessão B: $(outcome "$TMP/$1.B")"; }
no_unique_violation() { # nome...
  local n bad=0
  for n in "$@"; do grep -qh -E 'ERROR:.*(23505|duplicate key)' "$TMP/$n.A" "$TMP/$n.B" 2>/dev/null && bad=1; done
  [ "$bad" = 0 ]
}
INS() { # id nome campo-extra-colunas valores-extra
  echo "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp$3) VALUES ('$1', '$2', 'F', '$M_ANA', true, '5192043${1: -4}'$4)"
}

# ---------------------------------------------------------------------------
echo "== 1a. Dois cadastros com o mesmo CPF: A segura a trava; B espera e recebe value_in_use"
base
pair s1a "$U_ANA" "BEGIN; $(INS f204c0de-0003-0000-0000-000000000101 'E204 Conc Novo Um' ', cpf' ", '111.444.777-35'"); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_RITA" "$(INS f204c0de-0003-0000-0000-000000000102 'E204 Conc Novo Dois' ', cpf' ", '11144477735'");"
show s1a
ok_if "A é aceito" '[ "$(kind $TMP/s1a.A)" = OK ]'
ok_if "B recebe value_in_use" '[ "$(kind $TMP/s1a.B)" = value_in_use ]'
ok_if "B recebe a mensagem do CPF" "grep -q 'Este CPF já está sendo usado por outro cadastro.' $TMP/s1a.B"
ok_if "nenhum 23505 (o trigger recusa antes do índice)" 'no_unique_violation s1a'
check "um só cadastro com o CPF" "SELECT count(*) = 1 FROM public.members WHERE cpf = '11144477735' AND id::text LIKE 'f204c0de%'"
invariant

echo "== 1b. Dois cadastros com o mesmo CPF no mesmo instante (5 rodadas)"
for i in 1 2 3 4 5; do
  base
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  pair s1b "$U_ANA" "SELECT pg_sleep_until('$T'); $(INS f204c0de-0003-0000-0000-000000000101 'E204 Conc Novo Um' ', cpf' ", '111.444.777-35'");" \
           "$U_RITA" "SELECT pg_sleep_until('$T'); $(INS f204c0de-0003-0000-0000-000000000102 'E204 Conc Novo Dois' ', cpf' ", '11144477735'");" 0
  echo "  rodada $i: A=$(kind $TMP/s1b.A) / B=$(kind $TMP/s1b.B)"
  ok_if "rodada $i: um aceito e o outro value_in_use" \
    '{ [ "$(kind $TMP/s1b.A)" = OK ] && [ "$(kind $TMP/s1b.B)" = value_in_use ]; } || { [ "$(kind $TMP/s1b.B)" = OK ] && [ "$(kind $TMP/s1b.A)" = value_in_use ]; }'
  ok_if "rodada $i: sem 23505" 'no_unique_violation s1b'
  check "rodada $i: um só cadastro com o CPF" "SELECT count(*) = 1 FROM public.members WHERE cpf = '11144477735' AND id::text LIKE 'f204c0de%'"
  invariant
done

# ---------------------------------------------------------------------------
lucia_paulo_base() {
  base
  q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp) VALUES
       ('$M_LUCIA', 'E204 Conc Lucia Prado', 'F', '$M_ANA', true, '51920420011'),
       ('$M_PAULO', 'E204 Conc Paulo Fixo', 'M', '$M_ANA', true, '51920420012')" >/dev/null
}
cycle_check() { # nome rodada
  local a b; a=$(kind "$TMP/$1.A"); b=$(kind "$TMP/$1.B")
  echo "  $2: A=$a / B=$b"
  ok_if "$2: nunca os dois aceitos" '! { [ "$a" = OK ] && [ "$b" = OK ]; }'
  ok_if "$2: um aceito e o outro leader_cycle ou 40P01 (DT-25)" \
    '{ [ "$a" = OK ] && { [ "$b" = leader_cycle ] || [ "$b" = 40P01 ]; }; } || { [ "$b" = OK ] && { [ "$a" = leader_cycle ] || [ "$a" = 40P01 ]; }; }'
  check "$2: não há ciclo entre Lúcia e Paulo" "SELECT NOT ((SELECT leader_id FROM public.members WHERE id = '$M_LUCIA') = '$M_PAULO'
                                               AND (SELECT leader_id FROM public.members WHERE id = '$M_PAULO') = '$M_LUCIA')"
}
echo "== 2a. Lúcia → Paulo (A segura a trava) × Paulo → Lúcia"
lucia_paulo_base
pair s2a "$U_ANA" "BEGIN; UPDATE public.members SET leader_id = '$M_PAULO' WHERE id = '$M_LUCIA'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_RITA" "UPDATE public.members SET leader_id = '$M_LUCIA' WHERE id = '$M_PAULO';"
show s2a
cycle_check s2a "2a"
invariant

echo "== 2b. Lúcia → Paulo × Paulo → Lúcia no mesmo instante (8 rodadas; 40P01 aceito, DT-25)"
for i in 1 2 3 4 5 6 7 8; do
  lucia_paulo_base
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  pair s2b "$U_ANA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET leader_id = '$M_PAULO' WHERE id = '$M_LUCIA';" \
           "$U_RITA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET leader_id = '$M_LUCIA' WHERE id = '$M_PAULO';" 0
  cycle_check s2b "rodada $i"
  invariant
done

# ---------------------------------------------------------------------------
echo "== 3. A → B, B → C e C → A em três conexões ao mesmo tempo (6 rodadas): no máximo duas aceitas"
for i in 1 2 3 4 5 6; do
  base
  q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp) VALUES
       ('$M_A', 'E204 Conc Pessoa A', 'M', '$M_ANA', true, '51920420021'),
       ('$M_B', 'E204 Conc Pessoa B', 'M', '$M_ANA', true, '51920420022'),
       ('$M_C', 'E204 Conc Pessoa C', 'M', '$M_ANA', true, '51920420023')" >/dev/null
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  ( session "$U_ANA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET leader_id = '$M_B' WHERE id = '$M_A';" > "$TMP/s3.A" ) &
  ( session "$U_RITA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET leader_id = '$M_C' WHERE id = '$M_B';" > "$TMP/s3.B" ) &
  ( session "$U_ANA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET leader_id = '$M_A' WHERE id = '$M_C';" > "$TMP/s3.C" ) &
  wait
  ACC=0; for s in A B C; do [ "$(kind "$TMP/s3.$s")" = OK ] && ACC=$((ACC + 1)); done
  echo "  rodada $i: A=$(kind $TMP/s3.A) B=$(kind $TMP/s3.B) C=$(kind $TMP/s3.C)"
  ok_if "rodada $i: no máximo duas aceitas (aceitas: $ACC)" '[ "$ACC" -le 2 ]'
  ok_if "rodada $i: as recusadas são leader_cycle ou 40P01" \
    '! { for s in A B C; do k=$(kind "$TMP/s3.$s"); [ "$k" = OK ] || [ "$k" = leader_cycle ] || [ "$k" = 40P01 ] || echo bad; done; } | grep -q bad'
  check "rodada $i: nenhum ciclo A, B, C" "SELECT NOT EXISTS (SELECT 1 FROM public.members a JOIN public.members b ON b.id = a.leader_id JOIN public.members c ON c.id = b.leader_id
                                                  WHERE a.id IN ('$M_A', '$M_B', '$M_C') AND c.leader_id = a.id)"
  invariant
done

# ---------------------------------------------------------------------------
bruno_base() {
  base
  q "BEGIN; SET LOCAL session_replication_role = replica;
     INSERT INTO public.members (id, name, gender, leader_id, has_leadership, g12_level, mobile_whatsapp, deleted_at)
     VALUES ('$M_BRUNO', 'E204 Conc Bruno Alves', 'M', '$M_ANA', true, 2, '5188880000', now()); COMMIT;" >/dev/null
}
echo "== 4a. Restaurar Bruno (A segura a trava) × cadastro de Lúcia com (51) 98888-0000"
bruno_base
pair s4a "$U_ANA" "BEGIN; SELECT count(*) FROM public.restore_member('$M_BRUNO'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_RITA" "$(INS f204c0de-0003-0000-0000-000000000103 'E204 Conc Lucia Nova' '' '' | sed "s/'51920[0-9]*'/'(51) 98888-0000'/")"
show s4a
ok_if "A restaura Bruno" '[ "$(kind $TMP/s4a.A)" = OK ]'
ok_if "B recebe value_in_use (o celular pela chave do 9º dígito)" '[ "$(kind $TMP/s4a.B)" = value_in_use ]'
check "Bruno restaurado, sem cadastro duplicado" "SELECT (SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_BRUNO')
  AND (SELECT count(*) = 0 FROM public.members WHERE id = 'f204c0de-0003-0000-0000-000000000103')"
invariant

echo "== 4b. Cadastro de Lúcia (A segura a trava) × restauração de Bruno"
bruno_base
pair s4b "$U_ANA" "BEGIN; $(INS f204c0de-0003-0000-0000-000000000103 'E204 Conc Lucia Nova' '' '' | sed "s/'51920[0-9]*'/'(51) 98888-0000'/"); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_RITA" "SELECT count(*) FROM public.restore_member('$M_BRUNO');"
show s4b
ok_if "A é aceito" '[ "$(kind $TMP/s4b.A)" = OK ]'
ok_if "B recebe restore_value_in_use" '[ "$(kind $TMP/s4b.B)" = restore_value_in_use ]'
check "Bruno continua excluído" "SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_BRUNO'"
invariant

echo "== 4c. Restauração e cadastro no mesmo instante (5 rodadas)"
for i in 1 2 3 4 5; do
  bruno_base
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  pair s4c "$U_ANA" "SELECT pg_sleep_until('$T'); SELECT count(*) FROM public.restore_member('$M_BRUNO');" \
           "$U_RITA" "SELECT pg_sleep_until('$T'); $(INS f204c0de-0003-0000-0000-000000000103 'E204 Conc Lucia Nova' '' '' | sed "s/'51920[0-9]*'/'(51) 98888-0000'/");" 0
  a=$(kind $TMP/s4c.A); b=$(kind $TMP/s4c.B); echo "  rodada $i: restauração=$a / cadastro=$b"
  ok_if "rodada $i: um aceito e o outro com a mensagem dele" \
    '{ [ "$a" = OK ] && [ "$b" = value_in_use ]; } || { [ "$b" = OK ] && [ "$a" = restore_value_in_use ]; }'
  ok_if "rodada $i: sem 23505" 'no_unique_violation s4c'
  invariant
done

# ---------------------------------------------------------------------------
caio_base() {
  base
  q "INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, email) VALUES
       ('$M_CAIO', 'E204 Conc Caio Souza', 'M', '$M_ANA', true, '51920420041', 'e204-caio@teste.invalid')" >/dev/null
}
echo "== 5a. Caio troca o e-mail e comita antes; depois o cadastro com o e-mail antigo é aceito"
caio_base
pair s5a "$U_ANA" "UPDATE public.members SET email = 'e204-caio-novo@teste.invalid' WHERE id = '$M_CAIO';" \
         "$U_RITA" "$(INS f204c0de-0003-0000-0000-000000000104 'E204 Conc Lucia Nova' ', email' ", 'e204-caio@teste.invalid'");" 2
show s5a
ok_if "a troca é aceita" '[ "$(kind $TMP/s5a.A)" = OK ]'
ok_if "o cadastro com o e-mail antigo é aceito" '[ "$(kind $TMP/s5a.B)" = OK ]'
invariant

echo "== 5b. Caio troca o e-mail (A segura) × cadastro com o e-mail antigo no meio da troca"
caio_base
pair s5b "$U_ANA" "BEGIN; UPDATE public.members SET email = 'e204-caio-novo@teste.invalid' WHERE id = '$M_CAIO'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_RITA" "$(INS f204c0de-0003-0000-0000-000000000104 'E204 Conc Lucia Nova' ', email' ", 'e204-caio@teste.invalid'");"
show s5b
ok_if "a troca é aceita" '[ "$(kind $TMP/s5b.A)" = OK ]'
ok_if "o cadastro é aceito ou recebe value_in_use (nunca 23505 sem mensagem amigável)" \
  '[ "$(kind $TMP/s5b.B)" = OK ] || [ "$(kind $TMP/s5b.B)" = value_in_use ]'
invariant

echo "== 5c. Troca e cadastro no mesmo instante (8 rodadas)"
for i in 1 2 3 4 5 6 7 8; do
  caio_base
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  pair s5c "$U_ANA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET email = 'e204-caio-novo@teste.invalid' WHERE id = '$M_CAIO';" \
           "$U_RITA" "SELECT pg_sleep_until('$T'); $(INS f204c0de-0003-0000-0000-000000000104 'E204 Conc Lucia Nova' ', email' ", 'e204-caio@teste.invalid'");" 0
  a=$(kind $TMP/s5c.A); b=$(kind $TMP/s5c.B); echo "  rodada $i: troca=$a / cadastro=$b"
  ok_if "rodada $i: a troca é aceita; o cadastro é aceito ou recebe value_in_use ou 23505 do índice no commit" \
    '[ "$a" = OK ] && { [ "$b" = OK ] || [ "$b" = value_in_use ] || [ "$b" = 23505 ]; }'
  ok_if "rodada $i: nunca dois cadastros com o mesmo e-mail" \
    "[ \"\$(q \"SELECT count(*) FROM public.members WHERE email = 'e204-caio@teste.invalid' AND deleted_at IS NULL\")\" -le 1 ]"
  invariant
done

echo
if [ "$FAILS" = 0 ]; then echo "TUDO OK"; exit 0; else echo "$FAILS FALHA(S)"; exit 1; fi
