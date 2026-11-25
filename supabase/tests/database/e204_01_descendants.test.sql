-- E2.04 (PR 1): member_descendants_among, a RPC do seletor de líder (AQ-4, DT-16, RN-13).
-- Spec: docs/specs/e2-04-validacoes-membro.md, "Seletor de líder com os discípulos (AQ-4)",
-- RN-13 (discípulos diretos e indiretos, inativos incluídos, qualquer profundidade),
-- "Verificações obrigatórias" (member_descendants_among), e a regra de que o seletor só mostra
-- quem quem edita já vê (RN-13, RN-10 do E1.08).
-- Massa (dados fictícios): Samuel e Magda (pastores), Pedro (Líder, vê só o ministério), André,
-- Caio (Membro) e Davi (inativo) na linha de Pedro; Tiago, Diego e Dora em outro ministério,
-- que Pedro não vê; Rita (Administrador); a cadeia N1 a N8 (profundidade 8) sob Samuel.
-- Rodar com: supabase test db
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(29);

CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2041200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2041200-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e204d-' || n || '@teste.invalid' FROM generate_series(1, 10) n;

-- 1 Samuel, 2 Magda, 3 Pedro, 4 André, 5 Caio, 6 Davi (inativo), 7 Tiago, 8 Diego, 9 Dora, 10 Rita.
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, auth_user_id, role_id, is_active) VALUES
  (pg_temp.m(1), 'Samuel Colares', 'M', true, NULL, pg_temp.u(1), pg_temp.role('Líder'), true),
  (pg_temp.m(2), 'Magda Colares', 'F', true, NULL, pg_temp.u(2), pg_temp.role('Líder'), true),
  (pg_temp.m(3), 'Pedro Lima', 'M', false, pg_temp.m(1), pg_temp.u(3), pg_temp.role('Líder'), true),
  (pg_temp.m(4), 'André Lima', 'M', false, pg_temp.m(3), pg_temp.u(4), NULL, true),
  (pg_temp.m(5), 'Caio Souza', 'M', false, pg_temp.m(4), pg_temp.u(5), pg_temp.role('Membro'), true),
  (pg_temp.m(6), 'Davi Souza', 'M', false, pg_temp.m(5), NULL, NULL, false),
  (pg_temp.m(7), 'Tiago Reis', 'M', false, pg_temp.m(1), pg_temp.u(7), pg_temp.role('Líder'), true),
  (pg_temp.m(8), 'Diego Rocha', 'M', false, pg_temp.m(7), pg_temp.u(8), pg_temp.role('Líder'), true),
  (pg_temp.m(9), 'Dora Rocha', 'F', false, pg_temp.m(8), NULL, NULL, true),
  (pg_temp.m(10), 'Rita Admin', 'F', false, pg_temp.m(2), pg_temp.u(10), pg_temp.role('Administrador'), true);
-- A cadeia N1..N8: N1 sob Samuel, cada um líder do seguinte. Inclui um inativo no meio (N4).
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, is_active)
SELECT pg_temp.m(20 + n), 'Nivel ' || n || ' Cadeia', 'M', false,
       CASE WHEN n = 1 THEN pg_temp.m(1) ELSE pg_temp.m(20 + n - 1) END, n <> 4
  FROM generate_series(1, 8) n;
-- Um ciclo antigo (dado fora das regras, só em replica): X <-> Y, e Z sob Y.
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, g12_level) VALUES
  (pg_temp.m(40), 'Ciclo X', 'M', false, pg_temp.m(41), true, 1),
  (pg_temp.m(41), 'Ciclo Y', 'F', false, pg_temp.m(40), true, 1),
  (pg_temp.m(42), 'Ciclo Z', 'F', false, pg_temp.m(41), true, 2);
SET LOCAL session_replication_role = origin;

CREATE TEMP TABLE ev0 ON COMMIT DROP AS SELECT count(*) AS n FROM public.events;

