#!/usr/bin/env bash
# E2.02 (PR 1): verificações das migrations que o pgTAP não alcança, porque
# precisam rodar o arquivo da migration (de novo) ou criar um valor de enum.
# Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), RN-16, RN-17,
# RN-22, DA-11, "Verificações obrigatórias (para o QA)" e critérios de pronto 1 e 2.
#
#   1. as quatro migrations rodam de novo, uma depois da outra e em bloco, sem
#      erro (cada vez dentro de uma transação desfeita no fim);
#   2. num banco com duas funções is_system, a migration 1 falha com a lista e
#      não muda nada;
#   3. RN-16 e RN-22 depois da migration 1, num banco com a função "Recepção"
#      (Visualizar Membros, legado) e outra com o Dashboard do ministério
#      (legado): as duas passam a ter a permissão nova e quem as tem continua
#      vendo o mesmo; a Membro volta a ser a única padrão; DA-11 corrige o
#      "Tem Liderança?" de quem tem líder;
#   4. RN-17: uma permissão nova (ALTER TYPE ... ADD VALUE, que não se desfaz)
#      entra sozinha na Administrador e não entra nas outras. Roda num banco de
#      rascunho (e202_scratch), criado e apagado pelo script, com o tipo e as
#      duas funções copiados do banco que está sendo testado.
#
# Usa só dados fictícios e nunca grava no banco testado (transações desfeitas).
#
# Uso (banco local do Supabase, nunca o remoto):
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" \
#     supabase/tests/concurrency/e202_migrations.sh
# Rode da raiz do mci-connect. Sai com código 1 se algum passo falhar.

set -uo pipefail

PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
MIG=${MIG:-supabase/migrations}
M1=$MIG/20261125140000_e202_01_data.sql
M2=$MIG/20261125140100_e202_02_scope.sql
M3=$MIG/20261125140200_e202_03_read.sql
M4=$MIG/20261125140300_e202_04_write.sql
TMP=$(mktemp -d "${TMPDIR:-/tmp}/e202mig.XXXXXX")
FAILS=0
trap 'rm -rf "$TMP"; $PSQL -X -q -c "DROP DATABASE IF EXISTS e202_scratch" >/dev/null 2>&1' EXIT

for f in "$M1" "$M2" "$M3" "$M4"; do [ -f "$f" ] || { echo "migration não encontrada: $f"; exit 2; }; done

ok()   { echo "  PASS  $1"; }
fail() { echo "  FAIL  $1"; FAILS=$((FAILS + 1)); }
expect() { # arquivo de saída, chave, valor esperado, descrição
  local got; got=$(grep -m1 "^CHK|$2|" "$1" | cut -d'|' -f3-)
  if [ "$got" = "$3" ]; then ok "$4"; else fail "$4 (esperado: $3; obtido: ${got:-<nada>})"; fi
}

# ---------------------------------------------------------------------------
echo "== 1. As migrations rodam de novo sem erro"
for n in 1 2 3 4; do
  eval f=\$M$n
  { echo "BEGIN;"; cat "$f"; cat "$f"; echo "ROLLBACK;"; } | $PSQL -X -q -v ON_ERROR_STOP=1 >"$TMP/rerun$n.out" 2>&1
  if [ $? -eq 0 ]; then ok "migration $n, duas vezes seguidas, sem erro"; else fail "migration $n repetida: $(grep -m1 ERROR "$TMP/rerun$n.out")"; fi
done
{ echo "BEGIN;"; for r in 1 2; do cat "$M1" "$M2" "$M3" "$M4"; done; echo "ROLLBACK;"; } | $PSQL -X -q -v ON_ERROR_STOP=1 >"$TMP/rerunall.out" 2>&1
if [ $? -eq 0 ]; then ok "as quatro, em ordem, duas vezes, sem erro"; else fail "as quatro repetidas: $(grep -m1 ERROR "$TMP/rerunall.out")"; fi
q() { $PSQL -X -q -At -v ON_ERROR_STOP=1 -c "$1"; }
if [ "$(q "SELECT count(*) FROM public.roles WHERE is_system")" = "1" ]; then ok "o banco testado não foi alterado (uma função de sistema)"; else fail "o banco testado mudou"; fi

