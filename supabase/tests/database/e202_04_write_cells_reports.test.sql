-- E2.02 (PR 1): escrita de células, relatórios e participantes pela API.
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), critérios
-- "pela API" das RN-09 (participantes), RN-12, RN-13, RN-14 e RN-15, DA-5,
-- "Formato dos erros (AQ-5)" e a leitura técnica do E2.01 que mudou (retirar
-- participante exige Editar Relatórios de Células).
--
-- Cobre, com o código e a mensagem do spec e conferindo que nada foi gravado:
--   - RN-12: editar célula só com Editar Célula e no escopo, as pessoas
--     escolhidas, excluir fora do escopo;
--   - RN-13: lançar relatório (anfitriã, timóteo, quem só vê, sem função,
--     Editar Célula, Enviar de Qualquer Célula Visível, "Editar Próprio
--     Cadastro" que deixou de valer) e as pessoas do relatório;
--   - RN-14: editar e excluir relatório;
--   - RN-09 e DA-5: participantes (aviso member_visible, retirar é livre para
--     quem edita relatórios, incluir só quem vê, participante excluído);
--   - RN-15: excluir célula visível.
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

SELECT plan(77);

-- Pessoas que lançam: relatório da semana atual (a massa tem só os da semana passada).
CREATE FUNCTION pg_temp.ins_report(_cell uuid, _theme text DEFAULT 'tema') RETURNS text LANGUAGE sql AS
$$ SELECT format($i$INSERT INTO public.cell_reports (cell_id, date, time, was_held, theme) VALUES (%L, public.sp_today(), '23:59', true, %L)$i$, _cell, _theme) $$;

-- ===========================================================================
-- 1. RN-12: células.
-- ===========================================================================
SELECT pg_temp.run('r12',
  '',
  ARRAY[
    /* 1 */ pg_temp.pr(9, format('UPDATE public.cells SET meeting_time = ''21:00'' WHERE id = %L', pg_temp.c(1))),
    /* 2 */ pg_temp.pr(7, format('UPDATE public.cells SET meeting_time = ''21:00'' WHERE id = %L', pg_temp.c(1))),
    /* 3 */ pg_temp.pr(7, format('UPDATE public.cells SET meeting_time = ''21:00'' WHERE id = %L', pg_temp.c(3))),
    /* 4 */ pg_temp.pr(3, format('UPDATE public.cells SET meeting_time = ''21:00'' WHERE id = %L', pg_temp.c(3))),
    /* 5 */ pg_temp.pr(3, format('UPDATE public.cells SET meeting_time = ''21:00'' WHERE id = %L', pg_temp.c(1))),
    /* 6 */ pg_temp.pc(3, format($i$INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (%L, %L, %L, 'Evangelística', 'Sexta', '20:00')$i$, pg_temp.m(7), pg_temp.m(9), pg_temp.m(8))),
    /* 7 */ pg_temp.pm(3, format($i$INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (%L, %L, %L, 'Evangelística', 'Sexta', '20:00')$i$, pg_temp.m(7), pg_temp.m(9), pg_temp.m(8))),
    /* 8 */ pg_temp.pc(3, format($i$INSERT INTO public.cells (leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (%L, %L, %L, 'Evangelística', 'Sexta', '20:00')$i$, pg_temp.m(7), pg_temp.m(9), pg_temp.m(12))),
    /* 9 */ pg_temp.pc(3, format('UPDATE public.cells SET host_id = %L WHERE id = %L', pg_temp.m(16), pg_temp.c(2))),
    /* 10 */ format('SELECT host_id::text FROM public.cells WHERE id = %L', pg_temp.c(2)),
    /* 11 */ pg_temp.pc(14, format('SELECT public.delete_cell(%L)', pg_temp.c(1))),
    /* 12 */ pg_temp.pm(14, format('SELECT public.delete_cell(%L)', pg_temp.c(1))),
    /* 13 */ format('SELECT (deleted_at IS NULL)::text FROM public.cells WHERE id = %L', pg_temp.c(1)),
    /* 14 */ pg_temp.pc(7, format('SELECT public.delete_cell(%L)', pg_temp.c(3))),
    /* 15 */ format('SELECT (deleted_at IS NOT NULL)::text FROM public.cells WHERE id = %L', pg_temp.c(3)),
    /* 16 */ pg_temp.pc(9, format('SELECT public.delete_cell(%L)', pg_temp.c(1))),
    /* 17 */ pg_temp.pc(16, format('UPDATE public.cells SET leader_id = %L WHERE id = %L', pg_temp.m(8), pg_temp.c(1)))
  ]);
SELECT is(v[1], '0', 'RN-12: Caio, timóteo de C1 com Editar Próprio Cadastro e sem Editar Célula, muda o horário: nada muda (0 linhas)') FROM sb WHERE k = 'r12';
SELECT is(v[2], '1', 'RN-12: André edita C1: aceito') FROM sb WHERE k = 'r12';
SELECT is(v[3], '1', 'RN-12: André edita C3: aceito') FROM sb WHERE k = 'r12';
SELECT is(v[4], '0', 'RN-12: Pedro edita C3 pela API: nada muda (0 linhas)') FROM sb WHERE k = 'r12';
SELECT is(v[5], '1', 'RN-12: Pedro edita C1, que ele vê: aceito') FROM sb WHERE k = 'r12';
SELECT is(v[6], 'person_not_visible', 'RN-12: Pedro cadastra célula com André, Caio e Beatriz (anfitriã que ele não vê): person_not_visible') FROM sb WHERE k = 'r12';
SELECT is(v[7], 'Você só pode escolher pessoas que você vê.', 'RN-12: com a mensagem do spec') FROM sb WHERE k = 'r12';
SELECT is(v[8], '00000', 'RN-12: com Carla como anfitriã, o cadastro é aceito') FROM sb WHERE k = 'r12';
SELECT is(v[9], 'person_not_visible', 'RN-12: Pedro troca o anfitrião de C2 de Caio para Rita (que ele não vê): person_not_visible') FROM sb WHERE k = 'r12';
SELECT is(v[10], pg_temp.m(9)::text, 'RN-12: e Caio continua anfitrião') FROM sb WHERE k = 'r12';
SELECT is(v[11], 'not_found_or_deleted', 'RN-12: Diego, com Excluir Célula, exclui C1 (fora do escopo dele): recusado') FROM sb WHERE k = 'r12';
SELECT is(v[12], 'Esta célula não existe ou já foi excluída.', 'RN-12: com a mensagem do E2.01') FROM sb WHERE k = 'r12';
SELECT is(v[13], 'true', 'RN-12: e C1 continua') FROM sb WHERE k = 'r12';
SELECT is(v[14], '00000', 'RN-15: André, com Excluir Célula, exclui C3, que vê pela cônjuge: aceito') FROM sb WHERE k = 'r12';
SELECT is(v[15], 'true', 'RN-15: e C3 fica excluída') FROM sb WHERE k = 'r12';
SELECT is(v[16], '42501', 'RN-12: Caio (Membro) exclui C1: erro de permissão (42501)') FROM sb WHERE k = 'r12';
SELECT is(v[17], '00000', 'RN-09: Rita escolhe qualquer pessoa como líder de C1') FROM sb WHERE k = 'r12';

-- ===========================================================================
-- 2. RN-13: lançar o relatório.
-- ===========================================================================
SELECT pg_temp.run('r13',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(12, pg_temp.ins_report(pg_temp.c(1))),
    /* 2 */ pg_temp.pc(9, pg_temp.ins_report(pg_temp.c(2))),
    /* 3 */ pg_temp.pc(3, pg_temp.ins_report(pg_temp.c(3))),
    /* 4 */ pg_temp.pm(3, pg_temp.ins_report(pg_temp.c(3))),
    /* 5 */ pg_temp.pc(15, pg_temp.ins_report(pg_temp.c(2))),
    /* 6 */ pg_temp.pc(19, pg_temp.ins_report(pg_temp.c(2))),
    /* 7 */ 'SELECT count(*)::text FROM public.cell_reports WHERE theme = ''tema''',
    /* 8 */ pg_temp.pc(16, pg_temp.ins_report(pg_temp.c(3), 'rita'))
  ]);
SELECT is(v[1], '00000', 'RN-13: Carla, anfitriã de C1 com a função Membro, lança o relatório: aceito') FROM sb WHERE k = 'r13';
SELECT is(v[2], '00000', 'RN-13: Caio lança o de C2 (como anfitrião): aceito') FROM sb WHERE k = 'r13';
SELECT is(v[3], 'not_found_or_deleted', 'RN-13: Pedro lança o de C3 pela API: recusado') FROM sb WHERE k = 'r13';
SELECT is(v[4], 'Esta célula não existe ou já foi excluída.', 'RN-13: com a mensagem do E2.01 (C3 é invisível para Pedro)') FROM sb WHERE k = 'r13';
SELECT is(v[5], '42501', 'RN-13: Hugo, timóteo de C2 e sem função: erro de permissão (42501)') FROM sb WHERE k = 'r13';
SELECT is(v[6], '42501', 'RN-07: a conta X não lança nada (42501)') FROM sb WHERE k = 'r13';
SELECT is(v[7], '2', 'RN-13: só os dois lançamentos aceitos (Carla e Caio) gravaram') FROM sb WHERE k = 'r13';
SELECT is(v[8], '00000', 'RN-13: Rita lança em qualquer célula') FROM sb WHERE k = 'r13';
SELECT pg_temp.run('r13e',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(10, pg_temp.ins_report(pg_temp.c(1))),
    /* 2 */ pg_temp.pm(10, pg_temp.ins_report(pg_temp.c(1))),
    /* 3 */ pg_temp.pc(9, pg_temp.ins_report(pg_temp.c(1)))
  ]);
