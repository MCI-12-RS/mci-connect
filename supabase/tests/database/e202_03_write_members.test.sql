-- E2.02 (PR 1): escrita de membros pela API (triggers de escopo e de função).
-- Spec: docs/specs/e2-02-perfis-escopo.md (repositório apps-mci), critérios
-- "pela API" das RN-09, RN-10, RN-11, RN-18, RN-19 e RN-21, DA-2, DA-3, DA-7,
-- DA-10, DA-11, "Formato dos erros (AQ-5)".
--
-- Cobre, com o código e a mensagem do spec e conferindo que nada foi gravado:
--   - RN-09: editar fora do escopo (0 linhas), escolher pessoa que não vê
--     (person_not_visible), tirar o cônjuge que deixaria de ver
--     (would_leave_scope), o caso de André e Beatriz (zz_ depois do cônjuge);
--   - o ensaio check_member_insert (mesmas recusas do INSERT, nada gravado,
--     nenhum evento de auditoria);
--   - RN-10: cadastrar com líder visível, pastor e sem liderança só para quem
--     vê a igreja toda, Samuel e Magda, Diego e Ester, DA-2, DA-11;
--   - RN-11: o próprio cadastro (own_data_only, com os campos);
--   - RN-18: quem atribui funções (own_role, role_change_not_allowed,
--     role_not_assignable);
--   - RN-19: a função padrão no cadastro (default_role_not_covered);
--   - RN-21: o último administrador (last_admin);
--   - DA-7: restaurar membro cujo líder foi excluído.
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
  $$ SELECT '5192023' || lpad(_n::text, 4, '0') $$;
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
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, spouse_id, auth_user_id, role_id, is_active, has_leadership, g12_level) VALUES
 (pg_temp.m(30),'Ciclo1','M',false,pg_temp.m(31),NULL,pg_temp.u(30),pg_temp.role('Membro'),true,true,1),
 (pg_temp.m(31),'Ciclo2','F',false,pg_temp.m(30),NULL,NULL,NULL,true,true,1),
 (pg_temp.m(32),'Assim1','M',false,NULL,pg_temp.m(33),pg_temp.u(32),pg_temp.role('Membro'),true,false,0),
 (pg_temp.m(33),'Assim2','F',false,NULL,NULL,NULL,NULL,true,false,0),
 (pg_temp.m(35),'Isolado','M',false,NULL,NULL,NULL,NULL,true,false,0),
-- E2.04 (RN-11): pastor com líder deixou de existir (members_leadership_check vale
-- também em replica). PastorComLider fica pastor sem líder, ao lado de Isolado.
 (pg_temp.m(34),'PastorComLider','M',true,NULL,NULL,pg_temp.u(34),pg_temp.role('Líder'),true,false,0);
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

SELECT plan(112);

-- ===========================================================================
-- 1. RN-09: escolher e editar só o que se vê (Pedro, André e Rita).
-- ===========================================================================
SELECT pg_temp.run('r09',
  '',
  ARRAY[
    /* 1 */ pg_temp.pr(3, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(8))),
    /* 2 */ pg_temp.pc(3, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(14), pg_temp.m(9))),
    /* 3 */ pg_temp.pm(3, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(14), pg_temp.m(9))),
    /* 4 */ format('SELECT leader_id::text FROM public.members WHERE id = %L', pg_temp.m(9)),
    /* 5 */ pg_temp.pc(3, format('UPDATE public.members SET spouse_id = %L WHERE id = %L', pg_temp.m(8), pg_temp.m(9))),
    /* 6 */ format('SELECT coalesce(spouse_id::text, ''-'') FROM public.members WHERE id = %L', pg_temp.m(9)),
    /* 7 */ pg_temp.pr(3, format('UPDATE public.cell_reports SET theme = ''R2b'' WHERE id = %L', pg_temp.r(2))),
    /* 8 */ format('SELECT count(*)::text FROM public.cell_report_participants WHERE report_id = %L', pg_temp.r(2)),
    /* 9 */ pg_temp.pc(3, format('UPDATE public.cells SET host_id = NULL WHERE id = %L', pg_temp.c(2))),
    /* 10 */ pg_temp.pm(3, format('UPDATE public.cells SET host_id = NULL WHERE id = %L', pg_temp.c(2))),
    /* 11 */ format('SELECT host_id::text FROM public.cells WHERE id = %L', pg_temp.c(2)),
    /* 12 */ pg_temp.pc(16, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(8))),
    /* 13 */ pg_temp.pc(16, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(14), pg_temp.m(9))),
    /* 14 */ pg_temp.pc(16, format('UPDATE public.members SET spouse_id = %L WHERE id = %L', pg_temp.m(8), pg_temp.m(9)))
  ]);
