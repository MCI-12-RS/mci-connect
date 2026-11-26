#!/usr/bin/env bash
# E2.05, critério de pronto 1 e RN-12: as migrations e205_01 a e205_06 rodam de novo sem erro num banco que
# já as tem e a segunda rodada não muda nada; e (modo "upgrade") as seis rodam por cima de uma massa gravada
# pelos triggers de antes deste passo, convertem os eventos e preenchem a autoria, e rodar de novo não muda nada.
# Use SÓ no banco local.
#
# Uso:
#   PSQL="docker exec -i supabase_db_<projeto> psql -U postgres" supabase/tests/concurrency/e205_migrations.sh
#       — banco com as migrations do E2.05 já aplicadas: cada uma roda de novo numa transação desfeita.
#   PSQL=... supabase/tests/concurrency/e205_migrations.sh upgrade
#       — banco SEM as migrations do E2.05 (por exemplo: supabase db reset --version 20261127100100): grava a
#         massa antiga, aplica as seis (gravando), confere e roda de novo. Depois, refaça o banco (db reset).
#   seed / check: as duas metades do upgrade, para aplicar as migrations pelo caminho da CLI no meio
#       (seed → supabase migration up → check), como o "Deploy: banco".
set -uo pipefail
PSQL=${PSQL:-"docker exec -i supabase_db_mci-connect psql -U postgres"}
DIR=$(cd "$(dirname "$0")/../../migrations" && pwd)
MIGS=$(ls "$DIR"/*_e205_0[1-6]_*.sql)
FAILS=0

# O que as migrations criam e o que a 5 preenche: estrutura, privilégios, funções, triggers, views, o job,
# a lista de campos, os eventos e a autoria dos registros.
STATE="SELECT md5(concat_ws('#',
  (SELECT string_agg(p.oid::regprocedure::text || md5(pg_get_functiondef(p.oid)) || coalesce(array_to_string(p.proacl, ' '), ''), ','
                     ORDER BY p.oid::regprocedure::text)
     FROM pg_proc p WHERE p.proname ~ '^(audit_|current_actor|stamp_authorship|legacy_author|save_cell_report|_log_event|enforce_participant_rules)'),
  (SELECT string_agg(tgrelid::regclass::text || pg_get_triggerdef(oid), ',' ORDER BY tgrelid::regclass::text, tgname)
     FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.members'::regclass, 'public.cells'::regclass, 'public.cell_reports'::regclass,
       'public.cell_report_participants'::regclass, 'public.roles'::regclass, 'public.role_permissions'::regclass)),
  (SELECT string_agg(c.relname || md5(pg_get_viewdef(c.oid)) || coalesce(array_to_string(c.relacl, ' '), ''), ',' ORDER BY c.relname)
     FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'v'),
  (SELECT string_agg(conrelid::regclass::text || conname || pg_get_constraintdef(oid), ',' ORDER BY conrelid::regclass::text, conname)
     FROM pg_constraint WHERE conrelid IN ('public.members'::regclass, 'public.cells'::regclass, 'public.cell_reports'::regclass, 'public.events'::regclass)),
  (SELECT string_agg(attrelid::regclass::text || attname || format_type(atttypid, atttypmod) || attnotnull::text
                     || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY attrelid::regclass::text, attnum)
     FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE attrelid IN ('public.members'::regclass, 'public.cells'::regclass, 'public.cell_reports'::regclass, 'public.events'::regclass)
      AND attnum > 0 AND NOT attisdropped),
  (SELECT string_agg(relname || coalesce(array_to_string(relacl, ' '), '') || coalesce(array_to_string(relacl, ' '), ''), ',' ORDER BY relname)
     FROM pg_class WHERE relname IN ('events', 'audit_fields', 'members')),
  (SELECT string_agg(jobname || schedule || command, ',' ORDER BY jobname) FROM cron.job),
  (SELECT string_agg(to_jsonb(f)::text, ',' ORDER BY f.entity, f.position) FROM private.audit_fields f),
  (SELECT md5(string_agg(to_jsonb(e)::text, ';' ORDER BY e.id)) FROM public.events e),
  (SELECT md5(string_agg(to_jsonb(m)::text, ';' ORDER BY m.id)) FROM public.members m),
  (SELECT md5(string_agg(to_jsonb(c)::text, ';' ORDER BY c.id)) FROM public.cells c),
  (SELECT md5(string_agg(to_jsonb(r)::text, ';' ORDER BY r.id)) FROM public.cell_reports r)));"

rerun_all() {
  local f out
  for f in $MIGS; do
    out=$({ echo 'BEGIN;'; echo "$STATE"; cat "$f"; echo; echo "$STATE"; echo 'ROLLBACK;'; } \
          | $PSQL -X -q -At -v ON_ERROR_STOP=1 2>&1 | grep -v -e NOTICE -e '^ schedule' -e '^[0-9]*$')
    if ! echo "$out" | grep -q 'ERROR' && [ "$(echo "$out" | grep -c .)" -eq 2 ] && [ "$(echo "$out" | sort -u | wc -l)" -eq 1 ]; then
      echo "  PASS  roda de novo sem erro e sem mudar nada: $(basename "$f")"
    else echo "  FAIL  $(basename "$f"): $(echo "$out" | head -3)"; FAILS=$((FAILS + 1)); fi
  done
}

if [ -z "${1:-}" ]; then
  rerun_all
  [ $FAILS -eq 0 ] && echo "OK: as seis migrations rodam de novo sem mudar nada" || echo "FALHOU: $FAILS"
  exit $([ $FAILS -eq 0 ] && echo 0 || echo 1)
fi

# ---------------------------------------------------------------------------------------------------------------
# Modo upgrade: a massa antiga, gravada pelos triggers de antes do E2.05 (o formato de produção).
# ---------------------------------------------------------------------------------------------------------------
MODE=$1
if [ "$MODE" != "check" ]; then
if [ "$($PSQL -X -At -c "SELECT to_regprocedure('private.current_actor()') IS NULL")" != "t" ]; then
  echo "FAIL: o banco já tem o E2.05; rode antes: supabase db reset --version 20261127100100"; exit 1
fi
$PSQL -X -q -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
  ('a205f000-0000-0000-0000-000000000001', 'e205-up-1@teste.invalid', now()),
  ('a205f000-0000-0000-0000-000000000002', 'e205-up-2@teste.invalid', now());
INSERT INTO public.members (id, name, gender, is_pastor, has_leadership, mobile_whatsapp, auth_user_id, role_id)
VALUES ('c205f000-0000-0000-0000-000000000001', 'Pastor Upgrade', 'M', true, false, '51920599001',
        'a205f000-0000-0000-0000-000000000001', (SELECT id FROM public.roles WHERE is_system));
-- Como um usuário logado (o autor vem da sessão nos triggers antigos).
SELECT set_config('request.jwt.claims', '{"sub": "a205f000-0000-0000-0000-000000000001", "role": "authenticated"}', false);
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp, auth_user_id, role_id) VALUES
  ('c205f000-0000-0000-0000-000000000002', 'Ana Upgrade', 'F', 'c205f000-0000-0000-0000-000000000001', true, '51920599002',
   'a205f000-0000-0000-0000-000000000002', (SELECT id FROM public.roles WHERE is_system)),
  ('c205f000-0000-0000-0000-000000000003', 'Otávio Upgrade', 'M', 'c205f000-0000-0000-0000-000000000001', true, '51920599003', NULL, NULL),
  ('c205f000-0000-0000-0000-000000000004', 'Paula Upgrade', 'F', 'c205f000-0000-0000-0000-000000000001', true, '51920599004', NULL, NULL);
UPDATE public.members SET name = 'Otávio Upgrade Neto', mobile_whatsapp = '51920599013' WHERE id = 'c205f000-0000-0000-0000-000000000003';
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, meeting_day, meeting_time)
VALUES ('d205f000-0000-0000-0000-000000000001', 'c205f000-0000-0000-0000-000000000002', 'c205f000-0000-0000-0000-000000000003',
        'c205f000-0000-0000-0000-000000000003', 'Domingo', '00:00');
UPDATE public.cells SET meeting_time = '00:05', is_active = true WHERE id = 'd205f000-0000-0000-0000-000000000001';
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, offering)
VALUES ('e205f000-0000-0000-0000-000000000001', 'd205f000-0000-0000-0000-000000000001', public.sp_today(), '19:30', 'Fé', 50);
SELECT public.set_cell_report_participants('e205f000-0000-0000-0000-000000000001',
  ARRAY['c205f000-0000-0000-0000-000000000003', 'c205f000-0000-0000-0000-000000000004']::uuid[]);
SELECT set_config('request.jwt.claims', '{"sub": "a205f000-0000-0000-0000-000000000002", "role": "authenticated"}', false);
UPDATE public.members SET spouse_id = 'c205f000-0000-0000-0000-000000000004' WHERE id = 'c205f000-0000-0000-0000-000000000003';
SELECT public.delete_member('c205f000-0000-0000-0000-000000000004');
SELECT set_config('request.jwt.claims', '', false);
SQL
echo "  massa antiga gravada ($($PSQL -X -At -c "SELECT count(*) FROM public.events") eventos)"
[ "$MODE" = "seed" ] && exit 0
fi

[ "$MODE" = "upgrade" ] && for f in $MIGS; do
  out=$($PSQL -X -q -v ON_ERROR_STOP=1 -1 -f - < "$f" 2>&1 | grep -v NOTICE | grep -v '^ *[0-9]*$' | grep -v schedule | grep -v -- '---')
  if echo "$out" | grep -q 'ERROR'; then echo "  FAIL  $(basename "$f"): $out"; FAILS=$((FAILS + 1)); else echo "  PASS  aplicada: $(basename "$f")"; fi
done

check() {  # descrição, SQL que devolve 't'
  local r; r=$($PSQL -X -At -c "$2" 2>&1)
  if [ "$r" = "t" ]; then echo "  PASS  $1"; else echo "  FAIL  $1 ($r)"; FAILS=$((FAILS + 1)); fi
}
check "DT-11: nenhum evento sem actor_kind" "SELECT NOT EXISTS (SELECT 1 FROM public.events WHERE actor_kind IS NULL)"
check "DT-11: nenhum evento de participante como entidade própria" "SELECT NOT EXISTS (SELECT 1 FROM public.events WHERE entity = 'cell_report_participant')"
check "RN-20 e: nenhuma descrição com aaaa-mm-dd" "SELECT NOT EXISTS (SELECT 1 FROM public.events WHERE entity <> 'auth' AND description ~ '\d{4}-\d{2}-\d{2}')"
check "DT-11: 'Criou' virou 'Cadastrou' (com o original em metadata.v1)" \
  "SELECT EXISTS (SELECT 1 FROM public.events WHERE description = 'Cadastrou o membro Ana Upgrade' AND metadata #>> '{v1,description}' = 'Criou o membro Ana Upgrade')"
check "RN-12: Ana cadastrada pelo pastor (o autor do evento de cadastro)" \
  "SELECT created_by_kind = 'member' AND created_by = 'c205f000-0000-0000-0000-000000000001' FROM public.members WHERE id = 'c205f000-0000-0000-0000-000000000002'"
check "RN-12: Otávio com a última alteração de Ana (o cônjuge)" \
  "SELECT updated_by = 'c205f000-0000-0000-0000-000000000002' FROM public.members WHERE id = 'c205f000-0000-0000-0000-000000000003'"
check "RN-12: Paula excluída por Ana (deleted_by do E2.01)" \
  "SELECT deleted_by_kind = 'member' AND deleted_by = 'c205f000-0000-0000-0000-000000000002' FROM public.members WHERE id = 'c205f000-0000-0000-0000-000000000004'"
check "DA-3: o relatório com os participantes do envio (60 s) mostra só o envio" \
  "SELECT updated_at IS NULL AND created_by = 'c205f000-0000-0000-0000-000000000001' FROM public.cell_reports WHERE id = 'e205f000-0000-0000-0000-000000000001'"
check "DA-2: o pastor, gravado sem sessão: o evento de cadastro sem autor dá Sistema" \
  "SELECT created_by_kind = 'system' FROM public.members WHERE id = 'c205f000-0000-0000-0000-000000000001'"

echo "  rodando as seis de novo sobre a massa convertida…"
rerun_all
[ $FAILS -eq 0 ] && echo "OK: upgrade e reexecução sem diferença" || echo "FALHOU: $FAILS"
exit $([ $FAILS -eq 0 ] && echo 0 || echo 1)