SELECT is(v[1], 'report_submit_not_allowed', 'RN-13: Fábio, Membro, vê C1 mas não é líder, timóteo nem anfitrião: report_submit_not_allowed') FROM sb WHERE k = 'r13e';
SELECT is(v[2], 'Você não pode enviar o relatório desta célula.', 'RN-13: com a mensagem do spec') FROM sb WHERE k = 'r13e';
SELECT is(v[3], '00000', 'RN-13: Caio lança o de C1 (como timóteo): aceito') FROM sb WHERE k = 'r13e';
SELECT pg_temp.run('r13f', '', ARRAY[pg_temp.pc(3, pg_temp.ins_report(pg_temp.c(2), 'pedro'))]);
SELECT is(v[1], '00000', 'RN-13: Pedro, com Editar Célula, lança o relatório de C2, que ele vê: aceito') FROM sb WHERE k = 'r13f';

-- Funções sem Editar Célula: Enviar de Qualquer Célula Visível (Gabriel) e só Editar Próprio Cadastro (Caio).
SELECT pg_temp.run('r13b',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Envia visível', ARRAY['view_own_ministry', 'submit_any_visible_report']) WHERE id = %L;
            UPDATE public.members SET role_id = pg_temp.mkrole('T Só edita', ARRAY['edit_own_data']) WHERE id = %L$s$, pg_temp.m(11), pg_temp.m(9)),
  ARRAY[
    /* 1 */ pg_temp.pc(11, pg_temp.ins_report(pg_temp.c(1))),
    /* 2 */ pg_temp.pc(11, pg_temp.ins_report(pg_temp.c(2))),
    /* 3 */ pg_temp.pc(11, pg_temp.ins_report(pg_temp.c(3))),
    /* 4 */ pg_temp.pc(9, pg_temp.ins_report(pg_temp.c(1)))
  ]);
