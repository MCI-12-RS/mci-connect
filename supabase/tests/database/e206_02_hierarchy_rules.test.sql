-- E2.06 (PR 1): hierarquia e totais na mesma operação, RN-01 a RN-08 e DA-2.
-- Spec: docs/specs/e2-06-hierarquia-totais.md ("Massa de exemplo", "Critérios por regra",
-- "Verificações obrigatórias", "Formato dos erros").
-- Massa (dados fictícios): a do Negócio, com 23 pessoas e 11 células, montada como postgres com os
-- triggers ligados e as regras do E2.04. Cada critério roda num cenário que se desfaz
-- (pg_temp.scn): aplica as gravações pela API com a sessão de quem o critério cita, lê a tabela
-- inteira da hierarquia (23 pessoas: nível, cadeia, G12 e totais) e a member_hierarchy_drift(),
-- e só então o pgTAP compara. A drift vazia vem em toda comparação.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(40);

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
  (pg_temp.c(5),  pg_temp.m(9),  pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Sábado',  '20:00', false),
  (pg_temp.c(6),  pg_temp.m(17), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Quarta',  '20:00', true),
  (pg_temp.c(7),  pg_temp.m(19), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Quinta',  '20:00', true),
  (pg_temp.c(8),  pg_temp.m(12), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Terça',   '20:00', true),
  (pg_temp.c(9),  pg_temp.m(23), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Sexta',   '19:00', true),
  (pg_temp.c(10), pg_temp.m(10), pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Segunda', '20:00', true),
  (pg_temp.c(11), pg_temp.m(9),  pg_temp.m(14), pg_temp.m(14), 'Evangelística', 'Domingo', '18:00', true);
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

-- ===========================================================================
-- Massa: os valores da tabela do spec (RN-01, RN-04, RN-05 e RN-06 partem dela)
-- ===========================================================================
SELECT is((SELECT hv FROM base), '{"Samuel": {"l": 0, "d": 12, "c": 6, "m": 5, "f": 1, "g": null, "a": []}, "Magda": {"l": 0, "d": 6, "c": 2, "m": 0, "f": 2, "g": null, "a": []}, "Pedro": {"l": 1, "d": 3, "c": 3, "m": 3, "f": 0, "g": "Pedro", "a": ["Samuel"]}, "Paula": {"l": 1, "d": 1, "c": 1, "m": 0, "f": 1, "g": "Paula", "a": ["Magda"]}, "Tiago": {"l": 1, "d": 7, "c": 3, "m": 2, "f": 1, "g": "Tiago", "a": ["Samuel"]}, "Tânia": {"l": 1, "d": 3, "c": 1, "m": 0, "f": 1, "g": "Tânia", "a": ["Magda"]}, "André": {"l": 2, "d": 2, "c": 3, "m": 3, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro"]}, "Beatriz": {"l": 2, "d": 1, "c": 1, "m": 0, "f": 1, "g": "Tânia", "a": ["Magda", "Tânia"]}, "Carla": {"l": 2, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Paula", "a": ["Magda", "Paula"]}, "Rita": {"l": 2, "d": 0, "c": 0, "m": 0, "f": 0, "g": "Tânia", "a": ["Magda", "Tânia"]}, "Diego": {"l": 2, "d": 3, "c": 3, "m": 2, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago"]}, "Hugo": {"l": 2, "d": 2, "c": 0, "m": 0, "f": 0, "g": "Tiago", "a": ["Samuel", "Tiago"]}, "Caio": {"l": 3, "d": 0, "c": 0, "m": 0, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro", "André"]}, "Fábio": {"l": 3, "d": 1, "c": 2, "m": 2, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro", "André"]}, "Débora": {"l": 3, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Tânia", "a": ["Magda", "Tânia", "Beatriz"]}, "Lauro": {"l": 3, "d": 2, "c": 2, "m": 1, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago", "Diego"]}, "Vânia": {"l": 3, "d": 1, "c": 0, "m": 0, "f": 0, "g": "Tiago", "a": ["Samuel", "Tiago", "Hugo"]}, "Gabriel": {"l": 4, "d": 0, "c": 1, "m": 1, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro", "André", "Fábio"]}, "Olga": {"l": 4, "d": 1, "c": 1, "m": 0, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago", "Diego", "Lauro"]}, "Zélia": {"l": 4, "d": 0, "c": 0, "m": 0, "f": 0, "g": "Tiago", "a": ["Samuel", "Tiago", "Hugo", "Vânia"]}, "Sônia": {"l": 5, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago", "Diego", "Lauro", "Olga"]}, "Ester": {"l": null, "d": 1, "c": 1, "m": 0, "f": 1, "g": null, "a": []}, "Lúcia": {"l": 1, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Lúcia", "a": ["Ester"]}}'::jsonb,
  'Massa: nível, cadeia, G12 e totais de cada uma das 23 pessoas são os da tabela do spec');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift()), 0, 'Massa: member_hierarchy_drift() vazia depois de montar a massa');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy h JOIN public.members m ON m.id = h.member_id WHERE m.id::text LIKE 'c2060000%' AND m.id <= pg_temp.m(23)), 23, 'Massa: uma linha da hierarquia por membro');

-- ---------------------------------------------------------------------------
-- RN-01: o nível
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.hv('l', 'Samuel', 'Magda', 'Pedro', 'André', 'Caio', 'Gabriel', 'Sônia'),
  '{"Samuel":{"l":0},"Magda":{"l":0},"Pedro":{"l":1},"André":{"l":2},"Caio":{"l":3},"Gabriel":{"l":4},"Sônia":{"l":5}}'::jsonb,
  'RN-01: Samuel e Magda 0, Pedro 1, André 2, Caio 3, Gabriel 4 e Sônia 5');
SELECT is(pg_temp.hv('lg', 'Ester', 'Lúcia'), '{"Ester":{"l":null,"g":null},"Lúcia":{"l":1,"g":"Lúcia"}}'::jsonb,
  'RN-01: Ester, sem liderança, não tem nível nem G12; Lúcia, discípula dela, é do nível 1 e G12 de si mesma');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy h JOIN public.members m ON m.id = h.member_id WHERE h.g12_level = 0 AND m.id::text LIKE 'c2060000%' AND m.id <= pg_temp.m(23)), 2,
  'RN-01: só Samuel e Magda estão entre os Pastores (nível 0); Ester não');
