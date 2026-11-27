#!/usr/bin/env bash
# E3.03 (tarefa 6): concorrência do login com a senha do legado, com conexões reais.
# Spec: docs/specs/e3-login-legado.md (repositório apps-mci), DT-05 (ordem de travas
# limites → membro → auth.users → cofre → credencial), RN-03, RN-04, RN-12.
#
#   1. 20 entradas simultâneas de Ana com a senha certa, pelo e-mail, pelo celular e pelo CPF
#      (linhas de limite diferentes: só o cofre as ordena): todas "ok", exatamente uma pela
#      credencial legada (um primeiro acesso), um hash no cofre, used_at gravado, credencial
#      descartada;
#   2. entrada × redefinição (10 rodadas, cada uma com um membro novo): vale a última concluída;
#      no fim a temporária devolvida é a senha do cofre, a credencial sumiu, sem 40P01 nem erro;
#   2b. a redefinição segura a trava do cofre: a entrada espera, relê a credencial (já descartada)
#      e confere pelo cofre (falha com a senha antiga), sem erro;
#   3. carga × redefinição (10 rodadas): a carga devolve created (e a redefinição a apaga) ou
#      has_password (não cria); nunca as duas senhas ao mesmo tempo, sem 40P01 nem erro.
#
# Usa só dados fictícios, gravados (as sessões precisam enxergá-los) e apagados no fim, mesmo se
# o script for interrompido. Zera private.sign_in_throttle e apaga os eventos de login criados
# durante a execução: use SÓ no banco local do Supabase, nunca no remoto.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e3_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e3conc.XXXXXX")
FAILS=0
ROUNDS=${ROUNDS:-10}
HOLD=${HOLD:-3}        # segundos que a redefinição segura a trava do cofre no cenário 2b

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f3c0de00-<tipo>-...  (u = conta, m = membro, s = sessão)
U_ADM=f3c0de00-0001-0000-0000-000000000001
M_ADM=f3c0de00-0003-0000-0000-000000000001
S_ADM=f3c0de00-0005-0000-0000-000000000001
U_ANA=f3c0de00-0001-0000-0000-000000000002
M_ANA=f3c0de00-0003-0000-0000-000000000002
ANA_PW='Graça#2024conc'
ANA_EMAIL='e3-conc-ana@teste.invalid'
ANA_MOBILE='(51) 93030-0002'
ANA_CPF='529.982.247-25'
U_ANA2=f3c0de00-0001-0000-0000-000000000003
M_ANA2=f3c0de00-0003-0000-0000-000000000003
u_of() { printf 'f3c0de00-0001-0000-0001-%012d' "$1"; }
m_of() { printf 'f3c0de00-0003-0000-0001-%012d' "$1"; }
START=$(q "SELECT clock_timestamp()::text")

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM private.sign_in_throttle;
DELETE FROM private.legacy_credentials WHERE member_id::text LIKE 'f3c0de00%';
DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE 'f3c0de00%';
DELETE FROM private.account_passwords WHERE auth_user_id::text LIKE 'f3c0de00%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, deleted_by = NULL, deleted_by_kind = NULL WHERE id::text LIKE 'f3c0de00%';
DELETE FROM public.members WHERE id::text LIKE 'f3c0de00%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM auth.refresh_tokens WHERE user_id LIKE 'f3c0de00%';
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f3c0de00%';
DELETE FROM auth.users WHERE id::text LIKE 'f3c0de00%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f3c0de00%' OR actor_user_id::text LIKE 'f3c0de00%'
   OR (entity = 'auth' AND occurred_at >= '$START'::timestamptz);
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

# Massa: o Administrador (pastor, com senha e sessão), Ana (com credencial) e $ROUNDS*2 membros
# com conta e sem senha (os das rodadas 2 e 3).
setup() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('$U_ADM', 'e3-conc-adm@teste.invalid', now()), ('$U_ANA', '$ANA_EMAIL', now()), ('$U_ANA2', 'e3-conc-ana2@teste.invalid', now());
INSERT INTO auth.users (id, email, email_confirmed_at)
SELECT ('f3c0de00-0001-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'e3-conc-' || n || '@teste.invalid', now()
  FROM generate_series(1, 2 * $ROUNDS) n;
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, auth_user_id, role_id, email) VALUES
  ('$M_ADM', 'E3 Conc Administrador', 'M', true, false, '$U_ADM', (SELECT id FROM public.roles WHERE is_system), 'e3-conc-adm@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, email, cpf, mobile_whatsapp) VALUES
  ('$M_ANA', 'E3 Conc Ana', 'F', '$M_ADM', true, '$U_ANA', '$ANA_EMAIL', '$ANA_CPF', '$ANA_MOBILE'),
  ('$M_ANA2', 'E3 Conc Ana Dois', 'F', '$M_ADM', true, '$U_ANA2', 'e3-conc-ana2@teste.invalid', NULL, NULL);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, email)
