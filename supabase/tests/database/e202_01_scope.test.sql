-- E2.02 (PR 1): escopo de visibilidade de membros, células e relatórios.
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), "Critérios por
-- regra" (RN-01 a RN-08, RN-15), "Predicados canônicos", DT-28, "Verificações
-- obrigatórias (para o QA)".
--
-- Cobre:
--   - a tabela "O que cada um vê", linha a linha, para membros, células e
--     relatórios, na view e na tabela sob o RLS (14 pessoas e a conta X);
--   - casal, Fábio inativo, Gabriel excluído, Caio sem função, Hugo e a conta
--     X, Samuel com "Visualizar Toda a Igreja", Ester e Lúcia;
--   - o dashboard de Pedro (7 membros, 6 ativos, C1 e C2) e o card "Sem
--     liderança" (RN-06);
--   - funções só com view_own_reports e só com view_all_reports (RN-04);
--   - RN-08: o escopo muda na hora (Rita move Caio; "Seu Ministério" retirado);
--   - a equivalência entre a descida e a subida para todo par, com um ciclo de
--     dois membros, um cônjuge assimétrico e um pastor com líder na massa;
--   - DT-28: as duas formas vazias sem permissão de escopo;
--   - paridade por persona: ids da view = ids da tabela sob o RLS = ids da
--     função de linha (membros, células, relatórios e participantes);
--   - as views de excluídos com o mesmo escopo (RN-15) e a DA-4 do E2.01.
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
  $$ SELECT '5192021' || lpad(_n::text, 4, '0') $$;
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

SELECT plan(180);

-- ===========================================================================
-- 1. "O que cada um vê" (RN-01 a RN-06): membros, células e relatórios, na
--    view e na tabela sob o RLS, linha a linha da tabela do spec.
-- ===========================================================================
CREATE TEMP TABLE expect (who text, n int, members text, cells text, reports text);
INSERT INTO expect VALUES
 ('Rita',    16, 'Samuel,Magda,Pedro,Paula,Tiago,Tania,Andre,Beatriz,Caio,Fabio,Gabriel,Carla,Debora,Diego,Hugo,Rita,Ester,Lucia,D3t,D3h', 'C1,C2,C3', 'R1,R2,R3'),
 ('Samuel',   1, 'Samuel,Magda,Pedro,Paula,Tiago,Tania,Andre,Beatriz,Caio,Fabio,Gabriel,Carla,Debora,Diego,Hugo,Rita,D3t,D3h', 'C1,C2,C3', 'R1,R2,R3'),
 ('Magda',    2, 'Samuel,Magda,Pedro,Paula,Tiago,Tania,Andre,Beatriz,Caio,Fabio,Gabriel,Carla,Debora,Diego,Hugo,Rita,D3t,D3h', 'C1,C2,C3', 'R1,R2,R3'),
 ('Pedro',    3, 'Pedro,Paula,Andre,Caio,Fabio,Gabriel,Carla', 'C1,C2', 'R1,R2'),
 ('Paula',    4, 'Pedro,Paula,Andre,Caio,Fabio,Gabriel,Carla', 'C1,C2', 'R1,R2'),
 ('Caio',     9, 'Pedro,Paula,Andre,Caio,Fabio,Gabriel,Carla', 'C1,C2', 'R1,R2'),
 ('Fabio',   10, 'Pedro,Paula,Andre,Caio,Fabio,Gabriel,Carla', 'C1,C2', 'R1,R2'),
 ('Carla',   12, 'Pedro,Paula,Andre,Caio,Fabio,Gabriel,Carla', 'C1,C2', 'R1,R2'),
 ('Andre',    7, 'Pedro,Paula,Andre,Beatriz,Caio,Fabio,Gabriel,Carla,Debora,D3t,D3h', 'C1,C2,C3', 'R1,R2,R3'),
 ('Beatriz',  8, 'Tiago,Tania,Andre,Beatriz,Caio,Fabio,Gabriel,Debora,Diego,Hugo,Rita,D3t,D3h', 'C1,C2,C3', 'R1,R2,R3'),
 ('Diego',   14, 'Tiago,Tania,Beatriz,Debora,Diego,Hugo,Rita,D3t,D3h', 'C2,C3', 'R2,R3'),
 ('Ester',   17, 'Ester,Lucia', '-', '-'),
 ('Hugo',    15, 'Hugo', 'C2', 'R2'),
 ('Conta X', 19, '-', '-', '-');

SELECT is(pg_temp.lab(pg_temp.ids(n, 'SELECT id FROM public.members_view')), members,
  'RN-01/02: ' || who || ' vê na members_view: ' || members) FROM expect ORDER BY n;
