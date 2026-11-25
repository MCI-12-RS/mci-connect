-- E2.02 (PR 1): RN-23 (ninguém consulta o que é de outra pessoa), grants e
-- estrutura das migrations.
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), RN-23,
-- "O que deixa de estar ao alcance de authenticated", "Leituras para a tela
-- (AQ-1, AQ-3)", "Verificações obrigatórias (para o QA)" (RN-23, Grants e
-- estrutura) e os critérios de pronto 1 a 3.
--
-- Cobre:
--   - authenticated sem EXECUTE em user_has_permission, is_admin,
--     role_effective_permissions, viewer_permissions e _viewer_scope_anchors;
--     service_role com EXECUTE;
--   - as quatro funções obsoletas não existem e nenhum prosrc, política, view
--     ou trigger as cita; nenhuma política ou view chama as de service_role;
--   - Caio pergunta pelas permissões, pelo escopo e pela função de outros: erro
--     de permissão ou resposta vazia; sobre si mesmo, recebe a resposta;
--   - my_access e role_options só sobre quem chama (AQ-1);
--   - nenhuma função nova com EXECUTE para anon; todas as de sessão e as RPCs
--     novas com EXECUTE para authenticated;
--   - roles_view: só SELECT para authenticated, dona postgres, visível só com
--     Visualizar ou Gerenciar Funções;
--   - índices e constraints de roles (uma Administrador, padrão nunca é a
--     Administrador), members_role_id_idx e os triggers novos.
--
-- Fora deste arquivo (depois do PR 6): select role_id from members dar 42501.
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- Ids fictícios (usuário do Auth, membro, célula, relatório).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2020000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- Executa _sql como o usuário n (NULL = anônimo sem sessão) e devolve o
-- resultado: estado, linhas, código de regra (22023 + app_error) e mensagem.
CREATE FUNCTION pg_temp.try(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _state text; _msg text; _detail text; _hint text; _rows bigint;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql;
    GET DIAGNOSTICS _rows = ROW_COUNT;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN jsonb_build_object('state', '00000', 'code', '00000', 'rows', _rows);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _msg = MESSAGE_TEXT,
                            _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('state', _state, 'message', _msg, 'hint', nullif(_hint, ''),
      'detail', CASE WHEN _detail LIKE '{%' THEN _detail::jsonb ELSE to_jsonb(nullif(_detail, '')) END,
      'code', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                   THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
CREATE FUNCTION pg_temp.code(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.try(_n, _sql) ->> 'code' $$;
CREATE FUNCTION pg_temp.msg(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.try(_n, _sql) ->> 'message' $$;
CREATE FUNCTION pg_temp.rows(_n int, _sql text) RETURNS text LANGUAGE sql AS
$$ SELECT CASE WHEN pg_temp.try(_n, _sql) ->> 'code' = '00000' THEN pg_temp.try(_n, _sql) ->> 'rows'
               ELSE pg_temp.try(_n, _sql) ->> 'code' END $$;

-- Valor escalar (texto) como o usuário n; erro vira 'ERR <estado>'.
CREATE FUNCTION pg_temp.val(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _out text; _state text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    RETURN 'ERR ' || _state;
  END;
END $$;

-- Ids (uuid) que a consulta devolve, como o usuário n.
CREATE FUNCTION pg_temp.ids(_n int, _sql text) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE _out uuid[];
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE 'SELECT coalesce(array_agg(x), ''{}''::uuid[]) FROM (' || _sql || ') q(x)' INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _out;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
END $$;

-- Rótulos legíveis: membros (ordem da massa), células e relatórios.
CREATE TEMP TABLE lbl (ord int PRIMARY KEY, id uuid UNIQUE, label text);
INSERT INTO lbl VALUES
  (1, pg_temp.m(1), 'Samuel'),   (2, pg_temp.m(2), 'Magda'),   (3, pg_temp.m(3), 'Pedro'),
  (4, pg_temp.m(4), 'Paula'),    (5, pg_temp.m(5), 'Tiago'),   (6, pg_temp.m(6), 'Tania'),
  (7, pg_temp.m(7), 'Andre'),    (8, pg_temp.m(8), 'Beatriz'), (9, pg_temp.m(9), 'Caio'),
  (10, pg_temp.m(10), 'Fabio'),  (11, pg_temp.m(11), 'Gabriel'), (12, pg_temp.m(12), 'Carla'),
  (13, pg_temp.m(13), 'Debora'), (14, pg_temp.m(14), 'Diego'), (15, pg_temp.m(15), 'Hugo'),
  (16, pg_temp.m(16), 'Rita'),   (17, pg_temp.m(17), 'Ester'), (18, pg_temp.m(18), 'Lucia'),
  (20, pg_temp.m(20), 'D3t'),    (21, pg_temp.m(21), 'D3h'),
  (101, pg_temp.c(1), 'C1'), (102, pg_temp.c(2), 'C2'), (103, pg_temp.c(3), 'C3'),
  (201, pg_temp.r(1), 'R1'), (202, pg_temp.r(2), 'R2'), (203, pg_temp.r(3), 'R3');
-- Texto com os rótulos presentes em _ids, na ordem da massa ('-' se nenhum).
CREATE FUNCTION pg_temp.lab(_ids uuid[]) RETURNS text LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN _ids IS NULL THEN 'ERRO' ELSE coalesce(
     (SELECT string_agg(l.label, ',' ORDER BY l.ord) FROM pg_temp.lbl l WHERE l.id = ANY (_ids)), '-') END $$;

-- Função de teste com as permissões dadas (como postgres). Permissão
-- aposentada só com _maint = true (app.role_maintenance).
CREATE FUNCTION pg_temp.mkrole(_name text, _perms text[], _maint boolean DEFAULT false) RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE _id uuid := gen_random_uuid();
BEGIN
  IF _maint THEN PERFORM set_config('app.role_maintenance', 'on', true); END IF;
  INSERT INTO public.roles (id, name) VALUES (_id, _name);
  INSERT INTO public.role_permissions (role_id, permission)
    SELECT _id, p::public.permission_action FROM unnest(_perms) p;
  IF _maint THEN PERFORM set_config('app.role_maintenance', 'off', true); END IF;
  RETURN _id;
END $$;
-- Dá a função (por nome) ao membro n, como postgres.
CREATE FUNCTION pg_temp.give(_n int, _role text) RETURNS void LANGUAGE sql AS
$$ UPDATE public.members SET role_id = CASE WHEN _role IS NULL THEN NULL ELSE pg_temp.role(_role) END
    WHERE id = pg_temp.m(_n) $$;

-- ---------------------------------------------------------------------------
-- Massa do spec (E2.02, "Massa de exemplo"): 20 pessoas, a conta X (19, sem
-- cadastro), 3 células e 3 relatórios, mais três casos extras isolados:
-- um ciclo de dois membros, um cônjuge assimétrico e um pastor com líder.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e202-' || n || '@teste.invalid'
  FROM generate_series(1, 19) n
UNION ALL SELECT pg_temp.u(n), 'e202-' || n || '@teste.invalid' FROM unnest(ARRAY[30, 32, 34]) n;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, is_active) VALUES
 (pg_temp.m(1),'Samuel','M',true,NULL,pg_temp.u(1),pg_temp.role('Líder'),true),
 (pg_temp.m(2),'Magda','F',true,NULL,pg_temp.u(2),pg_temp.role('Líder'),true),
 (pg_temp.m(3),'Pedro','M',false,pg_temp.m(1),pg_temp.u(3),pg_temp.role('Líder'),true),
 (pg_temp.m(4),'Paula','F',false,pg_temp.m(2),pg_temp.u(4),pg_temp.role('Líder'),true),
 (pg_temp.m(5),'Tiago','M',false,pg_temp.m(1),pg_temp.u(5),NULL,true),
 (pg_temp.m(6),'Tania','F',false,pg_temp.m(2),pg_temp.u(6),NULL,true),
 (pg_temp.m(7),'Andre','M',false,pg_temp.m(3),pg_temp.u(7),pg_temp.role('Líder'),true),
 (pg_temp.m(8),'Beatriz','F',false,pg_temp.m(6),pg_temp.u(8),pg_temp.role('Membro'),true),
 (pg_temp.m(9),'Caio','M',false,pg_temp.m(7),pg_temp.u(9),pg_temp.role('Membro'),true),
 (pg_temp.m(10),'Fabio','M',false,pg_temp.m(7),pg_temp.u(10),pg_temp.role('Membro'),false),
 (pg_temp.m(11),'Gabriel','M',false,pg_temp.m(10),pg_temp.u(11),NULL,true),
 (pg_temp.m(12),'Carla','F',false,pg_temp.m(4),pg_temp.u(12),pg_temp.role('Membro'),true),
 (pg_temp.m(13),'Debora','F',false,pg_temp.m(8),pg_temp.u(13),NULL,true),
 (pg_temp.m(14),'Diego','M',false,pg_temp.m(5),pg_temp.u(14),pg_temp.role('Líder'),true),
 (pg_temp.m(15),'Hugo','M',false,pg_temp.m(5),pg_temp.u(15),NULL,true),
 (pg_temp.m(16),'Rita','F',false,pg_temp.m(6),pg_temp.u(16),pg_temp.role('Administrador'),true),
 (pg_temp.m(17),'Ester','F',false,NULL,pg_temp.u(17),pg_temp.role('Membro'),true),
 (pg_temp.m(18),'Lucia','F',false,pg_temp.m(17),pg_temp.u(18),NULL,true),
 (pg_temp.m(20),'D3t','F',false,pg_temp.m(13),NULL,NULL,true),
 (pg_temp.m(21),'D3h','F',false,pg_temp.m(13),NULL,NULL,true);
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
 (pg_temp.c(1), pg_temp.m(7), pg_temp.m(9), pg_temp.m(12), 'Evangelística', 'Quarta', '20:00'),
 (pg_temp.c(2), pg_temp.m(14), pg_temp.m(15), pg_temp.m(9), 'Evangelística', 'Quinta', '20:00'),
 (pg_temp.c(3), pg_temp.m(13), pg_temp.m(20), pg_temp.m(21), 'Evangelística', 'Terça', '19:30');
-- Casos extras, isolados da árvore principal (só Rita e eles mesmos os veem).
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, spouse_id, auth_user_id, role_id, is_active, has_leadership, g12_level) VALUES
 (pg_temp.m(30),'Ciclo1','M',false,pg_temp.m(31),NULL,pg_temp.u(30),pg_temp.role('Membro'),true,true,1),
 (pg_temp.m(31),'Ciclo2','F',false,pg_temp.m(30),NULL,NULL,NULL,true,true,1),
 (pg_temp.m(32),'Assim1','M',false,NULL,pg_temp.m(33),pg_temp.u(32),pg_temp.role('Membro'),true,false,0),
 (pg_temp.m(33),'Assim2','F',false,NULL,NULL,NULL,NULL,true,false,0),
 (pg_temp.m(35),'Isolado','M',false,NULL,NULL,NULL,NULL,true,false,0),
 (pg_temp.m(34),'PastorComLider','M',true,pg_temp.m(35),NULL,pg_temp.u(34),pg_temp.role('Líder'),true,true,0);
-- Relatórios da semana passada (a semana atual fica livre para os lançamentos).
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES
 (pg_temp.r(1), pg_temp.c(1), public.week_start(public.sp_today()) - 4, '20:00', true, 'R1'),
 (pg_temp.r(2), pg_temp.c(2), public.week_start(public.sp_today()) - 3, '20:00', true, 'R2'),
 (pg_temp.r(3), pg_temp.c(3), public.week_start(public.sp_today()) - 5, '20:00', true, 'R3');
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
 (pg_temp.r(2), pg_temp.m(14)), (pg_temp.r(2), pg_temp.m(15)), (pg_temp.r(1), pg_temp.m(9));
SET LOCAL session_replication_role = origin;


-- Cenário isolado: roda _setup (como postgres), avalia cada sonda (SQL que
-- devolve um texto) e desfaz tudo. O resultado volta pela exceção, porque o
-- pgTAP também perderia a contagem dos testes dentro de um SAVEPOINT desfeito.
CREATE FUNCTION pg_temp.sandbox(_setup text, _probes text[]) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _res text[] := '{}'; _p text; _v text; _d text; _m text;
BEGIN
  BEGIN
    EXECUTE _setup;
    FOREACH _p IN ARRAY _probes LOOP
      EXECUTE _p INTO _v;
      _res := _res || coalesce(_v, 'NULL');
    END LOOP;
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'sandbox', DETAIL = to_jsonb(_res)::text;
  EXCEPTION WHEN raise_exception THEN
    GET STACKED DIAGNOSTICS _d = PG_EXCEPTION_DETAIL, _m = MESSAGE_TEXT;
    IF _m <> 'sandbox' THEN RAISE; END IF;
    RETURN ARRAY(SELECT jsonb_array_elements_text(_d::jsonb));
  END;
END $$;
CREATE TEMP TABLE sb (k text PRIMARY KEY, v text[]);


-- Montadores de sonda para o sandbox: código, mensagem, linhas e valor, como o usuário n.
CREATE FUNCTION pg_temp.pc(_n int, _sql text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('SELECT pg_temp.code(%s, %L)', coalesce(_n::text, 'NULL'), _sql) $$;
CREATE FUNCTION pg_temp.pm(_n int, _sql text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('SELECT pg_temp.msg(%s, %L)', coalesce(_n::text, 'NULL'), _sql) $$;
CREATE FUNCTION pg_temp.pr(_n int, _sql text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('SELECT pg_temp.rows(%s, %L)', coalesce(_n::text, 'NULL'), _sql) $$;
CREATE FUNCTION pg_temp.pv(_n int, _sql text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format('SELECT pg_temp.val(%s, %L)', coalesce(_n::text, 'NULL'), _sql) $$;
-- Executa e guarda o resultado em sb.
CREATE FUNCTION pg_temp.run(_k text, _setup text, _probes text[]) RETURNS void LANGUAGE sql AS
$$ INSERT INTO pg_temp.sb VALUES (_k, pg_temp.sandbox(_setup, _probes)) $$;


-- Sonda: rótulos que o usuário n vê em members_view.
CREATE FUNCTION pg_temp.lab_probe(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format($p$SELECT pg_temp.lab(pg_temp.ids(%s, 'SELECT id FROM public.members_view'))$p$, _n) $$;


-- Texto do INSERT de relatório da semana atual (para sondas).
CREATE FUNCTION pg_temp.ins_report_text(_cell uuid) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT format($i$INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme) VALUES (%L, public.sp_today(), '23:59', true, 'tema')$i$, _cell) $$;

-- Universo de ids, legível por quem consulta (as funções de linha são testadas
-- id a id contra as views e as tabelas).
CREATE TEMP TABLE universe (kind text, id uuid);
INSERT INTO universe
  SELECT 'm', id FROM public.members WHERE id::text LIKE 'c2020000%'
  UNION ALL SELECT 'c', id FROM public.cells WHERE id::text LIKE 'd2020000%'
  UNION ALL SELECT 'r', id FROM public.cell_reports WHERE id::text LIKE 'e2020000%';
GRANT SELECT ON universe TO authenticated;
GRANT SELECT ON lbl TO authenticated;

SELECT plan(213);

-- ===========================================================================
-- 1. RN-23: o que authenticated não executa mais.
-- ===========================================================================
SELECT is(has_function_privilege('authenticated', f::regprocedure, 'EXECUTE'), false, 'RN-23: authenticated sem EXECUTE em ' || f)
  FROM unnest(ARRAY['public.user_has_permission(uuid, public.permission_action)', 'public.is_admin(uuid)',
                    'public.role_effective_permissions(uuid)', 'public.viewer_permissions()',
                    'public._viewer_scope_anchors()']) f;
SELECT is(has_function_privilege('service_role', f::regprocedure, 'EXECUTE'), true, 'RN-23: service_role com EXECUTE em ' || f)
  FROM unnest(ARRAY['public.user_has_permission(uuid, public.permission_action)', 'public.is_admin(uuid)',
                    'public.role_effective_permissions(uuid)', 'public.viewer_permissions()',
                    'public._viewer_scope_anchors()']) f;
SELECT is(has_function_privilege('anon', f::regprocedure, 'EXECUTE'), false, 'RN-23: anon sem EXECUTE em ' || f)
  FROM unnest(ARRAY['public.user_has_permission(uuid, public.permission_action)', 'public.is_admin(uuid)',
                    'public.role_effective_permissions(uuid)', 'public.viewer_permissions()',
                    'public._viewer_scope_anchors()']) f;

-- As quatro obsoletas não existem.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = f), 0, 'RN-23: ' || f || ' foi removida')
  FROM unnest(ARRAY['is_in_same_ministry', 'get_ministry_root', 'is_leader_of_visible_member', 'can_manage_own_cell']) f;
-- Nenhum corpo de função, política, view ou trigger as cita.
SELECT is((SELECT count(*)::int FROM pg_proc WHERE pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
            AND prosrc ~ ('\m' || f || '\M')), 0, 'RN-23: nenhum prosrc cita ' || f)
  FROM unnest(ARRAY['is_in_same_ministry', 'get_ministry_root', 'is_leader_of_visible_member', 'can_manage_own_cell']) f;
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname IN ('public', 'storage')
            AND (coalesce(qual, '') ~ ('\m' || f || '\M') OR coalesce(with_check, '') ~ ('\m' || f || '\M'))), 0, 'RN-23: nenhuma política cita ' || f)
  FROM unnest(ARRAY['is_in_same_ministry', 'get_ministry_root', 'is_leader_of_visible_member', 'can_manage_own_cell']) f;
SELECT is((SELECT count(*)::int FROM pg_views WHERE schemaname = 'public' AND definition ~ ('\m' || f || '\M')), 0, 'RN-23: nenhuma view cita ' || f)
  FROM unnest(ARRAY['is_in_same_ministry', 'get_ministry_root', 'is_leader_of_visible_member', 'can_manage_own_cell']) f;
-- Políticas e views não chamam as funções que authenticated não executa.
SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public'
            AND (coalesce(qual, '') ~ '\m(user_has_permission|is_admin)\M' OR coalesce(with_check, '') ~ '\m(user_has_permission|is_admin)\M')),
  0, 'RN-23: nenhuma política da public chama user_has_permission nem is_admin');
SELECT is((SELECT count(*)::int FROM pg_views WHERE schemaname = 'public' AND definition ~ '\m(user_has_permission|is_admin)\M'),
  0, 'RN-23: nenhuma view da public chama user_has_permission nem is_admin');

-- Caio pergunta sobre os outros: erro de permissão ou resposta vazia.
SELECT is(pg_temp.code(9, format('SELECT public.user_has_permission(%L, ''manage_roles'')', pg_temp.u(16))), '42501',
  'RN-23: Caio pergunta se Rita tem Gerenciar Funções: 42501');
SELECT is(pg_temp.code(9, format('SELECT public.is_admin(%L)', pg_temp.u(16))), '42501', 'RN-23: Caio pergunta se Rita é administradora: 42501');
SELECT is(pg_temp.code(9, 'SELECT public._viewer_scope_anchors()'), '42501', 'RN-23: Caio lê as âncoras de escopo: 42501');
SELECT is(pg_temp.code(9, format('SELECT public.role_effective_permissions(%L)', pg_temp.role('Administrador'))), '42501',
  'RN-23: Caio lê as permissões efetivas de uma função: 42501');
SELECT is(pg_temp.code(9, 'SELECT public.viewer_permissions()'), '42501', 'RN-23: Caio chama viewer_permissions: 42501');
SELECT is(pg_temp.code(9, format('SELECT public.get_ministry_root(%L)', pg_temp.m(13))), '42883', 'RN-23: o G12 de Débora não se pergunta mais (a função não existe: 42883)');
SELECT is(pg_temp.code(9, format('SELECT public.is_in_same_ministry(%L, %L)', pg_temp.u(14), pg_temp.m(12))), '42883', 'RN-23: "Diego vê Carla?" não se pergunta mais (42883)');
-- As funções de sessão respondem só sobre quem chama: Caio sobre Débora ou Beatriz → falso/vazio.
SELECT is(pg_temp.val(9, format('SELECT public.viewer_scope_contains_any(ARRAY[%L]::uuid[])::text', pg_temp.m(13))), 'false', 'RN-23: Caio pergunta se vê Débora: não vê');
SELECT is(pg_temp.val(9, format('SELECT public.viewer_sees_member(%L)::text', pg_temp.m(13))), 'false', 'RN-23: viewer_sees_member de Débora, para Caio: falso');
SELECT is(pg_temp.val(9, format('SELECT public.viewer_sees_cell(%L)::text', pg_temp.c(3))), 'false', 'RN-23: viewer_sees_cell de C3, para Caio: falso');
SELECT is(pg_temp.val(9, format('SELECT public.can_submit_report(%L)::text', pg_temp.c(3))), 'false', 'RN-23: can_submit_report de C3, para Caio: falso');
SELECT is(pg_temp.val(9, format('SELECT public.viewer_is_cell_person(%L)::text', pg_temp.c(3))), 'false', 'RN-23: viewer_is_cell_person de C3, para Caio: falso');
SELECT is(pg_temp.val(9, format('SELECT public.cell_in_viewer_ministry(%L)::text', pg_temp.c(3))), 'false', 'RN-23: cell_in_viewer_ministry de C3, para Caio: falso');
-- Sobre si mesmo, recebe a resposta (as telas dependem dela).
SELECT is(pg_temp.val(9, format('SELECT public.viewer_scope_contains_any(ARRAY[%L]::uuid[])::text', pg_temp.m(12))), 'true', 'RN-23: Caio pergunta se vê Carla: vê (está no escopo dele)');
SELECT is(pg_temp.val(9, format('SELECT public.viewer_sees_member(%L)::text', pg_temp.m(9))), 'true', 'RN-23: Caio vê a si mesmo');
SELECT is(pg_temp.val(9, format('SELECT public.can_submit_report(%L)::text', pg_temp.c(1))), 'true', 'RN-23: Caio pode lançar C1 (timóteo)');
SELECT is(pg_temp.val(9, format('SELECT public.viewer_is_cell_person(%L)::text', pg_temp.c(2))), 'true', 'RN-23: Caio é pessoa de C2 (anfitrião)');
SELECT is(pg_temp.val(9, $q$SELECT public.viewer_has('view_dashboard')::text$q$), 'true', 'RN-23: Caio tem Visualizar Dashboard');
SELECT is(pg_temp.val(9, $q$SELECT public.viewer_has('manage_roles')::text$q$), 'false', 'RN-23: e não tem Gerenciar Funções');
SELECT is(pg_temp.val(9, $q$SELECT (SELECT count(*) FROM public.viewer_ministry_member_ids())::text$q$), '7', 'RN-23: Caio lista o próprio escopo: 7 membros');
SELECT is(pg_temp.val(9, $q$SELECT cardinality(public.viewer_tree_roots())::text$q$), '2', 'RN-23: Caio tem as duas raízes da árvore dele (o casal G12, Pedro e Paula)');
-- Quem não é ninguém: a sessão anônima não executa nada novo.
SELECT is(pg_temp.val(NULL, 'SELECT public.viewer_member_id()::text'), NULL, 'viewer_member_id sem sessão: nulo');

-- ===========================================================================
-- 2. my_access (AQ-1): uma linha, só sobre quem chama.
-- ===========================================================================
SELECT is(pg_temp.val(9, 'SELECT count(*)::text FROM public.my_access()'), '1', 'my_access: sempre uma linha (Caio)');
SELECT is(pg_temp.val(19, 'SELECT count(*)::text FROM public.my_access()'), '1', 'my_access: sempre uma linha (conta X)');
SELECT is(pg_temp.val(9, 'SELECT role_name FROM public.my_access()'), 'Membro', 'RN-23: Caio vê a própria função ("Membro") em my_access');
SELECT is(pg_temp.val(9, 'SELECT member_id::text FROM public.my_access()'), pg_temp.m(9)::text, 'my_access: member_id é o do próprio Caio');
SELECT is(pg_temp.val(9, 'SELECT role_is_protected::text FROM public.my_access()'), 'false', 'my_access: Membro não é protegida');
SELECT is(pg_temp.val(16, 'SELECT role_is_protected::text FROM public.my_access()'), 'true', 'my_access: a Administrador é protegida');
SELECT is(pg_temp.val(16, 'SELECT role_name FROM public.my_access()'), 'Administrador', 'my_access: Rita é Administrador');
SELECT is(pg_temp.val(16, 'SELECT cardinality(permissions)::text FROM public.my_access()'), (SELECT cardinality(public.active_permissions())::text),
  'my_access: Rita recebe todas as permissões ativas (atalho da Administrador, RN-17)');
SELECT is(pg_temp.val(9, 'SELECT array_to_string(ARRAY(SELECT p::text FROM unnest(permissions) p ORDER BY p::text), '','') FROM public.my_access()'),
  'edit_own_data,submit_own_cell_report,view_dashboard,view_own_ministry', 'my_access: as permissões de Caio são as da função Membro');
SELECT is(pg_temp.val(15, 'SELECT role_id::text FROM public.my_access()'), NULL, 'my_access: Hugo, sem função, role_id nulo');
SELECT is(pg_temp.val(15, 'SELECT role_name FROM public.my_access()'), NULL, 'my_access: Hugo, sem função, role_name nulo ("Sem função")');
SELECT is(pg_temp.val(15, 'SELECT cardinality(permissions)::text FROM public.my_access()'), '0', 'my_access: Hugo, sem permissões');
SELECT is(pg_temp.val(15, 'SELECT member_id::text FROM public.my_access()'), pg_temp.m(15)::text, 'my_access: Hugo tem cadastro');
SELECT is(pg_temp.val(19, 'SELECT member_id::text FROM public.my_access()'), NULL, 'my_access: a conta X não tem member_id');
SELECT is(pg_temp.val(19, 'SELECT (cardinality(permissions)::text || sees_whole_church::text || sees_ministry::text || can_create_member::text || can_assign_roles::text || can_submit_some_report::text) FROM public.my_access()'),
  '0falsefalsefalsefalsefalse', 'my_access: a conta X, sem cadastro, tem tudo falso e permissões vazias');
SELECT is(pg_temp.val(16, 'SELECT (sees_whole_church::text || sees_ministry::text || sees_whole_church_reports::text || sees_ministry_reports::text) FROM public.my_access()'),
  'truetruetruetrue', 'my_access: Rita vê a igreja, o ministério e os relatórios dos dois');
SELECT is(pg_temp.val(3, 'SELECT (sees_whole_church::text || sees_ministry::text || sees_whole_church_reports::text || sees_ministry_reports::text) FROM public.my_access()'),
  'falsetruefalsetrue', 'my_access: Pedro vê o ministério e os relatórios do ministério');
SELECT is(pg_temp.val(3, 'SELECT (can_create_member::text || can_assign_roles::text) FROM public.my_access()'), 'truefalse',
  'my_access: Pedro cadastra membros (cobre a padrão) e não atribui funções');
SELECT is(pg_temp.val(16, 'SELECT (can_create_member::text || can_assign_roles::text) FROM public.my_access()'), 'truetrue', 'my_access: Rita cadastra e atribui funções');
SELECT is(pg_temp.val(9, 'SELECT (can_create_member::text || can_assign_roles::text) FROM public.my_access()'), 'falsefalse', 'my_access: Caio (Membro) não cadastra nem atribui');
SELECT is(pg_temp.val(9, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'true', 'my_access: Caio pode lançar o relatório de alguma célula');
SELECT is(pg_temp.val(12, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'true', 'my_access: Carla, anfitriã de C1, pode lançar');
SELECT is(pg_temp.val(10, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'false', 'my_access: Fábio vê C1 mas não é pessoa de nenhuma célula: não lança');
SELECT is(pg_temp.val(3, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'true', 'my_access: Pedro, com Editar Célula, lança em C1 e C2');
SELECT is(pg_temp.val(15, 'SELECT can_submit_some_report::text FROM public.my_access()'), 'false', 'my_access: Hugo, sem função, não lança (RN-07)');
-- Função excluída e cadastro excluído: some o acesso.
INSERT INTO sb VALUES ('excl', pg_temp.sandbox(
  format('UPDATE public.members SET deleted_at = now() WHERE id = %L', pg_temp.m(12)),
  ARRAY[$q$SELECT coalesce(pg_temp.val(12, 'SELECT member_id::text FROM public.my_access()'), 'NULL')$q$,
        $q$SELECT pg_temp.val(12, 'SELECT cardinality(permissions)::text FROM public.my_access()')$q$]));
SELECT is(v[1], 'NULL', 'my_access: o cadastro excluído (Carla) perde o member_id') FROM sb WHERE k = 'excl';
SELECT is(v[2], '0', 'my_access: e todas as permissões') FROM sb WHERE k = 'excl';

-- ===========================================================================
-- 3. role_options (AQ-1, RN-18, RN-23): só sobre quem chama.
-- ===========================================================================
SELECT is(pg_temp.val(16, format('SELECT (role_options(%L) -> ''current'' ->> ''name'')', pg_temp.m(9))), 'Membro', 'RN-23: Rita vê a função de Caio ("Membro")');
SELECT is(pg_temp.val(16, format('SELECT (role_options(%L) ->> ''editable'')', pg_temp.m(9))), 'true', 'RN-18: e pode trocá-la');
SELECT is(pg_temp.val(16, format('SELECT jsonb_array_length(role_options(%L) -> ''options'')::text', pg_temp.m(9))), '3', 'RN-18: Rita pode atribuir as 3 funções semeadas');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) ->> ''reason'')', pg_temp.m(9))), 'no_permission', 'RN-23: Pedro, que não atribui funções, recebe no_permission para Caio');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) ->> ''current'')', pg_temp.m(9))), NULL, 'RN-23: e não vê a função de Caio (current nulo)');
SELECT is(pg_temp.val(3, format('SELECT jsonb_array_length(role_options(%L) -> ''options'')::text', pg_temp.m(9))), '0', 'RN-23: e as opções vêm vazias');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) ->> ''reason'')', pg_temp.m(8))), 'not_found', 'RN-09: Pedro pergunta por Beatriz, que não vê: not_found');
SELECT is(pg_temp.val(9, format('SELECT (role_options(%L) ->> ''reason'')', pg_temp.m(16))), 'not_found', 'RN-23: Caio pergunta pela função de Rita: not_found, nada revelado');
SELECT is(pg_temp.val(9, format('SELECT (role_options(%L) ->> ''current'')', pg_temp.m(16))), NULL, 'RN-23: e current nulo');
SELECT is(pg_temp.val(16, format('SELECT (role_options(%L) ->> ''reason'')', pg_temp.m(16))), 'self', 'RN-18: Rita sobre si mesma: self');
SELECT is(pg_temp.val(16, format('SELECT (role_options(%L) ->> ''editable'')', pg_temp.m(16))), 'false', 'RN-18: e não editável');
SELECT is(pg_temp.val(9, format('SELECT (role_options(%L) -> ''current'' ->> ''name'')', pg_temp.m(9))), 'Membro', 'RN-23: Caio vê a própria função em role_options');
SELECT is(pg_temp.val(16, 'SELECT (role_options() -> ''default_role'' ->> ''name'')'), 'Membro', 'RN-19: sem id, a função padrão é a Membro');
SELECT is(pg_temp.val(16, 'SELECT (role_options() ->> ''editable'')'), 'true', 'RN-18: Rita, no cadastro novo, escolhe a função');
SELECT is(pg_temp.val(3, 'SELECT (role_options() ->> ''editable'')'), 'false', 'RN-19: Pedro, no cadastro novo, não escolhe a função');
SELECT is(pg_temp.val(3, 'SELECT (role_options() ->> ''reason'')'), 'no_permission', 'RN-19: e o motivo é no_permission');
SELECT is(pg_temp.code(19, 'SELECT public.role_options()'), '42501', 'role_options: a conta X, sem cadastro, recebe 42501');
SELECT is(pg_temp.code(NULL, 'SELECT public.role_options()'), '42501', 'role_options: sem sessão, 42501');
-- Função acima: quem atribui funções mas não cobre a função atual (role_above).
SELECT pg_temp.mkrole('T Atribui', ARRAY['assign_role', 'view_own_ministry', 'view_dashboard']);
SELECT pg_temp.give(3, 'T Atribui');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) ->> ''reason'')', pg_temp.m(9))), 'role_above', 'RN-18: Pedro atribui funções, mas não cobre a Membro de Caio: role_above');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) -> ''current'' ->> ''name'')', pg_temp.m(9))), 'Membro', 'RN-18: e vê a função atual de Caio (pode atribuir funções)');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) ->> ''editable'')', pg_temp.m(9))), 'false', 'RN-18: e não edita');
-- Quem atribui e cobre a Membro: oferece só o que cobre (a Membro), nunca a Líder nem a Administrador.
SELECT pg_temp.mkrole('T Atribui cobre', ARRAY['assign_role', 'view_own_ministry', 'view_dashboard', 'edit_own_data', 'submit_own_cell_report']);
SELECT pg_temp.give(3, 'T Atribui cobre');
SELECT is(pg_temp.val(3, format('SELECT (role_options(%L) ->> ''editable'')', pg_temp.m(9))), 'true', 'RN-18: quem atribui e cobre a Membro edita a função de Caio');
SELECT is(pg_temp.val(3, format($q$SELECT string_agg(o ->> 'name', ',' ORDER BY o ->> 'name') FROM jsonb_array_elements(role_options(%L) -> 'options') o WHERE o ->> 'name' NOT LIKE 'T %%'$q$, pg_temp.m(9))), 'Membro',
  'RN-18: o seletor oferece, das funções semeadas, só a Membro (não cobre a Líder nem a Administrador)');
