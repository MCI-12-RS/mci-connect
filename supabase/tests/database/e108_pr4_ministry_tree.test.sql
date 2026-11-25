-- E1.08 (PR 4): ministry_tree_nodes, a árvore de ministérios calculada no banco.
-- Spec: docs/specs/e1-08-paginacao-servidor.md (repositório apps-mci).
--
-- Cobre:
--   - RN-10 (árvore sem N+1): um nível por chamada, já com as contagens; cada
--     nó é um casal, com o homem primeiro; só membros ativos, inclusive o
--     cônjuge exibido; a contagem do nó é o número de discípulos diretos
--     ativos e visíveis do casal; as raízes são os pastores ativos visíveis;
--   - a regra do integrante principal (o homem; empatado, o candidato;
--     empatado de novo, o menor nome e id), independente da ordem dos ids;
--   - totais do casal, inclusive quando um lidera o outro diretamente;
--   - o parâmetro: NULL, vazio, nulos e repetidos, limite de 100 ids;
--   - RN-05 (escopo inalterado): por persona, cada nível devolvido é
--     exatamente o que a mesma pessoa lê em members sob o RLS atual;
--   - RN-02 (nada é cortado): um nó com mais de 1000 discípulos diretos;
--   - contrato, grants e propriedades da função.
--
-- Fora daqui (limite documentado na migration): um aninhamento indireto dos
-- cônjuges (um abaixo de um discípulo do outro) ainda soma os totais em dobro.
--
-- Autocontido: cria a própria massa (dados fictícios) e termina com ROLLBACK.
-- Os números absolutos usam chamadas com ids da massa (os filhos de um nó da
-- massa são só da massa) ou filtram as raízes pelos ids da massa; a paridade
-- percorre a árvore inteira que cada persona vê, então o teste passa também
-- num banco que já tenha dados.
-- Rodar com: npx supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(115);