# ---------------------------------------------------------------------------
echo "== 2. Duas funções is_system: a migration 1 falha sem mudar nada"
{
  echo "BEGIN;"
  echo "SET LOCAL app.role_maintenance = 'on';"
  echo "DROP INDEX public.roles_single_system_idx;"
  echo "INSERT INTO public.roles (id, name, is_system) VALUES ('f202c0de-0002-0000-0000-0000000000aa', 'f202 Segunda de sistema', true);"
  echo "SET LOCAL app.role_maintenance = 'off';"
  echo "CREATE TEMP TABLE snap0 AS SELECT md5((SELECT coalesce(string_agg(r::text, '|' ORDER BY r.id), '') FROM public.roles r) || (SELECT coalesce(string_agg(p::text, '|' ORDER BY p.role_id, p.permission), '') FROM public.role_permissions p)) AS h;"
  echo "SELECT 'CHK|systems_before|' || count(*) FROM public.roles WHERE is_system;"
  echo "SAVEPOINT s;"
  cat "$M1"
  echo "ROLLBACK TO s;"
  echo "SELECT 'CHK|unchanged|' || (md5((SELECT coalesce(string_agg(r::text, '|' ORDER BY r.id), '') FROM public.roles r) || (SELECT coalesce(string_agg(p::text, '|' ORDER BY p.role_id, p.permission), '') FROM public.role_permissions p)) = (SELECT h FROM snap0));"
  echo "ROLLBACK;"
} | $PSQL -X -q -At -v ON_ERROR_STOP=0 >"$TMP/dual.out" 2>&1
expect "$TMP/dual.out" systems_before 2 "a base de teste tem duas funções is_system"
if grep -q "existe mais de uma função de sistema" "$TMP/dual.out" && grep -q "Administrador, f202 Segunda de sistema" "$TMP/dual.out"; then
  ok "a migration 1 falha com a mensagem e a lista das funções"; else fail "a migration 1 não falhou como esperado: $(grep -m1 ERROR "$TMP/dual.out")"; fi
expect "$TMP/dual.out" unchanged true "e não muda nada (roles e role_permissions iguais)"

# ---------------------------------------------------------------------------
echo "== 3. RN-16, RN-22 e DA-11 depois da migration 1 (Recepção com Visualizar Membros)"
{
  echo "BEGIN;"
  cat <<'SQL'
SET LOCAL app.role_maintenance = 'on';
INSERT INTO auth.users (id, email) VALUES ('a202f202-0000-0000-0000-000000000001', 'e202-mig-1@teste.invalid'), ('a202f202-0000-0000-0000-000000000002', 'e202-mig-2@teste.invalid');
INSERT INTO public.roles (id, name) VALUES ('b202f202-0000-0000-0000-000000000001', 'f202 Recepção'), ('b202f202-0000-0000-0000-000000000002', 'f202 Painel');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('b202f202-0000-0000-0000-000000000001', 'view_members'), ('b202f202-0000-0000-0000-000000000001', 'view_dashboard'),
  ('b202f202-0000-0000-0000-000000000002', 'view_own_ministry'), ('b202f202-0000-0000-0000-000000000002', 'view_own_ministry_dashboard');
SET LOCAL app.role_maintenance = 'off';
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership) VALUES ('c202f202-0000-0000-0000-000000000001', 'F202 Pastor', 'M', true, false);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, auth_user_id, role_id) VALUES
  ('c202f202-0000-0000-0000-000000000002', 'F202 Recepcionista', 'F', 'c202f202-0000-0000-0000-000000000001', true, 'a202f202-0000-0000-0000-000000000001', 'b202f202-0000-0000-0000-000000000001'),
  ('c202f202-0000-0000-0000-000000000003', 'F202 Painel', 'M', 'c202f202-0000-0000-0000-000000000001', true, 'a202f202-0000-0000-0000-000000000002', 'b202f202-0000-0000-0000-000000000002');
-- Estado "antes" (como se a migration ainda não tivesse rodado): padrão errada, cadastro com líder sem a chave, permissões aposentadas e a Líder alterada.
SET LOCAL session_replication_role = replica;
UPDATE public.roles SET is_default = false;
UPDATE public.roles SET is_default = true WHERE name = 'Líder';
UPDATE public.members SET has_leadership = false WHERE id = 'c202f202-0000-0000-0000-000000000003';
DELETE FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE name = 'Líder') AND permission = 'delete_cell_report';
INSERT INTO public.role_permissions (role_id, permission) VALUES ((SELECT id FROM public.roles WHERE name = 'Líder'), 'view_roles');
DELETE FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE name = 'Membro');
SET LOCAL session_replication_role = origin;
SELECT 'CHK|before_retired|' || count(*) FROM public.role_permissions WHERE permission IN ('view_members', 'view_own_ministry_dashboard');
SQL
  cat "$M1"
  cat <<'SQL'
