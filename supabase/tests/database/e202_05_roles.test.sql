-- E2.02 (PR 1): funções (RN-16 a RN-22): semeadas, Administrador, padrão,
-- exclusão, última administradora, permissões aposentadas, save_role e
-- delete_role.
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), RN-16 a RN-22,
-- DA-3, DA-8, "RPCs" (save_role e delete_role), "Formato dos erros (AQ-5)".
--
-- Cobre, com o código e a mensagem do spec:
--   - RN-16: as três funções semeadas com as permissões da tabela, a Membro
--     como padrão, nenhuma linha aposentada;
--   - RN-17: Administrador com todas as permissões ativas sem depender das
--     linhas, protegida (nome, descrição, permissões, exclusão e padrão), e
--     Rita edita Ester, Débora e a célula C3;
--   - RN-19: troca atômica da padrão, recusa de desmarcar sem marcar outra,
--     a recusa de ficar sem padrão no commit (constraint adiado), uma só padrão;
--   - RN-20: excluir função em uso (com a contagem), a padrão, a sem uso e a
--     cujo único membro foi excluído;
--   - RN-22: as permissões aposentadas não liberam nada e save_role as recusa;
--     Hugo só com Enviar Relatório; Toda a Igreja vê Ministérios; Auditoria;
--   - DA-3: quem salva a função só acrescenta o que tem; nome, descrição e
--     concorrência da tela (role_changed).
--
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

SELECT plan(101);

-- ===========================================================================
-- 1. RN-16: as funções semeadas.
-- ===========================================================================
SELECT is((SELECT description FROM public.roles WHERE name = 'Administrador'), 'Acesso total ao sistema, em toda a igreja.', 'RN-16: descrição da Administrador');
SELECT is((SELECT description FROM public.roles WHERE name = 'Líder'), 'Vê e gerencia membros, células e relatórios do seu ministério.', 'RN-16: descrição da Líder');
SELECT is((SELECT description FROM public.roles WHERE name = 'Membro'), 'Vê o seu ministério, edita os próprios dados e envia o relatório das suas células.', 'RN-16: descrição da Membro');
SELECT is((SELECT is_system FROM public.roles WHERE name = 'Administrador'), true, 'RN-16: a Administrador é a função do sistema');
SELECT is((SELECT is_default FROM public.roles WHERE name = 'Membro'), true, 'RN-16: a Membro é a padrão');
SELECT is((SELECT is_default FROM public.roles WHERE name = 'Líder'), false, 'RN-16: a Líder não é a padrão');
SELECT is((SELECT string_agg(permission::text, ',' ORDER BY permission::text) FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE r.name = 'Líder'),
  'create_cell,create_member,delete_cell,delete_cell_report,delete_member,edit_cell,edit_cell_report,edit_member,edit_own_data,submit_own_cell_report,view_dashboard,view_own_ministry',
  'RN-16: a Líder tem exatamente as 12 permissões da tabela');
SELECT is((SELECT string_agg(permission::text, ',' ORDER BY permission::text) FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE r.name = 'Membro'),
  'edit_own_data,submit_own_cell_report,view_dashboard,view_own_ministry',
  'RN-16: a Membro tem exatamente as 4 permissões da tabela');
SELECT is((SELECT count(*)::int FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE r.name = 'Líder' AND rp.permission IN ('view_members', 'view_roles', 'view_sensitive_data', 'change_member_password', 'assign_role', 'manage_roles', 'view_all_church')), 0,
  'RN-16: a Líder não tem Visualizar Membros (legado), Funções, Dados Sensíveis, Senha, Atribuir Função nem a igreja toda');
SELECT is((SELECT count(*)::int FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id WHERE r.name = 'Administrador'), cardinality(public.active_permissions()),
  'RN-16: a Administrador tem uma linha por permissão ativa (documentação)');