SELECT is(pg_temp.lab(pg_temp.ids(n, 'SELECT id FROM public.members')), members,
  'RN-01/02: ' || who || ' vê na tabela members sob o RLS: ' || members) FROM expect ORDER BY n;
SELECT is(pg_temp.lab(pg_temp.ids(n, 'SELECT id FROM public.cells_view')), cells,
  'RN-03: ' || who || ' vê na cells_view: ' || cells) FROM expect ORDER BY n;
SELECT is(pg_temp.lab(pg_temp.ids(n, 'SELECT id FROM public.cells')), cells,
  'RN-03: ' || who || ' vê na tabela cells sob o RLS: ' || cells) FROM expect ORDER BY n;
SELECT is(pg_temp.lab(pg_temp.ids(n, 'SELECT id FROM public.cell_reports_view')), reports,
  'RN-04: ' || who || ' vê na cell_reports_view: ' || reports) FROM expect ORDER BY n;
SELECT is(pg_temp.lab(pg_temp.ids(n, 'SELECT id FROM public.cell_reports')), reports,
  'RN-04: ' || who || ' vê na tabela cell_reports sob o RLS: ' || reports) FROM expect ORDER BY n;

-- RN-01: casal (Pedro e Paula veem o mesmo) e o par Samuel/Magda.
SELECT is(pg_temp.ids(3, 'SELECT id FROM public.members_view ORDER BY id'), pg_temp.ids(4, 'SELECT id FROM public.members_view ORDER BY id'),
  'RN-01: Pedro e Paula, os dois Líder, veem exatamente os mesmos membros');
SELECT is(pg_temp.ids(3, 'SELECT id FROM public.cells_view ORDER BY id'), pg_temp.ids(4, 'SELECT id FROM public.cells_view ORDER BY id'),
  'RN-01: Pedro e Paula veem as mesmas células');
SELECT is(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_view ORDER BY id'), pg_temp.ids(4, 'SELECT id FROM public.cell_reports_view ORDER BY id'),
  'RN-01: Pedro e Paula veem os mesmos relatórios');
-- RN-01: André vê Beatriz e Débora, e não vê Tânia, Tiago, Diego, Hugo nem Rita.
SELECT is(pg_temp.lab(pg_temp.ids(7, $q$SELECT id FROM public.members_view WHERE id IN (SELECT id FROM pg_temp.lbl)
   AND id = ANY (ARRAY[(SELECT id FROM pg_temp.lbl WHERE label='Tania'),(SELECT id FROM pg_temp.lbl WHERE label='Tiago'),
                       (SELECT id FROM pg_temp.lbl WHERE label='Diego'),(SELECT id FROM pg_temp.lbl WHERE label='Hugo'),
                       (SELECT id FROM pg_temp.lbl WHERE label='Rita')])$q$)), '-',
  'RN-01: André não vê Tânia, Tiago, Diego, Hugo nem Rita');
-- RN-01: Beatriz vê a descendência do cônjuge, mas não Pedro, Paula nem Carla.
SELECT is(pg_temp.lab(pg_temp.ids(8, $q$SELECT id FROM public.members_view WHERE id = ANY (ARRAY[(SELECT id FROM pg_temp.lbl WHERE label='Pedro'),(SELECT id FROM pg_temp.lbl WHERE label='Paula'),(SELECT id FROM pg_temp.lbl WHERE label='Carla')])$q$)), '-',
  'RN-01: Beatriz não vê Pedro, Paula nem Carla');
-- RN-02: Pedro nem sequer recebe o cadastro de Beatriz, a célula C3 ou o relatório R3 pelo id.
SELECT is(pg_temp.rows(3, format('SELECT 1 FROM public.members WHERE id = %L', pg_temp.m(8))), '0', 'RN-02: Pedro pede o cadastro de Beatriz pelo id e não recebe nada');
SELECT is(pg_temp.rows(3, format('SELECT 1 FROM public.cells WHERE id = %L', pg_temp.c(3))), '0', 'RN-02: Pedro pede a célula C3 pelo id e não recebe nada');
SELECT is(pg_temp.rows(3, format('SELECT 1 FROM public.cell_reports WHERE id = %L', pg_temp.r(3))), '0', 'RN-02: Pedro pede o relatório R3 pelo id e não recebe nada');
-- RN-02: o líder do próprio cadastro vem só pelo nome (member_names).
SELECT is(pg_temp.val(3, format('SELECT name FROM public.member_names(ARRAY[%L]::uuid[])', pg_temp.m(1))), 'Samuel Massa',
  'RN-02: Pedro vê "Samuel" como líder, só o nome, via member_names');