SELECT is(v[1], '00000', 'RN-13: Gabriel (Enviar de Qualquer Célula Visível, sem Editar Célula) lança C1') FROM sb WHERE k = 'r13b';
SELECT is(v[2], '00000', 'RN-13: e C2') FROM sb WHERE k = 'r13b';
SELECT is(v[3], 'not_found_or_deleted', 'RN-13: mas não C3, que ele não vê') FROM sb WHERE k = 'r13b';
SELECT is(v[4], '42501', 'RN-13: Caio, só com Editar Próprio Cadastro, não lança o de C1 (a permissão deixou de valer): 42501') FROM sb WHERE k = 'r13b';

-- Pedro e André, ambos com Editar Célula: lançam C1 com Débora como participante.
SELECT pg_temp.run('r13c',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(3, pg_temp.ins_report(pg_temp.c(1), 'pedro-c1')),
    /* 2 */ pg_temp.pc(3, format($p$SELECT public.set_cell_report_participants((SELECT id FROM public.cell_reports WHERE theme = 'pedro-c1'), ARRAY[%L]::uuid[])$p$, pg_temp.m(13))),
    /* 3 */ pg_temp.pm(3, format($p$SELECT public.set_cell_report_participants((SELECT id FROM public.cell_reports WHERE theme = 'pedro-c1'), ARRAY[%L]::uuid[])$p$, pg_temp.m(13))),
    /* 4 */ 'SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = (SELECT id FROM public.cell_reports WHERE theme = ''pedro-c1'')'
  ]);