SELECT is((SELECT count(*)::int FROM public.role_permissions WHERE permission IN ('view_members', 'view_own_ministry_dashboard')), 0, 'RN-22: nenhuma linha de permissão aposentada sobrou');
SELECT is((SELECT count(*)::int FROM public.roles WHERE is_default), 1, 'RN-19: existe exatamente uma função padrão');
SELECT is(pg_temp.val(3, 'SELECT (SELECT string_agg(rv.name, '','' ORDER BY rv.name) FROM public.roles_view rv)'), NULL, 'RN-16: Pedro, Líder, não vê a tela de Funções (roles_view vazia)');
SELECT is(pg_temp.val(16, $q$SELECT string_agg(name, ',' ORDER BY name) FROM public.roles_view WHERE name IN ('Administrador', 'Líder', 'Membro')$q$), 'Administrador,Líder,Membro', 'RN-16: Rita vê as três funções semeadas na tela');
-- RN-16: a Líder cobre a Membro (pode cadastrar membros com a função padrão).
SELECT is(pg_temp.val(3, format('SELECT public.viewer_covers_role(%L)::text', pg_temp.role('Membro'))), 'true', 'RN-16: Pedro (Líder) cobre a Membro');
SELECT is(pg_temp.val(3, format('SELECT public.viewer_covers_role(%L)::text', pg_temp.role('Líder'))), 'true', 'RN-16: e a própria Líder');
SELECT is(pg_temp.val(3, format('SELECT public.viewer_covers_role(%L)::text', pg_temp.role('Administrador'))), 'false', 'RN-16: mas não a Administrador');
SELECT is(pg_temp.val(9, format('SELECT public.viewer_covers_role(%L)::text', pg_temp.role('Líder'))), 'false', 'RN-16: Caio (Membro) não cobre a Líder');
SELECT is(pg_temp.val(16, format('SELECT public.can_assign_role(%L)::text', pg_temp.role('Administrador'))), 'true', 'RN-18: Rita atribui a Administrador');
SELECT is(pg_temp.val(3, format('SELECT public.can_assign_role(%L)::text', pg_temp.role('Membro'))), 'false', 'RN-18: Pedro (Líder, sem Atribuir Função) não atribui nem a Membro');

-- ===========================================================================
-- 2. RN-17: a função Administrador.
-- ===========================================================================
SELECT is(pg_temp.val(16, 'SELECT cardinality(permissions)::text FROM public.my_access()'), cardinality(public.active_permissions())::text, 'RN-17: Rita tem todas as permissões ativas');
SELECT is((SELECT array_agg(p ORDER BY p) FROM unnest(public.role_effective_permissions(pg_temp.role('Administrador'))) p), (SELECT array_agg(p ORDER BY p) FROM unnest(public.active_permissions()) p),
  'RN-17: as permissões efetivas da Administrador são as ativas, sem consultar linhas');
SELECT is(pg_get_functiondef('public.role_effective_permissions(uuid)'::regprocedure) ~ 'active_permissions', true,
  'RN-17: role_effective_permissions usa active_permissions(): uma permissão nova entra sozinha');
-- Sem nenhuma linha em role_permissions, a Administrador continua com tudo.
SELECT pg_temp.run('adm_rows',
  $s$SET LOCAL app.role_maintenance = 'on'; DELETE FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE is_system); SET LOCAL app.role_maintenance = 'off'$s$,
  ARRAY[pg_temp.pv(16, 'SELECT cardinality(permissions)::text FROM public.my_access()'),
        pg_temp.pc(16, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(17)))]);
SELECT is(v[1], cardinality(public.active_permissions())::text, 'RN-17: sem nenhuma linha de documentação, Rita continua com todas as permissões') FROM sb WHERE k = 'adm_rows';
SELECT is(v[2], '00000', 'RN-17: e continua editando') FROM sb WHERE k = 'adm_rows';

