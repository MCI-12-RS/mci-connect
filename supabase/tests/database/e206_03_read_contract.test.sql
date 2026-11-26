-- E2.06 (PR 1): leitura pela tabela de hierarquia: a árvore de Ministérios (RN-09), a members_view
-- (RN-10), a cells_view (RN-11), o que não se grava pela API (RN-12), a paridade de escopo por persona
-- (E1.08 e E2.02) e o que cada tela lê depois da troca de líder (RN-08).
-- Spec: docs/specs/e2-06-hierarquia-totais.md ("Árvore de Ministérios", "Critérios por regra", "Contratos").
-- Massa (dados fictícios): a do Negócio, com 23 pessoas e 11 células. Rita é Administrador (vê tudo);
-- Pedro e Diego são Líder (veem o próprio ministério); Hugo não tem função; André e Beatriz ganham
-- função só dentro de cenários que se desfazem.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(69);

-- ---------------------------------------------------------------------------
-- Massa do spec (Negócio, "Massa de exemplo"): 23 pessoas e 11 células, montadas como postgres
-- com os triggers ligados, na ordem da árvore, com as regras do E2.04 (sexo, identificador real).
-- 1 Samuel, 2 Magda, 3 Pedro, 4 Paula, 5 Tiago, 6 Tânia, 7 André, 8 Beatriz, 9 Caio, 10 Fábio
-- (inativo), 11 Gabriel, 12 Carla, 13 Débora, 14 Rita (Administrador), 15 Diego, 16 Hugo,
-- 17 Lauro, 18 Olga, 19 Sônia, 20 Vânia, 21 Zélia, 22 Ester (sem liderança), 23 Lúcia.
-- Casais: Samuel-Magda, Pedro-Paula, Tiago-Tânia, André-Beatriz, Diego-Olga, Hugo-Vânia.
-- Funções: Rita Administrador; Pedro e Diego Líder (veem o próprio ministério); Hugo sem função.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2060000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2060000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2060000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192060' || lpad(_n::text, 4, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;
-- id do membro pelo primeiro nome
CREATE FUNCTION pg_temp.mn(_first text) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS
$$ SELECT id FROM public.members WHERE name = _first || ' Teste' $$;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e206-' || n || '@teste.invalid' FROM generate_series(1, 23) n;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, mobile_whatsapp) VALUES
  (pg_temp.m(1),  'Samuel Teste',  'M', true,  NULL,          false, NULL,         NULL, true,  pg_temp.mob(1)),
  (pg_temp.m(2),  'Magda Teste',   'F', true,  NULL,          false, NULL,         NULL, true,  pg_temp.mob(2)),
  (pg_temp.m(3),  'Pedro Teste',   'M', false, pg_temp.m(1),  true,  pg_temp.u(3), pg_temp.role('Líder'), true, pg_temp.mob(3)),
  (pg_temp.m(4),  'Paula Teste',   'F', false, pg_temp.m(2),  true,  NULL,         NULL, true,  pg_temp.mob(4)),
  (pg_temp.m(5),  'Tiago Teste',   'M', false, pg_temp.m(1),  true,  NULL,         NULL, true,  pg_temp.mob(5)),
  (pg_temp.m(6),  'Tânia Teste',   'F', false, pg_temp.m(2),  true,  NULL,         NULL, true,  pg_temp.mob(6)),
  (pg_temp.m(7),  'André Teste',   'M', false, pg_temp.m(3),  true,  NULL,         NULL, true,  pg_temp.mob(7)),
  (pg_temp.m(8),  'Beatriz Teste', 'F', false, pg_temp.m(6),  true,  NULL,         NULL, true,  pg_temp.mob(8)),
  (pg_temp.m(9),  'Caio Teste',    'M', false, pg_temp.m(7),  true,  NULL,         NULL, true,  pg_temp.mob(9)),
  (pg_temp.m(10), 'Fábio Teste',   'M', false, pg_temp.m(7),  true,  NULL,         NULL, false, pg_temp.mob(10)),
  (pg_temp.m(11), 'Gabriel Teste', 'M', false, pg_temp.m(10), true,  NULL,         NULL, true,  pg_temp.mob(11)),
  (pg_temp.m(12), 'Carla Teste',   'F', false, pg_temp.m(4),  true,  NULL,         NULL, true,  pg_temp.mob(12)),
  (pg_temp.m(13), 'Débora Teste',  'F', false, pg_temp.m(8),  true,  NULL,         NULL, true,  pg_temp.mob(13)),
  (pg_temp.m(14), 'Rita Teste',    'F', false, pg_temp.m(6),  true,  pg_temp.u(14), pg_temp.role('Administrador'), true, pg_temp.mob(14)),
  (pg_temp.m(15), 'Diego Teste',   'M', false, pg_temp.m(5),  true,  pg_temp.u(15), pg_temp.role('Líder'), true, pg_temp.mob(15)),
  (pg_temp.m(16), 'Hugo Teste',    'M', false, pg_temp.m(5),  true,  pg_temp.u(16), NULL, true,  pg_temp.mob(16)),
  (pg_temp.m(17), 'Lauro Teste',   'M', false, pg_temp.m(15), true,  NULL,         NULL, true,  pg_temp.mob(17)),
  (pg_temp.m(18), 'Olga Teste',    'F', false, pg_temp.m(17), true,  NULL,         NULL, true,  pg_temp.mob(18)),
  (pg_temp.m(19), 'Sônia Teste',   'F', false, pg_temp.m(18), true,  NULL,         NULL, true,  pg_temp.mob(19)),
  (pg_temp.m(20), 'Vânia Teste',   'F', false, pg_temp.m(16), true,  NULL,         NULL, true,  pg_temp.mob(20)),
  (pg_temp.m(21), 'Zélia Teste',   'F', false, pg_temp.m(20), true,  NULL,         NULL, true,  pg_temp.mob(21)),
  (pg_temp.m(22), 'Ester Teste',   'F', false, NULL,          false, NULL,         NULL, true,  pg_temp.mob(22)),
  (pg_temp.m(23), 'Lúcia Teste',   'F', false, pg_temp.m(22), true,  NULL,         NULL, true,  pg_temp.mob(23));
