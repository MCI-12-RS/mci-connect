-- E2.06 (PR 1): carga com os triggers desligados e o recálculo do zero (RN-13), drift, problemas e a guarda
-- da migration 1 (DA-2).
-- Spec: docs/specs/e2-06-hierarquia-totais.md ("Carga e conferência (RN-13)", "Verificações obrigatórias", DA-2).
-- Massa (dados fictícios): a do Negócio (23 pessoas, 11 células), carregada com session_replication_role = replica,
-- como na carga do legado: nenhum trigger roda, então a tabela da hierarquia começa vazia.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(18);

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

SET LOCAL session_replication_role = replica;
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

SET LOCAL session_replication_role = origin;

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
-- Antes do recálculo: a carga em replica não criou nenhuma linha
-- ===========================================================================
SELECT is((SELECT count(*)::int FROM private.member_hierarchy WHERE member_id::text LIKE 'c2060000%'), 0,
  'RN-13: a carga com os triggers desligados não deixou nenhuma linha da hierarquia');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift() WHERE member_id::text LIKE 'c2060000%' AND problem = 'missing_row'), 23,
  'RN-13: antes do recálculo, member_hierarchy_drift() lista todos os 23 membros da carga (missing_row)');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift() WHERE member_id::text LIKE 'c2060000%' AND problem <> 'missing_row'), 0,
  'RN-13: e só como missing_row');
SELECT is(pg_temp.scn(NULL, ARRAY['SELECT private.rebuild_member_hierarchy()'], ARRAY['SELECT to_jsonb(count(*)) FROM private.member_hierarchy_drift()'])->'q'->0, '0'::jsonb,
  'RN-13: depois do recálculo, a drift está vazia');
SELECT is(pg_temp.scn(NULL, ARRAY['SELECT private.rebuild_member_hierarchy()'], ARRAY['SELECT pg_temp.allhv($$ldcmfga$$)'])->'q'->0, '{"Samuel": {"l": 0, "d": 12, "c": 6, "m": 5, "f": 1, "g": null, "a": []}, "Magda": {"l": 0, "d": 6, "c": 2, "m": 0, "f": 2, "g": null, "a": []}, "Pedro": {"l": 1, "d": 3, "c": 3, "m": 3, "f": 0, "g": "Pedro", "a": ["Samuel"]}, "Paula": {"l": 1, "d": 1, "c": 1, "m": 0, "f": 1, "g": "Paula", "a": ["Magda"]}, "Tiago": {"l": 1, "d": 7, "c": 3, "m": 2, "f": 1, "g": "Tiago", "a": ["Samuel"]}, "Tânia": {"l": 1, "d": 3, "c": 1, "m": 0, "f": 1, "g": "Tânia", "a": ["Magda"]}, "André": {"l": 2, "d": 2, "c": 3, "m": 3, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro"]}, "Beatriz": {"l": 2, "d": 1, "c": 1, "m": 0, "f": 1, "g": "Tânia", "a": ["Magda", "Tânia"]}, "Carla": {"l": 2, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Paula", "a": ["Magda", "Paula"]}, "Rita": {"l": 2, "d": 0, "c": 0, "m": 0, "f": 0, "g": "Tânia", "a": ["Magda", "Tânia"]}, "Diego": {"l": 2, "d": 3, "c": 3, "m": 2, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago"]}, "Hugo": {"l": 2, "d": 2, "c": 0, "m": 0, "f": 0, "g": "Tiago", "a": ["Samuel", "Tiago"]}, "Caio": {"l": 3, "d": 0, "c": 0, "m": 0, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro", "André"]}, "Fábio": {"l": 3, "d": 1, "c": 2, "m": 2, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro", "André"]}, "Débora": {"l": 3, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Tânia", "a": ["Magda", "Tânia", "Beatriz"]}, "Lauro": {"l": 3, "d": 2, "c": 2, "m": 1, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago", "Diego"]}, "Vânia": {"l": 3, "d": 1, "c": 0, "m": 0, "f": 0, "g": "Tiago", "a": ["Samuel", "Tiago", "Hugo"]}, "Gabriel": {"l": 4, "d": 0, "c": 1, "m": 1, "f": 0, "g": "Pedro", "a": ["Samuel", "Pedro", "André", "Fábio"]}, "Olga": {"l": 4, "d": 1, "c": 1, "m": 0, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago", "Diego", "Lauro"]}, "Zélia": {"l": 4, "d": 0, "c": 0, "m": 0, "f": 0, "g": "Tiago", "a": ["Samuel", "Tiago", "Hugo", "Vânia"]}, "Sônia": {"l": 5, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Tiago", "a": ["Samuel", "Tiago", "Diego", "Lauro", "Olga"]}, "Ester": {"l": null, "d": 1, "c": 1, "m": 0, "f": 1, "g": null, "a": []}, "Lúcia": {"l": 1, "d": 0, "c": 1, "m": 0, "f": 1, "g": "Lúcia", "a": ["Ester"]}}'::jsonb,
  'RN-13: depois do recálculo, todos os valores são os da tabela da massa (nível, cadeia, G12 e totais)');