SELECT is(pg_temp.rows(3, format('SELECT 1 FROM public.members WHERE id = %L', pg_temp.m(1))), '0', 'RN-02: e não tem acesso ao cadastro de Samuel');
-- RN-05: Pedro não vê Samuel e Magda em Membros nem nos seletores (member_names só devolve nomes de quem ele vê ou de líder direto).
SELECT is(pg_temp.lab(pg_temp.ids(3, $q$SELECT id FROM public.members_view WHERE id = ANY (ARRAY[(SELECT id FROM pg_temp.lbl WHERE label='Samuel'),(SELECT id FROM pg_temp.lbl WHERE label='Magda')])$q$)), '-',
  'RN-05: Samuel e Magda não aparecem em Membros para Pedro');

-- RN-02: Caio sem função vê só o próprio cadastro, C1 (timóteo), C2 (anfitrião), R1 e R2.
SELECT pg_temp.give(9, NULL);
SELECT is(pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.members_view')), 'Caio', 'RN-02/07: Caio sem função vê só o próprio cadastro em Membros');
SELECT is(pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.cells_view')), 'C1,C2', 'RN-02: Caio sem função vê C1 (timóteo) e C2 (anfitrião)');
SELECT is(pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.cell_reports_view')), 'R1,R2', 'RN-02: Caio sem função vê R1 e R2 (relatórios das células em que é pessoa)');
SELECT pg_temp.give(9, 'Membro');

-- RN-02 (Gabriel excluído): Pedro deixa de vê-lo e nada mais muda.
INSERT INTO sb VALUES ('gab', pg_temp.sandbox(
  'UPDATE public.members SET deleted_at = now() WHERE id = ''' || pg_temp.m(11) || '''',
  ARRAY[$q$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.members_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cells_view'))$q$]));
SELECT is(v[1], 'Pedro,Paula,Andre,Caio,Fabio,Carla', 'RN-02: com Gabriel excluído, Pedro deixa de vê-lo e o resto do escopo não muda') FROM sb WHERE k = 'gab';
SELECT is(v[2], 'C1,C2', 'RN-02: Gabriel excluído não muda as células de Pedro') FROM sb WHERE k = 'gab';

-- RN-01: Fábio inativo continua no escopo de Pedro (Fábio e Gabriel).
SELECT is(pg_temp.lab(pg_temp.ids(3, $q$SELECT id FROM public.members_view WHERE NOT is_active$q$)), 'Fabio',
  'RN-01: Fábio, inativo, continua visível para Pedro (e Gabriel, abaixo dele, também)');

-- RN-05 / RN-06: Samuel com "Visualizar Toda a Igreja" também vê Ester e Lúcia; Ester só é vista por Rita e por ela mesma.
SELECT pg_temp.mkrole('T Igreja', ARRAY['view_all_church', 'view_own_ministry']);
SELECT pg_temp.give(1, 'T Igreja');
SELECT is(pg_temp.lab(pg_temp.ids(1, 'SELECT id FROM public.members_view')),
  'Samuel,Magda,Pedro,Paula,Tiago,Tania,Andre,Beatriz,Caio,Fabio,Gabriel,Carla,Debora,Diego,Hugo,Rita,Ester,Lucia,D3t,D3h',
  'RN-05: Samuel com Visualizar Toda a Igreja também vê Ester e Lúcia');
SELECT pg_temp.give(1, 'Líder');
SELECT is((SELECT count(*)::int FROM pg_temp.expect WHERE members LIKE '%Ester%' AND who NOT IN ('Rita', 'Ester')), 0,
  'RN-06: só Rita e a própria Ester veem Ester (nenhuma outra linha da tabela a inclui)');
-- RN-06: o card "Sem liderança" conta Ester para Rita e não conta para Samuel.
SELECT is(pg_temp.val(16, 'SELECT members_without_leader::text FROM public.dashboard_summary()'), (SELECT count(*)::text FROM public.members WHERE deleted_at IS NULL AND leader_id IS NULL AND NOT is_pastor),
  'RN-06: o card "Sem liderança" de Rita conta todos os sem-liderança da igreja, Ester entre eles');
SELECT cmp_ok(pg_temp.val(16, 'SELECT members_without_leader::text FROM public.dashboard_summary()')::int, '>',
  pg_temp.val(1, 'SELECT members_without_leader::text FROM public.dashboard_summary()')::int,
  'RN-06: e o de Samuel é menor: não conta Ester');

-- RN-02 (dashboard de Pedro): 7 membros (6 ativos, 1 inativo) e as células C1 e C2.
SELECT is(pg_temp.val(3, 'SELECT members_total::text FROM public.dashboard_summary()'), '7', 'RN-02: Pedro conta 7 membros no dashboard');
SELECT is(pg_temp.val(3, 'SELECT members_inactive::text FROM public.dashboard_summary()'), '1', 'RN-02: 1 inativo (Fábio)');
SELECT is(pg_temp.val(3, 'SELECT members_active::text FROM public.dashboard_summary()'), '6', 'RN-02: 6 ativos');
SELECT is(pg_temp.val(3, 'SELECT sum(total)::text FROM public.dashboard_cells_by_type()'), '2', 'RN-02: as células contam C1 e C2');

-- RN-07: conta X (sem cadastro) e Hugo (sem função).
SELECT is(pg_temp.code(19, 'SELECT * FROM public.dashboard_summary()'), '42501', 'RN-07: a conta X não acessa o dashboard (42501)');
SELECT is(pg_temp.code(15, 'SELECT * FROM public.dashboard_summary()'), '42501', 'RN-07: Hugo, sem função, não acessa o dashboard (42501)');
SELECT is(pg_temp.code(19, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(15))), '00000', 'RN-07: a conta X não altera nada: 0 linhas');
SELECT is(pg_temp.rows(19, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(15))), '0', 'RN-07: a conta X atualiza 0 linhas');
SELECT is(pg_temp.code(19, $q$INSERT INTO public.members (name) VALUES ('Igor')$q$), '42501', 'RN-07: a conta X não cadastra (42501)');
-- Fábio inativo entra e vê o mesmo que Pedro.
SELECT is(pg_temp.ids(10, 'SELECT id FROM public.members_view ORDER BY id'), pg_temp.ids(3, 'SELECT id FROM public.members_view ORDER BY id'), 'RN-07: Fábio, inativo, vê o mesmo que Pedro');

-- RN-04: funções só com permissões de relatório.
-- Gabriel com só "Visualizar Relatórios do Seu Ministério": R1 e R2; Membros e Células, só ele.
SELECT pg_temp.mkrole('T Rel ministério', ARRAY['view_own_reports']);
SELECT pg_temp.give(11, 'T Rel ministério');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cell_reports_view')), 'R1,R2', 'RN-04: só view_own_reports (Gabriel): R1 e R2 em Relatórios (ministério do avô)');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.members_view')), 'Gabriel', 'RN-04: sem permissão de escopo, só o próprio cadastro');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cells_view')), '-', 'RN-04: Células vazias para quem só tem view_own_reports (e não é pessoa de nenhuma)');
-- "Visualizar Relatórios de Toda a Igreja": R1, R2 e R3.
SELECT pg_temp.mkrole('T Rel igreja', ARRAY['view_all_reports']);
SELECT pg_temp.give(11, 'T Rel igreja');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cell_reports_view')), 'R1,R2,R3', 'RN-04: só view_all_reports: R1, R2 e R3');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cell_reports')), 'R1,R2,R3', 'RN-04: idem sob o RLS da tabela');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.members_view')), 'Gabriel', 'RN-04: view_all_reports não abre Membros');
SELECT pg_temp.give(11, NULL);

-- RN-04: R2 lançado quando Caio era anfitrião; depois C2 passa a ter Rita como anfitriã:
-- C2 sai do escopo de Pedro, mas R2 fica, pelo retrato (E2.11, RN-14: Caio está registrado em R2).
INSERT INTO sb VALUES ('host', pg_temp.sandbox(
  'UPDATE public.cells SET host_id = ''' || pg_temp.m(16) || ''' WHERE id = ''' || pg_temp.c(2) || '''',
  ARRAY[$q$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cells_view'))$q$]));
SELECT is(v[1], 'R1,R2', 'RN-04 + RN-14 do E2.11: com Rita anfitriã de C2, R2 continua no escopo de Pedro pelo retrato') FROM sb WHERE k = 'host';
SELECT is(v[2], 'C1', 'RN-04: e C2 também') FROM sb WHERE k = 'host';

-- RN-08: Rita troca o líder de Caio para Diego; a ação seguinte já enxerga o novo escopo, sem sair e entrar.
INSERT INTO sb VALUES ('move', pg_temp.sandbox(
  format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(14), pg_temp.m(9)),
  ARRAY[$q$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.members_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(7, 'SELECT id FROM public.members_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.cells_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(7, 'SELECT id FROM public.cells_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(9, 'SELECT id FROM public.members_view'))$q$]));
SELECT is(v[1], 'Pedro,Paula,Andre,Fabio,Gabriel,Carla', 'RN-08: Caio sai de Membros para Pedro') FROM sb WHERE k = 'move';
SELECT is(v[2], 'Pedro,Paula,Andre,Beatriz,Fabio,Gabriel,Carla,Debora,D3t,D3h', 'RN-08: e para André, que mantém Beatriz e Débora') FROM sb WHERE k = 'move';
SELECT is(v[3], 'C1', 'RN-08: C2 sai de Células de Pedro (nenhuma pessoa de C2 continua no escopo dele); C1 continua') FROM sb WHERE k = 'move';
SELECT is(v[4], 'C1,C3', 'RN-08: C2 sai de Células de André; C1 continua (Carla) e C3 também') FROM sb WHERE k = 'move';
SELECT is(v[5], 'Tiago,Tania,Beatriz,Caio,Debora,Diego,Hugo,Rita,D3t,D3h',
  'RN-08: Caio, sem sair e entrar, passa a ver o ministério de Tiago e Tânia e deixa de ver o de Pedro e Paula') FROM sb WHERE k = 'move';
-- RN-08: Rita retira "Visualizar Seu Ministério" da função Membro: a consulta seguinte de Carla mostra só a RN-02 (d).
INSERT INTO sb VALUES ('noscope', pg_temp.sandbox(
  $q$DELETE FROM public.role_permissions WHERE role_id = pg_temp.role('Membro') AND permission = 'view_own_ministry'$q$,
  ARRAY[$q$SELECT pg_temp.lab(pg_temp.ids(12, 'SELECT id FROM public.members_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(12, 'SELECT id FROM public.cells_view'))$q$,
        $q$SELECT pg_temp.lab(pg_temp.ids(12, 'SELECT id FROM public.cell_reports_view'))$q$]));
SELECT is(v[1], 'Carla', 'RN-08: sem Seu Ministério, Carla vê só o próprio cadastro') FROM sb WHERE k = 'noscope';
SELECT is(v[2], 'C1', 'RN-08: e a célula em que é anfitriã (C1)') FROM sb WHERE k = 'noscope';
SELECT is(v[3], 'R1', 'RN-08: e o relatório dela (R1)') FROM sb WHERE k = 'noscope';

-- ===========================================================================
-- 2. Equivalência descida x subida, para todo par (usuário, membro), com o
--    ciclo, o cônjuge assimétrico e o pastor com líder na massa.
-- ===========================================================================
CREATE FUNCTION pg_temp.scope_mismatches() RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE
  _n int; _x uuid; _down uuid[]; _up boolean; _out text[] := '{}'; _pairs int := 0;
  _all uuid[] := ARRAY(SELECT id FROM public.members WHERE id::text LIKE 'c2020000%');
BEGIN
  FOREACH _n IN ARRAY ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,30,32,34] LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    _down := ARRAY(SELECT public.viewer_ministry_member_ids());
    FOREACH _x IN ARRAY _all LOOP
      _up := public.viewer_scope_contains_any(ARRAY[_x]);
      _pairs := _pairs + 1;
      IF (_x = ANY (_down)) IS DISTINCT FROM _up THEN
        _out := _out || format('usuário %s, membro %s: descida %s, subida %s', _n, _x, _x = ANY (_down), _up);
      END IF;
    END LOOP;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
  END LOOP;
  PERFORM set_config('e202.pairs', _pairs::text, true);
  RETURN _out;
END $$;
SELECT is(pg_temp.scope_mismatches(), '{}'::text[],
  'RN-01: viewer_ministry_member_ids (descida) e viewer_scope_contains_any (subida) concordam em todo par, com ciclo, cônjuge assimétrico e pastor com líder');
SELECT cmp_ok(current_setting('e202.pairs')::int, '>=', 22 * 26, 'a equivalência percorreu todos os pares (22 usuários x 26 membros)');
-- O ciclo termina: Ciclo1 vê os dois do ciclo e só eles.
SELECT is(pg_temp.val(30, 'SELECT count(*)::text FROM public.viewer_ministry_member_ids()'), '2', 'ciclo: Ciclo1 vê Ciclo1 e Ciclo2, e a descida termina');
SELECT is(pg_temp.val(30, format('SELECT public.viewer_scope_contains_any(ARRAY[%L]::uuid[])::text', pg_temp.m(31))), 'true', 'ciclo: a subida também alcança Ciclo2');
-- Cônjuge assimétrico (Assim1 -> Assim2, mas Assim2 não aponta de volta): a descida e a subida concordam (acima) e o escopo inclui o cônjuge apontado.
SELECT is(pg_temp.val(32, format('SELECT public.viewer_scope_contains_any(ARRAY[%L]::uuid[])::text', pg_temp.m(33))), pg_temp.val(32, format('SELECT (%L::uuid IN (SELECT public.viewer_ministry_member_ids()))::text', pg_temp.m(33))),
  'cônjuge assimétrico: descida e subida dão a mesma resposta sobre Assim2');
-- Pastor (PastorComLider; desde o E2.04, sem líder): vê a árvore dele sem erro.
SELECT isnt(pg_temp.val(34, 'SELECT count(*)::text FROM public.viewer_ministry_member_ids()'), NULL, 'pastor isolado (PastorComLider): a descida responde (não quebra)');

-- ===========================================================================
-- 3. DT-28: sem permissão de escopo, as duas formas vêm vazias.
-- ===========================================================================
SELECT is(pg_temp.val(15, 'SELECT count(*)::text FROM public.viewer_ministry_member_ids()'), '0', 'DT-28: Hugo, sem função, a descida volta vazia');
SELECT is(pg_temp.val(15, format('SELECT public.viewer_scope_contains_any(ARRAY[%L]::uuid[])::text', pg_temp.m(15))), 'false', 'DT-28: Hugo, a subida volta falsa, nem para o próprio id');
SELECT is(pg_temp.val(15, 'SELECT cardinality(public.viewer_tree_roots())::text'), '0', 'DT-28: Hugo, viewer_tree_roots volta vazia');
SELECT pg_temp.mkrole('T so edita', ARRAY['edit_own_data', 'view_dashboard']);
SELECT pg_temp.give(15, 'T so edita');
SELECT is(pg_temp.val(15, 'SELECT count(*)::text FROM public.viewer_ministry_member_ids()'), '0', 'DT-28: função sem permissão de escopo, a descida volta vazia');
SELECT is(pg_temp.val(15, format('SELECT public.viewer_scope_contains_any(ARRAY[%L]::uuid[])::text', pg_temp.m(15))), 'false', 'DT-28: função sem permissão de escopo, a subida volta falsa');
SELECT pg_temp.mkrole('T so igreja', ARRAY['view_all_church']);
SELECT pg_temp.give(15, 'T so igreja');
SELECT is(pg_temp.val(15, 'SELECT count(*)::text FROM public.viewer_ministry_member_ids()'), '0', 'DT-28: só Visualizar Toda a Igreja (sem Seu Ministério), a descida volta vazia (a igreja inteira vem das políticas, não do escopo)');
SELECT is(pg_temp.lab(pg_temp.ids(15, 'SELECT id FROM public.members_view')), 'Samuel,Magda,Pedro,Paula,Tiago,Tania,Andre,Beatriz,Caio,Fabio,Gabriel,Carla,Debora,Diego,Hugo,Rita,Ester,Lucia,D3t,D3h', 'RN-05: mas as views dão a igreja toda a quem tem Toda a Igreja');
SELECT pg_temp.give(15, NULL);
SELECT is(pg_temp.val(9, 'SELECT count(*)::text FROM public.viewer_ministry_member_ids()'), '7', 'DT-28: Caio, com Seu Ministério, tem a descida cheia (7 membros)');

-- ===========================================================================
-- 4. Paridade por persona: ids da view = ids da tabela sob o RLS = ids da função
--    de linha (E1.08 e E2.01 atualizados).
-- ===========================================================================
-- Personas extras: só view_own_reports, só view_all_reports, igreja toda e
-- Seu Ministério + sem pessoa nenhuma (Lúcia).
SELECT pg_temp.give(18, 'T Rel ministério');       -- Lúcia: só view_own_reports
SELECT pg_temp.give(11, 'T Rel igreja');           -- Gabriel: só view_all_reports
CREATE FUNCTION pg_temp.parity_mismatches(_n int) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _out text[] := '{}'; _a uuid[]; _b uuid[]; _c uuid[];
BEGIN
  -- membros
  _a := pg_temp.ids(_n, 'SELECT id FROM public.members_view WHERE id::text LIKE ''c2020000%'' ORDER BY id');
  _b := pg_temp.ids(_n, 'SELECT id FROM public.members WHERE id::text LIKE ''c2020000%'' ORDER BY id');
  _c := pg_temp.ids(_n, 'SELECT id FROM pg_temp.universe WHERE kind = ''m'' AND public.viewer_sees_member(id) ORDER BY id');
  IF _a IS DISTINCT FROM _b THEN _out := _out || 'membros: view <> tabela'; END IF;
  IF _a IS DISTINCT FROM _c THEN _out := _out || 'membros: view <> viewer_sees_member'; END IF;
  -- células
  _a := pg_temp.ids(_n, 'SELECT id FROM public.cells_view WHERE id::text LIKE ''d2020000%'' ORDER BY id');
  _b := pg_temp.ids(_n, 'SELECT id FROM public.cells WHERE id::text LIKE ''d2020000%'' ORDER BY id');
  _c := pg_temp.ids(_n, 'SELECT id FROM pg_temp.universe WHERE kind = ''c'' AND public.viewer_sees_cell(id) ORDER BY id');
  IF _a IS DISTINCT FROM _b THEN _out := _out || 'células: view <> tabela'; END IF;
  IF _a IS DISTINCT FROM _c THEN _out := _out || 'células: view <> viewer_sees_cell'; END IF;
  -- E2.08 (DT-07): a coluna can_submit_report é o direito de lançar com a célula ativa.
  _a := pg_temp.ids(_n, 'SELECT id FROM public.cells_view WHERE id::text LIKE ''d2020000%'' AND can_submit_report ORDER BY id');
  _c := pg_temp.ids(_n, $q$SELECT u.id FROM pg_temp.universe u JOIN public.cells c ON c.id = u.id
      WHERE u.kind = 'c' AND public.viewer_sees_cell(u.id) AND c.is_active AND public.can_submit_report(u.id) ORDER BY u.id$q$);
  IF _a IS DISTINCT FROM _c THEN _out := _out || 'células: can_submit_report <> is_active AND can_submit_report(id)'; END IF;
  -- relatórios
  _a := pg_temp.ids(_n, 'SELECT id FROM public.cell_reports_view WHERE id::text LIKE ''e2020000%'' ORDER BY id');
  _b := pg_temp.ids(_n, 'SELECT id FROM public.cell_reports WHERE id::text LIKE ''e2020000%'' ORDER BY id');
  _c := pg_temp.ids(_n, $q$SELECT u.id FROM pg_temp.universe u JOIN public.cell_reports r ON r.id = u.id
      WHERE u.kind = 'r' AND (public.viewer_has('view_all_reports') OR public.viewer_has('view_all_church')
         OR public.viewer_sees_report_people(r.snapshot_leader_id, r.snapshot_timothy_id, r.snapshot_host_id)) ORDER BY u.id$q$);
  IF _a IS DISTINCT FROM _b THEN _out := _out || 'relatórios: view <> tabela'; END IF;
  -- a tabela é lida sob o RLS do próprio usuário: a universe/JOIN acima também; compara com a função de linha.
  IF _a IS DISTINCT FROM _c THEN _out := _out || 'relatórios: view <> função de linha'; END IF;
  -- participantes: a view mostra só os de relatórios visíveis
  _a := pg_temp.ids(_n, 'SELECT report_id FROM public.cell_report_participants_view WHERE report_id::text LIKE ''e2020000%'' ORDER BY report_id, member_id');
  _b := pg_temp.ids(_n, 'SELECT report_id FROM public.cell_report_participants WHERE report_id::text LIKE ''e2020000%'' ORDER BY report_id, member_id');
  IF _a IS DISTINCT FROM _b THEN _out := _out || 'participantes: view <> tabela'; END IF;
  RETURN _out;
END $$;
SELECT is(pg_temp.parity_mismatches(n), '{}'::text[], 'paridade view = tabela = função de linha: usuário ' || n)
  FROM unnest(ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,30,32,34]) n;
-- as duas personas de relatório
SELECT is(pg_temp.lab(pg_temp.ids(18, 'SELECT id FROM public.cell_reports_view')), '-', 'só view_own_reports (Lúcia, ministério de Ester sem células): nenhum relatório');
SELECT is(pg_temp.lab(pg_temp.ids(11, 'SELECT id FROM public.cell_reports_view')), 'R1,R2,R3', 'só view_all_reports (Gabriel): todos os relatórios');
SELECT is(pg_temp.lab(pg_temp.ids(11, $q$SELECT id FROM public.cell_reports_view WHERE cell_id = 'd2020000-0000-0000-0000-000000000001'$q$)), 'R1',
  'view_all_reports vê R1 também pela célula C1');
SELECT pg_temp.give(18, NULL);
SELECT pg_temp.give(11, NULL);

-- Views de excluídos: o mesmo escopo (RN-15). Pedro com Gerenciar Funções + Seu Ministério.
INSERT INTO sb VALUES ('del', pg_temp.sandbox($setup$
  INSERT INTO public.members (id, name, gender, leader_id, deleted_at) VALUES
    (pg_temp.m(40), 'ExcA', 'M', pg_temp.m(7), now()),
    (pg_temp.m(41), 'ExcB', 'M', pg_temp.m(14), now());
  INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, deleted_at) VALUES
    (pg_temp.c(4), pg_temp.m(12), pg_temp.m(12), pg_temp.m(12), 'Evangelística', 'Sexta', '20:00', now()),
    (pg_temp.c(5), pg_temp.m(15), pg_temp.m(15), pg_temp.m(15), 'Evangelística', 'Sexta', '20:00', now());
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.cell_reports (id, cell_id, date, time, was_held, theme, deleted_at) VALUES
    (pg_temp.r(4), pg_temp.c(1), public.week_start(public.sp_today()) - 10, '20:00', true, 'R4', now()),
    (pg_temp.r(5), pg_temp.c(3), public.week_start(public.sp_today()) - 10, '20:00', true, 'R5', now());
  SET LOCAL session_replication_role = origin;
  UPDATE public.members SET role_id = pg_temp.mkrole('T Gestor ministério', ARRAY['manage_roles', 'view_own_ministry']) WHERE id = pg_temp.m(3);
  UPDATE public.members SET deleted_at = now() WHERE id = pg_temp.m(13);
$setup$,
  ARRAY[$q$SELECT (SELECT string_agg(m.name, ',' ORDER BY m.name) FROM unnest(pg_temp.ids(3, 'SELECT id FROM public.members_deleted_view WHERE id::text LIKE ''c2020000%''')) i JOIN public.members m ON m.id = i)$q$,
        $q$SELECT (SELECT count(*) FROM unnest(pg_temp.ids(3, 'SELECT id FROM public.cells_deleted_view WHERE id::text LIKE ''d2020000%'''))  i WHERE i = pg_temp.c(4))::text || '/' || cardinality(pg_temp.ids(3, 'SELECT id FROM public.cells_deleted_view WHERE id::text LIKE ''d2020000%'''))$q$,
        $q$SELECT (SELECT count(*) FROM unnest(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_deleted_view WHERE id::text LIKE ''e2020000%''')) i WHERE i = pg_temp.r(4))::text || '/' || cardinality(pg_temp.ids(3, 'SELECT id FROM public.cell_reports_deleted_view WHERE id::text LIKE ''e2020000%'''))$q$,
        $q$SELECT cardinality(pg_temp.ids(16, 'SELECT id FROM public.members_deleted_view WHERE id::text LIKE ''c2020000%'''))::text$q$,
        $q$SELECT cardinality(pg_temp.ids(16, 'SELECT id FROM public.cells_deleted_view WHERE id::text LIKE ''d2020000%'''))::text$q$,
        $q$SELECT cardinality(pg_temp.ids(16, 'SELECT id FROM public.cell_reports_deleted_view WHERE id::text LIKE ''e2020000%'''))::text$q$,
        $q$SELECT pg_temp.rows(1, 'SELECT * FROM public.members_deleted_view')$q$,
        $q$SELECT pg_temp.rows(1, 'SELECT * FROM public.cell_reports_deleted_view')$q$,
        $q$SELECT pg_temp.code(3, format('SELECT public.restore_member(%L)', pg_temp.m(13)))$q$,
        $q$SELECT pg_temp.msg(3, format('SELECT public.restore_member(%L)', pg_temp.m(13)))$q$]));