SELECT pg_temp.run('adm',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(16, format('SELECT public.save_role(%L, ''Outro nome'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)', pg_temp.role('Administrador'))),
    /* 2 */ pg_temp.pm(16, format('SELECT public.save_role(%L, ''Outro nome'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)', pg_temp.role('Administrador'))),
    /* 3 */ pg_temp.pm(16, format('SELECT public.save_role(%L, ''Administrador'', NULL, ''{}'', true)', pg_temp.role('Administrador'))),
    /* 4 */ pg_temp.pm(16, format('SELECT public.delete_role(%L)', pg_temp.role('Administrador'))),
    /* 5 */ pg_temp.pc(16, format('UPDATE public.roles SET name = ''Adm'' WHERE id = %L', pg_temp.role('Administrador'))),
    /* 6 */ pg_temp.pc(16, format('UPDATE public.roles SET description = ''x'' WHERE id = %L', pg_temp.role('Administrador'))),
    /* 7 */ pg_temp.pc(16, format('DELETE FROM public.roles WHERE id = %L', pg_temp.role('Administrador'))),
    /* 8 */ pg_temp.pc(16, format('DELETE FROM public.role_permissions WHERE role_id = %L AND permission = ''view_dashboard''', pg_temp.role('Administrador'))),
    /* 9 */ pg_temp.pc(16, format('INSERT INTO public.role_permissions (role_id, permission) VALUES (%L, ''view_dashboard'')', pg_temp.role('Administrador'))),
    /* 10 */ pg_temp.pc(16, format('UPDATE public.roles SET is_default = true WHERE id = %L', pg_temp.role('Administrador'))),
    /* 11 */ 'SELECT (SELECT count(*) FROM public.roles WHERE name = ''Administrador'' AND is_system AND NOT is_default)::text || (SELECT count(*) FROM public.role_permissions WHERE role_id = (SELECT id FROM public.roles WHERE is_system))::text',
    /* 12 */ pg_temp.pc(16, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(17))),
    /* 13 */ pg_temp.pc(16, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(13))),
    /* 14 */ pg_temp.pc(16, format('UPDATE public.cells SET meeting_time = ''21:00'' WHERE id = %L', pg_temp.c(3)))
  ]);
SELECT is(v[1], 'admin_role_protected', 'RN-17: Rita muda o nome, a descrição e as permissões da Administrador (save_role): admin_role_protected') FROM sb WHERE k = 'adm';
SELECT is(v[2], 'A função Administrador não pode ser alterada.', 'RN-17: com a mensagem do spec') FROM sb WHERE k = 'adm';
SELECT is(v[3], 'A função Administrador não pode ser a função padrão.', 'RN-17: marcar como padrão: mensagem do spec') FROM sb WHERE k = 'adm';
SELECT is(v[4], 'A função Administrador não pode ser excluída.', 'RN-17: excluí-la: mensagem do spec') FROM sb WHERE k = 'adm';
SELECT is(v[5], 'admin_role_protected', 'RN-17: UPDATE direto do nome da Administrador também é recusado') FROM sb WHERE k = 'adm';
SELECT is(v[6], 'admin_role_protected', 'RN-17: e o da descrição') FROM sb WHERE k = 'adm';
SELECT is(v[7], 'admin_role_protected', 'RN-17: e o DELETE direto') FROM sb WHERE k = 'adm';
SELECT is(v[8], 'admin_role_protected', 'RN-17: e tirar uma permissão dela') FROM sb WHERE k = 'adm';
SELECT is(v[9], 'admin_role_protected', 'RN-17: e dar uma permissão a ela') FROM sb WHERE k = 'adm';
SELECT ok(v[10] IN ('admin_role_protected', '23514'), 'RN-17: e marcá-la como padrão por UPDATE direto (' || v[10] || ')') FROM sb WHERE k = 'adm';
SELECT is(v[11], '122', 'RN-17: e nada mudou: continua a Administrador, não padrão, com as 22 linhas') FROM sb WHERE k = 'adm';
SELECT is(v[12], '00000', 'RN-17: Rita edita Ester (fora de qualquer ministério)') FROM sb WHERE k = 'adm';
SELECT is(v[13], '00000', 'RN-17: edita Débora') FROM sb WHERE k = 'adm';
SELECT is(v[14], '00000', 'RN-17: e a célula C3') FROM sb WHERE k = 'adm';