SELECT ok((SELECT r > 0 FROM (SELECT private.rebuild_member_hierarchy() AS r) x), 'RN-13: o recálculo devolve quantas linhas criou ou mudou');
SELECT is((SELECT count(*)::int FROM private.member_hierarchy_drift()), 0, 'RN-13: a drift está vazia depois do recálculo (este é o estado das verificações abaixo)');
SELECT is(private.rebuild_member_hierarchy(), 0, 'RN-13: rodar o recálculo de novo não muda nada (idempotente)');
SELECT ok((SELECT sum(male_cells) > 0 AND sum(female_cells) > 0 FROM private.member_hierarchy WHERE member_id::text LIKE 'c2060000%'),
  'RN-13: as células masculinas e femininas não ficam todas zeradas');
SELECT is((SELECT jsonb_object_agg(split_part(m.name, ' ', 1), power(12, h.g12_level)::int) FROM private.member_hierarchy h JOIN public.members m ON m.id = h.member_id
            WHERE m.name IN ('Samuel Teste', 'André Teste', 'Caio Teste', 'Gabriel Teste')),
  '{"Samuel": 1, "André": 144, "Caio": 1728, "Gabriel": 20736}'::jsonb,
  'RN-13: MinistryLevel = 12 elevado ao nível (1 para os pastores, 144, 1.728, 20.736): o membro de 1728 no legado fica no nível 3');
SELECT is((SELECT jsonb_build_array(g12_level, cardinality(ancestor_ids)) FROM private.member_hierarchy WHERE member_id = pg_temp.mn('Ester')), '[null, 0]'::jsonb,
  'RN-13: "Não tem liderança" no legado: sem liderança e sem nível no novo (Ester)');
SELECT is((SELECT jsonb_agg(jsonb_build_array(problem, split_part(m.name, ' ', 1)) ORDER BY problem, m.name)
             FROM private.member_hierarchy_problems() p JOIN public.members m ON m.id = p.member_id WHERE m.id::text LIKE 'c2060000%'),
  '[["no_leadership_with_disciples", "Ester"]]'::jsonb,
  'RN-13: sem líder, sem ser pastor e com discípulos aparece na lista de diferenças esperadas (Ester); Samuel e Magda, pastores, não');
-- Falha do recálculo e recuperação: um total errado aparece na drift e o recálculo corrige.
SELECT is(pg_temp.scn(NULL, ARRAY['UPDATE private.member_hierarchy SET total_disciples = 40 WHERE member_id = pg_temp.mn(''André'')'],
    ARRAY['SELECT (SELECT jsonb_agg(problem) FROM private.member_hierarchy_drift())', 'SELECT to_jsonb(private.rebuild_member_hierarchy())',
          'SELECT (SELECT to_jsonb(count(*)) FROM private.member_hierarchy_drift())'])->'q',
  '[["value_mismatch"], 1, 0]'::jsonb, 'RN-13: um valor fora do recálculo vira value_mismatch na drift, e o recálculo corrige só essa linha');
SELECT is(pg_temp.scn(NULL, ARRAY['UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.mn(''Rita'') WHERE id = pg_temp.mn(''Zélia'')'],
    ARRAY['SELECT (SELECT jsonb_agg(problem) FROM private.member_hierarchy_drift())', 'SELECT to_jsonb(private.rebuild_member_hierarchy())',
          'SELECT (SELECT to_jsonb(count(*)) FROM private.member_hierarchy_drift())'])->'q',
  '[null, 0, 0]'::jsonb,
  'RN-13: um excluído sem totais (Zélia, folha) não gera drift, e os ancestrais já descontaram (Vânia, Hugo, Tiago, Samuel) — a exclusão direta como postgres também é tratada pelo trigger');
SELECT is(pg_temp.scn(NULL, ARRAY[$c$UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.mn('Rita') WHERE id = pg_temp.mn('Rita')$c$,
      $c$UPDATE private.member_hierarchy SET total_disciples = 3 WHERE member_id = pg_temp.mn('Rita')$c$],
    ARRAY['SELECT (SELECT jsonb_agg(jsonb_build_array(problem, split_part(m.name, '' '', 1))) FROM private.member_hierarchy_drift() d JOIN public.members m ON m.id = d.member_id)'])->'q',
  '[[["deleted_with_totals", "Rita"]]]'::jsonb,
  'RN-13: um excluído com total aparece na drift como deleted_with_totals (os excluídos ficam com a cadeia e o nível congelados, mas sem totais)');
