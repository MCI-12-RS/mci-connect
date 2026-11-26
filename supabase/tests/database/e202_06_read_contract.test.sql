-- E2.02 (PR 1): leituras para a tela (AQ-1, AQ-3, DT-23) sobre o escopo novo:
-- colunas novas das views, raízes da árvore de Ministérios (DA-6) e nomes de
-- referência.
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), "Leituras
-- para a tela (AQ-1, AQ-3) e ajustes de leitura", "Views", DA-6, DT-23, AQ-7.
--
-- Cobre:
--   - cells_view.can_submit_report, is_mine e leader_is_pastor por pessoa;
--   - members_view.spouse_name (nome de referência do cônjuge, DT-23);
--   - ministry_tree_nodes: as raízes de cada pessoa (DA-6) e o estado vazio;
--   - member_names sobre o escopo novo (E1.13);
--   - dashboard_summary de Pedro e de Rita (RN-02, DSH-01).
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

-- E2.04 (DT-23): todo cadastro novo tem um identificador real (RN-08).
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
  $$ SELECT '5192026' || lpad(_n::text, 4, '0') $$;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
 (pg_temp.m(1),'Samuel Massa','M',true,NULL, false,pg_temp.u(1),pg_temp.role('Líder'),true, pg_temp.mob(1)),
 (pg_temp.m(2),'Magda Massa','F',true,NULL, false,pg_temp.u(2),pg_temp.role('Líder'),true, pg_temp.mob(2)),
 (pg_temp.m(3),'Pedro Massa','M',false,pg_temp.m(1), true,pg_temp.u(3),pg_temp.role('Líder'),true, pg_temp.mob(3)),
 (pg_temp.m(4),'Paula Massa','F',false,pg_temp.m(2), true,pg_temp.u(4),pg_temp.role('Líder'),true, pg_temp.mob(4)),
 (pg_temp.m(5),'Tiago Massa','M',false,pg_temp.m(1), true,pg_temp.u(5),NULL,true, pg_temp.mob(5)),
 (pg_temp.m(6),'Tania Massa','F',false,pg_temp.m(2), true,pg_temp.u(6),NULL,true, pg_temp.mob(6)),
 (pg_temp.m(7),'Andre Massa','M',false,pg_temp.m(3), true,pg_temp.u(7),pg_temp.role('Líder'),true, pg_temp.mob(7)),
 (pg_temp.m(8),'Beatriz Massa','F',false,pg_temp.m(6), true,pg_temp.u(8),pg_temp.role('Membro'),true, pg_temp.mob(8)),
 (pg_temp.m(9),'Caio Massa','M',false,pg_temp.m(7), true,pg_temp.u(9),pg_temp.role('Membro'),true, pg_temp.mob(9)),
 (pg_temp.m(10),'Fabio Massa','M',false,pg_temp.m(7), true,pg_temp.u(10),pg_temp.role('Membro'),false, pg_temp.mob(10)),
 (pg_temp.m(11),'Gabriel Massa','M',false,pg_temp.m(10), true,pg_temp.u(11),NULL,true, pg_temp.mob(11)),
 (pg_temp.m(12),'Carla Massa','F',false,pg_temp.m(4), true,pg_temp.u(12),pg_temp.role('Membro'),true, pg_temp.mob(12)),
 (pg_temp.m(13),'Debora Massa','F',false,pg_temp.m(8), true,pg_temp.u(13),NULL,true, pg_temp.mob(13)),
 (pg_temp.m(14),'Diego Massa','M',false,pg_temp.m(5), true,pg_temp.u(14),pg_temp.role('Líder'),true, pg_temp.mob(14)),
 (pg_temp.m(15),'Hugo Massa','M',false,pg_temp.m(5), true,pg_temp.u(15),NULL,true, pg_temp.mob(15)),
 (pg_temp.m(16),'Rita Massa','F',false,pg_temp.m(6), true,pg_temp.u(16),pg_temp.role('Administrador'),true, pg_temp.mob(16)),
 (pg_temp.m(17),'Ester Massa','F',false,NULL, false,pg_temp.u(17),pg_temp.role('Membro'),true, pg_temp.mob(17)),
 (pg_temp.m(18),'Lucia Massa','F',false,pg_temp.m(17), true,pg_temp.u(18),NULL,true, pg_temp.mob(18)),
 (pg_temp.m(20),'D3t Massa','F',false,pg_temp.m(13), true,NULL,NULL,true, pg_temp.mob(20)),
 (pg_temp.m(21),'D3h Massa','F',false,pg_temp.m(13), true,NULL,NULL,true, pg_temp.mob(21));
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
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, spouse_id, auth_user_id, role_id, is_active, has_leadership) VALUES
 (pg_temp.m(30),'Ciclo1','M',false,pg_temp.m(31),NULL,pg_temp.u(30),pg_temp.role('Membro'),true,true),
 (pg_temp.m(31),'Ciclo2','F',false,pg_temp.m(30),NULL,NULL,NULL,true,true),
 (pg_temp.m(32),'Assim1','M',false,NULL,pg_temp.m(33),pg_temp.u(32),pg_temp.role('Membro'),true,false),
 (pg_temp.m(33),'Assim2','F',false,NULL,NULL,NULL,NULL,true,false),
 (pg_temp.m(35),'Isolado','M',false,NULL,NULL,NULL,NULL,true,false),