-- ===========================================================================
-- 3. save_role e delete_role: quem pode e as entradas (DA-3).
-- ===========================================================================
SELECT pg_temp.run('sr',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Gestor ministério', ARRAY['manage_roles', 'view_own_ministry', 'view_dashboard']) WHERE id = %L$s$, pg_temp.m(3)),
  ARRAY[
    /* 1 */ pg_temp.pc(9, 'SELECT public.save_role(NULL, ''Nova'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)'),
    /* 2 */ pg_temp.pc(19, 'SELECT public.save_role(NULL, ''Nova'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)'),
    /* 3 */ pg_temp.pc(NULL, 'SELECT public.save_role(NULL, ''Nova'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)'),
    /* 4 */ pg_temp.pc(9, format('SELECT public.delete_role(%L)', pg_temp.role('Líder'))),
    /* 5 */ pg_temp.pc(16, 'SELECT public.save_role(NULL, ''   '', NULL, ''{}'', false)'),
    /* 6 */ pg_temp.pm(16, 'SELECT public.save_role(NULL, ''   '', NULL, ''{}'', false)'),
    /* 7 */ pg_temp.pc(16, 'SELECT public.save_role(NULL, ''Líder'', NULL, ''{}'', false)'),
    /* 8 */ pg_temp.pc(16, 'SELECT public.save_role(NULL, ''líder'', NULL, ''{}'', false)'),
    /* 9 */ pg_temp.pc(16, 'SELECT public.save_role(NULL, ''Recepção'', NULL, ARRAY[''view_members'']::public.permission_action[], false)'),
    /* 10 */ pg_temp.pm(16, 'SELECT public.save_role(NULL, ''Recepção'', NULL, ARRAY[''view_members'']::public.permission_action[], false)'),
    /* 11 */ 'SELECT count(*)::text FROM public.roles WHERE name = ''Recepção''',
    -- DA-3: quem tem só Gerenciar Funções + Seu Ministério não dá "Visualizar Toda a Igreja" nem "Gerenciar Funções" demais.
    /* 12 */ pg_temp.pc(3, 'SELECT public.save_role(NULL, ''Escalada'', NULL, ARRAY[''view_all_church'', ''view_dashboard'']::public.permission_action[], false)'),
    /* 13 */ pg_temp.pm(3, 'SELECT public.save_role(NULL, ''Escalada'', NULL, ARRAY[''view_all_church'', ''view_dashboard'']::public.permission_action[], false)'),
    /* 14 */ pg_temp.pc(3, 'SELECT public.save_role(NULL, ''Menor'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)'),
    /* 15 */ 'SELECT count(*)::text FROM public.roles WHERE name IN (''Escalada'', ''Menor'')',
    -- Retirar é livre: Pedro tira uma permissão da função que criou, e ela fica menor.
    /* 16 */ pg_temp.pc(3, 'SELECT public.save_role((SELECT id FROM public.roles WHERE name = ''Menor''), ''Menor'', NULL, ''{}'', false)'),
    /* 17 */ pg_temp.pc(16, format('SELECT public.save_role(%L, ''Líder'', NULL, ''{}'', false, now() - interval ''1 day'')', pg_temp.role('Líder'))),
    /* 18 */ pg_temp.pm(16, format('SELECT public.save_role(%L, ''Líder'', NULL, ''{}'', false, now() - interval ''1 day'')', pg_temp.role('Líder'))),
    /* 19 */ pg_temp.pc(16, format('SELECT public.save_role(%L, ''Fantasma'', NULL, ''{}'', false)', gen_random_uuid()))
  ]);
SELECT is(v[1], '42501', 'save_role: Caio (Membro) recebe 42501') FROM sb WHERE k = 'sr';
SELECT is(v[2], '42501', 'save_role: a conta X recebe 42501') FROM sb WHERE k = 'sr';
SELECT is(v[3], '42501', 'save_role: sem sessão, 42501') FROM sb WHERE k = 'sr';
SELECT is(v[4], '42501', 'delete_role: Caio recebe 42501') FROM sb WHERE k = 'sr';
SELECT is(v[5], 'role_name_required', 'save_role: nome em branco: role_name_required') FROM sb WHERE k = 'sr';
SELECT is(v[6], 'Informe o nome da função.', 'save_role: com a mensagem do spec') FROM sb WHERE k = 'sr';
SELECT is(v[7], 'role_name_taken', 'save_role: nome já usado: role_name_taken') FROM sb WHERE k = 'sr';
SELECT is(v[9], 'permission_retired', 'RN-22: save_role com Visualizar Membros (legado): permission_retired') FROM sb WHERE k = 'sr';
SELECT is(v[10], 'Esta permissão não existe mais.', 'RN-22: com a mensagem do spec') FROM sb WHERE k = 'sr';
SELECT is(v[11], '0', 'RN-22: e a função não é criada') FROM sb WHERE k = 'sr';
SELECT is(v[12], 'permission_not_covered', 'DA-3: Pedro dá "Toda a Igreja" a uma função nova: recusado, não tem essa permissão') FROM sb WHERE k = 'sr';
SELECT is(v[13], 'Você não pode dar a uma função uma permissão que você não tem.', 'DA-3: com a mensagem do spec') FROM sb WHERE k = 'sr';
SELECT is(v[14], '00000', 'DA-3: Pedro cria uma função com uma permissão que tem') FROM sb WHERE k = 'sr';
SELECT is(v[15], '1', 'DA-3: só a "Menor" existe') FROM sb WHERE k = 'sr';
SELECT is(v[16], '00000', 'DA-3: retirar é livre (Pedro tira as permissões de "Menor")') FROM sb WHERE k = 'sr';
SELECT is(v[17], 'role_changed', 'save_role: _expected_updated_at antigo: role_changed') FROM sb WHERE k = 'sr';
SELECT is(v[18], 'Esta função foi alterada em outra tela.', 'save_role: com a mensagem do spec') FROM sb WHERE k = 'sr';
SELECT is(v[19], 'role_not_found', 'save_role: função que não existe: role_not_found') FROM sb WHERE k = 'sr';