SELECT is(v[1], '00000', 'RN-13: Pedro lança o relatório de C1') FROM sb WHERE k = 'r13c';
SELECT is(v[2], 'person_not_visible', 'RN-13: com Débora como participante, o de Pedro é recusado') FROM sb WHERE k = 'r13c';
SELECT is(v[3], 'Você só pode escolher pessoas que você vê.', 'RN-13: com a mensagem do spec') FROM sb WHERE k = 'r13c';
SELECT is(v[4], '0', 'RN-13: e Débora não entra no relatório') FROM sb WHERE k = 'r13c';
SELECT pg_temp.run('r13d',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(7, pg_temp.ins_report(pg_temp.c(1), 'andre-c1')),
    /* 2 */ pg_temp.pc(7, format($p$SELECT public.set_cell_report_participants((SELECT id FROM public.cell_reports WHERE theme = 'andre-c1'), ARRAY[%L]::uuid[])$p$, pg_temp.m(13))),
    /* 3 */ 'SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = (SELECT id FROM public.cell_reports WHERE theme = ''andre-c1'')'
  ]);
SELECT is(v[2], '00000', 'RN-13: o de André, com Débora (vista pela cônjuge), é aceito') FROM sb WHERE k = 'r13d';
SELECT is(v[3], '1', 'RN-13: e Débora entra no relatório') FROM sb WHERE k = 'r13d';

-- ===========================================================================
-- 3. RN-14: editar e excluir relatórios.
-- ===========================================================================
SELECT pg_temp.run('r14',
  '',
  ARRAY[
    /* 1 */ pg_temp.pr(3, format('UPDATE public.cell_reports SET theme = ''novo'' WHERE id = %L', pg_temp.r(2))),
    /* 2 */ pg_temp.pr(3, format('UPDATE public.cell_reports SET theme = ''novo'' WHERE id = %L', pg_temp.r(3))),
    /* 3 */ pg_temp.pr(9, format('UPDATE public.cell_reports SET theme = ''novo'' WHERE id = %L', pg_temp.r(1))),
    /* 4 */ pg_temp.pc(9, format('SELECT public.delete_cell_report(%L)', pg_temp.r(1))),
    /* 5 */ format('SELECT (deleted_at IS NULL)::text FROM public.cell_reports WHERE id = %L', pg_temp.r(1)),
    /* 6 */ pg_temp.pc(14, format('SELECT public.delete_cell_report(%L)', pg_temp.r(1))),
    /* 7 */ pg_temp.pm(14, format('SELECT public.delete_cell_report(%L)', pg_temp.r(1))),
    /* 8 */ pg_temp.pc(3, format('SELECT public.delete_cell_report(%L)', pg_temp.r(1))),
    /* 9 */ pg_temp.pc(16, format('SELECT public.delete_cell_report(%L)', pg_temp.r(3))),
    /* 10 */ pg_temp.pc(3, format('UPDATE public.cell_reports SET cell_id = %L WHERE id = %L', pg_temp.c(3), pg_temp.r(2)))
  ]);