-- ---------------------------------------------------------------------------
-- Ids fixos da massa: a(uth), b (roles), c (membros).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a1084000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.role(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('b1084000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c1084000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;

CREATE FUNCTION pg_temp.ms(VARIADIC _n int[]) RETURNS uuid[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(pg_temp.m(x) ORDER BY x), '{}') FROM unnest(_n) x $$;

-- Entra como o usuário do Auth número _n (a role é trocada fora, com SET LOCAL ROLE).
CREATE FUNCTION pg_temp.login(_n int) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims',
    json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
$$;

-- Todos os ids devolvidos num nível (principais e cônjuges).
CREATE FUNCTION pg_temp.ids(_parents uuid[]) RETURNS SETOF uuid LANGUAGE sql AS $$
  SELECT v.id
    FROM public.ministry_tree_nodes(_parents) t
   CROSS JOIN LATERAL (VALUES (t.member_id), (t.spouse_id)) v(id)
   WHERE v.id IS NOT NULL
$$;

-- RN-05 e RN-10: percorre a árvore que quem está logado vê, a partir de cada
-- ponto de partida ('raízes' ou um uuid[] em texto), abrindo todo nó com
-- discípulos diretos. Em cada nível, compara com o que a mesma pessoa lê em
-- members sob o RLS atual (sem as views nem as funções da migration):
--   1. os ids devolvidos = os ativos do nível (pastores, ou liderados pelos
--      nós informados menos os próprios nós) + os cônjuges ativos e visíveis
--      deles, fora dos nós informados;
--   2. nenhum id devolvido é invisível;
--   3. direct_disciples = os ativos liderados pelo principal ou pelo cônjuge,
--      menos os dois;
--   4. direct_disciples > 0: abrir o nó traz exatamente esses discípulos.
-- Devolve 5 verificações (a 5ª: quantos níveis foram abertos, no mínimo).
CREATE FUNCTION pg_temp.tree_parity(_who text, _starts text[], _min_levels int, _roots uuid[] DEFAULT NULL)
RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  _queue text[] := _starts;
  _seen text[] := _starts;
  _i int := 1;
  _key text;
  _parents uuid[];
  _pair uuid[];
  _pair_key text;
  _got uuid[];
  _exp uuid[];
  _hidden uuid[];
  _count bigint;
  n record;
  _bad_ids text[] := '{}';
  _bad_hidden text[] := '{}';
  _bad_direct text[] := '{}';
  _bad_expand text[] := '{}';
BEGIN
  WHILE _i <= cardinality(_queue) AND _i <= 5000 LOOP
    _key := _queue[_i];
    _i := _i + 1;
    _parents := CASE WHEN _key = 'raízes' THEN NULL ELSE _key::uuid[] END;

    SELECT coalesce(array_agg(DISTINCT g ORDER BY g), '{}') INTO _got FROM pg_temp.ids(_parents) g;

    SELECT coalesce(array_agg(DISTINCT e.id ORDER BY e.id), '{}') INTO _exp
      FROM (
        SELECT c.id
          FROM public.members c
         WHERE c.is_active
           AND CASE WHEN _parents IS NULL THEN (CASE WHEN _roots IS NULL THEN c.is_pastor ELSE c.id = ANY (_roots) END)
                    ELSE c.leader_id = ANY (_parents) AND c.id <> ALL (_parents) END
        UNION
        SELECT s.id
          FROM public.members c
          JOIN public.members s ON s.id = c.spouse_id
         WHERE c.is_active
           AND s.is_active
           AND CASE WHEN _parents IS NULL THEN (CASE WHEN _roots IS NULL THEN c.is_pastor ELSE c.id = ANY (_roots) END)
                    ELSE c.leader_id = ANY (_parents) AND c.id <> ALL (_parents) AND s.id <> ALL (_parents) END
      ) e;
    IF _got IS DISTINCT FROM _exp THEN
      _bad_ids := _bad_ids || format('%s: devolveu %s, esperado %s', _key, _got, _exp);
    END IF;

    SELECT coalesce(array_agg(g ORDER BY g), '{}') INTO _hidden
      FROM unnest(_got) g WHERE g NOT IN (SELECT m.id FROM public.members m);
    IF cardinality(_hidden) > 0 THEN
      _bad_hidden := _bad_hidden || format('%s: %s', _key, _hidden);
    END IF;

    FOR n IN SELECT * FROM public.ministry_tree_nodes(_parents) LOOP
      _pair := array_remove(ARRAY[n.member_id, n.spouse_id], NULL);

      SELECT count(*) INTO _count
        FROM public.members d
       WHERE d.is_active AND d.leader_id = ANY (_pair) AND d.id <> ALL (_pair);
      IF n.direct_disciples IS DISTINCT FROM _count THEN
        _bad_direct := _bad_direct || format('%s (%s): %s, esperado %s', n.member_name, _key, n.direct_disciples, _count);
      END IF;

      IF n.direct_disciples > 0 THEN
        SELECT count(DISTINCT g) INTO _count
          FROM pg_temp.ids(_pair) g
          JOIN public.members m ON m.id = g
         WHERE m.leader_id = ANY (_pair);
        IF _count <> n.direct_disciples THEN
          _bad_expand := _bad_expand || format('%s (%s): abriu %s, esperado %s', n.member_name, _key, _count, n.direct_disciples);
        END IF;

        _pair_key := (SELECT array_agg(x ORDER BY x) FROM unnest(_pair) x)::text;
        IF NOT _pair_key = ANY (_seen) THEN
          _seen := _seen || _pair_key;
          _queue := _queue || _pair_key;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEXT is(_bad_ids, '{}'::text[],
    _who || ': cada nível = os ativos que a pessoa lê em members sob RLS, com os cônjuges ativos e visíveis (RN-05, RN-10)');
  RETURN NEXT is(_bad_hidden, '{}'::text[],
    _who || ': nenhum id devolvido é invisível em members sob RLS (RN-05)');
  RETURN NEXT is(_bad_direct, '{}'::text[],
    _who || ': direct_disciples = discípulos diretos ativos do casal em members sob RLS (RN-05, RN-10)');
  RETURN NEXT is(_bad_expand, '{}'::text[],
    _who || ': direct_disciples > 0 ⇒ abrir o nó traz exatamente esses discípulos (RN-10)');
  RETURN NEXT cmp_ok(_i - 1, '>=', _min_levels,
    _who || ': a árvore percorrida tem ao menos ' || _min_levels || ' níveis');
END $$;

-- ---------------------------------------------------------------------------
-- Massa. Triggers desligados: níveis, cônjuges e totais (total_disciples,
-- total_cells) explícitos, para conferir as somas do casal.
-- ---------------------------------------------------------------------------
SET LOCAL session_replication_role = replica;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e108pr4-' || n || '@teste.local' FROM generate_series(1, 7) n;
-- 1 P1, 2 P2, 3 P3 (ministério A), 4 P4, 5 P5 (pastor sem função),
-- 6 P3 do ministério B, 7 sem cadastro de membro

INSERT INTO public.roles (id, name, is_system) VALUES
  (pg_temp.role(1), 'Teste E108 PR4 P1 sistema',     false),
  (pg_temp.role(2), 'Teste E108 PR4 P2 igreja toda', false),
  (pg_temp.role(3), 'Teste E108 PR4 P3 ministério',  false),
  (pg_temp.role(4), 'Teste E108 PR4 P4 relatórios',  false);
INSERT INTO public.role_permissions (role_id, permission) VALUES
  (pg_temp.role(1), 'view_all_church'),
  (pg_temp.role(2), 'view_all_church'),
  (pg_temp.role(3), 'view_own_ministry'),
  (pg_temp.role(4), 'view_all_reports'),
  (pg_temp.role(4), 'view_own_reports');

-- Árvore (nível entre parênteses; td/tc = total_disciples/total_cells guardados):
--   Raízes: Paulo (01) & Priscila (02), pastores casados; Pedro (03), pastor
--     inativo; Silas (04), pastor com a cônjuge Sara (05) inativa; Xavier (06),
--     sem líder e sem ser pastor.
--   Ministério A, casal G12 André (10) & Ana (11): 12 discípulos diretos
--     ativos, 2 deles casados entre si (Mateus 13 & Marta 12), e 2 inativos
--     (Igor 23, Tânia 15, cônjuge do Tiago 14).
--     João (16) é casado com Bia (40), do ministério B.
--     Felipe (18) lidera a esposa Fernanda (19); Célia (30) lidera o marido Cássio (31).
--     Joana (25) é casada com Alice (26), discípula da Lídia (27).
--   Ministério B, G12 Bruno (41), sem cônjuge: Bia, Wagner (42, casado com
--     Valter 43, discípulo do Otávio), Katia (44) & Karla (45), os dois Sam
--     Igual (46, 47, sem gênero), Otávio (48, lidera a esposa Olga 49, com td
--     desatualizado em 0) e Hugo (50), que lidera Ary (53) e dois Davi Duplo (51, 52).
INSERT INTO public.members
  (id, name, gender, is_pastor, g12_level, leader_id, spouse_id, is_active,
   total_disciples, total_cells, auth_user_id, role_id)
VALUES
  (pg_temp.m(1),  'Paulo Pastor',          'M',  true,  0, NULL,          pg_temp.m(2),  true,  30, 8, pg_temp.u(5), NULL),
  (pg_temp.m(2),  'Priscila Pastora',      'F',  true,  0, NULL,          pg_temp.m(1),  true,  25, 7, pg_temp.u(1), pg_temp.role(1)),
  (pg_temp.m(3),  'Pedro Pastor Inativo',  'M',  true,  0, NULL,          NULL,          false,  0, 0, NULL,         NULL),
  (pg_temp.m(4),  'Silas Pastor',          'M',  true,  0, NULL,          pg_temp.m(5),  true,   3, 2, NULL,         NULL),
  (pg_temp.m(5),  'Sara Silas',            'F',  false, 0, NULL,          pg_temp.m(4),  false,  9, 9, NULL,         NULL),
  (pg_temp.m(6),  'Xavier Sem Líder',      'M',  false, 0, NULL,          NULL,          true,   0, 0, NULL,         NULL),
  -- Ministério A
  (pg_temp.m(10), 'André Alves',           'M',  false, 1, pg_temp.m(1),  pg_temp.m(11), true,  20, 5, NULL,         NULL),
  (pg_temp.m(11), 'Ana Alves',             'F',  false, 1, pg_temp.m(2),  pg_temp.m(10), true,  15, 4, NULL,         NULL),
  (pg_temp.m(12), 'Marta Moura',           'F',  false, 2, pg_temp.m(11), pg_temp.m(13), true,   3, 2, NULL,         NULL),
  (pg_temp.m(13), 'Mateus Moura',          'M',  false, 2, pg_temp.m(10), pg_temp.m(12), true,   2, 1, NULL,         NULL),
  (pg_temp.m(14), 'Tiago Teles',           'M',  false, 2, pg_temp.m(10), pg_temp.m(15), true,   1, 1, NULL,         NULL),
  (pg_temp.m(15), 'Tânia Teles',           'F',  false, 2, pg_temp.m(11), pg_temp.m(14), false,  7, 3, NULL,         NULL),
  (pg_temp.m(16), 'João Jesus',            'M',  false, 2, pg_temp.m(10), pg_temp.m(40), true,   0, 1, NULL,         NULL),
  (pg_temp.m(17), 'Lucas Lima',            'M',  false, 2, pg_temp.m(10), NULL,          true,   4, 1, pg_temp.u(3), pg_temp.role(3)),
  (pg_temp.m(18), 'Felipe Faria',          'M',  false, 2, pg_temp.m(10), pg_temp.m(19), true,   3, 4, NULL,         NULL),
  (pg_temp.m(19), 'Fernanda Faria',        'F',  false, 3, pg_temp.m(18), pg_temp.m(18), true,   1, 1, NULL,         NULL),
  (pg_temp.m(20), 'Fábio Faria',           'M',  false, 3, pg_temp.m(18), NULL,          true,   0, 0, NULL,         NULL),
  (pg_temp.m(21), 'Flávio Faria',          'M',  false, 3, pg_temp.m(18), NULL,          false,  0, 0, NULL,         NULL),
  (pg_temp.m(22), 'Fabiana Faria',         'F',  false, 4, pg_temp.m(19), NULL,          true,   0, 0, NULL,         NULL),
  (pg_temp.m(23), 'Igor Inativo',          'M',  false, 2, pg_temp.m(10), NULL,          false,  0, 0, NULL,         NULL),
  (pg_temp.m(24), 'Maria Mendes',          'F',  false, 2, pg_temp.m(11), NULL,          true,   0, 0, pg_temp.u(2), pg_temp.role(2)),
  (pg_temp.m(25), 'Joana Jardim',          'F',  false, 2, pg_temp.m(11), pg_temp.m(26), true,   0, 0, NULL,         NULL),
  (pg_temp.m(26), 'Alice Jardim',          'F',  false, 3, pg_temp.m(27), pg_temp.m(25), true,   0, 0, NULL,         NULL),
  (pg_temp.m(27), 'Lídia Lopes',           'F',  false, 2, pg_temp.m(11), NULL,          true,   0, 0, NULL,         NULL),
  (pg_temp.m(28), 'Rute Ramos',            'F',  false, 2, pg_temp.m(11), NULL,          true,   0, 0, pg_temp.u(4), pg_temp.role(4)),
  (pg_temp.m(29), 'Débora Dias',           'F',  false, 2, pg_temp.m(11), NULL,          true,   0, 0, NULL,         NULL),
  (pg_temp.m(30), 'Célia Castro',          'F',  false, 2, pg_temp.m(11), pg_temp.m(31), true,   5, 3, NULL,         NULL),
  (pg_temp.m(31), 'Cássio Castro',         'M',  false, 3, pg_temp.m(30), pg_temp.m(30), true,   2, 1, NULL,         NULL),
  (pg_temp.m(32), 'Cecília Castro',        'F',  false, 3, pg_temp.m(30), NULL,          true,   0, 0, NULL,         NULL),
  -- Ministério B
  (pg_temp.m(40), 'Bia Barros',            'F',  false, 2, pg_temp.m(41), pg_temp.m(16), true,   2, 1, NULL,         NULL),
  (pg_temp.m(41), 'Bruno Borges',          'M',  false, 1, pg_temp.m(1),  NULL,          true,  12, 6, NULL,         NULL),
  (pg_temp.m(42), 'Wagner Weber',          'M',  false, 2, pg_temp.m(41), pg_temp.m(43), true,   0, 0, NULL,         NULL),
  (pg_temp.m(43), 'Valter Vaz',            'M',  false, 3, pg_temp.m(48), pg_temp.m(42), true,   0, 0, NULL,         NULL),
  (pg_temp.m(44), 'Katia Klein',           'F',  false, 2, pg_temp.m(41), pg_temp.m(45), true,   0, 0, pg_temp.u(6), pg_temp.role(3)),
  (pg_temp.m(45), 'Karla Klein',           'F',  false, 2, pg_temp.m(41), pg_temp.m(44), true,   0, 0, NULL,         NULL),
  (pg_temp.m(46), 'Sam Igual',             NULL, false, 2, pg_temp.m(41), pg_temp.m(47), true,   0, 0, NULL,         NULL),
  (pg_temp.m(47), 'Sam Igual',             NULL, false, 2, pg_temp.m(41), pg_temp.m(46), true,   0, 0, NULL,         NULL),
  (pg_temp.m(48), 'Otávio Ortiz',          'M',  false, 2, pg_temp.m(41), pg_temp.m(49), true,   0, 2, NULL,         NULL),
  (pg_temp.m(49), 'Olga Ortiz',            'F',  false, 3, pg_temp.m(48), pg_temp.m(48), true,   0, 0, NULL,         NULL),
  (pg_temp.m(50), 'Hugo Horta',            'M',  false, 2, pg_temp.m(41), NULL,          true,   3, 0, NULL,         NULL),
  (pg_temp.m(52), 'Davi Duplo',            'M',  false, 3, pg_temp.m(50), NULL,          true,   0, 0, NULL,         NULL),
  (pg_temp.m(51), 'Davi Duplo',            'M',  false, 3, pg_temp.m(50), NULL,          true,   0, 0, NULL,         NULL),
  (pg_temp.m(53), 'Ary Alves',             'M',  false, 3, pg_temp.m(50), NULL,          true,   0, 0, NULL,         NULL);

SET LOCAL session_replication_role = origin;

-- Os nós de [André, Ana], na forma (principal, cônjuge), para P1 e P3.
CREATE TEMP TABLE a_nodes_p1 (member_id uuid, spouse_id uuid);
INSERT INTO pg_temp.a_nodes_p1 VALUES
  (pg_temp.m(31), pg_temp.m(30)),  -- Cássio & Célia: o homem, mesmo sem ser candidato
  (pg_temp.m(29), NULL),           -- Débora
  (pg_temp.m(18), pg_temp.m(19)),  -- Felipe & Fernanda (liderada por ele)
  (pg_temp.m(16), pg_temp.m(40)),  -- João & Bia (do ministério B)
  (pg_temp.m(25), pg_temp.m(26)),  -- Joana & Alice: duas mulheres; a candidata primeiro
  (pg_temp.m(27), NULL),           -- Lídia
  (pg_temp.m(17), NULL),           -- Lucas
  (pg_temp.m(24), NULL),           -- Maria
  (pg_temp.m(13), pg_temp.m(12)),  -- Mateus & Marta: os dois candidatos; o homem primeiro
  (pg_temp.m(28), NULL),           -- Rute
  (pg_temp.m(14), NULL);           -- Tiago (Tânia inativa)
GRANT SELECT ON pg_temp.a_nodes_p1 TO authenticated;

-- ===========================================================================
-- 1. Contrato, grants e propriedades — 13 verificações
-- ===========================================================================
SELECT is(
  (SELECT count(*)::int FROM pg_proc WHERE proname = 'ministry_tree_nodes' AND pronamespace = 'public'::regnamespace),
  1, 'ministry_tree_nodes: uma versão só (sem sobrecarga)');
SELECT is(pg_get_function_arguments('public.ministry_tree_nodes(uuid[])'::regprocedure),
  '_parent_ids uuid[] DEFAULT NULL::uuid[]',
  'ministry_tree_nodes: _parent_ids opcional, NULL por padrão (as raízes)');
SELECT is(pg_get_function_result('public.ministry_tree_nodes(uuid[])'::regprocedure),
  'TABLE(member_id uuid, member_name text, member_gender text, g12_level integer, is_pastor boolean, '
  || 'spouse_id uuid, spouse_name text, direct_disciples bigint, total_disciples integer, total_cells integer)',
  'ministry_tree_nodes: colunas e tipos do contrato, na ordem');
SELECT results_eq(
  $$ SELECT prosecdef, provolatile::text COLLATE "default", proconfig::text COLLATE "default"
       FROM pg_proc WHERE oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure $$,
  $$ VALUES (false, 's', '{search_path=public}') $$,
  'ministry_tree_nodes: SECURITY INVOKER (prosecdef = false), STABLE e search_path=public');
SELECT ok(prosrc !~ 'public\.(members|cells|cell_reports|cell_report_participants)\y',
  'ministry_tree_nodes: não lê as tabelas diretamente (herda escopo e máscara da members_view, RN-05)')
  FROM pg_proc WHERE oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure;
SELECT ok(prosrc ~ 'public\.members_view\y',
  'ministry_tree_nodes: lê a members_view')
  FROM pg_proc WHERE oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure;
SELECT ok(NOT has_function_privilege('anon', 'public.ministry_tree_nodes(uuid[])', 'EXECUTE'),
  'ministry_tree_nodes: anon sem EXECUTE');
SELECT ok(has_function_privilege('authenticated', 'public.ministry_tree_nodes(uuid[])', 'EXECUTE'),
  'ministry_tree_nodes: authenticated com EXECUTE');
SELECT is_empty($$ SELECT 1 FROM pg_proc, aclexplode(proacl) a
                    WHERE oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure AND a.grantee = 0 $$,
  'ministry_tree_nodes: nada concedido a PUBLIC');
SELECT isnt(
  (SELECT proacl FROM pg_proc WHERE oid = 'public.ministry_tree_nodes(uuid[])'::regprocedure), NULL,
  'ministry_tree_nodes: ACL explícita (sem o EXECUTE implícito de PUBLIC)');

SET LOCAL ROLE anon;
SELECT throws_ok('SELECT * FROM public.ministry_tree_nodes()', '42501', NULL,
  'anon: ministry_tree_nodes() é negado');
SELECT throws_ok(format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(10, 11)), '42501', NULL,
  'anon: ministry_tree_nodes(ids) é negado');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM public.members WHERE id::text LIKE 'c1084000%'), 43, 'massa: 43 membros');

