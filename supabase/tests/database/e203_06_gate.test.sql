-- E2.03 (PR 4, tarefa 13): o portão (RN-09, RN-16), a Líder com a redefinição (RN-01) e a marca na
-- publicação (RN-08 c), da migration 5 (e203_05_gate).
-- Spec: docs/specs/e2-03-senha.md, "O portão (RN-09 e RN-16)", "Marca na publicação (RN-08 c)",
-- "Verificações obrigatórias (para o QA)" (RN-08 c, RN-09 teste de catálogo, RN-16), DT-04, DT-13, DA-9.
--
-- Cobre:
--   - estrutura: private.assert_gate e private.mark_initial_passwords sem EXECUTE para ninguém da API; as três
--     portas (viewer_member_id, viewer_has, default_role_id) definer e chamando o portão; a lista fechada
--     de utilitárias fora do portão é toda SECURITY INVOKER (só leem o que quem chama já lê);
--   - teste de catálogo (RN-09 e RN-16): toda tabela e view da public com SELECT para authenticated, toda
--     tabela com UPDATE ou DELETE e toda função da public com EXECUTE para authenticated (fora as de
--     trigger, as de extensão e a lista fechada) responde com o código do portão ou volta vazia, para:
--       a) Caio (Membro) com a marca;          b) Rita (Administrador) com a marca;
--       c) Davi (Líder) com a sessão apagada (session_ended);
--       d) Caio com a marca e um token sem session_id (DA-9: só a marca é conferida).
--     As funções precisam recusar com o código (nenhuma pode "voltar vazia"), e nada muda no banco;
--   - controle: Ana (Administrador, sem marca) lê cada tabela e view com pelo menos uma linha, para o
--     catálogo não passar por estar vazio; a lista fechada responde para quem tem a marca;
--   - "na hora": a marca posta com a sessão aberta recusa a próxima chamada e não encerra a sessão;
--   - RN-01: a Líder tem change_member_password, e Davi (Líder, sessão nova) redefine Eva;
--   - RN-08 c: private.mark_initial_passwords sobre uma massa com 123456 (ativa, suspensa, já marcada,
--     senha forte, sem linha no cofre), a Auditoria sem autor, rodar de novo não marca nem registra, a
--     restauração (E2.01) mantém a marca.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db
--
-- Quando outro passo trouxer uma tabela, view ou função nova com privilégio para authenticated, este
-- teste a pega sozinho: ou ela passa pelo portão (viewer_member_id, viewer_has ou default_role_id), ou
-- entra na lista fechada com uma justificativa no spec.

BEGIN;

-- E2.11 PR 2 (DA-11): as massas gravam relatórios e participantes direto (inclusive de semanas
-- passadas); fora das RPCs, só com a marca de manutenção.
SET LOCAL mci.cell_report_write = 'on';

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(54);

-- ---------------------------------------------------------------------------
-- Ids fixos: u = auth, m = membros, s = sessões.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2036000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2036000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.s(_n int, _k int DEFAULT 1) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('5e536000-0000-0000-' || lpad(_k::text, 4, '0') || '-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192036' || lpad(_n::text, 4, '0') $$;

-- Executa _sql (um SELECT que devolve jsonb) como o usuário _n, com a sessão _k nas claims
-- (_k = 0: token sem session_id). Devolve o jsonb, ou {"error": SQLSTATE, "code": código do app_error}.
CREATE FUNCTION pg_temp.api(_n int, _sql text, _k int DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out jsonb; _state text; _detail text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated',
                        'session_id', CASE WHEN _k > 0 THEN pg_temp.s(_n, _k) END)::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN coalesce(_out, 'null'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('error', _state, 'code', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ->> 'code' END);
  END;
END $$;

-- Como pg_temp.api, mas sempre desfaz o que a chamada gravou (para o controle, que chama tudo sem portão).
CREATE FUNCTION pg_temp.api_undo(_n int, _sql text, _k int DEFAULT 1) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb; _msg text; _detail text;
BEGIN
  BEGIN
    _r := pg_temp.api(_n, _sql, _k);
    RAISE EXCEPTION 'e2036_undo' USING DETAIL = _r::text;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _msg = MESSAGE_TEXT, _detail = PG_EXCEPTION_DETAIL;
    IF _msg <> 'e2036_undo' THEN RAISE; END IF;
    RETURN _detail::jsonb;
  END;
END $$;

-- Conta de acesso: sem senha no Auth, com a senha no cofre e a sessão 1 aberta.
CREATE FUNCTION pg_temp.acct(_n int, _password text DEFAULT 'Forte@2024x') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pg_temp.u(_n), 'e2036-' || _n || '@teste.invalid', now());
  PERFORM private.write_password(pg_temp.u(_n), pg_temp.m(_n), _password, NULL);
  INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(_n, 1), pg_temp.u(_n));