-- Executa _sql como o usuário n (NULL = anon) e devolve os ids da consulta, ordenados, ou o
-- estado do erro (e o código de regra, se for 22023 com app_error).
CREATE FUNCTION pg_temp.q(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _out uuid[]; _state text; _detail text; _hint text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN _n IS NULL THEN '' ELSE json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text END, true);
    EXECUTE CASE WHEN _n IS NULL THEN 'SET LOCAL ROLE anon' ELSE 'SET LOCAL ROLE authenticated' END;
    EXECUTE 'SELECT coalesce(array_agg(x ORDER BY x), ''{}''::uuid[]) FROM (' || _sql || ') q(x)' INTO _out;
    EXECUTE 'RESET ROLE';
    PERFORM set_config('request.jwt.claims', '', true);
    RETURN to_jsonb(_out);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE, _detail = PG_EXCEPTION_DETAIL, _hint = PG_EXCEPTION_HINT;
    RETURN jsonb_build_object('error', CASE WHEN _state = '22023' AND _hint = 'app_error' AND _detail LIKE '{%'
                                            THEN _detail::jsonb ->> 'code' ELSE _state END);
  END;
END $$;
CREATE FUNCTION pg_temp.desc_of(_n int, _member uuid, _cands uuid[]) RETURNS jsonb LANGUAGE sql AS
$$ SELECT pg_temp.q(_n, format('SELECT * FROM public.member_descendants_among(%L, %L::uuid[])', _member, _cands)) $$;
CREATE FUNCTION pg_temp.ids(VARIADIC _ns int[]) RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(jsonb_agg(pg_temp.m(n) ORDER BY pg_temp.m(n)), '[]'::jsonb) FROM unnest(_ns) n $$;

-- ---------------------------------------------------------------------------
-- Pedro (Líder: edita membros, vê só o ministério).
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.desc_of(3, pg_temp.m(3), ARRAY[pg_temp.m(4), pg_temp.m(5), pg_temp.m(6)]), pg_temp.ids(4, 5, 6),
  'RN-13: discípulos diretos e indiretos de Pedro, o inativo Davi incluído');
SELECT is(pg_temp.desc_of(3, pg_temp.m(3), ARRAY[pg_temp.m(3), pg_temp.m(4), pg_temp.m(1), pg_temp.m(2)]), pg_temp.ids(4),
  'a própria pessoa e o líder dela (ancestral) ficam fora');
SELECT is(pg_temp.desc_of(3, pg_temp.m(3), ARRAY[pg_temp.m(7), pg_temp.m(8), pg_temp.m(9)]), '[]'::jsonb,
  'RN-10 do E1.08: quem Pedro não vê (outro ministério) nunca volta');
SELECT is(pg_temp.desc_of(3, pg_temp.m(8), ARRAY[pg_temp.m(9)]), '[]'::jsonb,
  'Diego, que Pedro não vê: a consulta não diz nada sobre os discípulos dele');
SELECT is(pg_temp.desc_of(3, pg_temp.m(4), ARRAY[pg_temp.m(5), pg_temp.m(6), pg_temp.m(3)]), pg_temp.ids(5, 6),
  'discípulos de André: Caio e Davi; Pedro, que é líder de André, não');
SELECT is(pg_temp.desc_of(3, pg_temp.m(6), ARRAY[pg_temp.m(3), pg_temp.m(4), pg_temp.m(5)]), '[]'::jsonb,
  'Davi (inativo) não tem discípulos entre os candidatos');
SELECT is(pg_temp.desc_of(3, pg_temp.m(3), ARRAY[pg_temp.m(5), pg_temp.m(5), pg_temp.m(6), pg_temp.m(6)]), pg_temp.ids(5, 6),
  'candidatos repetidos voltam uma vez só');

-- ---------------------------------------------------------------------------
-- Rita (Administrador vê a igreja toda).
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.desc_of(10, pg_temp.m(8), ARRAY[pg_temp.m(9), pg_temp.m(3)]), pg_temp.ids(9),
  'Rita vê Diego e Dora: Dora é discípula de Diego');
SELECT is(pg_temp.desc_of(10, pg_temp.m(1), ARRAY[pg_temp.m(3), pg_temp.m(9), pg_temp.m(6), pg_temp.m(10)]), pg_temp.ids(3, 9, 6),
  'Samuel: todos os que descendem dele, em qualquer ministério (Rita está sob Magda, não)');
SELECT is(pg_temp.desc_of(10, pg_temp.m(21), ARRAY[pg_temp.m(22), pg_temp.m(23), pg_temp.m(24), pg_temp.m(25), pg_temp.m(26), pg_temp.m(27), pg_temp.m(28), pg_temp.m(1)]),
  pg_temp.ids(22, 23, 24, 25, 26, 27, 28), 'RN-13: qualquer profundidade (N1 a N8, e não só até 6 níveis), o inativo N4 incluído');