-- E2.04 (RN-11): pastor com líder deixou de existir (members_leadership_check vale
-- também em replica). PastorComLider fica pastor sem líder, ao lado de Isolado.
 (pg_temp.m(34),'PastorComLider','M',true,NULL,NULL,pg_temp.u(34),pg_temp.role('Líder'),true,false);
-- Relatórios da semana passada (a semana atual fica livre para os lançamentos).
INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme) VALUES
 (pg_temp.r(1), pg_temp.c(1), public.week_start(public.sp_today()) - 4, '20:00', true, 'R1'),
 (pg_temp.r(2), pg_temp.c(2), public.week_start(public.sp_today()) - 3, '20:00', true, 'R2'),
 (pg_temp.r(3), pg_temp.c(3), public.week_start(public.sp_today()) - 5, '20:00', true, 'R3');
INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
 (pg_temp.r(2), pg_temp.m(14)), (pg_temp.r(2), pg_temp.m(15)), (pg_temp.r(1), pg_temp.m(9));
SET LOCAL session_replication_role = origin;
SELECT private.rebuild_member_hierarchy();


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

SELECT plan(32);

-- ===========================================================================
-- 1. cells_view: can_submit_report, is_mine e leader_is_pastor.
-- ===========================================================================
CREATE FUNCTION pg_temp.cellflags(_n int) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, $q$SELECT string_agg(label || ':' || can_submit_report::text || '/' || is_mine::text, ' ' ORDER BY label)
       FROM (SELECT l.label, v.can_submit_report, v.is_mine FROM public.cells_view v JOIN pg_temp.lbl l ON l.id = v.id) q$q$) $$;
SELECT is(pg_temp.cellflags(12), 'C1:true/true C2:false/false', 'AQ-1: Carla (anfitriã de C1) lança C1 e a célula dela vem como "minha"; C2 ela só vê');
SELECT is(pg_temp.cellflags(9), 'C1:true/true C2:true/true', 'AQ-1: Caio lança C1 (timóteo) e C2 (anfitrião), as duas são dele');
SELECT is(pg_temp.cellflags(3), 'C1:true/false C2:true/false', 'AQ-1: Pedro (Editar Célula) lança as duas que vê, e nenhuma é dele');
SELECT is(pg_temp.cellflags(10), 'C1:false/false C2:false/false', 'AQ-1: Fábio vê C1 e C2 e não lança nenhuma');
SELECT is(pg_temp.cellflags(15), 'C2:false/true', 'AQ-1: Hugo, sem função, vê C2 (é dele) e não lança (RN-07)');
SELECT is(pg_temp.cellflags(7), 'C1:true/true C2:true/false C3:true/false', 'AQ-1: André lança as três (Editar Célula) e C1 é dele');
SELECT is(pg_temp.cellflags(16), 'C1:true/false C2:true/false C3:true/false', 'AQ-1: Rita lança todas e nenhuma é dela');
SELECT is(pg_temp.val(19, 'SELECT count(*)::text FROM public.cells_view'), '0', 'AQ-1: a conta X não vê célula');
SELECT pg_temp.run('lp',
  format('INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (%L, %L, %L, %L, ''Evangelística'', ''Sábado'', ''18:00'')', pg_temp.c(9), pg_temp.m(1), pg_temp.m(1), pg_temp.m(1)),
  ARRAY[pg_temp.pv(16, format($q$SELECT leader_is_pastor::text FROM public.cells_view WHERE id = %L$q$, pg_temp.c(9))),
        pg_temp.pv(16, format($q$SELECT leader_is_pastor::text FROM public.cells_view WHERE id = %L$q$, pg_temp.c(1)))]);
SELECT is(v[1], 'true', 'AQ-1: leader_is_pastor é verdadeiro para a célula de Samuel (pastor)') FROM sb WHERE k = 'lp';
SELECT is(v[2], 'false', 'AQ-1: e falso para a de André') FROM sb WHERE k = 'lp';

-- ===========================================================================
-- 2. members_view.spouse_name (DT-23).
-- ===========================================================================
SELECT is(pg_temp.val(3, format($q$SELECT spouse_name FROM public.members_view WHERE id = %L$q$, pg_temp.m(3))), 'Paula Massa', 'DT-23: Pedro vê o nome da cônjuge no próprio cadastro');
SELECT is(pg_temp.val(3, format($q$SELECT spouse_name FROM public.members_view WHERE id = %L$q$, pg_temp.m(7))), 'Beatriz Massa', 'DT-23: Pedro vê André e o nome de referência da cônjuge dele (Beatriz), que ele não vê');
SELECT is(pg_temp.val(3, format($q$SELECT count(*)::text FROM public.members WHERE id = %L$q$, pg_temp.m(8))), '0', 'DT-23: mas não lê o cadastro de Beatriz');
SELECT is(pg_temp.val(3, format($q$SELECT coalesce(spouse_name, 'nenhum') FROM public.members_view WHERE id = %L$q$, pg_temp.m(9))), 'nenhum', 'DT-23: Caio não tem cônjuge: nulo');