-- ===========================================================================
-- 2. RN-10: o critério de aceite (P1) — 14 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;

-- O nó pai: abrir os pastores da massa traz o casal G12 e o G12 sem cônjuge.
SELECT results_eq(
  format($$ SELECT member_id, member_name, member_gender, g12_level, is_pastor, spouse_id, spouse_name,
                   direct_disciples, total_disciples, total_cells
              FROM public.ministry_tree_nodes(%L) $$, pg_temp.ms(1, 2)),
  format($$ VALUES (%L::uuid, 'André Alves'::text, 'M'::text, 1, false, %L::uuid, 'Ana Alves'::text, 12::bigint, 35, 9),
                   (%L::uuid, 'Bruno Borges'::text, 'M'::text, 1, false, NULL::uuid, NULL::text, 8::bigint, 12, 6) $$,
         pg_temp.m(10), pg_temp.m(11), pg_temp.m(41)),
  'RN-10/P1: abrir Paulo & Priscila traz o casal André & Ana (12 discípulos diretos ativos; totais somados) e Bruno, em ordem de nome');

SELECT is(
  (SELECT count(*)::int FROM public.ministry_tree_nodes(pg_temp.ms(10, 11))), 11,
  'RN-10/P1: 12 discípulos diretos ativos, 2 casados entre si → 11 nós');