SELECT 'CHK|retired_after|' || count(*) FROM public.role_permissions WHERE permission IN ('view_members', 'view_own_ministry_dashboard');
SELECT 'CHK|recepcao|' || (SELECT string_agg(permission::text, ',' ORDER BY permission::text) FROM public.role_permissions WHERE role_id = 'b202f202-0000-0000-0000-000000000001');
SELECT 'CHK|painel|' || (SELECT string_agg(permission::text, ',' ORDER BY permission::text) FROM public.role_permissions WHERE role_id = 'b202f202-0000-0000-0000-000000000002');
SELECT 'CHK|default|' || (SELECT string_agg(name, ',') FROM public.roles WHERE is_default);
SELECT 'CHK|lider|' || (SELECT string_agg(permission::text, ',' ORDER BY permission::text) FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE name = 'Líder'));
SELECT 'CHK|membro|' || (SELECT string_agg(permission::text, ',' ORDER BY permission::text) FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE name = 'Membro'));
SELECT 'CHK|admin_rows|' || ((SELECT count(*) FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE is_system)) = cardinality(public.active_permissions()));
SELECT 'CHK|has_leadership|' || (SELECT has_leadership FROM public.members WHERE id = 'c202f202-0000-0000-0000-000000000003');
SELECT 'CHK|systems|' || count(*) FROM public.roles WHERE is_system;
-- Quem tem a Recepção continua vendo a igreja toda; quem tem o Painel (Seu Ministério + Dashboard) vê só o ministério (dele, sem ninguém abaixo).
SELECT set_config('request.jwt.claims', '{"sub":"a202f202-0000-0000-0000-000000000001","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT 'CHK|recepcao_ve_igreja|' || ((SELECT count(*) FROM public.members_view) = (SELECT count(*) FROM public.members WHERE deleted_at IS NULL) );
SELECT 'CHK|recepcao_dashboard|' || (SELECT members_total FROM public.dashboard_summary()) ;
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"a202f202-0000-0000-0000-000000000002","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT 'CHK|painel_dashboard|' || (SELECT count(*) FROM public.dashboard_summary());
RESET ROLE;
ROLLBACK;
SQL
} | $PSQL -X -q -At -v ON_ERROR_STOP=0 >"$TMP/data.out" 2>&1
grep -m1 -E "^(psql:.*)?ERROR" "$TMP/data.out" && fail "erro ao rodar a migration 1 sobre o estado de teste"
expect "$TMP/data.out" before_retired 2 "antes: duas linhas aposentadas (Recepção e Painel)"
expect "$TMP/data.out" retired_after 0 "RN-22: nenhuma linha aposentada sobra"
expect "$TMP/data.out" recepcao "view_all_church,view_dashboard" "RN-22: a Recepção troca Visualizar Membros (legado) por Visualizar Toda a Igreja e mantém o resto"
expect "$TMP/data.out" painel "view_dashboard,view_own_ministry" "RN-22: o Dashboard do ministério (legado) vira Visualizar Dashboard"
expect "$TMP/data.out" default Membro "RN-19: a Membro volta a ser a única função padrão"
expect "$TMP/data.out" lider "create_cell,create_member,delete_cell,delete_cell_report,delete_member,edit_cell,edit_cell_report,edit_member,edit_own_data,submit_own_cell_report,view_dashboard,view_own_ministry" "RN-16: a Líder volta a ter exatamente as 12 permissões da tabela (sem Visualizar Funções)"
expect "$TMP/data.out" membro "edit_own_data,submit_own_cell_report,view_dashboard,view_own_ministry" "RN-16: a Membro volta a ter exatamente as 4 permissões da tabela"
expect "$TMP/data.out" admin_rows true "RN-17: a Administrador tem uma linha por permissão ativa"
expect "$TMP/data.out" has_leadership true "DA-11: o cadastro com líder e sem a chave passa a ter Tem Liderança"
expect "$TMP/data.out" systems 1 "continua uma só função de sistema"
expect "$TMP/data.out" recepcao_ve_igreja true "RN-22: quem tinha a Recepção continua vendo a igreja toda"
expect "$TMP/data.out" painel_dashboard 1 "RN-22: quem tinha o Dashboard do ministério continua com acesso ao dashboard"