SELECT is(v[1], '0', 'RN-09: Pedro edita Beatriz pela API: nada muda (0 linhas)') FROM sb WHERE k = 'r09';
SELECT is(v[2], 'person_not_visible', 'RN-09: Pedro põe Diego como líder de Caio: person_not_visible') FROM sb WHERE k = 'r09';
SELECT is(v[3], 'Você só pode escolher pessoas que você vê.', 'RN-09: com a mensagem do spec') FROM sb WHERE k = 'r09';
SELECT is(v[4], pg_temp.m(7)::text, 'RN-09: e Caio continua com André como líder') FROM sb WHERE k = 'r09';
SELECT is(v[5], 'person_not_visible', 'RN-09: Pedro põe Beatriz como cônjuge de Caio: person_not_visible') FROM sb WHERE k = 'r09';
SELECT is(v[6], '-', 'RN-09: e Caio continua sem cônjuge') FROM sb WHERE k = 'r09';
SELECT is(v[7], '1', 'RN-09: Pedro muda só o tema de R2 (participantes fora do escopo): aceito') FROM sb WHERE k = 'r09';
SELECT is(v[8], '2', 'RN-09: e Diego e Hugo continuam no relatório') FROM sb WHERE k = 'r09';
SELECT is(v[9], 'would_leave_scope', 'RN-09: Pedro apaga o anfitrião de C2 sem pôr outro: would_leave_scope') FROM sb WHERE k = 'r09';
SELECT is(v[10], 'Com esta alteração, você deixaria de ver esta célula. Mantenha pelo menos uma pessoa do seu ministério como líder, timóteo ou anfitrião. As alterações não foram salvas.',
  'RN-09: com a mensagem do spec (célula)') FROM sb WHERE k = 'r09';
SELECT is(v[11], pg_temp.m(9)::text, 'RN-09: e Caio continua anfitrião de C2') FROM sb WHERE k = 'r09';
SELECT is(v[12], '00000', 'RN-09: Rita grava em qualquer registro (Beatriz)') FROM sb WHERE k = 'r09';
SELECT is(v[13], '00000', 'RN-09: Rita escolhe qualquer pessoa (Diego líder de Caio)') FROM sb WHERE k = 'r09';
SELECT is(v[14], '00000', 'RN-09: e Beatriz como cônjuge de Caio') FROM sb WHERE k = 'r09';

-- André tira o cônjuge de Beatriz (que vê só por ser cônjuge dele): would_leave_scope, os dois continuam casados.
SELECT pg_temp.run('andre',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(7, format('UPDATE public.members SET spouse_id = NULL WHERE id = %L', pg_temp.m(8))),
    /* 2 */ pg_temp.pm(7, format('UPDATE public.members SET spouse_id = NULL WHERE id = %L', pg_temp.m(8))),
    /* 3 */ format('SELECT (SELECT spouse_id FROM public.members WHERE id = %L)::text || ''|'' || (SELECT spouse_id FROM public.members WHERE id = %L)::text', pg_temp.m(8), pg_temp.m(7)),
    -- André tira o cônjuge do próprio cadastro: aceito (retirar não é escolher); a simetria desfaz o outro lado (DA-4).
    /* 4 */ pg_temp.pc(7, format('UPDATE public.members SET spouse_id = NULL WHERE id = %L', pg_temp.m(7))),
    /* 5 */ format('SELECT coalesce((SELECT spouse_id FROM public.members WHERE id = %L)::text, ''-'') || ''|'' || coalesce((SELECT spouse_id FROM public.members WHERE id = %L)::text, ''-'')', pg_temp.m(8), pg_temp.m(7))
  ]);
SELECT is(v[1], 'would_leave_scope', 'RN-09 (c): André tira o cônjuge no cadastro de Beatriz: would_leave_scope') FROM sb WHERE k = 'andre';
SELECT is(v[2], 'Com esta alteração, você deixaria de ver este cadastro. As alterações não foram salvas.', 'RN-09 (c): com a mensagem do spec (cadastro)') FROM sb WHERE k = 'andre';
SELECT is(v[3], pg_temp.m(7)::text || '|' || pg_temp.m(8)::text, 'RN-09 (c): os dois continuam casados') FROM sb WHERE k = 'andre';
SELECT is(v[4], '00000', 'DA-4: André tira o cônjuge do próprio cadastro: aceito (zz_ roda depois do trigger de cônjuge e André continua se vendo)') FROM sb WHERE k = 'andre';
SELECT is(v[5], '-|-', 'DA-4: e o vínculo do outro lado é desfeito (simetria)') FROM sb WHERE k = 'andre';