SELECT is(v[1], '1', 'RN-14: Pedro (Editar Relatórios de Células) edita R2: aceito') FROM sb WHERE k = 'r14';
SELECT is(v[2], '0', 'RN-14: Pedro edita R3 pela API: nada muda (0 linhas)') FROM sb WHERE k = 'r14';
SELECT is(v[3], '0', 'RN-14: Caio, Membro, que lançou R1: não edita (0 linhas)') FROM sb WHERE k = 'r14';
SELECT is(v[4], '42501', 'RN-14: Caio não exclui R1 (42501)') FROM sb WHERE k = 'r14';
SELECT is(v[5], 'true', 'RN-14: e R1 continua') FROM sb WHERE k = 'r14';
SELECT is(v[6], 'not_found_or_deleted', 'RN-14: Diego, com Excluir Relatórios de Células, exclui R1 (fora do escopo): recusado') FROM sb WHERE k = 'r14';
SELECT is(v[7], 'Este relatório não existe ou já foi excluído.', 'RN-14: com a mensagem do E2.01') FROM sb WHERE k = 'r14';
SELECT is(v[8], '00000', 'RN-14: Pedro exclui R1, que ele vê: aceito (Excluir Relatórios de Células no escopo)') FROM sb WHERE k = 'r14';
SELECT is(v[9], '00000', 'RN-14: Rita exclui qualquer relatório') FROM sb WHERE k = 'r14';
SELECT isnt(v[10], '00000', 'RN-09: Pedro move R2 para C3, que ele não vê: recusado (' || coalesce((SELECT v[10] FROM sb WHERE k = 'r14'), '?') || ')') FROM sb WHERE k = 'r14';

-- ===========================================================================
-- 4. Participantes: aviso (member_visible), retirar, incluir e o excluído (RN-09, DA-5).
-- ===========================================================================
SELECT is(pg_temp.val(3, format($q$SELECT string_agg(member_name || '=' || member_visible, ',' ORDER BY member_name) FROM public.cell_report_participants_view WHERE report_id = %L$q$, pg_temp.r(2))),
  'Diego=false,Hugo=false', 'RN-09: o aviso da edição de R2 para Pedro: Diego e Hugo não são visíveis (member_visible = false)');
SELECT is(pg_temp.val(14, format($q$SELECT string_agg(member_name || '=' || member_visible, ',' ORDER BY member_name) FROM public.cell_report_participants_view WHERE report_id = %L$q$, pg_temp.r(2))),
  'Diego=true,Hugo=true', 'RN-09: Diego vê os dois participantes de R2');
SELECT is(pg_temp.val(3, format($q$SELECT string_agg(member_name || '=' || member_visible, ',' ORDER BY member_name) FROM public.cell_report_participants_view WHERE report_id = %L$q$, pg_temp.r(1))),
  'Caio=true', 'RN-09: em R1, Caio é visível para Pedro');