-- ===========================================================================
-- 4. RN-19: a função padrão.
-- ===========================================================================
SELECT pg_temp.run('def',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(16, format('SELECT public.save_role(%L, ''Membro'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)', pg_temp.role('Membro'))),
    /* 2 */ pg_temp.pm(16, format('SELECT public.save_role(%L, ''Membro'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], false)', pg_temp.role('Membro'))),
    /* 3 */ 'SELECT string_agg(name, '','') FROM public.roles WHERE is_default',
    /* 4 */ pg_temp.pc(16, 'SELECT public.save_role(NULL, ''Apoio'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], true)'),
    /* 5 */ 'SELECT string_agg(name, '','') FROM public.roles WHERE is_default',
    /* 6 */ 'SELECT count(*)::text FROM public.roles WHERE is_default',
    /* 7 */ pg_temp.pc(16, format('SELECT public.save_role(%L, ''Membro'', NULL, ARRAY[''view_dashboard'', ''view_own_ministry'', ''edit_own_data'', ''submit_own_cell_report'']::public.permission_action[], true)', pg_temp.role('Membro'))),
    /* 8 */ 'SELECT string_agg(name, '','') FROM public.roles WHERE is_default',
    /* 9 */ pg_temp.pc(16, 'SELECT public.save_role((SELECT id FROM public.roles WHERE name = ''Apoio''), ''Apoio'', NULL, ARRAY[''view_dashboard'']::public.permission_action[], true)'),
    /* 10 */ pg_temp.pm(16, format('UPDATE public.roles SET is_default = true WHERE name = ''Líder''')),
    /* 11 */ 'SELECT count(*)::text FROM public.roles WHERE is_default'
  ]);
SELECT is(v[1], 'role_default_required', 'RN-19: Rita desmarca a Membro como padrão sem marcar outra (save_role): role_default_required') FROM sb WHERE k = 'def';
SELECT is(v[2], 'Esta é a função padrão. Para trocar, marque outra função como padrão.', 'RN-19: com a mensagem do spec') FROM sb WHERE k = 'def';
SELECT is(v[3], 'Membro', 'RN-19: a Membro continua a padrão') FROM sb WHERE k = 'def';
SELECT is(v[4], '00000', 'RN-19: Rita marca a função nova "Apoio" como padrão: aceito') FROM sb WHERE k = 'def';
SELECT is(v[5], 'Apoio', 'RN-19: a Apoio passa a ser a padrão e a Membro deixa de ser, na mesma operação') FROM sb WHERE k = 'def';
SELECT is(v[6], '1', 'RN-19: existe exatamente uma função padrão') FROM sb WHERE k = 'def';
SELECT is(v[8], 'Membro', 'RN-19: voltar a Membro como padrão também troca atomicamente') FROM sb WHERE k = 'def';
SELECT is(v[9], '00000', 'RN-19: remarcar a Apoio funciona') FROM sb WHERE k = 'def';
SELECT is(v[11], '1', 'RN-19: e segue uma só') FROM sb WHERE k = 'def';

-- A recusa de ficar sem padrão no commit (constraint adiado), conferida na hora com SET CONSTRAINTS.
CREATE FUNCTION pg_temp.no_default_at_commit() RETURNS text LANGUAGE plpgsql AS $$
DECLARE _c text;
BEGIN
  BEGIN
    UPDATE public.roles SET is_default = false WHERE is_default;
    SET CONSTRAINTS zz_roles_exactly_one_default IMMEDIATE;
    RETURN 'passou';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _c = PG_EXCEPTION_DETAIL;
    RETURN coalesce(_c::jsonb ->> 'code', SQLSTATE);
  END;