SELECT is(pg_temp.val(3, 'SELECT (role_options() ->> ''editable'')'), 'true', 'RN-18: no cadastro novo, quem atribui funções escolhe a função');
SELECT pg_temp.give(3, 'Líder');

-- ===========================================================================
-- 4. Grants: nenhuma função nova com EXECUTE para anon; as de sessão e as RPCs
--    com EXECUTE para authenticated.
-- ===========================================================================
CREATE TEMP TABLE newfn (sig text, for_auth boolean);
INSERT INTO newfn VALUES
  ('public.active_permissions()', true), ('public.default_role_id()', true),
  ('public.viewer_ministry_member_ids()', true), ('public.viewer_scope_contains_any(uuid[])', true),
  ('public.viewer_tree_roots()', true), ('public.viewer_sees_member(uuid)', true),
  ('public.viewer_sees_cell_people(uuid, uuid, uuid)', true), ('public.viewer_sees_cell(uuid)', true),
  ('public.cell_in_viewer_ministry(uuid)', true), ('public.viewer_is_cell_person(uuid)', true),
  ('public.can_submit_report(uuid)', true), ('public.viewer_covers_role(uuid)', true),
  ('public.can_assign_role(uuid)', true), ('public._assert_admin_remains(uuid)', true),
  ('public.my_access()', true), ('public.role_options(uuid)', true),
  ('public.save_role(uuid, text, text, public.permission_action[], boolean, timestamp with time zone)', true),
  ('public.delete_role(uuid)', true), ('public.check_member_insert(jsonb)', true),
  ('public.viewer_can_insert_cell()', true), ('public.viewer_can_insert_cell_report(uuid)', true),
  ('public.viewer_can_insert_cell_report_participant(uuid)', true),
  ('public.user_has_permission(uuid, public.permission_action)', false), ('public.is_admin(uuid)', false),
  ('public.role_effective_permissions(uuid)', false), ('public.viewer_permissions()', false),
  ('public._viewer_scope_anchors()', false);