SELECT pg_temp.run('part',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(2), pg_temp.m(14))),
    /* 2 */ format($q$SELECT string_agg(m.name, ',' ORDER BY m.name) FROM public.cell_report_participants p JOIN public.members m ON m.id = p.member_id WHERE p.report_id = %L$q$, pg_temp.r(2)),
    /* 3 */ pg_temp.pc(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])', pg_temp.r(2), pg_temp.m(14), pg_temp.m(15))),
    /* 4 */ pg_temp.pm(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])', pg_temp.r(2), pg_temp.m(14), pg_temp.m(15))),
    /* 5 */ format($q$SELECT string_agg(m.name, ',' ORDER BY m.name) FROM public.cell_report_participants p JOIN public.members m ON m.id = p.member_id WHERE p.report_id = %L$q$, pg_temp.r(2)),
    /* 6 */ pg_temp.pc(14, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L]::uuid[])', pg_temp.r(2), pg_temp.m(14), pg_temp.m(15))),
    /* 7 */ format($q$SELECT string_agg(m.name, ',' ORDER BY m.name) FROM public.cell_report_participants p JOIN public.members m ON m.id = p.member_id WHERE p.report_id = %L$q$, pg_temp.r(2)),
    /* 8 */ pg_temp.pc(16, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L, %L, %L]::uuid[])', pg_temp.r(2), pg_temp.m(14), pg_temp.m(15), pg_temp.m(1)))
  ]);
SELECT is(v[1], '00000', 'RN-09: Pedro retira Hugo de R2 (retirar não é escolher): aceito') FROM sb WHERE k = 'part';
SELECT is(v[2], 'Diego', 'RN-09: e só Hugo sai') FROM sb WHERE k = 'part';
SELECT is(v[3], 'person_not_visible', 'RN-09: Pedro tenta incluir Hugo de novo pela API: recusado') FROM sb WHERE k = 'part';
SELECT is(v[4], 'Você só pode escolher pessoas que você vê.', 'RN-09: com a mensagem do spec') FROM sb WHERE k = 'part';
SELECT is(v[5], 'Diego', 'RN-09: e Hugo continua fora') FROM sb WHERE k = 'part';
SELECT is(v[6], '00000', 'RN-09: Diego, que vê Hugo, o inclui de novo em R2') FROM sb WHERE k = 'part';
SELECT is(v[7], 'Diego,Hugo', 'RN-09: e Hugo volta ao relatório') FROM sb WHERE k = 'part';
SELECT is(v[8], '00000', 'RN-09: Rita escolhe qualquer pessoa (inclui Samuel)') FROM sb WHERE k = 'part';

-- Gabriel excluído e participante de R1: ninguém o retira (RN-13 do E2.01).
SELECT pg_temp.run('gabdel',
  format($s$SET LOCAL session_replication_role = replica;
            INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (%L, %L);
            SET LOCAL session_replication_role = origin;
            UPDATE public.members SET deleted_at = now() WHERE id = %L$s$, pg_temp.r(1), pg_temp.m(11), pg_temp.m(11)),
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(1), pg_temp.m(9))),
    /* 2 */ pg_temp.pm(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(1), pg_temp.m(9))),
    /* 3 */ pg_temp.pc(16, format('SELECT public.set_cell_report_participants(%L, ARRAY[%L]::uuid[])', pg_temp.r(1), pg_temp.m(9))),
    /* 4 */ format('SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L', pg_temp.r(1), pg_temp.m(11)),
    /* 5 */ pg_temp.pc(3, format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L', pg_temp.r(1), pg_temp.m(11))),
    /* 6 */ pg_temp.pc(16, format('DELETE FROM public.cell_report_participants WHERE report_id = %L AND member_id = %L', pg_temp.r(1), pg_temp.m(11)))
  ]);
SELECT is(v[1], 'deleted_participant_removal', 'RN-09: Pedro tenta retirar Gabriel, excluído e invisível, de R1: recusado') FROM sb WHERE k = 'gabdel';
SELECT is(v[2], 'Não é possível retirar um participante cujo cadastro foi excluído.', 'RN-09: com a mensagem do E2.01') FROM sb WHERE k = 'gabdel';
SELECT is(v[3], 'deleted_participant_removal', 'RN-09: Rita também é recusada') FROM sb WHERE k = 'gabdel';
SELECT is(v[4], '1', 'RN-09: e Gabriel continua em R1') FROM sb WHERE k = 'gabdel';
SELECT is(v[5], 'deleted_participant_removal', 'RN-09: o DELETE direto de Pedro também é recusado') FROM sb WHERE k = 'gabdel';
SELECT is(v[6], 'deleted_participant_removal', 'RN-09: e o de Rita') FROM sb WHERE k = 'gabdel';