END $$;

-- ---------------------------------------------------------------------------
-- Massa
--  1 Samuel (pastor, Líder)          2 Rita (Administrador, de Samuel)     3 Ana (Administrador, de Samuel)
--  4 Caio (Membro, de Davi)          5 Davi (Líder, de Samuel)             6 Eva (Membro, de Davi)
--  7 Nina (Membro, de Davi, excluída por Ana)  8 Gil (Gate Gestor, de Samuel)  9 Lauro (Membro, de Davi, sem conta)
-- Célula de Davi (timóteo Eva, anfitrião Caio) com o relatório da semana e os participantes; uma célula
-- excluída e um relatório excluído (para as listas de excluídos terem linha).
-- ---------------------------------------------------------------------------
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(1), 'Samuel Gate', 'M', true, NULL, false, true, pg_temp.mob(1), pg_temp.role('Líder'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(2), 'Rita Gate', 'F', pg_temp.m(1), true, true, pg_temp.mob(2), pg_temp.role('Administrador')),
  (pg_temp.m(3), 'Ana Gate', 'F', pg_temp.m(1), true, true, pg_temp.mob(3), pg_temp.role('Administrador')),
  (pg_temp.m(5), 'Davi Gate', 'M', pg_temp.m(1), true, true, pg_temp.mob(5), pg_temp.role('Líder'));
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(4), 'Caio Gate', 'M', pg_temp.m(5), true, true, pg_temp.mob(4), pg_temp.role('Membro')),
  (pg_temp.m(6), 'Eva Gate', 'F', pg_temp.m(5), true, true, pg_temp.mob(6), pg_temp.role('Membro')),
  (pg_temp.m(7), 'Nina Gate', 'F', pg_temp.m(5), true, true, pg_temp.mob(7), pg_temp.role('Membro'));
-- 8 Gil (função "Gate Gestor": a Líder e a Membro mais igreja toda, atribui funções e redefine; não cobre a Administrador).
INSERT INTO public.roles (id, name) VALUES ('b2036000-0000-0000-0000-000000000001', 'Gate Gestor');
INSERT INTO public.role_permissions (role_id, permission) VALUES
  ('b2036000-0000-0000-0000-000000000001', 'view_all_church'), ('b2036000-0000-0000-0000-000000000001', 'assign_role'),
  ('b2036000-0000-0000-0000-000000000001', 'change_member_password');
INSERT INTO public.role_permissions (role_id, permission)
SELECT 'b2036000-0000-0000-0000-000000000001', rp.permission FROM public.role_permissions rp
 WHERE rp.role_id IN (pg_temp.role('Líder'), pg_temp.role('Membro')) ON CONFLICT DO NOTHING;
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(8), 'Gil Gate', 'M', pg_temp.m(1), true, true, pg_temp.mob(8), 'b2036000-0000-0000-0000-000000000001');
-- 9 Lauro (Membro, de Davi, sem conta).
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(9), 'Lauro Gate', 'M', pg_temp.m(5), true, true, pg_temp.mob(9), pg_temp.role('Membro'));
SELECT pg_temp.acct(n) FROM generate_series(1, 8) n;
UPDATE public.members SET auth_user_id = pg_temp.u(n) FROM generate_series(1, 8) n WHERE id = pg_temp.m(n);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  ('ce036000-0000-0000-0000-000000000001', pg_temp.m(5), pg_temp.m(6), pg_temp.m(4), 'Evangelística', 'Domingo', '08:00'),
  ('ce036000-0000-0000-0000-000000000002', pg_temp.m(5), pg_temp.m(6), pg_temp.m(4), 'Discipulado', 'Domingo', '08:00'),
  ('ce036000-0000-0000-0000-000000000003', pg_temp.m(5), pg_temp.m(6), pg_temp.m(4), 'Macrocélula', 'Domingo', '08:00');
INSERT INTO public.cell_reports (id, cell_id, date, time, theme, visitors) VALUES
  ('be036000-0000-0000-0000-000000000001', 'ce036000-0000-0000-0000-000000000001', public.week_start(public.sp_today()), '08:30', 'Tema', '{Visitante}'),
  ('be036000-0000-0000-0000-000000000003', 'ce036000-0000-0000-0000-000000000003', public.week_start(public.sp_today()), '08:30', 'Tema', '{}');
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
  ('be036000-0000-0000-0000-000000000001', pg_temp.m(4)), ('be036000-0000-0000-0000-000000000001', pg_temp.m(6));