SELECT is(has_function_privilege('anon', sig::regprocedure, 'EXECUTE'), false, 'anon sem EXECUTE em ' || sig) FROM newfn ORDER BY sig;
SELECT is(has_function_privilege('authenticated', sig::regprocedure, 'EXECUTE'), for_auth,
  CASE WHEN for_auth THEN 'authenticated executa ' ELSE 'authenticated não executa ' END || sig) FROM newfn ORDER BY sig;
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'
            AND p.prorettype <> 'trigger'::regtype AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0,
  'anon não executa nenhuma função da public que não seja de trigger');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public', 'private') AND p.prosecdef AND p.prorettype <> 'trigger'::regtype
              AND has_function_privilege('anon', p.oid, 'EXECUTE')), 0, 'nenhuma função definer (fora trigger) com EXECUTE para anon');
-- Funções definer fixam o search_path.
SELECT is((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef
            AND p.proname = ANY (ARRAY['active_permissions','default_role_id','viewer_ministry_member_ids','viewer_scope_contains_any','viewer_tree_roots',
                 'viewer_sees_member','viewer_sees_cell_people','viewer_sees_cell','cell_in_viewer_ministry','viewer_is_cell_person','can_submit_report',
                 'viewer_covers_role','can_assign_role','_assert_admin_remains','my_access','role_options','save_role','delete_role'])
            AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')), 0,
  'toda função nova SECURITY DEFINER fixa o search_path');

-- ===========================================================================
-- 5. roles_view: só SELECT para authenticated, dona postgres.
-- ===========================================================================
SELECT is((SELECT relowner::regrole::text FROM pg_class WHERE oid = 'public.roles_view'::regclass), 'postgres', 'roles_view: dona postgres');
SELECT is((SELECT relkind::text FROM pg_class WHERE oid = 'public.roles_view'::regclass), 'v', 'roles_view é uma view');
SELECT is(has_table_privilege('authenticated', 'public.roles_view', 'SELECT'), true, 'roles_view: authenticated com SELECT');
SELECT is(has_table_privilege('authenticated', 'public.roles_view', p), false, 'roles_view: authenticated sem ' || p)
  FROM unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p;
SELECT is(has_table_privilege('anon', 'public.roles_view', p), false, 'roles_view: anon sem ' || p)
  FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p;
SELECT is((SELECT array_agg(privilege_type::text ORDER BY privilege_type) FROM information_schema.role_table_grants
            WHERE table_schema = 'public' AND table_name = 'roles_view' AND grantee = 'authenticated'), ARRAY['SELECT'], 'roles_view: o único privilégio de authenticated é SELECT');
SELECT ok('security_invoker=false' = ANY (SELECT unnest(reloptions) FROM pg_class WHERE oid = 'public.roles_view'::regclass) OR (SELECT reloptions IS NULL FROM pg_class WHERE oid = 'public.roles_view'::regclass),
  'roles_view: security definer de propósito (não trocar para security_invoker)');
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute WHERE attrelid = 'public.roles_view'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['id', 'name', 'description', 'is_protected', 'is_default', 'permissions', 'members_count', 'updated_at'], 'roles_view: colunas do contrato');
SELECT is(pg_temp.val(16, 'SELECT count(*)::text FROM public.roles_view'), (SELECT count(*)::text FROM public.roles), 'roles_view: Rita (Gerenciar Funções) vê todas as funções');
SELECT is(pg_temp.val(9, 'SELECT count(*)::text FROM public.roles_view'), '0', 'roles_view: Caio, sem Visualizar nem Gerenciar Funções, não vê nenhuma');
SELECT is(pg_temp.val(19, 'SELECT count(*)::text FROM public.roles_view'), '0', 'roles_view: a conta X não vê nenhuma');
SELECT is(pg_temp.val(NULL, 'SELECT count(*)::text FROM public.roles_view'), '0', 'roles_view: sem sessão, nenhuma');
SELECT is(pg_temp.val(16, $q$SELECT (SELECT members_count FROM public.roles_view WHERE name = 'Líder')::text$q$), '7', 'roles_view: a função Líder é usada por 7 membros (Samuel, Magda, Pedro, Paula, André, Diego e PastorComLider)');
SELECT pg_temp.mkrole('T Vê funções', ARRAY['view_roles', 'view_dashboard']);
SELECT pg_temp.give(9, 'T Vê funções');
SELECT is(pg_temp.val(9, 'SELECT count(*)::text FROM public.roles_view'), (SELECT count(*)::text FROM public.roles), 'roles_view: Visualizar Funções basta para ler');
SELECT pg_temp.give(9, 'Membro');
SELECT is(pg_temp.val(16, $q$SELECT cardinality(permissions)::text FROM public.roles_view WHERE is_protected$q$), (SELECT cardinality(public.active_permissions())::text),
  'roles_view: a Administrador lista todas as permissões ativas');