-- ===========================================================================
-- 2. O ensaio check_member_insert: as mesmas recusas do INSERT, nada gravado e
--    nenhum evento de auditoria.
-- ===========================================================================
SELECT pg_temp.run('ensaio',
  format('CREATE TEMP TABLE e0 AS SELECT (SELECT count(*) FROM public.events) AS ev, (SELECT count(*) FROM public.members) AS mb; GRANT ALL ON e0 TO authenticated;'),
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239901', 'leader_id', pg_temp.m(14), 'has_leadership', true))),
    /* 2 */ pg_temp.pm(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239902', 'leader_id', pg_temp.m(14), 'has_leadership', true))),
    /* 3 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239903', 'leader_id', pg_temp.m(7)))),
    /* 4 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239904', 'has_leadership', false))),
    /* 5 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239905', 'leader_id', pg_temp.m(7), 'is_pastor', true))),
    /* 6 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239906', 'leader_id', pg_temp.m(7), 'role_id', pg_temp.role('Administrador')))),
    /* 7 */ pg_temp.pc(9, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239907', 'leader_id', pg_temp.m(9)))),
    /* 8 */ pg_temp.pc(16, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239908', 'has_leadership', false))),
    /* 9 */ pg_temp.pc(19, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239909', 'has_leadership', false))),
    /* 10 */ pg_temp.pc(NULL, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239910', 'has_leadership', false))),
    /* 11 */ 'SELECT ((SELECT count(*) FROM public.events) = (SELECT ev FROM e0) AND (SELECT count(*) FROM public.members) = (SELECT mb FROM e0))::text',
    /* 12 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239911', 'leader_id', 'abc')))
  ]);
SELECT is(v[1], 'person_not_visible', 'RN-09: o ensaio de Pedro com Diego como líder recusa (person_not_visible), como o INSERT') FROM sb WHERE k = 'ensaio';
SELECT is(v[2], 'Você só pode escolher pessoas que você vê.', 'RN-09: com a mensagem do spec') FROM sb WHERE k = 'ensaio';
SELECT is(v[3], '00000', 'RN-10: o ensaio de Pedro com André como líder (e a função padrão) passa') FROM sb WHERE k = 'ensaio';
SELECT is(v[4], 'pastor_or_no_leadership_requires_church', 'RN-10: o ensaio de Pedro sem líder recusa') FROM sb WHERE k = 'ensaio';
SELECT is(v[5], 'pastor_or_no_leadership_requires_church', 'RN-05: o ensaio de Pedro marcando pastor recusa') FROM sb WHERE k = 'ensaio';
SELECT is(v[6], 'role_not_assignable', 'RN-18: o ensaio de Pedro com a função Administrador recusa (quem não atribui só cadastra com a padrão: role_not_assignable)') FROM sb WHERE k = 'ensaio';
SELECT is(v[7], '42501', 'RN-10: o ensaio de Caio (Membro) dá erro de permissão (42501)') FROM sb WHERE k = 'ensaio';
SELECT is(v[8], '00000', 'RN-10: o ensaio de Rita cadastrando sem liderança passa') FROM sb WHERE k = 'ensaio';
SELECT is(v[9], '42501', 'RN-07: o ensaio da conta X dá 42501') FROM sb WHERE k = 'ensaio';
SELECT is(v[10], '42501', 'o ensaio sem sessão dá 42501') FROM sb WHERE k = 'ensaio';
SELECT is(v[11], 'true', 'o ensaio não deixa linha em members nem evento em events') FROM sb WHERE k = 'ensaio';
SELECT is(v[12], '22P02', 'o ensaio com uuid inválido dá o mesmo erro de tipo do INSERT (22P02)') FROM sb WHERE k = 'ensaio';

-- O INSERT real, para a comparação: as mesmas recusas, nada gravado.
SELECT pg_temp.run('insert',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(3, format($i$INSERT INTO public.members (name, gender, mobile_whatsapp, leader_id) VALUES ('Igor Novo', 'M', '51920239915', %L)$i$, pg_temp.m(14))),
    /* 2 */ pg_temp.pc(3, format($i$INSERT INTO public.members (name, gender, mobile_whatsapp, leader_id) VALUES ('Igor Novo', 'M', '51920239916', %L)$i$, pg_temp.m(7))),
    /* 3 */ 'SELECT name || ''|'' || coalesce((SELECT name FROM public.roles WHERE id = role_id), ''-'') || ''|'' || has_leadership::text FROM public.members WHERE name = ''Igor Novo''',
    /* 4 */ format($p$SELECT pg_temp.lab(pg_temp.ids(3, 'SELECT id FROM public.members_view WHERE name = ''Igor Novo'''))$p$) || '',
    /* 5 */ pg_temp.pr(3, $i$SELECT 1 FROM public.members_view WHERE name = 'Igor Novo'$i$),
    /* 6 */ pg_temp.pc(3, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, has_leadership) VALUES ('Igor2 Novo', 'M', '51920239917', false)$i$),
    /* 7 */ pg_temp.pc(9, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, has_leadership) VALUES ('Igor3 Novo', 'M', '51920239918', false)$i$),
    /* 8 */ pg_temp.pc(16, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, has_leadership) VALUES ('Igor4 Novo', 'M', '51920239919', false)$i$),
    /* 9 */ 'SELECT count(*)::text FROM public.members WHERE name LIKE ''Igor%'''
  ]);
SELECT is(v[1], 'person_not_visible', 'RN-09: o INSERT de Pedro com Diego como líder recusa (person_not_visible)') FROM sb WHERE k = 'insert';
SELECT is(v[2], '00000', 'RN-10: Pedro cadastra Igor com André como líder: aceito') FROM sb WHERE k = 'insert';
SELECT is(v[3], 'Igor Novo|Membro|true', 'RN-19 e DA-11: Igor fica com a função Membro (padrão) e Tem Liderança ligado') FROM sb WHERE k = 'insert';
SELECT is(v[5], '1', 'RN-10: Igor aparece em Membros para Pedro') FROM sb WHERE k = 'insert';
SELECT is(v[6], 'pastor_or_no_leadership_requires_church', 'RN-10: o INSERT de Pedro sem líder recusa') FROM sb WHERE k = 'insert';
SELECT is(v[7], '42501', 'RN-10: o INSERT de Caio (Membro) dá 42501') FROM sb WHERE k = 'insert';
SELECT is(v[8], '00000', 'RN-10: Rita cadastra sem liderança: aceito') FROM sb WHERE k = 'insert';
SELECT is(v[9], '2', 'só o cadastro de Pedro com André e o de Rita foram gravados') FROM sb WHERE k = 'insert';

-- ===========================================================================
-- 3. RN-05 e RN-10: pastor e sem liderança só para quem vê a igreja toda.
-- ===========================================================================
SELECT pg_temp.run('pastor',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('UPDATE public.members SET is_pastor = true WHERE id = %L', pg_temp.m(7))),
    /* 2 */ pg_temp.pm(3, format('UPDATE public.members SET is_pastor = true WHERE id = %L', pg_temp.m(7))),
    /* 3 */ pg_temp.pc(1, format('UPDATE public.members SET is_pastor = true WHERE id = %L', pg_temp.m(7))),
    /* 4 */ format('SELECT is_pastor::text FROM public.members WHERE id = %L', pg_temp.m(7)),
    -- E2.04 (RN-11): pastor não tem líder; quem marca tira o líder na mesma gravação.
    /* 5 */ pg_temp.pc(16, format('UPDATE public.members SET is_pastor = true, leader_id = NULL WHERE id = %L', pg_temp.m(7))),
    /* 6 */ format('SELECT is_pastor::text FROM public.members WHERE id = %L', pg_temp.m(7)),
    -- Samuel muda a data de nascimento de Magda: aceito, e ela continua pastora; desmarcar é recusado.
    /* 7 */ pg_temp.pc(1, format('UPDATE public.members SET birth_date = ''1970-01-01'' WHERE id = %L', pg_temp.m(2))),
    /* 8 */ format('SELECT is_pastor::text FROM public.members WHERE id = %L', pg_temp.m(2)),
    /* 9 */ pg_temp.pc(1, format('UPDATE public.members SET is_pastor = false WHERE id = %L', pg_temp.m(2))),
    /* 10 */ pg_temp.pm(1, format('UPDATE public.members SET is_pastor = false WHERE id = %L', pg_temp.m(2))),
    /* 11 */ format('SELECT is_pastor::text FROM public.members WHERE id = %L', pg_temp.m(2)),
    -- DA-2: quem vê só o ministério não troca nem preenche o líder de um pastor.
    /* 12 */ pg_temp.pc(1, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(3), pg_temp.m(2))),
    /* 13 */ format('SELECT coalesce(leader_id::text, ''-'') FROM public.members WHERE id = %L', pg_temp.m(2)),
    -- RN-10: tirar o líder de Hugo (DA-1: Caio está fora do escopo de Diego; usa-se Hugo), e cadastrar sem líder.
    -- E2.04 (RN-12): tirar o líder exige desligar "Tem Liderança?" na mesma gravação (senão, leader_required).
    /* 14 */ pg_temp.pc(14, format('UPDATE public.members SET leader_id = NULL, has_leadership = false WHERE id = %L', pg_temp.m(15))),
    /* 15 */ pg_temp.pm(14, format('UPDATE public.members SET leader_id = NULL, has_leadership = false WHERE id = %L', pg_temp.m(15))),
    /* 16 */ format('SELECT leader_id::text FROM public.members WHERE id = %L', pg_temp.m(15)),
    /* 17 */ pg_temp.pc(14, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, has_leadership) VALUES ('Igor Novo', 'M', '51920239920', false)$i$),
    /* 18 */ pg_temp.pc(14, format('UPDATE public.members SET has_leadership = false WHERE id = %L', pg_temp.m(15))),
    /* 19 */ format('SELECT has_leadership::text FROM public.members WHERE id = %L', pg_temp.m(15))
  ]);