-- Exclusões feitas por Ana (Administrador), com a sessão dela.
SELECT pg_temp.api(3, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(7)));
SELECT pg_temp.api(3, 'SELECT to_jsonb(public.delete_cell(''ce036000-0000-0000-0000-000000000002''))');
SELECT pg_temp.api(3, 'SELECT to_jsonb(public.delete_cell_report(''be036000-0000-0000-0000-000000000003''))');

-- ===========================================================================
-- 1. Estrutura
-- ===========================================================================
SELECT is(has_function_privilege(r, 'private.assert_gate()', 'EXECUTE'), false, 'estrutura: ' || r || ' não executa private.assert_gate')
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT is((SELECT bool_or(has_function_privilege(r, 'private.mark_initial_passwords()', 'EXECUTE'))
             FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r), false,
  'estrutura: ninguém da API executa private.mark_initial_passwords');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p
            WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('viewer_member_id', 'viewer_has', 'default_role_id')
              AND p.prosecdef AND p.prosrc LIKE '%PERFORM private.assert_gate();%'),
  ARRAY['default_role_id', 'viewer_has', 'viewer_member_id'],
  'DT-04: as três portas são definer e chamam private.assert_gate()');

-- A lista fechada (fora do portão). As utilitárias são INVOKER: só leem o que quem chama já lê.
CREATE TEMP TABLE exempt (fn text PRIMARY KEY, why text NOT NULL);
INSERT INTO exempt VALUES
  ('my_password_status', 'a própria marca; confere só a sessão'),
  ('log_auth_event', 'logout (E2.01 DA-9)'),
  ('active_permissions', 'lista fixa'), ('sp_today', 'relógio'), ('sp_now', 'relógio'),
  ('week_start', 'data'), ('weekday_index', 'dia da semana'), ('search_normalize', 'texto'),
  ('normalize_digits', 'texto'), ('normalize_email', 'texto'), ('normalize_mobile', 'texto'),
  ('normalize_person_name', 'texto'), ('is_valid_cpf', 'texto'), ('is_valid_email', 'texto'),
  ('is_valid_person_name', 'texto'), ('mobile_match_key', 'texto'), ('is_placeholder_email', 'texto'),
  ('placeholder_email_domain', 'constante'), ('placeholder_email_domains', 'constante'),
  ('member_has_login_identifier', 'texto'), ('birth_date_problem', 'data'),
  ('cell_weekdays', 'lista fixa (E2.08)'), ('cell_types', 'lista fixa (E2.08)'), ('cell_default_type', 'constante (E2.08)'),
  ('normalize_meeting_time', 'horário (E2.08)'), ('is_valid_meeting_time', 'horário (E2.08)'),
  ('sp_local', 'relógio (E2.09)'), ('sp_instant', 'relógio (E2.09)'),
  ('legacy_author_label', 'texto: o nome do autor do legado (E2.05)'),
  ('cell_links_or_none', 'o próprio argumento (E2.07)'), ('sp_day_start', 'relógio (E2.07)'),
  ('first_distinct_ids', 'o próprio argumento (E2.10)');
SELECT is((SELECT array_agg(p.proname::text ORDER BY p.proname) FROM pg_proc p JOIN exempt e ON e.fn = p.proname
            WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef AND e.fn NOT IN ('my_password_status', 'log_auth_event')),
  NULL, 'RN-09: as utilitárias da lista fechada são todas SECURITY INVOKER');

-- O catálogo: o que authenticated alcança pela API (schema public).
CREATE TEMP TABLE cat_rel AS
SELECT c.oid::regclass::text AS rel, c.relkind::text AS kind,
       has_table_privilege('authenticated', c.oid, 'UPDATE') AS can_update,
       has_table_privilege('authenticated', c.oid, 'DELETE') AS can_delete,
       (SELECT a.attname::text FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
         ORDER BY a.attnum LIMIT 1) AS first_col
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'v', 'm', 'p', 'f')
   AND (has_table_privilege('authenticated', c.oid, 'SELECT') OR has_any_column_privilege('authenticated', c.oid, 'SELECT'));