SELECT is(pg_temp.scn(NULL, ARRAY[
    $c$SET LOCAL session_replication_role = replica; INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES
        (pg_temp.m(106), 'CicloX Teste', 'M', true, pg_temp.m(107), true, pg_temp.mob(106)),
        (pg_temp.m(107), 'CicloY Teste', 'F', true, pg_temp.m(106), true, pg_temp.mob(107)),
        (pg_temp.m(108), 'Apagado Teste', 'M', true, pg_temp.mn('Pedro'), true, pg_temp.mob(108)),
        (pg_temp.m(109), 'Orfao Teste', 'F', true, pg_temp.m(108), true, pg_temp.mob(109));
      UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.mn('Rita') WHERE id = pg_temp.m(108);
      INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES (pg_temp.c(108), pg_temp.m(108), pg_temp.mn('Rita'), pg_temp.mn('Rita'), 'Evangelística', 'Quarta', '20:00');
      SET LOCAL session_replication_role = origin$c$],
  ARRAY['SELECT (SELECT jsonb_agg(jsonb_build_array(p.problem, split_part(m.name, '' '', 1)) ORDER BY p.problem, m.name) FROM private.member_hierarchy_problems() p JOIN public.members m ON m.id = p.member_id WHERE m.id::text LIKE ''c2060000%'')',
        'SELECT to_jsonb(private.rebuild_member_hierarchy() > 0)',
        'SELECT (SELECT to_jsonb(count(*)) FROM private.member_hierarchy_drift())',
        'SELECT pg_temp.hv($$ladg$$, $$CicloX$$, $$CicloY$$, $$Orfao$$, $$Apagado$$)'])->'q',
  '[[["cell_leader_deleted", "Apagado"], ["no_leadership_with_disciples", "Ester"], ["no_top", "CicloX"], ["no_top", "CicloY"], ["no_top", "Orfao"]], true, 0,
    {"CicloX": {"l": null, "a": [], "g": null, "d": 0}, "CicloY": {"l": null, "a": [], "g": null, "d": 0}, "Orfao": {"l": null, "a": [], "g": null, "d": 0}, "Apagado": {"l": null, "a": [], "g": null, "d": 0}}]'::jsonb,
  'RN-13: com um ciclo e com um líder excluído na massa, member_hierarchy_problems() lista o ciclo (no_top), o órfão do excluído (no_top), a célula do excluído (cell_leader_deleted) e Ester; o recálculo roda e a drift fica vazia');
-- A guarda dos dados sem topo (DA-2), com o texto da migration 1: na massa limpa passa, com um ciclo ou com um
-- vivo de líder excluído falha só com ids (e, rodando antes de qualquer mudança, não deixa nada para trás).
CREATE FUNCTION pg_temp.guard() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE
  _ids uuid[];
BEGIN
  WITH RECURSIVE live AS (
    SELECT id, leader_id FROM public.members WHERE deleted_at IS NULL
  ),
  tree AS (
    SELECT id FROM live WHERE leader_id IS NULL
    UNION ALL
    SELECT l.id FROM tree t JOIN live l ON l.leader_id = t.id
  )
  SELECT array_agg(l.id ORDER BY l.id) INTO _ids
    FROM live l
   WHERE NOT EXISTS (SELECT 1 FROM tree t WHERE t.id = l.id);
  IF _ids IS NOT NULL THEN
    RETURN 'E2.06: membros sem topo (ciclo ou líder excluído): ' || _ids::text;
  END IF;
  RETURN 'ok';
END $f$;
SELECT is(pg_temp.guard(), 'ok', 'DA-2: na massa limpa a guarda da migration 1 passa');
SELECT is(pg_temp.scn(NULL, ARRAY[
    $c$SET LOCAL session_replication_role = replica; INSERT INTO public.members (id, name, gender, has_leadership, leader_id, is_active, mobile_whatsapp) VALUES
        (pg_temp.m(106), 'CicloX Teste', 'M', true, pg_temp.m(107), true, pg_temp.mob(106)),
        (pg_temp.m(107), 'CicloY Teste', 'F', true, pg_temp.m(106), true, pg_temp.mob(107)),
        (pg_temp.m(108), 'Apagado Teste', 'M', true, pg_temp.mn('Pedro'), true, pg_temp.mob(108)),
        (pg_temp.m(109), 'Orfao Teste', 'F', true, pg_temp.m(108), true, pg_temp.mob(109));
      UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.mn('Rita') WHERE id = pg_temp.m(108);
      SET LOCAL session_replication_role = origin$c$],
  ARRAY['SELECT to_jsonb(pg_temp.guard())'])->'q'->0,
  to_jsonb('E2.06: membros sem topo (ciclo ou líder excluído): ' || ARRAY[pg_temp.m(106), pg_temp.m(107), pg_temp.m(109)]::text),
  'DA-2: com um ciclo (X e Y) e um vivo de líder excluído (Órfão), a guarda falha e traz só os ids dos três');

SELECT * FROM finish();

ROLLBACK;