-- DA-5: quem só envia relatório (sem Editar Relatórios de Células).
SELECT pg_temp.run('da5',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(12, pg_temp.ins_report(pg_temp.c(1), 'carla')),
    /* 2 */ pg_temp.pc(12, format($p$SELECT public.set_cell_report_participants((SELECT id FROM public.cell_reports WHERE theme = 'carla'), ARRAY[%L, %L]::uuid[])$p$, pg_temp.m(12), pg_temp.m(9))),
    /* 3 */ 'SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = (SELECT id FROM public.cell_reports WHERE theme = ''carla'')',
    /* 4 */ pg_temp.pc(12, format($p$SELECT public.set_cell_report_participants((SELECT id FROM public.cell_reports WHERE theme = 'carla'), ARRAY[%L]::uuid[])$p$, pg_temp.m(12))),
    /* 5 */ pg_temp.pc(12, format($p$INSERT INTO public.cell_report_participants (report_id, member_id) VALUES (%L, %L)$p$, pg_temp.r(1), pg_temp.m(12))),
    /* 6 */ pg_temp.pc(12, format('SELECT public.set_cell_report_participants(%L, ARRAY[]::uuid[])', pg_temp.r(1))),
    /* 7 */ pg_temp.pr(12, format('DELETE FROM public.cell_report_participants WHERE report_id = %L', pg_temp.r(1))),
    /* 8 */ 'SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = ' || quote_literal(pg_temp.r(1)),
    /* 9 */ pg_temp.pc(9, format('SELECT public.set_cell_report_participants(%L, ARRAY[]::uuid[])', pg_temp.r(1))),
    /* 10 */ pg_temp.pc(3, format('SELECT public.set_cell_report_participants(%L, ARRAY[]::uuid[])', pg_temp.r(1))),
    /* 11 */ 'SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = ' || quote_literal(pg_temp.r(1))
  ]);
SELECT is(v[1], '00000', 'DA-5: Carla (só envia) lança o relatório da semana atual de C1') FROM sb WHERE k = 'da5';
SELECT is(v[2], '00000', 'DA-5: e inclui participantes que vê nesse relatório') FROM sb WHERE k = 'da5';
SELECT is(v[3], '2', 'DA-5: os dois entram') FROM sb WHERE k = 'da5';
SELECT is(v[4], '42501', 'DA-5: mas retirar um participante exige Editar Relatórios de Células: 42501') FROM sb WHERE k = 'da5';
SELECT is(v[5], '42501', 'DA-5: Carla não inclui participante em relatório de semana passada (R1)') FROM sb WHERE k = 'da5';
SELECT is(v[6], '42501', 'DA-5: nem o retira (RPC)') FROM sb WHERE k = 'da5';
SELECT is(v[7], '0', 'DA-5: nem o DELETE direto retira (0 linhas)') FROM sb WHERE k = 'da5';
SELECT is(v[8], '1', 'DA-5: R1 continua com o participante (Caio)') FROM sb WHERE k = 'da5';
SELECT is(v[9], '42501', 'DA-5: Caio, timóteo de C1 e participante de R1, não retira o próprio nome (42501)') FROM sb WHERE k = 'da5';
SELECT is(v[10], '00000', 'RN-14: Pedro, com Editar Relatórios de Células, retira os participantes de R1') FROM sb WHERE k = 'da5';
SELECT is(v[11], '0', 'RN-14: e R1 fica sem participantes') FROM sb WHERE k = 'da5';

SELECT * FROM finish();
ROLLBACK;