SELECT is(v[1], 'pastor_or_no_leadership_requires_church', 'RN-05: Pedro tenta marcar André como pastor: recusado') FROM sb WHERE k = 'pastor';
SELECT is(v[2], 'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.', 'RN-05: com a mensagem do spec') FROM sb WHERE k = 'pastor';
SELECT is(v[3], 'pastor_or_no_leadership_requires_church', 'RN-05: Samuel (pastor, Líder) também é recusado') FROM sb WHERE k = 'pastor';
SELECT is(v[4], 'false', 'RN-05: e André não vira pastor') FROM sb WHERE k = 'pastor';
SELECT is(v[5], '00000', 'RN-05: Rita faz o mesmo e a marcação é aceita') FROM sb WHERE k = 'pastor';
SELECT is(v[6], 'true', 'RN-05: André passa a pastor') FROM sb WHERE k = 'pastor';
SELECT is(v[7], '00000', 'RN-10: Samuel muda a data de nascimento de Magda (pastora): aceito') FROM sb WHERE k = 'pastor';
SELECT is(v[8], 'true', 'RN-10: e Magda continua pastora') FROM sb WHERE k = 'pastor';
SELECT is(v[9], 'pastor_or_no_leadership_requires_church', 'RN-10: Samuel tenta desmarcar Magda como pastora: recusado') FROM sb WHERE k = 'pastor';
SELECT is(v[10], 'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.', 'RN-10: com a mensagem do spec') FROM sb WHERE k = 'pastor';
SELECT is(v[11], 'true', 'RN-10: Magda continua pastora') FROM sb WHERE k = 'pastor';
SELECT is(v[12], 'pastor_or_no_leadership_requires_church', 'DA-2: Samuel (vê só o ministério) não preenche o líder de Magda, pastora') FROM sb WHERE k = 'pastor';
SELECT is(v[13], '-', 'DA-2: e Magda continua sem líder') FROM sb WHERE k = 'pastor';
SELECT is(v[14], 'pastor_or_no_leadership_requires_church', 'RN-10: Diego tira o líder de Hugo: recusado') FROM sb WHERE k = 'pastor';
SELECT is(v[15], 'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.', 'RN-10: com a mensagem do spec') FROM sb WHERE k = 'pastor';
SELECT is(v[16], pg_temp.m(5)::text, 'RN-10: e Hugo continua com Tiago como líder') FROM sb WHERE k = 'pastor';
SELECT is(v[17], 'pastor_or_no_leadership_requires_church', 'RN-10: Diego cadastra Igor sem líder: recusado') FROM sb WHERE k = 'pastor';
SELECT is(v[18], '00000', 'DA-11: Diego desliga Tem Liderança de Hugo, que tem líder: o banco religa, nada muda') FROM sb WHERE k = 'pastor';
SELECT is(v[19], 'true', 'RN-10: e Hugo continua com liderança (DA-11)') FROM sb WHERE k = 'pastor';

