-- E2.07 (PR 1): a lista de Membros com filtros (members_list e members_list_count), o vínculo celular
-- (members_view.cell_links) e o Dashboard (RN-11, RN-17), pela sessão de cada persona.
-- Spec: docs/specs/e2-07-filtros-membros.md ("Critérios por regra", "Massa de exemplo",
-- "Verificações obrigatórias (para o QA)"; RN-02 a RN-13, RN-15, RN-17; DA-1, DA-2, DA-4, DA-8).
-- Massa (dados fictícios): a do Negócio (19 pessoas, 5 células), montada como postgres com os triggers
-- ligados e as regras do E2.04. Os outros cadastros da base ficam excluídos dentro da transação (em
-- replica, desfeito no ROLLBACK), para os números absolutos de Rita (Administrador) valerem.
-- Datas relativas a sp_today() (hoje − 30 entra, hoje − 31 não), sem depender do relógio.
-- Os cenários que mudam dados rodam num bloco desfeito (pg_temp.scn) e devolvem o que leram.
-- Rodar com: supabase test db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(117);

-- ---------------------------------------------------------------------------
-- Massa
-- 1 Samuel, 2 Magda (pastores, casados); 3 Pedro (de Samuel) e 4 Paula (de Magda), casados;
-- 5 Tiago (de Samuel) e 6 Tânia (de Magda), casados; 7 André (de Pedro) e 8 Beatriz (de Tânia), casados;
-- 9 Caio e 10 Fábio (inativo), de André; 11 Gabriel, de Fábio; 12 Jonas, de Gabriel; 13 Carla, de Paula;
-- 14 Débora, de Beatriz; 15 Rita, de Tânia; 16 Diego e 17 Hugo, de Tiago; 18 Ester (sem liderança);
-- 19 Lúcia, de Ester; 20 Sara (de Pedro, bairro Centro, excluída).
-- Funções: Rita Administrador; Samuel, Magda, Pedro, Paula, André e Diego Líder; Caio, Carla, Fábio,
-- Beatriz, Ester e Jonas Membro; Hugo sem função.
-- Células: C1 André/Caio/Carla; C2 Diego/Hugo/Caio; C3 Débora/Rita/Beatriz; C4 Gabriel/Jonas/Fábio
-- (inativa); C5 Jonas/Gabriel/Fábio (excluída).
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.u(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('a2070000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.m(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('c2070000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('d2070000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.r(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
$$ SELECT ('e2070000-0000-0000-0000-' || lpad(_n::text, 12, '0'))::uuid $$;
CREATE FUNCTION pg_temp.mob(_n int) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT '5192070' || lpad(_n::text, 4, '0') $$;
CREATE FUNCTION pg_temp.role(_name text) RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT id FROM public.roles WHERE name = _name $$;

-- Isola a massa (desfeito no ROLLBACK).
SET LOCAL session_replication_role = replica;
UPDATE public.members SET deleted_at = now() WHERE deleted_at IS NULL;
SET LOCAL session_replication_role = origin;

INSERT INTO auth.users (id, email)
SELECT pg_temp.u(n), 'e207-' || n || '@teste.invalid' FROM generate_series(1, 20) n;

INSERT INTO public.members (id, name, gender, is_pastor, leader_id, has_leadership, auth_user_id, role_id, is_active, is_baptized, mobile_whatsapp) VALUES
  (pg_temp.m(1),  'Samuel Teste',  'M', true,  NULL,          false, pg_temp.u(1),  pg_temp.role('Líder'),  true,  true, pg_temp.mob(1)),
  (pg_temp.m(2),  'Magda Teste',   'F', true,  NULL,          false, pg_temp.u(2),  pg_temp.role('Líder'),  true,  true, pg_temp.mob(2)),
  (pg_temp.m(3),  'Pedro Teste',   'M', false, pg_temp.m(1),  true,  pg_temp.u(3),  pg_temp.role('Líder'),  true,  true, pg_temp.mob(3)),
  (pg_temp.m(4),  'Paula Teste',   'F', false, pg_temp.m(2),  true,  pg_temp.u(4),  pg_temp.role('Líder'),  true,  true, pg_temp.mob(4)),
  (pg_temp.m(5),  'Tiago Teste',   'M', false, pg_temp.m(1),  true,  pg_temp.u(5),  NULL,                   true,  true, pg_temp.mob(5)),
  (pg_temp.m(6),  'Tânia Teste',   'F', false, pg_temp.m(2),  true,  pg_temp.u(6),  NULL,                   true,  true, pg_temp.mob(6)),
  (pg_temp.m(7),  'André Teste',   'M', false, pg_temp.m(3),  true,  pg_temp.u(7),  pg_temp.role('Líder'),  true,  true, pg_temp.mob(7)),
  (pg_temp.m(8),  'Beatriz Teste', 'F', false, pg_temp.m(6),  true,  pg_temp.u(8),  pg_temp.role('Membro'), true,  true, pg_temp.mob(8)),
  (pg_temp.m(9),  'Caio Teste',    'M', false, pg_temp.m(7),  true,  pg_temp.u(9),  pg_temp.role('Membro'), true,  false, pg_temp.mob(9)),
  (pg_temp.m(10), 'Fábio Teste',   'M', false, pg_temp.m(7),  true,  pg_temp.u(10), pg_temp.role('Membro'), false, true, pg_temp.mob(10)),
  (pg_temp.m(11), 'Gabriel Teste', 'M', false, pg_temp.m(10), true,  pg_temp.u(11), NULL,                   true,  true, pg_temp.mob(11)),
  (pg_temp.m(12), 'Jonas Teste',   'M', false, pg_temp.m(11), true,  pg_temp.u(12), pg_temp.role('Membro'), true,  true, pg_temp.mob(12)),
  (pg_temp.m(13), 'Carla Teste',   'F', false, pg_temp.m(4),  true,  pg_temp.u(13), pg_temp.role('Membro'), true,  true, pg_temp.mob(13)),
  (pg_temp.m(14), 'Débora Teste',  'F', false, pg_temp.m(8),  true,  pg_temp.u(14), NULL,                   true,  true, pg_temp.mob(14)),
  (pg_temp.m(15), 'Rita Teste',    'F', false, pg_temp.m(6),  true,  pg_temp.u(15), pg_temp.role('Administrador'), true, true, pg_temp.mob(15)),
  (pg_temp.m(16), 'Diego Teste',   'M', false, pg_temp.m(5),  true,  pg_temp.u(16), pg_temp.role('Líder'),  true,  true, pg_temp.mob(16)),
  (pg_temp.m(17), 'Hugo Teste',    'M', false, pg_temp.m(5),  true,  pg_temp.u(17), NULL,                   true,  true, pg_temp.mob(17)),
  (pg_temp.m(18), 'Ester Teste',   'F', false, NULL,          false, pg_temp.u(18), pg_temp.role('Membro'), true,  true, pg_temp.mob(18)),
  (pg_temp.m(19), 'Lúcia Teste',   'F', false, pg_temp.m(18), true,  pg_temp.u(19), NULL,                   true,  true, pg_temp.mob(19)),
  (pg_temp.m(20), 'Sara Teste',    'F', false, pg_temp.m(3),  true,  pg_temp.u(20), NULL,                   true,  true, pg_temp.mob(20));
UPDATE public.members SET spouse_id = pg_temp.m(2) WHERE id = pg_temp.m(1);
UPDATE public.members SET spouse_id = pg_temp.m(4) WHERE id = pg_temp.m(3);
UPDATE public.members SET spouse_id = pg_temp.m(6) WHERE id = pg_temp.m(5);
UPDATE public.members SET spouse_id = pg_temp.m(8) WHERE id = pg_temp.m(7);
-- Dados sensíveis só de Caio e Pedro (RN-13); bairro Centro de Caio e Sara (RN-03, RN-06).
UPDATE public.members SET cpf = '52998224725', email = 'caio.e207@exemplo.com', street = 'Rua das Flores',
                          zip_code = '90010000', neighborhood = 'Centro', city = 'Porto Alegre' WHERE id = pg_temp.m(9);
UPDATE public.members SET cpf = '11144477735' WHERE id = pg_temp.m(3);
UPDATE public.members SET neighborhood = 'Centro' WHERE id = pg_temp.m(20);
UPDATE public.members SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.m(20);

INSERT INTO public.cells (id, leader_id, timothy_id, host_id, type, meeting_day, meeting_time) VALUES
  (pg_temp.c(1), pg_temp.m(7),  pg_temp.m(9),  pg_temp.m(13), 'Evangelística', 'Quarta', '20:00'),
  (pg_temp.c(2), pg_temp.m(16), pg_temp.m(17), pg_temp.m(9),  'Evangelística', 'Quinta', '20:00'),
  (pg_temp.c(3), pg_temp.m(14), pg_temp.m(15), pg_temp.m(8),  'Evangelística', 'Terça',  '19:30'),
  (pg_temp.c(4), pg_temp.m(11), pg_temp.m(12), pg_temp.m(10), 'Evangelística', 'Sábado', '10:00'),
  (pg_temp.c(5), pg_temp.m(12), pg_temp.m(11), pg_temp.m(10), 'Evangelística', 'Sexta',  '20:00');
UPDATE public.cells SET is_active = false WHERE id = pg_temp.c(4);
UPDATE public.cells SET deleted_at = now(), deleted_by = pg_temp.m(15) WHERE id = pg_temp.c(5);

-- ---------------------------------------------------------------------------
-- Leitura "pela API": papel authenticated com o JWT de um membro da massa. Devolve o jsonb da
-- consulta, ou {"error": SQLSTATE}.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.run_as(_n int, _sql text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _v jsonb; _state text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pg_temp.u(_n), 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    EXECUTE _sql INTO _v;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS _state = RETURNED_SQLSTATE;
    _v := jsonb_build_object('error', _state);
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN _v;
END $$;
CREATE FUNCTION pg_temp.args(_args text) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT CASE WHEN _args ~ '_limit' THEN _args ELSE concat_ws(', ', nullif(_args, ''), '_limit => 100') END $$;
-- Os primeiros nomes, na ordem da lista.
CREATE FUNCTION pg_temp.list(_n int, _args text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _v jsonb := pg_temp.run_as(_n, format(
  'SELECT coalesce(jsonb_agg(split_part(t.name, '' '', 1) ORDER BY t.ordinality), ''[]'') FROM public.members_list(%s) WITH ORDINALITY t',
  pg_temp.args(_args)));
BEGIN
  IF jsonb_typeof(_v) = 'object' THEN RETURN ARRAY['erro ' || (_v ->> 'error')]; END IF;
  RETURN ARRAY(SELECT jsonb_array_elements_text(_v));
END $$;
-- Ordem fixa para comparar conjuntos.
CREATE FUNCTION pg_temp.srt(VARIADIC _v text[]) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT coalesce(array_agg(x ORDER BY x COLLATE "C"), '{}') FROM unnest(_v) x $$;
CREATE FUNCTION pg_temp.names(_n int, _args text DEFAULT '') RETURNS text[] LANGUAGE sql AS
$$ SELECT pg_temp.srt(VARIADIC pg_temp.list(_n, _args)) $$;
CREATE FUNCTION pg_temp.cnt(_n int, _args text DEFAULT '') RETURNS text LANGUAGE sql AS
$$ SELECT pg_temp.run_as(_n, format('SELECT to_jsonb(public.members_list_count(%s))', _args))::text $$;
-- Todas as páginas, de _size em _size: os ids na ordem em que vieram.
CREATE FUNCTION pg_temp.pages(_n int, _size int, _args text DEFAULT '') RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE _all text[] := '{}'; _page jsonb; _off int := 0;
BEGIN
  LOOP
    _page := pg_temp.run_as(_n, format(
      'SELECT coalesce(jsonb_agg(t.id ORDER BY t.ordinality), ''[]'') FROM public.members_list(%s) WITH ORDINALITY t',
      concat_ws(', ', nullif(_args, ''), format('_limit => %s, _offset => %s', _size, _off))));
    EXIT WHEN jsonb_typeof(_page) <> 'array' OR jsonb_array_length(_page) = 0 OR _off > 1000;
    _all := _all || ARRAY(SELECT jsonb_array_elements_text(_page));
    _off := _off + _size;
  END LOOP;
  RETURN _all;
END $$;
CREATE FUNCTION pg_temp.ids(VARIADIC _n int[]) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT quote_literal(array_agg(pg_temp.m(n))::text) FROM unnest(_n) n $$;
-- Cenário: aplica os comandos (como postgres), lê as consultas e DESFAZ tudo.
CREATE FUNCTION pg_temp.scn(_cmds text[], _qs text[]) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb := '[]'; _c text; _v jsonb;
BEGIN
  BEGIN
    FOREACH _c IN ARRAY _cmds LOOP EXECUTE _c; END LOOP;
    FOREACH _c IN ARRAY _qs LOOP EXECUTE _c INTO _v; _r := _r || jsonb_build_array(_v); END LOOP;
    RAISE EXCEPTION 'e207 rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'e207 rollback' THEN RAISE; END IF;
  END;
  RETURN _r;
END $$;
CREATE FUNCTION pg_temp.ja(_v jsonb) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT pg_temp.srt(VARIADIC ARRAY(SELECT jsonb_array_elements_text(_v))) $$;

-- ===========================================================================
-- RN-03, RN-15: escopo e ordem
-- ===========================================================================
SELECT is(pg_temp.list(15),
  ARRAY['Magda', 'Samuel', 'Lúcia', 'Paula', 'Pedro', 'Tânia', 'Tiago', 'André', 'Beatriz', 'Carla', 'Diego',
        'Hugo', 'Rita', 'Caio', 'Débora', 'Fábio', 'Gabriel', 'Jonas', 'Ester'],
  'RN-15: Rita sem filtros: por nível, nome sem acento, e quem está sem liderança por último');
SELECT is(pg_temp.list(15, '_is_active => true'),
  ARRAY['Magda', 'Samuel', 'Lúcia', 'Paula', 'Pedro', 'Tânia', 'Tiago', 'André', 'Beatriz', 'Carla', 'Diego',
        'Hugo', 'Rita', 'Caio', 'Débora', 'Gabriel', 'Jonas', 'Ester'],
  'RN-15: com Situação: Ativo, a ordem dos que ficam é a mesma');
SELECT is(pg_temp.cnt(15), '19', 'RN-01: Rita sem filtros: total 19 (Sara, excluída, fora)');
SELECT is(pg_temp.names(16, '_levels => ''{2}'''), pg_temp.srt('Diego', 'Hugo', 'Beatriz', 'Rita'),
  'RN-03: Diego, nível 144: Diego, Hugo, Beatriz e Rita (não André nem Carla)');
SELECT is(pg_temp.names(1, '_levels => ''{1}'''), pg_temp.srt('Pedro', 'Paula', 'Tiago', 'Tânia'),
  'RN-03: Samuel, G12: sem Lúcia, fora do escopo dele');
SELECT is(pg_temp.list(17, '_levels => ''{2}'''), ARRAY['Hugo'], 'RN-03: Hugo (sem função) recebe no máximo o próprio cadastro');
SELECT is(pg_temp.cnt(17, '_leader_ids => ' || pg_temp.ids(5)), '0', 'RN-03: Hugo com a Liderança de quem ele não vê: total 0');
SELECT is(pg_temp.names(15, '_neighborhood => ''Centro'''), ARRAY['Caio'], 'RN-03: Sara (Centro, excluída) não aparece');
SELECT is(pg_temp.cnt(15, '_neighborhood => ''Centro'''), '1', 'RN-03: e não conta no total');

-- Paridade com a members_view (E2.02): todas as páginas da lista sem filtros = a view, e o total.
CREATE FUNCTION pg_temp.parity(_n int) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE _p text[] := pg_temp.pages(_n, 4);
        _v text[] := ARRAY(SELECT jsonb_array_elements_text(pg_temp.run_as(_n, 'SELECT coalesce(jsonb_agg(id), ''[]'') FROM public.members_view')));
BEGIN
  RETURN cardinality(_p) = (SELECT count(DISTINCT x) FROM unnest(_p) x)
     AND pg_temp.srt(VARIADIC _p) = pg_temp.srt(VARIADIC _v)
     AND pg_temp.cnt(_n) = cardinality(_v)::text;
END $$;
SELECT ok(pg_temp.parity(n), 'paridade (E2.02): ' || nm || ': as páginas de 4 em 4 e o total são os da members_view')
  FROM (VALUES (15, 'Rita'), (1, 'Samuel'), (3, 'Pedro'), (7, 'André'), (16, 'Diego'), (18, 'Ester'), (17, 'Hugo')) p(n, nm);

-- ===========================================================================
-- RN-02: combinação
-- ===========================================================================
SELECT is(pg_temp.names(15, '_levels => ''{2}'', _cell_links => ''{leader}'''), pg_temp.srt('André', 'Diego'),
  'RN-02: Nível 144 e Vínculo: Líder = André e Diego');
SELECT is(pg_temp.cnt(15, '_levels => ''{2}'', _cell_links => ''{leader}'''), '2', 'RN-02: total 2');
SELECT is(pg_temp.names(15, '_levels => ''{2,3}'', _is_active => true'),
  pg_temp.srt('André', 'Beatriz', 'Carla', 'Diego', 'Hugo', 'Rita', 'Caio', 'Débora'),
  'RN-02: Nível 144 e 1.728, Situação: Ativo = 8, sem Fábio');
SELECT is(pg_temp.cnt(15, '_search => ''{%carla%}'', _levels => ''{3}'''), '0', 'RN-02: busca Carla com Nível 1.728: vazia');

-- ===========================================================================
-- RN-04, RN-05, DA-2: Liderança
-- ===========================================================================
SELECT is(pg_temp.names(15, '_leader_ids => ' || pg_temp.ids(7)), pg_temp.srt('Caio', 'Fábio', 'Gabriel', 'Jonas'),
  'RN-04: Liderança André = Caio, Fábio, Gabriel e Jonas (sem André)');
SELECT is(pg_temp.names(15, '_leader_ids => ' || pg_temp.ids(7) || ', _is_active => true'), pg_temp.srt('Caio', 'Gabriel', 'Jonas'),
  'RN-04: com Situação: Ativo, Fábio sai e Gabriel e Jonas continuam abaixo de André por meio dele');
SELECT is(pg_temp.names(15, '_leader_ids => ' || pg_temp.ids(3)), pg_temp.srt('André', 'Caio', 'Fábio', 'Gabriel', 'Jonas'),
  'RN-04: Liderança Pedro = 5, sem Carla (de Paula) nem Beatriz');
SELECT is(pg_temp.names(15, '_leader_ids => ' || pg_temp.ids(3, 4)), pg_temp.srt('André', 'Caio', 'Fábio', 'Gabriel', 'Jonas', 'Carla'),
  'RN-04: Pedro e Paula = 6 (o casal se escolhe pelos dois)');
SELECT is(pg_temp.names(15, '_leader_ids => ' || pg_temp.ids(3, 7)), pg_temp.srt('André', 'Caio', 'Fábio', 'Gabriel', 'Jonas'),
  'RN-04: Pedro e André: André aparece porque está abaixo de Pedro');
SELECT is(pg_temp.names(15, '_leader_ids => ' || pg_temp.ids(18)), ARRAY['Lúcia'], 'RN-04: Liderança Ester = Lúcia');
SELECT is(pg_temp.cnt(15, '_leader_ids => ' || pg_temp.ids(9)), '0', 'RN-04: Caio (sem discípulos): vazia');
-- 12 ids (com repetido e nulo): valem os 10 primeiros distintos. Os dois últimos (Tiago e Pedro) trariam mais gente.
SELECT is(pg_temp.names(15, format('_leader_ids => %L',
  ARRAY[pg_temp.m(9), pg_temp.m(12), pg_temp.m(13), pg_temp.m(9), NULL, pg_temp.m(14), pg_temp.m(15), pg_temp.m(16),
        pg_temp.m(17), pg_temp.m(19), pg_temp.m(11), pg_temp.m(18), pg_temp.m(5), pg_temp.m(3)]::text)),
  pg_temp.srt('Jonas', 'Lúcia'), 'RN-04, DA-2: 12 pessoas valem as 10 primeiras distintas, sem nulos (Tiago e Pedro, 11ª e 12ª, não contam)');
SELECT is(pg_temp.cnt(3, '_leader_ids => ' || pg_temp.ids(5)), '0', 'RN-05: Pedro com Liderança Tiago (não visível): total 0');
SELECT is(pg_temp.list(3, '_leader_ids => ' || pg_temp.ids(5)), '{}'::text[], 'RN-05: e a página vem vazia, sem erro');
SELECT is(pg_temp.names(3, '_leader_ids => ' || pg_temp.ids(5, 7)), pg_temp.srt('Caio', 'Fábio', 'Gabriel', 'Jonas'),
  'RN-05: Tiago e André: valem só os de André');
SELECT is(pg_temp.cnt(3, '_leader_ids => ' || pg_temp.ids(20)), '0', 'RN-05: excluída (Sara): a mesma resposta');
SELECT is(pg_temp.cnt(3, '_leader_ids => ''{f2070000-0000-0000-0000-000000000099}'''), '0', 'RN-05: inexistente: a mesma resposta');
SELECT is(pg_temp.names(3, '_leader_ids => ' || pg_temp.ids(20, 7)), pg_temp.srt('Caio', 'Fábio', 'Gabriel', 'Jonas'),
  'RN-05: excluída junto com uma pessoa visível: valem só os da visível');
SELECT is(pg_temp.cnt(9, '_leader_ids => ' || pg_temp.ids(9)), '0', 'RN-03: Caio (Membro) com a própria Liderança: ninguém abaixo dele');
SELECT ok(NOT (SELECT array_agg(attname::text) FROM pg_attribute WHERE attrelid = 'public.members_view'::regclass AND attnum > 0)
              && ARRAY['ancestor_ids', 'g12_level_path', 'leadership_ids'],
  'RN-05: nenhuma coluna da resposta tem a cadeia');

-- ===========================================================================
-- RN-06: bairro e cidade (cenário com cadastros a mais, desfeito)
-- ===========================================================================
CREATE TEMP TABLE s_rn06 AS SELECT pg_temp.scn(ARRAY[
  format($q$INSERT INTO public.members (id, name, gender, leader_id, mobile_whatsapp, neighborhood, city) VALUES
    (%L, 'Ana Teste', 'F', %L, %L, 'São João', NULL),
    (%L, 'Bruno Teste', 'M', %L, %L, 'Sao Joao', NULL),
    (%L, 'Davi Teste', 'M', %L, %L, 'Jardim São João do Sul', NULL),
    (%L, 'Elisa Teste', 'F', %L, %L, NULL, NULL),
    (%L, 'Gil Teste', 'M', %L, %L, NULL, 'Porto Alegre'),
    (%L, 'Íris Teste', 'F', %L, %L, NULL, 'Alegrete'),
    (%L, 'Percy Teste', 'M', %L, %L, 'Vila 100%%', NULL),
    (%L, 'Quitéria Teste', 'F', %L, %L, E'Beco_do \\ "Sol"', NULL)$q$,
    pg_temp.m(31), pg_temp.m(6), pg_temp.mob(31), pg_temp.m(32), pg_temp.m(6), pg_temp.mob(32),
    pg_temp.m(33), pg_temp.m(6), pg_temp.mob(33), pg_temp.m(34), pg_temp.m(6), pg_temp.mob(34),
    pg_temp.m(35), pg_temp.m(6), pg_temp.mob(35), pg_temp.m(36), pg_temp.m(6), pg_temp.mob(36),
    pg_temp.m(37), pg_temp.m(6), pg_temp.mob(37), pg_temp.m(38), pg_temp.m(6), pg_temp.mob(38))],
  ARRAY[
    $q$SELECT to_jsonb(pg_temp.names(15, '_neighborhood => ''  sao   JOÃO '''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(15, '_neighborhood => ''%'''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(15, '_neighborhood => ''_'''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(15, E'_neighborhood => ''\\'''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(15, '_neighborhood => ''"'''))$q$,
    $q$SELECT to_jsonb(pg_temp.cnt(15, '_neighborhood => '''''''''))$q$,
    $q$SELECT to_jsonb(pg_temp.cnt(15, $x$_neighborhood => $y$'); DROP TABLE public.members; --$y$, _search => '{%''); DELETE FROM public.members; --%}'$x$))$q$,
    $q$SELECT to_jsonb(pg_temp.names(15, '_city => ''alegre'''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(3, '_neighborhood => ''centro'''))$q$,
    $q$SELECT to_jsonb(to_regclass('public.members') IS NOT NULL AND (SELECT count(*) FROM public.members WHERE deleted_at IS NULL) > 19)$q$
  ]) AS v;
SELECT is(pg_temp.ja((SELECT v -> 0 FROM s_rn06)), pg_temp.srt('Ana', 'Bruno', 'Davi'),
  'RN-06: "  sao   JOÃO " acha Ana, Bruno e Davi (sem acento, maiúsculas e espaços), não Elisa (sem bairro)');
SELECT is(pg_temp.ja((SELECT v -> 1 FROM s_rn06)), ARRAY['Percy'], 'RN-06: "%" é texto (só quem tem % no bairro)');
SELECT is(pg_temp.ja((SELECT v -> 2 FROM s_rn06)), ARRAY['Quitéria'], 'RN-06: "_" é texto');
SELECT is(pg_temp.ja((SELECT v -> 3 FROM s_rn06)), ARRAY['Quitéria'], 'RN-06: "\" é texto');
SELECT is(pg_temp.ja((SELECT v -> 4 FROM s_rn06)), ARRAY['Quitéria'], 'RN-06: aspas duplas são texto');
SELECT is((SELECT v ->> 5 FROM s_rn06), '0', 'RN-06: aspas simples: nenhum cadastro, sem erro');
SELECT is((SELECT v ->> 6 FROM s_rn06), '0', 'risco 1: texto malicioso em bairro e busca: tratado como texto, sem erro');
SELECT is(pg_temp.ja((SELECT v -> 7 FROM s_rn06)), pg_temp.srt('Caio', 'Gil', 'Íris'), 'RN-06: Cidade "alegre" = Porto Alegre (Caio, Gil) e Alegrete (Íris)');
SELECT is(pg_temp.ja((SELECT v -> 8 FROM s_rn06)), ARRAY['Caio'], 'RN-06, RN-13: Pedro acha Caio pelo bairro, mesmo sem ver a rua e o CEP dele');
SELECT is((SELECT v ->> 9 FROM s_rn06), 'true', 'risco 1: nada foi apagado pelos textos maliciosos');

-- ===========================================================================
-- RN-07, RN-08, RN-09
-- ===========================================================================
SELECT is(pg_temp.cnt(15, '_is_active => true'), '18', 'RN-07: Situação: Ativo = 18');
SELECT is(pg_temp.list(15, '_is_active => false'), ARRAY['Fábio'], 'RN-07: Situação: Inativo = Fábio');
SELECT ok('Fábio' = ANY (pg_temp.list(15, '_is_baptized => true')) AND NOT 'Caio' = ANY (pg_temp.list(15, '_is_baptized => true')),
  'RN-07: Batizado: Sim tem Fábio (inativo) e não Caio');
SELECT is(pg_temp.list(15, '_is_baptized => false'), ARRAY['Caio'], 'RN-07: Batizado: Não = Caio');
SELECT is(pg_temp.names(15, '_leadership => ''{pastor}'''), pg_temp.srt('Samuel', 'Magda'), 'RN-08: Pastor(a) = Samuel e Magda');
SELECT is(pg_temp.list(15, '_leadership => ''{no_leadership}'''), ARRAY['Ester'], 'RN-08: Sem liderança = Ester');
SELECT is(pg_temp.cnt(15, '_leadership => ''{with_leader}'''), '16', 'RN-08: Com líder = os outros 16');
SELECT ok('Lúcia' = ANY (pg_temp.list(15, '_leadership => ''{with_leader}''')), 'RN-08: Lúcia (abaixo de Ester) está em Com líder');
SELECT is(pg_temp.cnt(15, '_leadership => ''{with_leader,pastor}'''), '18', 'RN-08: Com líder e Pastor(a) = 18 ("Possui Liderança: Sim")');
SELECT is(pg_temp.cnt(15, '_leadership => ''{with_leader,no_leadership,pastor}'''), '19', 'DA-8: as três situações = sem filtro');
SELECT is(pg_temp.list(18, '_leadership => ''{no_leadership}'''), ARRAY['Ester'], 'RN-08: Ester, Sem liderança = só ela');
SELECT is(pg_temp.names(15, '_levels => ''{0}'''), pg_temp.srt('Samuel', 'Magda'), 'RN-09: Pastores');
SELECT is(pg_temp.names(15, '_levels => ''{1}'''), pg_temp.srt('Pedro', 'Paula', 'Tiago', 'Tânia', 'Lúcia'), 'RN-09: G12 (com Lúcia, abaixo de Ester)');
SELECT is(pg_temp.names(15, '_levels => ''{3}'''), pg_temp.srt('Caio', 'Débora', 'Fábio'), 'RN-09: 1.728 (com Fábio, inativo)');
SELECT is(pg_temp.list(15, '_levels => ''{4}'''), ARRAY['Gabriel'], 'RN-09: 20.736');
SELECT is(pg_temp.list(15, '_levels => ''{5}'''), ARRAY['Jonas'], 'RN-09: Nível 5 ou mais');
SELECT is(pg_temp.cnt(15, '_levels => ''{0,1,2,3,4,5}'''), '18', 'RN-09, DA-8: as seis opções deixam de fora quem está sem liderança (Ester)');
SELECT is(pg_temp.cnt(15, '_levels => ''{1,2}'''), '11', 'RN-09: G12 e 144 = 11');
SELECT is((SELECT v ->> 0 FROM (SELECT pg_temp.scn(
    ARRAY[format('SELECT pg_temp.run_as(15, %L)', format('WITH w AS (UPDATE public.members SET leader_id = %L WHERE id = %L RETURNING 1) SELECT to_jsonb(count(*)) FROM w', pg_temp.m(3), pg_temp.m(12)))],
    ARRAY[$q$SELECT to_jsonb('Jonas' = ANY (pg_temp.list(15, '_levels => ''{2}''')))$q$]) AS v) x),
  'true', 'RN-09: Rita troca o líder de Jonas para Pedro, e Jonas aparece em 144 na consulta seguinte');

-- ===========================================================================
-- RN-10: vínculo celular
-- ===========================================================================
SELECT is(pg_temp.names(15, '_cell_links => ''{leader}'''), pg_temp.srt('André', 'Diego', 'Débora'), 'RN-10 a: Líder (Gabriel, de C4 inativa, e Jonas, de C5 excluída, fora)');
SELECT is(pg_temp.names(15, '_cell_links => ''{timothy}'''), pg_temp.srt('Caio', 'Hugo', 'Rita'), 'RN-10 b: Timóteo');
SELECT is(pg_temp.names(15, '_cell_links => ''{host}'''), pg_temp.srt('Carla', 'Caio', 'Beatriz'), 'RN-10 c: Anfitrião');
SELECT is(pg_temp.cnt(15, '_cell_links => ''{attendee}'''), '0', 'RN-10 d: Participante: ninguém sem relatórios');
SELECT is(pg_temp.names(15, '_cell_links => ''{none}'''), pg_temp.srt('Paula', 'Fábio', 'Gabriel', 'Jonas', 'Ester', 'Lúcia'), 'RN-10 e: Sem vínculo');
SELECT is(pg_temp.cnt(15, '_cell_links => ''{leader,timothy,host,attendee,none}'''), '14',
  'RN-10, DA-8: as cinco opções deixam de fora Samuel, Magda (pastores), Pedro, Tiago e Tânia (célula ativa abaixo)');
SELECT is(pg_temp.names(15, '_cell_links => ''{leader,timothy}'''), pg_temp.srt('André', 'Diego', 'Débora', 'Caio', 'Hugo', 'Rita'), 'RN-10: Líder e Timóteo');
SELECT is(pg_temp.run_as(15, format('SELECT jsonb_object_agg(split_part(name, '' '', 1), cell_links) FROM public.members_view WHERE id IN (%L, %L)', pg_temp.m(3), pg_temp.m(4))),
  '{"Paula": ["none"], "Pedro": []}'::jsonb, 'RN-10: casal: Paula em Sem vínculo e Pedro em nenhuma (o vínculo é de cada pessoa)');
SELECT is(pg_temp.run_as(15, format('SELECT to_jsonb(cell_links) FROM public.members_view WHERE id = %L', pg_temp.m(9))),
  '["timothy", "host"]'::jsonb, 'RN-10: as categorias se somam (Caio: Timóteo e Anfitrião)');

-- Relatórios (como a carga do legado, em replica): datas relativas a hoje.
CREATE TEMP TABLE s_rn10 AS SELECT pg_temp.scn(ARRAY[
  'SET LOCAL session_replication_role = replica',
  format($q$INSERT INTO public.cell_reports (id, cell_id, date, time, theme, was_held, deleted_at) VALUES
    (%L, %L, public.sp_today() - 30, '20:00', 'T', true,  NULL),    -- C1, hoje - 30, Paula
    (%L, %L, public.sp_today() - 31, '20:00', 'T', true,  NULL),    -- C2, hoje - 31, Jonas
    (%L, %L, public.sp_today() - 9,  '19:30', NULL, false, NULL),   -- C3, não houve, Ester
    (%L, %L, public.sp_today() - 7,  '20:00', 'T', true,  now()),   -- C2, excluído, Carla
    (%L, %L, public.sp_today() - 6,  '20:00', 'T', true,  NULL),    -- C5 (excluída), Lúcia
    (%L, %L, public.sp_today() - 8,  '20:00', 'T', true,  NULL),    -- C1, Fábio (inativo)
    (%L, %L, public.sp_today() - 16, '19:30', 'T', true,  NULL)$q$, -- C3, Gabriel
    pg_temp.r(1), pg_temp.c(1), pg_temp.r(2), pg_temp.c(2), pg_temp.r(3), pg_temp.c(3), pg_temp.r(4), pg_temp.c(2),
    pg_temp.r(5), pg_temp.c(5), pg_temp.r(6), pg_temp.c(1), pg_temp.r(7), pg_temp.c(3)),
  format($q$INSERT INTO public.cell_report_participants (report_id, member_id) VALUES
    (%L, %L), (%L, %L), (%L, %L), (%L, %L), (%L, %L), (%L, %L), (%L, %L)$q$,
    pg_temp.r(1), pg_temp.m(4), pg_temp.r(2), pg_temp.m(12), pg_temp.r(3), pg_temp.m(18), pg_temp.r(4), pg_temp.m(13),
    pg_temp.r(5), pg_temp.m(19), pg_temp.r(6), pg_temp.m(10), pg_temp.r(7), pg_temp.m(11)),
  'SET LOCAL session_replication_role = origin'],
  ARRAY[
    $q$SELECT to_jsonb(pg_temp.names(15, '_cell_links => ''{attendee}'''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(15, '_cell_links => ''{none}'''))$q$,
    $q$SELECT to_jsonb(pg_temp.names(3, '_cell_links => ''{attendee}'''))$q$,
    format('SELECT pg_temp.run_as(3, %L)', format('SELECT to_jsonb(count(*)) FROM public.cell_reports_view WHERE id = %L', pg_temp.r(7))),
    format('SELECT pg_temp.run_as(15, %L)', format('SELECT to_jsonb(cell_links) FROM public.members_view WHERE id = %L', pg_temp.m(13))),
    $q$SELECT to_jsonb(pg_temp.run_as(15, 'SELECT to_jsonb(d.members_without_cell_link) FROM public.dashboard_summary() d')::text = pg_temp.cnt(15, '_is_active => true, _cell_links => ''{none}'''))$q$
  ]) AS v;
SELECT is(pg_temp.ja((SELECT v -> 0 FROM s_rn10)), pg_temp.srt('Paula', 'Lúcia', 'Fábio', 'Gabriel'),
  'RN-10 d: Participante = Paula (hoje − 30), Lúcia (célula excluída, DA-1 do E2.01), Fábio (inativo), Gabriel; não Jonas (hoje − 31), Ester (não houve) nem Carla (relatório excluído)');
SELECT is(pg_temp.ja((SELECT v -> 1 FROM s_rn10)), pg_temp.srt('Jonas', 'Ester'),
  'RN-10 e: Sem vínculo fica com Jonas (hoje − 31) e Ester ("Não houve célula" não é participação)');
SELECT is(pg_temp.ja((SELECT v -> 2 FROM s_rn10)), pg_temp.srt('Paula', 'Fábio', 'Gabriel'),
  'RN-10: Pedro, que não vê C3, acha Gabriel em Participante (conta toda a igreja)');
SELECT is((SELECT v ->> 3 FROM s_rn10), '0', 'RN-10: e continua sem ver o relatório de C3');
SELECT is((SELECT v -> 4 FROM s_rn10), '["host"]'::jsonb, 'RN-10: relatório excluído não dá Participante (Carla fica só com Anfitrião)');
SELECT is((SELECT v ->> 5 FROM s_rn10), 'true', 'RN-11: com relatórios, o card de Rita continua igual ao total da lista');

SELECT is((SELECT pg_temp.ja(v -> 0) FROM (SELECT pg_temp.scn(
    ARRAY[format('UPDATE public.cells SET is_active = true WHERE id = %L', pg_temp.c(4))],
    ARRAY[$q$SELECT jsonb_build_array(pg_temp.names(15, '_cell_links => ''{none}''')) -> 0$q$]) AS v) x),
  pg_temp.srt('Paula', 'Ester', 'Lúcia'), 'RN-10: reativar C4 tira Gabriel, Jonas e Fábio de Sem vínculo');
SELECT is((SELECT v FROM (SELECT pg_temp.scn(
    ARRAY[format('UPDATE public.cells SET is_active = true WHERE id = %L', pg_temp.c(4))],
    ARRAY[format('SELECT pg_temp.run_as(15, %L)', format('SELECT jsonb_object_agg(split_part(name, '' '', 1), cell_links) FROM public.members_view WHERE id IN (%L, %L, %L)', pg_temp.m(10), pg_temp.m(11), pg_temp.m(12)))]) -> 0 AS v) x),
  '{"Fábio": ["host"], "Gabriel": ["leader"], "Jonas": ["timothy"]}'::jsonb, 'RN-10: e os põe em Líder, Timóteo e Anfitrião');
SELECT is((SELECT v ->> 0 FROM (SELECT pg_temp.scn(
    ARRAY[format('UPDATE public.cells SET is_active = false WHERE id = %L', pg_temp.c(3))],
    ARRAY[$q$SELECT to_jsonb('Magda' = ANY (pg_temp.list(15, '_cell_links => ''{none}''')))$q$]) AS v) x),
  'false', 'P-FIL-10: com C3 inativa, Magda (pastora) continua fora de Sem vínculo');

-- ===========================================================================
-- RN-11, RN-17: cada card de membros = a lista com o equivalente
-- ===========================================================================
CREATE FUNCTION pg_temp.cards(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT pg_temp.run_as(_n, 'SELECT jsonb_build_array(d.members_total, d.members_active, d.members_inactive, d.members_baptized,
                                 d.members_not_baptized, d.members_without_leader, d.members_without_cell_link) FROM public.dashboard_summary() d') $$;
CREATE FUNCTION pg_temp.equiv(_n int) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(pg_temp.cnt(_n)::bigint, pg_temp.cnt(_n, '_is_active => true')::bigint,
    pg_temp.cnt(_n, '_is_active => false')::bigint, pg_temp.cnt(_n, '_is_baptized => true')::bigint,
    pg_temp.cnt(_n, '_is_baptized => false')::bigint,
    pg_temp.cnt(_n, '_is_active => true, _leadership => ''{no_leadership}''')::bigint,
    pg_temp.cnt(_n, '_is_active => true, _cell_links => ''{none}''')::bigint) $$;
SELECT is(pg_temp.cards(n), pg_temp.equiv(n), 'RN-17: ' || nm || ': cada card de membros = o total da lista com o equivalente')
  FROM (VALUES (15, 'Rita'), (3, 'Pedro'), (16, 'Diego'), (18, 'Ester'), (1, 'Samuel')) p(n, nm);
SELECT is(pg_temp.cards(15), '[19, 18, 1, 18, 1, 1, 5]'::jsonb, 'RN-11, RN-17: Rita: 19, 18 ativos, 1 inativo, Sem Liderança 1 (Ester), Sem Vínculo 5');
SELECT is(pg_temp.cards(3) -> 6, '3'::jsonb, 'RN-11: Pedro: Sem Vínculo 3 (Paula, Gabriel e Jonas)');
SELECT is(pg_temp.cards(16) -> 6, '0'::jsonb, 'RN-11: Diego: Sem Vínculo 0');
SELECT is(pg_temp.cnt(16, '_is_active => true, _cell_links => ''{none}'''), '0', 'RN-11: e a lista de Diego com o equivalente fica vazia');

-- ===========================================================================
-- RN-12: datas de cadastro (cenário com cadastros a mais, desfeito)
-- ===========================================================================
CREATE TEMP TABLE s_rn12 AS SELECT pg_temp.scn(ARRAY[
  format($q$INSERT INTO public.members (id, name, gender, leader_id, mobile_whatsapp) VALUES
    (%L, 'Ana Teste', 'F', %L, %L), (%L, 'Bruno Teste', 'M', %L, %L), (%L, 'Célia Teste', 'F', %L, %L)$q$,
    pg_temp.m(41), pg_temp.m(6), pg_temp.mob(41), pg_temp.m(42), pg_temp.m(6), pg_temp.mob(42), pg_temp.m(43), pg_temp.m(6), pg_temp.mob(43)),
  'SET LOCAL session_replication_role = replica',
  format($q$UPDATE public.members SET created_at = '2026-11-21 23:30-03' WHERE id = %L$q$, pg_temp.m(41)),
  format($q$UPDATE public.members SET created_at = '2026-11-22 00:10-03' WHERE id = %L$q$, pg_temp.m(42)),
  format($q$UPDATE public.members SET created_at = NULL, created_by = NULL, created_by_kind = 'unknown' WHERE id = %L$q$, pg_temp.m(43)),
  'SET LOCAL session_replication_role = origin'],
  ARRAY[
    $q$SELECT to_jsonb(pg_temp.list(15, '_created_to => ''2026-11-21'''))$q$,
    $q$SELECT to_jsonb(pg_temp.list(15, '_created_from => ''2026-11-22'''))$q$,
    $q$SELECT to_jsonb(pg_temp.list(15, '_created_from => ''2026-11-21'', _created_to => ''2026-11-21'''))$q$,
    $q$SELECT to_jsonb(pg_temp.list(15))$q$,
    $q$SELECT to_jsonb(pg_temp.cnt(15, '_created_from => ''2026-11-25'', _created_to => ''2026-11-20''') = pg_temp.cnt(15))$q$,
    $q$SELECT to_jsonb(pg_temp.list(15, '_created_from => ''2026-11-22'', _created_to => ''2026-11-28'''))$q$,
    $q$SELECT to_jsonb(pg_temp.cnt(15, format('_created_to => %L', public.sp_today() + 2)) = pg_temp.cnt(15, '_created_from => ''1900-01-01'''))$q$,
    $q$SELECT to_jsonb(pg_temp.cnt(15, format('_created_from => %L', public.sp_today())))$q$
  ]) AS v;
SELECT is((SELECT v -> 0 FROM s_rn12), '["Ana"]'::jsonb, 'RN-12: até 21/11 = Ana (23:30 de Brasília é 02:30 UTC de 22/11), sem Bruno nem Célia');
SELECT ok((SELECT (v -> 1) ? 'Bruno' AND NOT (v -> 1) ? 'Ana' AND NOT (v -> 1) ? 'Célia' FROM s_rn12), 'RN-12: a partir de 22/11 tem Bruno, não Ana nem Célia');
SELECT is((SELECT v -> 2 FROM s_rn12), '["Ana"]'::jsonb, 'RN-12: de 21/11 até 21/11 = só Ana (os dois dias entram)');
SELECT ok((SELECT (v -> 3) ? 'Célia' FROM s_rn12), 'RN-12: sem filtro de data, Célia ("data não registrada") aparece');
SELECT is((SELECT v ->> 4 FROM s_rn12), 'true', 'DA-4: datas invertidas: o filtro de data não é aplicado');
SELECT ok((SELECT (v -> 5) ? 'Bruno' AND NOT (v -> 5) ? 'Ana' FROM s_rn12), 'RN-17: "Novos membros" de 22/11 a 28/11: Bruno sim, Ana não');
SELECT is((SELECT v ->> 6 FROM s_rn12), 'true', 'RN-12: data futura em "até" é aceita (todos os com data até hoje + 2)');
SELECT is((SELECT v ->> 7 FROM s_rn12), '19', 'RN-12: a partir de hoje = a massa (cadastrada hoje), sem Ana, Bruno nem Célia');

-- ===========================================================================
-- RN-13: máscara
-- ===========================================================================
SELECT is(pg_temp.cnt(3, '_search => ''{%52998224725%}'''), '0', 'RN-13: Pedro não acha Caio pelo CPF');
SELECT is(pg_temp.cnt(3, '_search => ''{%caio.e207@exemplo.com%}'''), '0', 'RN-13: nem pelo e-mail');
SELECT is(pg_temp.list(3, '_search => ''{%11144477735%}'''), ARRAY['Pedro'], 'RN-13: Pedro acha o próprio cadastro pelo CPF');
SELECT is(pg_temp.list(15, '_search => ''{%52998224725%}'''), ARRAY['Caio'], 'RN-13: Rita (Ver Dados Sensíveis) acha Caio pelo CPF');
SELECT is(pg_temp.run_as(3, format($q$SELECT to_jsonb(count(*)) FROM public.members_list() t
                                       WHERE t.cpf = '52998224725' OR t.email = 'caio.e207@exemplo.com' OR t.mobile_whatsapp = %L
                                          OR t.street = 'Rua das Flores' OR t.zip_code = '90010000'$q$, pg_temp.mob(9))),
  '0'::jsonb, 'RN-13: filtrar a resposta por um campo sensível não acha Caio para Pedro');
SELECT is(pg_temp.run_as(15, $q$SELECT to_jsonb(count(*)) FROM public.members_list() t WHERE t.cpf = '52998224725'$q$),
  '1'::jsonb, 'RN-13: para Rita, acha');

-- ===========================================================================
-- RN-15: 60 homônimos no nível 144, de 25 em 25 (cenário desfeito)
-- ===========================================================================
CREATE TEMP TABLE s_rn15 AS SELECT pg_temp.scn(ARRAY[
  format($q$INSERT INTO public.members (id, name, gender, leader_id, mobile_whatsapp)
            SELECT ('c2070000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'Homônimo Teste', 'M', %L, '5192071' || lpad(n::text, 4, '0')
              FROM generate_series(1, 60) n$q$, pg_temp.m(3))],
  ARRAY[
    $q$SELECT to_jsonb(pg_temp.pages(15, 25))$q$,
    $q$SELECT to_jsonb(pg_temp.pages(15, 25, '_levels => ''{2}'', _is_active => true'))$q$
  ]) AS v;
SELECT is((SELECT jsonb_array_length(v -> 0) FROM s_rn15), 79, 'RN-15: com 60 homônimos, as páginas de 25 trazem 79 linhas');
SELECT is((SELECT count(DISTINCT x) FROM s_rn15, jsonb_array_elements_text(v -> 0) x), 79::bigint, 'RN-15: cada um aparece exatamente uma vez');
SELECT is((SELECT count(*) FROM s_rn15, jsonb_array_elements_text(v -> 0) x WHERE x LIKE 'c2070000-0000-0000-0001-%'), 60::bigint,
  'RN-15: os 60 homônimos estão lá');
SELECT ok((SELECT array_agg(x ORDER BY o) FILTER (WHERE x LIKE 'c2070000-0000-0000-0001-%')
             FROM s_rn15, jsonb_array_elements_text(v -> 0) WITH ORDINALITY e(x, o))
        = (SELECT array_agg(x ORDER BY o) FILTER (WHERE x LIKE 'c2070000-0000-0000-0001-%')
             FROM s_rn15, jsonb_array_elements_text(v -> 1) WITH ORDINALITY e(x, o)),
  'RN-15: com filtro (144 e ativos), a mesma ordem relativa');
SELECT ok((SELECT array_agg(x ORDER BY o) FILTER (WHERE x LIKE 'c2070000-0000-0000-0001-%')
             FROM s_rn15, jsonb_array_elements_text(v -> 0) WITH ORDINALITY e(x, o))
        = (SELECT array_agg(('c2070000-0000-0000-0001-' || lpad(n::text, 12, '0')) ORDER BY n) FROM generate_series(1, 60) n),
  'DA-5: o desempate dos homônimos é pelo id');

-- ===========================================================================
-- DA-1: página e limites
-- ===========================================================================
SELECT is(cardinality(pg_temp.list(15, '_limit => 0')), 1, 'DA-1: _limit 0 vira 1');
SELECT is(cardinality(pg_temp.list(15, '_limit => 1000')), 19, 'DA-1: _limit acima de 100 vira 100 (aqui, os 19)');
SELECT is(pg_temp.list(15, '_limit => 3, _offset => -5'), ARRAY['Magda', 'Samuel', 'Lúcia'], 'DA-1: _offset negativo vira 0');
SELECT is(pg_temp.list(15, '_limit => 25, _offset => 500'), '{}'::text[], 'página além do fim: vazia, sem erro');
SELECT is(pg_temp.list(15, '_leader_ids => ''{}'''), pg_temp.list(15), 'DA-2: Liderança vazia = sem filtro');
SELECT is(pg_temp.cnt(15, '_leader_ids => ''{NULL}'''), '19', 'DA-2: só nulos = sem filtro');

SELECT * FROM finish();
ROLLBACK;