SELECT set_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L)', pg_temp.ms(10, 11)),
  'SELECT member_id, spouse_id FROM pg_temp.a_nodes_p1',
  'RN-10/P1: os 11 nós são os casais esperados, com o principal certo em cada um');
SELECT is_empty(
  format($$ SELECT t.member_name
              FROM public.ministry_tree_nodes(%L) t
              JOIN public.members s ON s.id = t.spouse_id
             WHERE s.gender = 'M' AND t.member_gender IS DISTINCT FROM 'M' $$, pg_temp.ms(10, 11)),
  'RN-10/P1: em nenhum casal o homem aparece como cônjuge (o homem primeiro)');
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)',
         pg_temp.ms(10, 11), pg_temp.m(12)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(13), pg_temp.m(12)),
  'RN-10/P1: Mateus & Marta, os dois discípulos diretos, viram um nó só, com Mateus (maior id, nome depois) primeiro');
SELECT is(
  (SELECT count(*)::int FROM pg_temp.ids(pg_temp.ms(10, 11))),
  (SELECT count(DISTINCT g)::int FROM pg_temp.ids(pg_temp.ms(10, 11)) g),
  'RN-10/P1: nenhum membro aparece em dois nós do mesmo nível');
SELECT is_empty(
  format('SELECT g FROM pg_temp.ids(%L) g WHERE g = ANY(%L)', pg_temp.ms(10, 11), pg_temp.ms(15, 23)),
  'RN-10/P1: os discípulos inativos (Igor e Tânia) não aparecem em nenhum nó');
