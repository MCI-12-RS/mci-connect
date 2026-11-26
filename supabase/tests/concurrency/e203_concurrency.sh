#!/usr/bin/env bash
# E2.03 (PR 1): cenários de concorrência da redefinição e da troca de senha com várias conexões reais.
# Spec: docs/specs/e2-03-senha.md (repositório apps-mci), "Bloqueios e concorrência", RN-04, RN-06, RN-12,
# RN-16, DA-15 e "Verificações obrigatórias (para o QA)".
#
#   1. 25 redefinições de Pedro ao mesmo tempo: exatamente 20 aceitas e 5 rate_limited, sem erro;
#   2. 20 trocas de Caio com a senha atual errada ao mesmo tempo: exatamente 5 conferidas
#      (5 falhas na Auditoria, 1 bloqueio), 4 current_password_invalid e 16 change_blocked;
#   3. duas redefinições do mesmo alvo ao mesmo tempo (André e Pedro): vale a última, e só uma
#      das duas senhas temporárias entra;
#   4. redefinição × delete_member do mesmo membro, nas duas ordens: se a exclusão trava primeiro, a
#      redefinição recusa (not_found); se a redefinição trava primeiro, a exclusão suspende a conta
#      depois e a senha temporária e a marca ficam no cofre;
#   5. troca obrigatória em duas sessões ao mesmo tempo: uma ok, a outra session_ended (RN-16);
#   6. redefinição × troca voluntária do alvo: no fim vale a senha temporária e o alvo fica sem sessões.
#
# Usa só dados fictícios, gravados (as sessões precisam enxergá-los) e apagados no fim, mesmo se o script
# for interrompido. Zera private.sign_in_throttle e apaga os eventos criados durante a execução: use SÓ
# no banco local do Supabase, nunca no remoto.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e203_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}        # segundos que a primeira sessão segura a trava
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e203conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f203c0de-<tipo>-...
U_PEDRO=f203c0de-0001-0000-0000-000000000001
U_ANDRE=f203c0de-0001-0000-0000-000000000002
U_RITA=f203c0de-0001-0000-0000-000000000003
U_CAIO=f203c0de-0001-0000-0000-000000000004
RLE=f203c0de-0002-0000-0000-000000000001
RMB=f203c0de-0002-0000-0000-000000000002
M_PEDRO=f203c0de-0003-0000-0000-000000000001
M_ANDRE=f203c0de-0003-0000-0000-000000000002
M_RITA=f203c0de-0003-0000-0000-000000000003
M_CAIO=f203c0de-0003-0000-0000-000000000004
S_CAIO1=f203c0de-0005-0000-0000-000000000001
S_CAIO2=f203c0de-0005-0000-0000-000000000002
S_PEDRO=f203c0de-0005-0000-0000-000000000011
CAIO_PW='Caminho2024'
START=$(q "SELECT clock_timestamp()::text")

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM private.sign_in_throttle;
DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE 'f203c0de%';
DELETE FROM private.account_passwords WHERE auth_user_id::text LIKE 'f203c0de%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, spouse_id = NULL, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f203c0de%';
DELETE FROM public.members WHERE id::text LIKE 'f203c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f203c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f203c0de%';
DELETE FROM auth.refresh_tokens WHERE user_id LIKE 'f203c0de%';
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f203c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f203c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f203c0de%' OR actor_user_id::text LIKE 'f203c0de%'
   OR (entity = 'auth' AND occurred_at >= '$START'::timestamptz);
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Massa: Pedro, André e Rita (mesma função, com redefinir e excluir), Caio (Membro) com senha, duas sessões.
setup() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('$U_PEDRO', 'e203-conc-1@teste.invalid', now()), ('$U_ANDRE', 'e203-conc-2@teste.invalid', now()),
  ('$U_RITA', 'e203-conc-3@teste.invalid', now()), ('$U_CAIO', 'e203-conc-4@teste.invalid', now());
