#!/usr/bin/env bash
# E2.05 (Auditoria): cenários de concorrência com duas conexões reais.
# Spec: docs/specs/e2-05-auditoria-autor.md (repositório apps-mci), "Bloqueios e concorrência" e
# "Verificações obrigatórias" (concorrência), RN-05, RN-13 b, RN-15, RN-17; leitura técnica 1; DT-09.
#
# Cada cenário abre duas sessões do psql em paralelo. A primeira segura a trava com pg_sleep; a segunda
# começa no meio e espera. No fim, o estado é conferido: as duas gravações valem, nenhuma dá deadlock, e a
# última alteração de cada registro é a do último evento dele (RN-13 b).
#   1. duas alterações do mesmo membro: a autoria final é a do último evento;
#   2. duas save_cell_report no mesmo relatório (desde o E2.11, a escrita direta acabou);
#   3. participantes × delete_cell_report e restore_cell_report × participantes;
#   4. troca do cônjuge × alteração do cônjuge;
#   5. duas trocas da função padrão: a anterior certa em cada evento;
#   6. audit_purge × gravações.
#
# Usa só dados fictícios, gravados (as duas sessões precisam enxergá-los) e apagados no fim, mesmo se o
# script for interrompido. A função padrão volta à de antes.
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e205_concurrency.sh
# Sai com código 1 se algum cenário falhar.
set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
HOLD=${HOLD:-3}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e205conc.XXXXXX")
FAILS=0
q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }

U1=f205c0de-0001-0000-0000-000000000001   # Ana (Administrador)
U2=f205c0de-0001-0000-0000-000000000002   # Beto (Administrador)
M_P=f205c0de-0003-0000-0000-000000000001  # pastor
M_A=f205c0de-0003-0000-0000-000000000002
M_B=f205c0de-0003-0000-0000-000000000003
M_O=f205c0de-0003-0000-0000-000000000004  # Otávio
M_PA=f205c0de-0003-0000-0000-000000000005 # Paula
M_L=f205c0de-0003-0000-0000-000000000006  # Lia
M_R=f205c0de-0003-0000-0000-000000000007  # Rita
C1=f205c0de-0004-0000-0000-000000000001
RA=f205c0de-0002-0000-0000-000000000001
RB=f205c0de-0002-0000-0000-000000000002
DEFAULT0=$(q "SELECT id FROM public.roles WHERE is_default AND id::text NOT LIKE 'f205c0de%'")
[ -n "$DEFAULT0" ] || DEFAULT0=$(q "SELECT id FROM public.roles WHERE name = 'Membro'")

cleanup() {
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
SET LOCAL app.role_maintenance = 'on';
UPDATE public.roles SET is_default = false WHERE is_default AND id <> '$DEFAULT0';
UPDATE public.roles SET is_default = true WHERE id = '$DEFAULT0' AND NOT is_default;
SET LOCAL session_replication_role = replica;
DELETE FROM public.cell_report_participants WHERE report_id IN (SELECT id FROM public.cell_reports WHERE cell_id = '$C1') OR member_id::text LIKE 'f205c0de%';
DELETE FROM public.cell_reports WHERE cell_id = '$C1';
DELETE FROM public.cells WHERE id = '$C1';
DELETE FROM private.member_access_suspensions WHERE member_id::text LIKE 'f205c0de%';
UPDATE public.members SET leader_id = NULL, has_leadership = false, is_pastor = true, spouse_id = NULL, deleted_by = NULL,
       created_by = NULL, updated_by = NULL, created_by_kind = 'system', updated_at = NULL, updated_by_kind = NULL,
       deleted_at = NULL, deleted_by_kind = NULL
 WHERE id::text LIKE 'f205c0de%';
DELETE FROM public.members WHERE id::text LIKE 'f205c0de%';
DELETE FROM private.member_hierarchy h WHERE NOT EXISTS (SELECT 1 FROM public.members m WHERE m.id = h.member_id);
DELETE FROM public.role_permissions WHERE role_id::text LIKE 'f205c0de%';
DELETE FROM public.roles WHERE id::text LIKE 'f205c0de%';
DELETE FROM auth.users WHERE id::text LIKE 'f205c0de%';
DELETE FROM public.events WHERE entity_id::text LIKE 'f205c0de%' OR actor_user_id::text LIKE 'f205c0de%' OR description LIKE 'E205 conc%'
   OR entity_id IN (SELECT id FROM public.cell_reports WHERE cell_id = '$C1');
COMMIT;
SQL
}
trap 'cleanup; rm -rf "$TMP"' EXIT