-- RN-10: Rita registra o casamento de Ester com Diego; Diego a vê pela RN-06, muda as observações e escolhe Rita como líder.
SELECT pg_temp.run('ester',
  format('UPDATE public.members SET spouse_id = %L WHERE id = %L', pg_temp.m(14), pg_temp.m(17)),
  ARRAY[
    /* 1 */ pg_temp.lab_probe(14),
    /* 2 */ pg_temp.pc(14, format('UPDATE public.members SET notes = ''obs'' WHERE id = %L', pg_temp.m(17))),
    /* 3 */ format('SELECT (notes = ''obs'' AND leader_id IS NULL AND NOT is_pastor)::text FROM public.members WHERE id = %L', pg_temp.m(17)),
    /* 4 */ pg_temp.pc(14, format('UPDATE public.members SET leader_id = %L WHERE id = %L', pg_temp.m(16), pg_temp.m(17))),
    /* 5 */ format('SELECT (leader_id = %L AND has_leadership)::text FROM public.members WHERE id = %L', pg_temp.m(16), pg_temp.m(17))
  ]);
SELECT is(v[1], 'Tiago,Tania,Beatriz,Debora,Diego,Hugo,Rita,Ester,Lucia,D3t,D3h', 'RN-06/10: com o casamento, Diego passa a ver Ester e a descendência dela (Lúcia), como o cônjuge') FROM sb WHERE k = 'ester';
SELECT is(v[2], '00000', 'RN-10: Diego muda as observações de Ester: aceito') FROM sb WHERE k = 'ester';
SELECT is(v[3], 'true', 'RN-10: e Ester continua sem liderança') FROM sb WHERE k = 'ester';
SELECT is(v[4], '00000', 'RN-10: Diego escolhe Rita como líder de Ester: aceito') FROM sb WHERE k = 'ester';
SELECT is(v[5], 'true', 'RN-10 e DA-11: Ester deixa de estar sem liderança (o banco liga Tem Liderança)') FROM sb WHERE k = 'ester';

-- RN-10: Caio (Membro) não cadastra; Pedro, com "Excluir Membro", não exclui Débora.
SELECT pg_temp.run('del',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('SELECT public.delete_member(%L)', pg_temp.m(13))),
    /* 2 */ pg_temp.pm(3, format('SELECT public.delete_member(%L)', pg_temp.m(13))),
    /* 3 */ format('SELECT (deleted_at IS NULL)::text FROM public.members WHERE id = %L', pg_temp.m(13)),
    /* 4 */ pg_temp.pc(3, format('SELECT public.check_member_deletion(%L)', pg_temp.m(13)))
  ]);
SELECT is(v[1], 'not_found_or_deleted', 'RN-10: Pedro exclui Débora (fora do escopo): recusado') FROM sb WHERE k = 'del';
SELECT is(v[2], 'Este cadastro não existe ou já foi excluído.', 'RN-10: com a mensagem do E2.01') FROM sb WHERE k = 'del';
SELECT is(v[3], 'true', 'RN-10: e Débora continua') FROM sb WHERE k = 'del';

-- ===========================================================================
-- 4. RN-11: o próprio cadastro (Caio, Membro).
-- ===========================================================================
SELECT pg_temp.run('r11',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(9, format($u$UPDATE public.members SET mobile_whatsapp = '51999990000', street = 'Rua A', instagram = '@caio' WHERE id = %L$u$, pg_temp.m(9))),
    /* 2 */ format('SELECT (mobile_whatsapp = ''51999990000'' AND street = ''Rua A'' AND instagram = ''@caio'')::text FROM public.members WHERE id = %L', pg_temp.m(9)),
    /* 3 */ pg_temp.pc(9, format('UPDATE public.members SET leader_id = %L, is_baptized = true, is_active = false WHERE id = %L', pg_temp.m(3), pg_temp.m(9))),
    /* 4 */ pg_temp.pm(9, format('UPDATE public.members SET leader_id = %L, is_baptized = true, is_active = false WHERE id = %L', pg_temp.m(3), pg_temp.m(9))),
    /* 5 */ pg_temp.pm(9, format('UPDATE public.members SET spouse_id = %L WHERE id = %L', pg_temp.m(12), pg_temp.m(9))),
    /* 6 */ format('SELECT (leader_id = %L AND NOT is_baptized AND is_active AND spouse_id IS NULL)::text FROM public.members WHERE id = %L', pg_temp.m(7), pg_temp.m(9)),
    /* 7 */ pg_temp.pr(9, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(12))),
    /* 8 */ pg_temp.pc(3, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(9)))
  ]);