SELECT is(pg_temp.hv('l', 'Fábio', 'Gabriel'), '{"Fábio":{"l":3},"Gabriel":{"l":4}}'::jsonb, 'RN-01: Fábio, inativo, continua no nível 3, e Gabriel no 4');
SELECT is(pg_temp.scn(14, ARRAY[$c$INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(101), 'Nivel6 Teste', 'F', true, pg_temp.mn('Sônia'), true, pg_temp.mob(101))$c$, $c$INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(102), 'Nivel7 Teste', 'F', true, pg_temp.m(101), true, pg_temp.mob(102))$c$],
  ARRAY['SELECT pg_temp.hv($$lg$$, $$Nivel6$$, $$Nivel7$$)'])->'q'->0,
  '{"Nivel6":{"l":6,"g":"Tiago"},"Nivel7":{"l":7,"g":"Tiago"}}'::jsonb,
  'RN-01: a discípula de Sônia fica no nível 6 e a dela no 7, sem limite');

-- ---------------------------------------------------------------------------
-- RN-03: trocar de líder muda a pessoa e a subárvore na mesma operação (e a RN-08, com a mesma gravação)
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago'), has_leadership = true WHERE id = pg_temp.mn('Fábio')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Fábio": {"l": 2, "a": ["Samuel", "Tiago"], "g": "Tiago"}, "Gabriel": {"l": 3, "a": ["Samuel", "Tiago", "Fábio"], "g": "Tiago"}, "André": {"d": 1, "c": 1, "m": 1, "f": 0}, "Pedro": {"d": 2, "c": 1, "m": 1, "f": 0}, "Tiago": {"d": 8, "c": 5, "m": 4, "f": 1}}'::jsonb),
  'RN-03 e RN-08: Rita define Tiago como líder de Fábio: Fábio no nível 2 e Gabriel no 3, os dois com G12 Tiago; André 1 / 1, Pedro 2 / 1, Tiago 8 / 5 (4/1), Samuel sem mudança');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Samuel'), has_leadership = true WHERE id = pg_temp.mn('André')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"André": {"l": 1, "a": ["Samuel"], "g": "André"}, "Caio": {"l": 2, "a": ["Samuel", "André"], "g": "André"}, "Fábio": {"l": 2, "a": ["Samuel", "André"], "g": "André"}, "Gabriel": {"l": 3, "a": ["Samuel", "André", "Fábio"], "g": "André"}, "Pedro": {"d": 0, "c": 0, "m": 0, "f": 0}}'::jsonb),
  'RN-03: Rita define Samuel como líder de André: André G12 (nível 1), Caio e Fábio no 2, Gabriel no 3; RN-04: a cadeia de Gabriel passa a Samuel, André e Fábio, e o G12 dele a André');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Paula'), has_leadership = true WHERE id = pg_temp.mn('Ester')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Ester": {"l": 2, "a": ["Magda", "Paula"], "g": "Paula"}, "Lúcia": {"l": 3, "a": ["Magda", "Paula", "Ester"], "g": "Paula"}, "Paula": {"d": 3, "c": 2, "m": 0, "f": 2}, "Magda": {"d": 8, "c": 3, "m": 0, "f": 3}}'::jsonb),
  'RN-03: Rita define Paula como líder de Ester: Ester no nível 2 (144) e Lúcia passa do 1 para o 3; Paula e Magda somam o pacote');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = NULL, has_leadership = false WHERE id = pg_temp.mn('André')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"André": {"l": null, "a": [], "g": null}, "Caio": {"l": 1, "a": ["André"], "g": "Caio"}, "Fábio": {"l": 1, "a": ["André"], "g": "Fábio"}, "Gabriel": {"l": 2, "a": ["André", "Fábio"], "g": "Fábio"}, "Pedro": {"d": 0, "c": 0, "m": 0, "f": 0}, "Samuel": {"d": 9, "c": 3, "m": 2, "f": 1}}'::jsonb),
  'RN-03 e P-HIE-02: Rita marca André como sem liderança: sem nível; Caio e Fábio passam ao nível 1 (G12) e Gabriel ao 2');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET is_pastor = true WHERE id = pg_temp.mn('Ester')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Ester": {"l": 0}}'::jsonb),
  'RN-03: Rita marca Ester como pastora: nível 0 (Pastora); Lúcia continua no nível 1');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago'), has_leadership = true WHERE id = pg_temp.mn('André')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"André": {"a": ["Samuel", "Tiago"], "g": "Tiago"}, "Caio": {"a": ["Samuel", "Tiago", "André"], "g": "Tiago"}, "Fábio": {"a": ["Samuel", "Tiago", "André"], "g": "Tiago"}, "Gabriel": {"a": ["Samuel", "Tiago", "André", "Fábio"], "g": "Tiago"}, "Pedro": {"d": 0, "c": 0, "m": 0, "f": 0}, "Tiago": {"d": 10, "c": 6, "m": 5, "f": 1}}'::jsonb),
  'RN-03: André passa de Pedro para Tiago (os dois no nível 1): nenhum nível muda, e o G12 de André, Caio, Fábio e Gabriel passa a Tiago');
