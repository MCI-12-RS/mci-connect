#!/usr/bin/env bash
# E2.06 (hierarquia e totais): cenários de concorrência com conexões reais.
# Spec: docs/specs/e2-06-hierarquia-totais.md (repositório apps-mci), "Bloqueios e concorrência" e
# "Verificações obrigatórias (para o QA)", RN-08, DT-05, DT-06.
#
# Cada cenário abre duas sessões do psql: a primeira segura a trava com pg_sleep e a segunda entra no
# meio, nas duas ordens; depois vêm rodadas "no mesmo instante" (as duas dormem até o mesmo
# pg_sleep_until). Cada cenário termina com private.member_hierarchy_drift() vazia para a massa e
# sem 40P01:
#
#   1. troca do líder de Fábio para Tiago × a C4 (célula de Gabriel, discípulo de Fábio) inativada;
#   2. troca de sexo de Gabriel × célula nova de Gabriel;
#   3. inativar Caio × mover André (o líder dele);
#   4. duas células novas na mesma cadeia;
#   5. excluir um discípulo (RPC do E2.01) × mover o líder dele;
#   6. restaurar Zélia (RPC do E2.01) × mover Hugo (ancestral dela);
#   7. duas trocas de líder na mesma subárvore;
#   8. restaurar Bruno (que agora pega a trava da árvore antes das de identificador) × uma gravação
#      que troca o líder e o celular de outra pessoa: sem deadlock (8a com celular diferente, 8b com
#      o mesmo celular de Bruno, em que um dos dois recebe a mensagem do identificador).
#
# Usa só dados fictícios (f206c0de-...), gravados (as sessões precisam enxergá-los) e apagados no
# fim, mesmo se o script for interrompido.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e206_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
ROUNDS=${ROUNDS:-5}    # rodadas "no mesmo instante" por cenário
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e206conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

I() { printf 'f206c0de-%04d-0000-0000-%012d' "$1" "$2"; }
U_ANA=$(I 1 1)
U_RITA=$(I 1 2)
R_AD=$(I 2 1)
M_PAS=$(I 3 1)
M_ANA=$(I 3 2)
M_RITA=$(I 3 3)
M_PEDRO=$(I 3 4)
M_TIAGO=$(I 3 5)
M_ANDRE=$(I 3 6)
M_FABIO=$(I 3 7)
M_GABRIEL=$(I 3 8)
M_CAIO=$(I 3 9)
M_HUGO=$(I 3 10)
M_VANIA=$(I 3 11)
M_ZELIA=$(I 3 12)
M_BRUNO=$(I 3 13)
M_DORA=$(I 3 14)
C4=$(I 4 4)
C5=$(I 4 5)
C6=$(I 4 6)

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM public.cells WHERE id::text LIKE 'f206c0de%';
DELETE FROM private.member_hierarchy WHERE member_id::text LIKE 'f206c0de%';  -- em replica a FK em cascata não roda
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f206c0de%';
DELETE FROM public.members WHERE id::text LIKE 'f206c0de%';
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f206c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f206c0de%';
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f206c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f206c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f206c0de%' OR actor_user_id::text LIKE 'f206c0de%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Massa, com os triggers ligados e na ordem da árvore: pastor; Ana e Rita (administradoras), Pedro e
# Tiago (G12); André sob Pedro; Fábio (inativo) sob André, com Gabriel e a C4 abaixo; Caio sob André;
# Hugo sob Tiago, com Vânia e Zélia (excluída) abaixo; Bruno (excluído) e Dora sob Tiago.
base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('$U_ANA', 'e206-conc-1@teste.invalid'), ('$U_RITA', 'e206-conc-2@teste.invalid');
INSERT INTO public.roles (id, name) VALUES ('$R_AD', 'E206 Conc AD');
INSERT INTO public.role_permissions (role_id, permission)
SELECT '$R_AD', p FROM unnest(enum_range(NULL::public.permission_action)) p
WHERE p NOT IN ('view_members', 'view_own_ministry_dashboard');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  ('$M_PAS', 'E206 Conc Pastor', 'M', true, false, '51920600001');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, mobile_whatsapp) VALUES
  ('$M_ANA',  'E206 Conc Ana Admin',  'F', '$M_PAS', true, '$U_ANA',  '$R_AD', '51920600002'),
  ('$M_RITA', 'E206 Conc Rita Admin', 'F', '$M_PAS', true, '$U_RITA', '$R_AD', '51920600003');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp) VALUES
  ('$M_PEDRO',   'E206 Conc Pedro Lima',   'M', '$M_PAS',    true, true,  '51920600004'),
  ('$M_TIAGO',   'E206 Conc Tiago Reis',   'M', '$M_PAS',    true, true,  '51920600005'),
  ('$M_ANDRE',   'E206 Conc Andre Lima',   'M', '$M_PEDRO',  true, true,  '51920600006'),
  ('$M_FABIO',   'E206 Conc Fabio Lima',   'M', '$M_ANDRE',  true, false, '51920600007'),
  ('$M_GABRIEL', 'E206 Conc Gabriel Lima', 'M', '$M_FABIO',  true, true,  '51920600008'),
  ('$M_CAIO',    'E206 Conc Caio Lima',    'M', '$M_ANDRE',  true, true,  '51920600009'),
  ('$M_HUGO',    'E206 Conc Hugo Reis',    'M', '$M_TIAGO',  true, true,  '51920600010'),
  ('$M_VANIA',   'E206 Conc Vania Reis',   'F', '$M_HUGO',   true, true,  '51920600011'),
  ('$M_ZELIA',   'E206 Conc Zelia Reis',   'F', '$M_VANIA',  true, true,  '51920600012'),
  ('$M_BRUNO',   'E206 Conc Bruno Reis',   'M', '$M_TIAGO',  true, true,  '5188880000'),
  ('$M_DORA',    'E206 Conc Dora Reis',    'F', '$M_TIAGO',  true, true,  '51920600014');
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  ('$C4', '$M_GABRIEL', '$M_ANA', '$M_ANA', 'Evangelística', 'Sexta', '20:00');
UPDATE public.members SET deleted_at = now(), deleted_by = '$M_ANA' WHERE id IN ('$M_ZELIA', '$M_BRUNO');
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
kind() { local o; o=$(outcome "$1"); if [ "$o" = OK ]; then echo OK; else o=${o%% |*}; echo "${o#* }"; fi; }