SELECT ('f3c0de00-0003-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'E3 Conc Pessoa', 'F', '$M_ADM', true,
       ('f3c0de00-0001-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'e3-conc-' || n || '@teste.invalid'
  FROM generate_series(1, 2 * $ROUNDS) n;
SELECT private.write_password('$U_ADM', '$M_ADM', 'Forte@Admin2024', NULL);
INSERT INTO auth.sessions (id, user_id) VALUES ('$S_ADM', '$U_ADM');
SELECT private.add_legacy_credential('$M_ANA', md5('$ANA_PW'));
SELECT private.add_legacy_credential(('f3c0de00-0003-0000-0001-' || lpad(n::text, 12, '0'))::uuid, md5('Velha#' || n))
  FROM generate_series(1, $ROUNDS) n;
COMMIT;
SQL
}

as_adm() {
  { echo '\set VERBOSITY verbose'
    echo "SELECT set_config('request.jwt.claims', '{\"sub\":\"$U_ADM\",\"role\":\"authenticated\",\"session_id\":\"$S_ADM\"}', false) \\g /dev/null"
    echo 'SET ROLE authenticated;'; echo "$1"; } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
}
sr() {
  { echo '\set VERBOSITY verbose'; echo 'SET ROLE service_role;'; echo "$1"; } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
}
pg() {
  { echo '\set VERBOSITY verbose'; echo "$1"; } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
}
pw_of() { grep -o '"password": "[^"]*"' "$1" | head -1 | sed 's/.*: "//; s/"$//'; }

check() { # descrição, SQL booleano
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
expect_eq() { # descrição, obtido, esperado
  if [ "$2" = "$3" ]; then echo "  PASS  $1 ($2)"; else echo "  FAIL  $1 (obtido: $2; esperado: $3)"; FAILS=$((FAILS + 1)); fi
}
count_in() { local p=$1; shift; cat "$@" 2>/dev/null | grep -c -- "$p" || true; }

# ---------------------------------------------------------------------------
echo "== 1. 20 entradas simultâneas de Ana com a senha certa (e-mail, celular e CPF)"
setup
T0=$(q "SELECT clock_timestamp()::text")
IDS=("$ANA_EMAIL" "$ANA_MOBILE" "$ANA_CPF" "51930300002")
for i in $(seq 1 20); do
  ID=${IDS[$((i % 4))]}
  ( sr "SELECT public.sign_in_attempt('$ID', '$ANA_PW', '198.18.253.$i');" > "$TMP/s1.$i" ) &
done
wait
expect_eq "RN-12: todas entram" "$(count_in '"result": "ok"' "$TMP"/s1.*)" 20
expect_eq "RN-12: exatamente uma pela credencial legada (um primeiro acesso)" "$(count_in '"credential": "legacy"' "$TMP"/s1.*)" 1
expect_eq "RN-12: as outras 19 pela conta" "$(count_in '"credential": "account"' "$TMP"/s1.*)" 19
expect_eq "DT-05: nenhum erro (lock_timeout, deadlock)" "$(count_in 'ERROR' "$TMP"/s1.*)" 0
check "RN-04: a credencial foi descartada, com used_at" \
  "SELECT legacy_hash IS NULL AND used_at IS NOT NULL AND discarded_at IS NOT NULL FROM private.legacy_credentials WHERE member_id = '$M_ANA'"
check "RN-04: um hash no cofre, que confere com a senha" \
  "SELECT count(*) = 1 AND bool_and(extensions.crypt('$ANA_PW', password_hash) = password_hash) FROM private.account_passwords WHERE auth_user_id = '$U_ANA'"
check "RN-12: nenhuma falha nem troca exigida na Auditoria" \
  "SELECT count(*) = 0 FROM public.events WHERE entity_id = '$M_ANA' AND occurred_at >= '$T0'::timestamptz"

# ---------------------------------------------------------------------------
echo "== 2. entrada × redefinição, $ROUNDS rodadas (vale a última concluída)"
q "DELETE FROM private.sign_in_throttle" >/dev/null
for r in $(seq 1 "$ROUNDS"); do
  ( sr "SELECT public.sign_in_attempt('e3-conc-$r@teste.invalid', 'Velha#$r', '198.18.254.$r');" > "$TMP/s2.login.$r" ) &
  ( as_adm "SELECT public.reset_member_password('$(m_of "$r")');" > "$TMP/s2.reset.$r" ) &
done
wait
expect_eq "DT-05: nenhum erro (lock_timeout, deadlock)" "$(count_in 'ERROR' "$TMP"/s2.*)" 0
expect_eq "DT-05: sem deadlock (40P01)" "$(count_in '40P01' "$TMP"/s2.*)" 0
expect_eq "RN-12: as redefinições foram aceitas" "$(count_in '"result": "ok"' "$TMP"/s2.reset.*)" "$ROUNDS"
LEG=$(count_in '"credential": "legacy"' "$TMP"/s2.login.*); INV=$(count_in '"result": "invalid"' "$TMP"/s2.login.*)
expect_eq "RN-12: cada entrada conferiu a credencial (antes) ou falhou (depois da redefinição)" "$((LEG + INV))" "$ROUNDS"
echo "        (entradas antes da redefinição: $LEG; depois: $INV)"
VALUES=$(for r in $(seq 1 "$ROUNDS"); do echo "('$(u_of "$r")'::uuid, '$(pw_of "$TMP/s2.reset.$r")'),"; done | tr -d '\n' | sed 's/,$//')
check "RN-12: no fim, a temporária devolvida é a senha do cofre em todas as rodadas" \
  "SELECT count(*) = $ROUNDS FROM (VALUES $VALUES) v(u, p) JOIN private.account_passwords a ON a.auth_user_id = v.u
    WHERE extensions.crypt(v.p, a.password_hash) = a.password_hash AND a.must_change_reason = 'reset'"
check "RN-03: nenhuma credencial com hash sobrou" \
  "SELECT count(*) = 0 FROM private.legacy_credentials WHERE member_id::text LIKE 'f3c0de00-0003-0000-0001%' AND legacy_hash IS NOT NULL"

# ---------------------------------------------------------------------------
echo "== 2b. a redefinição trava o cofre primeiro (segura ${HOLD} s); a entrada espera, relê a credencial e falha"
q "DELETE FROM private.sign_in_throttle" >/dev/null
q "SELECT private.add_legacy_credential('$M_ANA2', md5('Velha#ana2'))" >/dev/null
( as_adm "BEGIN; SELECT public.reset_member_password('$M_ANA2'); SELECT pg_sleep($HOLD); COMMIT;" > "$TMP/s2b.reset" ) &
sleep 1
sr "SELECT public.sign_in_attempt('e3-conc-ana2@teste.invalid', 'Velha#ana2', '198.18.254.200');" > "$TMP/s2b.login"
wait
expect_eq "DT-05: a entrada esperou e falhou (a credencial já tinha sumido)" "$(count_in '"result": "invalid"' "$TMP/s2b.login")" 1
expect_eq "DT-05: nenhum erro" "$(count_in 'ERROR' "$TMP"/s2b.*)" 0
check "DT-05: a falha foi conferida pelo cofre (sem a informação da credencial legada)" \
  "SELECT reason = 'wrong_password' AND credential IS NULL FROM (SELECT metadata ->> 'reason' AS reason, metadata ->> 'credential' AS credential
     FROM public.events WHERE action = 'login_failed' AND entity_id = '$M_ANA2' ORDER BY occurred_at DESC LIMIT 1) x"
check "RN-12: a temporária vale" \
  "SELECT extensions.crypt('$(pw_of "$TMP/s2b.reset")', password_hash) = password_hash FROM private.account_passwords WHERE auth_user_id = '$U_ANA2'"

# ---------------------------------------------------------------------------
echo "== 3. carga × redefinição, $ROUNDS rodadas"
q "DELETE FROM private.sign_in_throttle" >/dev/null
for r in $(seq $((ROUNDS + 1)) $((2 * ROUNDS))); do
  ( pg "SELECT private.add_legacy_credential('$(m_of "$r")', md5('Velha#$r'));" > "$TMP/s3.load.$r" ) &
  ( as_adm "SELECT public.reset_member_password('$(m_of "$r")');" > "$TMP/s3.reset.$r" ) &
done
wait
expect_eq "DT-05: nenhum erro (lock_timeout, deadlock)" "$(count_in 'ERROR' "$TMP"/s3.*)" 0
expect_eq "DT-05: sem deadlock (40P01)" "$(count_in '40P01' "$TMP"/s3.*)" 0
CR=$(cat "$TMP"/s3.load.* | grep -cx 'created' || true); HP=$(cat "$TMP"/s3.load.* | grep -cx 'has_password' || true)
expect_eq "RN-03: a carga devolveu created (antes) ou has_password (depois)" "$((CR + HP))" "$ROUNDS"
echo "        (carga antes da redefinição: $CR; depois: $HP)"
check "RN-03: nunca as duas senhas (legacy_credential_problems vazia)" \
  "SELECT count(*) = 0 FROM private.legacy_credential_problems() WHERE member_id::text LIKE 'f3c0de00%'"
check "RN-03: toda credencial criada nesta rodada foi descartada pela redefinição" \
  "SELECT count(*) = 0 FROM private.legacy_credentials WHERE member_id::text LIKE 'f3c0de00-0003-0000-0001%' AND legacy_hash IS NOT NULL"

echo
if [ "$FAILS" -eq 0 ]; then echo "OK: todos os cenários passaram"; else echo "FALHAS: $FAILS"; exit 1; fi