SELECT is(pg_temp.scn(14, ARRAY[$c$SELECT public.delete_member(pg_temp.mn('Zélia'))$c$,$c$UPDATE public.members SET leader_id = pg_temp.mn('Diego'), has_leadership = true WHERE id = pg_temp.mn('Hugo')$c$,$c$SELECT * FROM public.restore_member(pg_temp.mn('Zélia'))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok", "ok", "ok"]'::jsonb, '{"Hugo": {"l": 3, "a": ["Samuel", "Tiago", "Diego"]}, "Vânia": {"l": 4, "a": ["Samuel", "Tiago", "Diego", "Hugo"]}, "Zélia": {"l": 5, "a": ["Samuel", "Tiago", "Diego", "Hugo", "Vânia"], "g": "Tiago"}, "Diego": {"d": 6}}'::jsonb),
  'RN-03 e E2.01: Zélia excluída, Hugo passa a ter Diego como líder e Zélia é restaurada: Hugo no nível 3, Vânia no 4 e Zélia volta no 5, com o G12 Tiago');

-- ---------------------------------------------------------------------------
-- RN-04: a cadeia e o G12
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.hv('ag','Gabriel','Pedro','Samuel','Ester','Lúcia'),
 '{"Gabriel":{"a":["Samuel","Pedro","André","Fábio"],"g":"Pedro"},"Pedro":{"a":["Samuel"],"g":"Pedro"},"Samuel":{"a":[],"g":null},"Ester":{"a":[],"g":null},"Lúcia":{"a":["Ester"],"g":"Lúcia"}}'::jsonb,
 'RN-04: a cadeia de Gabriel é Samuel, Pedro, André e Fábio (G12 Pedro); a de Pedro é Samuel (G12 ele mesmo); Samuel e Ester não têm cadeia nem G12; a de Lúcia é Ester (G12 ela mesma)');
SELECT is((SELECT array_agg(column_name::text ORDER BY column_name) FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'members_view' AND column_name ~ '(^|_)(tree|path|chain)(_|$)'), NULL,
  'RN-04: nenhuma coluna da members_view traz o caminho em texto (a tela compõe só G12 e líder direto)');

-- ---------------------------------------------------------------------------
-- RN-05: total de discípulos
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.hv('d','André','Fábio','Samuel','Magda','Ester'), '{"André":{"d":2},"Fábio":{"d":1},"Samuel":{"d":12},"Magda":{"d":6},"Ester":{"d":1}}'::jsonb,
  'RN-05: André 2 (Caio e Gabriel; Fábio, inativo, não conta, mas o discípulo dele sim), Fábio 1, Samuel 12, Magda 6 e Ester 1');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET is_active = false WHERE id = pg_temp.mn('Gabriel')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Fábio": {"d": 0}, "André": {"d": 1}, "Pedro": {"d": 2}, "Samuel": {"d": 11}}'::jsonb),
  'RN-05: Gabriel fica inativo: Fábio 0, André 1, Pedro 2, Samuel 11; os totais de células e o nível de Gabriel não mudam');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET is_active = true WHERE id = pg_temp.mn('Fábio')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"André": {"d": 3}, "Pedro": {"d": 4}, "Samuel": {"d": 13}}'::jsonb),
  'RN-05: Fábio volta a ficar ativo: André 3, Pedro 4, Samuel 13; o total de Fábio continua 1');
