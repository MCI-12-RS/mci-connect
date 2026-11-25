#!/usr/bin/env bash
# E1.04 (PR 1): cenários de concorrência da sign_in_attempt com várias conexões reais.
# Spec: docs/specs/e1-04-sign-in.md (repositório apps-mci), "Contagem e bloqueio" (Concorrência),
# RN-10, RN-11, P-LOG-12 e "Verificações obrigatórias (para o QA)".
#
#   1. 20 chamadas simultâneas com o CPF de Ana (origens diferentes): exatamente 5 senhas
#      conferidas (5 falhas na Auditoria), 4 respostas "invalid" e 16 "locked", um bloqueio;
#   2. 60 chamadas simultâneas de uma origem, com identificações diferentes: no máximo 50
#      conferidas, um bloqueio por origem;
#   3. a limpeza (private.sign_in_purge) rodando durante as tentativas: sem deadlock (40P01);
#   4. a linha da chave travada além do lock_timeout (3 s): a RPC dá 55P03 e nada é contado.
#
# Usa só dados fictícios, gravados (as sessões precisam enxergá-los) e apagados no fim, mesmo se
# o script for interrompido. Como a tabela de controle guarda só HMACs, o script zera
# private.sign_in_throttle e apaga os eventos de login criados durante a execução: use SÓ no
# banco local do Supabase, nunca no remoto.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e104_concurrency.sh
# Sai com código 1 se algum cenário falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e104conc.XXXXXX")
FAILS=0

q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

# Ids fictícios: f104c0de-<tipo>-...
U_ANA=f104c0de-0001-0000-0000-000000000001
M_PASTOR=f104c0de-0003-0000-0000-000000000010
M_ANA=f104c0de-0003-0000-0000-000000000001
ANA_EMAIL='e104-conc-ana@teste.invalid'
ANA_CPF='168.995.350-09'          # válido; chave c:16899535009 e m:1689953509
ANA_PW='Senha#conc'

START=$(q "SELECT clock_timestamp()::text")

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<SQL
BEGIN;
SET LOCAL session_replication_role = replica;
DELETE FROM private.sign_in_throttle;
DELETE FROM public.events WHERE entity_id::text LIKE 'f104c0de%' OR actor_user_id::text LIKE 'f104c0de%'
   OR (entity = 'auth' AND action IN ('login_failed', 'login_blocked', 'login') AND occurred_at >= '$START'::timestamptz);
UPDATE public.members SET leader_id = NULL, has_leadership = false WHERE id::text LIKE 'f104c0de%';  -- E2.04: CHECK de liderança
DELETE FROM public.members WHERE id::text LIKE 'f104c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);  -- em replica a FK em cascata não roda
DELETE FROM auth.sessions WHERE user_id::text LIKE 'f104c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f104c0de%';
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

setup() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at)
VALUES ('$U_ANA', '$ANA_EMAIL', extensions.crypt('$ANA_PW', extensions.gen_salt('bf', 10)), now());
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, email) VALUES ('$M_PASTOR', 'E104 Conc Pastor', 'M', true, false, '$M_PASTOR@teste.invalid');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, email, cpf, mobile_whatsapp)
VALUES ('$M_ANA', 'E104 Conc Ana', 'F', '$M_PASTOR', true, '$U_ANA', '$ANA_EMAIL', '$ANA_CPF', '(51) 90000-1104');
COMMIT;
SQL
}

