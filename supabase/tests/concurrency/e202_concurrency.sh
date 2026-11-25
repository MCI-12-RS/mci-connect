#!/usr/bin/env bash
# E2.02 (perfis e escopo): cenários de concorrência com duas conexões reais.
# Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), "Bloqueios e
# concorrência" e "Verificações obrigatórias (para o QA)".
#
# Cada cenário abre duas sessões do psql em paralelo. A primeira segura a trava
# com pg_sleep; a segunda começa no meio e precisa esperar. No fim, o estado é
# conferido: ele é válido, e a recusa vem com a mensagem amigável (ou 40P01,
# "tente de novo", nos casos aceitos pelo spec).
#
#   1. duas trocas da função padrão (em série e no mesmo instante): sempre
#      exatamente uma padrão, sem unique_violation; e a recusa de ficar sem
#      padrão no commit (constraint adiado, de verdade);
#   2. excluir uma função × atribuí-la a alguém, nas duas ordens;
#   3. dois administradores tirando a função um do outro (em série e no mesmo
#      instante): sobra um, e o segundo recebe last_admin;
#   4. Rita move Caio para Diego × Pedro edita Caio, nas duas ordens: estado
#      válido, sem erro fora do previsto.
#
# Usa só dados fictícios, gravados (as duas sessões precisam enxergá-los) e
# apagados no fim, mesmo se o script for interrompido. Restaura a função padrão
# (Membro) no fim.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e202_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e202conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f202c0de-<tipo>-...
U_ANA=f202c0de-0001-0000-0000-000000000001     # administradora (auth)
U_BETO=f202c0de-0001-0000-0000-000000000002    # administrador (auth)
U_PEDRO=f202c0de-0001-0000-0000-000000000003   # Líder do ministério A (auth)
U_RITA=f202c0de-0001-0000-0000-000000000004    # administradora para o cenário 4 (auth)
M_PAS=f202c0de-0003-0000-0000-000000000001
M_ANA=f202c0de-0003-0000-0000-000000000002
M_BETO=f202c0de-0003-0000-0000-000000000003
M_PEDRO=f202c0de-0003-0000-0000-000000000004
M_ANDRE=f202c0de-0003-0000-0000-000000000005
M_CAIO=f202c0de-0003-0000-0000-000000000006
M_DIEGO=f202c0de-0003-0000-0000-000000000007
M_CARLA=f202c0de-0003-0000-0000-000000000008
M_RITA=f202c0de-0003-0000-0000-000000000009
M_LIA=f202c0de-0003-0000-0000-00000000000a

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL WHERE id::text LIKE 'f202c0de%';  -- E2.04: CHECK de liderança
DELETE FROM public.members WHERE id::text LIKE 'f202c0de%';
DELETE FROM public.role_permissions WHERE role_id IN (SELECT id FROM public.roles WHERE name LIKE 'f202 %');
UPDATE public.members SET role_id = NULL WHERE role_id IN (SELECT id FROM public.roles WHERE name LIKE 'f202 %');
DELETE FROM public.roles WHERE name LIKE 'f202 %';
UPDATE public.roles SET is_default = (name = 'Membro');
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f202c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f202c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f202c0de%' OR actor_user_id::text LIKE 'f202c0de%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Base: Ana e Beto (Administrador), Rita (Administrador), o pastor, Pedro (Líder) e a árvore dele.
base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('$U_ANA', 'e202-conc-1@teste.invalid'), ('$U_BETO', 'e202-conc-2@teste.invalid'),
  ('$U_PEDRO', 'e202-conc-3@teste.invalid'), ('$U_RITA', 'e202-conc-4@teste.invalid');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES ('$M_PAS', 'E202 Conc Pastor', 'M', true, false, '$M_PAS@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id, email) VALUES
  ('$M_ANA',   'E202 Conc Ana',   'F', '$M_PAS',   true, '$U_ANA',   (SELECT id FROM public.roles WHERE is_system), '$M_ANA@teste.invalid'),
  ('$M_BETO',  'E202 Conc Beto',  'M', '$M_PAS',   true, '$U_BETO',  (SELECT id FROM public.roles WHERE is_system), '$M_BETO@teste.invalid'),
  ('$M_PEDRO', 'E202 Conc Pedro', 'M', '$M_PAS',   true, '$U_PEDRO', (SELECT id FROM public.roles WHERE name = 'Líder'), '$M_PEDRO@teste.invalid'),
  ('$M_DIEGO', 'E202 Conc Diego', 'M', '$M_PAS',   true, NULL,       NULL, '$M_DIEGO@teste.invalid'),
  ('$M_RITA',  'E202 Conc Rita',  'F', '$M_PAS',   true, '$U_RITA',  (SELECT id FROM public.roles WHERE is_system), '$M_RITA@teste.invalid'),
  ('$M_LIA',   'E202 Conc Lia',   'F', '$M_PAS',   true, NULL,       NULL, '$M_LIA@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES
  ('$M_ANDRE', 'E202 Conc Andre', 'M', '$M_PEDRO', true, '$M_ANDRE@teste.invalid'),
  ('$M_CARLA', 'E202 Conc Carla', 'F', '$M_PEDRO', true, '$M_CARLA@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, email) VALUES
  ('$M_CAIO',  'E202 Conc Caio',  'M', '$M_ANDRE', true, '$M_CAIO@teste.invalid');
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

# Duas sessões: a primeira começa, a segunda entra $6 segundos depois.
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
code_of() { outcome "$1" | awk '{print $1 " " $2}' | sed 's/ |$//' | sed 's/ $//'; }

check() { # descrição, SQL booleano
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
yes_if() { if "$@"; then echo true; else echo false; fi; }
has() { grep -q -- "$2" "$TMP/$1"; }   # arquivo de saída contém texto
nomatch() { ! grep -qh -- "$1" "${@:2}"; }   # nenhum dos arquivos contém o texto
show() { echo "  sessão A: $(outcome "$TMP/$1.A")"; echo "  sessão B: $(outcome "$TMP/$1.B")"; }

R_TAIL="ARRAY['view_dashboard']::public.permission_action[]"

# ---------------------------------------------------------------------------
echo "== 1a. Duas trocas da função padrão em série (A segura a trava 'roles'; B espera)"
base
pair s1a "$U_ANA" "BEGIN; SELECT public.save_role(NULL, 'f202 Padrão A', NULL, $R_TAIL, true); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_BETO" "SELECT public.save_role(NULL, 'f202 Padrão B', NULL, $R_TAIL, true);"
show s1a
check "as duas trocas dão certo, em série" "SELECT $(yes_if [ "$(outcome "$TMP/s1a.A")" = OK ] && [ "$(outcome "$TMP/s1a.B")" = OK ])"
check "existe exatamente uma função padrão" "SELECT count(*) = 1 FROM public.roles WHERE is_default"
check "e vale a última (B)" "SELECT name = 'f202 Padrão B' FROM public.roles WHERE is_default"
check "sem unique_violation em nenhuma sessão" "SELECT $(yes_if nomatch '23505' "$TMP/s1a.A" "$TMP/s1a.B")"

echo "== 1b. Duas trocas da função padrão no mesmo instante (5 rodadas)"
for i in 1 2 3 4 5; do
  base
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  pair s1b "$U_ANA" "SELECT pg_sleep_until('$T'); SELECT public.save_role(NULL, 'f202 Padrão A', NULL, $R_TAIL, true);" \
           "$U_BETO" "SELECT pg_sleep_until('$T'); SELECT public.save_role(NULL, 'f202 Padrão B', NULL, $R_TAIL, true);" 0
  echo "  rodada $i: A=$(outcome "$TMP/s1b.A" | cut -c1-40) / B=$(outcome "$TMP/s1b.B" | cut -c1-40)"
  check "rodada $i: exatamente uma padrão, e é uma das duas" \
    "SELECT (SELECT count(*) FROM public.roles WHERE is_default) = 1 AND (SELECT name IN ('f202 Padrão A', 'f202 Padrão B') FROM public.roles WHERE is_default)"
  check "rodada $i: sem unique_violation" "SELECT $(yes_if nomatch '23505' "$TMP/s1b.A" "$TMP/s1b.B")"
  check "rodada $i: as duas dão certo ou 40P01 (tente de novo)" \
    "SELECT $(yes_if bash -c "for o in '$(outcome "$TMP/s1b.A" | cut -c1-5)' '$(outcome "$TMP/s1b.B" | cut -c1-5)'; do [ \"\$o\" = OK ] || [ \"\$o\" = 40P01 ] || exit 1; done")"
done

echo "== 1c. Ficar sem função padrão no commit (constraint adiado, de verdade)"
base
session "" "BEGIN; UPDATE public.roles SET is_default = false WHERE is_default; COMMIT;" > "$TMP/s1c.A"
echo "  sessão A: $(outcome "$TMP/s1c.A")"
check "o commit é recusado com role_default_required" "SELECT $(yes_if has s1c.A 'role_default_required')"
check "e a Membro continua a padrão" "SELECT name = 'Membro' FROM public.roles WHERE is_default"

# ---------------------------------------------------------------------------
echo "== 2a. Exclusão da função (trava primeiro) × atribuí-la a Lia"
base
q "INSERT INTO public.roles (id, name) VALUES ('f202c0de-0002-0000-0000-000000000001', 'f202 Livre')" >/dev/null
R_FREE=f202c0de-0002-0000-0000-000000000001
pair s2a "$U_ANA" "BEGIN; SELECT public.delete_role('$R_FREE'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_BETO" "UPDATE public.members SET role_id = '$R_FREE' WHERE id = '$M_LIA';"
show s2a
check "a exclusão vale (a função some)" "SELECT NOT EXISTS (SELECT 1 FROM public.roles WHERE id = '$R_FREE')"
check "a atribuição recebe 23503 depois (a função não existe mais), sem gravar nada" \
  "SELECT $(yes_if has s2a.B '23503') AND (SELECT role_id IS NULL FROM public.members WHERE id = '$M_LIA')"
check "nenhum membro aponta para uma função inexistente" \
  "SELECT NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id::text LIKE 'f202c0de%' AND m.role_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.id = m.role_id))"

echo "== 2b. Atribuir a função a Lia (trava primeiro) × exclusão da função"
base
q "INSERT INTO public.roles (id, name) VALUES ('f202c0de-0002-0000-0000-000000000001', 'f202 Livre')" >/dev/null
pair s2b "$U_ANA" "BEGIN; UPDATE public.members SET role_id = '$R_FREE' WHERE id = '$M_LIA'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_BETO" "SELECT public.delete_role('$R_FREE');"
show s2b
check "a atribuição vale" "SELECT role_id = '$R_FREE' FROM public.members WHERE id = '$M_LIA'"
check "a exclusão conta o membro e recusa com role_in_use (por 1 membro)" \
  "SELECT $(yes_if has s2b.B 'role_in_use') AND $(yes_if has s2b.B 'Esta função é usada por 1 membro.')"
check "a função continua" "SELECT EXISTS (SELECT 1 FROM public.roles WHERE id = '$R_FREE')"

# ---------------------------------------------------------------------------
echo "== 3a. Dois administradores tiram a função um do outro (em série; só Ana e Beto)"
base
q "UPDATE public.members SET role_id = NULL WHERE id = '$M_RITA'" >/dev/null
check "base: Ana e Beto são os dois administradores" "SELECT count(*) = 2 FROM public.members WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND deleted_at IS NULL AND id IN ('$M_ANA', '$M_BETO')"
LIDER=$(q "SELECT id FROM public.roles WHERE name = 'Líder'")
ADM_OTHERS=$(q "SELECT count(*) FROM public.members WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND deleted_at IS NULL AND id NOT IN ('$M_ANA', '$M_BETO')")
echo "  (outros administradores no banco: $ADM_OTHERS; os de fora da massa seguram a invariante e o teste usa a contagem relativa)"
pair s3a "$U_ANA" "BEGIN; UPDATE public.members SET role_id = '$LIDER' WHERE id = '$M_BETO'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_BETO" "UPDATE public.members SET role_id = '$LIDER' WHERE id = '$M_ANA';"
show s3a
check "o primeiro vale: Beto deixa de ser administrador" "SELECT role_id = '$LIDER' FROM public.members WHERE id = '$M_BETO'"
if [ "$ADM_OTHERS" -eq 0 ]; then
  check "o segundo é recusado com last_admin (ou perde a permissão)" "SELECT $(yes_if has s3a.B 'last_admin') OR $(yes_if has s3a.B '42501') OR $(yes_if has s3a.B 'role_change_not_allowed')"
  check "sobra exatamente um administrador (Ana)" "SELECT (SELECT count(*) FROM public.members WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND deleted_at IS NULL) = 1"
else
  check "sobra pelo menos um administrador" "SELECT (SELECT count(*) FROM public.members WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND deleted_at IS NULL) >= 1"
fi

echo "== 3b. Dois administradores tiram a função um do outro no mesmo instante (5 rodadas)"
for i in 1 2 3 4 5; do
  base
  q "UPDATE public.members SET role_id = NULL WHERE id = '$M_RITA'" >/dev/null
  T=$(q "SELECT (clock_timestamp() + interval '1 second')::text")
  pair s3b "$U_ANA" "SELECT pg_sleep_until('$T'); UPDATE public.members SET role_id = '$LIDER' WHERE id = '$M_BETO';" \
           "$U_BETO" "SELECT pg_sleep_until('$T'); UPDATE public.members SET role_id = '$LIDER' WHERE id = '$M_ANA';" 0
  echo "  rodada $i: A=$(outcome "$TMP/s3b.A" | cut -c1-48) / B=$(outcome "$TMP/s3b.B" | cut -c1-48)"
  # Com outros administradores no banco (por exemplo, a conta do E2E), a invariante é deles e os dois podem
  # mesmo se tirar a função: a conferência é então sobre o banco todo (nunca zero administradores).
  if [ "$ADM_OTHERS" -eq 0 ]; then
    check "rodada $i: sobra pelo menos um administrador entre Ana e Beto (nunca zero)" \
      "SELECT (SELECT count(*) FROM public.members WHERE id IN ('$M_ANA', '$M_BETO') AND role_id = (SELECT id FROM public.roles WHERE is_system)) >= 1"
  else
    check "rodada $i: sobra pelo menos um administrador no banco (os de fora da massa seguram a invariante)" \
      "SELECT (SELECT count(*) FROM public.members WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND deleted_at IS NULL) >= 1"
  fi
  check "rodada $i: a recusa é last_admin, 42501/role_change_not_allowed (já sem permissão) ou 40P01" \
    "SELECT $(yes_if bash -c "o1='$(outcome "$TMP/s3b.A" | cut -c1-60)'; o2='$(outcome "$TMP/s3b.B" | cut -c1-60)'; for o in \"\$o1\" \"\$o2\"; do case \"\$o\" in OK*|*last_admin*|42501*|*role_change_not_allowed*|40P01*) ;; *) exit 1;; esac; done")"
done

# ---------------------------------------------------------------------------
echo "== 4a. Rita move Caio para Diego (trava primeiro) × Pedro edita as observações de Caio"
base
pair s4a "$U_RITA" "BEGIN; UPDATE public.members SET leader_id = '$M_DIEGO' WHERE id = '$M_CAIO'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_PEDRO" "UPDATE public.members SET notes = 'editado por Pedro' WHERE id = '$M_CAIO';"
show s4a
check "Caio fica com Diego como líder (a mudança de árvore de Rita prevalece)" "SELECT leader_id = '$M_DIEGO' FROM public.members WHERE id = '$M_CAIO'"
check "a gravação de Pedro, sem trocar líder nem cônjuge, termina sem erro ou com a recusa de escopo (0 linhas), nunca com erro fora do previsto" \
  "SELECT $(yes_if bash -c "o='$(outcome "$TMP/s4a.B" | cut -c1-60)'; case \"\$o\" in OK*|*would_leave_scope*|40P01*) exit 0;; *) exit 1;; esac")"
check "Caio é de um só lugar: um líder e nenhum órfão" "SELECT (SELECT leader_id IS NOT NULL FROM public.members WHERE id = '$M_CAIO') AND (SELECT count(*) = 1 FROM public.members WHERE id = '$M_CAIO')"

echo "== 4b. Pedro troca o líder de Caio para Carla (trava primeiro) × Rita move Caio para Diego"
base
pair s4b "$U_PEDRO" "BEGIN; UPDATE public.members SET leader_id = '$M_CARLA' WHERE id = '$M_CAIO'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_RITA" "UPDATE public.members SET leader_id = '$M_DIEGO' WHERE id = '$M_CAIO';"
show s4b
check "as duas gravam em série e a última vale (Diego)" "SELECT leader_id = '$M_DIEGO' FROM public.members WHERE id = '$M_CAIO'"
check "ninguém recebe erro fora do previsto" \
  "SELECT $(yes_if bash -c "for o in '$(outcome "$TMP/s4b.A" | cut -c1-60)' '$(outcome "$TMP/s4b.B" | cut -c1-60)'; do case \"\$o\" in OK*|*would_leave_scope*|40P01*) ;; *) exit 1;; esac; done")"

echo "== 4c. Rita move Caio para Diego (trava primeiro) × Pedro põe Carla como líder de Caio (a leitura do fim: would_leave_scope ou estado válido)"
base
pair s4c "$U_RITA" "BEGIN; UPDATE public.members SET leader_id = '$M_DIEGO' WHERE id = '$M_CAIO'; SELECT pg_sleep($HOLD); COMMIT;" \
         "$U_PEDRO" "UPDATE public.members SET leader_id = '$M_CARLA' WHERE id = '$M_CAIO';"
show s4c
check "estado válido: Caio tem um líder (Diego ou Carla) e a árvore não fica órfã" \
  "SELECT (SELECT leader_id IN ('$M_DIEGO', '$M_CARLA') FROM public.members WHERE id = '$M_CAIO')"
check "Pedro termina OK (a gravação dele vale por último) ou recebe uma recusa amigável (would_leave_scope, person_not_visible) ou 40P01" \
  "SELECT $(yes_if bash -c "o='$(outcome "$TMP/s4c.B" | cut -c1-70)'; case \"\$o\" in OK*|*would_leave_scope*|*person_not_visible*|40P01*) exit 0;; *) exit 1;; esac")"

echo
if [ "$FAILS" -eq 0 ]; then echo "Todos os cenários terminaram em estado válido."; else echo "$FAILS verificação(ões) falharam."; exit 1; fi