SELECT is(pg_temp.scn(14, ARRAY[$c$SELECT public.delete_member(pg_temp.mn('Zélia'))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Vânia": {"d": 0}, "Hugo": {"d": 1}, "Tiago": {"d": 6}, "Samuel": {"d": 11}}'::jsonb),
  'RN-05 e E2.01: Zélia é excluída: Vânia 0, Hugo 1, Tiago 6 e Samuel 11');
SELECT is(pg_temp.scn(14, ARRAY[$c$SELECT public.delete_member(pg_temp.mn('Zélia'))$c$,$c$SELECT * FROM public.restore_member(pg_temp.mn('Zélia'))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok", "ok"]'::jsonb, '{}'::jsonb),
  'RN-05 e E2.01: excluída e restaurada, Vânia, Hugo, Tiago e Samuel voltam a 1, 2, 7 e 12 (a tabela da massa inteira)');
SELECT is(pg_temp.scn(14, ARRAY[$c$INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(103), 'Novo Teste', 'F', true, pg_temp.mn('Caio'), true, pg_temp.mob(103))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)',$q$SELECT pg_temp.hv($$lg$$, $$Novo$$)$q$]),
  pg_temp.want('["ok"]'::jsonb, '{"Caio": {"d": 1}, "André": {"d": 3}, "Pedro": {"d": 4}, "Samuel": {"d": 13}}'::jsonb, '{"Novo":{"l":4,"g":"Pedro"}}'::jsonb),
  'RN-05: alguém cadastra um membro ativo com o líder Caio: Caio 1, André 3, Pedro 4, Samuel 13; o novo fica no nível 4, G12 Pedro');
SELECT is(pg_temp.scn(14, ARRAY[$c$INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(103), 'Novo Teste', 'F', true, pg_temp.mn('Caio'), false, pg_temp.mob(103))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{}'::jsonb),
  'RN-05: o membro cadastrado com o líder Caio é inativo: nenhum total de discípulos muda');

-- ---------------------------------------------------------------------------
-- RN-06: total de células
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.hv('cmf','André','Caio','Carla'), '{"André":{"c":3,"m":3,"f":0},"Caio":{"c":0,"m":0,"f":0},"Carla":{"c":1,"m":0,"f":1}}'::jsonb,
  'RN-06: André 3 (C1, a C10 de Fábio, inativo, e a C4 de Gabriel); a C5 (inativa) e a C11 (excluída) não contam; Caio, timóteo da C1, 0; Carla, anfitriã da C1, só a própria C8');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(1)$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"André": {"c": 2, "m": 2}, "Pedro": {"c": 2, "m": 2}, "Samuel": {"c": 5, "m": 4, "f": 1}}'::jsonb),
  'RN-06: a C1 fica inativa: André 2, Pedro 2 e Samuel 5 (4/1)');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.cells SET is_active = true WHERE id = pg_temp.c(5)$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Caio": {"c": 1, "m": 1}, "André": {"c": 4, "m": 4}, "Pedro": {"c": 4, "m": 4}, "Samuel": {"c": 7, "m": 6, "f": 1}}'::jsonb),
  'RN-06: a C5 volta a ficar ativa: Caio 1, André 4, Pedro 4 e Samuel 7 (6/1)');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.cells SET leader_id = pg_temp.mn('Caio') WHERE id = pg_temp.c(8)$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Carla": {"c": 0, "f": 0}, "Paula": {"c": 0, "f": 0}, "Magda": {"c": 1, "m": 0, "f": 1}, "Caio": {"c": 1, "m": 1, "f": 0}, "André": {"c": 4, "m": 4}, "Pedro": {"c": 4, "m": 4}, "Samuel": {"c": 7, "m": 6, "f": 1}}'::jsonb),
  'RN-06: a C8 passa a ter Caio como líder: Carla e Paula 0, Magda 1 (0/1), Caio 1 (1/0), André e Pedro 4 (4/0) e Samuel 7 (6/1)');