-- ===========================================================================
-- 3. ministry_tree_nodes (DA-6): as raízes de cada pessoa.
-- ===========================================================================
CREATE FUNCTION pg_temp.roots(_n int) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.val(_n, $q$SELECT string_agg(member_name || coalesce('+' || spouse_name, ''), ' | ' ORDER BY member_name)
       FROM public.ministry_tree_nodes() WHERE member_id::text LIKE 'c2020000%'$q$) $$;
SELECT is(pg_temp.roots(3), 'Pedro Massa+Paula Massa', 'DA-6: Pedro abre a árvore no casal G12 dele');
SELECT is(pg_temp.roots(9), 'Pedro Massa+Paula Massa', 'DA-6: Caio abre no casal G12 do ministério dele');
SELECT is(pg_temp.roots(7), 'Pedro Massa+Paula Massa', 'DA-6: André também');
SELECT is(pg_temp.roots(8), 'Tiago Massa+Tania Massa', 'DA-6: Beatriz abre no casal G12 dela (Tiago e Tânia)');
SELECT is(pg_temp.roots(1), 'Samuel Massa+Magda Massa', 'DA-6: Samuel, pastor e sem G12, abre no próprio casal');
SELECT is(pg_temp.roots(17), 'Ester Massa', 'DA-6: Ester, sem liderança, abre no próprio cadastro');
SELECT is(pg_temp.roots(15), NULL, 'DA-6: Hugo, sem permissão de escopo, não recebe raiz (estado vazio)');
SELECT is(pg_temp.val(19, 'SELECT count(*)::text FROM public.ministry_tree_nodes()'), '0', 'DA-6: a conta X não recebe raiz');
SELECT is(pg_temp.roots(16), 'PastorComLider | Samuel Massa+Magda Massa', 'DA-6: Rita (Toda a Igreja) abre nos pastores');
SELECT is(pg_temp.val(3, format($q$SELECT count(*)::text FROM public.ministry_tree_nodes(ARRAY[%L, %L]::uuid[])$q$, pg_temp.m(3), pg_temp.m(4))), '2', 'DA-6: abrir o casal G12 devolve os discípulos diretos do casal (André e Carla)');
SELECT is(pg_temp.val(3, format($q$SELECT count(*)::text FROM public.ministry_tree_nodes(ARRAY[%L]::uuid[])$q$, pg_temp.m(5))), '0', 'RN-05: Pedro abre Tiago, que não vê: nada');

-- ===========================================================================
-- 4. member_names (E1.13 sobre o escopo novo).
-- ===========================================================================
SELECT is(pg_temp.val(3, format($q$SELECT string_agg(name, ',' ORDER BY name) FROM public.member_names(ARRAY[%L, %L, %L, %L]::uuid[])$q$, pg_temp.m(1), pg_temp.m(14), pg_temp.m(8), pg_temp.m(4))), 'Paula Massa,Samuel Massa',
  'RN-02: Pedro recebe o nome de Samuel (líder dele) e de Paula (visível), e nenhum de Diego nem de Beatriz');
SELECT is(pg_temp.val(9, format($q$SELECT count(*)::text FROM public.member_names(ARRAY[%L, %L]::uuid[])$q$, pg_temp.m(16), pg_temp.m(14))), '0', 'RN-23: Caio não recebe o nome de Rita nem de Diego');
SELECT is(pg_temp.val(19, format($q$SELECT count(*)::text FROM public.member_names(ARRAY[%L]::uuid[])$q$, pg_temp.m(3))), '0', 'RN-07: a conta X não recebe nome nenhum');

-- ===========================================================================
-- 5. Dashboard (RN-02, RN-22): números do que a pessoa vê.
-- ===========================================================================
SELECT is(pg_temp.val(3, 'SELECT members_total::text FROM public.dashboard_summary()'), '7', 'RN-02: Pedro, 7 membros');
SELECT is(pg_temp.val(16, 'SELECT members_total::text FROM public.dashboard_summary()'), (SELECT count(*)::text FROM public.members WHERE deleted_at IS NULL),
  'RN-02: Rita conta a igreja toda');
SELECT is(pg_temp.val(9, 'SELECT members_total::text FROM public.dashboard_summary()'), '7', 'RN-02: Caio (Membro, com Visualizar Dashboard) conta o mesmo escopo que Pedro');
SELECT is(pg_temp.val(3, 'SELECT cells_pending::text FROM public.dashboard_summary()') IS NOT NULL, true, 'RN-02: Pedro recebe as células pendentes');

SELECT * FROM finish();
ROLLBACK;