INSERT INTO public.roles (id, name) VALUES ('$RLE', 'E203 Conc LE'), ('$RMB', 'E203 Conc MB');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('$RLE', 'view_all_church'), ('$RLE', 'change_member_password'), ('$RLE', 'delete_member'), ('$RLE', 'view_dashboard'), ('$RLE', 'manage_roles'),
  ('$RMB', 'view_dashboard');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, auth_user_id, role_id, mobile_whatsapp) VALUES
  ('$M_PEDRO', 'E203 Conc Pedro', 'M', true, false, '$U_PEDRO', '$RLE', '5192030001'),
  ('$M_ANDRE', 'E203 Conc Andre', 'M', true, false, '$U_ANDRE', '$RLE', '5192030002'),
  ('$M_RITA', 'E203 Conc Rita', 'F', true, false, '$U_RITA', '$RLE', '5192030003');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, auth_user_id, role_id, mobile_whatsapp, email, cpf, birth_date) VALUES
  ('$M_CAIO', 'E203 Conc Caio', 'M', false, false, '$U_CAIO', '$RMB', '5192030004', 'e203-conc-caio@teste.invalid', '52998224725', '1990-03-15');
SELECT private.write_password('$U_CAIO', '$M_CAIO', '$CAIO_PW', NULL);
SELECT private.write_password('$U_PEDRO', '$M_PEDRO', 'Forte@2024x', NULL);
INSERT INTO auth.sessions (id, user_id) VALUES ('$S_CAIO1', '$U_CAIO'), ('$S_CAIO2', '$U_CAIO'), ('$S_PEDRO', '$U_PEDRO');
COMMIT;
SQL
}

# Sessão como o usuário $1 (authenticated, sem sessão nas claims) com o SQL $2.
as_user() {
  { echo '\set VERBOSITY verbose'
    echo "SELECT set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false) \\g /dev/null"
    echo 'SET ROLE authenticated;'; echo "$2"; } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
}
# Sessão como service_role (o papel da Edge Function), com o SQL $1.
sr() {
  { echo '\set VERBOSITY verbose'; echo 'SET ROLE service_role;'; echo "$1"; } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
}
reset_sql() { echo "SELECT public.reset_member_password('$1');"; }
chg_sql() { # sessão, modo, atual, nova, origem
  echo "SELECT public.change_own_password('$U_CAIO', '$1', '$2', $( [ -n "$3" ] && echo "'$3'" || echo NULL ), '$4', '$4', '${5:-203.0.113.50}', gen_random_uuid());"
}

check() { # descrição, SQL booleano
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
expect_eq() { # descrição, obtido, esperado
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($2)"; else echo "  FAIL  $1 (obtido: $2; esperado: $3)"; FAILS=$((FAILS + 1)); fi
}
count_in() { # padrão, arquivos...
  local p=$1; shift; cat "$@" 2>/dev/null | grep -c -- "$p" || true
}
pw_of() { grep -o '"password": "[^"]*"' "$1" | head -1 | sed 's/.*: "//; s/"$//'; }
logs_in() { # senha: confere o hash do cofre de Caio
  q "SELECT extensions.crypt('$1', password_hash) = password_hash FROM private.account_passwords WHERE auth_user_id = '$U_CAIO'"
}

# ---------------------------------------------------------------------------
echo "== 1. 25 redefinições de Pedro ao mesmo tempo"
setup
T0=$(q "SELECT clock_timestamp()::text")
for i in $(seq 1 25); do
  ( as_user "$U_PEDRO" "$(reset_sql $M_CAIO)" > "$TMP/s1.$i" ) &
done
wait
OK=$(count_in '"result": "ok"' "$TMP"/s1.*)
RL=$(count_in '"code": "rate_limited"' "$TMP"/s1.*)
ERRORS=$(count_in 'ERROR' "$TMP"/s1.*)
expect_eq "RN-06: redefinições aceitas" "$OK" 20
expect_eq "RN-06: recusadas com rate_limited" "$RL" 5
expect_eq "RN-06, DA-15: nenhum erro (lock_timeout, deadlock)" "$ERRORS" 0
expect_eq "RN-06: sem deadlock (40P01)" "$(count_in '40P01' "$TMP"/s1.*)" 0
check "RN-06, RN-17: 20 eventos de senha redefinida" \
  "SELECT count(*) = 20 FROM public.events WHERE action = 'password_reset' AND entity_id = '$M_CAIO' AND occurred_at >= '$T0'::timestamptz"
check "RN-06, RN-17: 5 recusas por limite na Auditoria" \
  "SELECT count(*) = 5 FROM public.events WHERE action = 'password_reset_refused' AND metadata ->> 'reason' = 'rate_limited' AND occurred_at >= '$T0'::timestamptz"
check "RN-06: a linha de limite de Pedro guarda exatamente 20 aceitas" \
  "SELECT max(cardinality(failures)) = 20 FROM private.sign_in_throttle WHERE kind = 'password_reset'"
LAST=$(grep -l '"result": "ok"' "$TMP"/s1.* | head -1)
check "RN-04: o cofre de Caio guarda UMA das senhas devolvidas (a última gravada)" \
  "SELECT (SELECT count(*) FROM (VALUES $(for f in $(grep -l '"result": "ok"' "$TMP"/s1.*); do echo "('$(pw_of "$f")'),"; done | tr -d '\n' | sed 's/,$//')) v(p), private.account_passwords a
            WHERE a.auth_user_id = '$U_CAIO' AND extensions.crypt(v.p, a.password_hash) = a.password_hash) = 1"