SELECT is(
  (SELECT count(*)::int FROM pg_temp.ids(pg_temp.ms(10, 11)) g
     JOIN public.members m ON m.id = g WHERE m.leader_id = ANY (pg_temp.ms(10, 11))),
  12, 'RN-10/P1: abrir o nó traz exatamente os 12 discípulos diretos contados no pai');
SELECT is(
  (SELECT array_agg(t.member_id ORDER BY t.ord)
     FROM public.ministry_tree_nodes(pg_temp.ms(10, 11)) WITH ORDINALITY t(member_id, member_name, a, b, c, d, e, f, g, h, ord)),
  (SELECT array_agg(t.member_id ORDER BY t.member_name, t.member_id)
     FROM public.ministry_tree_nodes(pg_temp.ms(10, 11)) t),
  'RN-10/P1: os nós vêm em ordem do nome do principal');
SELECT results_eq(
  format($$ SELECT member_name, member_gender, g12_level, is_pastor
              FROM public.ministry_tree_nodes(%L) WHERE member_id = %L $$, pg_temp.ms(10, 11), pg_temp.m(31)),
  $$ VALUES ('Cássio Castro'::text, 'M'::text, 3, false) $$,
  'RN-10/P1: nome, gênero, nível e is_pastor são os do principal (Cássio, nível 3, cônjuge de uma discípula de nível 2)');

-- Contagens de cada nó do nível (o pai já foi conferido acima).
SELECT results_eq(
  format($$ SELECT member_name, spouse_name, direct_disciples, total_disciples, total_cells
              FROM public.ministry_tree_nodes(%L) $$, pg_temp.ms(10, 11)),
  $$ SELECT * FROM (VALUES
       ('Cássio Castro'::text,  'Célia Castro'::text,   1::bigint, 4, 3),
       ('Débora Dias'::text,    NULL::text,             0::bigint, 0, 0),
       ('Felipe Faria'::text,   'Fernanda Faria'::text, 2::bigint, 2, 4),
       ('Joana Jardim'::text,   'Alice Jardim'::text,   0::bigint, 0, 0),
       ('João Jesus'::text,     'Bia Barros'::text,     0::bigint, 2, 2),
       ('Lídia Lopes'::text,    NULL::text,             1::bigint, 0, 0),
       ('Lucas Lima'::text,     NULL::text,             0::bigint, 4, 1),
       ('Maria Mendes'::text,   NULL::text,             0::bigint, 0, 0),
       ('Mateus Moura'::text,   'Marta Moura'::text,    0::bigint, 5, 3),
       ('Rute Ramos'::text,     NULL::text,             0::bigint, 0, 0),
       ('Tiago Teles'::text,    NULL::text,             0::bigint, 1, 1)
     ) v(a, b, c, d, e) ORDER BY a $$,
  'RN-10/P1: os 11 nós de André & Ana, com discípulos diretos e totais (soma do casal; só o do líder quando um lidera o outro)');

-- Raízes (filtradas pela massa: o banco pode ter outros pastores).
SELECT results_eq(
  $$ SELECT member_name, spouse_name, is_pastor, direct_disciples, total_disciples, total_cells
       FROM public.ministry_tree_nodes() WHERE member_id::text LIKE 'c1084000%' $$,
  $$ VALUES ('Paulo Pastor'::text, 'Priscila Pastora'::text, true, 3::bigint, 55, 15),
            ('Silas Pastor'::text, NULL::text,               true, 0::bigint,  3,  2) $$,
  'RN-10/P1: raízes da massa = os pastores ativos (casal Paulo & Priscila uma vez; Silas sem a cônjuge inativa)');
SELECT is_empty(
  format('SELECT g FROM pg_temp.ids(NULL) g WHERE g = ANY(%L)', pg_temp.ms(3, 5, 6)),
  'RN-10/P1: nas raízes não entram o pastor inativo, a cônjuge inativa nem quem não tem líder sem ser pastor');
SELECT results_eq(
  'SELECT * FROM public.ministry_tree_nodes()',
  'SELECT * FROM public.ministry_tree_nodes(NULL)',
  'RN-10/P1: sem argumento é o mesmo que NULL (as raízes)');
RESET ROLE;

-- ===========================================================================
-- 3. Cônjuge oculto: inativo ou invisível — 13 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format('SELECT spouse_id, spouse_name FROM public.ministry_tree_nodes(%L) WHERE member_id = %L', pg_temp.ms(10, 11), pg_temp.m(14)),
  $$ VALUES (NULL::uuid, NULL::text) $$,
  'Cônjuge/P1: a esposa inativa de Tiago fica oculta: spouse_id e spouse_name nulos');
SELECT results_eq(
  format('SELECT spouse_id, spouse_name FROM public.ministry_tree_nodes() WHERE member_id = %L', pg_temp.m(4)),
  $$ VALUES (NULL::uuid, NULL::text) $$,
  'Cônjuge/P1: nas raízes, a esposa inativa do pastor Silas também fica oculta');
RESET ROLE;

-- P3 (Lucas, ministério A): Bia, esposa de João, é do ministério B.
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT is_empty(format('SELECT 1 FROM public.members WHERE id = %L', pg_temp.m(40)),
  'Cônjuge/P3: Bia é invisível para P3 sob RLS');