# ---------------------------------------------------------------------------
echo "== 4. RN-17: uma permissão nova entra sozinha na Administrador (banco de rascunho)"
SCR="$PSQL -X -q -At -v ON_ERROR_STOP=1 -d e202_scratch"
q "DROP DATABASE IF EXISTS e202_scratch" >/dev/null
q "CREATE DATABASE e202_scratch" >/dev/null
LABELS=$(q "SELECT string_agg(quote_literal(e::text), ', ' ORDER BY e) FROM unnest(enum_range(NULL::public.permission_action)) e")
FN_ACTIVE=$(q "SELECT pg_get_functiondef('public.active_permissions()'::regprocedure)")
FN_EFF=$(q "SELECT pg_get_functiondef('public.role_effective_permissions(uuid)'::regprocedure)")
{
  echo "CREATE TYPE public.permission_action AS ENUM ($LABELS);"
  echo "CREATE TABLE public.roles (id uuid PRIMARY KEY, name text, is_system boolean NOT NULL DEFAULT false);"
  echo "CREATE TABLE public.role_permissions (role_id uuid REFERENCES public.roles(id), permission public.permission_action, PRIMARY KEY (role_id, permission));"
  echo "$FN_ACTIVE;"
  echo "$FN_EFF;"
  echo "INSERT INTO public.roles VALUES ('00000000-0000-0000-0000-000000000001', 'Administrador', true), ('00000000-0000-0000-0000-000000000002', 'Líder', false);"
  echo "INSERT INTO public.role_permissions VALUES ('00000000-0000-0000-0000-000000000002', 'view_dashboard'), ('00000000-0000-0000-0000-000000000002', 'edit_member');"
  echo "SELECT 'CHK|admin_before|' || cardinality(public.role_effective_permissions('00000000-0000-0000-0000-000000000001')) || '/' || cardinality(public.active_permissions());"
  echo "ALTER TYPE public.permission_action ADD VALUE 'manage_schools';"
} | $SCR >"$TMP/enum1.out" 2>&1
# Em outra transação, depois do commit do ALTER TYPE.
{
  echo "SELECT 'CHK|admin_after|' || (cardinality(public.role_effective_permissions('00000000-0000-0000-0000-000000000001')) = cardinality(public.active_permissions()));"
  echo "SELECT 'CHK|admin_has_new|' || ('manage_schools' = ANY (public.role_effective_permissions('00000000-0000-0000-0000-000000000001')));"
  echo "SELECT 'CHK|active_has_new|' || ('manage_schools' = ANY (public.active_permissions()));"
  echo "SELECT 'CHK|lider_has_new|' || ('manage_schools' = ANY (public.role_effective_permissions('00000000-0000-0000-0000-000000000002')));"
  echo "SELECT 'CHK|lider_count|' || cardinality(public.role_effective_permissions('00000000-0000-0000-0000-000000000002'));"
  echo "SELECT 'CHK|admin_rows|' || (SELECT count(*) FROM public.role_permissions WHERE role_id = '00000000-0000-0000-0000-000000000001');"
} | $SCR >"$TMP/enum2.out" 2>&1
grep -m1 ERROR "$TMP/enum1.out" "$TMP/enum2.out"
A=$(grep -m1 '^CHK|admin_before|' "$TMP/enum1.out" | cut -d'|' -f3)
if [ -n "$A" ] && [ "${A%/*}" = "${A#*/}" ]; then ok "antes: a Administrador tem todas as ${A%/*} permissões ativas (sem linhas em role_permissions)"; else fail "antes: ${A:-<nada>}"; fi
expect "$TMP/enum2.out" admin_after true "RN-17: depois da permissão nova, a Administrador continua com todas as ativas"
expect "$TMP/enum2.out" admin_has_new true "RN-17: e a permissão nova (Gerenciar escolas) está nela, sem configuração"
expect "$TMP/enum2.out" active_has_new true "e a lista de permissões ativas a inclui"
expect "$TMP/enum2.out" lider_has_new false "RN-17: a Líder não a recebe"
expect "$TMP/enum2.out" lider_count 2 "RN-17: nem muda de tamanho (duas permissões)"
expect "$TMP/enum2.out" admin_rows 0 "RN-17: sem nenhuma linha em role_permissions para a Administrador"

echo
if [ "$FAILS" -eq 0 ]; then echo "Todas as verificações passaram."; else echo "$FAILS verificação(ões) falharam."; exit 1; fi