SELECT is(pg_temp.desc_of(10, pg_temp.m(28), ARRAY[pg_temp.m(21), pg_temp.m(25), pg_temp.m(1)]), '[]'::jsonb,
  'N8 não tem como discípulos os ancestrais dele');
SELECT is(pg_temp.desc_of(10, pg_temp.m(21), ARRAY[pg_temp.m(28)]), pg_temp.ids(28), 'N8 é discípulo de N1 (7 níveis abaixo)');
SELECT is(pg_temp.desc_of(10, pg_temp.m(24), ARRAY[pg_temp.m(23), pg_temp.m(25)]), pg_temp.ids(25),
  'o inativo N4 tem N5 como discípulo e N3 como líder');
SELECT is(pg_temp.desc_of(10, pg_temp.m(1), ARRAY[pg_temp.m(1)]), '[]'::jsonb, 'a própria pessoa fora');
SELECT is(pg_temp.desc_of(10, pg_temp.m(1), ARRAY[]::uuid[]), '[]'::jsonb, 'lista vazia de candidatos');
SELECT is(pg_temp.desc_of(10, pg_temp.m(1), NULL), '[]'::jsonb, 'candidatos nulos');
SELECT is(pg_temp.desc_of(10, NULL, ARRAY[pg_temp.m(3)]), '[]'::jsonb, 'membro nulo (cadastro novo): nada');
SELECT is(pg_temp.desc_of(10, gen_random_uuid(), ARRAY[pg_temp.m(3)]), '[]'::jsonb, 'membro que não existe: nada');
SELECT is(pg_temp.desc_of(10, pg_temp.m(1), ARRAY[gen_random_uuid(), pg_temp.m(3)]), pg_temp.ids(3),
  'candidato que não existe é ignorado');

-- Ciclo antigo: a consulta termina (caminho visitado) e responde certo.
SELECT is(pg_temp.desc_of(10, pg_temp.m(40), ARRAY[pg_temp.m(41), pg_temp.m(42)]), pg_temp.ids(41, 42),
  'um ciclo antigo não trava a consulta: Y e Z são discípulos de X');
SELECT is(pg_temp.desc_of(10, pg_temp.m(42), ARRAY[pg_temp.m(40)]), '[]'::jsonb,
  'o ciclo antigo: Z não tem X como discípulo, e a consulta termina');

-- ---------------------------------------------------------------------------
-- Limites e permissões.
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.q(10, format('SELECT * FROM public.member_descendants_among(%L, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 101)))', pg_temp.m(1))),
  '{"error": "too_many_ids"}'::jsonb, 'mais de 100 ids é recusado (too_many_ids)');
SELECT is(pg_temp.q(10, format('SELECT * FROM public.member_descendants_among(%L, (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 100)))', pg_temp.m(1))),
  '[]'::jsonb, 'exatamente 100 ids é aceito');
SELECT is(pg_temp.desc_of(5, pg_temp.m(5), ARRAY[pg_temp.m(6)]), '{"error": "42501"}'::jsonb,
  'sem "Editar Membro" (Caio, função Membro): 42501');
SELECT is(pg_temp.desc_of(NULL, pg_temp.m(5), ARRAY[pg_temp.m(6)]), '{"error": "42501"}'::jsonb, 'anon: 42501 (sem EXECUTE)');
SELECT is(pg_temp.desc_of(9, pg_temp.m(5), ARRAY[pg_temp.m(6)]), '{"error": "42501"}'::jsonb,
  'usuário sem cadastro de membro (conta sem permissão): 42501');
SELECT is(pg_temp.q(1, format('SELECT * FROM public.member_descendants_among(%L, %L::uuid[])', pg_temp.m(3), ARRAY[pg_temp.m(4)])),
  pg_temp.ids(4), 'Samuel (Líder, vê o próprio ministério) consulta a linha dele');

-- Nada é gravado e a RPC é só leitura (STABLE): nenhum evento de Auditoria novo.
SELECT is((SELECT count(*) FROM public.events), (SELECT n FROM ev0),
  'a consulta não grava Auditoria');
SELECT is((SELECT provolatile::text FROM pg_proc WHERE oid = 'public.member_descendants_among(uuid,uuid[])'::regprocedure), 's',
  'a RPC é STABLE');

SELECT * FROM finish();

ROLLBACK;