SELECT results_eq(
  format($$ SELECT spouse_id, spouse_name, direct_disciples, total_disciples, total_cells
              FROM public.ministry_tree_nodes(%L) WHERE member_id = %L $$, pg_temp.ms(10, 11), pg_temp.m(16)),
  $$ VALUES (NULL::uuid, NULL::text, 0::bigint, 0, 1) $$,
  'Cônjuge/P3: João aparece sozinho, sem o id, o nome nem os totais da cônjuge invisível');
SELECT is_empty(
  format($$ SELECT 1 FROM (SELECT * FROM public.ministry_tree_nodes(%L)
                           UNION ALL SELECT * FROM public.ministry_tree_nodes(%L)
                           UNION ALL SELECT * FROM public.ministry_tree_nodes()) t
             WHERE %L IN (t.member_id, t.spouse_id) OR t.spouse_name = 'Bia Barros' $$,
         pg_temp.ms(10, 11), pg_temp.ms(1, 2), pg_temp.m(40)),
  'Cônjuge/P3: o id e o nome da cônjuge invisível não saem em nenhum nível');
SELECT is((SELECT count(*)::int FROM public.ministry_tree_nodes(pg_temp.ms(10, 11))), 11,
  'Cônjuge/P3: continuam 11 nós; João sozinho');
SELECT is_empty(format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(41)),
  'Cônjuge/P3: abrir Bruno (invisível) não devolve ninguém');
SELECT results_eq('SELECT member_id, spouse_id FROM public.ministry_tree_nodes()',
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(10), pg_temp.m(11)),
  'P3: não vê pastores; a raiz é o casal G12 dele (DA-6 do E2.02)');
SELECT results_eq(
  format('SELECT member_id, spouse_id, direct_disciples FROM public.ministry_tree_nodes(%L)', pg_temp.ms(1, 2)),
  format('VALUES (%L::uuid, %L::uuid, 12::bigint)', pg_temp.m(10), pg_temp.m(11)),
  'P3: abrir os pastores traz só o casal G12 do ministério, com os 12 discípulos diretos');
RESET ROLE;

-- P3 do ministério B (Katia): o João é que fica invisível.
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format('SELECT member_id, spouse_id, spouse_name FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)',
         pg_temp.ms(41), pg_temp.m(40)),
  format('VALUES (%L::uuid, NULL::uuid, NULL::text)', pg_temp.m(40)),
  'Cônjuge/P3 do ministério B: Bia aparece sozinha, sem o id do marido invisível');
SELECT is((SELECT count(*)::int FROM public.ministry_tree_nodes(pg_temp.ms(41))), 6,
  'Cônjuge/P3 do ministério B: Bruno tem 6 nós');
RESET ROLE;

-- P5 (pastor Paulo, sem função): só vê o próprio cadastro.
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT * FROM public.ministry_tree_nodes()',
  'Cônjuge/P5: o pastor sem permissão de escopo não recebe nenhuma raiz (E2.02: Ministérios exige ver a igreja ou o ministério)');
SELECT is_empty(format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(1, 2)),
  'P5: abrir o próprio nó não devolve ninguém');
RESET ROLE;

-- ===========================================================================
-- 4. Um lidera o outro (P1) — 8 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format('SELECT member_name, spouse_name, direct_disciples FROM public.ministry_tree_nodes(%L)', pg_temp.ms(18, 19)),
  $$ VALUES ('Fabiana Faria'::text, NULL::text, 0::bigint), ('Fábio Faria'::text, NULL::text, 0::bigint) $$,
  'Esposa liderada pelo marido: abrir Felipe & Fernanda traz Fabiana (discípula dela) e Fábio (dele); Fernanda não reaparece e o inativo fica fora');
SELECT is(
  (SELECT direct_disciples FROM public.ministry_tree_nodes(pg_temp.ms(10, 11)) WHERE member_id = pg_temp.m(18)),
  (SELECT count(*) FROM public.ministry_tree_nodes(pg_temp.ms(18, 19))),
  'Esposa liderada pelo marido: a contagem do nó (2) é o número de filhos, sem contar a esposa');
SELECT results_eq(
  format('SELECT total_disciples, total_cells FROM public.ministry_tree_nodes(%L) WHERE member_id = %L', pg_temp.ms(10, 11), pg_temp.m(18)),
  $$ VALUES (2, 4) $$,
  'Esposa liderada pelo marido: totais só do líder (3 − 1 = 2 discípulos; 4 células), sem somar os da esposa');
SELECT results_eq(
  format('SELECT member_name, spouse_name, direct_disciples FROM public.ministry_tree_nodes(%L)', pg_temp.ms(30, 31)),
  $$ VALUES ('Cecília Castro'::text, NULL::text, 0::bigint) $$,
  'Marido liderado pela esposa: abrir Cássio & Célia traz só Cecília; Cássio não reaparece');
SELECT results_eq(
  format('SELECT total_disciples, total_cells FROM public.ministry_tree_nodes(%L) WHERE member_id = %L', pg_temp.ms(10, 11), pg_temp.m(31)),
  $$ VALUES (4, 3) $$,
  'Marido liderado pela esposa: totais só da líder (5 − 1 = 4; 3 células)');
SELECT results_eq(
  format($$ SELECT member_name, spouse_name, direct_disciples, total_disciples, total_cells
              FROM public.ministry_tree_nodes(%L) WHERE member_id = %L $$, pg_temp.ms(41), pg_temp.m(48)),
  $$ VALUES ('Otávio Ortiz'::text, 'Olga Ortiz'::text, 1::bigint, 0, 2) $$,
  'Um lidera o outro com total_disciples desatualizado em 0: o total não fica negativo (piso 0)');
SELECT results_eq(
  format('SELECT member_name, spouse_name FROM public.ministry_tree_nodes(%L)', pg_temp.ms(48, 49)),
  $$ VALUES ('Valter Vaz'::text, 'Wagner Weber'::text) $$,
  'Um lidera o outro: abrir Otávio & Olga traz Valter (com o cônjuge Wagner); Olga não reaparece');