SELECT is(v[1], 'ExcA', 'RN-15: Pedro (Gerenciar Funções + Seu Ministério) vê em Excluídos só ExcA, do ministério dele') FROM sb WHERE k = 'del';
SELECT is(v[2], '1/1', 'RN-15: e só a célula excluída de Carla (c4), não a de Hugo') FROM sb WHERE k = 'del';
SELECT is(v[3], '1/1', 'RN-15: e só o relatório excluído de C1 (R4), não o de C3') FROM sb WHERE k = 'del';
SELECT is(v[4], '3', 'RN-15: Rita vê os três membros excluídos (ExcA, ExcB e Débora)') FROM sb WHERE k = 'del';
SELECT is(v[5], '2', 'RN-15: Rita vê as duas células excluídas') FROM sb WHERE k = 'del';
SELECT is(v[6], '2', 'RN-15: Rita vê os dois relatórios excluídos') FROM sb WHERE k = 'del';
SELECT is(v[7], '0', 'RN-15: Samuel (sem Gerenciar Funções) recebe a lista de membros excluídos vazia') FROM sb WHERE k = 'del';
SELECT is(v[8], '0', 'RN-15: e a de relatórios excluídos vazia') FROM sb WHERE k = 'del';
SELECT is(v[9], 'not_found', 'RN-15: Pedro restaura Débora, fora do escopo dele: not_found') FROM sb WHERE k = 'del';
SELECT is(v[10], 'Este cadastro não foi encontrado.', 'RN-15: com a mensagem da DA-4 do E2.01') FROM sb WHERE k = 'del';

SELECT * FROM finish();
ROLLBACK;