END $$;
SELECT is(pg_temp.no_default_at_commit(), 'role_default_required', 'RN-19: zero funções padrão no commit: role_default_required');
CREATE FUNCTION pg_temp.two_defaults() RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    UPDATE public.roles SET is_default = true WHERE name = 'Líder';
    RETURN 'passou';
  EXCEPTION WHEN unique_violation THEN
    RETURN 'unique_violation';
  END;
END $$;
SELECT is(pg_temp.two_defaults(), 'unique_violation', 'RN-19: duas padrão ao mesmo tempo: o índice único recusa');
-- Só 42501 e nada gravado para quem não gerencia funções.
SELECT is(pg_temp.rows(3, format('UPDATE public.roles SET is_default = true WHERE id = %L', pg_temp.role('Líder'))), '0', 'RN-19: Pedro não troca a padrão por UPDATE direto (0 linhas)');

-- ===========================================================================
-- 5. RN-20: excluir uma função.
-- ===========================================================================
SELECT pg_temp.run('rn20',
  format($s$SELECT pg_temp.mkrole('Apoio', ARRAY['view_dashboard']);
            SELECT pg_temp.mkrole('Solo', ARRAY['view_dashboard']);
            SELECT pg_temp.mkrole('Excluída só', ARRAY['view_dashboard']);
            UPDATE public.members SET role_id = (SELECT id FROM public.roles WHERE name = 'Solo') WHERE id = %L;
            UPDATE public.members SET role_id = (SELECT id FROM public.roles WHERE name = 'Excluída só') WHERE id = %L;
            UPDATE public.members SET deleted_at = now() WHERE id = %L$s$, pg_temp.m(18), pg_temp.m(20), pg_temp.m(20)),
  ARRAY[
    /* 1 */ pg_temp.pc(16, format('SELECT public.delete_role(%L)', pg_temp.role('Líder'))),
    /* 2 */ pg_temp.pm(16, format('SELECT public.delete_role(%L)', pg_temp.role('Líder'))),
    /* 3 */ pg_temp.pc(16, format('SELECT public.delete_role(%L)', pg_temp.role('Membro'))),
    /* 4 */ pg_temp.pm(16, format('SELECT public.delete_role(%L)', pg_temp.role('Membro'))),
    /* 5 */ pg_temp.pc(16, 'SELECT public.delete_role((SELECT id FROM public.roles WHERE name = ''Apoio''))'),
    /* 6 */ 'SELECT count(*)::text FROM public.roles WHERE name = ''Apoio''',
    /* 7 */ pg_temp.pm(16, 'SELECT public.delete_role((SELECT id FROM public.roles WHERE name = ''Solo''))'),
    /* 8 */ pg_temp.pc(16, 'SELECT public.delete_role((SELECT id FROM public.roles WHERE name = ''Excluída só''))'),
    /* 9 */ format('SELECT coalesce(role_id::text, ''-'') FROM public.members WHERE id = %L', pg_temp.m(20)),
    /* 10 */ pg_temp.pc(16, format('SELECT public.delete_role(%L)', gen_random_uuid())),
    /* 11 */ pg_temp.pc(3, 'SELECT public.delete_role((SELECT id FROM public.roles WHERE name = ''Apoio''))')
  ]);
SELECT is(v[1], 'role_in_use', 'RN-20: Rita exclui a Líder, usada por membros: role_in_use') FROM sb WHERE k = 'rn20';
SELECT is(v[2], 'Esta função é usada por 7 membros. Troque a função deles antes de excluí-la.', 'RN-20: com a contagem (Samuel, Magda, Pedro, Paula, André, Diego e PastorComLider) e a mensagem do spec') FROM sb WHERE k = 'rn20';
SELECT is(v[3], 'role_is_default', 'RN-20: Rita exclui a Membro, a padrão: role_is_default') FROM sb WHERE k = 'rn20';
SELECT is(v[4], 'Esta é a função padrão. Escolha outra função padrão antes de excluí-la.', 'RN-20: com a mensagem do spec') FROM sb WHERE k = 'rn20';
SELECT is(v[5], '00000', 'RN-20: Rita exclui a Apoio, que ninguém usa: aceito') FROM sb WHERE k = 'rn20';
SELECT is(v[6], '0', 'RN-20: e a Apoio some') FROM sb WHERE k = 'rn20';
SELECT is(v[7], 'Esta função é usada por 1 membro. Troque a função deles antes de excluí-la.', 'RN-20: uma função de um só membro diz "por 1 membro"') FROM sb WHERE k = 'rn20';
SELECT is(v[8], '00000', 'RN-20: uma função cujo único membro foi excluído é excluída') FROM sb WHERE k = 'rn20';
SELECT is(v[9], '-', 'E2.01 DA-2: e o membro excluído fica sem função') FROM sb WHERE k = 'rn20';
SELECT is(v[10], 'role_not_found', 'RN-20: função que não existe: role_not_found') FROM sb WHERE k = 'rn20';
SELECT is(v[11], '42501', 'RN-20: Pedro (sem Gerenciar Funções) não exclui função: 42501') FROM sb WHERE k = 'rn20';