CREATE TEMP TABLE cat_fn AS
SELECT p.oid::regprocedure::text AS sig, p.proname::text AS fn,
       format('SELECT coalesce(jsonb_agg(to_jsonb(t)), ''[]'') FROM public.%I(%s) t', p.proname,
         coalesce((SELECT string_agg(
           CASE
             WHEN a.typ = 'uuid'::regtype AND a.nm ~ 'report' THEN quote_literal('be036000-0000-0000-0000-000000000001') || '::uuid'
             WHEN a.typ = 'uuid'::regtype AND a.nm ~ 'cell'   THEN quote_literal('ce036000-0000-0000-0000-000000000001') || '::uuid'
             WHEN a.typ = 'uuid'::regtype AND a.nm ~ 'role'   THEN quote_literal(pg_temp.role('Membro')) || '::uuid'
             WHEN a.typ = 'uuid'::regtype                      THEN quote_literal(pg_temp.m(6)) || '::uuid'
             WHEN a.typ = 'uuid[]'::regtype                    THEN format('ARRAY[%L, %L]::uuid[]', pg_temp.m(6), pg_temp.m(4))
             WHEN a.typ = 'text'::regtype AND a.nm ~ 'email'   THEN quote_literal('nina.gate@exemplo.com')
             WHEN a.typ = 'text'::regtype AND a.nm ~ 'mobile'  THEN quote_literal(pg_temp.mob(7))
             WHEN a.typ = 'text'::regtype AND a.nm ~ 'cpf'     THEN quote_literal('52998224725')
             WHEN a.typ = 'text'::regtype                      THEN quote_literal('Nome Gate')
             WHEN a.typ = 'jsonb'::regtype THEN format('jsonb_build_object(''id'', %L, ''name'', ''Novo Gate'', ''gender'', ''M'', ''mobile_whatsapp'', %L, ''leader_id'', %L)',
                                                       pg_temp.m(99), pg_temp.mob(99), pg_temp.m(5))
             WHEN a.typ = 'public.permission_action'::regtype   THEN '''view_all_church''::public.permission_action'
             WHEN a.typ = 'public.permission_action[]'::regtype THEN '''{view_dashboard}''::public.permission_action[]'
             WHEN a.typ = 'public.event_action'::regtype        THEN '''logout''::public.event_action'
             WHEN a.typ = 'boolean'::regtype                    THEN 'false'
             WHEN a.typ = 'timestamptz'::regtype                THEN 'now()'
             WHEN a.typ = 'date'::regtype                       THEN 'current_date'
             WHEN a.typ IN ('integer'::regtype, 'bigint'::regtype) THEN '1'
             ELSE 'NULL::' || a.typ::regtype::text
           END, ', ' ORDER BY a.ord)
           FROM unnest(p.proargtypes::oid[], p.proargnames[1:p.pronargs]) WITH ORDINALITY a(typ, nm, ord)), '')) AS call
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
   AND p.prorettype <> 'trigger'::regtype
   AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
   AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
   AND p.proname NOT IN (SELECT fn FROM exempt);

SELECT cmp_ok((SELECT count(*)::int FROM cat_rel), '>=', 15, 'catálogo: pelo menos 15 tabelas e views com SELECT para authenticated');
SELECT cmp_ok((SELECT count(*)::int FROM cat_fn), '>=', 40, 'catálogo: pelo menos 40 funções com EXECUTE para authenticated fora da lista fechada');
SELECT is((SELECT array_agg(e.fn ORDER BY e.fn) FROM exempt e
            WHERE NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = e.fn
                                AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  NULL, 'catálogo: cada item da lista fechada existe e é executável por authenticated (a lista não envelhece)');

-- Estado (para "nada muda").
CREATE FUNCTION pg_temp.snap() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(concat_ws('#',
    (SELECT string_agg(to_jsonb(m)::text, ';' ORDER BY m.id) FROM public.members m),
    (SELECT string_agg(to_jsonb(c)::text, ';' ORDER BY c.id) FROM public.cells c),
    (SELECT string_agg(to_jsonb(r)::text, ';' ORDER BY r.id) FROM public.cell_reports r),
    (SELECT string_agg(to_jsonb(p)::text, ';' ORDER BY p.report_id, p.member_id) FROM public.cell_report_participants p),
    (SELECT string_agg(to_jsonb(r)::text, ';' ORDER BY r.id) FROM public.roles r),
    (SELECT string_agg(rp.role_id || rp.permission::text, ';' ORDER BY rp.role_id, rp.permission) FROM public.role_permissions rp),
    (SELECT string_agg(to_jsonb(a)::text, ';' ORDER BY a.auth_user_id) FROM private.account_passwords a),
    (SELECT string_agg(s.id::text, ';' ORDER BY s.id) FROM auth.sessions s),
    (SELECT count(*)::text FROM public.events)))
$$;

-- ===========================================================================
-- 2. Controle: Ana (Administrador, sem marca) lê cada tabela e view com linha
-- ===========================================================================
CREATE FUNCTION pg_temp.count_as(_n int, _rel text, _k int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.api(_n, format('SELECT to_jsonb(count(*)) FROM %s', _rel), _k) $$;
SELECT is((SELECT array_agg(rel ORDER BY rel) FROM cat_rel WHERE pg_temp.count_as(3, rel) IN ('0'::jsonb) OR pg_temp.count_as(3, rel) ? 'error'),
  NULL, 'controle: Ana (sem marca) lê cada tabela e view do catálogo com pelo menos uma linha');
CREATE TEMP TABLE s_ctrl AS SELECT pg_temp.snap() AS v;
SELECT is((SELECT array_agg(fn ORDER BY fn) FROM cat_fn
            WHERE pg_temp.api_undo(3, call) ->> 'code' IN ('password_change_required', 'session_ended')),
  NULL, 'controle: sem marca e com a sessão viva, nenhuma função responde com o código do portão');

SELECT is(pg_temp.snap(), (SELECT v FROM s_ctrl), 'controle: as chamadas do controle foram desfeitas');

-- Marcas: Caio (Membro) e Rita (Administrador). Davi perde a sessão 1 (a de agora).
SELECT private.set_must_change(pg_temp.u(4), 'reset', now() + interval '7 days');
SELECT private.set_must_change(pg_temp.u(2), 'initial', NULL);
DELETE FROM auth.sessions WHERE id = pg_temp.s(5, 1);
CREATE TEMP TABLE s0 AS SELECT pg_temp.snap() AS v;

-- ===========================================================================
-- 3. Teste de catálogo (RN-09, RN-16)
-- ===========================================================================
-- Leitura: o código esperado ou nenhuma linha.
CREATE FUNCTION pg_temp.rel_offenders(_n int, _k int, _code text) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(rel || ' → ' || r::text ORDER BY rel)
    FROM (SELECT rel, pg_temp.count_as(_n, rel, _k) AS r FROM cat_rel) x
   WHERE NOT (r ->> 'code' IS NOT DISTINCT FROM _code AND r ->> 'error' = '42501') AND r <> '0'::jsonb
$$;
-- Funções: sempre o código esperado (nenhuma pode responder, nem vazio).
CREATE FUNCTION pg_temp.fn_offenders(_n int, _k int, _code text) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(sig || ' → ' || left(r::text, 120) ORDER BY sig)
    FROM (SELECT sig, pg_temp.api(_n, call, _k) AS r FROM cat_fn) x
   WHERE NOT (r ->> 'error' = '42501' AND r ->> 'code' IS NOT DISTINCT FROM _code)
$$;
-- Escrita: UPDATE e DELETE em toda linha que a pessoa alcançaria; o código esperado ou nenhuma linha.
CREATE FUNCTION pg_temp.write_offenders(_n int, _k int, _code text) RETURNS text[] LANGUAGE sql AS $$
  SELECT array_agg(op || ' ' || rel || ' → ' || r::text ORDER BY rel, op)
    FROM (SELECT rel, 'UPDATE' AS op, pg_temp.api(_n, format('WITH w AS (UPDATE %s SET %I = %I RETURNING 1) SELECT to_jsonb(count(*)) FROM w', rel, first_col, first_col), _k) AS r
            FROM cat_rel WHERE kind = 'r' AND can_update
          UNION ALL
          SELECT rel, 'DELETE', pg_temp.api(_n, format('WITH w AS (DELETE FROM %s RETURNING 1) SELECT to_jsonb(count(*)) FROM w', rel), _k)
            FROM cat_rel WHERE kind = 'r' AND can_delete) x
   WHERE NOT (r ->> 'code' IS NOT DISTINCT FROM _code AND r ->> 'error' = '42501') AND r <> '0'::jsonb
$$;

-- a) Caio (Membro) com a marca.
SELECT is(pg_temp.rel_offenders(4, 1, 'password_change_required'), NULL, 'RN-09: Caio com a marca: toda tabela e view recusa ou volta vazia');
SELECT is(pg_temp.fn_offenders(4, 1, 'password_change_required'), NULL, 'RN-09: Caio com a marca: toda função recusa com password_change_required');
SELECT is(pg_temp.write_offenders(4, 1, 'password_change_required'), NULL, 'RN-09: Caio com a marca: UPDATE e DELETE recusam ou não alcançam nada');
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(count(*)) FROM public.members_view') ->> 'code', 'password_change_required',
  'RN-09: Caio com a marca lendo a members_view: 42501 password_change_required');
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(count(*)) FROM public.members_view') ->> 'error', '42501', 'RN-09 (b): para a API, é erro de permissão (42501)');

-- b) Rita (Administrador) com a marca (RN-09 d).
SELECT is(pg_temp.rel_offenders(2, 1, 'password_change_required'), NULL, 'RN-09 (d): Rita (Administrador) com a marca: toda tabela e view recusa ou volta vazia');
SELECT is(pg_temp.fn_offenders(2, 1, 'password_change_required'), NULL, 'RN-09 (d): Rita com a marca: toda função recusa');
SELECT is(pg_temp.write_offenders(2, 1, 'password_change_required'), NULL, 'RN-09 (d): Rita com a marca: UPDATE e DELETE recusam');

-- c) Davi (Líder) com a sessão apagada (RN-16).
SELECT is(pg_temp.rel_offenders(5, 1, 'session_ended'), NULL, 'RN-16: Davi com a sessão apagada: toda tabela e view recusa (session_ended) ou volta vazia');
SELECT is(pg_temp.fn_offenders(5, 1, 'session_ended'), NULL, 'RN-16: Davi com a sessão apagada: toda função recusa com session_ended');
SELECT is(pg_temp.write_offenders(5, 1, 'session_ended'), NULL, 'RN-16: Davi com a sessão apagada: UPDATE e DELETE recusam');
SELECT is(pg_temp.api(5, 'SELECT to_jsonb(t) FROM public.my_password_status() t') ->> 'code', 'session_ended',
  'RN-16: com a sessão apagada, my_password_status também responde session_ended');

-- d) Token sem session_id (DA-9): só a marca é conferida.
SELECT is(pg_temp.fn_offenders(4, 0, 'password_change_required'), NULL, 'DA-9: sem session_id, Caio com a marca continua recusado em toda função');
SELECT is(pg_temp.count_as(3, 'public.members_view', 0) ? 'error', false, 'DA-9: sem session_id e sem marca, Ana lê normalmente');

-- Inserções nas tabelas de negócio: o código do portão (Caio com a marca, Davi sem sessão).
-- E2.11 PR 2: relatórios e participantes só pelas RPCs (o INSERT direto dá 42501 de privilégio antes do
-- portão); as linhas deles chamam submit_cell_report e save_cell_report.
CREATE FUNCTION pg_temp.ins(_n int, _k int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.api(_n, CASE WHEN _sql LIKE 'SELECT%' THEN 'SELECT to_jsonb(count(*)) FROM (' || _sql || ') w'
                               ELSE 'WITH w AS (' || _sql || ' RETURNING 1) SELECT to_jsonb(count(*)) FROM w' END, _k) ->> 'code' $$;
CREATE TEMP TABLE ins_sql (tbl text, q text);
INSERT INTO ins_sql VALUES
  ('members', format('INSERT INTO public.members (id, name, gender, leader_id, has_leadership, mobile_whatsapp) VALUES (%L, ''Novo Gate'', ''M'', %L, true, %L)',
                     pg_temp.m(98), pg_temp.m(5), pg_temp.mob(98))),
  ('cells', format('INSERT INTO public.cells (leader_id, timothy_id, host_id) VALUES (%L, %L, %L)', pg_temp.m(5), pg_temp.m(6), pg_temp.m(4))),
  ('cell_reports', 'SELECT * FROM public.submit_cell_report(gen_random_uuid(), ''{"cell_id": "ce036000-0000-0000-0000-000000000003", "time": "08:30", "theme": "Tema"}'')'),
  ('cell_report_participants', format('SELECT * FROM public.save_cell_report(''be036000-0000-0000-0000-000000000001'', ''{}'', ARRAY[%L]::uuid[])', pg_temp.m(5)));
SELECT is((SELECT array_agg(tbl || ': ' || coalesce(pg_temp.ins(4, 1, q), 'sem código') ORDER BY tbl) FROM ins_sql
            WHERE pg_temp.ins(4, 1, q) IS DISTINCT FROM 'password_change_required'), NULL,
  'RN-09: Caio com a marca não insere em members, cells, cell_reports nem cell_report_participants');
SELECT is((SELECT array_agg(tbl || ': ' || coalesce(pg_temp.ins(5, 1, q), 'sem código') ORDER BY tbl) FROM ins_sql
            WHERE pg_temp.ins(5, 1, q) IS DISTINCT FROM 'session_ended'), NULL,
  'RN-16: Davi com a sessão apagada não insere nas tabelas de negócio');

SELECT is(pg_temp.snap(), (SELECT v FROM s0), 'RN-09/RN-16: nada muda no banco depois de todas as chamadas recusadas');

-- A lista fechada continua respondendo para quem tem a marca (é o que a tela de troca usa).
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(t) FROM public.my_password_status() t'), 'true'::jsonb,
  'lista fechada: my_password_status responde para Caio com a marca');
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(public.sp_today())') ? 'error', false, 'lista fechada: sp_today responde para Caio com a marca');
SELECT is(pg_temp.api(4, 'SELECT to_jsonb(public.log_auth_event(''logout'', true))') ? 'error', false,
  'lista fechada: log_auth_event(logout) responde para Caio com a marca (E2.01 DA-9)');

-- ===========================================================================
-- 4. "Na hora": a marca posta com a sessão aberta (RN-09 c, RN-16)
-- ===========================================================================
SELECT ok((pg_temp.count_as(6, 'public.members_view')::text)::int > 0, 'RN-09 (c): Eva, sem marca, lê a members_view');
SELECT private.set_must_change(pg_temp.u(6), 'initial', NULL);
SELECT is(pg_temp.count_as(6, 'public.members_view') ->> 'code', 'password_change_required',
  'RN-09 (c): a próxima leitura de Eva, na mesma sessão, já é recusada');
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(6)), 1, 'RN-16: a marca não encerra a sessão de Eva');
-- A troca tira a marca: a mesma sessão volta a ler.
UPDATE private.account_passwords SET must_change = false, must_change_reason = NULL, must_change_since = NULL WHERE auth_user_id = pg_temp.u(6);
SELECT ok((pg_temp.count_as(6, 'public.members_view')::text)::int > 0, 'RN-09: sem a marca, a mesma sessão de Eva volta a ler');

-- ===========================================================================
-- 5. RN-01: a Líder redefine
-- ===========================================================================
SELECT ok(EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = pg_temp.role('Líder') AND permission = 'change_member_password'),
  'RN-01: a Líder tem Redefinir Senha de Membros (change_member_password)');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.role_permissions WHERE role_id = pg_temp.role('Membro') AND permission = 'change_member_password'),
  'RN-01: a Membro continua sem a permissão');
INSERT INTO auth.sessions (id, user_id) VALUES (pg_temp.s(5, 2), pg_temp.u(5));
SELECT is(pg_temp.api(5, format('SELECT public.reset_member_password(%L)', pg_temp.m(6)), 2) ->> 'result', 'ok',
  'RN-01: Davi (Líder, sessão nova) redefine Eva, do ministério dele');
SELECT is(pg_temp.api(5, format('SELECT public.reset_member_password(%L)', pg_temp.m(3)), 2) ->> 'code', 'not_found',
  'RN-01/RN-02 a: Davi (Líder) não redefine Ana, de outro ministério (not_found)');

-- ===========================================================================
-- 5b. members_view.password_reset_status com as funções cobertas num InitPlan (risco 3)
-- ===========================================================================
-- A coluna precisa dar o mesmo que a regra por linha (viewer_covers_role da função de cada um).
CREATE FUNCTION pg_temp.status_mismatch(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.api(_n, $q$
    SELECT jsonb_build_object(
      'mismatch', count(*) FILTER (WHERE v.password_reset_status IS DISTINCT FROM
                    CASE WHEN v.id = public.viewer_member_id() THEN 'self'
                         WHEN NOT public.viewer_covers_role(v.role_id) THEN 'role_not_covered'
                         WHEN v.auth_user_id IS NULL THEN 'no_account'
                         ELSE 'allowed' END),
      'statuses', (SELECT jsonb_agg(DISTINCT x.password_reset_status ORDER BY x.password_reset_status) FROM public.members_view x))
      FROM public.members_view v $q$, 1)
$$;
SELECT is(pg_temp.status_mismatch(8) -> 'mismatch', '0'::jsonb,
  'risco 3: para Gil (não cobre a Administrador), password_reset_status é igual à regra por linha em toda a members_view');
SELECT is(pg_temp.status_mismatch(8) -> 'statuses', '["allowed", "no_account", "role_not_covered", "self"]'::jsonb,
  'risco 3: a massa de Gil tem os quatro valores (allowed, no_account, role_not_covered, self)');

-- ===========================================================================
-- 6. RN-08 c: a marca na publicação (private.mark_initial_passwords)
-- ===========================================================================
-- Massa: 11 Hélio (123456, ativo, com sessão), 12 Iara (123456, excluída: conta suspensa),
-- 13 Júlio (123456, já com a marca initial), 14 Lia (senha forte), 15 Malu (sem linha no cofre).
INSERT INTO public.members (id, name, gender, leader_id, has_leadership, is_active, mobile_whatsapp, role_id) VALUES
  (pg_temp.m(11), 'Hélio Gate', 'M', pg_temp.m(5), true, true, pg_temp.mob(11), pg_temp.role('Membro')),
  (pg_temp.m(12), 'Iara Gate', 'F', pg_temp.m(5), true, true, pg_temp.mob(12), pg_temp.role('Membro')),
  (pg_temp.m(13), 'Júlio Gate', 'M', pg_temp.m(5), true, true, pg_temp.mob(13), pg_temp.role('Membro')),
  (pg_temp.m(14), 'Lia Gate', 'F', pg_temp.m(5), true, true, pg_temp.mob(14), pg_temp.role('Membro')),
  (pg_temp.m(15), 'Malu Gate', 'F', pg_temp.m(5), true, true, pg_temp.mob(15), pg_temp.role('Membro'));
SELECT pg_temp.acct(n, CASE WHEN n = 14 THEN 'Forte@2024x' ELSE '123456' END) FROM generate_series(11, 14) n;
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (pg_temp.u(15), 'e2036-15@teste.invalid', now());
UPDATE public.members SET auth_user_id = pg_temp.u(n) FROM generate_series(11, 15) n WHERE id = pg_temp.m(n);
SELECT private.set_must_change(pg_temp.u(13), 'initial', NULL);
SELECT pg_temp.api(3, format('SELECT to_jsonb(public.delete_member(%L))', pg_temp.m(12)));
-- Quem já tinha 123456 antes deste teste (massa de outro arquivo não existe: cada um faz ROLLBACK) fica de fora da contagem.
CREATE TEMP TABLE before_mark AS SELECT auth_user_id, must_change FROM private.account_passwords;
CREATE TEMP TABLE ev0 AS SELECT id FROM public.events;

CREATE TEMP TABLE marked AS SELECT private.mark_initial_passwords() AS n;
SELECT is((SELECT array_agg(a.auth_user_id ORDER BY a.auth_user_id) FROM private.account_passwords a JOIN before_mark b USING (auth_user_id)
            WHERE a.must_change AND NOT b.must_change),
  ARRAY[pg_temp.u(11), pg_temp.u(12)], 'RN-08 c: Hélio (ativo) e Iara (excluída, conta suspensa) recebem a marca; mais ninguém');
SELECT is((SELECT n FROM marked), 2, 'RN-08 c: a função devolve 2 marcas novas');
SELECT is((SELECT array_agg(DISTINCT must_change_reason) FROM private.account_passwords WHERE auth_user_id IN (pg_temp.u(11), pg_temp.u(12))),
  ARRAY['initial'], 'RN-08 c: a marca é initial');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id IN (pg_temp.u(11), pg_temp.u(12)) AND temp_expires_at IS NOT NULL), 0,
  'RN-08 c: sem validade (a senha inicial não vence)');
SELECT is((SELECT jsonb_agg(jsonb_build_object('actor', e.actor_user_id, 'action', e.action, 'entity', e.entity, 'entity_id', e.entity_id,
                                               'label', e.entity_label, 'description', e.description, 'metadata', e.metadata, 'success', e.success)
                            ORDER BY e.entity_label)
             FROM public.events e WHERE e.id NOT IN (SELECT id FROM ev0)),
  jsonb_build_array(
    jsonb_build_object('actor', NULL, 'action', 'password_change_required', 'entity', 'auth', 'entity_id', pg_temp.m(11), 'label', 'Hélio Gate',
                       'description', 'Troca de senha exigida', 'metadata', '{"reason": "initial_password"}'::jsonb, 'success', true),
    jsonb_build_object('actor', NULL, 'action', 'password_change_required', 'entity', 'auth', 'entity_id', pg_temp.m(12), 'label', 'Iara Gate',
                       'description', 'Troca de senha exigida', 'metadata', '{"reason": "initial_password"}'::jsonb, 'success', true)),
  'RN-17 f: um "Troca de senha exigida" por marca nova, sem autor, motivo "Senha inicial", com o cadastro (Júlio já marcado não gera outro)');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id IN (pg_temp.u(14), pg_temp.u(15)) AND must_change), 0,
  'RN-08 c: senha forte e conta sem linha no cofre não recebem a marca');
SELECT is((SELECT count(*)::int FROM private.account_passwords WHERE auth_user_id = pg_temp.u(15)), 0, 'RN-08 c: a conta sem senha continua sem linha no cofre');
SELECT is((SELECT count(*)::int FROM auth.sessions WHERE user_id = pg_temp.u(11)), 1, 'RN-16: a marca na publicação não encerra a sessão aberta de Hélio');
SELECT is(pg_temp.count_as(11, 'public.cells_view') ->> 'code', 'password_change_required',
  'RN-08 c / RN-09: a sessão aberta de Hélio já é recusada na próxima chamada');
SELECT is(private.mark_initial_passwords(), 0, 'RN-08 c: rodar de novo não marca ninguém');
SELECT is((SELECT count(*)::int FROM public.events WHERE id NOT IN (SELECT id FROM ev0)), 2, 'RN-08 c: e não registra de novo');
SELECT pg_temp.api(3, format('SELECT to_jsonb(t) FROM public.restore_member(%L) t', pg_temp.m(12)));
SELECT is((SELECT must_change_reason FROM private.account_passwords WHERE auth_user_id = pg_temp.u(12) AND must_change), 'initial',
  'RN-08: restaurada (E2.01), Iara continua com a marca');

SELECT * FROM finish();

ROLLBACK;