SELECT results_eq(
  format('SELECT total_disciples, total_cells FROM public.ministry_tree_nodes(%L) WHERE member_id = %L', pg_temp.ms(10, 11), pg_temp.m(13)),
  $$ VALUES (5, 3) $$,
  'Casal sem liderança entre si: totais somados (2 + 3 discípulos; 1 + 2 células)');
RESET ROLE;

-- ===========================================================================
-- 5. Regra do integrante principal (P1) — 10 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
-- 1º: o homem.
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)', pg_temp.ms(10, 11), pg_temp.m(30)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(31), pg_temp.m(30)),
  'Principal 1 (o homem): Cássio, que não é candidato, vem antes de Célia, a candidata');
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)', pg_temp.ms(41), pg_temp.m(40)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(16), pg_temp.m(40)),
  'Principal 1 (o homem): abrindo Bruno, João (de outro ministério) vem antes de Bia, a candidata');
-- 2º: empatado no gênero, o candidato.
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)', pg_temp.ms(10, 11), pg_temp.m(26)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(25), pg_temp.m(26)),
  'Principal 2 (o candidato): duas mulheres; abrindo André & Ana, Joana (candidata) vem antes de Alice (nome menor)');
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L)', pg_temp.ms(27)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(26), pg_temp.m(25)),
  'Principal 2 (o candidato): o mesmo casal, abrindo Lídia, tem Alice (agora a candidata) primeiro');
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)', pg_temp.ms(41), pg_temp.m(42)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(42), pg_temp.m(43)),
  'Principal 2 (o candidato): dois homens; abrindo Bruno, Wagner (candidato) vem antes de Valter (nome menor)');
-- 3º: empatado de novo, o menor (nome, id).
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)', pg_temp.ms(41), pg_temp.m(44)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(45), pg_temp.m(44)),
  'Principal 3 (menor nome): Karla & Katia, as duas candidatas: Karla (nome menor, id maior) primeiro');
SELECT results_eq(
  format('SELECT member_id, spouse_id FROM public.ministry_tree_nodes(%L) WHERE %L IN (member_id, spouse_id)', pg_temp.ms(41), pg_temp.m(46)),
  format('VALUES (%L::uuid, %L::uuid)', pg_temp.m(46), pg_temp.m(47)),
  'Principal 3 (menor id): dois "Sam Igual" sem gênero, os dois candidatos: o de menor id primeiro');
-- A ordem e a repetição dos ids não mudam nada.
SELECT results_eq(
  format('SELECT * FROM public.ministry_tree_nodes(%L)', ARRAY[pg_temp.m(11), pg_temp.m(10)]),
  format('SELECT * FROM public.ministry_tree_nodes(%L)', ARRAY[pg_temp.m(10), pg_temp.m(11)]),
  'Ordem dos ids: [Ana, André] = [André, Ana], linha a linha');
SELECT results_eq(
  format('SELECT * FROM public.ministry_tree_nodes(%L)', ARRAY[pg_temp.m(41), pg_temp.m(11), pg_temp.m(10)]),
  format('SELECT * FROM public.ministry_tree_nodes(%L)', ARRAY[pg_temp.m(10), pg_temp.m(41), pg_temp.m(11)]),
  'Ordem dos ids: [Bruno, Ana, André] = [André, Bruno, Ana], linha a linha');
SELECT results_eq(
  format($$ SELECT member_id, spouse_id, total
              FROM (SELECT t.member_id, t.spouse_id, count(*) OVER () AS total
                      FROM public.ministry_tree_nodes(%L) t) x
             WHERE %L IN (member_id, spouse_id) $$, pg_temp.ms(10, 11, 41), pg_temp.m(16)),
  format('VALUES (%L::uuid, %L::uuid, 16::bigint)', pg_temp.m(16), pg_temp.m(40)),
  'Vários nós numa chamada: João & Bia, candidatos por nós diferentes, viram um nó só (16 nós ao todo)');
RESET ROLE;

-- ===========================================================================
-- 6. Ordem e o parâmetro (P1) — 11 verificações
-- ===========================================================================
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT results_eq(
  format('SELECT member_id, member_name FROM public.ministry_tree_nodes(%L)', pg_temp.ms(50)),
  format($$ VALUES (%L::uuid, 'Ary Alves'::text), (%L::uuid, 'Davi Duplo'::text), (%L::uuid, 'Davi Duplo'::text) $$,
         pg_temp.m(53), pg_temp.m(51), pg_temp.m(52)),
  'Ordem: pelo nome do principal e, com o nome igual, pelo id');
SELECT is_empty($$ SELECT * FROM public.ministry_tree_nodes('{}'::uuid[]) $$,
  'Parâmetro: array vazio devolve nenhuma linha');
SELECT is_empty($$ SELECT * FROM public.ministry_tree_nodes('{NULL}'::uuid[]) $$,
  'Parâmetro: {NULL} devolve nenhuma linha (não vira as raízes)');
SELECT is_empty($$ SELECT * FROM public.ministry_tree_nodes(ARRAY[NULL, NULL]::uuid[]) $$,
  'Parâmetro: só nulos devolve nenhuma linha');
SELECT results_eq(
  format('SELECT * FROM public.ministry_tree_nodes(%L)', ARRAY[pg_temp.m(11), NULL, pg_temp.m(10), pg_temp.m(11), NULL]),
  format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(10, 11)),
  'Parâmetro: ids nulos e repetidos são ignorados');
SELECT is_empty(
  format('SELECT * FROM public.ministry_tree_nodes(%L)', ARRAY['c1084000-0000-0000-0000-999999999999'::uuid]),
  'Parâmetro: um id inexistente devolve nenhuma linha');
SELECT lives_ok(
  format('SELECT * FROM public.ministry_tree_nodes(%L)',
         pg_temp.ms(10, 11) || ARRAY(SELECT pg_temp.m(5000 + n) FROM generate_series(1, 98) n)),
  'Parâmetro: 100 ids são aceitos');
SELECT is(
  (SELECT count(*)::int FROM public.ministry_tree_nodes(
     pg_temp.ms(10, 11) || ARRAY(SELECT pg_temp.m(5000 + n) FROM generate_series(1, 98) n))),
  11, 'Parâmetro: com 100 ids (98 inexistentes), os 11 nós de André & Ana');