-- ===========================================================================
-- 6. RN-22: permissões aposentadas e o que cada uma libera agora.
-- ===========================================================================
-- Uma função que ganhou view_members por fora da API (manutenção) não libera nada.
SELECT pg_temp.run('ret',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Retirada', ARRAY['view_members', 'view_own_ministry_dashboard'], true) WHERE id = %L$s$, pg_temp.m(15)),
  ARRAY[
    pg_temp.pv(15, 'SELECT cardinality(permissions)::text FROM public.my_access()'),
    pg_temp.pv(15, 'SELECT count(*)::text FROM public.members_view'),
    pg_temp.pc(15, 'SELECT * FROM public.dashboard_summary()'),
    pg_temp.pv(15, 'SELECT (sees_whole_church::text || sees_ministry::text) FROM public.my_access()'),
    $p$SELECT count(*)::text FROM public.role_permissions WHERE permission IN ('view_members', 'view_own_ministry_dashboard')$p$
  ]);
SELECT is(v[1], '0', 'RN-22: Hugo com Visualizar Membros (legado) e Dashboard do ministério (legado): nenhuma permissão efetiva') FROM sb WHERE k = 'ret';
SELECT is(v[2], '1', 'RN-22: e a members_view mostra só ele') FROM sb WHERE k = 'ret';
SELECT is(v[3], '42501', 'RN-22: e o dashboard recusa (42501)') FROM sb WHERE k = 'ret';
SELECT is(v[4], 'falsefalse', 'RN-22: e my_access não vê a igreja nem o ministério') FROM sb WHERE k = 'ret';
-- INSERT direto (fora da manutenção) também é recusado, como a API.
SELECT is(pg_temp.try(16, format('INSERT INTO public.role_permissions (role_id, permission) VALUES (%L, ''view_members'')', pg_temp.role('Membro'))) ->> 'code', 'permission_retired',
  'RN-22: dar view_members a uma função por INSERT é recusado (permission_retired)');
SELECT is(pg_temp.try(16, format('INSERT INTO public.role_permissions (role_id, permission) VALUES (%L, ''view_own_ministry_dashboard'')', pg_temp.role('Membro'))) ->> 'code', 'permission_retired',
  'RN-22: idem view_own_ministry_dashboard');
SELECT is((pg_temp.try(16, 'SELECT public.save_role(NULL, ''X'', NULL, ARRAY[''view_members'', ''view_own_ministry_dashboard'']::public.permission_action[], false)') -> 'detail' -> 'permissions'), '["view_members", "view_own_ministry_dashboard"]'::jsonb,
  'RN-22: save_role devolve as permissões aposentadas no detalhe');

-- Hugo só com "Enviar Relatório das Próprias Células" (RN-22): Relatórios, R2 e C2; sem Membros nem Dashboard.
SELECT pg_temp.run('hugo',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Só envia', ARRAY['submit_own_cell_report']) WHERE id = %L$s$, pg_temp.m(15)),
  ARRAY[
    pg_temp.pv(15, 'SELECT (sees_whole_church::text || sees_ministry::text || sees_whole_church_reports::text || sees_ministry_reports::text || can_submit_some_report::text) FROM public.my_access()'),
    pg_temp.pc(15, 'SELECT * FROM public.dashboard_summary()'),
    pg_temp.lab_probe(15),
    $p$SELECT pg_temp.lab(pg_temp.ids(15, 'SELECT id FROM public.cell_reports_view'))$p$,
    $p$SELECT pg_temp.lab(pg_temp.ids(15, 'SELECT id FROM public.cells_view'))$p$,
    pg_temp.pc(15, pg_temp.ins_report_text(pg_temp.c(2)))
  ]);