base() {
  cleanup
  $PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('$U1', 'e205-conc-1@teste.invalid'), ('$U2', 'e205-conc-2@teste.invalid');
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp) VALUES
  ('$M_P', 'E205 Conc Pastor', 'M', true, false, '51920580001');
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, auth_user_id, role_id) VALUES
  ('$M_A', 'E205 Conc Ana', 'F', '$M_P', true, '51920580002', '$U1', (SELECT id FROM public.roles WHERE is_system)),
  ('$M_B', 'E205 Conc Beto', 'M', '$M_P', true, '51920580003', '$U2', (SELECT id FROM public.roles WHERE is_system)),
  ('$M_O', 'E205 Conc Otávio', 'M', '$M_P', true, '51920580004', NULL, NULL),
  ('$M_PA', 'E205 Conc Paula', 'F', '$M_P', true, '51920580005', NULL, NULL),
  ('$M_L', 'E205 Conc Lia', 'F', '$M_P', true, '51920580006', NULL, NULL),
  ('$M_R', 'E205 Conc Rita', 'F', '$M_P', true, '51920580007', NULL, NULL);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
VALUES ('$C1', '$M_P', '$M_O', '$M_PA', 'Domingo', '00:00');
INSERT INTO public.roles (id, name) VALUES ('$RA', 'E205 Conc Função A'), ('$RB', 'E205 Conc Função B');
INSERT INTO public.role_permissions (role_id, permission) VALUES ('$RA', 'view_dashboard'), ('$RB', 'view_dashboard');
COMMIT;
SELECT set_config('request.jwt.claims', '{"sub":"$U1","role":"authenticated"}', false);
-- E2.11: o lançamento (00:00, depois da reunião; oferta obrigatória), pela submit_cell_report desde o
-- E2.12. O pastor, Otávio e Paula (líder, timóteo e anfitriã) entram como automáticos.
SELECT public.submit_cell_report(gen_random_uuid(), jsonb_build_object('cell_id', '$C1'::uuid, 'date', public.sp_today(), 'time', '00:00', 'theme', 'Fé', 'offering', 0),
                               ARRAY['$M_O']::uuid[]);