SELECT throws_ok(
  format('SELECT * FROM public.ministry_tree_nodes(%L)',
         pg_temp.ms(10, 11) || ARRAY(SELECT pg_temp.m(5000 + n) FROM generate_series(1, 99) n)),
  '22023', 'No máximo 100 nós por chamada.',
  'Parâmetro: 101 ids → erro 22023');
SELECT throws_ok(
  format('SELECT * FROM public.ministry_tree_nodes(%L)', array_fill(pg_temp.m(10), ARRAY[101])),
  '22023', 'No máximo 100 nós por chamada.',
  'Parâmetro: o limite conta o array recebido, mesmo com ids repetidos');
SELECT ok(
  (SELECT bool_and(is_pastor) FROM public.ministry_tree_nodes() WHERE member_id::text LIKE 'c1084000%'),
  'Parâmetro: NULL devolve, da massa, só pastores como principais');
RESET ROLE;

-- ===========================================================================
-- 7. P4, P5 e sem cadastro: quem vê pouco recebe pouco — 5 verificações
-- ===========================================================================
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT * FROM public.ministry_tree_nodes()',
  'P4 (só relatórios): nenhuma raiz');
SELECT results_eq(
  format('SELECT member_id, spouse_id, direct_disciples FROM public.ministry_tree_nodes(%L)', pg_temp.ms(10, 11)),
  format('VALUES (%L::uuid, NULL::uuid, 0::bigint)', pg_temp.m(28)),
  'P4 (só relatórios): abrir André & Ana traz só o próprio cadastro');
RESET ROLE;

SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT is_empty('SELECT * FROM public.ministry_tree_nodes()',
  'Sem cadastro de membro: nenhuma raiz');
SELECT is_empty(format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(10, 11)),
  'Sem cadastro de membro: abrir um nó não devolve ninguém');
SELECT is_empty(format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(1, 2)),
  'Sem cadastro de membro: abrir os pastores não devolve ninguém');
RESET ROLE;

-- ===========================================================================
-- 8. RN-05: paridade por persona, percorrendo a árvore — 5 por persona (35)
-- ===========================================================================
CREATE TEMP TABLE starts (s text[]);
INSERT INTO pg_temp.starts
SELECT ARRAY['raízes', pg_temp.ms(1, 2)::text, pg_temp.ms(10, 11)::text, pg_temp.ms(41)::text];
GRANT SELECT ON pg_temp.starts TO authenticated;

-- P1 sistema (view_members): a igreja toda, incluindo o que já houver no banco.
SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('P1', (SELECT s FROM pg_temp.starts), 9);
RESET ROLE;

-- P2 igreja toda (view_all_church)
SELECT pg_temp.login(2);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('P2', (SELECT s FROM pg_temp.starts), 9);
RESET ROLE;

-- P3 ministério A (view_own_ministry)
SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('P3', (SELECT s FROM pg_temp.starts), 7, pg_temp.ms(10));
RESET ROLE;

-- P3 ministério B (view_own_ministry)
SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('P3 do ministério B', (SELECT s FROM pg_temp.starts), 6, pg_temp.ms(41));
RESET ROLE;

-- P4 relatórios (view_all_reports, sem ver membros)
SELECT pg_temp.login(4);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('P4', (SELECT s FROM pg_temp.starts), 4);
RESET ROLE;

-- P5 básico (pastor sem função)
SELECT pg_temp.login(5);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('P5', (SELECT s FROM pg_temp.starts), 4, '{}'::uuid[]);
RESET ROLE;

-- Sem cadastro de membro
SELECT pg_temp.login(7);
SET LOCAL ROLE authenticated;
SELECT * FROM pg_temp.tree_parity('Sem cadastro', (SELECT s FROM pg_temp.starts), 4);
RESET ROLE;

-- ===========================================================================
-- 9. RN-02: um nó com mais de 1000 discípulos diretos — 6 verificações
-- ===========================================================================
-- Confere o resultado (nada cortado), não o desempenho, que é medido à parte
-- com o volume de referência.
SET LOCAL session_replication_role = replica;
INSERT INTO public.members (id, name, gender, g12_level, leader_id, is_active, total_disciples)
VALUES (pg_temp.m(60), 'Vera Volume', 'F', 3, pg_temp.m(50), true, 1100);
INSERT INTO public.members (id, name, gender, g12_level, leader_id, is_active)
SELECT pg_temp.m(1000 + n), 'Volume ' || lpad(n::text, 4, '0'), 'F', 4, pg_temp.m(60), n % 12 <> 0
  FROM generate_series(1, 1200) n;
SET LOCAL session_replication_role = origin;

SELECT pg_temp.login(1);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT direct_disciples FROM public.ministry_tree_nodes(pg_temp.ms(50)) WHERE member_id = pg_temp.m(60)),
  1100::bigint, 'RN-02/P1: o nó conta 1.100 discípulos diretos ativos (os 100 inativos ficam fora), sem corte em 1000');
SELECT is((SELECT count(*)::int FROM public.ministry_tree_nodes(pg_temp.ms(60))), 1100,
  'RN-02/P1: abrir o nó devolve os 1.100, numa chamada');
SELECT set_eq(
  format('SELECT member_id FROM public.ministry_tree_nodes(%L)', pg_temp.ms(60)),
  format('SELECT id FROM public.members WHERE leader_id = %L AND is_active', pg_temp.m(60)),
  'RN-02/P1: os 1.100 são exatamente os ativos liderados lidos em members sob RLS');
RESET ROLE;

SELECT pg_temp.login(6);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT direct_disciples FROM public.ministry_tree_nodes(pg_temp.ms(50)) WHERE member_id = pg_temp.m(60)),
  1100::bigint, 'RN-02/P3 do ministério B: a mesma contagem no escopo do ministério');
SELECT is((SELECT count(*)::int FROM public.ministry_tree_nodes(pg_temp.ms(60))), 1100,
  'RN-02/P3 do ministério B: abrir o nó devolve os 1.100');
RESET ROLE;

SELECT pg_temp.login(3);
SET LOCAL ROLE authenticated;
SELECT is_empty(format('SELECT * FROM public.ministry_tree_nodes(%L)', pg_temp.ms(60)),
  'RN-05/P3 do ministério A: o mesmo nó, de outro ministério, não devolve ninguém');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
