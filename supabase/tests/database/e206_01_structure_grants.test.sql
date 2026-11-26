-- E2.06 (PR 1): estrutura e privilégios da hierarquia (tabela, funções, triggers, trava da árvore,
-- CHECKs, colunas que saíram de members e a pós-condição da migration 3).
-- Spec: docs/specs/e2-06-hierarquia-totais.md ("Verificações obrigatórias": Estrutura e privilégios;
-- "Modelo de dados e migrations"; "Bloqueios e concorrência"; DT-01 a DT-06, RN-12, DA-2).
-- A massa é a do Negócio (23 pessoas e 11 células), montada com os triggers ligados.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(199);

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

-- ---------------------------------------------------------------------------
-- A tabela private.member_hierarchy: sem privilégio para ninguém da API, com RLS e sem políticas.
-- ---------------------------------------------------------------------------
SELECT is((SELECT pg_get_userbyid(relowner)::text FROM pg_class WHERE oid = 'private.member_hierarchy'::regclass), 'postgres',
  'member_hierarchy: dona postgres');
SELECT is((SELECT relrowsecurity FROM pg_class WHERE oid = 'private.member_hierarchy'::regclass), true,
  'member_hierarchy: RLS ligada');
SELECT is((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'private.member_hierarchy'::regclass), 0,
  'member_hierarchy: sem nenhuma política');
SELECT is((SELECT relacl::text FROM pg_class WHERE oid = 'private.member_hierarchy'::regclass), '{postgres=arwdDxtm/postgres}',
  'member_hierarchy: ACL só da dona (nada concedido a PUBLIC, anon, authenticated nem service_role)');
SELECT ok(NOT has_table_privilege(r, 'private.member_hierarchy', p), r || ' sem ' || p || ' em member_hierarchy')
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
       unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p;
SELECT ok(NOT has_column_privilege(r, 'private.member_hierarchy', c, 'SELECT'), r || ' sem SELECT na coluna ' || c)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r,
       unnest(ARRAY['member_id', 'ancestor_ids', 'g12_level', 'g12_id', 'total_disciples', 'total_cells', 'male_cells', 'female_cells']) c;
SELECT is(pg_temp.api(14, 'SELECT * FROM private.member_hierarchy'), '42501', 'authenticated (Rita, Administrador) não lê a tabela: 42501');
SELECT is(pg_temp.api(14, 'UPDATE private.member_hierarchy SET total_disciples = 99'), '42501', 'authenticated não grava na tabela: 42501');
SELECT is(pg_temp.api(14, 'DELETE FROM private.member_hierarchy'), '42501', 'authenticated não apaga da tabela: 42501');
SELECT is(pg_temp.api(NULL, 'SELECT * FROM private.member_hierarchy'), '42501', 'anon não lê a tabela: 42501');
SELECT is(pg_temp.api(14, 'SELECT private.hierarchy_path(NULL)'), '42501', 'authenticated não chama as funções internas: 42501');
SELECT is(pg_temp.api(14, 'SELECT private.rebuild_member_hierarchy()'), '42501', 'authenticated não chama o recálculo do zero: 42501');
SELECT is(pg_temp.api(14, 'SELECT * FROM private.member_hierarchy_drift()'), '42501', 'authenticated não lê a drift: 42501');

-- ---------------------------------------------------------------------------
-- Funções: donas postgres, sem EXECUTE para PUBLIC, anon, authenticated nem service_role.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE fns (sig text);
INSERT INTO fns VALUES
  ('private.hierarchy_path(uuid)'), ('private.hierarchy_level(uuid[],boolean,boolean,boolean)'),
  ('private.hierarchy_spread(uuid[],integer,integer,integer,integer)'), ('private.hierarchy_fail(text)'),
  ('private.hierarchy_cell_spread(uuid,integer)'), ('private.hierarchy_apply(private.hierarchy_delta[])'),
  ('private.hierarchy_recompute_subtree(uuid,uuid[],boolean)'), ('private.member_hierarchy_expected()'),
  ('private.rebuild_member_hierarchy()'), ('private.member_hierarchy_drift()'), ('private.member_hierarchy_problems()'),
  ('public._hierarchy_lock_member()'), ('public._hierarchy_on_member()'), ('public._hierarchy_on_cell()');