# ---------------------------------------------------------------------------
echo "== 2. 20 trocas de Caio com a senha atual errada ao mesmo tempo"
setup
T0=$(q "SELECT clock_timestamp()::text")
for i in $(seq 1 20); do
  ( sr "$(chg_sql $S_CAIO1 voluntary errada-$i 'Outra#Senha2026')" > "$TMP/s2.$i" ) &
done
wait
INVALID=$(count_in '"result": "current_password_invalid"' "$TMP"/s2.*)
BLOCKED=$(count_in '"result": "change_blocked"' "$TMP"/s2.*)
expect_eq "RN-12: respostas current_password_invalid" "$INVALID" 4
expect_eq "RN-12: respostas change_blocked (a 5ª e as 15 recusadas)" "$BLOCKED" 16
expect_eq "RN-12: nenhum erro (lock_timeout, deadlock)" "$(count_in 'ERROR' "$TMP"/s2.*)" 0
check "RN-12, RN-17: exatamente 5 falhas na Auditoria (só 5 senhas conferidas)" \
  "SELECT count(*) = 5 FROM public.events WHERE action = 'password_change_failed' AND entity_id = '$M_CAIO' AND occurred_at >= '$T0'::timestamptz"
check "RN-12, RN-17: um único bloqueio, de 15 minutos" \
  "SELECT count(*) = 1 FROM public.events WHERE action = 'password_change_blocked' AND entity_id = '$M_CAIO' AND occurred_at >= '$T0'::timestamptz AND metadata = '{\"block_minutes\": 15}'::jsonb"
check "RN-12: a senha de Caio não mudou" "SELECT extensions.crypt('$CAIO_PW', password_hash) = password_hash FROM private.account_passwords WHERE auth_user_id = '$U_CAIO'"

# ---------------------------------------------------------------------------
echo "== 3. André e Pedro redefinem Caio ao mesmo tempo (vale a última gravação)"
setup
( as_user "$U_ANDRE" "$(reset_sql $M_CAIO)" > "$TMP/s3.A" ) &
( as_user "$U_PEDRO" "$(reset_sql $M_CAIO)" > "$TMP/s3.B" ) &
wait
expect_eq "RN-04: as duas foram aceitas" "$(count_in '"result": "ok"' "$TMP"/s3.*)" 2
PA=$(pw_of "$TMP/s3.A"); PB=$(pw_of "$TMP/s3.B")
EA=$(logs_in "$PA"); EB=$(logs_in "$PB")
if [ "$EA" = "t" ] && [ "$EB" = "f" ] || [ "$EA" = "f" ] && [ "$EB" = "t" ]; then
  echo "  PASS  RN-04: só uma das duas senhas temporárias vale (André: $EA, Pedro: $EB)"