SELECT is(pg_temp.scn(14, ARRAY[$c$SELECT public.delete_cell(pg_temp.c(1))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"André": {"c": 2, "m": 2}, "Pedro": {"c": 2, "m": 2}, "Samuel": {"c": 5, "m": 4, "f": 1}}'::jsonb),
  'RN-06 e E2.01: a C1 excluída sai dos totais como a inativa (André 2, Pedro 2, Samuel 5); restaurada, tudo volta à tabela da massa');
SELECT is(pg_temp.scn(14, ARRAY[$c$SELECT public.delete_cell(pg_temp.c(1))$c$,$c$SELECT public.restore_cell(pg_temp.c(1))$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok", "ok"]'::jsonb, '{}'::jsonb),
  'RN-06 e E2.01: a C1 excluída e restaurada: a tabela da massa inteira');
SELECT is(pg_temp.scn(NULL, ARRAY[$c$ALTER TABLE public.members DROP CONSTRAINT members_gender_check; ALTER TABLE public.members ALTER COLUMN gender DROP NOT NULL; SET LOCAL session_replication_role = replica; INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(104), 'SemSexo Teste', NULL, true, pg_temp.mn('Caio'), true, pg_temp.mob(104)); SET LOCAL session_replication_role = origin; SELECT private.rebuild_member_hierarchy()$c$,
    $c$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (pg_temp.c(104), pg_temp.m(104), pg_temp.mn('Rita'), pg_temp.mn('Rita'), 'Evangelística', 'Quarta', '20:00')$c$],
  ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)', 'SELECT pg_temp.hv($$cmf$$, $$SemSexo$$)']),
  pg_temp.want('["ok","ok"]'::jsonb, '{"Caio":{"d":1,"c":1,"m":0,"f":0},"André":{"d":3,"c":4,"m":3,"f":0},"Pedro":{"d":4,"c":4,"m":3,"f":0},"Samuel":{"d":13,"c":7,"m":5,"f":1}}'::jsonb,
    '{"SemSexo":{"c":1,"m":0,"f":0}}'::jsonb),
  'RN-06: a célula de um cadastro antigo sem sexo registrado, discípulo de Caio, conta no total dele, de Caio, de André, de Pedro e de Samuel, e em nenhuma das duas divisões (o sexo é obrigatório desde o E2.04: o cenário relaxa essa regra, e o ROLLBACK do cenário a devolve, só para exercitar o caminho do cadastro antigo)');

-- ---------------------------------------------------------------------------
-- RN-07: o que dispara o recálculo e o que não dispara
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.scn(14, ARRAY[$c$INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (pg_temp.c(105), pg_temp.mn('Sônia'), pg_temp.mn('Rita'), pg_temp.mn('Rita'), 'Evangelística', 'Quarta', '20:00')$c$],
  ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Sônia":{"c":2,"m":0,"f":2},"Olga":{"c":2,"m":0,"f":2},"Lauro":{"c":3,"m":1,"f":2},"Diego":{"c":4,"m":2,"f":2},"Tiago":{"c":4,"m":2,"f":2},"Samuel":{"c":7,"m":5,"f":2}}'::jsonb),
  'RN-07: Sônia (nível 5) passa a liderar uma célula nova: o total de 6 pessoas aumenta 1 na mesma operação (Sônia 2, Olga 2, Lauro 3, Diego 4, Tiago 4, Samuel 7)');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET gender = 'F' WHERE id = pg_temp.mn('Gabriel')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok"]'::jsonb, '{"Gabriel": {"c": 1, "m": 0, "f": 1}, "Fábio": {"c": 2, "m": 1, "f": 1}, "André": {"c": 3, "m": 2, "f": 1}, "Pedro": {"c": 3, "m": 2, "f": 1}, "Samuel": {"c": 6, "m": 4, "f": 2}}'::jsonb),
  'RN-07: Rita corrige o sexo de Gabriel de masculino para feminino: a C4 passa a feminina (Gabriel 1 (0/1), Fábio 2 (1/1), André e Pedro 3 (2/1), Samuel 6 (4/2)); os totais de discípulos não mudam');
SELECT is(pg_temp.scn(14, ARRAY[
    $c$UPDATE public.cells SET timothy_id = pg_temp.mn('Rita'), host_id = pg_temp.mn('Rita'), meeting_day = 'Sexta', type = 'Discipulado' WHERE id = pg_temp.c(1)$c$,
    $c$UPDATE public.members SET name = 'André Renomeado Teste' WHERE id = pg_temp.mn('André')$c$,
    $c$UPDATE public.members SET spouse_id = NULL WHERE id = pg_temp.mn('André')$c$],
  ARRAY['SELECT pg_temp.snap()']),
  jsonb_build_object('codes', '["ok","ok","ok"]'::jsonb, 'drift', '[]'::jsonb, 'q', jsonb_build_array((SELECT snap FROM base))),
  'RN-07: trocar o timóteo, o anfitrião, o dia ou o tipo da C1, ou o nome ou o cônjuge de André não muda nenhum total (nem nível, cadeia ou G12)');

-- ---------------------------------------------------------------------------
-- RN-08: falha desfaz tudo; gravações simultâneas na mesma ordem final; DA-2
-- ---------------------------------------------------------------------------
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago'), has_leadership = true WHERE id = pg_temp.mn('Fábio')$c$,$c$UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(4)$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok", "ok"]'::jsonb, '{"Tiago": {"d": 8, "c": 4, "m": 3, "f": 1}, "Fábio": {"l": 2, "a": ["Samuel", "Tiago"], "g": "Tiago", "d": 1, "c": 1, "m": 1, "f": 0}, "Gabriel": {"l": 3, "a": ["Samuel", "Tiago", "Fábio"], "g": "Tiago", "c": 0, "m": 0, "f": 0}, "André": {"d": 1, "c": 1, "m": 1, "f": 0}, "Pedro": {"d": 2, "c": 1, "m": 1, "f": 0}, "Samuel": {"d": 12, "c": 5, "m": 4, "f": 1}}'::jsonb),
  'RN-08: a troca do líder de Fábio para Tiago e a inativação da C4 (nesta ordem): as duas valem, Tiago 8 / 4 (3/1), Fábio 1 / 1, Samuel 12 / 5, e tudo igual ao recálculo do zero');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(4)$c$,$c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago'), has_leadership = true WHERE id = pg_temp.mn('Fábio')$c$], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["ok", "ok"]'::jsonb, '{"Tiago": {"d": 8, "c": 4, "m": 3, "f": 1}, "Fábio": {"l": 2, "a": ["Samuel", "Tiago"], "g": "Tiago", "d": 1, "c": 1, "m": 1, "f": 0}, "Gabriel": {"l": 3, "a": ["Samuel", "Tiago", "Fábio"], "g": "Tiago", "c": 0, "m": 0, "f": 0}, "André": {"d": 1, "c": 1, "m": 1, "f": 0}, "Pedro": {"d": 2, "c": 1, "m": 1, "f": 0}, "Samuel": {"d": 12, "c": 5, "m": 4, "f": 1}}'::jsonb),
  'RN-08: as mesmas duas gravações na ordem inversa dão o mesmo resultado');