SQL
}
R1() { q "SELECT id FROM public.cell_reports WHERE cell_id = '$C1' ORDER BY created_at DESC LIMIT 1"; }

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
pair() { # nome uidA sqlA uidB sqlB [atraso]
  ( session "$2" "$3" > "$TMP/$1.A" ) &
  sleep "${6:-1}"
  ( session "$4" "$5" > "$TMP/$1.B" ) &
  wait
}
outcome() {
  local f=$1 err
  err=$(grep -m1 -E '^(psql:.*)?ERROR:' "$f" | sed -E 's/.*ERROR: +//')
  if [ -z "$err" ]; then echo "OK"; else echo "$err"; fi
}
check() {
  local v; v=$(q "$2")
  if [ "$v" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 (obtido: $v)"; FAILS=$((FAILS + 1)); fi
}
both_ok() {
  local a b; a=$(outcome "$TMP/$1.A"); b=$(outcome "$TMP/$1.B")
  if [ "$a" = "OK" ] && [ "$b" = "OK" ]; then echo "  PASS  $1: as duas gravações valem, sem deadlock"
  else echo "  FAIL  $1: A=$a | B=$b"; FAILS=$((FAILS + 1)); fi
}
# RN-13 b: a última alteração do registro é a do último evento (mesmo momento e mesmo autor).
matches_last() { # tabela entidade id descrição
  check "$4" "SELECT t.updated_at = e.occurred_at AND t.updated_by IS NOT DISTINCT FROM
                     (SELECT m.id FROM public.members m WHERE m.auth_user_id = e.actor_user_id)
                FROM public.$1 t,
                     LATERAL (SELECT * FROM public.events x WHERE x.entity = '$2' AND x.entity_id = t.id
                               AND x.action IN ('update', 'delete', 'restore') ORDER BY x.occurred_at DESC, x.seq DESC LIMIT 1) e
               WHERE t.id = '$3'"
}

echo "1. duas alterações do mesmo membro"
base
pair c1 "$U1" "BEGIN; UPDATE public.members SET notes = 'A' WHERE id = '$M_O'; SELECT pg_sleep($HOLD); COMMIT;" \
        "$U2" "UPDATE public.members SET notes = 'B' WHERE id = '$M_O';"
both_ok c1
check "a autoria final é a de Beto (o segundo, que esperou a linha)" "SELECT updated_by = '$M_B' AND notes = 'B' FROM public.members WHERE id = '$M_O'"
matches_last members member "$M_O" "RN-13 b: a última alteração de Otávio é a do último evento"
check "leitura técnica 1: o evento de Beto tem o momento maior que o de Ana" \
  "SELECT (SELECT max(occurred_at) FROM public.events WHERE entity_id = '$M_O' AND actor_user_id = '$U2')
        > (SELECT max(occurred_at) FROM public.events WHERE entity_id = '$M_O' AND actor_user_id = '$U1')"

# E2.11: só pela save_cell_report (a escrita direta acabou); os registrados (pastor, Otávio, Paula) ficam.
AUTO="'$M_P', '$M_O', '$M_PA'"
echo "2. participantes × save_cell_report (duas edições)"
base; R=$(R1)
pair c2 "$U1" "BEGIN; SELECT public.save_cell_report('$R', '{}', ARRAY[$AUTO, '$M_L']::uuid[]); SELECT pg_sleep($HOLD); COMMIT;" \
        "$U2" "SELECT public.save_cell_report('$R', '{\"theme\": \"Nova\"}', ARRAY[$AUTO]::uuid[]);"
both_ok c2
check "o conjunto final é o da segunda (os três registrados; Lia, incluída antes, saiu)" \
  "SELECT array_agg(member_id ORDER BY member_id) = (SELECT array_agg(x ORDER BY x) FROM unnest(ARRAY[$AUTO]::uuid[]) x) FROM public.cell_report_participants WHERE report_id = '$R'"
check "dois eventos de alteração: o de Ana (Lia incluída) e o de Beto (tema e Lia retirada)" \
  "SELECT array_agg(jsonb_build_object('a', actor_user_id, 'add', changes #> '{participants,added}', 'rm', changes #> '{participants,removed}',
                                       'f', changed_fields) ORDER BY seq)
        = ARRAY[jsonb_build_object('a', '$U1', 'add', jsonb_build_array(jsonb_build_object('id', '$M_L', 'name', 'E205 Conc Lia')), 'rm', '[]'::jsonb, 'f', NULL),
                jsonb_build_object('a', '$U2', 'add', '[]'::jsonb,
                                   'rm', jsonb_build_array(jsonb_build_object('id', '$M_L', 'name', 'E205 Conc Lia')), 'f', ARRAY['theme'])]
     FROM public.events WHERE entity_id = '$R' AND action = 'update'"
matches_last cell_reports cell_report "$R" "RN-13 b: a última alteração do relatório é a de Beto"

echo "3a. participantes × delete_cell_report"
base; R=$(R1)
pair c3a "$U1" "BEGIN; SELECT public.save_cell_report('$R', '{}', ARRAY[$AUTO, '$M_R']::uuid[]); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U2" "SELECT public.delete_cell_report('$R');"
both_ok c3a
check "o relatório ficou excluído por Beto, com Rita entre os participantes" \
  "SELECT r.deleted_by = '$M_B' AND r.deleted_at = r.updated_at AND EXISTS (SELECT 1 FROM public.cell_report_participants p WHERE p.report_id = r.id AND p.member_id = '$M_R')
     FROM public.cell_reports r WHERE r.id = '$R'"
matches_last cell_reports cell_report "$R" "RN-13 b: a última alteração é a exclusão (o último evento)"
echo "3b. restore_cell_report × participantes"
pair c3b "$U1" "BEGIN; SELECT public.restore_cell_report('$R'); SELECT pg_sleep($HOLD); COMMIT;" \
         "$U2" "SELECT public.save_cell_report('$R', '{}', ARRAY[$AUTO, '$M_R', '$M_L']::uuid[]);"