SELECT is(v[1], 'falsefalsefalsefalsetrue', 'RN-22: Hugo só com Enviar Relatório: não vê membros nem relatórios por escopo, mas lança') FROM sb WHERE k = 'hugo';
SELECT is(v[2], '42501', 'RN-22: e não vê o Dashboard') FROM sb WHERE k = 'hugo';
SELECT is(v[3], 'Hugo', 'RN-22: nem Membros além do próprio cadastro') FROM sb WHERE k = 'hugo';
SELECT is(v[4], 'R2', 'RN-22: vê R2 em Relatórios') FROM sb WHERE k = 'hugo';
SELECT is(v[5], 'C2', 'RN-02: e a célula C2 (é timóteo)') FROM sb WHERE k = 'hugo';
SELECT is(v[6], '00000', 'RN-22: e lança o relatório de C2') FROM sb WHERE k = 'hugo';

-- "Visualizar Toda a Igreja" sem "Seu Ministério" vê Ministérios (a árvore dos pastores).
SELECT pg_temp.run('tree',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Só igreja', ARRAY['view_all_church', 'view_dashboard']) WHERE id = %L$s$, pg_temp.m(15)),
  ARRAY[
    pg_temp.pv(15, 'SELECT string_agg(member_name, '','' ORDER BY member_name) FROM public.ministry_tree_nodes() WHERE member_id::text LIKE ''c2020000%'''),
    pg_temp.pv(15, 'SELECT members_total::text FROM public.dashboard_summary()')
  ]);
SELECT is(v[1], 'PastorComLider,Samuel', 'RN-22: com Toda a Igreja e sem Seu Ministério, a árvore de Ministérios abre nos pastores (Samuel e Magda, e o pastor com líder da massa)') FROM sb WHERE k = 'tree';
SELECT is(v[2], (SELECT count(*)::text FROM public.members WHERE deleted_at IS NULL), 'RN-22: e o dashboard conta a igreja toda') FROM sb WHERE k = 'tree';

-- Dashboard de uma função só com "Visualizar Dashboard" e sem permissão de escopo: os números vêm do que a pessoa vê (só ela).
SELECT pg_temp.run('dash',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Só dashboard', ARRAY['view_dashboard']) WHERE id = %L$s$, pg_temp.m(15)),
  ARRAY[pg_temp.pv(15, 'SELECT members_total::text FROM public.dashboard_summary()'),
        pg_temp.pv(15, 'SELECT sum(total)::text FROM public.dashboard_cells_by_type()')]);
SELECT is(v[1], '1', 'RN-22/DSH-01: só Visualizar Dashboard: os números vêm do que a pessoa vê (ela mesma)') FROM sb WHERE k = 'dash';
SELECT is(v[2], '1', 'RN-22: e a única célula que ela vê (C2, é timóteo)') FROM sb WHERE k = 'dash';

-- RN-22: Visualizar Auditoria (events) só com a permissão, sem limite de ministério.
SELECT pg_temp.run('audit',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Auditor', ARRAY['view_audit_log', 'view_dashboard']) WHERE id = %L$s$, pg_temp.m(15)),
  ARRAY[pg_temp.pv(15, 'SELECT (count(*) > 0)::text FROM public.events'),
        pg_temp.pv(3, 'SELECT count(*)::text FROM public.events'),
        pg_temp.pv(16, 'SELECT (count(*) > 0)::text FROM public.events'),
        pg_temp.pv(9, 'SELECT count(*)::text FROM public.events')]);
SELECT is(v[1], 'true', 'RN-22: Hugo com Visualizar Auditoria lê events (a igreja toda, sem limite de ministério)') FROM sb WHERE k = 'audit';
SELECT is(v[2], '0', 'RN-22: Pedro (Líder, sem Visualizar Auditoria) não lê events') FROM sb WHERE k = 'audit';
SELECT is(v[3], 'true', 'RN-22: Rita (Administrador) lê events') FROM sb WHERE k = 'audit';
SELECT is(v[4], '0', 'RN-22: Caio não lê events') FROM sb WHERE k = 'audit';

SELECT * FROM finish();
ROLLBACK;