SELECT is(v[1], '00000', 'RN-11: Caio muda o próprio celular, o endereço e o Instagram: aceito') FROM sb WHERE k = 'r11';
SELECT is(v[2], 'true', 'RN-11: e as alterações gravaram') FROM sb WHERE k = 'r11';
SELECT is(v[3], 'own_data_only', 'RN-11: Caio muda o próprio líder, batismo e situação: own_data_only') FROM sb WHERE k = 'r11';
SELECT ok(v[4] LIKE 'Você só pode alterar os seus dados pessoais. Não é permitido alterar: %' AND v[4] LIKE '%líder%' AND v[4] LIKE '%batismo%' AND v[4] LIKE '%situação%',
  'RN-11: a mensagem do spec lista os campos (líder, batismo e situação): ' || v[4]) FROM sb WHERE k = 'r11';
SELECT ok(v[5] LIKE 'Você só pode alterar os seus dados pessoais. Não é permitido alterar: %cônjuge%', 'RN-11: e o cônjuge: ' || v[5]) FROM sb WHERE k = 'r11';
SELECT is(v[6], 'true', 'RN-11: nada mudou (líder, batismo, situação e cônjuge)') FROM sb WHERE k = 'r11';
SELECT is(v[7], '0', 'RN-11: Caio edita Carla pela API: nada muda (0 linhas)') FROM sb WHERE k = 'r11';
SELECT is(v[8], '00000', 'RN-11: Pedro (Líder, com Editar Membro) edita o cadastro de Caio, que está no escopo dele') FROM sb WHERE k = 'r11';

-- RN-07: Hugo (sem função) e Fábio (inativo).
SELECT pg_temp.run('r07',
  '',
  ARRAY[
    /* 1 */ pg_temp.pr(15, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(15))),
    /* 2 */ pg_temp.pc(15, format('UPDATE public.members SET notes = ''x'' WHERE id = %L', pg_temp.m(15))),
    /* 3 */ pg_temp.pc(10, format($u$UPDATE public.members SET instagram = '@fabio' WHERE id = %L$u$, pg_temp.m(10))),
    /* 4 */ pg_temp.pr(10, format($u$UPDATE public.members SET instagram = '@fabio' WHERE id = %L$u$, pg_temp.m(10)))
  ]);
SELECT is(v[1], '0', 'RN-07: Hugo, sem função, não consegue editar o próprio cadastro (0 linhas)') FROM sb WHERE k = 'r07';
SELECT is(v[3], '00000', 'RN-07: Fábio, inativo, edita os próprios dados pessoais') FROM sb WHERE k = 'r07';
SELECT is(v[4], '1', 'RN-07: e a linha é gravada') FROM sb WHERE k = 'r07';

-- ===========================================================================
-- 5. RN-18: quem atribui funções.
-- ===========================================================================
SELECT pg_temp.run('r18',
  '',
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(9))),
    /* 2 */ pg_temp.pm(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(9))),
    /* 3 */ format('SELECT (SELECT name FROM public.roles WHERE id = role_id) FROM public.members WHERE id = %L', pg_temp.m(9)),
    /* 4 */ pg_temp.pc(9, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239912', 'leader_id', pg_temp.m(9)))),
    /* 5 */ pg_temp.pc(16, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(16))),
    /* 6 */ pg_temp.pm(16, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(16))),
    /* 7 */ pg_temp.pc(16, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(9))),
    /* 8 */ format('SELECT (SELECT name FROM public.roles WHERE id = role_id) FROM public.members WHERE id = %L', pg_temp.m(9)),
    -- RN-08: depois que Rita dá Líder a Caio, a ação seguinte dele já cadastra, sem sair e entrar.
    /* 9 */ pg_temp.pc(9, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239913', 'leader_id', pg_temp.m(9))))
  ]);
SELECT is(v[1], 'role_change_not_allowed', 'RN-18: Pedro (Líder) troca a função de Caio: role_change_not_allowed') FROM sb WHERE k = 'r18';
SELECT is(v[2], 'Você não tem permissão para alterar a função deste membro.', 'RN-18: com a mensagem do spec') FROM sb WHERE k = 'r18';
SELECT is(v[3], 'Membro', 'RN-18: e Caio continua Membro') FROM sb WHERE k = 'r18';
SELECT is(v[4], '42501', 'RN-08: antes, Caio (Membro) não cadastra (42501)') FROM sb WHERE k = 'r18';
SELECT is(v[5], 'own_role', 'RN-18: Rita tenta mudar a própria função: own_role') FROM sb WHERE k = 'r18';
SELECT is(v[6], 'Ninguém pode alterar a própria função.', 'RN-18: com a mensagem do spec') FROM sb WHERE k = 'r18';
SELECT is(v[7], '00000', 'RN-18: Rita dá a função Líder a Caio: aceito') FROM sb WHERE k = 'r18';
SELECT is(v[8], 'Líder', 'RN-18: e a função gravou') FROM sb WHERE k = 'r18';
SELECT is(v[9], '00000', 'RN-08: a ação seguinte de Caio, já Líder, cadastra membros sem sair e entrar') FROM sb WHERE k = 'r18';