SELECT is(pg_temp.val(16, $q$SELECT count(*)::text FROM public.roles_view WHERE 'view_members' = ANY (permissions) OR 'view_own_ministry_dashboard' = ANY (permissions)$q$), '0',
  'roles_view: nenhuma função lista as permissões aposentadas');

-- ===========================================================================
-- 6. Índices, constraints e triggers das migrations 2 e 4.
-- ===========================================================================
SELECT has_index('public', 'roles', 'roles_single_system_idx', 'índice roles_single_system_idx existe');
SELECT is((SELECT indisunique FROM pg_index WHERE indexrelid = 'public.roles_single_system_idx'::regclass), true, 'roles_single_system_idx é único');
SELECT is((SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid = 'public.roles_single_system_idx'::regclass), 'is_system', 'e parcial em is_system');
SELECT has_index('public', 'members', 'members_role_id_idx', 'índice members_role_id_idx existe');
SELECT is((SELECT pg_get_expr(indpred, indrelid) FROM pg_index WHERE indexrelid = 'public.members_role_id_idx'::regclass), '(deleted_at IS NULL)', 'members_role_id_idx é parcial nos não excluídos');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.roles'::regclass AND conname = 'roles_system_not_default' AND contype = 'c'), 1, 'CHECK roles_system_not_default existe');
SELECT is((SELECT count(*)::int FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'roles' AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%is_default%'), 1,
  'existe o índice único da função padrão (no máximo uma)');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = r.t::regclass AND tgname = r.n AND NOT tgisinternal), 1, 'trigger ' || r.n || ' em ' || r.t)
  FROM (VALUES ('public.members', 'ac_enforce_member_scope'), ('public.members', 'zz_enforce_member_visible_after'),
               ('public.cells', 'ab_enforce_cell_scope'), ('public.cell_reports', 'ab_enforce_cell_report_scope'),
               ('public.cell_report_participants', 'ab_enforce_participant_scope'),
               ('public.roles', 'aa_protect_roles'), ('public.role_permissions', 'aa_protect_role_permissions'),
               ('public.roles', 'zz_roles_exactly_one_default')) r(t, n);