else echo "  FAIL  RN-04: exatamente uma das senhas devia valer (André: $EA, Pedro: $EB)"; FAILS=$((FAILS + 1)); fi
check "RN-04: o autor gravado no cofre é o de quem escreveu por último (a senha que vale)" \
  "SELECT password_set_by = CASE WHEN '$EA' = 't' THEN '$M_ANDRE'::uuid ELSE '$M_PEDRO'::uuid END FROM private.account_passwords WHERE auth_user_id = '$U_CAIO'"
check "RN-17: a Auditoria tem as duas redefinições" "SELECT count(*) = 2 FROM public.events WHERE action = 'password_reset' AND entity_id = '$M_CAIO'"

# ---------------------------------------------------------------------------
echo "== 4. Redefinição × exclusão do mesmo membro, nas duas ordens"
echo "-- 4a. a exclusão trava primeiro (segura $HOLD s); a redefinição espera, relê e recusa"
setup
( as_user "$U_RITA" "BEGIN; SELECT public.delete_member('$M_CAIO'); SELECT pg_sleep($HOLD); COMMIT;" > "$TMP/s4a.A" ) &
sleep 1
as_user "$U_ANDRE" "$(reset_sql $M_CAIO)" > "$TMP/s4a.B"
wait
expect_eq "4a: a redefinição recusa (not_found, Cadastro excluído)" "$(count_in '"code": "not_found"' "$TMP/s4a.B")" 1
check "4a: Caio está excluído, a conta suspensa e a senha antiga guardada no cofre" \
  "SELECT (SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_CAIO')
      AND (SELECT banned_until > now() + interval '50 years' FROM auth.users WHERE id = '$U_CAIO')
      AND (SELECT extensions.crypt('$CAIO_PW', password_hash) = password_hash AND NOT must_change FROM private.account_passwords WHERE auth_user_id = '$U_CAIO')"
check "4a: nenhuma redefinição foi registrada, só a recusa 'Cadastro excluído'" \
  "SELECT (SELECT count(*) FROM public.events WHERE action = 'password_reset' AND entity_id = '$M_CAIO') = 0
      AND (SELECT count(*) FROM public.events WHERE action = 'password_reset_refused' AND error_reason = 'Cadastro excluído') = 1"
echo "-- 4b. a redefinição trava primeiro (segura $HOLD s); a exclusão espera e suspende a conta depois"
setup
( as_user "$U_ANDRE" "BEGIN; $(reset_sql $M_CAIO) SELECT pg_sleep($HOLD); COMMIT;" > "$TMP/s4b.A" ) &
sleep 1
as_user "$U_RITA" "SELECT public.delete_member('$M_CAIO');" > "$TMP/s4b.B"
wait
expect_eq "4b: a redefinição foi aceita" "$(count_in '"result": "ok"' "$TMP/s4b.A")" 1
expect_eq "4b: a exclusão não deu erro" "$(count_in 'ERROR' "$TMP/s4b.B")" 0
P4=$(pw_of "$TMP/s4b.A")
check "4b: Caio está excluído e a conta suspensa" \
  "SELECT (SELECT deleted_at IS NOT NULL FROM public.members WHERE id = '$M_CAIO')
      AND (SELECT banned_until > now() + interval '50 years' FROM auth.users WHERE id = '$U_CAIO')"
check "4b: a senha temporária e a marca ficaram no cofre (voltam na restauração)" \
  "SELECT extensions.crypt('$P4', password_hash) = password_hash AND must_change AND must_change_reason = 'reset' AND temp_expires_at IS NOT NULL
     FROM private.account_passwords WHERE auth_user_id = '$U_CAIO'"
check "4b: nenhuma sessão de Caio ficou" "SELECT count(*) = 0 FROM auth.sessions WHERE user_id = '$U_CAIO'"
as_user "$U_RITA" "SELECT public.restore_member('$M_CAIO');" >/dev/null
V=$(sr "SELECT public.sign_in_attempt('e203-conc-caio@teste.invalid', '$P4', '198.18.200.1');")
expect_eq "4b: restaurado, Caio entra com a senha temporária e vai para a troca obrigatória" "$(echo "$V" | grep -c '"must_change_password": true')" 1