SELECT is((SELECT count(*)::int FROM fns), 14, 'as 14 funções novas da hierarquia');
SELECT ok(to_regprocedure(sig) IS NOT NULL, sig || ': existe') FROM fns;
SELECT ok(NOT has_function_privilege(r, sig::regprocedure, 'EXECUTE'), sig || ': sem EXECUTE para ' || r)
  FROM fns, unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT is(proacl::text, '{postgres=X/postgres}', sig || ': ACL só da dona (nada para PUBLIC)')
  FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.sig);
SELECT is(pg_get_userbyid(p.proowner)::text, 'postgres', sig || ': dona postgres')
  FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.sig);
SELECT is((SELECT array_agg(a.grantee::regrole::text ORDER BY a.grantee::regrole::text)
             FROM pg_proc p, aclexplode(p.proacl) a WHERE p.oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure),
  ARRAY['authenticated', 'postgres'], 'ministry_tree_nodes: EXECUTE só para authenticated (e a dona)');
SELECT ok(NOT has_function_privilege('anon', 'public.ministry_tree_nodes(uuid[])', 'EXECUTE')
          AND NOT has_function_privilege('service_role', 'public.ministry_tree_nodes(uuid[])', 'EXECUTE'),
  'ministry_tree_nodes: anon e service_role sem EXECUTE');
SELECT ok(prosecdef, 'ministry_tree_nodes: SECURITY DEFINER (lê a cadeia em private)')
  FROM pg_proc WHERE oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure;
SELECT ok(prosecdef AND 'search_path=public' = ANY (proconfig), sig || ': SECURITY DEFINER com search_path fixo')
  FROM fns JOIN pg_proc p ON p.oid = to_regprocedure(fns.sig)
 WHERE fns.sig !~ 'hierarchy_(level|spread)\(';
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'private.hierarchy_level(uuid[],boolean,boolean,boolean)'::regprocedure), false,
  'hierarchy_level e hierarchy_spread são puras (IMMUTABLE, sem SECURITY DEFINER)');

-- ---------------------------------------------------------------------------
-- As colunas calculadas saíram de members (RN-12) e nenhum corpo de função as cita fora da lista.
-- ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_attribute WHERE attrelid = 'public.members'::regclass AND NOT attisdropped
             AND attname IN ('g12_level', 'total_disciples', 'total_cells', 'male_cells', 'female_cells')), 0,
  'RN-12: members não tem mais g12_level, total_disciples, total_cells, male_cells nem female_cells');
SELECT is((SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'members_view'
             AND column_name IN ('g12_level', 'total_disciples', 'total_cells', 'male_cells', 'female_cells')), 5,
  'as cinco colunas continuam na members_view (a leitura mudou de fonte, não de contrato)');
SELECT is((SELECT array_agg(n.nspname || '.' || p.proname ORDER BY n.nspname, p.proname)
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname IN ('public', 'private')
              AND p.prosrc ~ '\m(g12_level|total_disciples|total_cells|male_cells|female_cells)\M'
              AND NOT (p.proname ~ '^(_hierarchy_|hierarchy_|member_hierarchy_)'
                       OR p.proname IN ('rebuild_member_hierarchy', 'ministry_tree_nodes', 'dashboard_g12_ranking'))), NULL,
  'nenhum corpo de função cita as colunas calculadas fora da lista conhecida');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE tgname IN ('compute_member_g12_level', 'trg_refresh_stats_members', 'trg_refresh_stats_cells')), 0,
  'os três triggers antigos (nível e totais) saíram');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname IN ('compute_g12_level', 'refresh_member_stats_v2') AND pronamespace = 'public'::regnamespace), 0,
  'compute_g12_level e refresh_member_stats_v2 saíram');