SELECT is((SELECT tgdeferrable AND tginitdeferred FROM pg_trigger WHERE tgrelid = 'public.roles'::regclass AND tgname = 'zz_roles_exactly_one_default'), true,
  'zz_roles_exactly_one_default é adiado (confere no commit)');
-- Uma só função de sistema: uma segunda é recusada pelo índice, mesmo na manutenção.
SELECT is(pg_temp.code(NULL, 'SELECT 1'), '00000', 'sessão de teste ok');
CREATE FUNCTION pg_temp.second_system() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM set_config('app.role_maintenance', 'on', true);
    INSERT INTO public.roles (name, is_system) VALUES ('Segunda Administrador', true);
    PERFORM set_config('app.role_maintenance', 'off', true);
    RETURN 'inseriu';
  EXCEPTION WHEN unique_violation THEN
    PERFORM set_config('app.role_maintenance', 'off', true);
    RETURN 'unique_violation';
  END;
END $$;
SELECT is(pg_temp.second_system(), 'unique_violation', 'uma segunda função is_system é recusada (roles_single_system_idx)');
CREATE FUNCTION pg_temp.admin_default() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM set_config('app.role_maintenance', 'on', true);
    UPDATE public.roles SET is_default = true WHERE is_system;
    PERFORM set_config('app.role_maintenance', 'off', true);
    RETURN 'atualizou';
  EXCEPTION WHEN check_violation THEN
    PERFORM set_config('app.role_maintenance', 'off', true);
    RETURN 'check_violation';
  END;
END $$;
SELECT is(pg_temp.admin_default(), 'check_violation', 'a Administrador como padrão é recusada pelo CHECK (roles_system_not_default)');
-- Funções semeadas: uma só de cada.
SELECT is((SELECT count(*)::int FROM public.roles WHERE is_system), 1, 'existe exatamente uma função de sistema');
SELECT is((SELECT name FROM public.roles WHERE is_system), 'Administrador', 'e é a Administrador');
SELECT is((SELECT count(*)::int FROM public.roles WHERE is_default), 1, 'existe exatamente uma função padrão');
SELECT is((SELECT name FROM public.roles WHERE is_default), 'Membro', 'e é a Membro');

SELECT * FROM finish();
ROLLBACK;