# ---------------------------------------------------------------------------
echo "== 5. Troca obrigatória em duas sessões ao mesmo tempo"
setup
RT=$(as_user "$U_ANDRE" "$(reset_sql $M_CAIO)")
P5=$(echo "$RT" | grep -o '"password": "[^"]*"' | head -1 | sed 's/.*: "//; s/"$//')
q "INSERT INTO auth.sessions (id, user_id) VALUES ('$S_CAIO1', '$U_CAIO'), ('$S_CAIO2', '$U_CAIO')" >/dev/null
( sr "$(chg_sql $S_CAIO1 forced '' 'Abacate77')" > "$TMP/s5.A" ) &
( sr "$(chg_sql $S_CAIO2 forced '' 'Abacate78')" > "$TMP/s5.B" ) &
wait
expect_eq "RN-16: uma troca aceita" "$(count_in '"result": "ok"' "$TMP"/s5.*)" 1
expect_eq "RN-16: a outra recebe session_ended" "$(count_in '"result": "session_ended"' "$TMP"/s5.*)" 1
expect_eq "RN-16: nenhum erro" "$(count_in 'ERROR' "$TMP"/s5.*)" 0
check "RN-16: só a sessão da troca aceita continua" "SELECT count(*) = 1 FROM auth.sessions WHERE user_id = '$U_CAIO'"
check "RN-10: a marca saiu e a senha é a da troca aceita (uma só das duas novas)" \
  "SELECT NOT must_change AND (extensions.crypt('Abacate77', password_hash) = password_hash) <> (extensions.crypt('Abacate78', password_hash) = password_hash)
     FROM private.account_passwords WHERE auth_user_id = '$U_CAIO'"
check "RN-17: um único evento de senha alterada" "SELECT count(*) = 1 FROM public.events WHERE action = 'password_changed' AND entity_id = '$M_CAIO'"

# ---------------------------------------------------------------------------
echo "== 6. Redefinição × troca voluntária do alvo em andamento"
setup
( as_user "$U_ANDRE" "$(reset_sql $M_CAIO)" > "$TMP/s6.A" ) &
( sr "$(chg_sql $S_CAIO1 voluntary "$CAIO_PW" 'Outra#Senha2026')" > "$TMP/s6.B" ) &
wait
P6=$(pw_of "$TMP/s6.A")
expect_eq "RN-16: a redefinição foi aceita" "$(count_in '"result": "ok"' "$TMP/s6.A")" 1
check "RN-04: no fim vale a senha temporária (a troca terminou antes e foi sobrescrita, ou recebeu session_ended/senha atual inválida)" \
  "SELECT extensions.crypt('$P6', password_hash) = password_hash AND must_change FROM private.account_passwords WHERE auth_user_id = '$U_CAIO'"
check "RN-16: Caio fica sem sessões" "SELECT count(*) = 0 FROM auth.sessions WHERE user_id = '$U_CAIO'"
echo "  (resposta da troca: $(tr -d '\n' < "$TMP/s6.B" | grep -o '"result": "[a-z_]*"' | head -1))"
expect_eq "nenhum erro nem deadlock" "$(count_in 'ERROR\|40P01' "$TMP"/s6.*)" 0

# ---------------------------------------------------------------------------
cleanup
check "limpeza: nenhum dado do script ficou no banco" \
  "SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE 'f203c0de%')
        + (SELECT count(*) FROM auth.users WHERE id::text LIKE 'f203c0de%')
        + (SELECT count(*) FROM private.account_passwords WHERE auth_user_id::text LIKE 'f203c0de%')
        + (SELECT count(*) FROM private.sign_in_throttle)
        + (SELECT count(*) FROM public.events WHERE entity_id::text LIKE 'f203c0de%' OR actor_user_id::text LIKE 'f203c0de%') = 0"

echo
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: todos os cenários terminaram num estado válido"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