-- Quem atribui funções, mas não cobre a Administrador, na posição de Pedro.
SELECT pg_temp.run('r18b',
  format('UPDATE public.members SET role_id = pg_temp.mkrole(%L, ARRAY[''assign_role'', ''view_own_ministry'', ''view_dashboard'', ''edit_member'', ''edit_own_data'', ''submit_own_cell_report'']) WHERE id = %L', 'T Atribui parcial', pg_temp.m(3)),
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Administrador'), pg_temp.m(9))),
    /* 2 */ pg_temp.pm(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Administrador'), pg_temp.m(9))),
    /* 3 */ pg_temp.pr(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Membro'), pg_temp.m(8))),
    /* 4 */ pg_temp.pc(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(9))),
    /* 5 */ pg_temp.pc(3, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Membro'), pg_temp.m(9)))
  ]);
SELECT is(v[1], 'role_not_assignable', 'RN-18: quem atribui sem cobrir a Administrador recebe role_not_assignable') FROM sb WHERE k = 'r18b';
SELECT is(v[2], 'Você não tem permissão para atribuir esta função.', 'RN-18: com a mensagem do spec') FROM sb WHERE k = 'r18b';
SELECT is(v[3], '0', 'RN-18: a troca da função de Beatriz (fora do escopo) não muda nada (0 linhas)') FROM sb WHERE k = 'r18b';
SELECT is(v[4], 'role_not_assignable', 'RN-18: nem a função Líder, que ele não cobre') FROM sb WHERE k = 'r18b';
SELECT is(v[5], '00000', 'RN-18: mas atribui a Membro, que cobre') FROM sb WHERE k = 'r18b';

-- ===========================================================================
-- 6. RN-19: função padrão no cadastro (DA-10).
-- ===========================================================================
SELECT pg_temp.run('r19',
  format('SELECT pg_temp.mkrole(%L, ARRAY[''view_all_church'', ''view_dashboard'']); UPDATE public.roles SET is_default = false WHERE is_default; UPDATE public.roles SET is_default = true WHERE name = %L; SET CONSTRAINTS ALL IMMEDIATE;', 'Secretaria', 'Secretaria'),
  ARRAY[
    /* 1 */ pg_temp.pc(3, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, leader_id) VALUES ('Igor Novo', 'M', '51920239921', '$i$ || pg_temp.m(7) || $i$')$i$),
    /* 2 */ pg_temp.pm(3, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, leader_id) VALUES ('Igor Novo', 'M', '51920239922', '$i$ || pg_temp.m(7) || $i$')$i$),
    /* 3 */ 'SELECT count(*)::text FROM public.members WHERE name = ''Igor Novo''',
    /* 4 */ pg_temp.pc(3, format('SELECT public.check_member_insert(%L::jsonb)', jsonb_build_object('name', 'Igor Novo', 'gender', 'M', 'mobile_whatsapp', '51920239914', 'leader_id', pg_temp.m(7)))),
    /* 5 */ pg_temp.pc(16, $i$INSERT INTO public.members (name, gender, mobile_whatsapp, leader_id) VALUES ('Igor Novo', 'M', '51920239923', '$i$ || pg_temp.m(7) || $i$')$i$),
    /* 6 */ 'SELECT (SELECT name FROM public.roles WHERE id = role_id) FROM public.members WHERE name = ''Igor Novo'''
  ]);
SELECT is(v[1], 'default_role_not_covered', 'RN-19: com a Secretaria (Toda a Igreja) como padrão, Pedro cadastra Igor: default_role_not_covered') FROM sb WHERE k = 'r19';
SELECT is(v[2], 'A função padrão tem permissões que você não tem. Peça a um administrador para fazer este cadastro.', 'RN-19: com a mensagem do spec') FROM sb WHERE k = 'r19';
SELECT is(v[3], '0', 'RN-19: e nada é gravado') FROM sb WHERE k = 'r19';
SELECT is(v[4], 'default_role_not_covered', 'RN-19: o ensaio recusa do mesmo jeito') FROM sb WHERE k = 'r19';
SELECT is(v[5], '00000', 'RN-19: Rita (cobre a padrão) cadastra') FROM sb WHERE k = 'r19';
SELECT is(v[6], 'NULL', 'DA-10: Rita atribui funções e cadastra sem escolher: Igor fica sem função') FROM sb WHERE k = 'r19';