SELECT is(pg_temp.scn(14, ARRAY[
    $c$pg:DELETE FROM private.member_hierarchy WHERE member_id = pg_temp.mn('Pedro')$c$,
    $c$UPDATE public.members SET leader_id = pg_temp.mn('Tiago') WHERE id = pg_temp.mn('Fábio')$c$],
  ARRAY['SELECT jsonb_build_array((SELECT name FROM public.members WHERE id = (SELECT leader_id FROM public.members WHERE id = pg_temp.mn($$Fábio$$))))',
        'SELECT pg_temp.hv($$ldcmfga$$, $$Fábio$$, $$Gabriel$$, $$André$$, $$Tiago$$, $$Samuel$$)']),
  jsonb_build_object('codes', '["ok","hierarchy_update_failed:missing_row"]'::jsonb,
    'q', jsonb_build_array('["André Teste"]'::jsonb, (SELECT jsonb_object_agg(k, v) FROM jsonb_each((SELECT hv FROM base)) e(k, v) WHERE k IN ('Fábio','Gabriel','André','Tiago','Samuel'))),
    'drift', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mn('Pedro'), 'problem', 'missing_row', 'stored', NULL, 'expected', NULL))),
  'RN-08: a falha simulada (a linha de um ancestral some) desfaz a gravação inteira: Fábio continua com o líder André, nenhum nível, G12 ou total muda, e o erro é hierarchy_update_failed (missing_row)');