# Sessão como service_role (o papel da Edge Function), com o SQL $1.
sr() {
  { echo '\set VERBOSITY verbose'; echo 'SET ROLE service_role;'; echo "$1"; } | $PSQL -X -q -At -v ON_ERROR_STOP=0 2>&1
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

# ---------------------------------------------------------------------------
echo "== 1. 20 tentativas simultâneas com o CPF de Ana (senha errada, origens diferentes)"
setup
T0=$(q "SELECT clock_timestamp()::text")
for i in $(seq 1 20); do
  ( sr "SELECT public.sign_in_attempt('$ANA_CPF', 'errada-$i', '198.18.251.$i');" > "$TMP/s1.$i" ) &
done
wait
INVALID=$(count_in '"result": "invalid"' "$TMP"/s1.*)
LOCKED=$(count_in '"result": "locked"' "$TMP"/s1.*)
ERRORS=$(count_in 'ERROR' "$TMP"/s1.*)
expect_eq "RN-10: respostas invalid" "$INVALID" 4
expect_eq "RN-10: respostas locked (a 5ª e as 15 recusadas)" "$LOCKED" 16
expect_eq "RN-10: nenhum erro (lock_timeout, deadlock)" "$ERRORS" 0
expect_eq "RN-10: sem deadlock (40P01)" "$(count_in '40P01' "$TMP"/s1.*)" 0
check "RN-10, RN-15: exatamente 5 falhas na Auditoria (só as 5 senhas conferidas)" \
  "SELECT count(*) = 5 FROM public.events WHERE entity = 'auth' AND action = 'login_failed' AND entity_id = '$M_ANA' AND occurred_at >= '$T0'::timestamptz"
check "RN-15 c: um único bloqueio, por identificação" \
  "SELECT count(*) = 1 FROM public.events WHERE entity = 'auth' AND action = 'login_blocked' AND occurred_at >= '$T0'::timestamptz
      AND metadata ->> 'block_scope' = 'identifier'"
check "RN-10: a chave do CPF ficou bloqueada e sem falhas guardadas" \
  "SELECT count(*) >= 1 FROM private.sign_in_throttle WHERE kind = 'identifier' AND blocked_until > now() AND cardinality(failures) = 0"
R=$(sr "SELECT public.sign_in_attempt('$ANA_CPF', '$ANA_PW', '198.18.251.100');")
expect_eq "RN-10: senha certa durante o bloqueio" "$(echo "$R" | grep -c '"result": "locked"')" 1

# ---------------------------------------------------------------------------
echo "== 2. 60 tentativas simultâneas da mesma origem, com identificações diferentes"
setup
T0=$(q "SELECT clock_timestamp()::text")
for i in $(seq 1 60); do
  ( sr "SELECT public.sign_in_attempt('e104-conc-$i@teste.invalid', 'errada', '198.18.252.1');" > "$TMP/s2.$i" ) &
done
wait
INVALID=$(count_in '"result": "invalid"' "$TMP"/s2.*)
LOCKED=$(count_in '"result": "locked"' "$TMP"/s2.*)
ERRORS=$(count_in 'ERROR' "$TMP"/s2.*)
FAILED=$(q "SELECT count(*) FROM public.events WHERE entity = 'auth' AND action = 'login_failed' AND occurred_at >= '$T0'::timestamptz")
echo "  invalid=$INVALID locked=$LOCKED erros=$ERRORS falhas na Auditoria=$FAILED"
check "RN-11: no máximo 50 senhas conferidas" "SELECT $FAILED <= 50"
expect_eq "RN-11: toda tentativa teve uma resposta" "$((INVALID + LOCKED + ERRORS))" 60
expect_eq "RN-11: sem deadlock (40P01)" "$(count_in '40P01' "$TMP"/s2.*)" 0
if [ "$ERRORS" -eq 0 ]; then
  expect_eq "RN-11: sem erros, exatamente 50 conferidas (49 invalid + a 50ª, que bloqueia)" "$FAILED" 50
  expect_eq "RN-11: e 11 respostas locked (a 50ª e as 10 recusadas)" "$LOCKED" 11
else
  echo "  AVISO: $ERRORS tentativa(s) com erro (lock_timeout de 3 s: risco 4 do spec); o teto de 50 foi conferido acima"
fi
check "RN-11, RN-15 c: um único bloqueio, por origem, sem identificação nem endereço" \
  "SELECT count(*) = 1 FROM public.events WHERE entity = 'auth' AND action = 'login_blocked' AND occurred_at >= '$T0'::timestamptz
      AND metadata = '{\"block_scope\": \"origin\", \"block_minutes\": 15}'::jsonb"

# ---------------------------------------------------------------------------
echo "== 3. A limpeza rodando durante as tentativas (sem deadlock)"
setup
q "INSERT INTO private.sign_in_throttle (kind, key_hash, failures, blocked_until, expires_at)
   SELECT 'origin', decode(md5('e104-velha-' || i), 'hex'), '{}', NULL, now() - interval '25 hours' FROM generate_series(1, 300) i" >/dev/null
for i in $(seq 1 15); do
  ( sr "SELECT public.sign_in_attempt('e104-purge-$i@teste.invalid', 'errada', '198.18.253.$i');" > "$TMP/s3.$i" ) &
done
( for j in $(seq 1 12); do $PSQL -X -q -At -v ON_ERROR_STOP=0 -c "SELECT private.sign_in_purge()" 2>&1; done > "$TMP/s3.purge" ) &
wait
ALL=$(cat "$TMP"/s3.* 2>/dev/null)
expect_eq "limpeza: sem deadlock (40P01) nem 'deadlock detected'" "$(echo "$ALL" | grep -ci 'deadlock\|40P01')" 0
expect_eq "limpeza: nenhuma tentativa terminou em erro" "$(count_in 'ERROR' "$TMP"/s3.*)" 0
expect_eq "limpeza: as 15 tentativas responderam invalid" "$(count_in '"result": "invalid"' "$TMP"/s3.*)" 15
check "RN-11: as 300 linhas vencidas foram apagadas" \
  "SELECT count(*) = 0 FROM private.sign_in_throttle WHERE expires_at < now()"
check "RN-11: as linhas das tentativas em andamento não foram apagadas" \
  "SELECT count(*) >= 15 FROM private.sign_in_throttle WHERE kind = 'identifier'"

# ---------------------------------------------------------------------------
echo "== 4. Linha travada além do lock_timeout (P-LOG-12): erro do servidor, nada contado"
setup
R=$(sr "SELECT public.sign_in_attempt('$ANA_CPF', '$ANA_PW', '198.18.254.1');")
expect_eq "preparo: Ana entra (cria as linhas da identificação)" "$(echo "$R" | grep -c '"result": "ok"')" 1
T0=$(q "SELECT clock_timestamp()::text")
KEY_C="private.sign_in_key('identifier', 'c:16899535009')"
( echo "BEGIN; SELECT 1 FROM private.sign_in_throttle WHERE kind = 'identifier' AND key_hash = $KEY_C FOR UPDATE; SELECT pg_sleep(6); COMMIT;" \
    | $PSQL -X -q -At -v ON_ERROR_STOP=0 > "$TMP/s4.A" 2>&1 ) &
sleep 1.5
B0=$(date +%s)
sr "SELECT public.sign_in_attempt('$ANA_CPF', 'errada-lock', '198.18.254.2');" > "$TMP/s4.B"
B1=$(date +%s)
wait
echo "  sessão B: $(grep -m1 'ERROR' "$TMP/s4.B" | cut -c1-90) (em $((B1 - B0)) s)"
expect_eq "P-LOG-12: a tentativa dá 55P03 (lock_not_available)" "$(count_in '55P03' "$TMP/s4.B")" 1
check "P-LOG-12: ela esperou cerca de 3 s, não o tempo todo da trava" "SELECT $((B1 - B0)) BETWEEN 2 AND 5"
check "P-LOG-12: nada foi contado (nenhuma linha de identificação com falha)" \
  "SELECT count(*) = 0 FROM private.sign_in_throttle WHERE cardinality(failures) > 0"
check "P-LOG-12: nem registrado" \
  "SELECT count(*) = 0 FROM public.events WHERE entity = 'auth' AND action IN ('login_failed', 'login_blocked') AND occurred_at >= '$T0'::timestamptz"
R=$(sr "SELECT public.sign_in_attempt('$ANA_CPF', 'errada-depois', '198.18.254.3');")
expect_eq "depois que a trava sai, a falha é contada normalmente" "$(echo "$R" | grep -c '"result": "invalid"')" 1

# ---------------------------------------------------------------------------
cleanup
check "limpeza: nenhum dado do script ficou no banco" \
  "SELECT (SELECT count(*) FROM public.members WHERE id::text LIKE 'f104c0de%')
        + (SELECT count(*) FROM auth.users WHERE id::text LIKE 'f104c0de%')
        + (SELECT count(*) FROM private.sign_in_throttle)
        + (SELECT count(*) FROM public.events WHERE entity_id::text LIKE 'f104c0de%' OR actor_user_id::text LIKE 'f104c0de%') = 0"

echo
if [ "$FAILS" -eq 0 ]; then echo "RESULTADO: todos os cenários terminaram num estado válido"; exit 0; fi
echo "RESULTADO: $FAILS verificação(ões) falharam"; exit 1