-- ===========================================================================
-- 7. RN-21: sempre há um administrador (DA-8).
-- ===========================================================================
SELECT pg_temp.run('r21',
  'UPDATE public.members SET role_id = NULL WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND id NOT IN (''' || pg_temp.m(16) || '''); ' || format('UPDATE public.members SET role_id = pg_temp.mkrole(%L, ARRAY(SELECT p::text FROM unnest(public.active_permissions()) p)) WHERE id = %L', 'T Todas as permissões', pg_temp.m(15)),
  ARRAY[
    /* 1 */ pg_temp.pc(16, format('UPDATE public.members SET role_id = NULL WHERE id = %L', pg_temp.m(16))),
    /* 2 */ pg_temp.pc(16, format('SELECT public.delete_member(%L)', pg_temp.m(16))),
    /* 3 */ pg_temp.pc(16, format('SELECT public.delete_role(%L)', pg_temp.role('Administrador'))),
    /* 4 */ format('SELECT count(*)::text FROM public.members WHERE role_id = %L AND deleted_at IS NULL', pg_temp.role('Administrador')),
    -- Hugo tem todas as permissões ativas (cobre a Administrador), mas não é administrador: tirar a função da única administradora.
    /* 5 */ pg_temp.pc(15, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(16))),
    /* 6 */ pg_temp.pm(15, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(16))),
    /* 7 */ format('SELECT count(*)::text FROM public.members WHERE role_id = %L AND deleted_at IS NULL', pg_temp.role('Administrador'))
  ]);
SELECT is(v[1], 'own_role', 'RN-21: Rita, a única administradora, tira a própria função: recusado') FROM sb WHERE k = 'r21';
SELECT is(v[2], 'self_delete', 'RN-21: Rita exclui o próprio cadastro: recusado (self_delete)') FROM sb WHERE k = 'r21';
SELECT is(v[3], 'admin_role_protected', 'RN-21: Rita exclui a função Administrador: recusado') FROM sb WHERE k = 'r21';
SELECT is(v[4], '1', 'RN-21: Rita continua administradora') FROM sb WHERE k = 'r21';
SELECT is(v[5], 'last_admin', 'DA-8: quem cobre a Administrador (todas as permissões) tira a função da última administradora: last_admin') FROM sb WHERE k = 'r21';
SELECT is(v[6], 'Não é possível tirar a função Administrador do último administrador.', 'DA-8: com a mensagem técnica do spec') FROM sb WHERE k = 'r21';
SELECT is(v[7], '1', 'RN-21: e Rita continua administradora') FROM sb WHERE k = 'r21';
-- Rita e Sílvio (Hugo), administradores: Rita dá a Sílvio a função Líder: aceito, e Rita continua administradora.
SELECT pg_temp.run('r21b',
  'UPDATE public.members SET role_id = NULL WHERE role_id = (SELECT id FROM public.roles WHERE is_system) AND id NOT IN (''' || pg_temp.m(16) || '''); ' || format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Administrador'), pg_temp.m(15)),
  ARRAY[
    /* 1 */ pg_temp.pc(16, format('UPDATE public.members SET role_id = %L WHERE id = %L', pg_temp.role('Líder'), pg_temp.m(15))),
    /* 2 */ format('SELECT count(*)::text FROM public.members WHERE role_id = %L AND deleted_at IS NULL', pg_temp.role('Administrador')),
    /* 3 */ format('SELECT (role_id = %L)::text FROM public.members WHERE id = %L', pg_temp.role('Administrador'), pg_temp.m(16))
  ]);
SELECT is(v[1], '00000', 'RN-21: Rita e Sílvio administradores: Rita dá a Sílvio a função Líder: aceito') FROM sb WHERE k = 'r21b';
SELECT is(v[2], '1', 'RN-21: sobra um administrador') FROM sb WHERE k = 'r21b';
SELECT is(v[3], 'true', 'RN-21: e é a Rita') FROM sb WHERE k = 'r21b';

-- ===========================================================================
-- 8. DA-7: restaurar membro cujo líder foi excluído.
-- ===========================================================================
SELECT pg_temp.run('da7',
  format($s$UPDATE public.members SET role_id = pg_temp.mkrole('T Gestor ministério', ARRAY['manage_roles', 'view_own_ministry', 'edit_member', 'delete_member']) WHERE id = %L;
            UPDATE public.members SET deleted_at = now() WHERE id IN (%L, %L)$s$, pg_temp.m(3), pg_temp.m(11), pg_temp.m(10)),
  ARRAY[
    /* 1 */ pg_temp.pc(3, format('SELECT public.restore_member(%L)', pg_temp.m(11))),
    /* 2 */ pg_temp.pm(3, format('SELECT public.restore_member(%L)', pg_temp.m(11))),
    /* 3 */ format('SELECT (deleted_at IS NOT NULL)::text FROM public.members WHERE id = %L', pg_temp.m(11)),
    /* 4 */ pg_temp.pc(16, format('SELECT public.restore_member(%L)', pg_temp.m(11))),
    /* 5 */ format('SELECT (deleted_at IS NULL AND leader_id IS NULL)::text FROM public.members WHERE id = %L', pg_temp.m(11))
  ]);
SELECT is(v[1], 'pastor_or_no_leadership_requires_church', 'DA-7: Pedro (só ministério) restaura Gabriel, cujo líder (Fábio) foi excluído: recusado') FROM sb WHERE k = 'da7';
SELECT is(v[2], 'Só quem vê a igreja toda pode marcar um membro como pastor ou como sem liderança.', 'DA-7: com a mensagem da RN-10') FROM sb WHERE k = 'da7';
SELECT is(v[3], 'true', 'DA-7: e Gabriel continua excluído') FROM sb WHERE k = 'da7';
SELECT is(v[4], '00000', 'DA-7: Rita (vê a igreja toda) restaura') FROM sb WHERE k = 'da7';
SELECT is(v[5], 'true', 'DA-3 do E2.01: e Gabriel volta sem líder') FROM sb WHERE k = 'da7';

SELECT * FROM finish();
ROLLBACK;