-- A pós-condição da migration 3 falha com uma função que cite members.g12_level (o texto é o da migration).
CREATE FUNCTION public._e206_probe() RETURNS integer LANGUAGE plpgsql AS $$ BEGIN RETURN (SELECT m.g12_level FROM public.members m LIMIT 1); END $$;
SELECT throws_ok($do$
DO $$
DECLARE
  _names text[];
BEGIN
  SELECT array_agg(n.nspname || '.' || p.proname ORDER BY 1) INTO _names
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'private')
     AND p.prosrc ~ '\m(g12_level|total_disciples|total_cells|male_cells|female_cells)\M'
     AND NOT (p.proname ~ '^(_hierarchy_|hierarchy_|member_hierarchy_)'
              OR p.proname IN ('rebuild_member_hierarchy', 'ministry_tree_nodes', 'dashboard_g12_ranking'));
  IF _names IS NOT NULL THEN
    RAISE EXCEPTION 'E2.06: funções que ainda citam as colunas calculadas de members: %', _names;
  END IF;
END $$;
$do$, 'P0001', 'E2.06: funções que ainda citam as colunas calculadas de members: {public._e206_probe}',
  'a pós-condição da migration 3 falha com uma função que cite members.g12_level');
DROP FUNCTION public._e206_probe();

-- ---------------------------------------------------------------------------
-- Os três triggers: tabela, momento e colunas.
-- ---------------------------------------------------------------------------
SELECT is(pg_get_triggerdef(t.oid),
  'CREATE TRIGGER ac_lock_member_tree BEFORE INSERT OR DELETE OR UPDATE OF leader_id, is_pastor, is_active, gender, deleted_at ON public.members FOR EACH ROW EXECUTE FUNCTION _hierarchy_lock_member()',
  'ac_lock_member_tree: BEFORE, por linha, em members: INSERT, DELETE e UPDATE OF leader_id, is_pastor, is_active, gender, deleted_at')
  FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = 'ac_lock_member_tree';
SELECT is(pg_get_triggerdef(t.oid),
  'CREATE TRIGGER trg_member_hierarchy AFTER INSERT OR DELETE OR UPDATE OF leader_id, is_pastor, is_active, gender, deleted_at ON public.members FOR EACH ROW EXECUTE FUNCTION _hierarchy_on_member()',
  'trg_member_hierarchy: AFTER, por linha, em members, com as mesmas colunas')
  FROM pg_trigger t WHERE t.tgrelid = 'public.members'::regclass AND t.tgname = 'trg_member_hierarchy';
SELECT is(pg_get_triggerdef(t.oid),
  'CREATE TRIGGER trg_cell_hierarchy AFTER INSERT OR DELETE OR UPDATE OF leader_id, is_active, deleted_at ON public.cells FOR EACH ROW EXECUTE FUNCTION _hierarchy_on_cell()',
  'trg_cell_hierarchy: AFTER, por linha, em cells: INSERT, DELETE e UPDATE OF leader_id, is_active, deleted_at')
  FROM pg_trigger t WHERE t.tgrelid = 'public.cells'::regclass AND t.tgname = 'trg_cell_hierarchy';
SELECT is(t.tgenabled::text, 'O', 'trigger habilitado: ' || t.tgname)
  FROM pg_trigger t WHERE t.tgname IN ('ac_lock_member_tree', 'trg_member_hierarchy', 'trg_cell_hierarchy') ORDER BY t.tgname;

-- ---------------------------------------------------------------------------
-- A chave da trava da árvore é a mesma em todo lugar que a pega (E2.04 e E2.06).
-- ---------------------------------------------------------------------------
SELECT is((SELECT array_agg(proname::text ORDER BY proname) FROM pg_proc WHERE prosrc LIKE '%members:leader-tree%'),
  ARRAY['_hierarchy_lock_member', '_hierarchy_on_cell', 'enforce_member_rules', 'rebuild_member_hierarchy', 'restore_member'],
  'a chave members:leader-tree aparece só no ac_lock_member_tree, no trigger de célula, no ad_ do E2.04, no recálculo do zero e na restauração');