check() { # descrição, SQL booleano
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
ok_if() { # descrição, condição de shell
  if eval "$2"; then echo "  PASS  $1"; else echo "  FAIL  $1"; FAILS=$((FAILS + 1)); fi
}

# A invariante de todo cenário: nada fora do recálculo do zero, e nenhum 40P01 nas duas sessões.
invariant() { # nome
  check "$1: member_hierarchy_drift() sem linhas da massa" "
    SELECT NOT EXISTS (SELECT 1 FROM private.member_hierarchy_drift() d WHERE d.member_id::text LIKE 'f206c0de%')"
  ok_if "$1: nenhum 40P01 (deadlock)" '! grep -q "40P01" $TMP/$1.A $TMP/$1.B 2>/dev/null'
}

# Roda um cenário: nome, setup extra (função), SQL A, SQL B, kinds aceitos (regex), função de pós-condição.
#   A e B são um comando cada, sem ponto e vírgula no fim.
scn() {
  local n=$1 setup=$2 A=$3 B=$4 allowed=$5 post=$6 ord a b
  for ord in AB BA; do
    base; [ -n "$setup" ] && $setup
    if [ "$ord" = AB ]; then
      pair "$n$ord" "$U_ANA" "BEGIN; $A; SELECT pg_sleep($HOLD); COMMIT;" "$U_RITA" "$B;"
    else
      pair "$n$ord" "$U_ANA" "BEGIN; $B; SELECT pg_sleep($HOLD); COMMIT;" "$U_RITA" "$A;"
    fi
    a=$(kind "$TMP/$n$ord.A"); b=$(kind "$TMP/$n$ord.B")
    echo "  $n, quem segura a trava: $ord (a primeira sessão faz o ${ord:0:1}): sessão 1=$a / sessão 2=$b"
    ok_if "$n $ord: os dois resultados estão entre os esperados ($allowed)" "[[ \"$a\" =~ ^($allowed)\$ ]] && [[ \"$b\" =~ ^($allowed)\$ ]]"
    [ -n "$post" ] && $post "$n $ord"
    invariant "$n$ord"
  done
  for i in $(seq 1 "$ROUNDS"); do
    base; [ -n "$setup" ] && $setup
    local T; T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
    pair "${n}R" "$U_ANA" "SELECT pg_sleep_until('$T'); $A;" "$U_RITA" "SELECT pg_sleep_until('$T'); $B;" 0
    a=$(kind "$TMP/${n}R.A"); b=$(kind "$TMP/${n}R.B")
    echo "  $n, rodada $i no mesmo instante: $a / $b"
    ok_if "$n rodada $i: os dois resultados estão entre os esperados" "[[ \"$a\" =~ ^($allowed)\$ ]] && [[ \"$b\" =~ ^($allowed)\$ ]]"
    [ -n "$post" ] && $post "$n rodada $i"
    invariant "${n}R"
  done
}

NEWCELL() { # id líder
  echo "INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES ('$1', '$2', '$M_ANA', '$M_ANA', 'Evangelística', 'Quarta', '20:00')"
}
MOVE() { echo "UPDATE public.members SET leader_id = '$2' WHERE id = '$1'"; }

# ---------------------------------------------------------------------------
post1() {
  check "$1: Fábio ficou sob Tiago (nível 2) e a C4 inativa deixou Tiago, Pedro e o pastor com 0 células" "
    SELECT (SELECT g12_level = 2 AND ancestor_ids = ARRAY['$M_PAS', '$M_TIAGO']::uuid[] FROM private.member_hierarchy WHERE member_id = '$M_FABIO')
       AND (SELECT sum(total_cells) = 0 FROM private.member_hierarchy WHERE member_id IN ('$M_TIAGO', '$M_PEDRO', '$M_PAS', '$M_FABIO', '$M_GABRIEL'))"
}
echo "== 1. Troca do líder de Fábio para Tiago × C4 inativada (as duas ordens e $ROUNDS rodadas no mesmo instante)"
scn s1 "" "$(MOVE "$M_FABIO" "$M_TIAGO")" "UPDATE public.cells SET is_active = false WHERE id = '$C4'" "OK" post1

post2() {
  check "$1: Gabriel é feminino e tem 2 células femininas (a C4 e a nova); Fábio, André, Pedro e o pastor somam 2" "
    SELECT (SELECT male_cells = 0 AND female_cells = 2 AND total_cells = 2 FROM private.member_hierarchy WHERE member_id = '$M_GABRIEL')
       AND (SELECT bool_and(total_cells = 2 AND female_cells = 2 AND male_cells = 0) FROM private.member_hierarchy WHERE member_id IN ('$M_FABIO', '$M_ANDRE', '$M_PEDRO', '$M_PAS'))"
}
echo "== 2. Troca de sexo de Gabriel × célula nova de Gabriel"
scn s2 "" "UPDATE public.members SET gender = 'F' WHERE id = '$M_GABRIEL'" "$(NEWCELL "$C5" "$M_GABRIEL")" "OK" post2

post3() {
  check "$1: Caio inativo e André sob Tiago: Pedro sem discípulos e Tiago com 5 (Hugo, Vânia, Dora, André e Gabriel; Fábio e Caio são inativos)" "
    SELECT (SELECT total_disciples = 0 FROM private.member_hierarchy WHERE member_id = '$M_PEDRO')
       AND (SELECT total_disciples = 5 FROM private.member_hierarchy WHERE member_id = '$M_TIAGO')"
}
echo "== 3. Inativar Caio × mover André (o líder dele) para Tiago"
scn s3 "" "UPDATE public.members SET is_active = false WHERE id = '$M_CAIO'" "$(MOVE "$M_ANDRE" "$M_TIAGO")" "OK" post3

post4() {
  check "$1: as duas células contam: Gabriel 2 (a C4 e a nova), Caio 1, André 3 e Pedro 3 (o inativo Fábio não corta a cadeia)" "
    SELECT (SELECT total_cells = 2 FROM private.member_hierarchy WHERE member_id = '$M_GABRIEL')
       AND (SELECT total_cells = 1 FROM private.member_hierarchy WHERE member_id = '$M_CAIO')
       AND (SELECT total_cells = 3 FROM private.member_hierarchy WHERE member_id = '$M_ANDRE')
       AND (SELECT total_cells = 3 FROM private.member_hierarchy WHERE member_id = '$M_PEDRO')"
}
echo "== 4. Duas células novas na mesma cadeia (uma de Gabriel, uma de Caio; ambos abaixo de André)"
scn s4 "" "$(NEWCELL "$C5" "$M_GABRIEL")" "$(NEWCELL "$C6" "$M_CAIO")" "OK" post4

post5() {
  check "$1: Caio excluído e André sob Tiago: Pedro com 0 e Tiago com 5 (Hugo, Vânia, Dora, André e Gabriel)" "
    SELECT (SELECT total_disciples = 0 FROM private.member_hierarchy WHERE member_id = '$M_PEDRO')
       AND (SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_CAIO')
       AND (SELECT total_disciples = 5 FROM private.member_hierarchy WHERE member_id = '$M_TIAGO')"
}
echo "== 5. Excluir um discípulo (Caio, RPC do E2.01) × mover o líder dele (André) para Tiago"
scn s5 "" "SELECT public.delete_member('$M_CAIO')" "$(MOVE "$M_ANDRE" "$M_TIAGO")" "OK" post5

post6() {
  check "$1: Zélia restaurada (nível 4 sob Pedro, Hugo, Vânia) e Hugo sob Pedro" "
    SELECT (SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_ZELIA')
       AND (SELECT g12_level = 4 AND ancestor_ids = ARRAY['$M_PAS', '$M_PEDRO', '$M_HUGO', '$M_VANIA']::uuid[] FROM private.member_hierarchy WHERE member_id = '$M_ZELIA')"
}
echo "== 6. Restaurar Zélia (RPC do E2.01) × mover Hugo (ancestral dela) para Pedro"
scn s6 "" "SELECT count(*) FROM public.restore_member('$M_ZELIA')" "$(MOVE "$M_HUGO" "$M_PEDRO")" "OK" post6

post7() {
  check "$1: André sob Tiago e Fábio sob Pedro, cada um com a cadeia certa" "
    SELECT (SELECT ancestor_ids = ARRAY['$M_PAS', '$M_TIAGO']::uuid[] FROM private.member_hierarchy WHERE member_id = '$M_ANDRE')
       AND (SELECT ancestor_ids = ARRAY['$M_PAS', '$M_PEDRO']::uuid[] FROM private.member_hierarchy WHERE member_id = '$M_FABIO')
       AND (SELECT ancestor_ids = ARRAY['$M_PAS', '$M_PEDRO', '$M_FABIO']::uuid[] FROM private.member_hierarchy WHERE member_id = '$M_GABRIEL')"
}
echo "== 7. Duas trocas de líder na mesma subárvore (André → Tiago e Fábio → Pedro)"
scn s7 "" "$(MOVE "$M_ANDRE" "$M_TIAGO")" "$(MOVE "$M_FABIO" "$M_PEDRO")" "OK" post7

# ---------------------------------------------------------------------------
post8a() {
  check "$1: Bruno restaurado e Dora sob Pedro com o celular novo" "
    SELECT (SELECT deleted_at IS NULL FROM public.members WHERE id = '$M_BRUNO')
       AND (SELECT leader_id = '$M_PEDRO' AND mobile_whatsapp = '51977770000' FROM public.members WHERE id = '$M_DORA')"
}
echo "== 8a. Restaurar Bruno × gravação que troca o líder e o celular (outro) de Dora: sem deadlock"
scn s8a "" "SELECT count(*) FROM public.restore_member('$M_BRUNO')" \
  "UPDATE public.members SET leader_id = '$M_PEDRO', mobile_whatsapp = '51977770000' WHERE id = '$M_DORA'" "OK" post8a

post8b() {
  check "$1: o celular de Bruno está num só cadastro não excluído" "
    SELECT (SELECT count(*) FROM public.members WHERE mobile_whatsapp = '5188880000' AND deleted_at IS NULL) <= 1"
}
echo "== 8b. Restaurar Bruno × gravação que põe o celular dele em Dora (e troca o líder): um recebe a mensagem do identificador, sem deadlock"
scn s8b "" "SELECT count(*) FROM public.restore_member('$M_BRUNO')" \
  "UPDATE public.members SET leader_id = '$M_PEDRO', mobile_whatsapp = '5188880000' WHERE id = '$M_DORA'" "OK|value_in_use|restore_value_in_use" post8b

echo
if [ "$FAILS" = 0 ]; then echo "TUDO OK"; exit 0; else echo "$FAILS FALHA(S)"; exit 1; fi