UPDATE public.members SET spouse_id = pg_temp.m(2)  WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4)  WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6)  WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8)  WHERE id = pg_temp.m(7);
UPDATE public.members SET spouse_id = pg_temp.m(18) WHERE id = pg_temp.m(15);
UPDATE public.members SET spouse_id = pg_temp.m(20) WHERE id = pg_temp.m(16);
INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time, is_active) VALUES
  (pg_temp.c(1),  pg_temp.m(7),  pg_temp.m(9),  pg_temp.m(12), 'Evangelística', 'Quarta',  '20:00', true),
  (pg_temp.c(2),  pg_temp.m(15), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Quinta',  '20:00', true),
  (pg_temp.c(3),  pg_temp.m(13), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Terça',   '19:30', true),
  (pg_temp.c(4),  pg_temp.m(11), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Sexta',   '20:00', true),
  (pg_temp.c(5),  pg_temp.m(9),  pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Sábado',  '20:00', true),
  (pg_temp.c(6),  pg_temp.m(17), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Quarta',  '20:00', true),
  (pg_temp.c(7),  pg_temp.m(19), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Quinta',  '20:00', true),
  (pg_temp.c(8),  pg_temp.m(12), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Terça',   '20:00', true),
  (pg_temp.c(9),  pg_temp.m(23), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Sexta',   '19:00', true),
  (pg_temp.c(10), pg_temp.m(10), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(11), pg_temp.m(9),  pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Domingo', '18:00', true);
-- C5: inativa. E2.08 (RN-11): a célula nova sempre começa ativa; é inativada depois.
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(5);
-- C11: excluída (logo depois de criada, como a RPC faz: deleted_at, sem somar nada)
UPDATE public.cells SET deleted_at = now(), deleted_by = pg_temp.m(14) WHERE id = pg_temp.c(11);

-- Execução "pela API" (papel authenticated, com o JWT de um membro da massa): devolve 'ok' ou o
-- código do erro (o `code` de regra, ou o SQLSTATE). Cada chamada é uma subtransação: se falha,
-- nada do que ela fez fica (é o que o RN-08 exige do recálculo).
CREATE FUNCTION pg_temp.api(_n int, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text; _detail text; _hint text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN _n IS NULL THEN '' ELSE
      json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END, true);
    EXECUTE CASE WHEN _n IS NULL THEN 'SET LOCAL ROLE anon' ELSE 'SET LOCAL ROLE authenticated' END;
    EXECUTE _sql;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                THEN _detail::jsonb ->> 'code' || coalesce(':' || (_detail::jsonb ->> 'reason'), '') ELSE _state END;
  END;
END $$;
-- Estado da hierarquia por primeiro nome. _keys: l nível, d discípulos, c células, m masculinas,
-- f femininas, g nome do G12 (pela tabela), a nomes da cadeia (do topo ao líder direto).
CREATE FUNCTION pg_temp.hv(_keys text, VARIADIC _names text[]) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_object_agg(n, (
    SELECT jsonb_object_agg(k.key, k.val)
      FROM (VALUES
        ('l', coalesce(to_jsonb(h.g12_level), 'null'::jsonb)),
        ('d', to_jsonb(h.total_disciples)),
        ('c', to_jsonb(h.total_cells)),
        ('m', to_jsonb(h.male_cells)),
        ('f', to_jsonb(h.female_cells)),
        ('g', coalesce((SELECT to_jsonb(split_part(g.name, ' ', 1)) FROM public.members g WHERE g.id = h.g12_id), 'null'::jsonb)),
        ('a', (SELECT coalesce(jsonb_agg(split_part(a.name, ' ', 1) ORDER BY u.o), '[]'::jsonb)
                 FROM unnest(h.ancestor_ids) WITH ORDINALITY u(id, o) JOIN public.members a ON a.id = u.id))
      ) k(key, val)
     WHERE strpos(_keys, k.key) > 0))
  FROM unnest(_names) n
  JOIN public.members m ON m.name = n || ' Teste'
  JOIN private.member_hierarchy h ON h.member_id = m.id $$;
-- Cenário: aplica os comandos (cada um como a persona _who, ou postgres se nula), lê as consultas
-- (jsonb, como postgres) e DESFAZ tudo. Devolve {codes, q, drift}. Os testes são feitos fora do
-- bloco desfeito, porque o pgTAP guarda o contador dentro da transação.
CREATE FUNCTION pg_temp.scn(_who int, _cmds text[], _qs text[]) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _codes jsonb := '[]'; _q jsonb := '[]'; _c text; _s text; _v jsonb; _drift jsonb;
BEGIN
  BEGIN
    FOREACH _c IN ARRAY _cmds LOOP
      _codes := _codes || to_jsonb(CASE WHEN _who IS NULL OR _c LIKE 'pg:%' THEN pg_temp.api_pg(regexp_replace(_c, '^pg:', ''))
                                        ELSE pg_temp.api(_who, _c) END);
    END LOOP;
    FOREACH _s IN ARRAY _qs LOOP
      EXECUTE _s INTO _v;
      _q := _q || jsonb_build_array(coalesce(_v, 'null'::jsonb));
    END LOOP;
    SELECT coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) INTO _drift FROM private.member_hierarchy_drift() d;
    RAISE EXCEPTION 'scn_undo' USING ERRCODE = 'P0099', DETAIL = jsonb_build_object('codes', _codes, 'q', _q, 'drift', _drift)::text;
  EXCEPTION WHEN SQLSTATE 'P0099' THEN
    GET STACKED DIAGNOSTICS _s = PG_EXCEPTION_DETAIL;
    RETURN _s::jsonb;
  END;
END $$;
-- Como postgres (sem papel): ok ou código do erro.
CREATE FUNCTION pg_temp.api_pg(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _state text; _detail text; _hint text;
BEGIN
  BEGIN
    EXECUTE _sql;
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                THEN _detail::jsonb ->> 'code' || coalesce(':' || (_detail::jsonb ->> 'reason'), '') ELSE _state END;
  END;
END $$;

CREATE FUNCTION pg_temp.allhv(_keys text) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT pg_temp.hv(_keys, 'Samuel','Magda','Pedro','Paula','Tiago','Tânia','André','Beatriz','Carla','Rita',
    'Diego','Hugo','Caio','Fábio','Débora','Lauro','Vânia','Gabriel','Olga','Zélia','Sônia','Ester','Lúcia') $$;
-- Estado de toda a tabela por id (para "nada muda", inclusive com renomeação).
CREATE FUNCTION pg_temp.snap() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_object_agg(h.member_id, to_jsonb(h)) FROM private.member_hierarchy h
   WHERE h.member_id::text LIKE 'c2060000%' AND h.member_id <= pg_temp.m(23) $$;
CREATE TEMP TABLE base AS SELECT pg_temp.allhv('ldcmfga') AS hv, pg_temp.snap() AS snap;
-- Junta dois níveis: o patch muda só as chaves que cita.
CREATE FUNCTION pg_temp.merge2(_a jsonb, _b jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_object_agg(k, coalesce(_a -> k, '{}'::jsonb) || coalesce(_b -> k, '{}'::jsonb))
    FROM (SELECT jsonb_object_keys(_a) AS k UNION SELECT jsonb_object_keys(_b)) x $$;
-- O resultado esperado de um cenário: os códigos, a tabela inteira da massa com o patch, e a drift vazia.
CREATE FUNCTION pg_temp.want(_codes jsonb, _patch jsonb, VARIADIC _extra jsonb[] DEFAULT '{}') RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('codes', _codes, 'drift', '[]'::jsonb,
           'q', jsonb_build_array(pg_temp.merge2((SELECT hv FROM base), _patch)) || to_jsonb(_extra)) $$;

-- Como a pessoa n (a conta dela), executa um SELECT que devolve um jsonb; erro vira {"error": código}.
CREATE FUNCTION pg_temp.asj(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _v jsonb; _state text; _detail text; _hint text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
    EXECUTE _sql INTO _v;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN _v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('error', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%' THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
-- Os nós da ministry_tree_nodes (só os da massa): [nome, cônjuge, nível da posição, discípulos diretos,
-- total de discípulos, total de células, kind, sexo de quem dá o nível, esse alguém é pastor, o cônjuge é pastor].
CREATE FUNCTION pg_temp.tree(_n int, _parents text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.asj(_n, format($f$
    SELECT coalesce(jsonb_agg(jsonb_build_array(split_part(t.member_name, ' ', 1), split_part(t.spouse_name, ' ', 1), t.g12_level, t.direct_disciples,
                                                t.total_disciples, t.total_cells, t.kind, t.level_gender, t.level_is_pastor, t.spouse_is_pastor) ORDER BY t.ord), '[]'::jsonb)
      FROM public.ministry_tree_nodes(%s) WITH ORDINALITY t(member_id, member_name, member_gender, g12_level, is_pastor, spouse_id, spouse_name,
           direct_disciples, total_disciples, total_cells, kind, level_member_id, level_gender, level_is_pastor, spouse_is_pastor, ord)
     WHERE t.member_id::text LIKE 'c2060000%%' $f$,
    CASE WHEN _parents IS NULL THEN '' ELSE format('(SELECT array_agg(pg_temp.mn(x)) FROM unnest(%L::text[]) x)', _parents) END)) $$;
-- A members_view da pessoa n (só a massa): nome → [nível, G12, líder, discípulos, células, masculinas, femininas].
CREATE FUNCTION pg_temp.mv(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.asj(_n, $f$ SELECT coalesce(jsonb_object_agg(split_part(name, ' ', 1), jsonb_build_array(g12_level, split_part(coalesce(g12_name, '-'), ' ', 1),
           split_part(coalesce(leader_name, '-'), ' ', 1), total_disciples, total_cells, male_cells, female_cells)), '{}'::jsonb)
      FROM public.members_view WHERE id::text LIKE 'c2060000%' $f$) $$;
-- A cells_view da pessoa n (só a massa): Cn → [líder, nível do líder, G12].
CREATE FUNCTION pg_temp.cv(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.asj(_n, $f$ SELECT coalesce(jsonb_object_agg('C' || right(id::text, 2)::int, jsonb_build_array(split_part(coalesce(leader_name, '-'), ' ', 1),
           leader_g12_level, split_part(coalesce(g12_leader_name, '-'), ' ', 1))), '{}'::jsonb)
      FROM public.cells_view WHERE id::text LIKE 'd2060000%' $f$) $$;
-- "Células por G12" da pessoa n (só os G12 da massa): [nome, cônjuge, total].
CREATE FUNCTION pg_temp.rk(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.asj(_n, $f$ SELECT coalesce(jsonb_agg(jsonb_build_array(split_part(name, ' ', 1), split_part(spouse_name, ' ', 1), total_cells)), '[]'::jsonb)
      FROM public.dashboard_g12_ranking() WHERE couple_key LIKE '%c2060000%' $f$) $$;
CREATE FUNCTION pg_temp.who(_ids uuid[]) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(split_part(m.name, ' ', 1) ORDER BY m.name), '[]'::jsonb) FROM public.members m WHERE m.id = ANY (_ids) $$;

-- ===========================================================================
-- RN-09: a árvore de Ministérios (ministry_tree_nodes)
-- ===========================================================================
SELECT is(pg_temp.tree(14, NULL), '[["Samuel","Magda",0,4,18,8,"node","M",true,true]]'::jsonb,
  'RN-09: a árvore de Rita começa nos pastores: Samuel e Magda, 18 discípulos e 8 células, nível 0 com os dois pastores ("Pastores")');
SELECT is(pg_temp.tree(14, ARRAY['Samuel','Magda']),
  '[["Pedro","Paula",1,2,4,4,"node","M",false,false],["Tiago","Tânia",1,4,10,4,"node","M",false,false]]'::jsonb,
  'RN-09: abrir os pastores: Pedro e Paula 4 / 4 e Tiago e Tânia 10 / 4, no nível G12 (1)');
SELECT is(pg_temp.tree(14, ARRAY['Pedro','Paula']),
  '[["André","Beatriz",2,2,3,4,"node","M",false,false],["Carla",null,2,0,0,1,"node","F",false,null]]'::jsonb,
  'RN-09: abrir Pedro e Paula: André e Beatriz 3 / 4 (nível 144, de André) e Carla 0 / 1');
SELECT is(pg_temp.tree(14, ARRAY['Tiago','Tânia']),
  '[["André","Beatriz",2,2,3,4,"node","F",false,false],["Diego","Olga",2,2,2,3,"node","M",false,false],["Hugo","Vânia",2,1,1,0,"node","M",false,false],["Rita",null,2,0,0,0,"node","F",false,null]]'::jsonb,
  'RN-09: abrir Tiago e Tânia: André e Beatriz aparecem de novo (3 / 4, nível da Beatriz); Diego e Olga 2 / 3 no nível 144 (o de Diego, não o 20.736 da Olga); Hugo e Vânia 1 / 0; a folha Rita 0 discípulos e 0 células');
SELECT is(pg_temp.tree(14, ARRAY['Diego','Olga']),
  '[["Lauro",null,3,1,2,2,"node","M",false,null],["Sônia",null,5,0,0,1,"node","F",false,null]]'::jsonb,
  'RN-09: abrir Diego e Olga: aparecem Lauro (2 / 2, que abre) e Sônia (nível 5)');
SELECT is(pg_temp.tree(14, ARRAY['Lauro']), '[["Olga","Diego",4,0,null,null,"spouse_above","F",false,false]]'::jsonb,
  'RN-09: abrir Lauro: Olga só como referência (20.736 = nível 4, o cônjuge Diego mais acima, sem totais, sem abrir)');
SELECT is(pg_temp.tree(14, ARRAY['Hugo','Vânia']), '[["Zélia",null,4,0,0,0,"node","F",false,null]]'::jsonb,
  'RN-09: abrir Hugo e Vânia: aparece Zélia, e Vânia não vira referência (o nó do casal é o de cima)');
SELECT is(pg_temp.tree(14, ARRAY['André','Beatriz']),
  '[["Caio",null,3,0,0,0,"node","M",false,null],["Débora",null,3,0,0,1,"node","F",false,null]]'::jsonb,
  'RN-09: abrir André e Beatriz (3 discípulos): aparecem só Caio e Débora, porque Gabriel está abaixo de Fábio, inativo');
SELECT is(pg_temp.tree(3, NULL), '[["Pedro","Paula",1,2,4,4,"node","M",false,false]]'::jsonb,
  'RN-09/Pedro: a árvore dele começa no casal G12 (DA-6 do E2.02)');
SELECT is(pg_temp.tree(3, ARRAY['Pedro','Paula']), '[["André",null,2,1,2,3,"node","M",false,null],["Carla",null,2,0,0,1,"node","F",false,null]]'::jsonb,
  'RN-09/Pedro, que não vê Beatriz: o nó mostra só André, com 2 / 3');
SELECT is(pg_temp.tree(15, ARRAY['Tiago','Tânia']),
  '[["Beatriz",null,2,1,1,1,"node","F",false,null],["Diego","Olga",2,2,2,3,"node","M",false,false],["Hugo","Vânia",2,1,1,0,"node","M",false,false],["Rita",null,2,0,0,0,"node","F",false,null]]'::jsonb,
  'RN-09/Diego, que vê Beatriz e não vê André: o nó mostra só Beatriz, com 1 / 1');
SELECT is(pg_temp.tree(16, NULL), '[]'::jsonb, 'RN-09/Hugo, sem função: a árvore é vazia');
SELECT is(pg_temp.asj(NULL, 'SELECT count(*)::text::jsonb FROM public.ministry_tree_nodes()'), '0'::jsonb,
  'RN-09: sem usuário na sessão (auth.uid() nulo), a árvore é vazia');
SELECT is(pg_temp.api(NULL, 'SELECT * FROM public.ministry_tree_nodes()'), '42501', 'RN-09: anon não tem EXECUTE: 42501');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET is_active = false WHERE id = pg_temp.mn('Beatriz')$c$],
    ARRAY['SELECT pg_temp.tree(14, ARRAY[$$Pedro$$, $$Paula$$])'])->'q'->0,
  '[["André",null,2,1,2,3,"node","M",false,null],["Carla",null,2,0,0,1,"node","F",false,null]]'::jsonb,
  'RN-09: Beatriz inativa: na árvore de Rita, o nó mostra só André, com 2 / 3');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET is_active = false WHERE id = pg_temp.mn('Magda')$c$],
    ARRAY['SELECT pg_temp.tree(14, NULL)'])->'q'->0,
  '[["Samuel",null,0,2,12,6,"node","M",true,null]]'::jsonb,
  'RN-02/RN-09: Magda inativa: a raiz da árvore de Rita é só Samuel, com "Pastor" (sem o cônjuge)');
-- O cônjuge de cima que não está na árvore de quem consulta (DA-3, DA-4): Gabriel casado com Fábio (acima dele).
-- Beatriz vê a linha de André (cônjuge dela), então vê Fábio e Gabriel, mas a árvore dela começa em Tânia e Tiago.
SELECT is(pg_temp.scn(14, ARRAY[
    $c$pg:UPDATE public.members SET auth_user_id = pg_temp.u(7), role_id = pg_temp.role('Líder') WHERE id = pg_temp.mn('André')$c$,
    $c$pg:INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(108), 'Aba Teste', 'F', true, pg_temp.mn('Débora'), true, pg_temp.mob(108))$c$,
    $c$pg:INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(109), 'Bob Teste', 'M', true, pg_temp.m(108), true, pg_temp.mob(109))$c$,
    $c$pg:UPDATE public.members SET spouse_id = pg_temp.mn('Débora') WHERE id = pg_temp.m(109)$c$],
  ARRAY['SELECT pg_temp.tree(14, ARRAY[$$Aba$$])', 'SELECT pg_temp.tree(7, ARRAY[$$Aba$$])']),
  '{"codes": ["ok","ok","ok","ok"], "drift": [], "q": [[["Bob","Débora",5,0,null,null,"spouse_above","M",false,false]], [["Bob",null,5,0,0,0,"node","M",false,null]]]}'::jsonb,
  'RN-09: Bob é casado com Débora, que está acima dele: na árvore de Rita, Débora está na árvore e Bob vira a referência; na árvore de André, que vê Débora mas tem outra raiz, o cônjuge de cima está fora da árvore e Bob é um nó comum, com os próprios totais');
-- A paridade de escopo: tudo o que a árvore devolve (nó, cônjuge e quem dá o nível) está na members_view de quem chama.
CREATE FUNCTION pg_temp.tree_leaks(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.asj(_n, $f$
    SELECT jsonb_build_object('rows', count(*), 'outside_view', count(*) FILTER (WHERE x IS NOT NULL AND x NOT IN (SELECT id FROM public.members_view)))
      FROM (SELECT x FROM public.ministry_tree_nodes() t, unnest(ARRAY[t.member_id, t.spouse_id, t.level_member_id]) x
            UNION ALL
            SELECT x FROM public.ministry_tree_nodes((SELECT array_agg(id) FROM public.members_view WHERE id::text LIKE 'c2060000%')) t,
                          unnest(ARRAY[t.member_id, t.spouse_id, t.level_member_id]) x) q $f$) $$;
SELECT is(pg_temp.tree_leaks(3) ->> 'outside_view', '0', 'Paridade: nenhum id da árvore de Pedro está fora da members_view dele');
SELECT is(pg_temp.tree_leaks(15) ->> 'outside_view', '0', 'Paridade: nenhum id da árvore de Diego está fora da members_view dele');
SELECT is(pg_temp.tree_leaks(14) ->> 'outside_view', '0', 'Paridade: nenhum id da árvore de Rita está fora da members_view dela');
SELECT is(pg_temp.tree_leaks(16) ->> 'rows', '0', 'Paridade: Hugo, sem função, não recebe nada da árvore');
SELECT is(pg_temp.scn(14, ARRAY[
    $c$pg:UPDATE public.members SET auth_user_id = pg_temp.u(7), role_id = pg_temp.role('Líder') WHERE id = pg_temp.mn('André')$c$,
    $c$pg:UPDATE public.members SET auth_user_id = pg_temp.u(8), role_id = pg_temp.role('Líder') WHERE id = pg_temp.mn('Beatriz')$c$,
    $c$pg:UPDATE public.members SET spouse_id = pg_temp.mn('Fábio') WHERE id = pg_temp.mn('Gabriel')$c$],
  ARRAY['SELECT pg_temp.tree_leaks(7)', 'SELECT pg_temp.tree_leaks(8)'])->'q',
  '[{"rows": 3, "outside_view": 0}, {"rows": 3, "outside_view": 0}]'::jsonb,
  'Paridade: André e Beatriz (cada um com a sua árvore) também não recebem nenhum id fora da members_view deles');

-- Quem cada persona vê na members_view e na cells_view (o WHERE das views não mudou: E1.08 e E2.02).
SELECT is(pg_temp.asj(14, $q$ SELECT count(*)::text::jsonb FROM public.members_view WHERE id::text LIKE 'c2060000%' $q$), '23'::jsonb,
  'Paridade: Rita vê as 23 pessoas da massa');
SELECT is(pg_temp.asj(3, $q$ SELECT jsonb_agg(split_part(name, ' ', 1) ORDER BY split_part(name, ' ', 1) COLLATE "C") FROM public.members_view WHERE id::text LIKE 'c2060000%' $q$),
  '["André","Caio","Carla","Fábio","Gabriel","Paula","Pedro"]'::jsonb,
  'Paridade: Pedro vê Pedro, Paula, André, Caio, Fábio, Gabriel e Carla');
SELECT is(pg_temp.asj(15, $q$ SELECT jsonb_agg(split_part(name, ' ', 1) ORDER BY split_part(name, ' ', 1) COLLATE "C") FROM public.members_view WHERE id::text LIKE 'c2060000%' $q$),
  '["Beatriz","Diego","Débora","Hugo","Lauro","Olga","Rita","Sônia","Tiago","Tânia","Vânia","Zélia"]'::jsonb,
  'Paridade: Diego vê o ramo de Tiago (com Olga, Lauro, Sônia, Vânia e Zélia) e o de Tânia (Beatriz, Débora e Rita)');
SELECT is(pg_temp.asj(16, $q$ SELECT jsonb_agg(split_part(name, ' ', 1) ORDER BY split_part(name, ' ', 1) COLLATE "C") FROM public.members_view WHERE id::text LIKE 'c2060000%' $q$),
  '["Hugo"]'::jsonb, 'Paridade: Hugo, sem função, vê só o próprio cadastro');
SELECT is(pg_temp.asj(3, $q$ SELECT jsonb_agg('C' || right(id::text, 2)::int ORDER BY right(id::text, 2)::int) FROM public.cells_view WHERE id::text LIKE 'd2060000%' $q$),
  '["C1","C4","C5","C8","C10"]'::jsonb, 'Paridade: Pedro vê as células C1, C4, C5, C8 e C10 (a C11, excluída, não aparece)');
SELECT is(pg_temp.asj(14, $q$ SELECT count(*)::text::jsonb FROM public.cells_view WHERE id::text LIKE 'd2060000%' $q$), '10'::jsonb,
  'Paridade: Rita vê as 10 células não excluídas (a C11 está excluída)');

-- ===========================================================================
-- RN-10: Membros (members_view)
-- ===========================================================================
SELECT is(pg_temp.mv(14) -> 'Samuel', '[0,"-","-",12,6,5,1]'::jsonb, 'RN-10: Samuel, pastor: nível 0, sem G12 nem líder, 12 discípulos e 6 células (5/1)');
SELECT is(pg_temp.mv(14) -> 'Pedro', '[1,"Pedro","Samuel",3,3,3,0]'::jsonb, 'RN-10: Pedro: G12 (nível 1), G12 ele mesmo, líder Samuel');
SELECT is(pg_temp.mv(14) -> 'André', '[2,"Pedro","Pedro",2,3,3,0]'::jsonb, 'RN-10: André: nível 2, "Pedro" (G12 e líder são a mesma pessoa)');
SELECT is(pg_temp.mv(14) -> 'Caio', '[3,"Pedro","André",0,0,0,0]'::jsonb, 'RN-10: Caio: "Pedro / André", e os totais aparecem sempre (0 discípulos e 0 células)');
SELECT is(pg_temp.mv(14) -> 'Gabriel', '[4,"Pedro","Fábio",0,1,1,0]'::jsonb, 'RN-10: Gabriel: "Pedro / Fábio"');
SELECT is(pg_temp.mv(14) -> 'Ester', '[null,"-","-",1,1,0,1]'::jsonb, 'RN-10: Ester: sem nível, sem G12 e sem líder ("Sem liderança"), 1 discípulo e 1 célula');
SELECT is(pg_temp.mv(14) -> 'Lúcia', '[1,"Lúcia","Ester",0,1,0,1]'::jsonb, 'RN-10: Lúcia: G12 ela mesma, líder Ester');
SELECT is(pg_temp.mv(14) -> 'Diego', '[2,"Tiago","Tiago",3,3,2,1]'::jsonb, 'RN-09 e RN-10: Diego aparece com 3 / 3 e Olga com 1 / 1, os totais de cada um, sem o cônjuge');
SELECT is(pg_temp.mv(14) -> 'Olga', '[4,"Tiago","Lauro",1,1,0,1]'::jsonb, 'RN-10: Olga: 1 / 1, nível 4, líder Lauro');
SELECT is(pg_temp.mv(14) -> 'Fábio', '[3,"Pedro","André",1,2,2,0]'::jsonb, 'RN-10: Fábio, inativo, continua com nível, G12 e totais');
SELECT is(pg_temp.mv(16), '{"Hugo": [2,"Tiago","Tiago",2,0,0,0]}'::jsonb,
  'RN-10: Hugo, sem função, vê pela API só o próprio cadastro: nível 2 (144), liderança "Tiago", 2 / 0');
SELECT is(pg_temp.mv(15) -> 'André', NULL, 'RN-10: André não aparece na lista de Diego, nem o nível, a liderança ou os totais dele');
SELECT is(pg_temp.scn(14, ARRAY[$c$pg:UPDATE public.members SET auth_user_id = pg_temp.u(7), role_id = pg_temp.role('Líder') WHERE id = pg_temp.mn('André')$c$],
    ARRAY['SELECT pg_temp.mv(7)'])->'q'->0 -> 'Débora',
  '[3,"Tânia","Beatriz",0,1,0,1]'::jsonb,
  'RN-10: André vê Débora, e a linha dela mostra "Tânia / Beatriz": só os nomes, e o cadastro de Tânia continua fora do alcance de André');
SELECT is(pg_temp.scn(14, ARRAY[$c$pg:UPDATE public.members SET auth_user_id = pg_temp.u(7), role_id = pg_temp.role('Líder') WHERE id = pg_temp.mn('André')$c$],
    ARRAY['SELECT pg_temp.mv(7)'])->'q'->0 -> 'Tânia', NULL,
  'RN-10: o cadastro de Tânia não está na members_view de André');
SELECT is((SELECT array_agg(c.column_name::text ORDER BY c.ordinal_position) FROM information_schema.columns c
            WHERE c.table_schema = 'public' AND c.table_name = 'members_view'
              AND c.ordinal_position > (SELECT ordinal_position FROM information_schema.columns
                                         WHERE table_schema = 'public' AND table_name = 'members_view' AND column_name = 'spouse_name')
              AND c.ordinal_position <= (SELECT ordinal_position + 2 FROM information_schema.columns
                                          WHERE table_schema = 'public' AND table_name = 'members_view' AND column_name = 'spouse_name')),
  ARRAY['g12_id', 'g12_name'],
  'RN-10: g12_id e g12_name vêm logo depois de spouse_name (E2.03 acrescenta password_reset_status no fim; as colunas de antes ficam onde estavam)');

-- ===========================================================================
-- RN-11: Células (cells_view)
-- ===========================================================================
SELECT is(pg_temp.cv(14) -> 'C1', '["André",2,"Pedro"]'::jsonb, 'RN-11: C1: líder André (nível 2), G12 "Pedro"');
SELECT is(pg_temp.cv(14) -> 'C2', '["Diego",2,"Tiago"]'::jsonb, 'RN-11: C2: G12 "Tiago" (um nome só, não "Tiago e Tânia")');
SELECT is(pg_temp.cv(14) -> 'C8', '["Carla",2,"Paula"]'::jsonb, 'RN-11: C8: G12 "Paula"');
SELECT is(pg_temp.cv(14) -> 'C9', '["Lúcia",1,"Lúcia"]'::jsonb, 'RN-11: C9: a líder é o próprio G12');
SELECT is(pg_temp.cv(14) -> 'C7', '["Sônia",5,"Tiago"]'::jsonb, 'RN-11: C7: líder no nível 5, G12 "Tiago"');
SELECT is((pg_temp.scn(14, ARRAY[
    $c$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (pg_temp.c(31), pg_temp.mn('Pedro'), pg_temp.mn('Rita'), pg_temp.mn('Rita'), 'Evangelística', 'Quarta', '20:00')$c$,
    $c$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (pg_temp.c(32), pg_temp.mn('Samuel'), pg_temp.mn('Rita'), pg_temp.mn('Rita'), 'Evangelística', 'Quarta', '20:00')$c$,
    $c$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (pg_temp.c(33), pg_temp.mn('Ester'), pg_temp.mn('Rita'), pg_temp.mn('Rita'), 'Evangelística', 'Quarta', '20:00')$c$],
  ARRAY['SELECT pg_temp.cv(14)'])->'q'->0) - ARRAY['C1','C2','C3','C4','C5','C6','C7','C8','C9','C10'],
  '{"C31": ["Pedro",1,"Pedro"], "C32": ["Samuel",0,"-"], "C33": ["Ester",null,"-"]}'::jsonb,
  'RN-11: as células novas de Pedro, de Samuel e de Ester: G12 "Pedro", "Pastores" (nível 0, sem G12) e "—" (sem nível, sem G12)');
SELECT is((pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Samuel') WHERE id = pg_temp.mn('André')$c$],
    ARRAY['SELECT pg_temp.cv(14)'])->'q'->0) - ARRAY['C2','C3','C6','C7','C8','C9'],
  '{"C1": ["André",1,"André"], "C4": ["Gabriel",3,"André"], "C5": ["Caio",2,"André"], "C10": ["Fábio",2,"André"]}'::jsonb,
  'RN-11: Rita define Samuel como líder de André: na hora, a C1, a C4, a C5 e a C10 mostram o G12 "André"');

-- ===========================================================================
-- RN-12: nível e totais não se gravam pela API
-- ===========================================================================
SELECT is(pg_temp.api(3, $c$UPDATE public.members SET g12_level = 0, total_disciples = 100, total_cells = 50 WHERE id = pg_temp.mn('André')$c$), '42703',
  'RN-12: Pedro envia o nível 0, 100 discípulos e 50 células para André: a coluna não existe (42703)');
SELECT is(pg_temp.api(14, $c$UPDATE public.members SET g12_level = 0, total_disciples = 100, total_cells = 50 WHERE id = pg_temp.mn('André')$c$), '42703',
  'RN-12: Rita envia o mesmo: a coluna não existe (42703)');
SELECT is(pg_temp.api(14, $c$UPDATE public.members SET male_cells = 9 WHERE id = pg_temp.mn('André')$c$), '42703', 'RN-12: male_cells não existe em members');
SELECT is(pg_temp.api(14, $c$UPDATE public.members SET female_cells = 9 WHERE id = pg_temp.mn('André')$c$), '42703', 'RN-12: female_cells não existe em members');
SELECT is(pg_temp.api(14, $c$INSERT INTO public.members (id, name, gender, has_leadership, g12_level, mobile_whatsapp) VALUES (pg_temp.m(110), 'Nivel Teste', 'M', false, 3, pg_temp.mob(110))$c$), '42703',
  'RN-12: o cadastro com o nível também é recusado (42703)');
SELECT is(pg_temp.mv(14) -> 'André', '[2,"Pedro","Pedro",2,3,3,0]'::jsonb, 'RN-12: André continua com o nível 2 e 2 / 3');
SELECT is(pg_temp.api(14, $c$SELECT g12_level FROM public.members LIMIT 1$c$), '42703', 'RN-12: nem a leitura de members tem a coluna');
SELECT is(pg_temp.api(14, $c$SELECT * FROM private.member_hierarchy$c$), '42501', 'RN-12: authenticated não lê a tabela nova');
SELECT is(pg_temp.api(14, $c$INSERT INTO private.member_hierarchy (member_id) VALUES (gen_random_uuid())$c$), '42501', 'RN-12: authenticated não grava na tabela nova');

-- ===========================================================================
-- RN-08 (leitura): o que cada tela lê na consulta seguinte à troca do líder de Fábio para Tiago
-- ===========================================================================
SELECT is(pg_temp.rk(14), '[["Pedro","Paula",4],["Tiago","Tânia",4],["Lúcia",null,1]]'::jsonb,
  'RN-08 (antes): "Células por G12": Pedro e Paula 4, Tiago e Tânia 4 e Lúcia 1');
CREATE TEMP TABLE after_tiago AS
SELECT pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago') WHERE id = pg_temp.mn('Fábio')$c$],
  ARRAY['SELECT pg_temp.mv(14)', 'SELECT pg_temp.cv(14)', 'SELECT pg_temp.tree(14, ARRAY[$$Samuel$$, $$Magda$$])',
        'SELECT pg_temp.tree(14, ARRAY[$$Pedro$$, $$Paula$$])', 'SELECT pg_temp.rk(14)']) AS r;
SELECT is((SELECT r -> 'codes' FROM after_tiago), '["ok"]'::jsonb, 'RN-08: Rita define Tiago como líder de Fábio, e a gravação é aceita');
SELECT is((SELECT r -> 'q' -> 0 -> 'Fábio' FROM after_tiago), '[2,"Tiago","Tiago",1,2,2,0]'::jsonb, 'RN-08/Membros: Fábio no nível 2 com a liderança "Tiago"');
SELECT is((SELECT r -> 'q' -> 0 -> 'Gabriel' FROM after_tiago), '[3,"Tiago","Fábio",0,1,1,0]'::jsonb, 'RN-08/Membros: Gabriel com "Tiago / Fábio"');
SELECT is((SELECT jsonb_build_array(r -> 'q' -> 0 -> 'André', r -> 'q' -> 0 -> 'Pedro', r -> 'q' -> 0 -> 'Tiago', r -> 'q' -> 0 -> 'Samuel') FROM after_tiago),
  '[[2,"Pedro","Pedro",1,1,1,0],[1,"Pedro","Samuel",2,1,1,0],[1,"Tiago","Samuel",8,5,4,1],[0,"-","-",12,6,5,1]]'::jsonb,
  'RN-08/Membros: André 1 / 1, Pedro 2 / 1, Tiago 8 / 5 (4/1) e Samuel sem mudança (12 / 6)');
SELECT is((SELECT jsonb_build_array(r -> 'q' -> 1 -> 'C4', r -> 'q' -> 1 -> 'C10') FROM after_tiago), '[["Gabriel",3,"Tiago"],["Fábio",2,"Tiago"]]'::jsonb,
  'RN-08/Células: a C4 e a C10 com o G12 "Tiago"');
SELECT is((SELECT r -> 'q' -> 2 FROM after_tiago),
  '[["Pedro","Paula",1,2,3,2,"node","M",false,false],["Tiago","Tânia",1,4,11,6,"node","M",false,false]]'::jsonb,
  'RN-08/Ministérios: Pedro e Paula 3 / 2 e Tiago e Tânia 11 / 6');
SELECT is((SELECT r -> 'q' -> 3 -> 0 FROM after_tiago), '["André","Beatriz",2,2,2,2,"node","M",false,false]'::jsonb,
  'RN-08/Ministérios: André e Beatriz 2 / 2');
SELECT is((SELECT r -> 'q' -> 4 FROM after_tiago), '[["Tiago","Tânia",6],["Pedro","Paula",2],["Lúcia",null,1]]'::jsonb,
  'RN-08/Dashboard, "Células por G12": Pedro e Paula 2, Tiago e Tânia 6');
SELECT is((SELECT r -> 'drift' FROM after_tiago), '[]'::jsonb, 'RN-08: member_hierarchy_drift() vazia depois da troca');

SELECT * FROM finish();

ROLLBACK;