# Beto espera a trava do relatório (save_cell_report, FOR NO KEY UPDATE) e relê a linha já restaurada: passa.
# Fica a tolerância ao 42501 do desenho do E2.05. O que importa: estado válido.
A=$(outcome "$TMP/c3b.A"); B=$(outcome "$TMP/c3b.B")
if [ "$A" = "OK" ] && { [ "$B" = "OK" ] || echo "$B" | grep -q '^42501'; }; then echo "  PASS  c3b: Ana restaura; Beto passa ou recebe 42501, sem deadlock (B=$B)"
else echo "  FAIL  c3b: A=$A | B=$B"; FAILS=$((FAILS + 1)); fi
check "restaurado por Ana; Lia só entra se a gravação de Beto passou" \
  "SELECT r.deleted_at IS NULL AND (r.updated_by = '$M_B') = EXISTS (SELECT 1 FROM public.cell_report_participants p WHERE p.report_id = r.id AND p.member_id = '$M_L')
     FROM public.cell_reports r WHERE r.id = '$R'"
matches_last cell_reports cell_report "$R" "RN-13 b: a última alteração é a do último evento"
session "$U2" "SELECT public.save_cell_report('$R', '{}', ARRAY[$AUTO, '$M_R', '$M_L']::uuid[]);" > "$TMP/c3c"
check "a nova tentativa de Beto grava, e a última alteração passa a ser dele" \
  "SELECT r.updated_by = '$M_B' AND EXISTS (SELECT 1 FROM public.cell_report_participants p WHERE p.report_id = r.id AND p.member_id = '$M_L')
     FROM public.cell_reports r WHERE r.id = '$R'"

echo "4. troca do cônjuge × alteração do cônjuge"
base
pair c4 "$U1" "BEGIN; UPDATE public.members SET spouse_id = '$M_PA' WHERE id = '$M_O'; SELECT pg_sleep($HOLD); COMMIT;" \
        "$U2" "UPDATE public.members SET notes = 'Beto' WHERE id = '$M_PA';"
both_ok c4
check "Paula casada com Otávio e com a nota de Beto; a última alteração dela é a de Beto" \
  "SELECT spouse_id = '$M_O' AND notes = 'Beto' AND updated_by = '$M_B' FROM public.members WHERE id = '$M_PA'"
matches_last members member "$M_PA" "RN-05/RN-13 b: Paula: a última alteração é a do último evento"
matches_last members member "$M_O" "RN-05/RN-13 b: Otávio: a última alteração é a do último evento (Ana)"

echo "5. duas trocas da função padrão"
base
pair c5 "$U1" "BEGIN; SELECT public.save_role('$RA', 'E205 Conc Função A', NULL, '{view_dashboard}', true, NULL); SELECT pg_sleep($HOLD); COMMIT;" \
        "$U2" "SELECT public.save_role('$RB', 'E205 Conc Função B', NULL, '{view_dashboard}', true, NULL);"
both_ok c5
check "a padrão final é a B" "SELECT is_default FROM public.roles WHERE id = '$RB'"
check "o evento da A diz que antes era a padrão de antes; o da B, que antes era a A" \
  "SELECT (SELECT changes #>> '{default_role,previous,id}' FROM public.events WHERE entity_id = '$RA' AND changes ? 'default_role') = '$DEFAULT0'
      AND (SELECT changes #>> '{default_role,previous,id}' FROM public.events WHERE entity_id = '$RB' AND changes ? 'default_role') = '$RA'
      AND (SELECT count(*) FROM public.events WHERE entity_id = '$RA' AND changes ? 'default_role') = 1"

echo "6. audit_purge × gravações"
base
q "INSERT INTO public.events (occurred_at, actor_kind, action, entity, description)
   SELECT now() - interval '3 years' - (i || ' seconds')::interval, 'system', 'update', 'member', 'E205 conc velho ' || i
     FROM generate_series(1, 20000) i" >/dev/null
pair c6 "" "SELECT private.audit_purge();" \
        "$U1" "DO \$\$ BEGIN FOR i IN 1..50 LOOP UPDATE public.members SET notes = 'n' || i WHERE id = '$M_L'; END LOOP; END \$\$;" 0
both_ok c6
check "os 20 mil eventos velhos saíram" "SELECT NOT EXISTS (SELECT 1 FROM public.events WHERE description LIKE 'E205 conc velho%')"
check "a gravação concorrente gravou o evento dela" "SELECT EXISTS (SELECT 1 FROM public.events WHERE entity_id = '$M_L' AND action = 'update')"
matches_last members member "$M_L" "RN-13 b: a última alteração de Lia é a do último evento"

if [ $FAILS -eq 0 ]; then echo "OK: todos os cenários"; exit 0; else echo "FALHOU: $FAILS verificação(ões)"; exit 1; fi