SELECT is(pg_temp.scn(14, ARRAY[
    $c$pg:UPDATE private.member_hierarchy SET total_disciples = 0 WHERE member_id = pg_temp.mn('Samuel')$c$,
    $c$UPDATE public.members SET is_active = false WHERE id = pg_temp.mn('Caio')$c$],
  ARRAY['SELECT jsonb_build_array((SELECT is_active FROM public.members WHERE id = pg_temp.mn($$Caio$$)))']),
  jsonb_build_object('codes', '["ok","hierarchy_update_failed:negative_total"]'::jsonb, 'q', jsonb_build_array('[true]'::jsonb),
    'drift', jsonb_build_array(jsonb_build_object('member_id', pg_temp.mn('Samuel'), 'problem', 'value_mismatch',
       'stored', (SELECT to_jsonb(h) - 'member_id' - 'g12_id' FROM private.member_hierarchy h WHERE h.member_id = pg_temp.mn('Samuel')) || '{"total_disciples":0}',
       'expected', (SELECT to_jsonb(h) - 'member_id' - 'g12_id' FROM private.member_hierarchy h WHERE h.member_id = pg_temp.mn('Samuel'))))),
  'RN-08: um total que ficaria negativo desfaz a gravação (Caio continua ativo) e dá hierarchy_update_failed (negative_total)');
SELECT is(pg_temp.scn(14, ARRAY[$c$UPDATE public.members SET leader_id = pg_temp.mn('Gabriel') WHERE id = pg_temp.mn('Pedro')$c$],
  ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  pg_temp.want('["leader_cycle"]'::jsonb, '{}'::jsonb),
  'DA-2: a troca que fecharia um ciclo (Pedro sob o próprio discípulo Gabriel) dá leader_cycle e nada muda');
SELECT is(pg_temp.scn(14, ARRAY[
    $c$pg:SET LOCAL session_replication_role = replica; INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES (pg_temp.m(106), 'CicloX Teste', 'M', true, pg_temp.m(107), true, pg_temp.mob(106)), (pg_temp.m(107), 'CicloY Teste', 'F', true, pg_temp.m(106), true, pg_temp.mob(107)); SET LOCAL session_replication_role = origin; INSERT INTO private.member_hierarchy (member_id) VALUES (pg_temp.m(106)), (pg_temp.m(107))$c$,
    $c$UPDATE public.members SET leader_id = pg_temp.m(106) WHERE id = pg_temp.mn('Caio')$c$],
  ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)']),
  jsonb_build_object('codes', '["ok","hierarchy_update_failed:no_top"]'::jsonb, 'q', jsonb_build_array((SELECT hv FROM base)),
    'drift', '[]'::jsonb),
  'DA-2: a troca para debaixo de quem não tem topo (um ciclo que só existe por carga) dá hierarchy_update_failed (no_top) e nada muda');

SELECT * FROM finish();

ROLLBACK;