SELECT ok(prosrc LIKE '%hashtextextended(''members:leader-tree'', 0)%', proname || ': usa hashtextextended(''members:leader-tree'', 0)')
  FROM pg_proc WHERE prosrc LIKE '%members:leader-tree%';
SELECT is(p.proname::text, 'enforce_member_rules', 'o trigger ad_enforce_member_rules (E2.04) executa a enforce_member_rules')
  FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgname = 'ad_enforce_member_rules';
-- restore_member: a trava da árvore vem antes de qualquer trava de identificador (ordem global 1 → 3 → 4).
SELECT ok(strpos(prosrc, 'members:leader-tree') > 0
          AND (strpos(prosrc, 'member-identifier') = 0 OR strpos(prosrc, 'members:leader-tree') < strpos(prosrc, 'member-identifier')),
  'restore_member: a trava da árvore vem antes das travas de identificador')
  FROM pg_proc WHERE oid = 'public.restore_member(uuid)'::regprocedure;
SELECT ok(strpos(prosrc, 'members:leader-tree') < strpos(prosrc, '_member_values_in_use'),
  'restore_member: a trava da árvore vem antes da checagem dos valores em uso')
  FROM pg_proc WHERE oid = 'public.restore_member(uuid)'::regprocedure;
-- Os modos de verdade, vistos em pg_locks (DT-05): troca de líder = exclusiva; o resto = compartilhada.
CREATE FUNCTION pg_temp.tree_lock_modes() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(DISTINCT mode ORDER BY mode), '[]'::jsonb) FROM pg_locks
   WHERE locktype = 'advisory' AND pid = pg_backend_pid()
     AND (classid::text::numeric * 4294967296 + objid::text::numeric)
         = (hashtextextended('members:leader-tree', 0)::numeric + 18446744073709551616) % 18446744073709551616 $$;
SELECT is(pg_temp.tree_lock_modes(), '["ShareLock"]'::jsonb,
  'a montagem da massa (cadastros, células e cônjuges) só pegou a trava compartilhada da árvore');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET is_active = false WHERE id = pg_temp.mn('Caio')$c$],
    ARRAY['SELECT pg_temp.tree_lock_modes()'])->'q'->0, '["ShareLock"]'::jsonb,
  'inativar alguém pega a trava da árvore compartilhada');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.cells SET leader_id = pg_temp.mn('Caio') WHERE id = pg_temp.c(8)$c$],
    ARRAY['SELECT pg_temp.tree_lock_modes()'])->'q'->0, '["ShareLock"]'::jsonb,
  'trocar o líder de uma célula pega a trava da árvore compartilhada');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago') WHERE id = pg_temp.mn('Fábio')$c$],
    ARRAY['SELECT pg_temp.tree_lock_modes()'])->'q'->0, '["ExclusiveLock", "ShareLock"]'::jsonb,
  'trocar o líder de um membro pega a trava da árvore exclusiva');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET gender = 'F' WHERE id = pg_temp.mn('Gabriel')$c$],
    ARRAY['SELECT pg_temp.tree_lock_modes()'])->'q'->0, '["ExclusiveLock", "ShareLock"]'::jsonb,
  'trocar o sexo de um membro pega a trava da árvore exclusiva');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = NULL, has_leadership = false WHERE id = pg_temp.mn('André')$c$],
    ARRAY['SELECT pg_temp.tree_lock_modes()'])->'q'->0, '["ExclusiveLock", "ShareLock"]'::jsonb,
  'tirar o líder (para nulo) pega a trava da árvore exclusiva');
SELECT is(pg_temp.scn(NULL, ARRAY['SELECT private.rebuild_member_hierarchy()'], ARRAY['SELECT pg_temp.tree_lock_modes()'])->'q'->0,
  '["ExclusiveLock", "ShareLock"]'::jsonb, 'o recálculo do zero pega a trava da árvore exclusiva');

-- ---------------------------------------------------------------------------
-- CHECKs da tabela (feitos como postgres).
-- ---------------------------------------------------------------------------
SELECT throws_ok($$UPDATE private.member_hierarchy SET g12_level = 7 WHERE member_id = pg_temp.m(3)$$, '23514',
  'new row for relation "member_hierarchy" violates check constraint "member_hierarchy_level_check"',
  'CHECK: nível incoerente com a cadeia (nível 7 com 1 ancestral) é recusado');
SELECT throws_ok($$UPDATE private.member_hierarchy SET ancestor_ids = ARRAY[member_id] WHERE member_id = pg_temp.m(3)$$, '23514',
  'new row for relation "member_hierarchy" violates check constraint "member_hierarchy_not_own_ancestor_check"',
  'CHECK: membro na própria cadeia é recusado');
SELECT throws_ok($$UPDATE private.member_hierarchy SET total_disciples = -1 WHERE member_id = pg_temp.m(3)$$, '23514',
  'new row for relation "member_hierarchy" violates check constraint "member_hierarchy_totals_check"',
  'CHECK: total de discípulos negativo é recusado');
SELECT throws_ok($$UPDATE private.member_hierarchy SET male_cells = -1 WHERE member_id = pg_temp.m(3)$$, '23514',
  'new row for relation "member_hierarchy" violates check constraint "member_hierarchy_totals_check"',
  'CHECK: células masculinas negativas são recusadas');
SELECT throws_ok($$UPDATE private.member_hierarchy SET total_cells = 1, male_cells = 1, female_cells = 1 WHERE member_id = pg_temp.m(3)$$, '23514',
  'new row for relation "member_hierarchy" violates check constraint "member_hierarchy_totals_check"',
  'CHECK: o total de células não pode ser menor que masculinas mais femininas');
SELECT lives_ok($$UPDATE private.member_hierarchy SET total_cells = 5, male_cells = 1, female_cells = 1 WHERE member_id = pg_temp.m(3)$$,
  'CHECK: o total de células maior que masculinas mais femininas é aceito (líder sem sexo, 5.5)');
SELECT throws_ok($$UPDATE private.member_hierarchy SET g12_level = 1, ancestor_ids = '{}' WHERE member_id = pg_temp.m(3)$$, '23514',
  'new row for relation "member_hierarchy" violates check constraint "member_hierarchy_level_check"',
  'CHECK: nível 1 sem nenhum ancestral é recusado');
SELECT lives_ok($$UPDATE private.member_hierarchy SET g12_level = NULL, ancestor_ids = '{}' WHERE member_id = pg_temp.m(22)$$,
  'CHECK: sem liderança (nível nulo e sem cadeia) é aceito');
SELECT throws_ok($$INSERT INTO private.member_hierarchy (member_id) VALUES (gen_random_uuid())$$, '23503', NULL,
  'FK: linha para um membro que não existe é recusada');
SELECT is((SELECT g12_id FROM private.member_hierarchy WHERE member_id = pg_temp.m(15)), pg_temp.m(5),
  'g12_id (coluna gerada): o segundo da cadeia (Tiago, para Diego)');
SELECT is((SELECT g12_id FROM private.member_hierarchy WHERE member_id = pg_temp.m(3)), pg_temp.m(3),
  'g12_id (coluna gerada): no nível 1 é a própria pessoa (Pedro)');
SELECT is((SELECT g12_id FROM private.member_hierarchy WHERE member_id = pg_temp.m(1)), NULL, 'g12_id: pastor, sem G12');
SELECT is((SELECT count(*)::int FROM pg_index i WHERE i.indrelid = 'private.member_hierarchy'::regclass AND i.indisprimary), 1,
  'member_hierarchy: chave primária em member_id');
SELECT is((SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
            WHERE i.indrelid = 'private.member_hierarchy'::regclass AND NOT i.indisprimary),
  ARRAY['member_hierarchy_ancestor_ids_idx', 'member_hierarchy_g12_id_idx', 'member_hierarchy_g12_level_idx'],
  'member_hierarchy: os três índices (cadeia GIN, G12 e nível)');

SELECT * FROM finish();

ROLLBACK;
